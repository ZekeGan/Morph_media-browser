import { useSyncExternalStore } from 'react'

import type { MediaEntry } from '../../shared/explorer'
import { type KindSample, sampleOf } from '../../shared/kind'

// R-343: the content sample is kept too, so lists can show what an opened folder turned out to be.
type Stats = { files: number; size: number; updated: number; sample: KindSample }

const cache = new Map<string, Stats>()
const listeners = new Map<string, Set<() => void>>()

export function cacheFolderStats(rowId: string, entries: MediaEntry[]) {
  const files = entries.filter((entry) => entry.kind !== 'folder')
  cache.set(rowId, {
    files: files.length,
    size: files.reduce((sum, entry) => sum + entry.size, 0),
    updated: Date.now(),
    sample: sampleOf(entries),
  })
  if (cache.size > 5000) cache.delete(cache.keys().next().value!)
  for (const listener of listeners.get(rowId) ?? []) listener()
}

export function useFolderStats(rowId: string | undefined) {
  return useSyncExternalStore(
    (callback) => {
      if (!rowId) return () => {}
      let set = listeners.get(rowId)
      if (!set) {
        set = new Set()
        listeners.set(rowId, set)
      }
      set.add(callback)
      return () => {
        set!.delete(callback)
        if (!set!.size) listeners.delete(rowId)
      }
    },
    () => (rowId ? cache.get(rowId) : undefined)
  )
}

export function useFolderSample(rowId: string | undefined) {
  return useFolderStats(rowId)?.sample
}

// The sample of an opened folder, read without subscribing (for a parent's kind, R-404).
export const cachedFolderSample = (rowId: string) => cache.get(rowId)?.sample
