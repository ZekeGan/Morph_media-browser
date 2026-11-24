import { useEffect, useRef, useState } from 'react'
import { Button } from '@mantine/core'
import type { Cell, FolderRow, Project } from '../../shared/model'
import type { NovelBook } from '../../shared/explorer'
import { trackClock } from '../../shared/album'
import { usePodcast } from '../media/AlbumView'
import { VideoPlayButton } from '../media/VideoHeader'
import { t as tr } from '../i18n'
import { usePanelContent } from './panelContext'
import { useFolderFacts } from './folderFacts'

// R-438 (provisional): the album, video and book facts as small components, like the game's system information. They
// show what the right panel's page has read about the folder; where nothing is read (a card, the editor) they show
// "—" for now.
export const mediaInfoKinds = [
  'albumName',
  'albumArtist',
  'albumYear',
  'trackCount',
  'totalLength',
  'videoCount',
  'bookTitle',
  'bookAuthor',
  'pages',
  'readPage',
] as const
export type MediaInfoKind = (typeof mediaInfoKinds)[number]
export const isMediaInfo = (value: unknown): value is MediaInfoKind =>
  (mediaInfoKinds as readonly unknown[]).includes(value)

const dash = <span className="muted">—</span>

// The EPUB's title and author, read once for the book card's folder.
function useEpubBook(row: FolderRow | undefined, fileId: string | undefined, wanted: boolean) {
  const [book, setBook] = useState<NovelBook>()
  useEffect(() => {
    setBook(undefined)
    if (!wanted || !row || !fileId) return
    let alive = true
    void window.explorer
      .request({ action: 'novel', rowId: row.rowId, fileId, summary: true })
      .then((result) => alive && setBook(result.novel))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [row?.rowId, fileId, wanted])
  return book
}

export function MediaInfo({ cell, row }: { cell: Cell; row?: FolderRow }) {
  const content = usePanelContent(),
    info = cell.systemInfo as MediaInfoKind,
    ref = useRef<HTMLSpanElement>(null),
    { podcast } = usePodcast(row ?? ({ rowId: '', path: '' } as FolderRow)),
    book = useEpubBook(row, content?.epub?.id, info === 'bookTitle' || info === 'bookAuthor'),
    // A card (no page has read the folder) asks main for its folder's facts once it is on screen.
    facts = useFolderFacts(row?.rowId, ref, !content && !!row)
  const summary = content?.album?.summary
  // What is known about the album: the page's reading of it, else what the index says for a card.
  const album = summary
    ? {
        name: summary.album ?? row?.name,
        artist: summary.artist,
        year: summary.year,
        count: summary.count,
        duration: summary.duration,
      }
    : !content && facts?.audio
      ? {
          name: facts.album ?? row?.name,
          artist: facts.artist,
          year: facts.year,
          count: facts.audio,
          duration: facts.duration,
        }
      : undefined
  const videos = content
    ? content.entries.filter((entry) => entry.kind === 'video').length
    : (facts?.video ?? 0)
  // A comic's place: the volume read most recently, else the pictures of the folder.
  const volume = Object.values(row?.record?.details?.volumes ?? {}).sort((a, b) =>
    b.updated.localeCompare(a.updated)
  )[0]
  const place = volume ? { page: volume.page + 1, total: volume.total } : content?.readPlace
  let text: string | undefined
  switch (info) {
    case 'albumName':
      text = album?.name
      break
    case 'albumArtist':
      text = album?.artist
      break
    case 'albumYear':
      // A podcast has no year to show.
      text = album?.year && !podcast ? String(album.year) : undefined
      break
    case 'trackCount':
      text = album ? (podcast ? tr('{0} 集', album.count) : tr('{0} 首', album.count)) : undefined
      break
    case 'totalLength':
      text = album?.duration !== undefined ? trackClock(album.duration) : undefined
      break
    case 'videoCount':
      text = videos ? tr('{0} 部影片', videos) : undefined
      break
    case 'bookTitle':
      text = book ? book.title || content?.epub?.name : undefined
      break
    case 'bookAuthor':
      text = book?.author || undefined
      break
    case 'pages':
      text = place ? tr('{0} 頁', place.total) : undefined
      break
    case 'readPage':
      text = place ? tr('讀到 {0} / {1} 頁', place.page, place.total) : undefined
      break
  }
  return <span ref={ref}>{text ?? dash}</span>
}

// 播放影片／繼續觀看 and 繼續閱讀 as buttons. They only work where the page has read the folder.
export function MediaButton({
  cell,
  row,
  project,
}: {
  cell: Cell
  row?: FolderRow
  project?: Project
}) {
  const content = usePanelContent()
  if (cell.kind === 'video-play')
    return content && row && project ? (
      <VideoPlayButton row={row} project={project} entries={content.entries} />
    ) : (
      <span className="muted">{tr('播放影片')}</span>
    )
  const readOn = content?.readOn
  if (!readOn) return <span className="muted">{tr('繼續閱讀')}</span>
  return (
    <span className="book-actions">
      <Button size="compact-sm" onClick={readOn.open}>
        {readOn.label}
      </Button>
      {readOn.detail && <small>{readOn.detail}</small>}
    </span>
  )
}
