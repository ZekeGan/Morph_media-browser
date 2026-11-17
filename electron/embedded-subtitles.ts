import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { Explorer } from './explorer'
import {
  CANCELLED,
  LIMITS,
  readMkvSubtitles,
  readPicturePackets,
  type EmbeddedTrack,
} from './mkv-subtitles'
import { cuesToSrt } from '../shared/subtitles'
import type { EmbeddedSubtitleInfo, ExplorerResponse } from '../shared/explorer'

// R-412: the subtitle tracks inside a video, read by main (mkv-subtitles.ts) and kept in a local cache beside the
// thumbnails: a rebuildable copy of what the file says, never part of the folder record. A cached result is used
// only while the file's size and modified time are the ones it was read at.
// R-421: a picture (VobSub) track is cached as its header and, per cue, the time and the place of the packet in
// the video; the packets themselves (tens of MiB a film) stay in the video and are read when the player asks.
// R-425: version 3 leaves out pieces of effects and marks tracks cut at the limits; a read that failed for good is
// kept too ({ error }), so the same file is not read again only to fail again.
const CACHE_VERSION = 3
const CACHE_FILES = 80
const CACHE_BYTES = 32 * 1024 * 1024
const KEPT = 6
// R-421: one answer holds the picture cues from a little before the asked time, up to this many and this much.
const PICTURE_BACK = 10
const PICTURE_CUES = 80
const PICTURE_BYTES = 3 * 1024 * 1024

const whole = (value: unknown, least: number, most: number) =>
  Number.isSafeInteger(value) && (value as number) >= least && (value as number) <= most
const valid = (value: unknown): value is EmbeddedTrack[] =>
  Array.isArray(value) &&
  value.length <= 64 &&
  // The same total the reader allows for picture cues.
  value.reduce(
    (sum: number, track: { pictures?: unknown[] }) =>
      sum + (Array.isArray(track?.pictures) ? track.pictures.length : 0),
    0
  ) <= LIMITS.picturesTotal &&
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
      ) &&
      (track.picture === undefined) === (track.pictures === undefined) &&
      (track.picture === undefined ||
        (track.graphic &&
          whole(track.picture.width, 1, 4096) &&
          whole(track.picture.height, 1, 4096) &&
          typeof track.picture.zlib === 'boolean' &&
          (track.picture.strip === undefined ||
            (typeof track.picture.strip === 'string' && track.picture.strip.length <= 512)) &&
          Array.isArray(track.picture.palette) &&
          track.picture.palette.length === 16 &&
          track.picture.palette.every((colour: unknown) => whole(colour, 0, 0xffffff)) &&
          Array.isArray(track.pictures) &&
          track.pictures.length <= 100_000 &&
          track.pictures.every(
            (cue: { start?: unknown; end?: unknown; at?: unknown; size?: unknown }) =>
              typeof cue?.start === 'number' &&
              typeof cue.end === 'number' &&
              whole(cue.at, 0, Number.MAX_SAFE_INTEGER) &&
              whole(cue.size, 1, 64 * 1024)
          )))
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

// R-417: a read in progress. The track list is known first (ready) and its cue arrays fill while the file is read;
// focus is the playback time the window asked for last, read first.
export interface EmbeddedJob {
  ready: Promise<EmbeddedTrack[]>
  done: Promise<EmbeddedTrack[]>
  live?: EmbeddedTrack[]
  focus: number
  // R-425: one video is read at a time; opening another stops this one.
  controller: AbortController
}

// Failures that would come out the same next time; a timeout (a busy disk) or a cancelled read is tried again.
// Only what the file itself says is kept: a system error (locked by a virus scan, still being copied, a busy disk)
// carries a Node code and is tried again next time.
const lasting = (error: unknown) =>
  error instanceof Error &&
  !(error as NodeJS.ErrnoException).code &&
  error.message !== CANCELLED &&
  error.message !== '讀取內嵌字幕逾時'

async function cached(
  cache: string,
  size: number,
  mtimeMs: number
): Promise<EmbeddedTrack[] | { error: string } | undefined> {
  try {
    const stat = await fs.stat(cache)
    if (stat.isFile() && stat.size <= CACHE_BYTES) {
      const saved = JSON.parse(await fs.readFile(cache, 'utf8'))
      if (saved?.version === CACHE_VERSION && saved.size === size && saved.mtimeMs === mtimeMs) {
        if (typeof saved.error === 'string' && saved.error.length <= 200)
          return { error: saved.error }
        if (valid(saved.tracks)) return saved.tracks as EmbeddedTrack[]
      }
    }
  } catch {
    // No usable cache: read the file.
  }
  return undefined
}
async function save(dir: string, cache: string, content: object) {
  try {
    await fs.mkdir(dir, { recursive: true })
    const temporary = cache + '.' + randomUUID() + '.tmp'
    await fs.writeFile(temporary, JSON.stringify({ version: CACHE_VERSION, ...content }))
    await fs.rename(temporary, cache)
    await trim(dir)
  } catch {
    // The cache only saves time; failing to write it is not an error.
  }
}

