import { ActionIcon, Button, Group, Tooltip } from '@mantine/core'

import {
  type ExplorerRequest,
  type ExplorerResponse,
  gameActionTemplates,
  launchGap,
} from '../../shared/explorer'
import type { FolderRow, Project, Request, Response } from '../../shared/model'

import { PanelCard } from '../cells/PanelContent'
import { Icon } from '../common/icons'
import { t as tr, useLocale } from '../i18n'
import { FolderPage } from '../panel/FolderPage'
import { kindIcon } from './GameActions'
import { GameExtraButtons, GamePlaytime } from './GameExtras'

import './game-actions.css'

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
  configure: (tab?: 'game' | 'images') => void
}) {
  useLocale()
  const disabled = busy || !row.record || row.readonly || row.stopped || !!row.error
  const templates = gameActionTemplates(project)
  // Only actions that are bound in this folder get a button; the eye in the folder settings can hide more.
  const boundTemplates = templates.filter(
    (t) =>
      row.record?.details?.targets?.[t.id]?.kind === t.kind &&
      !row.record?.details?.hiddenActions?.includes(t.id)
  )
  // R-555: first bound launch action takes primary emphasis; other actions use lightweight default style with icons.
  const primaryId = boundTemplates.find((t) => ['exe', 'file-app', 'shortcut'].includes(t.kind))?.id
  const gap = launchGap(project, row.record?.details?.targets)
  const noCover = !!row.record && !row.record.details?.bannerAssetId && !row.record.assets.length

  return (
    <FolderPage
      page="game"
      row={row}
      project={project}
      openFolder={() => void act({ action: 'open', rowId: row.rowId })}
      busy={busy}
      visual={
        // R-409, R-469: the right-panel layout chosen for games, else the built-in one (a wide cover with the name).
        <PanelCard
          project={project}
          row={row}
          kind="game"
          content={{ entries: [] }}
          open={() => void act({ action: 'open', rowId: row.rowId })}
        />
      }
      actions={
        <>
          {(row.boundary?.state === 'candidate' ||
            row.record?.details?.boundary?.state === 'candidate') &&
            row.record && (
              <Group className="game-candidate-actions" gap="xs">
                {/* R-469: the candidate note sits with the buttons that settle it. */}
                <small className="game-candidate" role="status">
                  {row.boundary?.tool
                    ? tr('可能是工具（程式），尚未確認')
                    : tr('可能是遊戲，尚未確認')}
                </small>
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
                {/* R-457: or a tool kept among the games: protected the same way, not shown as a game. */}
                <Button
                  size="xs"
                  variant={row.boundary?.tool ? 'filled' : 'default'}
                  disabled={disabled}
                  onClick={() =>
                    void run({
                      action: 'boundary',
                      rowId: row.rowId,
                      revision: row.record!.revision,
                      state: 'root',
                      tool: true,
                    })
                  }
                >
                  {tr('這是工具')}
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
          <Group className="game-actions" gap="xs">
            {/* R-555: in-place primary prompt when no launch target is bound yet. */}
            {gap === 'target' && (
              <Button
                variant="light"
                leftSection={<Icon name="play" size={14} />}
                onClick={() => configure('game')}
              >
                {tr('指定啟動檔')}
              </Button>
            )}
            {gap === 'action' && (
              <Button
                variant="light"
                leftSection={<Icon name="plus" size={14} />}
                onClick={() => configure('game')}
              >
                {tr('新增啟動操作')}
              </Button>
            )}
            {boundTemplates.map((t) => {
              const primary = t.id === primaryId
              return (
                <Button
                  key={t.id}
                  variant={primary ? 'filled' : 'default'}
                  color={primary ? t.color : undefined}
                  disabled={busy}
                  leftSection={<Icon name={kindIcon(t.kind)} size={14} />}
                  title={row.record?.details?.targets?.[t.id]?.path}
                  onClick={() => {
                    if (
                      ['exe', 'file-app', 'shortcut'].includes(t.kind) &&
                      !window.confirm(tr('啟動「{0}」？', tr(t.label)))
                    ) {
                      return
                    }
                    void run({ action: 'runTarget', rowId: row.rowId, templateId: t.id })
                  }}
                >
                  {tr(t.label)}
                </Button>
              )
            })}
            <GameExtraButtons row={row} busy={busy} run={run} />
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
          <GamePlaytime row={row} />
          {noCover && (
            <Group className="game-launch-hint" gap="xs" wrap="wrap">
              <Button size="compact-xs" variant="subtle" onClick={() => configure('images')}>
                {tr('補上封面')}
              </Button>
            </Group>
          )}
        </>
      }
    />
  )
}
