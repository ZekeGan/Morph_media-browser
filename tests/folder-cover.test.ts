import assert from 'node:assert/strict'
import test from 'node:test'
import type { Asset, FolderRow } from '../shared/model'
import { folderCoverAsset, folderCoverPicture } from '../src/cells/folderCover'

const asset = (assetId: string, role?: Asset['role']): Asset => ({
  assetId,
  relativePath: `assets/${assetId}.png`,
  originalName: `${assetId}.png`,
  mediaType: 'image/png',
  ...(role ? { role } : {}),
})
const row = (assets: Asset[], bannerAssetId?: string) =>
  ({
    rowId: 'r1',
    name: 'Folder',
    record: { assets, details: bannerAssetId ? { bannerAssetId } : {} },
  }) as unknown as FolderRow

test('the chosen cover wins, then the first plain picture, then the first image file', () => {
  assert.equal(folderCoverAsset(row([asset('a'), asset('b')], 'b'))?.assetId, 'b')
  assert.equal(folderCoverAsset(row([asset('s', 'screenshot'), asset('a')]))?.assetId, 'a')
  // Source extras (screenshots, hero, logo, icon) are never taken as the cover by themselves.
  assert.equal(folderCoverAsset(row([asset('s', 'screenshot'), asset('h', 'hero')])), undefined)
  assert.deepEqual(folderCoverPicture(row([asset('h', 'hero')])), {
    src: 'media://nth/r1/1',
    alt: 'Folder',
  })
  assert.deepEqual(folderCoverPicture(row([asset('a')])), {
    src: 'media://asset/r1/a',
    alt: 'a.png',
  })
  // A chosen cover may itself be a source picture.
  assert.equal(folderCoverAsset(row([asset('h', 'hero')], 'h'))?.assetId, 'h')
  assert.equal(folderCoverPicture(undefined), undefined)
})
