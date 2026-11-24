import { fmt } from '../shared/message'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { safePath } from './files'
import { DATA_DIR } from '../shared/model'
import { type ContentResult, type MediaEntry } from '../shared/explorer'
import { hiddenFileNames } from './hidden'
import { imageTypes } from '../shared/images'
import { mediaNames, mediaTypes as types } from './media-files'
import type { Explorer } from './explorer'

export async function content(
  ex: Explorer,
  rowId: string,
  limit?: number,
  cursor?: string
): Promise<ContentResult> {
  if (
    (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 500)) ||
    (cursor !== undefined &&
      (typeof cursor !== 'string' || cursor.length > 150 || limit === undefined))
  )
    throw new Error('內容分批設定不合法')
  const row = await ex.library.readableRow(rowId),
    notices: string[] = [],
    entries: MediaEntry[] = []
  let offset = 0,
    token = '',
    names: string[],
    hidden = new Set<string>()
  for (const [id, session] of ex.contentPages)
    if (session.expires < Date.now()) ex.contentPages.delete(id)
  if (cursor) {
    const match = /^([\w-]+):(\d+)$/.exec(cursor),
      session = match && ex.contentPages.get(match[1])
    offset = Number(match?.[2])
    if (
      !session ||
      session.rowId !== rowId ||
      session.path !== row.path ||
      session.folderId !== row.record?.folderId ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= session.names.length
    )
      throw new Error('資料夾內容批次已失效，請重新開啟資料夾')
    hidden = session.hidden
    names = session.names
    token = match![1]
    session.expires = Date.now() + 120000
  } else {
    try {
      hidden = await hiddenFileNames(row.path)
    } catch (error) {
      notices.push(fmt('無法確認隱藏屬性：{0}', String(error)))
    }
    names = (await fs.readdir(row.path, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.name.toLowerCase() !== DATA_DIR &&
          !entry.isSymbolicLink() &&
          (entry.isFile() || entry.isDirectory())
      )
      .map((entry) => entry.name)
      .sort((a, b) => mediaNames.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0))
    if (limit && names.length > limit) {
      while (ex.contentPages.size >= 8) ex.contentPages.delete(ex.contentPages.keys().next().value!)
      token = randomUUID()
      ex.contentPages.set(token, {
        rowId,
        path: row.path,
        folderId: row.record?.folderId,
        names,
        hidden,
        expires: Date.now() + 120000,
      })
    }
  }
  const batch = names.slice(offset, limit ? offset + limit : undefined)
  for (let start = 0; start < batch.length; start += 16)
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
          const id = createHash('sha256').update(name).digest('hex'),
            url = `media://file/${rowId}/${id}`
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
              ? { thumb: `media://thumb/${rowId}/${id}?v=${stat.size}-${stat.mtimeMs}` }
              : {}),
          })
        } catch (e) {
          notices.push(`${name}: ${String(e)}`)
        }
      })
    )
  entries.sort(
    (a, b) => mediaNames.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  )
  const next = offset + batch.length,
    complete = next >= names.length
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
    ...(limit
      ? {
          total: names.length + (row.record?.details?.subtitles?.length ?? 0),
          ...(!complete ? { nextCursor: token + ':' + next } : {}),
        }
      : {}),
  }
}

export async function file(ex: Explorer, rowId: string, id: string) {
  const row = await ex.library.readableRow(rowId),
    entry = ex.files.get(`${rowId}/${id}`)
  if (!entry || entry.rowId !== rowId) throw new Error('媒體不存在或需重新載入')
  await safePath(row.path, entry.file)
  if (!entry.portable && path.dirname(entry.file) !== row.path)
    throw new Error('媒體超出直接內容範圍')
  if (
    entry.portable &&
    !row.record?.details?.subtitles?.some(
      (s) => path.join(row.path, DATA_DIR, s.relativePath) === entry.file
    )
  )
    throw new Error('字幕不屬於此記錄')
  const stat = await fs.stat(entry.file)
  if (!stat.isFile()) throw new Error('不是檔案')
  return { ...entry, stat, row }
}

