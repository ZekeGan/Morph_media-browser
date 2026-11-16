import { useContext, useEffect, useMemo, useState } from 'react'
import {
  ActionIcon,
  Button,
  Group,
  Modal,
  NativeSelect,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { t as tr, useLocale } from '../i18n'
import { Icon } from '../common/icons'
import { Card } from '../cells/Card'
import { isLayoutWork, KindIcon, LayoutWorksContext } from './folderKind'
import { cardPresets, cardRule } from '../../shared/layouts'
import {
  chooseLayout,
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
// docs/LAYOUT_RULES.md.
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
}
export function LayoutConfig({ opened, close, project, rows, start, busy, save }: Props) {
  useLocale()
  const works = useContext(LayoutWorksContext)
  const presets = cardPresets(project)
  const [draft, setDraft] = useState<LayoutRule>({}),
    [base, setBase] = useState(''),
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
  const savedRule = () => structuredClone(cardRule(project) ?? {}),
    savedBase = () => project.activeLayoutId ?? presets[0].id
  useEffect(() => {
    if (!opened) return
    setDraft(savedRule())
    setBase(savedBase())
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
  const name = (id: string) => {
    const preset = presets.find((p) => p.id === id) ?? presets[0]
    return preset.id === 'default' && preset.name === '預設版面' ? tr('預設版面') : preset.name
  }
  const choices = presets.map((p) => ({ value: p.id, label: name(p.id) }))
  const inherit = (label: string) => [{ value: '', label }, ...choices]
  const followDefault = tr('沿用預設（{0}）', name(base))
  const known = (id: string) => presets.some((p) => p.id === id)
  const work = (row: FolderRow) => isLayoutWork(works, row.rowId)
  const choice = (row: FolderRow, rule = draft) => chooseLayout(rule, row, work(row), base, known)
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
  }, [rows, draft, base, works])
  const setRule = (change: (rule: LayoutRule) => void) =>
    setDraft((now) => {
      const next = structuredClone(now)
      change(next)
      return next
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
  const savedFolders = cardRule(project)?.folders ?? {}
  const changes = useMemo(() => {
    const before = savedRule()
    let count = base !== savedBase() ? 1 : 0
    for (const kind of new Set([
      ...Object.keys(before.types ?? {}),
      ...Object.keys(draft.types ?? {}),
    ]))
      if (before.types?.[kind as FolderKind] !== draft.types?.[kind as FolderKind]) count++
    for (let i = 0; i < deepest; i++)
      if ((before.levels?.[i] ?? '') !== (draft.levels?.[i] ?? '')) count++
    for (const id of new Set([
      ...Object.keys(before.folders ?? {}),
      ...Object.keys(draft.folders ?? {}),
    ]))
      if (before.folders?.[id] !== draft.folders?.[id]) count++
    return count
  }, [draft, base, project])
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
    const preset = presets.find((p) => p.id === base) ?? presets[0]
    return {
      ...project,
      layoutPresets: presets,
      activeLayoutId: preset.id,
      cells: preset.cells,
      layoutRules: { ...project.layoutRules, card: draft },
    }
  }, [project, draft, base])
  const apply = async () => {
    let next = editLayoutRules(project, (rules) => {
      rules.card = draft
    })
    if (base !== savedBase()) {
      const preset = presets.find((p) => p.id === base)
      if (preset)
        next = {
          ...next,
          cells: structuredClone(preset.cells),
          layoutPresets: presets,
          activeLayoutId: preset.id,
        }
    }
    if (await save(next)) close()
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
      <div className="layout-config">
        <aside className="layout-config-rules" aria-label={tr('規則')}>
          <section>
            <Text className="layout-config-heading">{tr('預設版面')}</Text>
            <NativeSelect
              size="xs"
              aria-label={tr('預設版面')}
              value={base}
              data={choices}
              onChange={(e) => setBase(e.currentTarget.value)}
            />
            <Text className="layout-config-reach">
              {tr('沒有其他規則時使用 · {0}', reachText(reach.default))}
            </Text>
          </section>
          <section>
            <Text className="layout-config-heading">{tr('作品依類型')}</Text>
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
            <Text className="layout-config-heading">{tr('一般資料夾依層級')}</Text>
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
                </div>
              )
            })}
            {!listed.length && (
              <Text size="sm" c="dimmed" p="sm">
                {tr('沒有符合的資料夾')}
              </Text>
            )}
          </div>
          {pickedRow && (
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
