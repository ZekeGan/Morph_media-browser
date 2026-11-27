import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { type ContentResult, type MediaEntry } from '../shared/explorer'
import { imageTypes } from '../shared/images'
import { type KindSample, sampleOf } from '../shared/kind'
import { type MediaSort, mediaSortFields, sortMedia } from '../shared/media'
import { fmt } from '../shared/message'
import { DATA_DIR } from '../shared/model'

import type { Explorer } from './explorer'
import { safePath } from './files'
import { hiddenFileNames } from './hidden'
import { mediaNames, mediaTypes as types, THUMB_EDGE, thumbVersion } from './media-files'

// What a name is listed as, from the entry type and the extension only (nothing is opened); the same rule the
// batch below and the scan use.
const kindOf = (name: string, directory: boolean): MediaEntry['kind'] =>
  directory
    ? 'folder'
    : imageTypes[path.extname(name).slice(1).toLowerCase()]
      ? 'image'
      : ((types[path.extname(name).toLowerCase()]?.[0] as MediaEntry['kind']) ?? 'other')

const STAT_CACHE_MS = 60000
const STAT_CACHE_FOLDERS = 4

// Every listed name's size and time (R-492), from the short cache when the folder's own time is unchanged (R-504).
// Stopped between groups of files when a newer sorted request from the same caller arrives.
async function folderFacts(
  ex: Explorer,
  folder: string,
  listed: { name: string }[],
  read: { stopped: boolean }
) {
  const now = Date.now()
  for (const [key, cached] of ex.statCache) if (cached.expires < now) ex.statCache.delete(key)
  const folderModified = (await fs.stat(folder)).mtimeMs
  const cached = ex.statCache.get(folder)
  if (cached && cached.folderModified === folderModified) return cached.facts
  const facts = new Map<string, { size: number; modified: number }>()
  for (let start = 0; start < listed.length; start += 32) {
    if (read.stopped) throw new Error('已改看其他資料夾，停止讀取')
    await Promise.all(
      listed.slice(start, start + 32).map(async ({ name }) => {
        // lstat: a name swapped for a link since the listing is not followed (it is dropped from the batch anyway).
        const stat = await fs.lstat(path.join(folder, name)).catch(() => undefined)
        if (stat) facts.set(name, { size: stat.size, modified: stat.mtimeMs })
      })
    )
  }
  ex.statCache.delete(folder)
  while (ex.statCache.size >= STAT_CACHE_FOLDERS) {
    ex.statCache.delete(ex.statCache.keys().next().value!)
  }
  ex.statCache.set(folder, { folderModified, expires: Date.now() + STAT_CACHE_MS, facts })
  return facts
}

