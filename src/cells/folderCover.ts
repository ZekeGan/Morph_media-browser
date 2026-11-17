import type { Asset, FolderRow } from '../../shared/model'

// R-409: the one rule for a folder's cover, shared by image components set to "folder cover", the game cover and the
// book cover: the picture chosen as cover, else the first picture of the record that is not a source extra (screenshot,
// hero, logo, icon), else the first image file directly inside the folder.
export function folderCoverAsset(row?: FolderRow): Asset | undefined {
  const assets = row?.record?.assets ?? []
  return (
    assets.find((asset) => asset.assetId === row?.record?.details?.bannerAssetId) ??
    assets.find((asset) => !asset.role)
  )
}
export function folderCoverPicture(row?: FolderRow): { src: string; alt: string } | undefined {
  if (!row) return undefined
  const asset = folderCoverAsset(row)
  return asset
    ? { src: `media://asset/${row.rowId}/${asset.assetId}`, alt: asset.originalName }
    : { src: `media://nth/${row.rowId}/1`, alt: row.name }
}
