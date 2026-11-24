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
