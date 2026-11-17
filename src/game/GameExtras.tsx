import { ActionIcon, Badge, Button, Group, Stack, Text, Tooltip } from '@mantine/core'
import type { ExplorerRequest, ExplorerResponse, GameExtra } from '../../shared/explorer'
import type { FolderRow } from '../../shared/model'
import { metadataSources } from '../../shared/sources'
import { t as tr } from '../i18n'
import { Icon } from '../common/icons'
import { HelpTip } from '../common/HelpTip'
import { useGameExtras } from './useGameExtras'
import { formatLastPlayed, formatPlayTime, usePlaytime } from './playtime'

type Run = (request: ExplorerRequest) => Promise<ExplorerResponse | undefined>

// Buttons the game page offers on its own (R-305, R-307, R-310), after the bound actions, and the play time (R-308).
export function GameExtraButtons({ row, busy, run }: { row: FolderRow; busy: boolean; run: Run }) {
  const extras = useGameExtras(row)
  const play = usePlaytime(row.record?.folderId)
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
      {play && (
        <small className="muted game-playtime" title={tr('{0} 次', play.count)}>
          {tr(
            '遊玩時間 {0} · 最後遊玩 {1}',
            formatPlayTime(play.total),
            formatLastPlayed(play.last)
          )}
        </small>
      )}
    </>
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
  const value = String(imported.value).trim(),
    local = row.boundary?.engines ?? [],
    prefix = imported.attributeId.replace(/-engine$/, ''),
    site = metadataSources.find((source) => source.id === prefix)?.name ?? prefix
  return {
    site,
    value,
    local,
    differs: local.length > 0 && !local.some((name) => engineKey(name) === engineKey(value)),
  }
}

// Folder settings, game tab: the save folder and the bundled tools and manuals that can become buttons.
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
  const revision = row.record.revision,
    engines = engineComparison(row)
  const offered: { extra: GameExtra; label: string }[] = [
    ...(extras.steamAppId ? [{ extra: 'steam' as const, label: tr('用 Steam 啟動') }] : []),
    ...(extras.storeUrl
      ? [{ extra: 'store' as const, label: tr('在 {0} 開啟', extras.storeSite ?? '') }]
      : []),
    ...(extras.save !== 'none' ? [{ extra: 'save' as const, label: tr('開啟存檔資料夾') }] : []),
  ]
  return (
    <Stack gap="sm">
      {offered.length > 0 && (
        <section className="settings-section">
          <Group gap={4} wrap="nowrap" mb="xs">
            <Text fw={600}>{tr('其他按鈕')}</Text>
            <HelpTip text={tr('預設不顯示在遊戲的按鈕列；按眼睛顯示。')} />
          </Group>
          <Stack gap={4}>
            {offered.map(({ extra, label }) => {
              const visible = !!row.record?.details?.shownExtras?.includes(extra)
              return (
                <Group key={extra} justify="space-between" wrap="nowrap">
                  <Text size="sm">{label}</Text>
                  <Tooltip
                    label={
                      visible
                        ? tr('此遊戲的按鈕列顯示這個按鈕，點擊隱藏')
                        : tr('此遊戲的按鈕列不顯示這個按鈕，點擊顯示')
                    }
                  >
                    <ActionIcon
                      variant="subtle"
                      color={visible ? undefined : 'gray'}
                      aria-label={visible ? tr('隱藏按鈕 {0}', label) : tr('顯示按鈕 {0}', label)}
                      aria-pressed={visible}
                      disabled={disabled}
                      onClick={() =>
                        void run({
                          action: 'actionVisible',
                          rowId: row.rowId,
                          revision,
                          templateId: 'extra-' + extra,
                          visible: !visible,
                        })
                      }
                    >
                      <Icon name={visible ? 'eye' : 'eye-off'} size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              )
            })}
          </Stack>
        </section>
      )}
      <section className="settings-section">
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text fw={600}>{tr('存檔資料夾')}</Text>
            <Text size="sm" c="dimmed">
              {extras.save === 'engine'
                ? tr('依引擎推算（{0}）', extras.saveEngine ?? '')
                : extras.save === 'pending'
                  ? tr('還沒有存檔（依引擎推算：{0}）', extras.saveEngine ?? '')
                  : extras.save === 'user'
                    ? tr('你指定的資料夾')
                    : tr('推算不出來；可以自己指定')}
            </Text>
            {engines && (
              <Text size="sm" c={engines.differs ? 'orange' : 'dimmed'}>
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
          <Group gap={6} wrap="nowrap">
            {extras.save !== 'none' && (
              <Button
                size="xs"
                variant="default"
                disabled={disabled || extras.save === 'pending'}
                onClick={() => void run({ action: 'runExtra', rowId: row.rowId, extra: 'save' })}
              >
                {tr('開啟')}
              </Button>
            )}
            <Button
              size="xs"
              variant="default"
              disabled={disabled}
              onClick={() => void run({ action: 'chooseSaveFolder', rowId: row.rowId, revision })}
            >
              {tr('指定資料夾')}
            </Button>
            {extras.save === 'user' && (
              <Button
                size="xs"
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
      {extras.suggestions.length > 0 && (
        <section className="settings-section">
          <Group gap={4} wrap="nowrap" mb="xs">
            <Text fw={600}>{tr('附帶的程式與說明書')}</Text>
            <HelpTip
              text={tr(
                '在遊戲資料夾找到的設定程式與說明書；按「加入」才會變成操作按鈕，不會自動執行。'
              )}
            />
          </Group>
          <Stack gap={6}>
            {extras.suggestions.map((item) => (
              <Group key={item.name} justify="space-between" wrap="nowrap">
                <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                  <Badge variant="light" color={item.role === 'config' ? 'blue' : 'gray'}>
                    {item.role === 'config' ? tr('設定程式') : tr('說明書')}
                  </Badge>
                  <Text size="sm" className="path" title={item.name}>
                    {item.name}
                  </Text>
                </Group>
                <Button
                  size="xs"
                  variant="light"
                  disabled={disabled}
                  aria-label={tr('加入 {0}', item.name)}
                  onClick={() =>
                    void run({
                      action: 'addSuggestion',
                      rowId: row.rowId,
                      revision,
                      name: item.name,
                    })
                  }
                >
                  {tr('加入')}
                </Button>
              </Group>
            ))}
          </Stack>
        </section>
      )}
    </Stack>
  )
}
