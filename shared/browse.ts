import { fieldValue, type FolderRow, type Project } from './model'
import { cellField, groupValue } from './cells'
import { readDate } from './fields'
import type { BrowseMode } from './explorer'
export const pathKey = (p: string) => p.replace(/\\/g, '/').replace(/\/$/, '').toLocaleLowerCase()
export const parentPath = (p: string) => p.replace(/[\\/][^\\/]+[\\/]?$/, '')
export const cardDisplay = (p: Project): NonNullable<Project['cardView']> => {
  const view = p.cardView ?? {
    mode: p.depth.mode === 'exact' ? 'single' : 'multi',
    level: p.scanAll ? 'all' : p.depth.level,
  }
  // A project that only scans one exact level keeps its old view (its middle levels are not rows to walk through).
  return { ...view, works: view.works ?? (view.mode === 'multi' && p.depth.mode !== 'exact') }
}
export const maxBrowseDepth = (rows: FolderRow[]) =>
  rows.reduce(
    (depth, row) =>
      !row.readonly && (row.record || row.error || row.stopped)
        ? Math.max(depth, row.depth)
        : depth,
    1
  )
export function folderBreadcrumbs(rows: FolderRow[], root: string, target: string) {
  const rootKey = pathKey(root),
    targetKey = pathKey(target)
  if (targetKey !== rootKey && !targetKey.startsWith(rootKey + '/'))
    return rows.filter((r) => pathKey(r.path) === rootKey).slice(0, 1)
  return [
    ...new Map(
      rows
        .filter((r) => {
          const key = pathKey(r.path)
          return (
            (key === rootKey || key.startsWith(rootKey + '/')) &&
            (key === targetKey || targetKey.startsWith(key + '/'))
          )
        })
        .map((r) => [pathKey(r.path), r])
    ).values(),
  ].sort((a, b) => a.depth - b.depth)
}
export function browserRows(
  rows: FolderRow[],
  project: Project,
  root: string,
  mode: BrowseMode,
  location: string
) {
  const display = cardDisplay(project)
  const known = rows.filter((r) => !r.readonly && (r.record || r.error || r.stopped))
  if (mode === 'TREE') return known
  if (mode === 'CARD' && display.works) {
    // The walk goes through folders without a record too, so their subfolders are still reached; only folders that
    // can be shown are listed.
    const shown = new Set(known.map((r) => r.rowId))
    // Like the old multi view, the whole project is the scope: opening a folder does not narrow the list.
    return worksBelow(
      rows.filter((r) => !r.readonly),
      root,
      display.level === 'all' ? Infinity : display.level
    ).filter((r) => shown.has(r.rowId))
  }
  if (mode === 'TABLE' || (mode === 'CARD' && display.mode === 'single' && location)) {
    const children = rows.filter((r) => pathKey(parentPath(r.path)) === pathKey(location || root))
    // A folder without subfolders shows its own card instead of an empty page.
    if (mode === 'CARD' && !children.length)
      return rows.filter((r) => pathKey(r.path) === pathKey(location || root))
    return children
  }
  if (display.mode === 'single') {
    // Landing on level 1 means the project root, which alone would be one lone card: show its folders.
    const level =
      display.level === 1 && known.some((r) => r.depth === 2) ? 2 : (display.level as number)
    return known.filter((r) => r.depth === level)
  }
  return known.filter((r) => display.level === 'all' || r.depth <= display.level)
}

export function treeStructure(rows: FolderRow[]) {
  const byPath = new Map(rows.map((r) => [pathKey(r.path), r.rowId])),
    children = new Map<string, FolderRow[]>(),
    roots: FolderRow[] = []
  for (const row of rows) {
    const parent = byPath.get(pathKey(parentPath(row.path)))
    if (parent && parent !== row.rowId) {
      const list = children.get(parent) ?? []
      list.push(row)
      children.set(parent, list)
    } else roots.push(row)
  }
  return { children, roots }
}
export function defaultTreeCollapsed(rows: FolderRow[]) {
  const { children, roots } = treeStructure(rows),
    rootIds = new Set(roots.map((r) => r.rowId))
  return [...children.keys()].filter(
    (id) => !rootIds.has(id) || (children.get(id)?.length ?? 0) > 200
  )
}
export function visibleTreeRows(rows: FolderRow[], collapsed: string[]) {
  const { children, roots } = treeStructure(rows),
    hidden = new Set(collapsed),
    visible: FolderRow[] = [],
    queue = [...roots]
  for (let i = 0; i < queue.length; i++) {
    const row = queue[i]
    visible.push(row)
    if (!hidden.has(row.rowId)) for (const child of children.get(row.rowId) ?? []) queue.push(child)
  }
  return visible
}

// R-467: the sort is a list of up to five keys; rows equal on every key are ordered by name. Empty values go last in
// either direction, remaining ties keep a stable order by row identity. `first` (folders first) puts the rows it
// picks before the others, each part sorted the same way.
export type SortKey = { field: string; asc: boolean }
export const MAX_SORT_KEYS = 5
export function sortRows(
  rows: FolderRow[],
  sort: SortKey | SortKey[],
  locale: string,
  value: (row: FolderRow, field: string) => unknown = fieldValue,
  first?: (row: FolderRow) => boolean
) {
  const keys = (Array.isArray(sort) ? sort : [sort]).slice(0, MAX_SORT_KEYS)
  const get = (r: FolderRow, field: string) =>
    field === 'name'
      ? r.name
      : field === 'path'
        ? r.path
        : field === 'depth'
          ? r.depth
          : value(r, field)
  const compare = (av: unknown, bv: unknown, asc: boolean) => {
    const empty = (v: unknown) => v == null || v === ''
    if (empty(av) || empty(bv)) return empty(av) ? (empty(bv) ? 0 : 1) : -1
    return (
      (typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), locale, { numeric: true })) * (asc ? 1 : -1)
    )
  }
  const order = [
    ...keys,
    ...(keys.some((k) => k.field === 'name') ? [] : [{ field: 'name', asc: true }]),
  ]
  const marked = first ? new Map(rows.map((r) => [r.rowId, first(r)])) : undefined
  return [...rows].sort((a, b) => {
    if (marked) {
      const am = marked.get(a.rowId),
        bm = marked.get(b.rowId)
      if (am !== bm) return am ? -1 : 1
    }
    for (const key of order) {
      const result = compare(get(a, key.field), get(b, key.field), key.asc)
      if (result) return result
    }
    return a.rowId.localeCompare(b.rowId)
  })
}

