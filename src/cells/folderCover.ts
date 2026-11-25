import type { Asset, FolderRow } from '../../shared/model'

// R-437: the one rule for a folder's cover, whatever its kind, shared by cards and the right panel: the picture chosen
// as cover, else the first picture of the record that is not a source extra (screenshot, hero, logo, icon), else - read
// by the main process (media://cover, electron/explorer-content.ts folderCover) - the first track's embedded cover, the
// one image named cover/folder/front/artist, or the first image file directly inside the folder.
export function folderCoverAsset(row?: FolderRow): Asset | undefined {
  const assets = row?.record?.assets ?? []
  return (
    assets.find((asset) => asset.assetId === row?.record?.details?.bannerAssetId) ??
    assets.find((asset) => !asset.role)
  )
}
// R-435: the first picture a website import brought in for that use (banner, logo or icon).
export function sourceImageAsset(row: FolderRow | undefined, role: 'hero' | 'logo' | 'icon') {
  return row?.record?.assets.find((asset) => asset.role === role)
}
// `full` (R-499): the original picture instead of the thumbnail, for the right panel where it is drawn large.
export function folderCoverPicture(
  row?: FolderRow,
  full = false
): { src: string; alt: string } | undefined {
  if (!row) return undefined
  const asset = folderCoverAsset(row)
  return asset
    ? { src: `media://asset/${row.rowId}/${asset.assetId}`, alt: asset.originalName }
    : { src: `media://cover/${row.rowId}${full ? '?full=1' : ''}`, alt: row.name }
}
