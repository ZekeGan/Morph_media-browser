import type { Cell } from './modelTypes'

// Card grid sizes in px (R-398); they match `.card-grid` in src/styles/style.css.
export const CARD_ROW = 42
export const CARD_GAP = 4
export const MAX_GROW_ROWS = 20

// Components whose content can be taller than their cell: long text, tags, layout text, and the wrapping name and path.
export const GROW_KINDS: Cell['kind'][] = [
  'field-text',
  'field-tags',
  'static-text',
  'name',
  'path',
]

// How many grid rows a content `px` tall (padding and border included) needs; up to 1px of overflow is tolerated.
export function rowsFor(px: number): number {
  return Math.max(1, Math.ceil((px - 1 + CARD_GAP) / (CARD_ROW + CARD_GAP)))
}

export type Placed = { cell: Cell; y: number; h: number }

// Where each shown component of a card sits (R-398), in `cells` order. Two rules, both from the saved grid:
// - A row in which components are hidden and none is left shows nothing, so it is removed and what is below moves up.
//   A row that never held a component is deliberate spacing and stays.
// - A component with `growMax` takes `needed[cellId]` rows when its content is taller than its own height (at most
//   `growMax` more); components below it, in the columns it covers, move down by the same number of rows.
export function placeCells(
  cells: Cell[],
  visible: (cell: Cell) => boolean,
  needed: Record<string, number> = {}
): Placed[] {
  const shown = new Set(cells.filter(visible).map((cell) => cell.cellId))
  const rowsOf = (cell: Cell) => Array.from({ length: cell.grid.h }, (_, i) => cell.grid.y + i)
  const held = new Set<number>()
  const emptied = new Set<number>()
  for (const cell of cells) {
    for (const row of rowsOf(cell)) (shown.has(cell.cellId) ? held : emptied).add(row)
  }
  const removed = [...emptied].filter((row) => !held.has(row)).sort((a, b) => a - b)
  const up = (y: number) => removed.filter((row) => row < y).length
  const items = cells
    .filter((cell) => shown.has(cell.cellId))
    .map((cell) => ({
      cell,
      y: cell.grid.y - up(cell.grid.y),
      extra: cell.growMax
        ? Math.min(Math.max((needed[cell.cellId] ?? 0) - cell.grid.h, 0), cell.growMax)
        : 0,
      push: 0,
    }))
  // Top to bottom, so every component above is settled before one below it asks how far to move.
  for (const item of [...items].sort((a, b) => a.y - b.y)) {
    for (const above of items) {
      if (
        above !== item &&
        above.y + above.cell.grid.h <= item.y &&
        above.cell.grid.x < item.cell.grid.x + item.cell.grid.w &&
        item.cell.grid.x < above.cell.grid.x + above.cell.grid.w
      ) {
        item.push = Math.max(item.push, above.push + above.extra)
      }
    }
  }
  const placed = new Map(
    items.map((item) => [
      item.cell.cellId,
      { cell: item.cell, y: item.y + item.push, h: item.cell.grid.h + item.extra },
    ])
  )
  return cells.flatMap((cell) => placed.get(cell.cellId) ?? [])
}
