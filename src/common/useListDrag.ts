import { type DragEvent, useState } from 'react'

// R-480: drag a row by its grip to reorder a list. The row under the pointer shows a line on its top or bottom edge
// (whichever half the pointer is in) where the dragged row will land; nothing shows where dropping changes nothing.
// Used by the sort menu and the source language list; the keyboard moves rows with Alt+↑／↓ on the grip instead.
export function useListDrag(onMove: (from: number, to: number) => void, disabled = false) {
  const [drag, setDrag] = useState<number>()
  const [over, setOver] = useState<{ index: number; after: boolean }>()
  const reset = () => {
    setDrag(undefined)
    setOver(undefined)
  }
  // The slot the row would be inserted at (0 = before the first row), and the index it ends up at after the move.
  const slot = over ? over.index + (over.after ? 1 : 0) : undefined
  const target =
    slot === undefined || drag === undefined ? undefined : slot > drag ? slot - 1 : slot
  const mark = (index: number) =>
    over?.index === index && drag !== undefined && target !== drag
      ? over.after
        ? ' drop-after'
        : ' drop-before'
      : ''
  return {
    // Spread on the <ol>: leaving the list clears the line.
    list: {
      onDragLeave: (e: DragEvent<HTMLElement>) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(undefined)
      },
    },
    // Spread on each <li>; `className` is the extra classes the row needs.
    row: (index: number) => ({
      className: (drag === index ? ' dragging' : '') + mark(index),
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (drag === undefined) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        const box = e.currentTarget.getBoundingClientRect()
        const after = e.clientY > box.top + box.height / 2
        if (over?.index !== index || over.after !== after) setOver({ index, after })
      },
      onDrop: (e: DragEvent<HTMLElement>) => {
        e.preventDefault()
        if (drag !== undefined && target !== undefined) onMove(drag, target)
        reset()
      },
    }),
    // Spread on the grip button.
    grip: (index: number) => ({
      draggable: !disabled,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        e.dataTransfer.setData('text/plain', String(index))
        e.dataTransfer.effectAllowed = 'move'
        setDrag(index)
      },
      onDragEnd: reset,
    }),
  }
}
