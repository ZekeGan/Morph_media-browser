import { Button, Group, Menu, Stack, Text } from '@mantine/core'
import { useEffect, useState } from 'react'

import type { ExplorerRequest, ExplorerResponse } from '../../shared/explorer'
import type { Asset, Cell, FolderRow, Request, Response } from '../../shared/model'

import { folderCoverPicture } from '../cells/folderCover'
import { Icon } from '../common/icons'
import { t as tr } from '../i18n'
import { ImageUrlImport } from '../metadata/ImageUrlImport'

type Act = (request: Request) => Promise<Response | undefined>
type Run = (request: ExplorerRequest) => Promise<ExplorerResponse | undefined>

export interface ImageCell {
  cell: Cell
  // R-509: shown on the card or in the details panel.
  where: 'card' | 'panel'
}

interface Picture {
  src: string
  alt: string
}

// The folder settings' Images tab (R-509): the cover first, as the folder shows it now and where that picture comes
// from; then the other image components of its layouts, each with the picture it shows when nothing is chosen; then
// the saved images.
export function FolderImages({
  row,
  assets,
  imageCells,
  disabled,
  locked,
  act,
  run,
  applied,
  onApplied,
}: {
  row: FolderRow
  assets: Asset[]
  imageCells: ImageCell[]
  disabled: boolean
  // Unsaved field edits block image changes, which would write the same record.
  locked: boolean
  act: Act
  run: Run
  applied?: boolean
  onApplied?: () => void
}) {
  const details = row.record?.details
  // Pictures the main process could not find (no image in the folder): shown as empty instead of a broken image.
  const [missing, setMissing] = useState<string[]>([])
  useEffect(() => setMissing([]), [row.rowId])
  const key = (cell: Cell) => cell.attributeId ?? cell.cellId
  // "Card picture 1", "Details picture 2": numbered within the card and within the details panel.
  const names = new Map(
    imageCells.map(({ cell, where }) => [
      cell.cellId,
      tr(
        where === 'card' ? '卡片的圖片 {0}' : '詳情的圖片 {0}',
        imageCells
          .filter((i) => i.where === where)
          .findIndex((i) => i.cell.cellId === cell.cellId) + 1
      ),
    ])
  )
  const manualCover = assets.find((a) => a.assetId === details?.bannerAssetId)
  const savedCover = assets.find((a) => !a.role)
  const coverAsset = manualCover ?? savedCover
  const autoCover = folderCoverPicture(row)
  const coverSource = manualCover
    ? tr('你選的圖片')
    : savedCover
      ? tr('已保存的第一張圖片')
      : autoCover && !missing.includes(autoCover.src)
        ? tr('自動：資料夾裡的圖片或音樂封面')
        : tr('還沒有封面')
  // Components that show the folder cover with nothing chosen for them would only repeat the cover above.
  const others = imageCells.filter(
    ({ cell }) => details?.cellImages?.[key(cell)] || !(cell.imageCover || cell.imageRole)
  )
  const fallbackOf = (cell: Cell): Picture | undefined =>
    cell.imageCover || cell.imageRole
      ? autoCover
      : cell.imageIndex
        ? {
            src: `media://nth/${row.rowId}/${cell.imageIndex}`,
            alt: tr('資料夾內第 {0} 張圖片', cell.imageIndex),
          }
        : undefined
  const fallbackText = (cell: Cell) =>
    cell.imageCover || cell.imageRole
      ? tr('沒選圖時：資料夾封面')
      : cell.imageIndex
        ? tr('沒選圖時：資料夾裡第 {0} 張圖', cell.imageIndex)
        : tr('沒選圖時：留空')
  const usedBy = (assetId: string) => [
    ...imageCells.flatMap(({ cell }) =>
      details?.cellImages?.[key(cell)] === assetId ? [names.get(cell.cellId)!] : []
    ),
    ...(coverAsset?.assetId === assetId ? [tr('封面')] : []),
  ]
  // Confirm first, naming every place that shows the picture; the file and all references go in one write.
  const deleteImage = (assetId: string, name: string) => {
    const used = [
      ...imageCells.flatMap(({ cell }) =>
        details?.cellImages?.[key(cell)] === assetId ? [names.get(cell.cellId)!] : []
      ),
      ...(details?.bannerAssetId === assetId ? [tr('封面')] : []),
    ]
    if (
      !window.confirm(
        tr('刪除已保存的圖片「{name}」？').replace('{name}', name) +
          (used.length
            ? '\n' +
              tr('正在使用：{places}，刪除後會一併清除。').replace('{places}', used.join('、'))
            : '') +
          '\n' +
          tr('只刪除此資料夾內保存的副本，原始檔案不受影響。')
      )
    ) {
      return
    }
    void run({ action: 'deleteImage', rowId: row.rowId, revision: row.record!.revision, assetId })
  }
  // One thumbnail that opens a menu: pick a saved image, import a new one, or clear the choice. With nothing chosen it
  // shows the picture the folder gets anyway, marked as automatic.
  const imageChooser = ({
    label,
    current,
    fallback,
    onPick,
    onImport,
    onClear,
  }: {
    label: string
    current?: string
    fallback?: Picture
    onPick: (assetId: string) => void
    onImport: () => void
    onClear?: () => void
  }) => {
    const asset = assets.find((a) => a.assetId === current)
    const auto = !asset && fallback && !missing.includes(fallback.src) ? fallback : undefined
    return (
      <Menu position="bottom-start" withinPortal>
        <Menu.Target>
          <button
            type="button"
            className="image-thumb"
            aria-label={label}
            disabled={disabled || locked}
          >
            {asset ? (
              <img
                src={'media://asset/' + row.rowId + '/' + asset.assetId}
                alt={asset.originalName}
              />
            ) : auto ? (
              <>
                <img
                  src={auto.src}
                  alt={auto.alt}
                  onError={() => setMissing((list) => [...list, auto.src])}
                />
                <span className="image-thumb-auto">{tr('自動')}</span>
              </>
            ) : (
              <span className="image-thumb-empty">
                <Icon name="plus" size={18} />
                {tr('選擇圖片')}
              </span>
            )}
          </button>
        </Menu.Target>
        <Menu.Dropdown>
          {assets.map((a) => (
            <Menu.Item
              key={a.assetId}
              leftSection={
                <img
                  className="image-thumb-mini"
                  src={'media://asset/' + row.rowId + '/' + a.assetId}
                  alt=""
                />
              }
              rightSection={a.assetId === current ? <Icon name="check" size={14} /> : undefined}
              onClick={() => onPick(a.assetId)}
            >
              {a.originalName}
            </Menu.Item>
          ))}
          {!!assets.length && <Menu.Divider />}
          <Menu.Item onClick={onImport}>{tr('匯入新圖片…')}</Menu.Item>
          {asset && onClear && (
            <Menu.Item color="red" onClick={onClear}>
              {tr('清除指定')}
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
    )
  }
  return (
    <Stack>
      {!!row.record && (
        <section className="settings-section image-cover">
          <Group gap="xs" align="center">
            <Text fw={600}>{tr('封面')}</Text>
            {applied && (
              <span className="applied-pill" role="status">
                <Icon name="check" size={12} />
                {tr('已套用')}
              </span>
            )}
          </Group>
          <Text size="xs" c="dimmed" mb="sm">
            {coverSource}
          </Text>
          {imageChooser({
            label: tr('封面圖片'),
            current: coverAsset?.assetId,
            fallback: autoCover,
            onPick: (assetId) =>
              void run({
                action: 'banner',
                rowId: row.rowId,
                revision: row.record!.revision,
                assetId,
              }).then((r) => r && onApplied?.()),
            // An imported picture becomes the cover right away (the same as picking it from the list).
            onImport: async () => {
              const result = await act({
                action: 'image',
                rowId: row.rowId,
                revision: row.record!.revision,
              })
              const next =
                result && !result.cancelled
                  ? result.snapshot.structure?.find((r) => r.rowId === row.rowId)?.record
                  : undefined
              const asset = next?.assets.at(-1)
              if (next && asset) {
                const updated = await run({
                  action: 'banner',
                  rowId: row.rowId,
                  revision: next.revision,
                  assetId: asset.assetId,
                })
                if (updated) onApplied?.()
              }
            },
          })}
          <ImageUrlImport row={row} run={run} disabled={disabled || locked} />
        </section>
      )}
      {others.length > 0 && (
        <section className="settings-section image-others">
          <Text fw={600} mb="sm">
            {tr('版面上的其他圖片')}
          </Text>
          <div className="image-slots">
            {others.map(({ cell }) => {
              const name = names.get(cell.cellId)!
              return (
                <div className="image-slot" key={cell.cellId} data-cell-id={cell.cellId}>
                  <Text size="sm" fw={500}>
                    {name}
                  </Text>
                  <Text size="xs" c="dimmed" mb={6}>
                    {fallbackText(cell)}
                  </Text>
                  {imageChooser({
                    label: name,
                    current: details?.cellImages?.[key(cell)],
                    fallback: fallbackOf(cell),
                    onPick: (assetId) =>
                      void run({
                        action: 'cellImage',
                        rowId: row.rowId,
                        revision: row.record!.revision,
                        cellId: cell.cellId,
                        assetId,
                      }),
                    onImport: () =>
                      void act({
                        action: 'image',
                        rowId: row.rowId,
                        revision: row.record!.revision,
                        cellId: cell.cellId,
                      }),
                    onClear: () =>
                      void run({
                        action: 'cellImage',
                        rowId: row.rowId,
                        revision: row.record!.revision,
                        cellId: cell.cellId,
                        assetId: null,
                      }),
                  })}
                </div>
              )
            })}
          </div>
        </section>
      )}
      {!!assets.length && (
        <section className="settings-section image-library">
          <Text fw={600} mb="xs">
            {tr('圖片庫')}（{assets.length}）
          </Text>
          <div className="images">
            {assets.map((a) => {
              const used = usedBy(a.assetId)
              return (
                <figure key={a.assetId}>
                  <img src={'media://asset/' + row.rowId + '/' + a.assetId} alt={a.originalName} />
                  <figcaption>{a.originalName}</figcaption>
                  <small className="muted">
                    {used.length ? tr('用於：{0}', used.join('、')) : tr('未使用')}
                  </small>
                  <Button
                    variant="subtle"
                    color="red"
                    size="compact-xs"
                    aria-label={tr('刪除圖片 ') + a.originalName}
                    disabled={disabled || locked}
                    onClick={() => deleteImage(a.assetId, a.originalName)}
                  >
                    {tr('刪除圖片')}
                  </Button>
                </figure>
              )
            })}
          </div>
        </section>
      )}
    </Stack>
  )
}
