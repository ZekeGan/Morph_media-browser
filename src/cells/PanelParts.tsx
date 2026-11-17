import type { Cell, FolderRow, Project } from '../../shared/model'
import { AlbumHeader } from '../media/AlbumView'
import { VideoHeader } from '../media/VideoHeader'
import { BookCard } from '../panel/FilePage'
import { FolderAlbumCover } from '../media/FolderAlbumCover'
import { t as tr } from '../i18n'
import { usePanelContent } from './panelContext'

// R-409 (provisional): the right panel's main visuals as components. They show what the page has read about the
// folder; on a card or in the editor, where nothing is read, they say what they are.
export const panelPartKinds = ['album-info', 'video-info', 'book-card'] as const
export function PanelPart({
  cell,
  row,
  project,
}: {
  cell: Cell
  row?: FolderRow
  project?: Project
}) {
  const content = usePanelContent()
  const name = {
    'album-info': tr('專輯資訊'),
    'video-info': tr('影片數與播放'),
    'book-card': tr('書籍資訊（EPUB）'),
  }[cell.kind as (typeof panelPartKinds)[number]]
  if (!content || !row || !project) return <span className="cell-panel-part">{name}</span>
  // Outside a music folder the album info is the cover alone (a chosen cover or the first track's embedded one).
  if (cell.kind === 'album-info')
    return content.album ? (
      <AlbumHeader row={row} entries={content.entries} album={content.album} />
    ) : (
      <FolderAlbumCover row={row} files={content.entries} />
    )
  if (cell.kind === 'video-info')
    return <VideoHeader row={row} project={project} entries={content.entries} />
  if (cell.kind === 'book-card')
    return content.epub ? <BookCard row={row} file={content.epub} /> : null
  return null
}
