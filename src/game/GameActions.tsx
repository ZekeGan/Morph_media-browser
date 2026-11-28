import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Select,
  Stack,
  Text,
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
  type GameExtra,
  launchTemplates,
} from '../../shared/explorer'
import { formatLaunchArgs, parseLaunchArgs } from '../../shared/launchArgs'
import type { FolderRow, Project } from '../../shared/model'

import { HelpTip } from '../common/HelpTip'
import { Icon, type IconName } from '../common/icons'
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

export const kindIcon = (kind: ActionKind): IconName =>
  ({
    exe: 'play',
    folder: 'folder',
    'file-app': 'play',
    url: 'external',
    shortcut: 'play',
    file: 'file',
  })[kind] as IconName

function parseArgs(text: string): string[] {
  const parsed = parseLaunchArgs(text)
  if (!parsed) {
    throw new Error(tr('參數格式不正確，請檢查雙引號是否成對閉合。'))
  }
  return parsed
}

function targetBasename(kind: ActionKind, targetPath: string): string {
  if (kind === 'url') return targetPath
  const parts = targetPath.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? targetPath
}

export function GameActionTargets({
  row,
  project,
  disabled,
  run,
  onDirty,
  onAddAction,
  canAddAction = false,
}: {
  row: FolderRow
  project: Project
  disabled: boolean
  run: (request: ExplorerRequest) => Promise<ExplorerResponse | undefined>
  onDirty: (dirty: boolean) => void
  onAddAction?: (template: ActionTemplate) => void
  canAddAction?: boolean
}) {
  const [drafts, setDrafts] = useState<Record<string, { args: string; url: string }>>({})
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showAdd, setShowAdd] = useState(false)
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
    args: formatLaunchArgs(row.record?.details?.targets?.[id]?.args ?? []),
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
  const toggleExpand = (id: string) =>
    setExpanded((previous) => ({ ...previous, [id]: !previous[id] }))

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
      if (response && !response.cancelled) {
        reset(template.id)
        if (template.kind === 'url' || template.kind === 'shortcut') {
          setExpanded((previous) => ({ ...previous, [template.id]: false }))
        }
      }
      setError('')
    } catch (e) {
      setError(describeError(e).message)
    }
  }

  const saveArgsOnly = async (template: ActionTemplate) => {
    try {
      const draft = drafts[template.id] ?? original(template.id)
      const args = parseArgs(draft.args)
      const response = await run({
        action: 'targetArgs',
        rowId: row.rowId,
        revision: row.record!.revision,
        templateId: template.id,
        args,
      })
      if (response) reset(template.id)
      setError('')
    } catch (e) {
      setError(describeError(e).message)
    }
  }

  const unbind = async (template: ActionTemplate) => {
    try {
      const response = await run({
        action: 'unbindTarget',
        rowId: row.rowId,
        revision: row.record!.revision,
        templateId: template.id,
      })
      if (response) {
        reset(template.id)
        setExpanded((previous) => ({ ...previous, [template.id]: false }))
      }
      setError('')
    } catch (e) {
      setError(describeError(e).message)
    }
  }

  const isBound = (template: ActionTemplate) =>
    row.record?.details?.targets?.[template.id]?.kind === template.kind
  const primaryLaunchId = launchTemplates(project)[0]?.id
  // R-555: bound actions and an unbound primary launch action stay at the top; other unbound project templates fold.
  const activeTemplates = templates.filter((t) => isBound(t) || t.id === primaryLaunchId)
  const unboundTemplates = templates.filter((t) => !isBound(t) && t.id !== primaryLaunchId)

  const offeredExtras: {
    extra: GameExtra
    label: string
    icon: IconName
    meta: string
    canRun: boolean
    tip?: string
  }[] = extras
    ? [
        ...(extras.steamAppId
          ? [
              {
                extra: 'steam' as const,
                label: tr('用 Steam 啟動'),
                icon: 'play' as const,
                meta: tr('自動偵測'),
                canRun: extras.steamReady,
                tip: extras.steamReady ? undefined : tr('這台電腦沒有安裝 Steam'),
              },
            ]
          : []),
        ...(extras.storeUrl
          ? [
              {
                extra: 'store' as const,
                label: tr('在 {0} 開啟', extras.storeSite ?? ''),
                icon: 'external' as const,
                meta: tr('自動偵測'),
                canRun: true,
              },
            ]
          : []),
        ...(extras.save !== 'none'
          ? [
              {
                extra: 'save' as const,
                label: tr('開啟存檔資料夾'),
                icon: 'folder' as const,
                meta:
                  extras.save === 'pending'
                    ? tr('還沒有存檔')
                    : extras.save === 'user'
                      ? tr('你指定的資料夾')
                      : tr('依引擎推算（{0}）', extras.saveEngine ?? ''),
                canRun: extras.save !== 'pending',
                tip: extras.save === 'pending' ? tr('還沒有存檔') : undefined,
              },
            ]
          : []),
      ]
    : []

  const renderTemplateRow = (template: ActionTemplate, pinnedPrimaryUnbound = false) => {
    const target = row.record?.details?.targets?.[template.id]
    const draft = drafts[template.id] ?? original(template.id)
    const argsChanged = draft.args !== original(template.id).args
    const urlChanged = draft.url !== original(template.id).url
    const bound = target?.kind === template.kind
    const hiddenHere = !!row.record?.details?.hiddenActions?.includes(template.id)
    const isOpen = !!expanded[template.id]
    const hasArgs = !!target?.args?.length
    const hasLocale = template.kind === 'exe' && !!target?.localeEmulator
    const inlineEditorKind = template.kind === 'url' || template.kind === 'shortcut'

    return (
      <div
        className={
          'game-action-row' +
          (bound ? '' : ' unbound') +
          (pinnedPrimaryUnbound ? ' primary-unbound' : '') +
          (isOpen ? ' expanded' : '')
        }
        key={template.id}
      >
        <div className="game-action-main">
          <Icon name={kindIcon(template.kind)} size={15} className="game-action-icon" />
          <div className="game-action-info">
            <Group gap={6} wrap="nowrap">
              <Text size="sm" fw={600} truncate>
                {tr(template.label)}
              </Text>
              {hasArgs && (
                <Badge size="xs" variant="light" color="gray">
                  {tr('已設參數')}
                </Badge>
              )}
              {hasLocale && (
                <Badge size="xs" variant="light" color="teal">
                  LE
                </Badge>
              )}
            </Group>
            <Text
              size="xs"
              c="dimmed"
              truncate
              title={bound ? target.path : kindLabel(template.kind)}
            >
              {bound ? targetBasename(template.kind, target.path) : tr('還沒選要開的檔案')}
            </Text>
          </div>
          <Group gap={4} wrap="nowrap" className="game-action-controls">
            {bound && (
              <>
                <Tooltip label={tr('測試啟動')}>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    aria-label={tr('測試啟動 {0}', tr(template.label))}
                    disabled={disabled}
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
                    <Icon name="play" size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip
                  label={hiddenHere ? tr('目前隱藏，點一下顯示') : tr('目前顯示，點一下隱藏')}
                >
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color={hiddenHere ? 'gray' : undefined}
                    aria-label={
                      hiddenHere
                        ? tr('顯示按鈕 {0}', tr(template.label))
                        : tr('隱藏按鈕 {0}', tr(template.label))
                    }
                    aria-pressed={!hiddenHere}
                    disabled={disabled}
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
                    <Icon name={hiddenHere ? 'eye-off' : 'eye'} size={14} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
            {inlineEditorKind ? (
              <Button
                size="compact-xs"
                variant={bound ? 'subtle' : 'light'}
                disabled={disabled}
                onClick={() => toggleExpand(template.id)}
              >
                {bound ? tr('編輯') : tr('設定')}
              </Button>
            ) : (
              <Button
                size="compact-xs"
                variant={bound ? 'subtle' : pinnedPrimaryUnbound ? 'light' : 'default'}
                disabled={disabled}
                onClick={() => void bind(template)}
              >
                {bound ? tr('更換') : tr('選檔')}
              </Button>
            )}
            {!inlineEditorKind && (bound || ['exe', 'file-app'].includes(template.kind)) && (
              <Tooltip label={tr('進階設定')}>
                <ActionIcon
                  size="sm"
                  variant="subtle"
                  aria-label={tr('進階設定 {0}', tr(template.label))}
                  aria-expanded={isOpen}
                  disabled={disabled}
                  onClick={() => toggleExpand(template.id)}
                >
                  <Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        </div>

        {isOpen && (
          <Stack gap="xs" className="game-action-drawer">
            {bound && template.kind !== 'url' && (
              <Text size="xs" c="dimmed" className="path-line" title={target.path}>
                {target.path}
              </Text>
            )}
            {target?.kind === 'file-app' && target.application && (
              <Text size="xs" c="dimmed" className="path">
                {tr('應用程式')} · {target.application.path}
              </Text>
            )}

            {template.kind === 'url' && (
              <Group gap="xs" align="flex-end" wrap="wrap">
                <TextInput
                  style={{ flex: 1, minWidth: 160 }}
                  size="xs"
                  label={tr('網址')}
                  value={draft.url}
                  placeholder="https://"
                  disabled={disabled}
                  onChange={(e) => edit(template.id, 'url', e.currentTarget.value)}
                />
                <Button
                  size="xs"
                  variant="light"
                  disabled={disabled || !draft.url.trim()}
                  onClick={() => void bind(template)}
                >
                  {tr('保存網址')}
                </Button>
                {urlChanged && (
                  <Button
                    size="xs"
                    variant="subtle"
                    disabled={disabled}
                    onClick={() => reset(template.id)}
                  >
                    {tr('取消變更')}
                  </Button>
                )}
              </Group>
            )}

            {template.kind === 'shortcut' && (
              <Group gap="xs" align="flex-end" wrap="wrap">
                <Select
                  style={{ flex: 1, minWidth: 160 }}
                  size="xs"
                  comboboxProps={{ zIndex: 460 }}
                  label={tr('選擇資料夾內的捷徑')}
                  placeholder={
                    shortcuts && !shortcuts.length
                      ? tr('此資料夾內沒有捷徑（.lnk／.url）')
                      : tr('選擇捷徑')
                  }
                  data={shortcuts ?? []}
                  value={choice[template.id] ?? (target?.kind === 'shortcut' ? target.path : null)}
                  disabled={disabled || !shortcuts?.length}
                  nothingFoundMessage={tr('此資料夾內沒有捷徑（.lnk／.url）')}
                  onChange={(value) => setChoice({ ...choice, [template.id]: value ?? '' })}
                />
                <Button
                  size="xs"
                  variant="light"
                  disabled={disabled || !choice[template.id]}
                  onClick={() => void bind(template)}
                >
                  {tr('使用這個捷徑')}
                </Button>
              </Group>
            )}

            {['exe', 'file-app'].includes(template.kind) && (
              <Stack gap={6}>
                <Group gap="xs" align="flex-end" wrap="wrap">
                  <TextInput
                    style={{ flex: 1, minWidth: 160 }}
                    size="xs"
                    label={tr('啟動參數')}
                    description={tr('空白分隔，含空白請加雙引號')}
                    value={draft.args}
                    disabled={disabled}
                    onChange={(e) => edit(template.id, 'args', e.currentTarget.value)}
                    placeholder='--fullscreen "save dir"'
                  />
                  {bound && (
                    <Button
                      size="xs"
                      variant="light"
                      disabled={disabled || !argsChanged}
                      onClick={() => void saveArgsOnly(template)}
                    >
                      {tr('儲存參數')}
                    </Button>
                  )}
                  {argsChanged && (
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={disabled}
                      onClick={() => reset(template.id)}
                    >
                      {tr('取消變更')}
                    </Button>
                  )}
                </Group>
              </Stack>
            )}

            {template.kind === 'exe' && bound && (
              // R-319: Locale Emulator's default (Japanese) or one of the profiles made in it.
              <Select
                size="xs"
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

            {bound && (
              <Group justify="flex-end">
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="red"
                  disabled={disabled}
                  onClick={() => void unbind(template)}
                >
                  {tr('清除目標')}
                </Button>
              </Group>
            )}
          </Stack>
        )}
      </div>
    )
  }

  return (
    <Stack gap="sm">
      {error && (
        <Alert color="orange" withCloseButton onClose={() => setError('')}>
          {error}
        </Alert>
      )}

      <section className="settings-section game-actions-panel">
        <Group justify="space-between" wrap="nowrap" mb="xs">
          <Group gap={4} wrap="nowrap">
            <Text fw={600}>{tr('遊戲頁按鈕')}</Text>
            <HelpTip text={tr('點選檔設定目標，按眼睛切換遊戲頁顯示。')} />
          </Group>
          {onAddAction && (
            <Button
              size="compact-xs"
              variant={showAdd ? 'light' : 'subtle'}
              leftSection={<Icon name="plus" size={13} />}
              disabled={!showAdd && !canAddAction}
              onClick={() => setShowAdd((open) => !open)}
            >
              {tr('新增操作')}
            </Button>
          )}
        </Group>

        {showAdd && onAddAction && (
          <Stack gap={6} className="game-add-inline" mb="xs">
            <Text size="xs" c="dimmed">
              {tr('此操作會加入專案共用清單，其他遊戲也能使用。')}
            </Text>
            <NewGameAction
              disabled={!canAddAction}
              onAdd={(template) => {
                onAddAction(template)
                setShowAdd(false)
              }}
            />
          </Stack>
        )}

        <Stack gap={4} className="game-action-list">
          {activeTemplates.map((template) =>
            renderTemplateRow(template, !isBound(template) && template.id === primaryLaunchId)
          )}

          {offeredExtras.map(({ extra, label, icon, meta, canRun, tip }) => {
            const visible = !!row.record?.details?.shownExtras?.includes(extra)
            return (
              <div
                key={'extra-' + extra}
                className={'game-action-row extra' + (visible ? '' : ' hidden-row')}
              >
                <div className="game-action-main">
                  <Icon name={icon} size={15} className="game-action-icon" />
                  <div className="game-action-info">
                    <Text size="sm" fw={500} truncate>
                      {label}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {meta}
                    </Text>
                  </div>
                  <Group gap={4} wrap="nowrap" className="game-action-controls">
                    <Tooltip label={tip ?? tr('測試啟動')}>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        aria-label={tr('測試啟動 {0}', label)}
                        disabled={disabled || !canRun}
                        onClick={() => void run({ action: 'runExtra', rowId: row.rowId, extra })}
                      >
                        <Icon name="external" size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip
                      label={visible ? tr('目前顯示，點一下隱藏') : tr('目前隱藏，點一下顯示')}
                    >
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        color={visible ? undefined : 'gray'}
                        aria-label={visible ? tr('隱藏按鈕 {0}', label) : tr('顯示按鈕 {0}', label)}
                        aria-pressed={visible}
                        disabled={disabled || !row.record}
                        onClick={() =>
                          void run({
                            action: 'actionVisible',
                            rowId: row.rowId,
                            revision: row.record!.revision,
                            templateId: 'extra-' + extra,
                            visible: !visible,
                          })
                        }
                      >
                        <Icon name={visible ? 'eye' : 'eye-off'} size={14} />
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                </div>
              </div>
            )
          })}
        </Stack>

        {extras && extras.suggestions.length > 0 && row.record && (
          <details className="game-action-disclosure" open>
            <summary>{tr('可快速加入（{0}）', extras.suggestions.length)}</summary>
            <Stack gap={4} mt={6}>
              {extras.suggestions.map((item) => (
                <Group
                  key={item.name}
                  justify="space-between"
                  wrap="nowrap"
                  className="game-suggestion-row"
                >
                  <Group gap={6} wrap="nowrap" style={{ minWidth: 0 }}>
                    <Badge
                      size="xs"
                      variant="light"
                      color={item.role === 'config' ? 'blue' : 'gray'}
                    >
                      {item.role === 'config' ? tr('設定程式') : tr('說明書')}
                    </Badge>
                    <Text size="xs" className="path" truncate title={item.name}>
                      {item.name}
                    </Text>
                  </Group>
                  <Button
                    size="compact-xs"
                    variant="light"
                    disabled={disabled}
                    aria-label={tr('加入 {0}', item.name)}
                    onClick={() =>
                      void run({
                        action: 'addSuggestion',
                        rowId: row.rowId,
                        revision: row.record!.revision,
                        name: item.name,
                      })
                    }
                  >
                    {tr('加入')}
                  </Button>
                </Group>
              ))}
            </Stack>
          </details>
        )}

        {unboundTemplates.length > 0 && (
          <details className="game-action-disclosure game-unbound-group">
            <summary>{tr('未設定的專案操作（{0}）', unboundTemplates.length)}</summary>
            <Stack gap={4} mt={6}>
              {unboundTemplates.map((template) => renderTemplateRow(template))}
            </Stack>
          </details>
        )}
      </section>
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
