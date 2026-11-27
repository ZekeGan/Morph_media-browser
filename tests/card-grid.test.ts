import assert from 'node:assert/strict'
import { test } from 'node:test'

import { placeCells, rowsFor } from '../shared/cardGrid'
import type { Cell } from '../shared/model'

const cell = (
  cellId: string,
  x: number,
  y: number,
  w: number,
  h: number,
  patch: Partial<Cell> = {}
) =>
  ({
    cellId,
    kind: 'field-text',
    attributeId: 'a',
    grid: { x, y, w, h },
    style: { textColor: '#fff', backgroundColor: 'transparent' },
    ...patch,
  }) as Cell
const all = () => true
const where = (placed: ReturnType<typeof placeCells>) =>
  Object.fromEntries(placed.map((p) => [p.cell.cellId, [p.y, p.h]]))

test('rows needed for a content height', () => {
  assert.equal(rowsFor(0), 1)
  assert.equal(rowsFor(42), 1)
  assert.equal(rowsFor(43), 1)
  assert.equal(rowsFor(44), 2)
  assert.equal(rowsFor(88), 2)
  assert.equal(rowsFor(89), 2)
  assert.equal(rowsFor(90), 3)
})

test('with nothing hidden or growing every component stays where it was saved', () => {
  const cells = [cell('a', 0, 0, 12, 1), cell('b', 0, 2, 6, 2), cell('c', 6, 2, 6, 1)]
  assert.deepEqual(where(placeCells(cells, all)), { a: [0, 1], b: [2, 2], c: [2, 1] })
})

test('a row whose components are all hidden is removed and the rows below move up', () => {
  const cells = [
    cell('a', 0, 0, 12, 1),
    cell('b', 0, 1, 6, 1),
    cell('c', 6, 1, 6, 1),
    cell('d', 0, 2, 12, 1),
  ]
  const placed = placeCells(cells, (c) => !['b', 'c'].includes(c.cellId))
  assert.deepEqual(where(placed), { a: [0, 1], d: [1, 1] })
})

test('a row keeps its place while any component in it is shown', () => {
  const cells = [cell('a', 0, 0, 6, 1), cell('b', 6, 0, 6, 1), cell('c', 0, 1, 12, 1)]
  assert.deepEqual(where(placeCells(cells, (c) => c.cellId !== 'a')), { b: [0, 1], c: [1, 1] })
})

test('rows that never held a component are deliberate spacing and stay', () => {
  const cells = [cell('a', 0, 0, 12, 1), cell('b', 0, 3, 12, 1), cell('c', 0, 4, 12, 1)]
  assert.deepEqual(where(placeCells(cells, (c) => c.cellId !== 'c')), { a: [0, 1], b: [3, 1] })
})

test('a tall hidden component only empties the rows no shown component covers', () => {
  const cells = [cell('tall', 0, 0, 4, 3), cell('side', 4, 1, 8, 1), cell('d', 0, 3, 12, 1)]
  const placed = placeCells(cells, (c) => c.cellId !== 'tall')
  // Rows 0 and 2 are empty now; row 1 still holds "side".
  assert.deepEqual(where(placed), { side: [0, 1], d: [1, 1] })
})

test('a growing component takes the rows it needs, up to growMax, and pushes the ones below it down', () => {
  const cells = [cell('a', 0, 0, 12, 1, { growMax: 3 }), cell('b', 0, 1, 12, 1)]
  assert.deepEqual(where(placeCells(cells, all, { a: 3 })), { a: [0, 3], b: [3, 1] })
  assert.deepEqual(where(placeCells(cells, all, { a: 9 })), { a: [0, 4], b: [4, 1] })
  assert.deepEqual(where(placeCells(cells, all, { a: 1 })), { a: [0, 1], b: [1, 1] })
  assert.deepEqual(where(placeCells(cells, all, {})), { a: [0, 1], b: [1, 1] })
})

test('without growMax content height is ignored (it scrolls or is cut off)', () => {
  const cells = [cell('a', 0, 0, 12, 1), cell('b', 0, 1, 12, 1)]
  assert.deepEqual(where(placeCells(cells, all, { a: 5 })), { a: [0, 1], b: [1, 1] })
})

test('growth pushes only the components below it in the columns it covers, and chains', () => {
  const cells = [
    cell('a', 0, 0, 6, 1, { growMax: 5 }),
    cell('side', 6, 1, 6, 1),
    cell('below', 0, 1, 6, 1, { growMax: 5 }),
    cell('last', 0, 2, 12, 1),
  ]
  const placed = placeCells(cells, all, { a: 2, below: 3 })
  assert.deepEqual(where(placed), {
    a: [0, 2],
    side: [1, 1],
    below: [2, 3],
    // Pushed by "a" (1) and by "below" (2 more rows).
    last: [5, 1],
  })
})

test('a hidden growing component neither grows nor pushes', () => {
  const cells = [cell('a', 0, 0, 12, 1, { growMax: 3 }), cell('b', 0, 1, 12, 1)]
  assert.deepEqual(where(placeCells(cells, (c) => c.cellId !== 'a', { a: 4 })), { b: [0, 1] })
})

test('hidden rows collapse and growth then stacks on the compacted rows', () => {
  const cells = [
    cell('a', 0, 0, 12, 1),
    cell('gone', 0, 1, 12, 1),
    cell('g', 0, 2, 12, 1, { growMax: 2 }),
    cell('z', 0, 3, 12, 1),
  ]
  assert.deepEqual(where(placeCells(cells, (c) => c.cellId !== 'gone', { g: 3 })), {
    a: [0, 1],
    g: [1, 3],
    z: [4, 1],
  })
})
