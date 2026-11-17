import { useContext, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  NativeSelect,
  SegmentedControl,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { t as tr, useLocale } from '../i18n'
import { layoutName } from '../editor/layoutName'
import { Icon } from '../common/icons'
import { Card } from '../cells/Card'
import { isLayoutWork, KindIcon, LayoutWorksContext } from './folderKind'
import { cardPresets, cardRule } from '../../shared/layouts'
import { builtinPanel } from '../../shared/explorer'
import {
  chooseLayout,
  choosePanel,
  editLayoutRules,
  layoutLevel,
  type LayoutRule,
  type LayoutSource,
} from '../../shared/layoutRules'
import { pathKey, treeStructure } from '../../shared/browse'
import { effectiveKind, type FolderKind } from '../../shared/kind'
import type { FolderRow, Project } from '../../shared/model'

// R-413: one window for which card layout every folder uses. Left: the rules (the default layout, a layout per kind
// for works, a layout per level for other folders), each with how many folders it reaches. Right: the folders as an
// indented list, each with its layout and where it comes from; picking one there makes it that folder's own. Below:
// the cards of the picked folder and its neighbours as they will look. Edited on a draft, saved together. Rules:
// docs/LAYOUT_RULES.md. R-409: the same window sets the right-panel layouts ("卡片／右側"); both drafts are saved together.
const kinds: { kind: FolderKind; label: string }[] = [
  { kind: 'game', label: '遊戲' },
  { kind: 'book', label: '書籍／漫畫' },
  { kind: 'music', label: '音樂' },
  { kind: 'video', label: '影片' },
  { kind: 'general', label: '一般' },
]
const sources: Record<LayoutSource, string> = {
  folder: '專屬',
  type: '類型',
  level: '層級',
  default: '預設',
}
const MAX_LEVELS = 12,
  PREVIEW = 3

interface Props {
  opened: boolean
  close: () => void
  project: Project
  rows: FolderRow[]
  // The folder being browsed: the list starts there and it is picked first.
  start?: FolderRow
  busy: boolean
  save: (project: Project) => Promise<boolean>
  // Which layouts the window opens on.
  initialTarget?: Target
  // Opens the right-panel editor for a kind at a layout (after the window is closed).
  editPanel?: (kind: FolderKind, preset?: string) => void
}
type Target = 'card' | 'panel'
export function LayoutConfig({
  opened,
  close,
  project,
  rows,
  start,
  busy,
  save,
  initialTarget = 'card',
  editPanel,
}: Props) {
  useLocale()
  const works = useContext(LayoutWorksContext)
  const [target, setTarget] = useState<Target>(initialTarget)
  const panel = target === 'panel'
  const panelPresets = project.panelPresets ?? []
  const presets = panel ? panelPresets : cardPresets(project)
  // Both drafts live side by side, so switching between card and panel keeps what was changed.
  const [drafts, setDrafts] = useState<Record<Target, LayoutRule>>({ card: {}, panel: {} }),
    [bases, setBases] = useState<Record<Target, string>>({ card: '', panel: '' }),
    draft = drafts[target],
    base = bases[target],
    setBase = (id: string) => setBases((now) => ({ ...now, [target]: id })),
    [picked, setPicked] = useState<string>(),
    [query, setQuery] = useState(''),
    [closed, setClosed] = useState<string[]>([])
  // The list: the folder being browsed and everything below it (the whole project at its root).
  const scope = useMemo(() => {
    if (!start) return rows
    const key = pathKey(start.path)
    return rows.filter((r) => r.rowId === start.rowId || pathKey(r.path).startsWith(key + '/'))
  }, [rows, start])
  const structure = useMemo(() => treeStructure(scope), [scope])
  const savedRules = (): Record<Target, LayoutRule> => ({
      card: structuredClone(cardRule(project) ?? {}),
      panel: structuredClone(project.layoutRules?.panel ?? {}),
    }),
    savedBases = (): Record<Target, string> => ({
      card: project.activeLayoutId ?? cardPresets(project)[0].id,
      panel: project.panelPresetId ?? '',
    })
  useEffect(() => {
    if (!opened) return
    setTarget(initialTarget)
    setDrafts(savedRules())
    setBases(savedBases())
    setPicked(start?.rowId)
    setQuery('')
    // Two levels below the starting folder are open; deeper branches start closed.
    const top = scope.reduce((min, r) => Math.min(min, r.depth), Infinity)
    setClosed(
      scope
        .filter((r) => r.depth - top >= 2 && structure.children.get(r.rowId)?.length)
        .map((r) => r.rowId)
    )
  }, [opened])
  // A panel without a layout shows its kind's built-in panel ('' stands for it).
  const name = (id: string) => {
    if (panel && !presets.some((p) => p.id === id)) return tr('內建右側')
    const preset = presets.find((p) => p.id === id) ?? presets[0]
    return layoutName(preset)
  }
  const choices = presets.map((p) => ({ value: p.id, label: name(p.id) }))
  const inherit = (label: string) => [{ value: '', label }, ...choices]
  const followDefault = tr('沿用預設（{0}）', name(base))
  const known = (id: string) => presets.some((p) => p.id === id)
  const work = (row: FolderRow) => isLayoutWork(works, row.rowId)
  const kindOf = (row: FolderRow) => effectiveKind(row, row.contents)
  const choice = (row: FolderRow, rule = draft) =>
    panel
      ? (choosePanel(rule, row, kindOf(row), base || undefined, known) ?? {
          id: '',
          source: 'default' as const,
        })
      : chooseLayout(rule, row, work(row), base, known)
  const deepest = useMemo(
    () =>
      Math.min(
        MAX_LEVELS,
        rows.reduce((max, r) => Math.max(max, layoutLevel(r)), 1)
      ),
    [rows]
  )
  // How many folders of the whole project each rule reaches with the draft (a folder's own choice counts there).
  const reach = useMemo(() => {
    const out = { default: 0, kinds: {} as Record<string, number>, levels: [] as number[] }
    for (const row of rows) {
      const { source } = choice(row)
      if (source === 'default') out.default++
      else if (source === 'type') {
        const kind = effectiveKind(row, row.contents)
        out.kinds[kind] = (out.kinds[kind] ?? 0) + 1
      } else if (source === 'level') {
        const i = layoutLevel(row) - 1
        out.levels[i] = (out.levels[i] ?? 0) + 1
      }
    }
    return out
  }, [rows, draft, base, works, target])
  const setRule = (change: (rule: LayoutRule) => void) =>
    setDrafts((now) => {
      const next = structuredClone(now[target])
      change(next)
      return { ...now, [target]: next }
    })
  // A search shows the folders whose name matches and the folders above them; otherwise the open branches.
  const listed = useMemo(() => {
    const text = query.trim().toLocaleLowerCase()
    const keep = text
      ? new Set(
          scope
            .filter((r) => r.name.toLocaleLowerCase().includes(text))
            .flatMap((hit) =>
              scope
                .filter((r) => r === hit || pathKey(hit.path).startsWith(pathKey(r.path) + '/'))
                .map((r) => r.rowId)
            )
        )
      : undefined
    const out: FolderRow[] = []
    const walk = (list: FolderRow[]) => {
      for (const row of list) {
        if (keep && !keep.has(row.rowId)) continue
        out.push(row)
        if (keep || !closed.includes(row.rowId)) walk(structure.children.get(row.rowId) ?? [])
      }
    }
    walk(structure.roots)
    return out
  }, [scope, structure, closed, query])
  const top = useMemo(() => scope.reduce((min, r) => Math.min(min, r.depth), Infinity), [scope])
  const savedFolders = savedRules()[target].folders ?? {}
  // Unsaved changes of both card and panel.
  const changes = useMemo(() => {
    const rules = savedRules(),
      saved = savedBases()
    let count = 0
    for (const which of ['card', 'panel'] as const) {
      const before = rules[which],
        now = drafts[which]
      if (bases[which] !== saved[which]) count++
      for (const kind of new Set([
        ...Object.keys(before.types ?? {}),
        ...Object.keys(now.types ?? {}),
      ]))
        if (before.types?.[kind as FolderKind] !== now.types?.[kind as FolderKind]) count++
      for (let i = 0; i < deepest; i++)
        if ((before.levels?.[i] ?? '') !== (now.levels?.[i] ?? '')) count++
      for (const id of new Set([
        ...Object.keys(before.folders ?? {}),
        ...Object.keys(now.folders ?? {}),
      ]))
        if (before.folders?.[id] !== now.folders?.[id]) count++
    }
    return count
  }, [drafts, bases, project])
  // The preview: the picked folder and the folders beside it, drawn with the draft rules.
  const pickedRow = scope.find((r) => r.rowId === picked) ?? start ?? scope[0]
  const previewRows = useMemo(() => {
    if (!pickedRow) return []
    const parent = scope.find(
      (r) => pathKey(r.path) === pathKey(pickedRow.path.replace(/[\\/][^\\/]*$/, ''))
    )
    const siblings = (parent ? structure.children.get(parent.rowId) : structure.roots) ?? [
      pickedRow,
    ]
    return [pickedRow, ...siblings.filter((r) => r.rowId !== pickedRow.rowId)].slice(0, PREVIEW)
  }, [pickedRow, scope, structure])
  const previewProject = useMemo<Project>(() => {
    const cards = cardPresets(project),
      preset = cards.find((p) => p.id === bases.card) ?? cards[0]
    return {
      ...project,
      layoutPresets: cards,
      activeLayoutId: preset.id,
      cells: preset.cells,
      layoutRules: { ...project.layoutRules, card: drafts.card },
    }
  }, [project, drafts, bases])
  // The picked folder's right panel with the draft rules: its layout, else its kind's built-in panel.
  const panelPreview = (row: FolderRow) => {
    const { id } = choice(row),
      kind = kindOf(row),
      cells =
        presets.find((p) => p.id === id)?.cells ??
        (kind === 'book' ? builtinPanel(project, 'book') : undefined)
    return { kind, cells }
  }
  // The project with both drafts; `extra` adds right-panel layouts made in this window.
  const drafted = (extra: NonNullable<Project['panelPresets']> = []): Project => {
    let next = editLayoutRules(project, (rules) => {
      rules.card = drafts.card
      rules.panel = drafts.panel
    })
    const cards = cardPresets(project)
    if (bases.card !== savedBases().card) {
      const preset = cards.find((p) => p.id === bases.card)
      if (preset)
        next = {
          ...next,
          cells: structuredClone(preset.cells),
          layoutPresets: cards,
          activeLayoutId: preset.id,
        }
    }
    const list = [...panelPresets, ...extra]
    return {
      ...next,
      panelPresets: list.length ? list : undefined,
      panelPresetId:
        bases.panel && list.some((p) => p.id === bases.panel) ? bases.panel : undefined,
    }
  }
  const apply = async () => {
    if (await save(drafted())) close()
  }
  // A copy of the panel layout this folder shows now (or its built-in one), named after the folder, made its own
  // layout and opened in the editor; unsaved changes in the window are saved with it.
  const ownCopy = async (row: FolderRow) => {
    const folderId = row.record?.folderId
    if (!folderId || panelPresets.length >= 40) return
    const { cells, kind } = panelPreview(row),
      used = new Set(panelPresets.map((p) => p.name.toLocaleLowerCase())),
      first = row.name.slice(0, 90).trim() || tr('此資料夾')
    let label = first
    for (let n = 2; used.has(label.toLocaleLowerCase()); n++) label = first + ' (' + n + ')'
    const id = crypto.randomUUID()
    const next = drafted([
      { id, name: label, cells: structuredClone(cells ?? builtinPanel(project, kind)) },
    ])
    next.layoutRules = {
      ...next.layoutRules,
      panel: {
        ...next.layoutRules?.panel,
        folders: { ...next.layoutRules?.panel?.folders, [folderId]: id },
      },
    }
    if (await save(next)) {
      close()
      editPanel?.(kind, id)
    }
  }
  const reachText = (count = 0) => tr('{0} 個資料夾', count)
  return (
    <Modal
      opened={opened}
      onClose={close}
      title={tr('版面配置')}
      size="min(1400px, 96vw)"
      classNames={{ body: 'layout-config-body' }}
    >
      <SegmentedControl
        className="layout-config-target"
        size="xs"
        aria-label={tr('設定哪一種版面')}
        value={target}
        onChange={(value) => setTarget(value as Target)}
        data={[
          { value: 'card', label: tr('卡片') },
          { value: 'panel', label: tr('右側') },
        ]}
      />
      <div className="layout-config">
        <aside className="layout-config-rules" aria-label={tr('規則')}>
          <section>
            <Text className="layout-config-heading">{tr('預設版面')}</Text>
            <NativeSelect
              size="xs"
              aria-label={tr('預設版面')}
              value={base}
              data={panel ? [{ value: '', label: tr('內建右側') }, ...choices] : choices}
              onChange={(e) => setBase(e.currentTarget.value)}
            />
            <Text className="layout-config-reach">
              {tr('沒有其他規則時使用 · {0}', reachText(reach.default))}
            </Text>
          </section>
          <section>
            <Text className="layout-config-heading">{panel ? tr('依類型') : tr('作品依類型')}</Text>
            {kinds.map(({ kind, label }) => (
              <div className="layout-config-rule" key={kind}>
                <span>{tr(label)}</span>
                <NativeSelect
                  size="xs"
                  aria-label={tr('{0}的版面', tr(label))}
                  className={draft.types?.[kind] ? undefined : 'inherited'}
                  value={draft.types?.[kind] ?? ''}
                  data={inherit(followDefault)}
                  onChange={(e) => {
                    const id = e.currentTarget.value
                    setRule((rule) => {
                      const types = { ...rule.types }
                      if (id) types[kind] = id
                      else delete types[kind]
                      rule.types = types
                    })
                  }}
                />
                <span className="layout-config-reach">{reachText(reach.kinds[kind])}</span>
              </div>
            ))}
          </section>
          <section>
            <Text className="layout-config-heading">
              {panel ? tr('依層級（類型沒有設定時）') : tr('一般資料夾依層級')}
            </Text>
            {Array.from({ length: deepest }, (_, i) => (
              <div className="layout-config-rule" key={i}>
                <span>{tr('第 {0} 層', i + 1)}</span>
                <NativeSelect
                  size="xs"
                  aria-label={tr('第 {0} 層的版面', i + 1)}
                  className={draft.levels?.[i] ? undefined : 'inherited'}
                  value={draft.levels?.[i] ?? ''}
                  data={inherit(followDefault)}
                  onChange={(e) => {
                    const id = e.currentTarget.value
                    setRule((rule) => {
                      const levels = [...(rule.levels ?? [])]
                      while (levels.length <= i) levels.push('')
                      levels[i] = id
                      rule.levels = levels
                    })
                  }}
                />
                <span className="layout-config-reach">{reachText(reach.levels[i])}</span>
              </div>
            ))}
          </section>
        </aside>
        <section className="layout-config-main" aria-label={tr('資料夾')}>
          <div className="layout-config-tools">
            <TextInput
              size="xs"
              className="layout-config-search"
              aria-label={tr('搜尋資料夾')}
              placeholder={tr('搜尋資料夾')}
              leftSection={<Icon name="search" size={14} />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
            />
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() =>
                setClosed(
                  scope.filter((r) => structure.children.get(r.rowId)?.length).map((r) => r.rowId)
                )
              }
            >
              {tr('全部收合')}
            </Button>
            <Button size="compact-xs" variant="subtle" onClick={() => setClosed([])}>
              {tr('全部展開')}
            </Button>
            <span className="layout-config-legend" aria-hidden="true">
              {(['type', 'level', 'default', 'folder'] as const).map((source) => (
                <span key={source}>
                  <i className={'from-' + source} />
                  {tr(sources[source])}
                </span>
              ))}
            </span>
          </div>
          <div className="layout-config-list" role="list">
            {listed.map((row) => {
              const { id, source } = choice(row),
                folderId = row.record?.folderId,
                own = folderId ? draft.folders?.[folderId] : undefined,
                dirty = !!folderId && own !== savedFolders[folderId],
                count = structure.children.get(row.rowId)?.length ?? 0,
                isClosed = !query.trim() && closed.includes(row.rowId)
              return (
                <div
                  key={row.rowId}
                  role="listitem"
                  className={
                    'layout-config-item from-' +
                    source +
                    (row.rowId === pickedRow?.rowId ? ' picked' : '')
                  }
                  onClick={() => setPicked(row.rowId)}
                >
                  <span
                    className="layout-config-name"
                    style={{ paddingLeft: (row.depth - top) * 18 }}
                  >
                    {count > 0 ? (
                      <button
                        type="button"
                        className="layout-config-twist"
                        aria-expanded={!isClosed}
                        aria-label={(isClosed ? tr('展開 ') : tr('收合 ')) + row.name}
                        onClick={(e) => {
                          e.stopPropagation()
                          setClosed((now) =>
                            now.includes(row.rowId)
                              ? now.filter((x) => x !== row.rowId)
                              : [...now, row.rowId]
                          )
                        }}
                      >
                        <Icon name={isClosed ? 'chevron-right' : 'chevron-down'} size={14} />
                      </button>
                    ) : (
                      <span className="layout-config-twist" />
                    )}
                    <KindIcon row={row} size={16} />
                    <span className="layout-config-title" title={row.name}>
                      {row.name}
                    </span>
                    {dirty && <span className="layout-config-dirty" title={tr('尚未保存')} />}
                  </span>
                  {folderId ? (
                    <span className="layout-config-choice" onClick={(e) => e.stopPropagation()}>
                      <NativeSelect
                        size="xs"
                        aria-label={tr('{0} 的版面', row.name)}
                        className={own ? undefined : 'inherited'}
                        value={own ?? ''}
                        data={inherit(tr('沿用（{0}）', name(id)))}
                        onChange={(e) => {
                          const value = e.currentTarget.value
                          setPicked(row.rowId)
                          setRule((rule) => {
                            const folders = { ...rule.folders }
                            if (value) folders[folderId] = value
                            else delete folders[folderId]
                            rule.folders = folders
                          })
                        }}
                      />
                      {own && (
                        <Tooltip label={tr('清除專屬版面')} withArrow>
                          <ActionIcon
                            size="sm"
                            variant="subtle"
                            aria-label={tr('清除 {0} 的專屬版面', row.name)}
                            onClick={() =>
                              setRule((rule) => {
                                const folders = { ...rule.folders }
                                delete folders[folderId]
                                rule.folders = folders
                              })
                            }
                          >
                            <Icon name="close" size={14} />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </span>
                  ) : (
                    <Text size="xs" c="dimmed">
                      {tr('還沒有記錄')}
                    </Text>
                  )}
                  <span className="layout-config-source">{tr(sources[source])}</span>
                  {panel && folderId && (
                    <span onClick={(e) => e.stopPropagation()}>
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <Tooltip label={tr('更多選項')} withArrow>
                            <ActionIcon
                              size="sm"
                              variant="subtle"
                              aria-label={tr('{0} 的更多選項', row.name)}
                            >
                              <Icon name="more" size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item
                            disabled={busy || panelPresets.length >= 40 || !editPanel}
                            onClick={() => void ownCopy(row)}
                          >
                            {tr('另做一份給這個資料夾…')}
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </span>
                  )}
                </div>
              )
            })}
            {!listed.length && (
              <Text size="sm" c="dimmed" p="sm">
                {tr('沒有符合的資料夾')}
              </Text>
            )}
          </div>
          {pickedRow && panel && (
            <div className="layout-config-preview">
              <Group justify="space-between" gap="xs">
                <Text className="layout-config-heading">
                  {tr('預覽：「{0}」的右側', pickedRow.name)}
                </Text>
                {editPanel && (
                  <Tooltip
                    label={changes ? tr('先保存或取消變更') : tr('在編輯器打開這個右側版面')}
                    withArrow
                  >
                    <Button
                      size="compact-xs"
                      variant="light"
                      disabled={busy || !!changes}
                      onClick={() => {
                        const { id } = choice(pickedRow)
                        close()
                        editPanel(kindOf(pickedRow), id || undefined)
                      }}
                    >
                      {tr('編輯右側版面')}
                    </Button>
                  </Tooltip>
                )}
              </Group>
              {(() => {
                const { cells } = panelPreview(pickedRow)
                return cells?.length ? (
                  <div className="layout-config-panel">
                    <Card
                      project={{ ...project, layoutPresets: undefined, layoutRules: {}, cells }}
                      row={pickedRow}
                      open={() => {}}
                    />
                  </div>
                ) : (
                  <Text size="sm" c="dimmed">
                    {tr('這個類型沒有右側版面，顯示內建的主視覺。')}
                  </Text>
                )
              })()}
            </div>
          )}
          {pickedRow && !panel && (
            <div className="layout-config-preview">
              <Text className="layout-config-heading">
                {tr('預覽：「{0}」與同一層的資料夾', pickedRow.name)}
              </Text>
              <div className="layout-config-cards">
                {previewRows.map((row) => (
                  <div className="folder-card layout-config-card" key={row.rowId}>
                    <Card project={previewProject} row={row} open={() => {}} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
      <Group justify="flex-end" gap="sm" className="layout-config-footer">
        <Text size="xs" c="dimmed">
          {changes ? tr('{0} 處尚未保存', changes) : tr('沒有變更')}
        </Text>
        <Button variant="default" onClick={close} disabled={busy}>
          {tr('取消')}
        </Button>
        <Button onClick={() => void apply()} loading={busy} disabled={!changes}>
          {tr('保存')}
        </Button>
      </Group>
    </Modal>
  )
}
