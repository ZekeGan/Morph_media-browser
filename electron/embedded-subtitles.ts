import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Explorer } from './explorer'
import { readMkvSubtitles, type EmbeddedTrack } from './mkv-subtitles'
import { cuesToSrt } from '../shared/subtitles'
import type { EmbeddedSubtitleInfo, ExplorerResponse } from '../shared/explorer'

// R-412: the subtitle tracks inside a video, read by main (mkv-subtitles.ts) and kept in a local cache beside the
// thumbnails: a rebuildable copy of what the file says, never part of the folder record. A cached result is used
// only while the file's size and modified time are the ones it was read at.
const CACHE_VERSION = 1
const CACHE_FILES = 80
const CACHE_BYTES = 32 * 1024 * 1024
const KEPT = 6

const valid = (value: unknown): value is EmbeddedTrack[] =>
  Array.isArray(value) &&
  value.length <= 64 &&
  value.every(
    (track) =>
      track &&
      Number.isSafeInteger(track.number) &&
      typeof track.graphic === 'boolean' &&
      Array.isArray(track.cues) &&
      track.cues.length <= 100_000 &&
      track.cues.every(
        (cue: { start?: unknown; end?: unknown; text?: unknown }) =>
          typeof cue?.start === 'number' &&
          typeof cue.end === 'number' &&
          typeof cue.text === 'string'
      )
  )

async function trim(dir: string) {
  const names = (await fs.readdir(dir)).filter((name) => /^[0-9a-f]{64}\.json$/.test(name)),
    files = await Promise.all(
      names.map(async (name) => ({ name, stat: await fs.stat(path.join(dir, name)) }))
    )
  files.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
  let bytes = 0
  for (const [index, file] of files.entries()) {
    bytes += file.stat.size
    if (index >= CACHE_FILES || bytes > CACHE_BYTES)
      await fs.unlink(path.join(dir, file.name)).catch(() => {})
  }
}

export async function embeddedTracks(
  ex: Explorer,
  rowId: string,
  fileId: string
): Promise<EmbeddedTrack[]> {
  // The file comes from the folder's own content list; the window never names a path.
  const found = await ex.file(rowId, fileId)
  if (!/\.(mkv|webm|mka)$/i.test(found.file))
    throw new Error('只有 Matroska（MKV／WebM）影片能讀內嵌字幕')
  const key = createHash('sha256')
      .update(`${CACHE_VERSION}|${found.file}|${found.stat.size}|${found.stat.mtimeMs}`)
      .digest('hex'),
    kept = ex.embeddedSubtitles.get(key)
  if (kept) return kept
  const running = ex.embeddedJobs.get(key)
  if (running) return running
  const dir = path.join(ex.root, 'subtitle-cache'),
    cache = path.join(dir, key + '.json')
  const job = (async () => {
    try {
      const stat = await fs.stat(cache)
      if (stat.isFile() && stat.size <= CACHE_BYTES) {
        const saved = JSON.parse(await fs.readFile(cache, 'utf8'))
        if (
          saved?.version === CACHE_VERSION &&
          saved.size === found.stat.size &&
          saved.mtimeMs === found.stat.mtimeMs &&
          valid(saved.tracks)
        )
          return saved.tracks as EmbeddedTrack[]
      }
    } catch {
      // No usable cache: read the file.
    }
    const tracks = await readMkvSubtitles(found.file, {
      onProgress: (fraction) => ex.desktop.subtitleProgress?.({ rowId, fileId, fraction }),
    })
    try {
      await fs.mkdir(dir, { recursive: true })
      const temporary = cache + '.' + randomUUID() + '.tmp'
      await fs.writeFile(
        temporary,
        JSON.stringify({
          version: CACHE_VERSION,
          size: found.stat.size,
          mtimeMs: found.stat.mtimeMs,
          tracks,
        })
      )
      await fs.rename(temporary, cache)
      await trim(dir)
    } catch {
      // The cache only saves time; failing to write it is not an error.
    }
    return tracks
  })()
  ex.embeddedJobs.set(key, job)
  try {
    const tracks = await job
    while (ex.embeddedSubtitles.size >= KEPT)
      ex.embeddedSubtitles.delete(ex.embeddedSubtitles.keys().next().value!)
    ex.embeddedSubtitles.set(key, tracks)
    return tracks
  } finally {
    ex.embeddedJobs.delete(key)
  }
}

const info = (track: EmbeddedTrack): EmbeddedSubtitleInfo => ({
  number: track.number,
  ...(track.language ? { language: track.language } : {}),
  ...(track.name ? { name: track.name } : {}),
  ...(track.format ? { format: track.format } : {}),
  ...(track.default ? { default: true } : {}),
  ...(track.forced ? { forced: true } : {}),
  graphic: track.graphic,
  cues: track.cues.length,
})

export async function embeddedList(
  ex: Explorer,
  rowId: string,
  fileId: string
): Promise<ExplorerResponse> {
  return { embedded: { fileId, tracks: (await embeddedTracks(ex, rowId, fileId)).map(info) } }
}

// One track as SRT text, in the same shape a subtitle file is returned.
export async function embeddedText(
  ex: Explorer,
  rowId: string,
  fileId: string,
  number: number
): Promise<ExplorerResponse> {
  const track = (await embeddedTracks(ex, rowId, fileId)).find((item) => item.number === number)
  if (!track) throw new Error('找不到這個字幕軌')
  if (track.graphic) throw new Error('有圖形字幕，目前無法顯示')
  if (!track.cues.length) throw new Error('這個字幕軌沒有可顯示的文字')
  return {
    subtitle: {
      token: 'emb-' + number,
      name: track.name || track.language || '#' + number,
      text: cuesToSrt(track.cues),
      portable: false,
    },
  }
}
