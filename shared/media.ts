import type { MediaEntry } from './explorer'
import type { FolderRow } from './model'

export type MediaFilter = 'all' | 'image' | 'video' | 'audio' | 'other'

// R-457: a folder confirmed as a tool keeps its protection but is not a game.
export const isToolFolder = (row: FolderRow) =>
  row.record?.details?.boundary?.state === 'root' && row.record.details.boundary.role === 'tool'

export const isGameFolder = (row: FolderRow) =>
  row.record?.details?.boundary?.state !== 'not-game' &&
  !isToolFolder(row) &&
  !!(row.boundary || ['root', 'candidate'].includes(row.record?.details?.boundary?.state ?? ''))

// R-485: files with the system Hidden／System attribute are never listed; names starting with a dot always are.
export const visibleFile = (entry: MediaEntry) => !entry.hidden

export const matchesMedia = (entry: MediaEntry, filter: MediaFilter) =>
  entry.kind !== 'folder' &&
  (filter === 'all' ||
    (filter === 'other'
      ? !['image', 'video', 'audio'].includes(entry.kind)
      : entry.kind === filter))

export const canPreviewMedia = (entry: MediaEntry) =>
  ['image', 'video', 'audio', 'pdf', 'archive', 'text'].includes(entry.kind)

export const mediaIdentity = (entry: MediaEntry) =>
  'rowId' in entry ? String(entry.rowId) + '/' + entry.id : entry.id

// Queue identity and order are inherited from the displayed direct-folder results.
export const mediaQueue = (entries: MediaEntry[], selected: MediaEntry) =>
  entries.filter((entry) => entry.kind === selected.kind && canPreviewMedia(entry))

// R-486: the file list's sort, one field and a direction. Without one the files stay in the order they are listed.
export type MediaSortField = 'name' | 'kind' | 'size' | 'modified'

export interface MediaSort {
  field: MediaSortField
  asc: boolean
}

export const mediaSortFields: MediaSortField[] = ['name', 'kind', 'size', 'modified']
const names = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' })

// Files that tie on the field are ordered by name (natural: 2 before 10), then by id; an empty size or date goes last.
export function sortMedia<T extends MediaEntry>(entries: T[], sort: MediaSort): T[] {
  const sign = sort.asc ? 1 : -1
  return [...entries].sort((a, b) => {
    let by = 0
    if (sort.field === 'name') by = names.compare(a.name, b.name) * sign
    else if (sort.field === 'kind') by = a.kind.localeCompare(b.kind) * sign
    else {
      const av = (sort.field === 'size' ? a.size : a.modified) || 0
      const bv = (sort.field === 'size' ? b.size : b.modified) || 0
      if (!av !== !bv) return !av ? 1 : -1
      by = (av - bv) * sign
    }
    return by || names.compare(a.name, b.name) || a.id.localeCompare(b.id)
  })
}
