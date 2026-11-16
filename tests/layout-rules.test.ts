import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { FolderRow, Project } from '../shared/model'
import {
  chooseLayout,
  dropLayout,
  editLayoutRules,
  layoutLevel,
  legacyLayoutRules,
  type LayoutRule,
} from '../shared/layoutRules'

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

test("older projects: kind layouts, folder layouts and folders' book templates become rules", () => {
  const project = {
    kindLayouts: { media: 'M', game: 'G' },
    folderLayouts: { f1: 'X' },
    bookPresets: [{ id: 'bk', name: 'b', cells: [] }],
    bookPresetId: 'bk',
    folderBookPresets: { f2: 'bk2' },
  } as unknown as Project
  assert.deepEqual(legacyLayoutRules(project), {
    card: { types: { game: 'G', music: 'M', video: 'M' }, folders: { f1: 'X' } },
    panel: { folders: { f2: 'bk2' } },
  })
  assert.deepEqual(legacyLayoutRules({} as Project), {})
  // The first change moves them into layoutRules and removes the older fields; the book default stays.
  const edited = editLayoutRules(project, (rules) => {
    rules.card.levels = ['T', '']
    delete rules.card.folders
  })
  assert.deepEqual(edited.layoutRules, {
    card: { types: { game: 'G', music: 'M', video: 'M' }, levels: ['T'] },
    panel: { folders: { f2: 'bk2' } },
  })
  assert.equal(edited.kindLayouts, undefined)
  assert.equal(edited.folderLayouts, undefined)
  assert.equal(edited.folderBookPresets, undefined)
  assert.equal(edited.bookPresetId, 'bk')
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
