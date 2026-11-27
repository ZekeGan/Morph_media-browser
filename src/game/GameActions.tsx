import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { useEffect, useState } from 'react'

import {
  type ActionKind,
  type ActionTemplate,
  type ExplorerRequest,
  type ExplorerResponse,
  gameActionTemplates,
} from '../../shared/explorer'
import { parseLaunchArgs } from '../../shared/launchArgs'
import type { FolderRow, Project } from '../../shared/model'

import { Icon } from '../common/icons'
import { t as tr } from '../i18n'
import { describeError } from '../notices/errors'
import { useGameExtras } from './useGameExtras'

import './game-actions.css'

export const kindLabel = (kind: ActionKind) =>
  ({
    exe: tr('啟動程式或啟動檔'),
    folder: tr('開啟資料夾'),
    'file-app': tr('以指定應用程式開啟檔案'),
    url: tr('開啟網址'),
    shortcut: tr('執行資料夾內的捷徑'),
    file: tr('開啟資料夾內的檔案'),
  })[kind]

const exampleArgs = '["-run","D:\\\\Games\\\\Title\\\\game.exe"]'

function parseArgs(text: string): string[] {
  const parsed = parseLaunchArgs(text)
  if (!parsed) {
    throw new Error(
      tr('啟動參數格式不正確。請用 JSON 字串陣列，每一項各用雙引號，例如：') + ' ' + exampleArgs
    )
  }
  return parsed
}

