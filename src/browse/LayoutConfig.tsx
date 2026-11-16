import { useContext, useEffect, useMemo, useState } from 'react'
import { Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core'
import { Background, ReactFlow, type Edge, type Node, type ReactFlowInstance } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'
import { t as tr, useLocale } from '../i18n'
import { Icon } from '../common/icons'
import { useAppTheme } from '../themes/ThemeProvider'
import { isLayoutWork, KindIcon, LayoutWorksContext } from './folderKind'
import { cardPresets, cardRule } from '../../shared/layouts'
import {
  chooseLayout,
  editLayoutRules,
  layoutLevel,
  type LayoutRule,
  type LayoutSource,
} from '../../shared/layoutRules'
import { pathKey, treeStructure, visibleTreeRows } from '../../shared/browse'
import type { FolderKind } from '../../shared/kind'
import type { FolderRow, Project } from '../../shared/model'

// R-413: one window for which card layout every folder uses. The defaults (per kind for works, per level for other
// folders, and layout 0) and each folder's own choice are edited on a draft and saved together. Rules:
// docs/LAYOUT_RULES.md.
const kinds: { kind: FolderKind; label: string }[] = [
  { kind: 'game', label: '遊戲' },
  { kind: 'book', label: '書籍／漫畫' },
  { kind: 'music', label: '音樂' },
  { kind: 'video', label: '影片' },
  { kind: 'general', label: '一般' },
]
const sources: Record<LayoutSource, string> = {
  folder: '此資料夾專屬',
  type: '依類型',
  level: '依層級',
  default: '版面 0',
}
const NODE_W = 220,
  NODE_H = 64,
  MAX_LEVELS = 12

interface Props {
  opened: boolean
  close: () => void
  project: Project
  rows: FolderRow[]
  // The folder being browsed: the tree starts there.
  start?: FolderRow
  busy: boolean
  save: (project: Project) => Promise<boolean>
}
export function LayoutConfig({ opened, close, project, rows, start, busy, save }: Props) {
  const locale = useLocale()
  const { theme } = useAppTheme()
  const works = useContext(LayoutWorksContext)
  const presets = cardPresets(project)
  const [draft, setDraft] = useState<LayoutRule>({}),
    [base, setBase] = useState(''),
    [picked, setPicked] = useState<string>(),
    [query, setQuery] = useState(''),
    [closed, setClosed] = useState<string[]>([]),
    [flow, setFlow] = useState<ReactFlowInstance>()
  // The tree: the folder being browsed and everything below it (the whole project at its root).
  const scope = useMemo(() => {
    if (!start) return rows
    const key = pathKey(start.path)
    return rows.filter((r) => r.rowId === start.rowId || pathKey(r.path).startsWith(key + '/'))
  }, [rows, start])
  const structure = useMemo(() => treeStructure(scope), [scope])
  useEffect(() => {
    if (!opened) return
    setDraft(structuredClone(cardRule(project) ?? {}))
    setBase(project.activeLayoutId ?? presets[0].id)
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
  const withBase = [{ value: '', label: tr('版面 0（{0}）', name(base)) }, ...choices]
  const known = (id: string) => presets.some((p) => p.id === id)
  const choice = (row: FolderRow) =>
    chooseLayout(draft, row, isLayoutWork(works, row.rowId), base, known)
  const deepest = useMemo(
    () =>
      Math.min(
        MAX_LEVELS,
        rows.reduce((max, r) => Math.max(max, layoutLevel(r)), 1)
      ),
    [rows]
  )
  const setRule = (change: (rule: LayoutRule) => void) =>
    setDraft((now) => {
      const next = structuredClone(now)
      change(next)
      return next
    })
  const visible = useMemo(() => visibleTreeRows(scope, closed), [scope, closed])
  const { nodes, edges } = useMemo(() => {
    const graph = new dagre.graphlib.Graph()
        .setGraph({ rankdir: 'LR', ranksep: 60, nodesep: 14 })
        .setDefaultEdgeLabel(() => ({})),
      ids = new Set(visible.map((r) => r.rowId)),
      edges: Edge[] = []
    for (const row of visible) graph.setNode(row.rowId, { width: NODE_W, height: NODE_H })
    for (const row of visible)
      for (const child of structure.children.get(row.rowId) ?? [])
        if (ids.has(child.rowId)) {
          graph.setEdge(row.rowId, child.rowId)
          edges.push({
            id: row.rowId + '/' + child.rowId,
            source: row.rowId,
            target: child.rowId,
            type: 'smoothstep',
          })
        }
    dagre.layout(graph)
    const nodes: Node[] = visible.map((r) => {
      const pos = graph.node(r.rowId),
        { id, source } = choice(r),
        work = isLayoutWork(works, r.rowId),
        count = structure.children.get(r.rowId)?.length ?? 0,
        isClosed = closed.includes(r.rowId)
      return {
        id: r.rowId,
        position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
        sourcePosition: 'right' as Node['sourcePosition'],
        targetPosition: 'left' as Node['targetPosition'],
        className: 'layout-node' + (work ? ' is-work' : '') + ' from-' + source,
        selected: r.rowId === picked,
        data: {
          label: (
            <div className="tree-node-label">
              <div>
                <strong className="tree-node-title">
                  <KindIcon row={r} size={16} />
                  {r.name}
                </strong>
                <small className="layout-node-choice">
                  {name(id)} · {tr(sources[source])}
                </small>
              </div>
              {count > 0 && (
                <button
                  className="tree-branch-toggle nodrag nopan"
                  aria-label={(isClosed ? tr('展開 ') : tr('收合 ')) + r.name + tr(' 子資料夾')}
                  aria-expanded={!isClosed}
                  title={isClosed ? tr('展開子資料夾') : tr('收合子資料夾')}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation()
                    setClosed((now) =>
                      now.includes(r.rowId) ? now.filter((x) => x !== r.rowId) : [...now, r.rowId]
                    )
                  }}
                >
                  <Icon name={isClosed ? 'plus' : 'minus'} size={15} />
                </button>
              )}
            </div>
          ),
        },
        style: { width: NODE_W, height: NODE_H },
      }
    })
    return { nodes, edges }
  }, [visible, structure, closed, draft, base, picked, works, locale])
  const pickedRow = scope.find((r) => r.rowId === picked)
  const own = pickedRow?.record?.folderId ? draft.folders?.[pickedRow.record.folderId] : undefined
  // Search: the first folder whose name matches is opened up to, picked and centred.
  const find = () => {
    const text = query.trim().toLocaleLowerCase()
    const hit = text && scope.find((r) => r.name.toLocaleLowerCase().includes(text))
    if (!hit) return
    const above = new Set(
      scope.filter((r) => pathKey(hit.path).startsWith(pathKey(r.path) + '/')).map((r) => r.rowId)
    )
    setClosed((now) => now.filter((id) => !above.has(id)))
    setPicked(hit.rowId)
    window.setTimeout(() => {
      const node = flow?.getNode(hit.rowId)
      if (node)
        void flow!.setCenter(node.position.x + NODE_W / 2, node.position.y + NODE_H / 2, {
          duration: 200,
        })
    }, 0)
  }
  const apply = async () => {
    let next = editLayoutRules(project, (rules) => {
      rules.card = draft
    })
    if (base !== (project.activeLayoutId ?? presets[0].id)) {
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
  return (
    <Modal opened={opened} onClose={close} title={tr('版面配置')} size="90rem">
      <Stack gap="md" className="layout-config">
        <section>
          <Text fw={600} size="sm">
            {tr('預設設定')}
          </Text>
          <Text size="xs" c="dimmed">
            {tr(
              '作品依類型選版面，其他資料夾依所在層級選版面；沒有指定的都用版面 0。資料夾專屬的版面在下方樹狀圖設定。'
            )}
          </Text>
          <Group gap="sm" mt="xs" align="flex-end" wrap="wrap">
            <Select
              size="xs"
              w={180}
              label={tr('版面 0')}
              allowDeselect={false}
              value={base}
              data={choices}
              onChange={(id) => id && setBase(id)}
            />
            {kinds.map(({ kind, label }) => (
              <Select
                key={kind}
                size="xs"
                w={150}
                label={tr(label)}
                allowDeselect={false}
                value={draft.types?.[kind] ?? ''}
                data={withBase}
                onChange={(id) =>
                  setRule((rule) => {
                    const types = { ...rule.types }
                    if (id) types[kind] = id
                    else delete types[kind]
                    rule.types = types
                  })
                }
              />
            ))}
          </Group>
          <Group gap="sm" mt="xs" align="flex-end" wrap="wrap">
            {Array.from({ length: deepest }, (_, i) => (
              <Select
                key={i}
                size="xs"
                w={150}
                label={tr('第 {0} 層', i + 1)}
                allowDeselect={false}
                value={draft.levels?.[i] ?? ''}
                data={withBase}
                onChange={(id) =>
                  setRule((rule) => {
                    const levels = [...(rule.levels ?? [])]
                    while (levels.length <= i) levels.push('')
                    levels[i] = id ?? ''
                    rule.levels = levels
                  })
                }
              />
            ))}
          </Group>
        </section>
        <section>
          <Group justify="space-between" align="flex-end">
            <Text fw={600} size="sm">
              {tr('資料夾')}
            </Text>
            <TextInput
              size="xs"
              w={240}
              aria-label={tr('搜尋資料夾')}
              placeholder={tr('搜尋資料夾')}
              leftSection={<Icon name="search" size={14} />}
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') find()
              }}
            />
          </Group>
          <Text size="xs" c="dimmed">
            {tr(
              '虛線框是作品（依類型），實線框是一般資料夾（依層級），強調色邊框是此資料夾專屬。點資料夾可指定專屬版面。'
            )}
          </Text>
          <div className="tree-canvas layout-config-tree">
            {opened && (
              <ReactFlow
                onInit={setFlow}
                nodes={nodes}
                edges={edges}
                nodesDraggable={false}
                nodesConnectable={false}
                deleteKeyCode={null}
                fitView
                minZoom={0.1}
                maxZoom={2}
                onlyRenderVisibleElements
                onNodeClick={(_, node) => setPicked(node.id)}
                colorMode={theme === 'dark' ? 'dark' : 'light'}
              >
                <Background />
              </ReactFlow>
            )}
          </div>
          {pickedRow && (
            <Group gap="sm" mt="xs" align="flex-end">
              <Text size="sm">
                {tr('所選資料夾：{0}', pickedRow.name)}
                <Text span size="xs" c="dimmed">
                  {' '}
                  ·{' '}
                  {isLayoutWork(works, pickedRow.rowId)
                    ? tr('作品')
                    : tr('第 {0} 層', layoutLevel(pickedRow))}
                </Text>
              </Text>
              {pickedRow.record ? (
                <Select
                  size="xs"
                  w={260}
                  label={tr('此資料夾專屬')}
                  allowDeselect={false}
                  value={own ?? ''}
                  data={[
                    {
                      value: '',
                      label: tr(
                        '不指定（目前：{0}）',
                        name(
                          chooseLayout(
                            { ...draft, folders: undefined },
                            pickedRow,
                            isLayoutWork(works, pickedRow.rowId),
                            base,
                            known
                          ).id
                        )
                      ),
                    },
                    ...choices,
                  ]}
                  onChange={(id) =>
                    setRule((rule) => {
                      const folders = { ...rule.folders },
                        folderId = pickedRow.record!.folderId
                      if (id) folders[folderId] = id
                      else delete folders[folderId]
                      rule.folders = folders
                    })
                  }
                />
              ) : (
                <Text size="xs" c="dimmed">
                  {tr('這個資料夾還沒有記錄，不能指定專屬版面')}
                </Text>
              )}
            </Group>
          )}
        </section>
        <Group justify="flex-end">
          <Button variant="default" onClick={close} disabled={busy}>
            {tr('取消')}
          </Button>
          <Button onClick={() => void apply()} loading={busy}>
            {tr('保存')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  )
}
