import type { ReactNode } from 'react'
import type { FolderRow, Project } from '../../shared/model'
import type { TemplateKind } from '../../shared/kind'
import { isGameFolder } from '../../shared/media'
import { FolderDetails, SubfolderList } from './FolderParts'

// R-389: every folder page in the right panel is the same skeleton of blocks, always in this order:
//   details › subfolders › main visual › sort/filter/view controls › the kind's own actions › content list.
// A page only says which blocks it shows (the table below) and what fills them (the props of FolderPage), so a
// kind's defaults change here and in its fill-ins, without another code path.
export type FolderPageKind = 'game' | 'book' | 'media'
export interface FolderPageSpec {
  // The class of the page's frame; styles and UI tests go by it.
  className: string
  // The details list every value stored for the folder, not only the project's fields, and show long text whole.
  allFields: boolean
  subfolders: boolean
  visual: boolean
  controls: boolean
  actions: boolean
  // Where the page's notices (errors, loading status) go: above the details, or just above the content list.
  notice: 'top' | 'list'
  // Viewers that open over the page are kept at its start or its end.
  overlay: 'first' | 'last'
  // Whether the page may show something above the details (the book page lists its book files there).
  lead: boolean
}
export const folderPages: Record<FolderPageKind, FolderPageSpec> = {
  // A game main folder: its inside is protected, so no subfolders or files are offered; its fields are all in the
  // details (R-390).
  game: {
    className: 'game-content',
    allFields: true,
    subfolders: false,
    visual: true,
    controls: false,
    actions: true,
    notice: 'top',
    overlay: 'first',
    lead: false,
  },
  // Books and manga: the picture list brings its own reading controls. Its action bar is the place a manga was left
  // and the button to read on (R-390).
  book: {
    className: 'media-content',
    allFields: false,
    subfolders: true,
    visual: true,
    controls: false,
    actions: true,
    notice: 'top',
    overlay: 'first',
    lead: true,
  },
  // Music, video and general folders share the unified file page.
  media: {
    className: 'mixed-media-browser',
    allFields: false,
    subfolders: true,
    visual: true,
    controls: true,
    actions: false,
    notice: 'list',
    overlay: 'last',
    lead: false,
  },
}
// The page a folder gets. Only a game main folder (or a possible one) has the game page; a folder merely set to
// the game kind is browsed as files.
export const folderPageKind = (kind: TemplateKind, row: FolderRow): FolderPageKind =>
  kind === 'book' ? 'book' : kind === 'game' && isGameFolder(row) ? 'game' : 'media'

export function FolderPage({
  page,
  row,
  project,
  openFolder,
  folders,
  childNames,
  busy,
  onChild,
  lead,
  notice,
  visual,
  controls,
  actions,
  list,
  overlay,
}: {
  page: FolderPageKind
  row: FolderRow
  project: Project
  openFolder: () => void
  // The folders directly inside; the block is hidden when there are none.
  folders?: { id: string; name: string }[]
  childNames?: string[]
  busy: boolean
  onChild?: (name: string) => void
  lead?: ReactNode
  notice?: ReactNode
  visual?: ReactNode
  controls?: ReactNode
  actions?: ReactNode
  list?: ReactNode
  overlay?: ReactNode
}) {
  const spec = folderPages[page]
  return (
    <div className={spec.className}>
      {spec.overlay === 'first' && overlay}
      {spec.lead && lead}
      {spec.notice === 'top' && notice}
      <FolderDetails row={row} project={project} openFolder={openFolder} all={spec.allFields} />
      {spec.subfolders && folders && onChild && (
        <SubfolderList folders={folders} childNames={childNames} busy={busy} onChild={onChild} />
      )}
      {spec.visual && visual}
      {spec.controls && controls}
      {spec.actions && actions}
      {spec.notice === 'list' && notice}
      {list}
      {spec.overlay === 'last' && overlay}
    </div>
  )
}