export async function content(
  ex: Explorer,
  rowId: string,
  limit?: number,
  cursor?: string,
  // R-492: the order the list will show, so every batch comes in that order. Only read on the first request; the
  // later batches follow the order chosen then.
  sort?: MediaSort,
  caller: 'panel' | 'overview' = 'panel'
): Promise<ContentResult> {
  if (
    (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) ||
    (cursor !== undefined &&
      (typeof cursor !== 'string' || cursor.length > 150 || limit === undefined)) ||
    (sort !== undefined &&
      (!sort ||
        typeof sort !== 'object' ||
        !mediaSortFields.includes(sort.field) ||
        typeof sort.asc !== 'boolean'))
  ) {
    throw new Error('內容分批設定不合法')
  }
  const row = await ex.library.readableRow(rowId)
  const notices: string[] = []
  const entries: MediaEntry[] = []
  let offset = 0
  let token = ''
  let names: string[]
  let sample: KindSample
  let hidden = new Set<string>()
  for (const [id, session] of ex.contentPages) {
    if (session.expires < Date.now()) ex.contentPages.delete(id)
  }
  if (cursor) {
    const match = /^([\w-]+):(\d+)$/.exec(cursor)
    const session = match && ex.contentPages.get(match[1])
    offset = Number(match?.[2])
    if (
      !session ||
      session.rowId !== rowId ||
      session.path !== row.path ||
      session.folderId !== row.record?.folderId ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= session.names.length
    ) {
      throw new Error('資料夾內容已過期，請重新開啟資料夾')
    }
    hidden = session.hidden
    names = session.names
    sample = session.sample
    token = match![1]
    session.expires = Date.now() + 120000
  } else {
    try {
      hidden = await hiddenFileNames(row.path)
    } catch (error) {
      notices.push(fmt('無法確認隱藏屬性：{0}', String(error)))
    }
    const listed = (await fs.readdir(row.path, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.name.toLowerCase() !== DATA_DIR &&
          !entry.isSymbolicLink() &&
          (entry.isFile() || entry.isDirectory())
      )
      .map((entry) => ({ name: entry.name, kind: kindOf(entry.name, entry.isDirectory()) }))
      .sort(
        (a, b) =>
          mediaNames.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
      )
    // R-494: the folder's kind is judged from the whole listing, the same way the scan does, so it does not change
    // while the batches come in.
    sample = sampleOf(listed)
    names = listed.map((entry) => entry.name)
    if (sort) {
      // R-504: a newer sorted request from the same caller (another folder chosen) stops this one's read.
      const read = { stopped: false }
      const previous = ex.statReads.get(caller)
      if (previous) previous.stopped = true
      ex.statReads.set(caller, read)
      // Size and date need each file's stat before the first batch; name and kind need nothing more.
      let facts = new Map<string, { size: number; modified: number }>()
      try {
        if (sort.field === 'size' || sort.field === 'modified') {
          facts = await folderFacts(ex, row.path, listed, read)
        }
      } finally {
        if (ex.statReads.get(caller) === read) ex.statReads.delete(caller)
      }
      names = sortMedia(
        listed.map(({ name, kind }) => ({
          name,
          kind,
          id: createHash('sha256').update(name).digest('hex'),
          size: facts.get(name)?.size ?? 0,
          modified: facts.get(name)?.modified ?? 0,
          mime: '',
          url: '',
        })),
        sort
      ).map((entry) => entry.name)
    }
    if (limit && names.length > limit) {
      while (ex.contentPages.size >= 8) ex.contentPages.delete(ex.contentPages.keys().next().value!)
      token = randomUUID()
      ex.contentPages.set(token, {
        rowId,
        path: row.path,
        folderId: row.record?.folderId,
        names,
        hidden,
        sample,
        expires: Date.now() + 120000,
      })
    }
  }
  const batch = names.slice(offset, limit ? offset + limit : undefined)
  for (let start = 0; start < batch.length; start += 16) {
    await Promise.all(
      batch.slice(start, start + 16).map(async (name) => {
        const file = path.join(row.path, name)
        try {
          await safePath(row.path, file)
          const stat = await fs.stat(file)
          if (!stat.isFile() && !stat.isDirectory()) return
          const imageMime = imageTypes[path.extname(file).slice(1).toLowerCase()]
          const [kind, mime] = stat.isDirectory()
            ? (['folder', 'application/octet-stream'] as const)
            : imageMime
              ? (['image', imageMime] as const)
              : (types[path.extname(file).toLowerCase()] ?? ['other', 'application/octet-stream'])
          const id = createHash('sha256').update(name).digest('hex')
          const url = `media://file/${rowId}/${id}`
          ex.files.set(`${rowId}/${id}`, { rowId, name, file, mime })
          entries.push({
            id,
            name,
            kind,
            mime,
            ...(hidden.has(name) ? { hidden: true } : {}),
            size: stat.size,
            modified: stat.mtimeMs,
            url,
            ...(['image', 'video'].includes(kind)
              ? { thumb: `media://thumb/${rowId}/${id}?v=${thumbVersion(stat)}` }
              : {}),
          })
        } catch (e) {
          notices.push(`${name}: ${String(e)}`)
        }
      })
    )
  }
  // The batch keeps the listing's order (by name, or the requested sort).
  const order = new Map(batch.map((name, index) => [name, index]))
  entries.sort((a, b) => order.get(a.name)! - order.get(b.name)!)
  const next = offset + batch.length
  const complete = next >= names.length
  if (complete && token) ex.contentPages.delete(token)
  for (const sub of complete ? (row.record?.details?.subtitles ?? []) : []) {
    const file = path.join(row.path, DATA_DIR, sub.relativePath)
    ex.files.set(`${rowId}/${sub.id}`, {
      rowId,
      name: sub.name,
      file,
      mime: 'text/vtt',
      portable: true,
    })
    entries.push({
      id: sub.id,
      name: sub.name,
      kind: 'subtitle',
      mime: 'text/vtt',
      size: 0,
      modified: 0,
      url: `media://file/${rowId}/${sub.id}`,
    })
  }
  return {
    entries,
    notices,
    sample,
    ...(limit
      ? {
          total: names.length + (row.record?.details?.subtitles?.length ?? 0),
          ...(!complete ? { nextCursor: token + ':' + next } : {}),
        }
      : {}),
  }
}

export async function file(ex: Explorer, rowId: string, id: string) {
  const row = await ex.library.readableRow(rowId)
  const entry = ex.files.get(`${rowId}/${id}`)
  if (!entry || entry.rowId !== rowId) throw new Error('媒體不存在或需重新載入')
  await safePath(row.path, entry.file)
  if (!entry.portable && path.dirname(entry.file) !== row.path) {
    throw new Error('媒體超出直接內容範圍')
  }
  if (
    entry.portable &&
    !row.record?.details?.subtitles?.some(
      (s) => path.join(row.path, DATA_DIR, s.relativePath) === entry.file
    )
  ) {
    throw new Error('字幕不屬於此記錄')
  }
  const stat = await fs.stat(entry.file)
  if (!stat.isFile()) throw new Error('不是檔案')
  return { ...entry, stat, row }
}

// The n-th image file (by name) directly inside the folder, as a thumbnail; used by image cells that pick by position.
// The files directly inside a folder, in reading order: not hidden, not links.
export async function folderFiles(row: { path: string }) {
  let hidden = new Set<string>()
  try {
    hidden = await hiddenFileNames(row.path)
  } catch {
    // Without the attribute check, hidden files are simply not excluded.
  }
  return (await fs.readdir(row.path, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && !hidden.has(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => mediaNames.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0))
}

// Makes a file inside the folder servable and returns its id (the same id the folder listing gives it).
export async function serveFile(
  ex: Explorer,
  row: { path: string },
  rowId: string,
  name: string,
  mime: string
) {
  const file = path.join(row.path, name)
  const id = createHash('sha256').update(name).digest('hex')
  await safePath(row.path, file)
  ex.files.set(`${rowId}/${id}`, { rowId, name, file, mime })
  return id
}

export const imageMime = (name: string) => imageTypes[path.extname(name).slice(1).toLowerCase()]
// R-499: `?full=1` asks for the original picture (the right panel draws it large); without it, the thumbnail.
const wantsFull = (request: globalThis.Request) =>
  new URL(request.url).searchParams.get('full') === '1'

export async function nthImage(
  ex: Explorer,
  rowId: string,
  index: number,
  request: globalThis.Request
): Promise<globalThis.Response> {
  if (!Number.isInteger(index) || index < 1 || index > 999) {
    return new globalThis.Response(null, { status: 404 })
  }
  const row = await ex.library.readableRow(rowId)
  const name = (await folderFiles(row)).filter(imageMime)[index - 1]
  if (!name) return new globalThis.Response(null, { status: 404 })
  return ex.stream(
    rowId,
    await serveFile(ex, row, rowId, name, imageMime(name)),
    request,
    !wantsFull(request)
  )
}

// R-437: the one rule for a folder's cover, whatever its kind, shared by the card and the right panel: the picture
// chosen as cover, else the first picture of the record that is not a source extra, else (when the folder holds audio)
// the first track's embedded cover, else the one image named cover, folder, front or artist, else the first image file.
export async function folderCover(
  ex: Explorer,
  rowId: string,
  request: globalThis.Request
): Promise<globalThis.Response> {
  const row = await ex.library.readableRow(rowId)
  const assets = row.record?.assets ?? []
  const chosen =
    assets.find((a) => a.assetId === row.record?.details?.bannerAssetId) ??
    assets.find((a) => !a.role)
  if (chosen) {
    try {
      const { file, mediaType } = await ex.library.asset(rowId, chosen.assetId)
      return new globalThis.Response(new Uint8Array(await fs.readFile(file)), {
        headers: { 'Content-Type': mediaType, 'X-Content-Type-Options': 'nosniff' },
      })
    } catch {
      // A picture whose file is gone: the next rule decides.
    }
  }
  const names = await folderFiles(row)
  const track = names.find((name) => types[path.extname(name).toLowerCase()]?.[0] === 'audio')
  // A track gone since the listing: the next rule decides.
  const stat = track && (await fs.stat(path.join(row.path, track)).catch(() => undefined))
  if (track && stat) {
    const id = await serveFile(ex, row, rowId, track, types[path.extname(track).toLowerCase()][1])
    // R-455: the embedded cover as a small picture, kept with the other thumbnails, so a page of album cards does
    // not hold every full-size cover. Made from the track as it is now (its size and time are in the name).
    const cache = path.join(ex.root, 'thumbnails')
    const small = path.join(
      cache,
      createHash('sha256')
        .update(
          `${path.join(row.path, track)}/${stat.size}/${stat.mtimeMs}/audio-cover/${THUMB_EDGE}`
        )
        .digest('hex') + '.jpg'
    )
    await safePath(ex.root, small)
    const jpeg = (bytes: Uint8Array) =>
      new globalThis.Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' },
      })
    const full = wantsFull(request)
    const cached = full ? undefined : await fs.readFile(small).catch(() => undefined)
    if (cached?.length) return jpeg(cached)
    const response = await ex.audioCover(rowId, id, request.signal)
    if (response.status === 200 && full) return response
    if (response.status === 200) {
      try {
        await fs.mkdir(cache, { recursive: true })
        return jpeg(
          await ex.thumbnail(
            small,
            path.join(row.path, track),
            'image/jpeg',
            0,
            request.signal,
            `media://audio-cover/${rowId}/${id}`
          )
        )
      } catch {
        // A cover the thumbnail maker cannot read is served as it is.
        return response
      }
    }
  }
  const images = names.filter(imageMime)
  const named = images.filter((name) => /^(cover|folder|front|artist)\.[^.]+$/i.test(name))
  const name = named.length === 1 ? named[0] : images[0]
  if (!name) return new globalThis.Response(null, { status: 404 })
  const id = await serveFile(ex, row, rowId, name, imageMime(name))
  if (wantsFull(request)) return ex.stream(rowId, id, request)
  const small = await ex.stream(rowId, id, request, true)
  // A picture the thumbnail maker cannot read is served as it is.
  return small.ok ? small : ex.stream(rowId, id, request)
}
