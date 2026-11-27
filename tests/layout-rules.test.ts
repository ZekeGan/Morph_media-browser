import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  chooseLayout,
  choosePanel,
  dropLayout,
  editLayoutRules,
  layoutLevel,
  type LayoutRule,
} from '../shared/layoutRules'
import type { FolderRow, Project } from '../shared/model'

// A folder `depth` rows deep (the project root is depth 1); `kind` set by hand makes it a work of that kind.
const folder = (id: string, depth: number, kind?: string) =>
  ({
    rowId: id,
    depth,
    record: { folderId: id, details: { schemaVersion: 1, ...(kind ? { kind } : {}) } },
  }) as unknown as FolderRow
const known = () => true
const rule: LayoutRule = {
  types: { music: 'A', game: 'B', book: 'C' },
  levels: ['T', 'T', 'F1', 'T'],
}
const pick = (row: FolderRow, work: boolean, r: LayoutRule = rule) =>
  chooseLayout(r, row, work, 'L0', known)

test('level counts from the first folder below the project root', () => {
  assert.equal(layoutLevel(folder('root', 1)), 0)
  assert.equal(layoutLevel(folder('a', 2)), 1)
  assert.equal(layoutLevel(folder('b', 5)), 4)
})

test('/artist/album: the artist takes its level, the album its kind', () => {
  assert.deepEqual(pick(folder('artist1', 2), false), { id: 'T', source: 'level' })
  assert.deepEqual(pick(folder('album1', 3, 'music'), true), { id: 'A', source: 'type' })
})

test('/artist/folder/album: an album one level deeper still takes its kind', () => {
  assert.deepEqual(pick(folder('folder1', 3), false), { id: 'T', source: 'level' })
  assert.deepEqual(pick(folder('folder2', 4), false), { id: 'F1', source: 'level' })
  assert.deepEqual(pick(folder('album1', 4, 'music'), true), { id: 'A', source: 'type' })
  assert.deepEqual(pick(folder('album2', 5, 'music'), true), { id: 'A', source: 'type' })
})

test('a work at the first level, and a work inside a work, keep their kind', () => {
  assert.deepEqual(pick(folder('album', 2, 'music'), true), { id: 'A', source: 'type' })
  assert.deepEqual(pick(folder('inner', 3, 'music'), true), { id: 'A', source: 'type' })
})

test('levels beyond the set ones, and kinds without a layout, use layout 0', () => {
  assert.deepEqual(pick(folder('deep', 7), false), { id: 'L0', source: 'default' })
  assert.deepEqual(pick(folder('clip', 3, 'video'), true), { id: 'L0', source: 'default' })
  assert.deepEqual(pick(folder('root', 1), false), { id: 'L0', source: 'default' })
  assert.deepEqual(pick(folder('x', 2), false, {}), { id: 'L0', source: 'default' })
})

test("a folder's own layout wins over its kind and level", () => {
  const own = { ...rule, folders: { album1: 'L' } }
  assert.deepEqual(pick(folder('album1', 4, 'music'), true, own), { id: 'L', source: 'folder' })
  assert.deepEqual(pick(folder('album2', 4, 'music'), true, own), { id: 'A', source: 'type' })
})

test('a rule naming a deleted layout is skipped', () => {
  const choice = chooseLayout(
    { ...rule, folders: { album1: 'gone' } },
    folder('album1', 3, 'music'),
    true,
    'L0',
    (id) => id !== 'gone'
  )
  assert.deepEqual(choice, { id: 'A', source: 'type' })
})

test('the right panel follows the page kind: folder, kind, level, panel default, else built-in', () => {
  const panel: LayoutRule = { types: { book: 'B' }, levels: ['L1'], folders: { own: 'O' } }
  assert.deepEqual(choosePanel(panel, folder('own', 2, 'book'), 'book', 'D', known), {
    id: 'O',
    source: 'folder',
  })
  // Kind before level, whether or not the folder counts as a work.
  assert.deepEqual(choosePanel(panel, folder('b', 2), 'book', 'D', known), {
    id: 'B',
    source: 'type',
  })
  assert.deepEqual(choosePanel(panel, folder('g', 2), 'game', 'D', known), {
    id: 'L1',
    source: 'level',
  })
  assert.deepEqual(choosePanel(panel, folder('g', 3), 'game', 'D', known), {
    id: 'D',
    source: 'default',
  })
  assert.equal(choosePanel(panel, folder('g', 3), 'game', undefined, known), undefined)
  assert.equal(choosePanel(panel, folder('b', 2), 'book', undefined, (id) => id !== 'B')?.id, 'L1')
})

test('editing rules drops emptied parts', () => {
  const edited = editLayoutRules(
    { layoutRules: { card: { folders: { f1: 'X' } } } } as unknown as Project,
    (rules) => {
      rules.card.levels = ['T', '']
      delete rules.card.folders
    }
  )
  assert.deepEqual(edited.layoutRules, { card: { levels: ['T'] } })
})

test('deleting a layout clears it from every rule', () => {
  assert.deepEqual(
    dropLayout(
      { types: { music: 'A', game: 'B' }, levels: ['T', 'A', 'A'], folders: { x: 'A' } },
      'A'
    ),
    { types: { game: 'B' }, levels: ['T'] }
  )
})