// The n-th image file (by name) directly inside the folder, as a thumbnail; used by image cells that pick by position.
// The files directly inside a folder, in reading order: not hidden, not links.
async function folderFiles(row: { path: string }) {
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
async function serveFile(
  ex: Explorer,
  row: { path: string },
  rowId: string,
  name: string,
  mime: string
) {
  const file = path.join(row.path, name),
    id = createHash('sha256').update(name).digest('hex')
  await safePath(row.path, file)
  ex.files.set(`${rowId}/${id}`, { rowId, name, file, mime })
  return id
}
const imageMime = (name: string) => imageTypes[path.extname(name).slice(1).toLowerCase()]

export async function nthImage(
  ex: Explorer,
  rowId: string,
  index: number,
  request: globalThis.Request
): Promise<globalThis.Response> {
  if (!Number.isInteger(index) || index < 1 || index > 999)
    return new globalThis.Response(null, { status: 404 })
  const row = await ex.library.readableRow(rowId)
  const name = (await folderFiles(row)).filter(imageMime)[index - 1]
  if (!name) return new globalThis.Response(null, { status: 404 })
  return ex.stream(rowId, await serveFile(ex, row, rowId, name, imageMime(name)), request, true)
}

// R-437: the one rule for a folder's cover, whatever its kind, shared by the card and the right panel: the picture
// chosen as cover, else the first picture of the record that is not a source extra, else (when the folder holds audio)
// the first track's embedded cover, else the one image named cover, folder, front or artist, else the first image file.
export async function folderCover(
  ex: Explorer,
  rowId: string,
  request: globalThis.Request
): Promise<globalThis.Response> {
  const row = await ex.library.readableRow(rowId),
    assets = row.record?.assets ?? [],
    chosen =
      assets.find((a) => a.assetId === row.record?.details?.bannerAssetId) ??
      assets.find((a) => !a.role)
  if (chosen)
    try {
      const { file, mediaType } = await ex.library.asset(rowId, chosen.assetId)
      return new globalThis.Response(new Uint8Array(await fs.readFile(file)), {
        headers: { 'Content-Type': mediaType, 'X-Content-Type-Options': 'nosniff' },
      })
    } catch {
      // A picture whose file is gone: the next rule decides.
    }
  const names = await folderFiles(row),
    track = names.find((name) => types[path.extname(name).toLowerCase()]?.[0] === 'audio'),
    // A track gone since the listing: the next rule decides.
    stat = track && (await fs.stat(path.join(row.path, track)).catch(() => undefined))
  if (track && stat) {
    const id = await serveFile(ex, row, rowId, track, types[path.extname(track).toLowerCase()][1])
    // R-455: the embedded cover as a small picture, kept with the other thumbnails, so a page of album cards does
    // not hold every full-size cover. Made from the track as it is now (its size and time are in the name).
    const cache = path.join(ex.root, 'thumbnails'),
      small = path.join(
        cache,
        createHash('sha256')
          .update(`${path.join(row.path, track)}/${stat.size}/${stat.mtimeMs}/audio-cover`)
          .digest('hex') + '.jpg'
      )
    await safePath(ex.root, small)
    const jpeg = (bytes: Uint8Array) =>
      new globalThis.Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': 'image/jpeg', 'X-Content-Type-Options': 'nosniff' },
      })
    const cached = await fs.readFile(small).catch(() => undefined)
    if (cached?.length) return jpeg(cached)
    const response = await ex.audioCover(rowId, id, request.signal)
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
  const images = names.filter(imageMime),
    named = images.filter((name) => /^(cover|folder|front|artist)\.[^.]+$/i.test(name)),
    name = named.length === 1 ? named[0] : images[0]
  if (!name) return new globalThis.Response(null, { status: 404 })
  const id = await serveFile(ex, row, rowId, name, imageMime(name)),
    small = await ex.stream(rowId, id, request, true)
  // A picture the thumbnail maker cannot read is served as it is.
  return small.ok ? small : ex.stream(rowId, id, request)
}
