import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookTemplate, builtinPanel, panelEditorStart, withBookCard } from '../shared/explorer'
import type { Cell } from '../shared/model'
import { modelProject } from './support/model-fixtures'
import { projectImageCells } from '../shared/layouts'

const style = { textColor: '#e4e6e8', backgroundColor: 'transparent' }
const cell = (cellId: string, kind: string, grid: Cell['grid']) =>
  ({ cellId, kind, grid, style }) as Cell

test('R-362: a book starts with its cover on the left and the card fields on the right', () => {
  const card = [
    cell('name', 'name', { x: 0, y: 0, w: 12, h: 1 }),
    cell('group', 'field-tags', { x: 0, y: 1, w: 6, h: 1 }),
    cell('tags', 'field-tags', { x: 6, y: 1, w: 6, h: 2 }),
  ]
  const cells = builtinPanel({ cells: card }, 'book')
  assert.deepEqual(
    cells.map((c) => [c.cellId, c.kind, c.grid.x, c.grid.y, c.grid.w, c.grid.h]),
    [
      ['book-cover', 'image', 0, 0, 4, 4],
      ['group', 'field-tags', 4, 0, 8, 1],
      ['tags', 'field-tags', 4, 1, 8, 2],
    ]
  )
  assert.equal(cells[0].imageCover, true)
  // Without fields the cover is all there is; other kinds keep their name and path default.
  assert.deepEqual(
    bookTemplate({ cells: [card[0]] }).map((c) => c.cellId),
    ['book-cover']
  )
  // Music and video start with their main visual; other kinds show nothing, and the editor starts them with the name.
  assert.deepEqual(
    builtinPanel({ cells: card }, 'music').map((c) => c.kind),
    ['album-info']
  )
  assert.deepEqual(builtinPanel({ cells: card }, 'game'), [])
  assert.deepEqual(
    panelEditorStart({ cells: card }, 'game').map((c) => c.cellId),
    ['name']
  )
  // One EPUB: the book card comes first and the template moves below it.
  const carded = withBookCard(builtinPanel({ cells: card }, 'book'))
  assert.deepEqual(
    carded.map((c) => [c.kind, c.grid.y]),
    [
      ['book-card', 0],
      ['image', 4],
      ['field-tags', 4],
      ['field-tags', 5],
    ]
  )
})

test('R-362: the default cover can be given a picture before the book template is ever saved', () => {
  const base = modelProject()
  assert.ok(projectImageCells(base).some((c) => c.cellId === 'book-cover'))
  assert.ok(
    !projectImageCells({
      ...base,
      panelPresets: [{ id: 'b', name: 'B', cells: [] }],
      layoutRules: { panel: { types: { book: 'b' } } },
    }).some((c) => c.cellId === 'book-cover')
  )
})
