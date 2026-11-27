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
import { GameExtraButtons } from './GameExtras'

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
  configure: (tab?: 'game') => void
}) {
  useLocale()
  const disabled = busy || !row.record || row.readonly || row.stopped || !!row.error
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
                    ) {
                      return
                    }
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