// The sort keys a click on a table header leaves (R-467): a plain click sorts by that column alone (again: the other
// direction); Shift adds it as the next key, or turns a key already in the list around.
export function headerSort(keys: SortKey[], field: string, add: boolean): SortKey[] {
  const at = keys.findIndex((k) => k.field === field)
  if (add) {
    if (at >= 0) return keys.map((k, i) => (i === at ? { ...k, asc: !k.asc } : k))
    return keys.length >= MAX_SORT_KEYS ? keys : [...keys, { field, asc: true }]
  }
  return [{ field, asc: keys.length === 1 && at === 0 ? !keys[0].asc : true }]
}

// The sort choices in the menu: rating, release date and name first, then the rest in column order.
const RATING = /評分|評価|评分|rating|score|puntuaci/i,
  RELEASE = /發售|発売|发售|發行|发行|release|lanzamiento/i
export function sortChoices<T extends { id: string; label: string }>(columns: T[]): T[] {
  const rank = (c: T) =>
    RATING.test(c.label) ? 0 : RELEASE.test(c.label) ? 1 : c.id === 'name' ? 2 : 3
  return columns
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
    .map(({ c }) => c)
}

// A card component with fallback fields also gets a table column: it shows, and sorts by, the first field in the
// component's order that has a value (so a title from DLsite fills in where the Steam title is missing).
const FALLBACK_COLUMN = 'cell:'
export function fallbackColumns(project: Project) {
  return project.cells
    .filter((cell) => cell.attributeId && cell.fallbackIds?.length)
    .map((cell) => ({ id: FALLBACK_COLUMN + cell.cellId, attributeId: cell.attributeId! }))
}
// Each field group is a column too, showing (and sorting by) what the group shows for that folder.
const GROUP_COLUMN = 'group:'
export function groupColumns(project: Project) {
  return (project.fieldGroups ?? []).map((group) => ({
    id: GROUP_COLUMN + group.groupId,
    label: group.name,
  }))
}
export function columnValue(project: Project, row: FolderRow, id: string): unknown {
  if (id.startsWith(GROUP_COLUMN)) {
    const group = project.fieldGroups?.find((g) => GROUP_COLUMN + g.groupId === id)
    return group ? groupValue(project, group, row).value : undefined
  }
  if (!id.startsWith(FALLBACK_COLUMN)) {
    const value = fieldValue(row, id),
      type = project.fieldBindings.find((f) => f.attributeId === id)?.type
    // A date field shows and sorts text it can read as a date (R-240).
    return type === 'date' || type === 'datetime' ? (readDate(value, type) ?? value) : value
  }
  const cell = project.cells.find((c) => FALLBACK_COLUMN + c.cellId === id)
  return cell ? cellField(cell, row, project).value : undefined
}

// R-340: "all works" — each branch below a folder is followed down to its first work, which is shown and not entered;
// folders that only hold other folders (collections) are passed through. A folder marked by hand wins; then a game
// (or a possible one), a folder that holds media of its own, a series of volumes, and any folder
// without subfolders. maxDepth limits how far below the starting folder to look.
type Contents = NonNullable<FolderRow['contents']>
const holdsMedia = (c: Contents | undefined) =>
  !!c && (c.images >= 3 || c.videos >= 1 || c.audio >= 2 || c.texts >= 1 || c.comics >= 1)
// Volumes of one series: two or more subfolders, every one a leaf of pictures, and nearly all named with a number.
const numbered = /\d|[一二三四五六七八九十]+[巻卷話话集冊册]|vol/i
function isSeries(children: FolderRow[], kids: Map<string, FolderRow[]>) {
  return (
    children.length >= 2 &&
    children.every(
      (child) => !kids.get(child.rowId)?.length && (child.contents?.images ?? 0) >= 3
    ) &&
    children.filter((child) => numbered.test(child.name)).length >= children.length * 0.8
  )
}
export function isWork(row: FolderRow, kids: Map<string, FolderRow[]>) {
  const mark = row.record?.details?.browseAs
  if (mark) return mark === 'work'
  if (row.boundary || row.record?.details?.boundary?.state) return true
  if (row.record?.details?.kind && row.record.details.kind !== 'general') return true
  if (holdsMedia(row.contents)) return true
  const children = kids.get(row.rowId) ?? []
  return !children.length || isSeries(children, kids)
}
export function worksBelow(rows: FolderRow[], start: string, maxDepth: number) {
  const { children } = treeStructure(rows),
    startKey = pathKey(start),
    top = rows.filter(
      (r) => pathKey(r.path) !== startKey && pathKey(parentPath(r.path)) === startKey
    ),
    found: FolderRow[] = []
  const visit = (row: FolderRow, level: number) => {
    const below = children.get(row.rowId) ?? []
    if (isWork(row, children) || level >= maxDepth || !below.length) found.push(row)
    else for (const child of below) visit(child, level + 1)
  }
  for (const row of top) visit(row, 1)
  return found
}