// The finished tracks of a video, or the read in progress (started here when none is running).
async function embeddedJob(
  ex: Explorer,
  rowId: string,
  fileId: string
): Promise<({ tracks: EmbeddedTrack[] } | { job: EmbeddedJob }) & { file: string }> {
  // The file comes from the folder's own content list; the window never names a path.
  const found = await ex.file(rowId, fileId)
  if (!/\.(mkv|webm|mka)$/i.test(found.file))
    throw new Error('只有 Matroska（MKV／WebM）影片能讀內嵌字幕')
  const key = createHash('sha256')
      .update(`${CACHE_VERSION}|${found.file}|${found.stat.size}|${found.stat.mtimeMs}`)
      .digest('hex'),
    kept = ex.embeddedSubtitles.get(key)
  if (kept) return { tracks: kept, file: found.file }
  const running = ex.embeddedJobs.get(key)
  // A read that was stopped (another video opened) but has not noticed yet is not handed back; it starts again.
  if (running && !running.controller.signal.aborted) return { job: running, file: found.file }
  const dir = path.join(ex.root, 'subtitle-cache'),
    cache = path.join(dir, key + '.json')
  // R-425: the reads of other videos stop; reading two films at once on one disk slows both and the playback.
  for (const other of ex.embeddedJobs.values()) other.controller.abort()
  let listed: (tracks: EmbeddedTrack[]) => void = () => {}
  const job: EmbeddedJob = {
    ready: new Promise((resolve) => (listed = resolve)),
    done: Promise.resolve([]),
    focus: 0,
    controller: new AbortController(),
  }
  const stamp = { size: found.stat.size, mtimeMs: found.stat.mtimeMs }
  job.done = (async () => {
    const saved = await cached(cache, found.stat.size, found.stat.mtimeMs)
    if (saved && 'error' in saved) throw new Error(saved.error)
    if (saved) {
      listed(saved)
      return saved
    }
    let tracks: EmbeddedTrack[]
    try {
      tracks = await readMkvSubtitles(found.file, {
        onProgress: (fraction) => ex.desktop.subtitleProgress?.({ rowId, fileId, fraction }),
        onTracks: (live) => {
          job.live = live
          listed(live)
        },
        focus: () => job.focus,
        signal: job.controller.signal,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (lasting(error)) await save(dir, cache, { ...stamp, error: message.slice(0, 200) })
      throw error
    }
    await save(dir, cache, { ...stamp, tracks })
    return tracks
  })()
  // A read that fails before the track list is known fails the early answer too.
  job.ready = Promise.race([job.ready, job.done])
  // Only early requests wait on ready; a failed read must not leave it rejected with no one listening.
  job.ready.catch(() => {})
  ex.embeddedJobs.set(key, job)
  void job.done
    .then((tracks) => {
      while (ex.embeddedSubtitles.size >= KEPT)
        ex.embeddedSubtitles.delete(ex.embeddedSubtitles.keys().next().value!)
      ex.embeddedSubtitles.set(key, tracks)
    })
    .catch(() => {})
    // Only this job's own entry: a stopped job finishing late must not remove the read that replaced it.
    .finally(() => {
      if (ex.embeddedJobs.get(key) === job) ex.embeddedJobs.delete(key)
    })
  return { job, file: found.file }
}

export async function embeddedTracks(
  ex: Explorer,
  rowId: string,
  fileId: string
): Promise<EmbeddedTrack[]> {
  const found = await embeddedJob(ex, rowId, fileId)
  return 'tracks' in found ? found.tracks : found.job.done
}

const info = (track: EmbeddedTrack): EmbeddedSubtitleInfo => ({
  number: track.number,
  ...(track.language ? { language: track.language } : {}),
  ...(track.name ? { name: track.name } : {}),
  ...(track.format ? { format: track.format } : {}),
  ...(track.default ? { default: true } : {}),
  ...(track.forced ? { forced: true } : {}),
  graphic: track.graphic,
  ...(track.picture ? { picture: true } : {}),
  ...(track.truncated ? { truncated: true } : {}),
  cues: track.pictures ? track.pictures.length : track.cues.length,
})

export async function embeddedList(
  ex: Explorer,
  rowId: string,
  fileId: string,
  early = false
): Promise<ExplorerResponse> {
  const found = await embeddedJob(ex, rowId, fileId)
  if ('tracks' in found) return { embedded: { fileId, tracks: found.tracks.map(info) } }
  if (!early) return { embedded: { fileId, tracks: (await found.job.done).map(info) } }
  const tracks = await found.job.ready
  return { embedded: { fileId, tracks: tracks.map(info), reading: !!found.job.live } }
}

// One track as SRT text, in the same shape a subtitle file is returned. Early: while the file is still being read,
// the cues read so far (partial), and the reading moves to the given playback time.
export async function embeddedText(
  ex: Explorer,
  rowId: string,
  fileId: string,
  number: number,
  early = false,
  time?: number
): Promise<ExplorerResponse> {
  const found = await embeddedJob(ex, rowId, fileId)
  let tracks: EmbeddedTrack[],
    partial = false
  if ('tracks' in found) tracks = found.tracks
  else if (early) {
    if (typeof time === 'number' && time >= 0) found.job.focus = time
    tracks = await found.job.ready
    partial = !!found.job.live
  } else tracks = await found.job.done
  const track = tracks.find((item) => item.number === number)
  if (!track) throw new Error('找不到這個字幕軌')
  if (track.graphic) throw new Error('有圖形字幕，目前無法顯示')
  if (!track.cues.length && !partial) throw new Error('這個字幕軌沒有可顯示的文字')
  const cues = partial
    ? track.cues.slice().sort((a, b) => a.start - b.start || a.end - b.end)
    : track.cues
  return {
    subtitle: {
      token: 'emb-' + number,
      name: track.name || track.language || '#' + number,
      text: cuesToSrt(cues),
      portable: false,
      ...(partial ? { partial: true } : {}),
    },
  }
}

// R-421: the picture cues of one VobSub track around a playback time: the track's frame size and palette, and each
// cue's time with its packet (base64), which the window decodes. Only a stretch of the film is answered at a time
// (until = where the answer stops; absent when it reaches the end of the track), so the window asks again as
// playback goes on. Early works as it does for text: the cues read so far, and reading moves to the given time.
export async function embeddedPictures(
  ex: Explorer,
  rowId: string,
  fileId: string,
  number: number,
  early = false,
  time = 0
): Promise<ExplorerResponse> {
  const found = await embeddedJob(ex, rowId, fileId)
  let tracks: EmbeddedTrack[],
    partial = false
  if ('tracks' in found) tracks = found.tracks
  else if (early) {
    if (time >= 0) found.job.focus = time
    tracks = await found.job.ready
    partial = !!found.job.live
  } else tracks = await found.job.done
  const track = tracks.find((item) => item.number === number)
  if (!track) throw new Error('找不到這個字幕軌')
  if (!track.picture || !track.pictures) {
    if (track.graphic) throw new Error('有圖形字幕，目前無法顯示')
    throw new Error('這個字幕軌不是圖形字幕')
  }
  if (!track.pictures.length && !partial) throw new Error('這個字幕軌沒有可顯示的圖片')
  const all = partial
      ? track.pictures.slice().sort((a, b) => a.start - b.start || a.at - b.at)
      : track.pictures,
    from = Math.max(0, time - PICTURE_BACK),
    chosen: typeof all = []
  let until: number | undefined,
    bytes = 0
  for (const cue of all) {
    if (cue.end <= from) continue
    if (chosen.length >= PICTURE_CUES || bytes > PICTURE_BYTES) {
      until = cue.start
      break
    }
    chosen.push(cue)
    // Packed size; a packet unpacks to 64 KiB at most.
    bytes += cue.size * 4
  }
  const packets = await readPicturePackets(found.file, track.picture, chosen)
  return {
    pictures: {
      token: 'emb-' + number,
      name: track.name || track.language || '#' + number,
      width: track.picture.width,
      height: track.picture.height,
      palette: track.picture.palette,
      from,
      ...(until !== undefined ? { until } : {}),
      cues: chosen.flatMap((cue, index) =>
        packets[index]
          ? [{ start: cue.start, end: cue.end, data: packets[index].toString('base64') }]
          : []
      ),
      ...(partial ? { partial: true } : {}),
    },
  }
}
