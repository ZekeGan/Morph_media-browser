import {
  type CSSProperties,
  type KeyboardEvent,
  memo,
  type MouseEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { FolderRow, Project, Request, Response } from '../../shared/model'

import { Card } from '../cells/Card'
import { t as tr } from '../i18n'
import { KindBadge } from './folderKind'

type Act = (request: Request) => Promise<Response | undefined>

export type Gestures = (id: string) => {
  onClick: (e: MouseEvent) => void
  onDoubleClick: () => void
  onContextMenu: (e: MouseEvent) => void
  onKeyDown: (e: KeyboardEvent) => void
}

// R-501: a card draws again only when its folder, the project or `act` change; selecting, hovering or scrolling
// used to draw every card on the page several times. What a card reads on its own (play time, folder stats) still
// updates it through its own hooks.
const CardBody = memo(function CardBody({
  project,
  row,
  act,
}: {
  project: Project
  row: FolderRow
  act: Act
}) {
  return (
    <Card project={project} row={row} open={() => void act({ action: 'open', rowId: row.rowId })} />
  )
})

// The CARD grid: one card per folder, with its selection and multi-select marks, and a small state note.
// R-565: optional lightweight masonry packs cards into the shortest column left-to-right without changing card heights.
export function FolderCards({
  rows,
  project,
  itemsPerRow,
  masonry = false,
  highlight,
  marked,
  gestures,
  showPanelFor,
  act,
}: {
  rows: FolderRow[]
  project: Project
  itemsPerRow: number
  masonry?: boolean
  highlight?: string
  marked: string[]
  gestures: Gestures
  showPanelFor: (id: string) => void
  act: Act
}) {
  const container = useRef<HTMLDivElement>(null)
  const heights = useRef(new Map<string, number>())
  const [cols, setCols] = useState(itemsPerRow)
  const [layoutTick, setLayoutTick] = useState(0)

  useLayoutEffect(() => {
    if (!masonry) return
    const host = container.current
    if (!host) return
    let raf = 0
    const measure = () => {
      const width = host.clientWidth
      const nextCols =
        width <= 560 ? 1 : width <= 840 ? Math.min(itemsPerRow, 2) : Math.max(1, itemsPerRow)
      setCols((prev) => (prev === nextCols ? prev : nextCols))
      let changed = false
      for (const node of host.querySelectorAll<HTMLElement>('.folder-card[data-row-id]')) {
        const id = node.dataset.rowId
        if (!id) continue
        const h = Math.round(node.getBoundingClientRect().height)
        if (h > 0 && Math.abs((heights.current.get(id) ?? 0) - h) > 2) {
          heights.current.set(id, h)
          changed = true
        }
      }
      if (changed) setLayoutTick((n) => n + 1)
    }
    const schedule = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        measure()
      })
    }
    measure()
    const observer = new ResizeObserver(schedule)
    observer.observe(host)
    for (const node of host.querySelectorAll<HTMLElement>('.folder-card[data-row-id]')) {
      observer.observe(node)
    }
    return () => {
      observer.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [masonry, itemsPerRow, rows])

  const columns = useMemo(() => {
    if (!masonry || cols <= 1) return null
    const buckets: FolderRow[][] = Array.from({ length: cols }, () => [])
    const colHeights = new Array<number>(cols).fill(0)
    for (const row of rows) {
      let best = 0
      for (let i = 1; i < cols; i++) {
        if (colHeights[i] < colHeights[best]) best = i
      }
      buckets[best].push(row)
      colHeights[best] += (heights.current.get(row.rowId) ?? 200) + 18
    }
    return buckets
  }, [masonry, cols, rows, layoutTick])

  const renderCard = (row: FolderRow) => (
    <article
      key={row.rowId}
      data-row-id={row.rowId}
      className={
        'folder-card ' +
        (highlight === row.rowId ? 'selected ' : '') +
        (marked.includes(row.rowId) ? 'marked' : '')
      }
      tabIndex={0}
      {...gestures(row.rowId)}
    >
      <KindBadge row={row} show={() => showPanelFor(row.rowId)} />
      <CardBody project={project} row={row} act={act} />
      {(row.error || !row.record || row.readonly) && (
        <small className="folder-state">
          {row.error ? tr('需要處理') : row.readonly ? tr('受保護') : tr('尚未建立資料')}
        </small>
      )}
    </article>
  )

  if (columns) {
    return (
      <div
        ref={container}
        className="cards cards-masonry"
        style={{ '--columns': cols } as CSSProperties}
      >
        {columns.map((bucket, index) => (
          <div key={index} className="cards-masonry-col">
            {bucket.map(renderCard)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div ref={container} className="cards" style={{ '--columns': itemsPerRow } as CSSProperties}>
      {rows.map(renderCard)}
    </div>
  )
}
