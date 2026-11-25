// Plain data equality (records, snapshots: what is stored as JSON or crosses IPC): the same keys, in any order, and
// equal values all the way down; stops at the first difference.
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const left = a as Record<string, unknown>,
    right = b as Record<string, unknown>,
    keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys)
    if (!Object.hasOwn(right, key) || !sameData(left[key], right[key])) return false
  return true
}
