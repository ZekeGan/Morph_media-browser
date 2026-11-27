import { Handle, type NodeProps, Position, useStore } from '@xyflow/react'
import { memo, type ReactNode } from 'react'

import { CARD_GAP, CARD_ROW, placeCells } from '../../shared/cardGrid'
import { cellVisible } from '../../shared/cells'
import { rowCells } from '../../shared/layouts'
import type { FolderRow, Project } from '../../shared/model'

import './tree-card.css'

// R-466: TREE nodes drawn as the folder's card. A node is as tall as the card layout the folder uses; zoomed out
// below COMPACT_ZOOM the card would be unreadable, so the compact label is drawn in its place (same size, so the
// layout does not move).
export const TREE_CARD_WIDTH = 280
export const COMPACT_ZOOM = 0.1
// The card's padding and border (style.css `.folder-card`), above and below the grid.
const CARD_CHROME = 30

export function treeCardHeight(project: Project, row: FolderRow, work: boolean) {
  const placed = placeCells(rowCells(project, row, work), (cell) => cellVisible(cell, row, project))
  const rows = placed.reduce((most, { y, h }) => Math.max(most, y + h), 1)
  return rows * (CARD_ROW + CARD_GAP) - CARD_GAP + CARD_CHROME
}

export type TreeCardData = {
  card: ReactNode
  compact: ReactNode
  toggle: ReactNode
}

export const TreeCardNode = memo(function TreeCardNode({ data }: NodeProps) {
  const { card, compact, toggle } = data as TreeCardData
  const small = useStore((state) => state.transform[2] < COMPACT_ZOOM)
  return (
    <div className={'tree-card-node' + (small ? ' compact' : ' folder-card')}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      {small ? (
        <div className="tree-card-compact">{compact}</div>
      ) : (
        <>
          {card}
          {toggle && <div className="tree-card-toggle">{toggle}</div>}
        </>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
})
