import os from 'node:os'
import { readArchiveImage } from './archive-foreign'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { exists, safePath } from './files'
import { identifyImage } from '../shared/images'
import { openAsBlob } from 'node:fs'
import { parseBlob, selectCover } from 'music-metadata'
import type { Explorer } from './explorer'
import type { AudioTags } from '../shared/album'

export async function audioCover(
  ex: Explorer,
  rowId: string,
  id: string,
  signal?: AbortSignal
): Promise<globalThis.Response> {
  const task = ex.audioCoverTail.then(() =>
    signal?.aborted ? new Response(null, { status: 499 }) : ex.readAudioCover(rowId, id)
  )
  ex.audioCoverTail = task.catch(() => {})
  return task
}

// R-390: tags and length of audio files for the album page. Same guarded file lookup and read-only Blob access as the
// cover; covers are skipped and the length is only what the header gives, so no file is read whole. Reads share the
// cover queue, one at a time. A file that cannot be read gives an empty entry instead of failing the others.
const tagText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : undefined
const tagNumber = (value: unknown, max: number) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max
    ? value
    : undefined
export async function audioTags(ex: Explorer, rowId: string, fileIds: string[]) {
  const result: Record<string, AudioTags> = Object.create(null)
  for (const id of [...new Set(fileIds)]) {
    const task = ex.audioCoverTail.then(async (): Promise<AudioTags> => {
      try {
        const entry = await ex.file(rowId, id)
        if (!entry.mime.startsWith('audio/') || entry.stat.size > 256 * 1024 * 1024) return {}
        const { common, format } = await parseBlob(
          await openAsBlob(entry.file, { type: entry.mime }),
          { duration: false, skipCovers: true, skipPostHeaders: true }
        )
        const duration = format.duration
        return {
          title: tagText(common.title),
          artist: tagText(common.artist),
          albumArtist: tagText(common.albumartist),
          album: tagText(common.album),
          year: tagNumber(common.year, 9999),
          track: tagNumber(common.track?.no, 9999),
          disc: tagNumber(common.disk?.no, 99),
          duration:
            typeof duration === 'number' && Number.isFinite(duration) && duration > 0
              ? duration
              : undefined,
        }
      } catch {
        return {}
      }
    })
    ex.audioCoverTail = task.catch(() => {})
    result[id] = await task
  }
  return result
}

