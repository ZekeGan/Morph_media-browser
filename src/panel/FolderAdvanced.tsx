import { useState } from 'react'
import { Alert, Button, Checkbox, Group, Stack, Tabs, Text, Tooltip } from '@mantine/core'
import { t as tr } from '../i18n'
import { HelpTip } from '../common/HelpTip'
import type {
  CleanupPreview,
  CleanupResult,
  FolderRow,
  Request,
  Response,
} from '../../shared/model'
import { isNewerFormat } from '../../shared/upgrade'

// The scan boundary section: shown in the game tab for games, and in Advanced when a game was detected but the folder is not one by type.
export function FolderBoundary({
  row,
  disabled,
  boundary,
}: {
  row: FolderRow
  disabled: boolean
  boundary: (state: 'root' | 'not-game' | 'candidate', tool?: boolean) => void
}) {
  // R-508: a confirmed ROOT (game, or a tool, R-457) only shows what it is and the way back, no confirming again.
  const saved = row.record?.details?.boundary,
    confirmed = saved?.state === 'root',
    tool = confirmed && saved?.role === 'tool'
  const toolButton = (
    <Tooltip
      multiline
      maw={240}
      withArrow
      label={tr('把這個資料夾當成工具（程式）：資訊放在這一層，裡面的檔案受保護，不當成遊戲。')}
    >
      <Button
        size="xs"
        variant={!confirmed && row.boundary?.tool ? 'filled' : 'default'}
        disabled={disabled}
        onClick={() => boundary('root', true)}
      >
        {tr('設為工具資料夾')}
      </Button>
    </Tooltip>
  )
  const notThis = (
    <Tooltip
      multiline
      maw={240}
      withArrow
      label={
        tool
          ? tr('取消工具設定，當成一般資料夾；之後不再提示。')
          : tr('取消遊戲判定，當成一般資料夾；之後不再提示。')
      }
    >
      <Button size="xs" variant="subtle" disabled={disabled} onClick={() => boundary('not-game')}>
        {tool ? tr('這不是工具') : tr('這不是遊戲目錄')}
      </Button>
    </Tooltip>
  )
  return (
    <section className="settings-section">
      <Group gap={4} wrap="nowrap">
        <Text fw={600}>{tr('掃描範圍')}</Text>
        <HelpTip
          text={tr(
            '遊戲與工具資料夾裡的檔案很多，也不該被改動。所以只把它的主資料夾這一層當成一筆資料夾資訊，裡面的子資料夾受保護，不會被掃描或寫入。'
          )}
        />
      </Group>
      {confirmed ? (
        <>
          <Text size="sm" mt={4}>
            {tool
              ? tr('這個資料夾已設為工具資料夾，裡面的檔案受保護。')
              : tr('這個資料夾已確認為遊戲主資料夾，裡面的檔案受保護。')}
          </Text>
          {/* A tool becomes a game again by choosing the game type, so only the game offers the other way. */}
          <Group mt="sm">
            {!tool && toolButton}
            {notThis}
          </Group>
        </>
      ) : row.boundary ? (
        <>
          <Text size="sm" mt={4}>
            {row.boundary.engines.length
              ? tr('這個資料夾看起來是 {0} 遊戲。', row.boundary.engines.join('／'))
              : row.boundary.tool
                ? tr('這個資料夾看起來是工具（程式），沒有遊戲引擎的線索。')
                : tr('這個資料夾看起來像遊戲或封裝程式，但無法確定是哪種引擎。')}
          </Text>
          <Text size="xs" c="dimmed">
            {row.boundary.tool ? tr('請確認它是工具還是遊戲：') : tr('請確認它是不是遊戲：')}
          </Text>
          <Group mt="sm">
            {row.boundary.tool && toolButton}
            <Tooltip
              multiline
              maw={240}
              withArrow
              label={tr('把這個資料夾當成遊戲主資料夾：資訊放在這一層，裡面的檔案受保護。')}
            >
              <Button
                size="xs"
                variant={row.boundary.tool ? 'default' : 'filled'}
                disabled={disabled}
                onClick={() => boundary('root')}
              >
                {tr('確認為遊戲主資料夾')}
              </Button>
            </Tooltip>
            {!row.boundary.tool && toolButton}
            {notThis}
          </Group>
          {!!row.boundary.evidence.length && (
            <details className="boundary-evidence">
              <summary>{tr('判斷依據')}</summary>
              <ul>
                {/* The evidence is stored as the detector's zh-TW sentence; shown in the window's language. */}
                {row.boundary.evidence.map((item, index) => (
                  <li key={index}>{tr(item)}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <Group mt="sm">
          <Button size="xs" disabled={disabled} onClick={() => boundary('root')}>
            {tr('標記為遊戲主資料夾')}
          </Button>
          {toolButton}
        </Group>
      )}
    </section>
  )
}
// R-457: a folder nothing was detected in can still be made a tool by hand from its settings.
function ToolMark({
  disabled,
  boundary,
}: {
  disabled: boolean
  boundary: (state: 'root' | 'not-game' | 'candidate', tool?: boolean) => void
}) {
  return (
    <section className="settings-section">
      <Group gap={4} wrap="nowrap">
        <Text fw={600}>{tr('工具資料夾')}</Text>
        <HelpTip
          text={tr(
            '工具（程式）資料夾裡的檔案很多，也不該被改動。設為工具資料夾後，只把這一層當成一筆資料夾資訊，裡面的子資料夾受保護，不會被掃描或寫入。'
          )}
        />
      </Group>
      <Group mt="sm">
        <Button
          size="xs"
          variant="default"
          disabled={disabled}
          onClick={() => boundary('root', true)}
        >
          {tr('設為工具資料夾')}
        </Button>
      </Group>
    </section>
  )
}

// The folder settings "Advanced" tab: scan boundary, record recovery, stored attributes and the dangerous actions.
export function FolderAdvanced({
  row,
  disabled,
  busy,
  fieldDirty,
  showBoundary,
  showToolMark,
  boundary,
  act,
  error,
  setError,
}: {
  row: FolderRow
  disabled: boolean
  busy: boolean
  fieldDirty: boolean
  showBoundary: boolean
  // R-457: a folder with no boundary at all can be made a tool here.
  showToolMark?: boolean
  boundary: (state: 'root' | 'not-game' | 'candidate', tool?: boolean) => void
  act: (request: Request) => Promise<Response | undefined>
  error: string
  setError: (message: string) => void
}) {
  const [cleanup, setCleanup] = useState<CleanupPreview>(),
    [cleanupResult, setCleanupResult] = useState<CleanupResult>(),
    [restart, setRestart] = useState(false)
  const previewCleanup = async (scope: 'folder' | 'private' | 'tree') => {
    setCleanupResult(undefined)
    setRestart(false)
    const result = await act({ action: 'cleanupPreview', rowId: row.rowId, scope })
    if (result?.preview) setCleanup(result.preview)
  }
  return (
    <Tabs.Panel value="advanced" pt="md">
      <Stack>
        {showBoundary && <FolderBoundary row={row} disabled={disabled} boundary={boundary} />}
        {!showBoundary && showToolMark && <ToolMark disabled={disabled} boundary={boundary} />}
        {(row.stopped || row.duplicate || row.error) && (
          <section className="settings-section">
            <Text fw={600} mb="sm">
              {tr('資料夾資訊復原')}
            </Text>
            <Stack gap="xs">
              {row.stopped && (
                <Button
                  variant="default"
                  onClick={() => void act({ action: 'resume', rowId: row.rowId })}
                >
                  {tr('重新啟用記錄')}
                </Button>
              )}
              {row.duplicate && (
                <Button
                  color="orange"
                  onClick={() =>
                    window.confirm(tr('確認是副本？原值保留並分配新 ID。')) &&
                    void act({ action: 'copyIdentity', rowId: row.rowId })
                  }
                >
                  {tr('這筆是副本，另配新 ID')}
                </Button>
              )}
              {isNewerFormat(row.error) && (
                <Text size="sm" c="dimmed">
                  {tr(
                    '這些資料來自較新版本的 M:orph。在更新程式之前只能查看，不會寫入、復原或清除。'
                  )}
                </Text>
              )}
              {row.error && !row.duplicate && !isNewerFormat(row.error) && (
                <Button
                  color="orange"
                  variant="default"
                  onClick={() =>
                    window.confirm(tr('從上一個有效備份恢復？原檔會保留。')) &&
                    void act({ action: 'restore', rowId: row.rowId })
                  }
                >
                  {tr('從上一版備份恢復')}
                </Button>
              )}
            </Stack>
          </section>
        )}
        <details className="settings-section">
          <summary>{tr('技術細節（原始資料）')}</summary>
          <pre>{JSON.stringify(row.record, null, 2) ?? tr('沒有資料夾資訊')}</pre>
        </details>
        <section className="settings-section cleanup-section">
          <Text fw={600}>{tr('清除此資料夾的 M:orph 資訊')}</Text>
          <Group>
            <Button
              size="xs"
              variant="default"
              color="red"
              disabled={busy || fieldDirty || row.readonly}
              onClick={() => void previewCleanup('folder')}
            >
              {tr('預覽清除此資料夾資料')}
            </Button>
            {/* R-464: this folder and every folder below it (another project's root inside is left alone). */}
            <Button
              size="xs"
              variant="default"
              color="red"
              disabled={busy || fieldDirty || row.readonly}
              onClick={() => void previewCleanup('tree')}
            >
              {tr('預覽清除此資料夾與底下所有資料夾的資料')}
            </Button>
            {!!row.record?.projectOverrides[row.projectId]?.length && (
              <Button
                size="xs"
                variant="subtle"
                color="red"
                disabled={busy || fieldDirty}
                onClick={() => void previewCleanup('private')}
              >
                {tr('只清除這個專案的資訊')}
              </Button>
            )}
          </Group>
          {cleanup && (
            <Stack mt="md">
              <Alert color="orange" title={tr('清理預覽')}>
                {cleanup.scope === 'private'
                  ? tr('只移除目前專案的資訊')
                  : cleanup.scope === 'tree'
                    ? tr('移除此資料夾與底下所有資料夾的資訊與圖片（底下另一個專案的根目錄保留）')
                    : tr('移除此資料夾的資訊與圖片')}
                {tr('；共')}
                {cleanup.count} {tr('筆。未知檔案、離線與未連結副本不在範圍。')}
              </Alert>
              <div className="file-list">
                {cleanup.paths.map((p) => (
                  <div key={p}>{p}</div>
                ))}
              </div>
              {cleanup.skipped.map((s, i) => (
                <Text key={i} size="xs" c="dimmed">
                  {tr(s)}
                </Text>
              ))}
              {(cleanup.scope === 'folder' || cleanup.scope === 'tree') && (
                <Checkbox
                  label={tr('清除後立即重新開始記錄')}
                  description={tr('預設停止記錄，避免下次掃描立即建立資料。')}
                  checked={restart}
                  onChange={(e) => setRestart(e.currentTarget.checked)}
                />
              )}
              <Group justify="flex-end">
                <Button variant="default" disabled={busy} onClick={() => setCleanup(undefined)}>
                  {tr('取消清理')}
                </Button>
                <Button
                  color="red"
                  disabled={busy || fieldDirty}
                  loading={busy}
                  onClick={async () => {
                    const result = await act({
                      action: 'cleanup',
                      token: cleanup.token,
                      restart,
                    })
                    if (result?.cleanup) {
                      setCleanupResult(result.cleanup)
                      setCleanup(undefined)
                    } else {
                      setCleanup(undefined)
                      setError(tr('清理未完成，請重新預覽範圍後重試。'))
                    }
                  }}
                >
                  {tr('確認清除列出的 M:orph 資訊')}
                </Button>
              </Group>
            </Stack>
          )}
          {cleanupResult && (
            <Alert
              mt="md"
              color={cleanupResult.failed.length ? 'orange' : 'teal'}
              title={tr('已清理 ') + cleanupResult.removed + tr(' 筆')}
            >
              <Text size="sm">{tr('原始媒體保留。')}</Text>
              {[...cleanupResult.failed, ...cleanupResult.skipped].map((s, i) => (
                <Text size="xs" key={i}>
                  {s}
                </Text>
              ))}
            </Alert>
          )}
        </section>
      </Stack>
    </Tabs.Panel>
  )
}
