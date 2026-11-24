import type { Cell, FolderRow, Project } from '../../shared/model'
import { AlbumFacts } from '../media/AlbumView'
import { VideoFacts } from '../media/VideoHeader'
import { BookCard } from '../panel/FilePage'
import { t as tr } from '../i18n'
import { usePanelContent } from './panelContext'

// R-409, R-437 (provisional): the right panel's facts as components. They show what the page has read about the
// folder; on a card or in the editor, where nothing is read, they say what they are.
export const panelPartKinds = ['album-facts', 'video-facts', 'book-card'] as const
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
    'album-facts': tr('專輯資訊'),
    'video-facts': tr('影片數與播放'),
    'book-card': tr('書籍資訊（EPUB）'),
  }[cell.kind as (typeof panelPartKinds)[number]]
  if (!content || !row || !project) return <span className="cell-panel-part">{name}</span>
  if (cell.kind === 'album-facts')
    return content.album ? <AlbumFacts row={row} album={content.album} /> : null
  if (cell.kind === 'video-facts')
    return <VideoFacts row={row} project={project} entries={content.entries} />
  if (cell.kind === 'book-card')
    return content.epub ? <BookCard row={row} file={content.epub} /> : null
  return null
}
