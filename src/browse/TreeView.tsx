import { t as tr, useLocale } from '../i18n'
import { KindIcon } from './folderKind'
import { Icon } from '../common/icons'
import { BoundaryFlag } from '../game/BoundaryFlag'
import { useAppTheme } from '../themes/ThemeProvider'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Background,
  ControlButton,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'
import {
  defaultTreeCollapsed,
  pathKey,
  parentPath,
  treeStructure,
  visibleTreeRows,
} from '../../shared/browse'
import type { FolderRow, Project } from '../../shared/model'
import { TreeCardNode, TREE_CARD_WIDTH, treeCardHeight } from './TreeCardNode'

// R-466: the custom node type for card nodes (defined once, so React Flow does not re-create it each render).
const nodeTypes = { card: TreeCardNode }
import type { BrowseState } from '../../shared/explorer'
interface Props {
  rows: FolderRow[]
  selected?: string
  focusId?: string
  collapsed?: string[]
  onCollapsed: (ids: string[]) => void
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  onConfigure: (id: string) => void
  viewport?: BrowseState['viewport']
  save: (v: NonNullable<BrowseState['viewport']>) => void
  // R-466: draw each node as its card (the card layout the folder uses), sized by that layout.
  // The card itself is drawn by the caller: importing the card here would split its styles into a chunk of their own
  // and change the order the app's styles apply in.
  cards?: {
    project: Project
    isWork: (rowId: string) => boolean
    card: (row: FolderRow, open: () => void) => ReactNode
  }
}
export default function Tree({
  rows,
  selected,
  focusId,
  collapsed,
  onCollapsed,
  onSelect,
  onOpen,
  onConfigure,
  viewport,
  save,
  cards,
}: Props) {
  const locale = useLocale()

  const { theme } = useAppTheme()
  const defaults = useMemo(() => defaultTreeCollapsed(rows), [rows]),
    closed = collapsed ?? defaults
  const structure = useMemo(() => treeStructure(rows), [rows]),
    visible = useMemo(() => visibleTreeRows(rows, closed), [rows, closed])
  const actions = useRef({ onOpen, onConfigure, onCollapsed, closed })
  actions.current = { onOpen, onConfigure, onCollapsed, closed }
  const canvas = useRef<HTMLDivElement>(null),
    [initialView, setInitialView] = useState(viewport),
    [flow, setFlow] = useState<ReactFlowInstance>(),
    lastFocus = useRef<string | undefined>(undefined)
  const { nodes, edges } = useMemo(() => {
    const graph = new dagre.graphlib.Graph()
        .setGraph({ rankdir: 'LR', ranksep: 80, nodesep: 22 })
        .setDefaultEdgeLabel(() => ({})),
      byPath = new Map(visible.map((r) => [pathKey(r.path), r.rowId])),
      edges: Edge[] = []
    // Each node's size: the fixed label, or the card's width and the height of its card layout.
    const sizes = new Map(
      visible.map((row) => [
        row.rowId,
        cards
          ? {
              width: TREE_CARD_WIDTH,
              height: treeCardHeight(cards.project, row, cards.isWork(row.rowId)),
            }
          : { width: 240, height: 76 },
      ])
    )
    for (const row of visible) graph.setNode(row.rowId, sizes.get(row.rowId)!)
    for (const row of visible) {
      const above = byPath.get(pathKey(parentPath(row.path)))
      if (above) {
        graph.setEdge(above, row.rowId)
        edges.push({
          id: above + '/' + row.rowId,
          source: above,
          target: row.rowId,
          type: 'smoothstep',
        })
      }
    }
    dagre.layout(graph)
    const nodes: Node[] = visible.map((r) => {
      const pos = graph.node(r.rowId),
        size = sizes.get(r.rowId)!,
        count = structure.children.get(r.rowId)?.length ?? 0,
        isClosed = closed.includes(r.rowId)
      // The branch toggle, on the label and (R-466) on a card node.
      const toggle = count > 0 && (
        <button
          className="tree-branch-toggle nodrag nopan"
          aria-label={(isClosed ? tr('展開 ') : tr('收合 ')) + r.name + tr(' 子資料夾')}
          aria-expanded={!isClosed}
          title={isClosed ? tr('展開子資料夾') : tr('收合子資料夾')}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            const current = actions.current
            current.onCollapsed(
              current.closed.includes(r.rowId)
                ? current.closed.filter((id) => id !== r.rowId)
                : [...current.closed, r.rowId]
            )
          }}
        >
          <Icon name={isClosed ? 'plus' : 'minus'} size={15} />
        </button>
      )
      return {
        id: r.rowId,
        initialWidth: size.width,
        initialHeight: size.height,
        position: { x: pos.x - size.width / 2, y: pos.y - size.height / 2 },
        sourcePosition: 'right' as Node['sourcePosition'],
        targetPosition: 'left' as Node['targetPosition'],
        selected: false,
        data: {
          toggle,
          label: (
            <div className="tree-node-label">
              <div
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    actions.current.onOpen(r.rowId)
                  }
                  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
                    e.preventDefault()
                    actions.current.onConfigure(r.rowId)
                  }
                }}
              >
                <strong className="tree-node-title">
                  <KindIcon row={r} size={18} />
                  {r.name}
                </strong>
                <small>
                  {r.structural ? (
                    tr('結構祖先')
                  ) : r.boundary ? (
                    <BoundaryFlag detail={tr('內部未納管')} />
                  ) : r.readonly ? (
                    tr('唯讀')
                  ) : (
                    tr('第 ') + r.depth + tr(' 層')
                  )}
                  {count ? ' · ' + count + tr(' 個子資料夾') : ''}
                </small>
              </div>
              {toggle}
            </div>
          ),
        },
        style: { width: size.width, height: size.height, opacity: r.structural ? 0.4 : 1 },
      }
    })
    if (cards)
      nodes.forEach((node, i) => {
        node.type = 'card'
        node.data = {
          card: cards.card(visible[i], () => actions.current.onOpen(visible[i].rowId)),
          compact: node.data.label,
          toggle: node.data.toggle,
        }
      })
    return { nodes, edges }
  }, [visible, structure, closed, locale, cards])
  useLayoutEffect(() => {
    const focus = rows.find((r) => r.rowId === focusId)
    if (!focus) return
    const ancestors = new Set(
        rows
          .filter((r) => pathKey(focus.path).startsWith(pathKey(r.path) + '/'))
          .map((r) => r.rowId)
      ),
      next = closed.filter((id) => !ancestors.has(id))
    if (next.length !== closed.length) onCollapsed(next)
  }, [focusId])
  useLayoutEffect(() => {
    if (!focusId) {
      lastFocus.current = undefined
      return
    }
    const node = nodes.find((n) => n.id === focusId)
    if (flow && node && lastFocus.current !== focusId) {
      lastFocus.current = focusId
      void flow.setCenter(
        node.position.x + (node.initialWidth ?? 240) / 2,
        node.position.y + (node.initialHeight ?? 76) / 2,
        {
          zoom: flow.getZoom(),
          duration: 0,
        }
      )
    }
  }, [flow, focusId, nodes])
  useLayoutEffect(() => {
    if (initialView || !canvas.current) return
    const initialize = () => {
      const width = canvas.current!.clientWidth,
        height = canvas.current!.clientHeight
      if (!width || !height) return
      let minX = 0,
        minY = 0,
        maxX = 240,
        maxY = 76
      for (const node of nodes) {
        minX = Math.min(minX, node.position.x)
        minY = Math.min(minY, node.position.y)
        maxX = Math.max(maxX, node.position.x + (node.initialWidth ?? 240))
        maxY = Math.max(maxY, node.position.y + (node.initialHeight ?? 76))
      }
      const zoom = Math.max(
          0.05,
          Math.min(1, width / (maxX - minX + 80), height / (maxY - minY + 80))
        ),
        next = {
          x: (width - (maxX - minX) * zoom) / 2 - minX * zoom,
          y: (height - (maxY - minY) * zoom) / 2 - minY * zoom,
          zoom,
        }
      setInitialView(next)
      save(next)
    }
    const observer = new ResizeObserver(initialize)
    observer.observe(canvas.current)
    initialize()
    return () => observer.disconnect()
  }, [initialView, nodes, save])
  return (
    <div className="tree-canvas" ref={canvas}>
      <div className="tree-actions">
        <button onClick={() => onCollapsed([...structure.children.keys()])}>
          {tr('全部收合')}
        </button>
        <button onClick={() => onCollapsed(defaults)}>{tr('重設展開')}</button>
        <span>
          {tr('顯示')}
          {visible.length} / {rows.length} {tr('個資料夾')}
        </span>
      </div>
      {initialView && (
        <ReactFlow
          onInit={setFlow}
          nodes={nodes.map((n) => ({ ...n, selected: n.id === selected }))}
          edges={edges}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          deleteKeyCode={null}
          fitView={false}
          defaultViewport={initialView}
          minZoom={0.05}
          maxZoom={4}
          onlyRenderVisibleElements
          zoomOnDoubleClick={false}
          onNodeClick={(_, node) => onSelect(node.id)}
          onNodeDoubleClick={(_, node) => onOpen(node.id)}
          onNodeContextMenu={(e, node) => {
            e.preventDefault()
            onConfigure(node.id)
          }}
          onMoveEnd={(_, v) => save(v)}
          colorMode={theme === 'dark' ? 'dark' : 'light'}
        >
          <Background />
          <Controls showZoom={false} showFitView={false} showInteractive={false}>
            <ControlButton
              aria-label={tr('放大')}
              title={tr('放大')}
              onClick={() => void flow?.zoomIn()}
            >
              <Icon name="plus" />
            </ControlButton>
            <ControlButton
              aria-label={tr('縮小')}
              title={tr('縮小')}
              onClick={() => void flow?.zoomOut()}
            >
              <Icon name="minus" />
            </ControlButton>
            <ControlButton
              aria-label={tr('重設縮放')}
              title={tr('重設縮放')}
              onClick={() => void flow?.fitView()}
            >
              <Icon name="focus" />
            </ControlButton>
          </Controls>
          {nodes.length > 12 && <MiniMap pannable zoomable />}
        </ReactFlow>
      )}
    </div>
  )
}