export async function readAudioCover(
  ex: Explorer,
  rowId: string,
  id: string
): Promise<globalThis.Response> {
  try {
    const entry = await ex.file(rowId, id)
    if (!entry.mime.startsWith('audio/')) return new Response(null, { status: 415 })
    // Blob parsing seeks through the original read-only file; never load the whole file into RAM.
    if (entry.stat.size > 256 * 1024 * 1024) return new Response(null, { status: 413 })
    const metadata = await parseBlob(await openAsBlob(entry.file, { type: entry.mime }), {
      duration: false,
      skipPostHeaders: true,
    })
    const cover = selectCover(metadata.common.picture)
    if (!cover) return new Response(null, { status: 204 })
    if (cover.data.byteLength > 8 * 1024 * 1024) return new Response(null, { status: 413 })
    const image = identifyImage(cover.data)
    if (!image) return new Response(null, { status: 415 })
    return new Response(new Uint8Array(cover.data), {
      headers: {
        'Content-Type': image.mime,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new Response(null, { status: 422 })
  }
}

export async function stream(
  ex: Explorer,
  rowId: string,
  id: string,
  request: globalThis.Request,
  thumbnail = false
): Promise<globalThis.Response> {
  try {
    const entry = await ex.file(rowId, id)
    if (thumbnail) {
      if (!/^(image|video)\//.test(entry.mime))
        return new globalThis.Response(null, { status: 415 })
      const cache = path.join(ex.root, 'thumbnails')
      await fs.mkdir(cache, { recursive: true })
      const file = path.join(
        cache,
        createHash('sha256')
          // Video previews are cached per size generation, so the old low-resolution ones are not reused.
          .update(
            `${entry.file}/${entry.stat.size}/${entry.stat.mtimeMs}` +
              (entry.mime.startsWith('video/') ? '/480' : '')
          )
          .digest('hex') + '.jpg'
      )
      await safePath(ex.root, file)
      const bytes = await ex.thumbnail(
        file,
        entry.file,
        entry.mime,
        entry.stat.size,
        request.signal,
        `media://file/${rowId}/${id}`
      )
      if (
        ++ex.thumbnailReads % 32 === 1 &&
        !ex.thumbnailTrim &&
        Date.now() - ex.thumbnailTrimAt > 60000
      ) {
        ex.thumbnailTrimAt = Date.now()
        ex.thumbnailTrim = ex
          .trimThumbnails()
          .catch(() => {})
          .finally(() => {
            ex.thumbnailTrim = undefined
          })
      }
      const version =
        new URL(request.url).searchParams.get('v') === `${entry.stat.size}-${entry.stat.mtimeMs}`
      return new globalThis.Response(new Uint8Array(bytes), {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': version ? 'private, max-age=86400, immutable' : 'no-cache',
        },
      })
    }
    if (!/^(image|video|audio)\//.test(entry.mime) && entry.mime !== 'application/pdf')
      return new globalThis.Response(null, { status: 415 })
    const size = entry.stat.size,
      headers: Record<string, string> = {
        'Content-Type': entry.mime,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      }
    const range = request.headers.get('range')
    let start = 0,
      end = size - 1,
      status = 200
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!m || (!m[1] && !m[2]))
        return new globalThis.Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        })
      if (!m[1]) start = Math.max(0, size - Number(m[2]))
      else start = Number(m[1])
      if (m[2] && m[1]) end = Math.min(end, Number(m[2]))
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= size
      )
        return new globalThis.Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${size}` },
        })
      status = 206
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    }
    headers['Content-Length'] = String(Math.max(0, end - start + 1))
    if (request.method === 'HEAD' || !size)
      return new globalThis.Response(null, { status, headers })
    const stream = createReadStream(entry.file, { start, end })
    request.signal.addEventListener('abort', () => stream.destroy(), { once: true })
    return new globalThis.Response(Readable.toWeb(stream) as ReadableStream, { status, headers })
  } catch {
    return new globalThis.Response(null, { status: 404 })
  }
}

export async function archiveStream(
  ex: Explorer,
  rowId: string,
  fileId: string,
  token: string,
  number: string
): Promise<globalThis.Response> {
  try {
    const file = await ex.file(rowId, fileId),
      cached = ex.archives.get(token),
      index = cached?.index
    if (
      ![
        'application/zip',
        'application/epub+zip',
        'application/vnd.comicbook-rar',
        'application/x-7z-compressed',
      ].includes(file.mime) ||
      !index ||
      cached?.file !== file.file ||
      !/^\d{1,5}$/.test(number)
    )
      throw new Error('壓縮頁面已失效')
    const entry = index.images[Number(number)]
    if (!entry) throw new Error('壓縮頁面不存在')
    const bytes = await readArchiveImage(file.file, index, entry)
    return new globalThis.Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': entry.mime,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return new globalThis.Response(null, { status: 404 })
  }
}

// R-441: thumbnails were made one at a time, so a gallery opened cold showed them one by one. A few are made at once
// (half the processors, 2 to 4), and the newest request goes first: while scrolling, that is what is on the screen.
// A request the window has given up on (scrolled away, the gallery closed) is skipped when its turn comes.
export const THUMBNAIL_WORKERS = Math.max(2, Math.min(4, Math.floor(os.cpus().length / 2)))
export function queueThumbnail(ex: Explorer, make: () => Promise<Buffer>): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    ex.thumbnailQueue.push(() => {
      ex.thumbnailActive++
      make()
        .then(resolve, reject)
        .finally(() => {
          ex.thumbnailActive--
          pumpThumbnails(ex)
        })
    })
    pumpThumbnails(ex)
  })
}
function pumpThumbnails(ex: Explorer) {
  while (ex.thumbnailActive < THUMBNAIL_WORKERS && ex.thumbnailQueue.length)
    ex.thumbnailQueue.pop()!()
}

export async function thumbnail(
  ex: Explorer,
  cache: string,
  source: string,
  mime: string,
  size: number,
  signal: AbortSignal,
  url: string
) {
  const jpeg = (b: Buffer) =>
    b.length > 4 && b[0] === 255 && b[1] === 216 && b.at(-2) === 255 && b.at(-1) === 217
  // Warm thumbnails never wait behind unrelated cold image decoding.
  try {
    const bytes = await fs.readFile(cache)
    if (jpeg(bytes)) return bytes
  } catch {}
  if (signal.aborted) throw new Error('縮圖已取消')
  const pending = ex.thumbnailJobs.get(cache)
  if (pending) {
    pending.signals.push(signal)
    return pending.promise
  }
  const signals = [signal]
  const job = queueThumbnail(ex, async () => {
    if (signals.every((signal) => signal.aborted)) throw new Error('縮圖已取消')
    try {
      const cached = await fs.readFile(cache)
      if (jpeg(cached)) return cached
    } catch {}
    if (mime.startsWith('image/') && size > 100 * 1024 * 1024)
      throw new Error('圖片過大，請直接檢視原圖')
    const bytes = await ex.desktop.thumbnail(source, mime, url)
    if (!jpeg(bytes)) throw new Error('縮圖解碼失敗')
    const temp = cache + '.' + randomUUID() + '.tmp'
    try {
      await fs.writeFile(temp, bytes, { flag: 'wx' })
      await fs.rename(temp, cache)
    } finally {
      await fs.unlink(temp).catch(() => {})
    }
    return bytes
  })
  ex.thumbnailJobs.set(cache, { promise: job, signals })
  try {
    return await job
  } finally {
    ex.thumbnailJobs.delete(cache)
  }
}

export async function trimThumbnails(ex: Explorer) {
  const cache = path.join(ex.root, 'thumbnails')
  await safePath(ex.root, cache)
  if (!(await exists(cache))) return
  const files: { file: string; size: number; time: number }[] = []
  for (const entry of await fs.readdir(cache, { withFileTypes: true }))
    if (entry.isFile() && !entry.isSymbolicLink() && /^[0-9a-f]{64}\.jpg$/.test(entry.name)) {
      const file = path.join(cache, entry.name),
        stat = await fs.stat(file)
      files.push({ file, size: stat.size, time: stat.mtimeMs })
    }
  let size = files.reduce((sum, f) => sum + f.size, 0),
    count = files.length
  for (const f of files.sort((a, b) => a.time - b.time)) {
    if (count <= 3000 && size <= 512 * 1024 * 1024) break
    await safePath(cache, f.file)
    await fs.unlink(f.file)
    size -= f.size
    count--
  }
}
