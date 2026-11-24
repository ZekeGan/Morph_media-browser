import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { browserRows, headerSort, sortChoices, sortRows } from '../shared/browse'
import type { FolderRow } from '../shared/model'
import { modelFolder, modelProject } from './support/model-fixtures'

const root = path.resolve('lib')
const row = (name: string, depth: number, at = path.join(root, name)): FolderRow => ({
  rowId: name || 'root',
  path: name ? at : root,
  name: name ? path.basename(name) : 'lib',
  projectId: 'project',
  depth,
  stopped: false,
  duplicate: false,
  record: modelFolder(),
})
const rows = [row('', 1), row('A', 2), row('B', 2), row(path.join('A', 'deep'), 3)]
const cards = (location: string, cardView: { mode: 'single' | 'multi'; level: number | 'all' }) =>
  browserRows(rows, { ...modelProject(), cardView }, root, 'CARD', location).map((r) => r.name)

test('opening a project lists the root folders instead of one lone root card', () => {
  assert.deepEqual(cards('', { mode: 'single', level: 1 }), ['A', 'B'])
  assert.deepEqual(cards('', { mode: 'single', level: 3 }), ['deep'])
  // R-340: the old "multi" view is "all works"; a limit of 1 stops at the root's own folders.
  assert.deepEqual(cards('', { mode: 'multi', level: 1 }), ['A', 'B'])
})

test('a project with no subfolders keeps showing its root', () => {
  const only = [row('', 1)]
  const shown = browserRows(
    only,
    { ...modelProject(), cardView: { mode: 'single', level: 1 } },
    root,
    'CARD',
    ''
  )
  assert.deepEqual(
    shown.map((r) => r.name),
    ['lib']
  )
})

test('a folder without subfolders shows its own card, others show their children', () => {
  const single = { mode: 'single', level: 1 } as const
  assert.deepEqual(cards(path.join(root, 'A'), single), ['deep'])
  assert.deepEqual(cards(path.join(root, 'B'), single), ['B'])
  const table = browserRows(rows, modelProject(), root, 'TABLE', path.join(root, 'B'))
  assert.deepEqual(table, [], 'the table stays a list of children')
})

test('rows sort by name with numbers in order, by field with empty values last, and stay stable', () => {
  const withScore = (name: string, score?: number): FolderRow => ({
    ...row(name, 2),
    record: {
      ...modelFolder(),
      attributes:
        score === undefined
          ? []
          : [
              {
                attributeId: 'score',
                key: 'score',
                type: 'number',
                value: score,
                source: 'manual',
              },
            ],
    },
  })
  const list = [withScore('item 10', 1), withScore('item 2'), withScore('item 1', 5)]
  const names = (sorted: FolderRow[]) => sorted.map((r) => r.name)
  assert.deepEqual(names(sortRows(list, { field: 'name', asc: true }, 'en')), [
    'item 1',
    'item 2',
    'item 10',
  ])
  assert.deepEqual(names(sortRows(list, { field: 'name', asc: false }, 'en')), [
    'item 10',
    'item 2',
    'item 1',
  ])
  assert.deepEqual(
    names(sortRows(list, { field: 'score', asc: false }, 'en')),
    ['item 1', 'item 10', 'item 2'],
    'a folder without the field goes last in either direction'
  )
  assert.deepEqual(names(list), ['item 10', 'item 2', 'item 1'], 'the input is not reordered')
})
test('R-467: several sort keys, ties by name, and folders first', () => {
  const make = (name: string, score?: number, year?: number) => ({
    ...row(name, 2),
    record: {
      ...modelFolder(),
      attributes: [
        ...(score === undefined
          ? []
          : [
              {
                attributeId: 'score',
                key: 'score',
                type: 'number',
                value: score,
                source: 'manual',
              },
            ]),
        ...(year === undefined
          ? []
          : [{ attributeId: 'year', key: 'year', type: 'number', value: year, source: 'manual' }]),
      ],
    },
  })
  const list = [make('d', 5, 2001), make('b', 5, 2003), make('a', 4, 2003), make('c', 5, 2003)]
  const names = (sorted: FolderRow[]) => sorted.map((r) => r.name)
  assert.deepEqual(
    names(
      sortRows(
        list,
        [
          { field: 'score', asc: false },
          { field: 'year', asc: false },
        ],
        'en'
      )
    ),
    ['b', 'c', 'd', 'a'],
    'equal on every key: by name'
  )
  assert.deepEqual(names(sortRows(list, [], 'en')), ['a', 'b', 'c', 'd'], 'no keys: by name')
  assert.deepEqual(
    names(sortRows(list, [{ field: 'score', asc: true }], 'en', undefined, (r) => r.name === 'd')),
    ['d', 'a', 'b', 'c'],
    'folders first come before the works, each part sorted'
  )
  const six = Array.from({ length: 6 }, (_, i) => ({ field: 'f' + i, asc: true }))
  assert.equal(headerSort(six.slice(0, 5), 'g', true).length, 5, 'at most five keys')
  const two = [
    { field: 'score', asc: false },
    { field: 'year', asc: true },
  ]
  assert.deepEqual(headerSort(two, 'year', false), [{ field: 'year', asc: true }])
  assert.deepEqual(headerSort([{ field: 'year', asc: true }], 'year', false), [
    { field: 'year', asc: false },
  ])
  assert.deepEqual(headerSort(two, 'year', true), [two[0], { field: 'year', asc: false }])
  assert.deepEqual(headerSort(two, 'name', true), [...two, { field: 'name', asc: true }])
  assert.deepEqual(
    sortChoices([
      { id: 'path', label: '目前路徑' },
      { id: 'name', label: '資料夾名稱' },
      { id: 'd', label: '發售日' },
      { id: 'r', label: '評分' },
    ]).map((c) => c.id),
    ['r', 'd', 'name', 'path']
  )
})
