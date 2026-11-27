// R-501: every snapshot from main arrives as new objects, even for folders and projects that did not change (opening
// a folder re-reads its record). Keeping the objects that are the same lets memoized cards skip drawing again.

import { sameData } from '../../shared/sameData'

export { sameData }

// The next list with each item that equals the previous one (same id) replaced by that previous object; the
// previous list itself when nothing changed at all.
export function keepUnchanged<T>(
  previous: T[] | undefined,
  next: T[] | undefined,
  id: (item: T) => string
): T[] | undefined {
  if (!previous || !next) return next
  const before = new Map(previous.map((item) => [id(item), item]))
  let changed = previous.length !== next.length
  const kept = next.map((item, index) => {
    const old = before.get(id(item))
    const result = old !== undefined && sameData(old, item) ? old : item
    if (result !== previous[index]) changed = true
    return result
  })
  return changed ? kept : previous
}
