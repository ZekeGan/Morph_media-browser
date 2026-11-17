import { ActionIcon, Button, Group, Menu, Tooltip } from '@mantine/core'
import {
  gameActionTemplates,
  type ExplorerRequest,
  type ExplorerResponse,
  launchGap,
} from '../../shared/explorer'
import type { FolderRow, Project, Request, Response } from '../../shared/model'
import { Icon } from '../common/icons'
import { FolderPage } from '../panel/FolderPage'
import { GameExtraButtons } from './GameExtras'
import { t as tr, useLocale } from '../i18n'
import './game-actions.css'
import { useState } from 'react'
import { folderCoverPicture } from '../cells/folderCover'

// The page of a game main folder (R-389: the fill-ins of the shared folder page). Main visual: the cover; actions:
// confirming a possible game and the launch buttons. Its fields are in the folder details (R-390), which list every
// stored value here; nothing inside the game is listed.
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
  const cover = folderCoverPicture(row),
    [coverFailed, setCoverFailed] = useState('')
  const disabled = busy || !row.record || row.readonly || row.stopped || !!row.error
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
          {cover && coverFailed !== cover.src ? (
            <img src={cover.src} alt={cover.alt} onError={() => setCoverFailed(cover.src)} />
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
          {launchGap(project, row.record?.details?.targets) === 'target' && (
            <small className="muted game-launch-hint">
              {tr('尚未指定啟動檔，「啟動遊戲」按鈕暫時無法使用。')}{' '}
              <Button size="compact-xs" variant="subtle" onClick={() => configure('game')}>
                {tr('前往設定指定啟動檔')}
              </Button>
            </small>
          )}
        </>
      }
    />
  )
}
