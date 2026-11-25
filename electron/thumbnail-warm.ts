import fs from 'node:fs/promises'
import path from 'node:path'
import { exists } from './files'
import { folderFiles, imageMime, serveFile } from './explorer-content'
import { THUMB_CACHE_FILES, thumbCachePath } from './explorer-stream'
import type { Explorer } from './explorer'

// R-505: while the window is idle, the pictures of the folders it lists get their thumbnails made in the background,
// so opening one of them shows its pictures at once. Only the first pictures of each folder, one thumbnail at a time,
// and only while no thumbnail the window asked for is waiting or being made. A new request replaces the old one; an
// empty list just stops it (the window sends one as soon as the user does anything).
export const WARM_FOLDERS = 60,
  WARM_PER_FOLDER = 48,
  // A folder the scan counted this many files in is left alone (listing it is slow, and it is rarely browsed whole).
  WARM_MAX_FILES = 5000,
  // With this many thumbnails kept, warming stops, so it never pushes out ones the user has looked at.
  WARM_CACHE_FULL = Math.floor(THUMB_CACHE_FILES * 0.6)

export function warmThumbnails(ex: Explorer, rowIds: string[]) {
  if (!Array.isArray(rowIds) || rowIds.length > 100 || rowIds.some((id) => typeof id !== 'string'))
    throw new Error('縮圖預備範圍不合法')
  ex.warming?.abort()
  ex.warming = undefined
  if (!rowIds.length) return
  const control = new AbortController()
  ex.warming = control
  void warm(ex, rowIds.slice(0, WARM_FOLDERS), control.signal)
    .catch(() => {})
    .finally(() => {
      if (ex.warming === control) ex.warming = undefined
    })
}

// Resolves when nothing the window asked for is waiting or being made (checked a few times a second).
async function foregroundIdle(ex: Explorer, signal: AbortSignal) {
  while (!signal.aborted && (ex.thumbnailQueue.length || ex.thumbnailActive))
    await new Promise((resolve) => setTimeout(resolve, 250))
}

async function warm(ex: Explorer, rowIds: string[], signal: AbortSignal) {
  const cache = path.join(ex.root, 'thumbnails')
  const kept = await fs.readdir(cache).catch(() => [])
  if (kept.length >= WARM_CACHE_FULL) return
  for (const rowId of rowIds) {
    // A folder done earlier in this session is not listed again when warming restarts after an interruption.
    if (signal.aborted) return
    if (ex.warmed.has(rowId)) continue
    let names: string[]
    let row: Awaited<ReturnType<Explorer['library']['readableRow']>>
    try {
      // The same checks as opening the folder: a folder the window may not read is skipped.
      row = await ex.library.readableRow(rowId)
      if ((row.contents?.total ?? 0) > WARM_MAX_FILES) continue
      names = (await folderFiles(row)).filter(imageMime).slice(0, WARM_PER_FOLDER)
    } catch {
      continue
    }
    for (const name of names) {
      await foregroundIdle(ex, signal)
      if (signal.aborted) return
      try {
        const id = await serveFile(ex, row, rowId, name, imageMime(name)),
          entry = await ex.file(rowId, id),
          thumb = await thumbCachePath(ex, entry)
        if (await exists(thumb)) continue
        await ex.thumbnail(
          thumb,
          entry.file,
          entry.mime,
          entry.stat.size,
          signal,
          `media://file/${rowId}/${id}`
        )
      } catch {
        // A picture that cannot be made now is left for when it is opened.
      }
    }
    if (signal.aborted) return
    if (ex.warmed.size >= 5000) ex.warmed.clear()
    ex.warmed.add(rowId)
  }
}
