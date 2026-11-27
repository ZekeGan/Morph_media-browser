import { type PointerEvent, useRef } from 'react'

// A width being dragged: the right panel ('panel') or a table column (its id). R-500: while dragging, the width is
// written straight to the page once per frame (the panel's --panel-width, the table's --col-<id>); nothing renders
// again until the drag ends, when `keep` gets the final width once.
export interface WidthDrag {
  id: string
  start: number
  width: number
  // The width being dragged to, the element it is written to, and the frame waiting to write it.
  live?: number
  target?: HTMLElement | null
  frame?: number
}

// R-243: the drag of the right panel's and the table columns' widths, apart from the browse view.
export function useWidthDrag(keep: (id: string, width: number) => void) {
  const resize = useRef<WidthDrag | undefined>(undefined)
  const moveWidth = (e: PointerEvent) => {
    const r = resize.current
    if (!r) return
    r.live =
      r.id === 'panel'
        ? Math.round(Math.max(280, Math.min(1000, r.width + r.start - e.clientX)))
        : Math.round(Math.max(80, Math.min(1000, r.width + e.clientX - r.start)))
    r.target ??= (e.currentTarget as HTMLElement).closest<HTMLElement>(
      r.id === 'panel' ? '.content-panel-slot' : 'table'
    )
    if (r.target && r.id === 'panel') r.target.dataset.resizing = 'true'
    r.frame ??= requestAnimationFrame(() => {
      r.frame = undefined
      if (r.live !== undefined) {
        r.target?.style.setProperty(
          r.id === 'panel' ? '--panel-width' : '--col-' + r.id,
          r.live + 'px'
        )
      }
    })
  }
  const stopWidth = () => {
    const r = resize.current
    resize.current = undefined
    if (!r) return
    if (r.frame !== undefined) cancelAnimationFrame(r.frame)
    if (r.target) {
      if (r.id === 'panel') r.target.dataset.resizing = 'false'
      else r.target.style.removeProperty('--col-' + r.id)
    }
    if (r.live !== undefined) keep(r.id, r.live)
  }
  return { resize, moveWidth, stopWidth }
}
