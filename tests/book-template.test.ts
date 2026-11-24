import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookTemplate, builtinPanel, panelEditorStart, withBookCard } from '../shared/explorer'
import type { Cell } from '../shared/model'
import { modelProject } from './support/model-fixtures'
import { projectImageCells } from '../shared/layouts'

const style = { textColor: '#e4e6e8', backgroundColor: 'transparent' }
const cell = (cellId: string, kind: string, grid: Cell['grid']) =>
  ({ cellId, kind, grid, style }) as Cell

test('R-362, R-469: a book starts with a tall cover on the left and the name and card fields on the right', () => {
  const card = [
    cell('name', 'name', { x: 0, y: 0, w: 12, h: 1 }),
    cell('group', 'field-tags', { x: 0, y: 1, w: 6, h: 1 }),
    cell('tags', 'field-tags', { x: 6, y: 1, w: 6, h: 2 }),
  ]
  const shape = (cells: Cell[]) =>
    cells.map((c) => [c.cellId, c.kind, c.grid.x, c.grid.y, c.grid.w, c.grid.h])
  const cells = builtinPanel({ cells: card }, 'book')
  assert.deepEqual(shape(cells), [
    ['book-cover', 'image', 0, 0, 4, 6],
    ['name', 'name', 4, 0, 8, 1],
    ['group', 'field-tags', 4, 1, 8, 1],
    ['tags', 'field-tags', 4, 2, 8, 2],
  ])
  assert.equal(cells[0].imageCover, true)
  // Without fields: the cover and the name (the book page has 繼續閱讀 in its own actions).
  assert.deepEqual(
    bookTemplate({ cells: [card[0]] }).map((c) => c.cellId),
    ['book-cover', 'name']
  )
  // R-469: music has a square cover with the album's small components beside it; video a tall cover with the name,
  // video count and 播放; a game a wide cover with the name below. Other kinds show nothing, and the editor starts
  // them with the name.
  const music = builtinPanel({ cells: card }, 'music')
  assert.deepEqual(shape(music), [
    ['album-cover', 'image', 0, 0, 5, 4],
    ['albumName', 'system-info', 5, 0, 7, 1],
    ['albumArtist', 'system-info', 5, 1, 4, 1],
    ['albumYear', 'system-info', 9, 1, 3, 1],
    ['trackCount', 'system-info', 5, 2, 4, 1],
    ['totalLength', 'system-info', 9, 2, 3, 1],
  ])
  assert.deepEqual(music.map((c) => c.systemInfo ?? null).slice(1), [
    'albumName',
    'albumArtist',
    'albumYear',
    'trackCount',
    'totalLength',
  ])
  assert.deepEqual(shape(builtinPanel({ cells: card }, 'video')), [
    ['video-cover', 'image', 0, 0, 4, 6],
    ['name', 'name', 4, 0, 8, 1],
    ['videoCount', 'system-info', 4, 1, 8, 1],
    ['video-play', 'video-play', 4, 2, 8, 1],
  ])
  const game = builtinPanel({ cells: card }, 'game')
  assert.deepEqual(shape(game), [
    ['game-cover', 'image', 0, 0, 12, 6],
    ['name', 'name', 0, 6, 12, 1],
  ])
  assert.equal(game[0].imageFit, 'blur')
  assert.deepEqual(builtinPanel({ cells: card }, 'general'), [])
  assert.deepEqual(
    panelEditorStart({ cells: card }, 'general').map((c) => c.cellId),
    ['name']
  )
  // One EPUB: its title and author go under the name, and the rest of the right column moves down.
  const carded = withBookCard(builtinPanel({ cells: card }, 'book'))
  assert.deepEqual(
    carded.map((c) => [c.systemInfo ?? c.kind, c.grid.y]),
    [
      ['image', 0],
      ['name', 0],
      ['field-tags', 3],
      ['field-tags', 4],
      ['bookTitle', 1],
      ['bookAuthor', 2],
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
