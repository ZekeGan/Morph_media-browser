import { Button, Group, Text, Tooltip } from '@mantine/core'

import type { ExplorerRequest, ExplorerResponse, GameExtra } from '../../shared/explorer'
import type { FolderRow } from '../../shared/model'
import { metadataSources } from '../../shared/sources'

import { Icon } from '../common/icons'
import { t as tr } from '../i18n'
import { formatLastPlayed, formatPlayTime, usePlaytime } from './playtime'
import { useGameExtras } from './useGameExtras'

type Run = (request: ExplorerRequest) => Promise<ExplorerResponse | undefined>

// Buttons the game page offers on its own (R-305, R-307, R-310), after the bound actions.
export function GameExtraButtons({ row, busy, run }: { row: FolderRow; busy: boolean; run: Run }) {
  const extras = useGameExtras(row)
  // R-315: these buttons appear only after the eye in the game settings shows them.
  const shown = (extra: GameExtra) => !!row.record?.details?.shownExtras?.includes(extra)
  return (
    <>
      {extras?.steamAppId && shown('steam') && (
        <Tooltip
          label={
            extras.steamReady
              ? tr('透過 Steam 啟動，疊加介面與成就才會正常運作')
              : tr('這台電腦沒有安裝 Steam')
          }
        >
          <Button
            variant="default"
            disabled={busy || !extras.steamReady}
            leftSection={<Icon name="play" size={14} />}
            onClick={() => void run({ action: 'runExtra', rowId: row.rowId, extra: 'steam' })}
          >
            {tr('用 Steam 啟動')}
          </Button>
        </Tooltip>
      )}
      {extras?.storeUrl && shown('store') && (
        <Tooltip label={extras.storeUrl}>
          <Button
            variant="default"
            disabled={busy}
            leftSection={<Icon name="external" size={14} />}
            onClick={() => void run({ action: 'runExtra', rowId: row.rowId, extra: 'store' })}
          >
            {tr('在 {0} 開啟', extras.storeSite ?? '')}
          </Button>
        </Tooltip>
      )}
      {extras && extras.save !== 'none' && shown('save') && (
        <Tooltip label={tr('還沒有存檔')} disabled={extras.save !== 'pending'}>
          <Button
            variant="default"
            disabled={busy || extras.save === 'pending'}
            leftSection={<Icon name="folder" size={14} />}
            onClick={() => void run({ action: 'runExtra', rowId: row.rowId, extra: 'save' })}
          >
            {tr('開啟存檔資料夾')}
          </Button>
        </Tooltip>
      )}
    </>
  )
}

// R-308 / R-555: compact playtime line shown beneath the game action row.
export function GamePlaytime({ row }: { row: FolderRow }) {
  const play = usePlaytime(row.record?.folderId)
  if (!play) return null
  return (
    <small className="muted game-playtime" title={tr('{0} 次', play.count)}>
      {tr('遊玩時間 {0} · 最後遊玩 {1}', formatPlayTime(play.total), formatLastPlayed(play.last))}
    </small>
  )
}

// R-418: the engine an imported source names (VNDB's ENGINE) next to the one found in the folder; names are compared
// without case, spaces and punctuation.
const engineKey = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')

function engineComparison(row: FolderRow) {
  const imported = row.record?.attributes.find(
    (a) => /-engine$/.test(a.attributeId) && typeof a.value === 'string' && a.value.trim()
  )
  if (!imported) return undefined
  const value = String(imported.value).trim()
  const local = row.boundary?.engines ?? []
  const prefix = imported.attributeId.replace(/-engine$/, '')
  const site = metadataSources.find((source) => source.id === prefix)?.name ?? prefix
  return {
    site,
    value,
    local,
    differs: local.length > 0 && !local.some((name) => engineKey(name) === engineKey(value)),
  }
}

// R-555: Folder settings, game tab — save folder & engine comparison (extra buttons and suggestions live in the
// unified button list above).
export function GameExtraSettings({
  row,
  disabled,
  run,
}: {
  row: FolderRow
  disabled: boolean
  run: Run
}) {
  const extras = useGameExtras(row)
  if (!extras || !row.record) return null
  const revision = row.record.revision
  const engines = engineComparison(row)
  return (
    <section className="settings-section">
      <Group justify="space-between" wrap="wrap" align="flex-start" gap="xs">
        <div style={{ minWidth: 0, flex: '1 1 180px' }}>
          <Text fw={600} size="sm">
            {tr('存檔資料夾')}
          </Text>
          <Text size="xs" c="dimmed">
            {extras.save === 'engine'
              ? tr('依引擎推算（{0}）', extras.saveEngine ?? '')
              : extras.save === 'pending'
                ? tr('還沒有存檔（預計位置：{0}）', extras.saveEngine ?? '')
                : extras.save === 'user'
                  ? tr('你指定的資料夾')
                  : tr('推算不出來；可以自己指定')}
          </Text>
          {engines && (
            <Text size="xs" c={engines.differs ? 'orange' : 'dimmed'} mt={2}>
              {tr(
                '{0}：{1}｜本機：{2}',
                engines.site,
                engines.value,
                engines.local.join('／') || tr('未偵測到')
              )}
              {engines.differs && ' · ' + tr('兩邊的引擎名稱不同，請確認')}
            </Text>
          )}
        </div>
        <Group gap={6} wrap="wrap">
          {extras.save !== 'none' && (
            <Button
              size="compact-xs"
              variant="default"
              disabled={disabled || extras.save === 'pending'}
              onClick={() => void run({ action: 'runExtra', rowId: row.rowId, extra: 'save' })}
            >
              {tr('開啟')}
            </Button>
          )}
          <Button
            size="compact-xs"
            variant="default"
            disabled={disabled}
            onClick={() => void run({ action: 'chooseSaveFolder', rowId: row.rowId, revision })}
          >
            {tr('指定資料夾')}
          </Button>
          {extras.save === 'user' && (
            <Button
              size="compact-xs"
              variant="subtle"
              disabled={disabled}
              onClick={() =>
                void run({ action: 'chooseSaveFolder', rowId: row.rowId, revision, clear: true })
              }
            >
              {tr('改回自動')}
            </Button>
          )}
        </Group>
      </Group>
    </section>
  )
}