export function GameActionTargets({
  row,
  project,
  disabled,
  run,
  onDirty,
}: {
  row: FolderRow
  project: Project
  disabled: boolean
  run: (request: ExplorerRequest) => Promise<ExplorerResponse | undefined>
  onDirty: (dirty: boolean) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, { args: string; url: string }>>({})
  const [error, setError] = useState('')
  const [shortcuts, setShortcuts] = useState<string[]>()
  const [choice, setChoice] = useState<Record<string, string>>({})
  const templates = gameActionTemplates(project)
  const extras = useGameExtras(row)
  const localeReady = extras?.localeEmulator
  const wantsShortcuts = templates.some((t) => t.kind === 'shortcut')
  // The folder's own shortcuts (.lnk/.url), e.g. one made by Locale Emulator, are listed for picking.
  useEffect(() => {
    if (!wantsShortcuts) return
    let alive = true
    // A plain read: it must not be skipped while another operation is busy (the busy-gated runner would drop it).
    void window.explorer
      .request({ action: 'listShortcuts', rowId: row.rowId })
      .then((result) => {
        if (alive) setShortcuts(result.shortcuts ?? [])
      })
      .catch(() => {
        if (alive) setShortcuts([])
      })
    return () => {
      alive = false
    }
  }, [wantsShortcuts, row.rowId])
  const original = (id: string) => ({
    args: JSON.stringify(row.record?.details?.targets?.[id]?.args ?? []),
    url:
      row.record?.details?.targets?.[id]?.kind === 'url' ? row.record.details.targets[id].path : '',
  })
  const dirty = templates.some(
    (t) => drafts[t.id] && JSON.stringify(drafts[t.id]) !== JSON.stringify(original(t.id))
  )
  useEffect(() => {
    onDirty(dirty)
    return () => onDirty(false)
  }, [dirty, onDirty])
  const edit = (id: string, key: 'args' | 'url', value: string) =>
    setDrafts((previous) => ({
      ...previous,
      [id]: { ...(previous[id] ?? original(id)), [key]: value },
    }))
  const reset = (id: string) =>
    setDrafts((previous) => {
      const next = { ...previous }
      delete next[id]
      return next
    })
  const bind = async (template: ActionTemplate) => {
    try {
      const draft = drafts[template.id] ?? original(template.id)
      const args = ['exe', 'file-app'].includes(template.kind) ? parseArgs(draft.args) : []
      const response = await run({
        action: 'bindTarget',
        rowId: row.rowId,
        revision: row.record!.revision,
        templateId: template.id,
        args,
        url: template.kind === 'url' ? draft.url.trim() : undefined,
        shortcut: template.kind === 'shortcut' ? choice[template.id] : undefined,
      })
      if (response && !response.cancelled) reset(template.id)
      setError('')
    } catch (e) {
      setError(describeError(e).message)
    }
  }
  return (
    <Stack gap="sm">
      {error && (
        <Alert color="orange" withCloseButton onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {templates.map((template) => {
        const target = row.record?.details?.targets?.[template.id]
        const draft = drafts[template.id] ?? original(template.id)
        const changed = JSON.stringify(draft) !== JSON.stringify(original(template.id))
        const bound = target?.kind === template.kind
        const hiddenHere = !!row.record?.details?.hiddenActions?.includes(template.id)
        return (
          <section
            className={'settings-section game-target' + (bound ? '' : ' unbound')}
            key={template.id}
          >
            <Group justify="space-between" wrap="nowrap">
              <Text fw={600}>{tr(template.label)}</Text>
              <Group gap={6} wrap="nowrap">
                <Text size="xs" c="dimmed">
                  {kindLabel(template.kind)}
                </Text>
                <Tooltip label={tr('測試啟動')}>
                  <ActionIcon
                    variant="subtle"
                    aria-label={tr('測試啟動 {0}', tr(template.label))}
                    disabled={disabled || !bound}
                    onClick={() => {
                      if (
                        ['exe', 'file-app', 'shortcut'].includes(template.kind) &&
                        !window.confirm(tr('啟動「{0}」？', tr(template.label)))
                      ) {
                        return
                      }
                      void run({
                        action: 'runTarget',
                        rowId: row.rowId,
                        templateId: template.id,
                      })
                    }}
                  >
                    <Icon name="play" size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip
                  label={
                    !bound
                      ? tr('還沒選要開的檔案，所以遊戲頁不會出現這顆按鈕')
                      : hiddenHere
                        ? tr('目前隱藏，點一下顯示')
                        : tr('目前顯示，點一下隱藏')
                  }
                >
                  <ActionIcon
                    variant="subtle"
                    color={hiddenHere ? 'gray' : undefined}
                    aria-label={
                      hiddenHere
                        ? tr('顯示按鈕 {0}', tr(template.label))
                        : tr('隱藏按鈕 {0}', tr(template.label))
                    }
                    aria-pressed={!hiddenHere}
                    disabled={disabled || !bound}
                    onClick={() =>
                      void run({
                        action: 'actionVisible',
                        rowId: row.rowId,
                        revision: row.record!.revision,
                        templateId: template.id,
                        visible: hiddenHere,
                      })
                    }
                  >
                    <Icon name={hiddenHere ? 'eye-off' : 'eye'} size={16} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
            {['exe', 'folder', 'file-app', 'file'].includes(template.kind) && (
              <Text size="sm" c="dimmed" className="path-line" title={target?.path}>
                {target?.kind === template.kind ? target.path : tr('還沒選要開的檔案')}
              </Text>
            )}
            {template.kind === 'url' ? (
              <TextInput
                label={tr('網址')}
                value={draft.url}
                placeholder="https://"
                disabled={disabled}
                onChange={(e) => edit(template.id, 'url', e.currentTarget.value)}
              />
            ) : template.kind === 'shortcut' ? (
              <>
                <Text size="sm" c="dimmed" className="path">
                  {target?.kind === 'shortcut' ? target.path : tr('還沒選要開的檔案')}
                </Text>
                <Select
                  comboboxProps={{ zIndex: 460 }}
                  label={tr('選擇資料夾內的捷徑')}
                  placeholder={
                    shortcuts && !shortcuts.length
                      ? tr('此資料夾內沒有捷徑（.lnk／.url）')
                      : tr('選擇捷徑')
                  }
                  data={shortcuts ?? []}
                  value={choice[template.id] ?? null}
                  disabled={disabled || !shortcuts?.length}
                  nothingFoundMessage={tr('此資料夾內沒有捷徑（.lnk／.url）')}
                  onChange={(value) => setChoice({ ...choice, [template.id]: value ?? '' })}
                />
              </>
            ) : null}
            {target?.kind === 'file-app' && target.application && (
              <Text size="xs" c="dimmed" className="path">
                {tr('應用程式')} · {target.application.path}
              </Text>
            )}
            {template.kind === 'exe' && bound && (
              // R-319: Locale Emulator's default (Japanese) or one of the profiles made in it.
              <Select
                label={tr('用 Locale Emulator 啟動')}
                description={
                  localeReady === false
                    ? tr('先到「應用程式設定」指定 LEProc.exe 才能使用')
                    : undefined
                }
                allowDeselect={false}
                value={
                  target?.localeEmulator === true ? 'default' : (target?.localeEmulator ?? 'off')
                }
                disabled={disabled || (localeReady === false && !target?.localeEmulator)}
                data={[
                  { value: 'off', label: tr('不使用') },
                  { value: 'default', label: tr('日文（預設）') },
                  ...(extras?.localeProfiles ?? []).map((profile) => ({
                    value: profile.guid,
                    label: profile.name,
                  })),
                  // A saved profile that is no longer in Locale Emulator stays visible until changed.
                  ...(typeof target?.localeEmulator === 'string' &&
                  !extras?.localeProfiles?.some((p) => p.guid === target.localeEmulator)
                    ? [{ value: target.localeEmulator, label: tr('找不到的設定檔') }]
                    : []),
                ]}
                onChange={(value) =>
                  void run({
                    action: 'targetLocale',
                    rowId: row.rowId,
                    revision: row.record!.revision,
                    templateId: template.id,
                    value: value === 'default' ? true : value === 'off' || !value ? false : value,
                  })
                }
              />
            )}
            {['exe', 'file-app'].includes(template.kind) && (
              <Textarea
                label={tr('啟動參數（JSON 字串陣列）')}
                value={draft.args}
                disabled={disabled}
                onChange={(e) => edit(template.id, 'args', e.currentTarget.value)}
                placeholder={tr('["--fullscreen", "含空白的值"]')}
                autosize
                minRows={1}
              />
            )}
            <Group gap="xs">
              <Button
                variant="default"
                size="xs"
                disabled={disabled || (template.kind === 'shortcut' && !choice[template.id])}
                onClick={() => void bind(template)}
              >
                {template.kind === 'url'
                  ? tr('保存網址')
                  : template.kind === 'shortcut'
                    ? tr('使用這個捷徑')
                    : template.kind === 'file'
                      ? tr('選擇遊戲資料夾內的檔案')
                      : template.kind === 'file-app'
                        ? tr('選擇應用程式與檔案')
                        : template.kind === 'exe'
                          ? tr('選擇啟動檔並保存參數')
                          : tr('選擇資料夾')}
              </Button>
              {changed && (
                <Button
                  variant="subtle"
                  size="xs"
                  disabled={disabled}
                  onClick={() => reset(template.id)}
                >
                  {tr('取消變更')}
                </Button>
              )}
            </Group>
          </section>
        )
      })}
    </Stack>
  )
}

// R-385, R-409: a new game action is added where it is used, from the launch component in the layout editor: a name
// and what it does. It joins the project's actions (binding a target stays in each folder's settings).
export function NewGameAction({
  disabled,
  onAdd,
}: {
  disabled: boolean
  onAdd: (template: ActionTemplate) => void
}) {
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<ActionKind>('exe')
  return (
    <Stack gap={6} className="new-game-action">
      <TextInput
        size="xs"
        label={tr('新增遊戲操作')}
        placeholder={tr('按鈕文字')}
        aria-label={tr('新操作的按鈕文字')}
        value={label}
        maxLength={100}
        disabled={disabled}
        onChange={(e) => setLabel(e.currentTarget.value)}
      />
      <Group gap={6} wrap="nowrap" align="flex-end">
        <Select
          size="xs"
          style={{ flex: 1 }}
          aria-label={tr('新操作的類型')}
          allowDeselect={false}
          value={kind}
          disabled={disabled}
          data={(['exe', 'folder', 'file-app', 'url', 'shortcut', 'file'] as const).map(
            (value) => ({ value, label: kindLabel(value) })
          )}
          onChange={(value) => value && setKind(value as ActionKind)}
        />
        <Button
          size="xs"
          variant="light"
          disabled={disabled || !label.trim()}
          onClick={() => {
            onAdd({ id: crypto.randomUUID(), label: label.trim(), kind, color: '#168c77' })
            setLabel('')
          }}
        >
          {tr('新增')}
        </Button>
      </Group>
    </Stack>
  )
}
