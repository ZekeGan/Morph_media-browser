import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { FolderRow } from '../../shared/model'

// What the gestures need from the browse view, read when a gesture happens (so the view may define these later in
// its body than where it calls the hook).
export interface MarkContext {
  // The folders in the order shown, for Shift+click ranges.
  current: FolderRow[]
  highlight?: string
  setHighlight: (id: string) => void
  open: (id: string) => void
  openConfig: (id: string) => void
  clearSelection: () => void
}

// R-243: the folders marked for a batch and the click, double-click, context-menu and key gestures of a folder in
// the CARD, TABLE and TREE lists. Ctrl/Cmd+click marks folders one by one, Shift+click marks a range; a plain click
// clears the marks.
export function useFolderMarks(context: () => MarkContext) {
  const [marked, setMarked] = useState<string[]>([])
  const anchor = useRef<string>(undefined),
    clearTimer = useRef<number | undefined>(undefined)
  const cancelClear = () => {
    window.clearTimeout(clearTimer.current)
    clearTimer.current = undefined
  }
  useEffect(() => cancelClear, [])
  const gestures = (id: string) => ({
    onClick: (e: MouseEvent) => {
      const { current, highlight, setHighlight, clearSelection } = context()
      cancelClear()
      if (e.ctrlKey || e.metaKey) {
        anchor.current = id
        setMarked((now) => (now.includes(id) ? now.filter((m) => m !== id) : [...now, id]))
        return
      }
      const from = current.findIndex((r) => r.rowId === anchor.current),
        to = current.findIndex((r) => r.rowId === id)
      if (e.shiftKey && from >= 0 && to >= 0) {
        setMarked(current.slice(Math.min(from, to), Math.max(from, to) + 1).map((r) => r.rowId))
        return
      }
      anchor.current = id
      // Clicking the selected folder again clears the selection, but only after the double-click time passes
      // without a second click; a second click or the double click cancels the timer and enters the folder.
      if (e.detail === 1 && highlight === id && !marked.length) {
        clearTimer.current = window.setTimeout(() => {
          clearTimer.current = undefined
          clearSelection()
        }, 300)
        return
      }
      if (marked.length) setMarked([])
      setHighlight(id)
    },
    onDoubleClick: () => {
      cancelClear()
      context().open(id)
    },
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      context().openConfig(id)
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        context().open(id)
      }
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault()
        context().openConfig(id)
      }
    },
  })
  // `cancelClear` also lets entering a folder win over a pending "clear the selection" from a click.
  return { marked, setMarked, gestures, cancelClear }
}
