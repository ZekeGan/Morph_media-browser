import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateProject, type Cell, type FolderRow } from '../shared/model'
import { modelProject } from './support/model-fixtures'
import { sourceImageAsset } from '../src/cells/folderCover'

// R-435: an image component can show the banner, logo or icon a website import brought in.
test('an image component may ask for an imported banner, logo or icon', () => {
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

test('the first imported picture of that use is shown', () => {
  const asset = (assetId: string, role?: string) => ({
      assetId,
      relativePath: 'assets/' + assetId,
      originalName: assetId + '.png',
      mediaType: 'image/png',
      role,
    }),
    row = {
      record: {
        assets: [
          asset('cover'),
          asset('shot', 'screenshot'),
          asset('logo-1', 'logo'),
          asset('logo-2', 'logo'),
        ],
      },
    } as unknown as FolderRow
  assert.equal(sourceImageAsset(row, 'logo')?.assetId, 'logo-1')
  assert.equal(sourceImageAsset(row, 'hero'), undefined)
  assert.equal(sourceImageAsset(undefined, 'icon'), undefined)
})
