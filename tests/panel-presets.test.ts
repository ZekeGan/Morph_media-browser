import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addPreset,
  fromPanelEditor,
  panelCells,
  panelEditorProject,
  selectPreset,
} from '../shared/layouts'
import { validateProject, type Cell, type FolderRow, type Project } from '../shared/model'
import { modelProject } from './support/model-fixtures'
import { createGroup, dissolveGroup } from '../shared/fieldGroups'
import { withoutField } from '../electron/maintenance'

// R-409: the right-panel layouts (book templates before), edited with the editor's layout tools.
const style = { textColor: '#e4e6e8', backgroundColor: 'transparent' }
const cell = (cellId: string, y = 0) =>
  ({ cellId, kind: 'name', grid: { x: 0, y, w: 12, h: 1 }, style }) as Cell
const card: Project = {
  ...modelProject(),
  panelPresets: undefined,
  cells: [cell('card')],
  layoutPresets: [{ id: 'cardA', name: 'Card', cells: [cell('card')] }],
  activeLayoutId: 'cardA',
  layoutRules: { card: { folders: { f1: 'cardA' } } },
}
const folder = (folderId: string) =>
  ({ rowId: folderId, depth: 2, record: { folderId } }) as unknown as FolderRow
const builtin = () => [cell('builtin')]

test('panel layouts go through the editor layout tools and back, card layouts untouched', () => {
  // Without a layout for the kind, the editor starts "<kind> 預設" from the built-in panel.
  const opened = panelEditorProject(card, 'book', [cell('cover')])
  assert.deepEqual(
    opened.layoutPresets!.map((p) => [p.id, p.name]),
    [['panel-book', '書籍 預設']]
  )
  assert.equal(opened.cells[0].cellId, 'cover')
  // Add a second layout and save with it chosen: it becomes the kind's layout.
  const added = addPreset(opened, 'Short', 'short', false)
  const saved = fromPanelEditor(card, { ...added, cells: [cell('only')] }, 'book', false)
  validateProject(saved)
  assert.deepEqual(
    saved.panelPresets!.map((p) => [p.id, p.cells[0].cellId]),
    [
      ['panel-book', 'cover'],
      ['short', 'only'],
    ]
  )
  assert.deepEqual(saved.layoutRules, {
    card: { folders: { f1: 'cardA' } },
    panel: { types: { book: 'short' } },
  })
  assert.deepEqual(saved.layoutPresets, card.layoutPresets)
  assert.equal(saved.activeLayoutId, 'cardA')
  assert.equal(panelCells(saved, folder('x'), 'book', builtin)[0].cellId, 'only')
  // Another kind without a layout shows its built-in panel.
  assert.equal(panelCells(saved, folder('x'), 'game', builtin)[0].cellId, 'builtin')
})

test('a folder own layout opened in the editor leaves the kind layout alone', () => {
  const project: Project = {
    ...card,
    panelPresets: [
      { id: 'default', name: '書籍 預設', cells: [cell('def')] },
      { id: 'mine', name: 'Folder', cells: [cell('mine')] },
    ],
    layoutRules: { panel: { types: { book: 'default' }, folders: { f2: 'mine' } } },
  }
  validateProject(project)
  const opened = panelEditorProject(project, 'book', builtin(), 'mine')
  assert.equal(opened.activeLayoutId, 'mine')
  const saved = fromPanelEditor(project, { ...opened, cells: [cell('changed')] }, 'book', true)
  assert.deepEqual(saved.layoutRules, project.layoutRules)
  assert.equal(saved.panelPresets!.find((p) => p.id === 'mine')!.cells[0].cellId, 'changed')
  // A folder shows its own layout; others the kind's; a choice whose layout is gone falls back to it.
  assert.equal(panelCells(saved, folder('f2'), 'book', builtin)[0].cellId, 'changed')
  assert.equal(panelCells(saved, folder('f9'), 'book', builtin)[0].cellId, 'def')
  assert.equal(
    panelCells(
      {
        ...saved,
        layoutRules: { panel: { types: { book: 'default' }, folders: { f2: 'gone' } } },
      },
      folder('f2'),
      'book',
      builtin
    )[0].cellId,
    'def'
  )
  // Switching layouts in the editor keeps both.
  assert.equal(selectPreset(opened, 'default').cells[0].cellId, 'def')
  // Deleting a layout in the editor drops the rules that named it.
  const without = fromPanelEditor(
    project,
    {
      ...opened,
      layoutPresets: opened.layoutPresets!.filter((p) => p.id !== 'mine'),
      activeLayoutId: 'default',
      cells: [cell('def')],
    },
    'book',
    true
  )
  assert.deepEqual(without.layoutRules, { panel: { types: { book: 'default' } } })
})

test('panel layout lists are checked like card layouts', () => {
  const base: Project = { ...modelProject(), panelPresets: undefined }
  assert.throws(() => validateProject({ ...base, panelPresets: [] }), /詳情版面不合法/)
  assert.throws(
    () =>
      validateProject({
        ...base,
        panelPresets: [
          { id: 'a', name: 'Same', cells: [] },
          { id: 'b', name: 'same', cells: [] },
        ],
      }),
    /名稱重複/
  )
  assert.throws(
    () =>
      validateProject({
        ...base,
        panelPresets: [{ id: 'a', name: 'A', cells: [] }],
        panelPresetId: 'b',
      }),
    /詳情預設版面不存在/
  )
  assert.throws(() => validateProject({ ...base, panelPresetId: 'a' }), /清單不存在/)
})

test('removing a field and changing groups reach panel layouts, so the project still saves', () => {
  const field = (cellId: string, attributeId: string, extra: Partial<Cell> = {}) =>
    ({
      cellId,
      kind: 'field-text',
      attributeId,
      grid: { x: 0, y: 0, w: 12, h: 1 },
      style,
      ...extra,
    }) as Cell
  const base: Project = {
    ...modelProject(),
    panelPresets: undefined,
    fieldBindings: [
      { attributeId: 'a', alias: 'A', type: 'string' },
      { attributeId: 'b', alias: 'B', type: 'string' },
    ],
    cells: [field('card', 'a')],
  }
  const grouped = createGroup(base, ['a', 'b'], 'AB', 'g1')
  const project: Project = {
    ...grouped,
    panelPresets: [
      { id: 'default', name: 'D', cells: [field('def', 'a', { groupId: 'g1' })] },
      {
        id: 'other',
        name: 'O',
        cells: [
          field('o', 'b', { groupId: 'g1' }),
          field('o2', 'b', { grid: { x: 0, y: 1, w: 12, h: 1 } }),
        ],
      },
    ],
    layoutRules: { panel: { types: { book: 'default' } } },
  }
  validateProject(project)
  const dissolved = dissolveGroup(project, 'g1')
  validateProject(dissolved)
  assert.ok(dissolved.panelPresets!.every((p) => p.cells.every((c) => !c.groupId)))
  const removed = withoutField(dissolved, 'b')
  validateProject(removed)
  assert.ok(removed.panelPresets!.every((p) => p.cells.every((c) => c.attributeId !== 'b')))
  // A group dissolved inside the panel editor settles the card layouts restored on saving.
  const opened = panelEditorProject(project, 'book', builtin())
  const saved = fromPanelEditor(project, dissolveGroup(opened, 'g1'), 'book', false)
  validateProject(saved)
  assert.ok(saved.cells.every((c) => !c.groupId))
})
