import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import type { FolderFacts } from '../../shared/explorer'

// R-438: what a card says about an album or video folder, asked of main for the cards that are on screen. Asks are
// gathered for a moment and sent together (at most 60 folders), answers are kept in memory, and a length that is not
// there yet is asked for again a few times while the card stays visible.
const cache = new Map<string, FolderFacts>()
const listeners = new Map<string, Set<() => void>>()
const pending = new Set<string>()
const retries = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | undefined
const notify = (rowId: string) => {
  for (const listener of listeners.get(rowId) ?? []) listener()
}
async function send() {
  timer = undefined
  const ids = [...pending].slice(0, 60)
  ids.forEach((id) => pending.delete(id))
  if (pending.size) timer = setTimeout(() => void send(), 50)
  if (!ids.length) return
  try {
    const result = await window.explorer.request({ action: 'folderFacts', rowIds: ids })
    for (const id of ids) {
      const facts = result.folderFacts?.[id]
      if (facts) {
        cache.set(id, facts)
        if (cache.size > 5000) cache.delete(cache.keys().next().value!)
        notify(id)
        // The length is filled in behind the scenes; look again a few times.
        if (facts.audio && facts.duration === undefined && (retries.get(id) ?? 0) < 4) {
          retries.set(id, (retries.get(id) ?? 0) + 1)
          // Only while a card for it is still there.
          setTimeout(() => listeners.has(id) && ask(id), 4000)
        }
      }
    }
  } catch {
    // The card keeps its dash.
  }
}
function ask(rowId: string) {
  pending.add(rowId)
  timer ??= setTimeout(() => void send(), 100)
}
// The facts of a folder once its card is in view (null while not wanted or not yet known).
export function useFolderFacts(
  rowId: string | undefined,
  ref: RefObject<Element | null>,
  wanted: boolean
) {
  const facts = useSyncExternalStore(
    (callback) => {
      if (!rowId) return () => {}
      let set = listeners.get(rowId)
      if (!set) listeners.set(rowId, (set = new Set()))
      set.add(callback)
      return () => {
        set!.delete(callback)
        if (!set!.size) listeners.delete(rowId)
      }
    },
    () => (rowId ? cache.get(rowId) : undefined)
  )
  const seen = useRef(false)
  useEffect(() => {
    const element = ref.current
    if (!wanted || !rowId || !element) return
    if (typeof IntersectionObserver === 'undefined') return ask(rowId)
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        if (!seen.current || !cache.has(rowId)) ask(rowId)
        seen.current = true
      }
    })
    watch.observe(element)
    return () => watch.disconnect()
  }, [rowId, wanted, ref])
  return facts
}
