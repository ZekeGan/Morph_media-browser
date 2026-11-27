import type { ReactNode } from 'react'

import { builtinPanel } from '../../shared/explorer'
import type { FolderKind } from '../../shared/kind'
import { panelCells } from '../../shared/layouts'
import type { Cell, FolderRow, Project } from '../../shared/model'

import { Card } from './Card'
import { type PanelContent, PanelContentContext } from './panelContext'

// A folder's right panel: its chosen layout, else its kind's built-in one (`builtin` may add to it for this page).
export function PanelCard({
  project,
  row,
  kind,
  content,
  builtin,
  open,
  children,
}: {
  project: Project
  row: FolderRow
  kind: FolderKind
  content: PanelContent
  builtin?: (kind: FolderKind) => Cell[]
  open?: () => void
  children?: ReactNode
}) {
  const cells = panelCells(project, row, kind, builtin ?? ((k) => builtinPanel(project, k)))
  if (!cells.length && !children) return null
  return (
    <PanelContentContext.Provider value={content}>
      <div className="media-info-template">
        {children}
        {cells.length > 0 && (
          <Card
            // The panel shows these cells, never a card layout the rules would pick (R-413).
            project={{ ...project, layoutPresets: undefined, layoutRules: {}, cells }}
            row={row}
            open={open ?? (() => {})}
          />
        )}
      </div>
    </PanelContentContext.Provider>
  )
}
