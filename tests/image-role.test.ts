import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateProject, type Cell } from '../shared/model'
import { modelProject } from './support/model-fixtures'

// R-511: the banner, logo and icon choices are gone, but a project saved with one still opens (shown as the cover).
test('an older image component set to an imported banner, logo or icon still validates', () => {
  const base = modelProject(),
    image = (patch: Partial<Cell>): Cell => ({
      cellId: 'picture',
      kind: 'image',
      grid: { x: 0, y: 0, w: 4, h: 4 },
      style: { textColor: '#ffffff', backgroundColor: 'transparent' },
      ...patch,
    }),
    project = (cell: Cell) => ({
      ...base,
      layoutPresets: undefined,
      activeLayoutId: undefined,
      cells: [cell],
    })
  for (const imageRole of ['hero', 'logo', 'icon'] as const)
    assert.doesNotThrow(() => validateProject(project(image({ imageRole }))))
  assert.throws(() =>
    validateProject(project(image({ imageRole: 'screenshot' as Cell['imageRole'] })))
  )
  assert.throws(
    () => validateProject(project(image({ imageRole: 'hero', imageCover: true }))),
    'one fallback at a time'
  )
  assert.throws(() => validateProject(project(image({ imageRole: 'logo', imageIndex: 2 }))))
  assert.throws(() => validateProject(project({ ...image({ imageRole: 'icon' }), kind: 'name' })))
})
