import { startTransition, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Snapshot } from '../shared/model'
import { keepUnchanged } from './common/keepUnchanged'

const empty: Snapshot = {
  projects: [],
  rows: [],
  problems: [],
  progress: { visited: 0, created: 0, errors: 0, active: false, cancelled: false },
}

// R-243: the library snapshot the window shows, and how a new one from main is taken in.
export function useSnapshot() {
  const [snapshot, setSnapshot] = useState(empty)
  // R-448: the newest snapshot generation taken in (from main), and a reading save's snapshot waiting for an idle
  // moment. A snapshot older than what is shown is never taken in.
  const shownGeneration = useRef(0),
    waiting = useRef<Snapshot | undefined>(undefined)
  const takeSnapshot = (next: Snapshot) => {
    // One without a number (not from main's library) is taken in as it is, leaving the mark where it was.
    if (next.generation !== undefined) {
      if (next.generation <= shownGeneration.current) return
      shownGeneration.current = next.generation
    }
    // R-501: folders and projects that did not change keep their objects, so cards that show them are not drawn again.
    setSnapshot((previous) => ({
      ...next,
      projects: keepUnchanged(previous.projects, next.projects, (p) => p.projectId)!,
      rows: keepUnchanged(previous.rows, next.rows, (r) => r.rowId)!,
      structure: keepUnchanged(previous.structure, next.structure, (r) => r.rowId),
    }))
  }
  // A reading place saved in the background: its snapshot is taken in when the window is idle, newest only.
  const takeLater = (next: Snapshot) => {
    if ((next.generation ?? 0) <= (waiting.current?.generation ?? 0)) return
    const first = !waiting.current
    waiting.current = next
    if (!first) return
    const take = () => {
      const latest = waiting.current
      waiting.current = undefined
      if (latest) startTransition(() => takeSnapshot(latest))
    }
    if ('requestIdleCallback' in window) window.requestIdleCallback(take, { timeout: 3000 })
    else setTimeout(take, 0)
  }
  // Pressing anything outside the novel reader first takes in a waiting snapshot, so an edit made right after
  // reading sends the record's current revision (capture phase: before React's handlers read their props).
  useEffect(() => {
    const flush = (event: Event) => {
      const latest = waiting.current
      if (!latest) return
      if ((event.target as Element | null)?.closest?.('.novel-reader')) return
      waiting.current = undefined
      flushSync(() => takeSnapshot(latest))
    }
    document.addEventListener('pointerdown', flush, true)
    document.addEventListener('keydown', flush, true)
    return () => {
      document.removeEventListener('pointerdown', flush, true)
      document.removeEventListener('keydown', flush, true)
    }
  }, [])
  // Scan progress only replaces the progress part.
  const takeProgress = (progress: Snapshot['progress']) => setSnapshot((s) => ({ ...s, progress }))
  return { snapshot, takeSnapshot, takeLater, takeProgress }
}
