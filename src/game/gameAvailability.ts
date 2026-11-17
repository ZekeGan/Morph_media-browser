import { useEffect, useState } from 'react'
import type { GameAvailability } from '../../shared/explorer'
import type { FolderRow } from '../../shared/model'
import { useRefreshNonce } from '../browse/refresh'

// R-409: whether a game's extra buttons (Steam, store, save folder) can be used, asked only for cards on screen. The
// cards that come into view together are asked in one request (at most 60 at a time); answers are kept in memory for
// the folder's record revision and dropped when the window is refreshed (which also rescans).
const cache = new Map<string, GameAvailability | null>(),
  waiting = new Map<string, Set<() => void>>()
let queue: string[] = [],
  timer: ReturnType<typeof setTimeout> | undefined,
  generation = 0,
  seenNonce = 0
const keyOf = (row: FolderRow) => row.rowId + '@' + (row.record?.revision ?? 0)

function flush() {
  timer = undefined
  const keys = queue.splice(0, 60),
    asked = generation
  if (queue.length) timer = setTimeout(flush, 0)
  const ids = keys.map((key) => key.slice(0, key.lastIndexOf('@')))
  void window.explorer
    .request({ action: 'gameAvailability', rowIds: ids })
    .then((result) => result.availability ?? {})
    .catch(() => ({}) as Record<string, GameAvailability>)
    .then((answers) => {
      if (asked !== generation) return
      keys.forEach((key, i) => {
        cache.set(key, answers[ids[i]] ?? null)
        for (const done of waiting.get(key) ?? []) done()
        waiting.delete(key)
      })
    })
}
function ask(key: string, done: () => void) {
  const callbacks = waiting.get(key)
  if (callbacks) {
    callbacks.add(done)
    return
  }
  waiting.set(key, new Set([done]))
  queue.push(key)
  timer ??= setTimeout(flush, 30)
}

// `visible` is whether the card is on screen; nothing is asked before it is. Undefined until the answer comes.
export function useGameAvailability(row: FolderRow | undefined, visible: boolean) {
  const nonce = useRefreshNonce()
  const [, setTick] = useState(0)
  // The first card to see a new refresh drops what was known before; the others find it dropped.
  if (nonce !== seenNonce) {
    seenNonce = nonce
    cache.clear()
    waiting.clear()
    queue = []
    generation++
  }
  const key = row?.record ? keyOf(row) : undefined
  useEffect(() => {
    if (!key || !visible || cache.has(key)) return
    let alive = true
    ask(key, () => alive && setTick((n) => n + 1))
    return () => {
      alive = false
    }
  }, [key, visible, nonce])
  return key ? cache.get(key) : undefined
}
