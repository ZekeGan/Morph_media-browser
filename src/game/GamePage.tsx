import { Fragment, useRef, useState } from 'react'
import { ActionIcon, Button, Group, Menu, Tooltip } from '@mantine/core'
import {
  gameActionTemplates,
  type ExplorerRequest,
  type ExplorerResponse,
} from '../../shared/explorer'
import {
  fieldValue,
  type FolderRow,
  type Project,
  type Request,
  type Response,
} from '../../shared/model'
import { isFilled } from '../../shared/cells'
import { fieldSourceGroups, rowFieldAttributes } from '../editor/fieldSources'
import { importedFieldLabels } from '../editor/importedFieldLabels'
import { yesNo } from '../editor/fieldTypes'
import { isUrl, siteName } from '../metadata/importSource'
import { Icon } from '../common/icons'
import { FolderPage } from '../panel/FolderPage'
import { GameExtraButtons } from './GameExtras'
import { t as tr, useLocale } from '../i18n'
import './game-actions.css'

// Imported rows name the website; other rows say where they come from.
const describeSource = (source?: string) =>
  !source
    ? tr('未設定')
    : isUrl(source)
      ? siteName(source)
      : source === 'manual'
        ? tr('手動')
        : source

// The page of a game main folder (R-389: the fill-ins of the shared folder page). Main visual: the cover; actions:
// confirming a possible game and the launch buttons; list: the field table. Nothing inside the game is listed.
export function GamePage({
  row,
  project,
  run,
  act,
  busy,
  configure,
}: {
  row: FolderRow
  project: Project
  run: (r: ExplorerRequest) => Promise<ExplorerResponse | undefined>
  act: (r: Request) => Promise<Response | undefined>
  busy: boolean
  configure: (tab?: 'game') => void
}) {
  useLocale()
  // Width of the 欄位 and 來源 columns of the game table (content takes the rest); a per-viewer convenience.
  const [gameWidths, setGameWidths] = useState<[number, number]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('morph.gameFieldWidths') ?? '[]')
      if (Array.isArray(saved) && saved.length === 2 && saved.every((n) => n >= 60 && n <= 800))
        return saved as [number, number]
    } catch {
      /* fall through to the defaults */
    }
    return [120, 110]
  })
  const gameDrag = useRef<{ column: 0 | 1; start: number; width: number } | undefined>(undefined)
  const dragGameColumn = (event: React.PointerEvent) => {
    const drag = gameDrag.current
    if (!drag) return
    const delta = event.clientX - drag.start,
      width = Math.min(800, Math.max(60, drag.width + (drag.column === 0 ? delta : -delta)))
    setGameWidths((current) => (drag.column === 0 ? [width, current[1]] : [current[0], width]))
  }
  const stopGameColumn = () => {
    gameDrag.current = undefined
    try {
      localStorage.setItem('morph.gameFieldWidths', JSON.stringify(gameWidths))
    } catch {
      /* the widths still apply until the page closes */
    }
  }
  const gameResizer = (column: 0 | 1, label: string) => (
    <span
      className="column-resizer"
      role="separator"
      aria-label={tr('調整 ') + label + tr(' 欄寬')}
      onPointerDown={(event) => {
        event.preventDefault()
        gameDrag.current = { column, start: event.clientX, width: gameWidths[column] }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={dragGameColumn}
      onPointerUp={stopGameColumn}
      onPointerCancel={() => {
        gameDrag.current = undefined
      }}
    />
  )
  const cover =
    row.record?.assets.find((a) => a.assetId === row.record?.details?.bannerAssetId) ??
    row.record?.assets[0]
  const disabled = busy || !row.record || row.readonly || row.stopped || !!row.error
  const fields = [
    ...new Map(
      [
        ...project.fieldBindings.map((f) => ({ attributeId: f.attributeId, key: f.alias })),
        ...(row.record?.attributes ?? []),
        ...(row.record?.projectOverrides[row.projectId] ?? []),
      ].map((a) => [a.attributeId, a])
    ).values(),
  ]
  const importedLabels = importedFieldLabels()
  return (
    <FolderPage
      page="game"
      row={row}
      project={project}
      openFolder={() => void act({ action: 'open', rowId: row.rowId })}
      busy={busy}
      visual={
        <div className="game-banner">
          {(row.boundary?.state === 'candidate' ||
            row.record?.details?.boundary?.state === 'candidate') && (
            <small className="game-candidate" role="status">
              {tr('候選遊戲，尚未確認')}
            </small>
          )}
          {cover ? (
            <img src={`media://asset/${row.rowId}/${cover.assetId}`} alt={cover.originalName} />
          ) : (
            <span>{tr('沒有遊戲封面')}</span>
          )}
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon
                className="cover-change"
                aria-label={tr('更換遊戲封面')}
                disabled={disabled}
                variant="default"
              >
                <Icon name="edit" />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {row.record?.assets.map((a) => (
                <Menu.Item
                  key={a.assetId}
                  onClick={() =>
                    void run({
                      action: 'banner',
                      rowId: row.rowId,
                      revision: row.record!.revision,
                      assetId: a.assetId,
                    })
                  }
                >
                  {a.originalName}
                </Menu.Item>
              ))}
              <Menu.Item
                onClick={async () => {
                  const result = await act({
                      action: 'image',
                      rowId: row.rowId,
                      revision: row.record!.revision,
                    }),
                    next =
                      result && !result.cancelled
                        ? result.snapshot.structure?.find((r) => r.rowId === row.rowId)?.record
                        : undefined,
                    asset = next?.assets.at(-1)
                  if (next && asset)
                    await run({
                      action: 'banner',
                      rowId: row.rowId,
                      revision: next.revision,
                      assetId: asset.assetId,
                    })
                }}
              >
                {tr('匯入封面圖片')}
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </div>
      }
      actions={
        <>
          {(row.boundary?.state === 'candidate' ||
            row.record?.details?.boundary?.state === 'candidate') &&
            row.record && (
              <Group className="game-candidate-actions" gap="xs">
                <Button
                  size="xs"
                  disabled={disabled}
                  onClick={() =>
                    void run({
                      action: 'boundary',
                      rowId: row.rowId,
                      revision: row.record!.revision,
                      state: 'root',
                    })
                  }
                >
                  {tr('確認為遊戲')}
                </Button>
                <Button
                  size="xs"
                  variant="subtle"
                  disabled={disabled}
                  onClick={() =>
                    void run({
                      action: 'boundary',
                      rowId: row.rowId,
                      revision: row.record!.revision,
                      state: 'not-game',
                    })
                  }
                >
                  {tr('這不是遊戲目錄')}
                </Button>
              </Group>
            )}
          <Group className="game-actions" gap="sm">
            {gameActionTemplates(project)
              // Only actions that are bound in this folder get a button; the eye in the folder settings can hide more.
              .filter(
                (t) =>
                  row.record?.details?.targets?.[t.id]?.kind === t.kind &&
                  !row.record?.details?.hiddenActions?.includes(t.id)
              )
              .map((t) => (
                <Button
                  key={t.id}
                  color={t.color}
                  disabled={busy}
                  title={row.record?.details?.targets?.[t.id]?.path}
                  onClick={() => {
                    if (
                      ['exe', 'file-app', 'shortcut'].includes(t.kind) &&
                      !window.confirm(tr('啟動「{0}」？', tr(t.label)))
                    )
                      return
                    void run({ action: 'runTarget', rowId: row.rowId, templateId: t.id })
                  }}
                >
                  {tr(t.label)}
                </Button>
              ))}
            <GameExtraButtons row={row} busy={busy} run={run} />
            {!gameActionTemplates(project).length && (
              <small className="muted">{tr('尚未設定操作按鈕')}</small>
            )}
            <Tooltip label={tr('自訂操作與目標')}>
              <ActionIcon
                aria-label={tr('自訂遊戲操作')}
                variant="subtle"
                onClick={() => configure('game')}
              >
                <Icon name="sliders" />
              </ActionIcon>
            </Tooltip>
          </Group>
          {gameActionTemplates(project).some((t) => t.id === 'default-launch-game') &&
            !row.record?.details?.targets?.['default-launch-game'] && (
              <small className="muted game-launch-hint">
                {tr('尚未指定啟動檔，「啟動遊戲」按鈕暫時無法使用。')}{' '}
                <Button size="compact-xs" variant="subtle" onClick={() => configure('game')}>
                  {tr('前往設定指定啟動檔')}
                </Button>
              </small>
            )}
        </>
      }
      list={
        <table className="attribute-table game-fields">
          <colgroup>
            <col style={{ width: gameWidths[0] }} />
            <col />
            <col style={{ width: gameWidths[1] }} />
          </colgroup>
          <thead>
            <tr>
              <th>
                {tr('欄位')}
                {gameResizer(0, tr('欄位'))}
              </th>
              <th>
                {tr('內容')}
                {gameResizer(1, tr('來源'))}
              </th>
              <th>{tr('來源')}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{tr('資料夾名稱')}</td>
              <td>{row.name}</td>
              <td>{tr('檔案系統')}</td>
            </tr>
            <tr>
              <td>{tr('目前路徑')}</td>
              <td>{row.path}</td>
              <td>{tr('檔案系統')}</td>
            </tr>
            {fieldSourceGroups(
              fields.filter((f) => isFilled(fieldValue(row, f.attributeId))),
              rowFieldAttributes([row])
            ).map(({ source, fields }) => (
              <Fragment key={source}>
                <tr className="field-source-heading">
                  <th colSpan={3}>{source}</th>
                </tr>
                {fields.map((f) => {
                  const value = fieldValue(row, f.attributeId),
                    attribute =
                      row.record?.projectOverrides[row.projectId]?.find(
                        (a) => a.attributeId === f.attributeId
                      ) ?? row.record?.attributes.find((a) => a.attributeId === f.attributeId)
                  const binding = project.fieldBindings.find(
                      (b) => b.attributeId === f.attributeId
                    ),
                    alias = binding?.alias,
                    plain = importedLabels[f.key]
                  return (
                    <tr key={f.attributeId}>
                      <td title={!alias && plain ? f.key : undefined}>{alias ?? plain ?? f.key}</td>
                      <td>
                        {value == null
                          ? '—'
                          : Array.isArray(value)
                            ? value.join(', ')
                            : typeof value === 'boolean'
                              ? yesNo(value, binding)
                              : typeof value === 'object'
                                ? JSON.stringify(value)
                                : String(value)}
                      </td>
                      <td title={isUrl(attribute?.source) ? attribute?.source : undefined}>
                        {describeSource(attribute?.source)}
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
          </tbody>
        </table>
      }
    />
  )
}
