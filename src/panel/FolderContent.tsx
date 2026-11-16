import { MediaBrowser } from '../media/MediaBrowser'
import { BookCard, BookShelf, FilePage } from './FilePage'
import { MediaViewer } from '../media/MediaViewer'
import { isGameFolder, visibleFile } from '../../shared/media'
import { effectiveKind, sampleOf, templateKind } from '../../shared/kind'
import { savedPlace, sortVolumes } from '../../shared/reader'
import { PanelSkeleton } from './PanelSkeleton'
import { useFileVisibility } from '../files/useFileVisibility'
import { DocumentViewer } from '../documents/DocumentViewer'
import { cacheFolderStats } from '../browse/folderStats'
import { useParentKind } from '../browse/folderKind'
import { GamePage } from '../game/GamePage'
import { t as tr, useLocale } from '../i18n'
import { useRefreshNonce } from '../browse/refresh'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Button } from '@mantine/core'
import { bookCellsFor } from '../../shared/layouts'
import { Card } from '../cells/Card'
import { FolderPage, folderPageKind } from './FolderPage'
import { Gallery } from '../gallery/Gallery'
import {
  contentCells,
  type ContentResult,
  type ExplorerRequest,
  type ExplorerResponse,
  type MediaPrefs,
} from '../../shared/explorer'
import { type FolderRow, type Project, type Request, type Response } from '../../shared/model'
const Reader = lazy(() => import('../reader/Reader').then((module) => ({ default: module.Reader })))
const VideoViewer = lazy(() =>
  import('../video/VideoViewer').then((m) => ({ default: m.VideoViewer }))
)
// The last folders' listings, so opening the panel on a folder seen a moment ago shows it at once while a fresh
// listing loads behind it.
const contentCache = new Map<string, ContentResult>()
const rememberContent = (rowId: string, value: ContentResult) => {
  contentCache.delete(rowId)
  contentCache.set(rowId, value)
  if (contentCache.size > 24) contentCache.delete(contentCache.keys().next().value!)
}

export function FolderContent({
  row,
  project,
  run,
  onChild,
  act,
  busy,
  configure,
  selectedFileId,
  selectedEntry,
  childNames,
  sourceRows,
  onSource,
  mediaPrefs,
  onMediaPrefs,
  nextBook,
  autoRead,
  onAutoRead,
}: {
  row: FolderRow
  project: Project
  run: (r: ExplorerRequest) => Promise<ExplorerResponse | undefined>
  onChild: (name: string) => void
  act: (r: Request) => Promise<Response | undefined>
  busy: boolean
  configure: (tab?: 'game') => void
  sourceRows: FolderRow[]
  onSource: (id: string) => void
  childNames?: string[]
  mediaPrefs?: MediaPrefs
  onMediaPrefs?: (prefs: MediaPrefs) => void
  selectedFileId?: string
  selectedEntry?: ContentResult['entries'][number]
  // R-255: the next folder in the browse list, and whether this folder was opened as that next book.
  nextBook?: { name: string; open: (keepImmersive: boolean) => void }
  // 'immersive' when the previous book was read in immersive mode, which carries over (R-275).
  autoRead?: 'normal' | 'immersive'
  onAutoRead?: () => void
}) {
  useLocale()
  const parentKind = useParentKind(row)
  const { visibility } = useFileVisibility()
  const contentRow = useRef(row.rowId)
  const [galleryFile, setGalleryFile] = useState<ContentResult['entries'][number]>(),
    [galleryImmersive, setGalleryImmersive] = useState(false)

  const [content, setContent] = useState<ContentResult | undefined>(() =>
      contentCache.get(row.rowId)
    ),
    [error, setError] = useState(''),
    [reload, setReload] = useState(0),
    refresh = useRefreshNonce(),
    [, setReader] = useState(false),
    [fileReader, setFileReader] = useState(false),
    [documentFile, setDocumentFile] = useState<ContentResult['entries'][number]>()
  // R-282: after the last page of a text book, the next text book in this folder. R-415: a comic archive (CBZ) goes on
  // to the next archive the same way.
  const nextText = (file: ContentResult['entries'][number]) => {
    const books = sortVolumes((content?.entries ?? []).filter((entry) => entry.kind === file.kind)),
      following = books[books.findIndex((entry) => entry.id === file.id) + 1]
    return following && following.id !== file.id
      ? { name: following.name, open: () => setDocumentFile(following) }
      : undefined
  }
  useEffect(() => {
    let alive = true
    if (contentRow.current !== row.rowId) {
      setContent(contentCache.get(row.rowId))
      contentRow.current = row.rowId
    }
    setError('')
    const paged = !isGameFolder(row)
    void (async () => {
      let cursor: string | undefined
      const counted: ContentResult['entries'] = []
      let accumulated: ContentResult | undefined
      do {
        const response = await window.explorer.request({
          action: 'content',
          rowId: row.rowId,
          ...(paged ? { limit: cursor ? 256 : 96, cursor } : {}),
        })
        if (!alive) return
        const chunk = response.content
        if (!chunk) throw new Error(tr('無法取得資料夾內容'))
        const append = !!cursor
        accumulated =
          append && accumulated
            ? {
                ...chunk,
                entries: [...accumulated.entries, ...chunk.entries],
                notices: [...accumulated.notices, ...chunk.notices],
              }
            : chunk
        setContent(accumulated)
        counted.push(...chunk.entries)
        cursor = chunk.nextCursor
        if (!cursor) {
          cacheFolderStats(row.rowId, counted)
          if (accumulated) rememberContent(row.rowId, accumulated)
        }
        // Yield between chunks so navigation and the first screen can render.
        if (cursor) await new Promise((resolve) => setTimeout(resolve, 50))
      } while (alive && cursor)
    })().catch((e) => {
      if (alive) setError(String(e))
    })
    return () => {
      alive = false
    }
  }, [row.rowId, row.path, reload, refresh])
  useEffect(() => {
    setFileReader(false)
    setDocumentFile(undefined)
  }, [row.rowId, selectedFileId])
  // Opened as the next book: go straight to reading from its first image. Remembered from the first render, since
  // the workspace drops the request as soon as the panel has switched.
  const readFirst = useRef(autoRead)
  useEffect(() => {
    if (!readFirst.current || !content) return
    const first = content.entries.find(
      (entry) => entry.kind === 'image' && visibleFile(entry, visibility)
    )
    const immersive = readFirst.current === 'immersive'
    readFirst.current = undefined
    if (first) {
      setGalleryImmersive(immersive)
      setGalleryFile(first)
    } else if (immersive && document.fullscreenElement)
      void document.exitFullscreen().catch(() => {})
    onAutoRead?.()
  }, [content])
  if (error && !content)
    return (
      <p role="alert" className="media-content-error">
        {error}
        <Button size="compact-xs" variant="subtle" onClick={() => setReload((value) => value + 1)}>
          {tr('重新載入')}
        </Button>
      </p>
    )
  if (!content) return <PanelSkeleton />
  const visibleEntries = content.entries.filter((entry) => visibleFile(entry, visibility))
  const selectedFile = visibleEntries.find((entry) => entry.id === selectedFileId) ?? selectedEntry
  // Music and video folders share one page and one content template (R-387).
  const folderKind = effectiveKind(row, sampleOf(content.entries), parentKind),
    kind = templateKind(folderKind)
  // R-389: every kind is drawn by the same skeleton (FolderPage); the kind only picks its page. Everything that is
  // not a game main folder or a book uses the unified file page.
  const page = folderPageKind(kind, row)
  if (page === 'media' && (!selectedFile || ['audio', 'video'].includes(selectedFile.kind)))
    return (
      <MediaBrowser
        prefs={mediaPrefs}
        onPrefs={onMediaPrefs}
        row={row}
        project={project}
        album={folderKind === 'music'}
        video={folderKind === 'video'}
        entries={visibleEntries}
        loading={!!content.nextCursor && !error}
        error={[error, ...new Set(content.notices)].filter(Boolean).join('\n')}
        onChild={onChild}
        run={run}
        act={act}
        busy={busy}
        configure={configure}
        childNames={childNames}
        sourceRows={sourceRows}
        onSource={onSource}
      />
    )
  if (selectedFile && selectedFile.kind !== 'video')
    return (
      <FilePage
        row={row}
        file={selectedFile}
        openFolder={() => void act({ action: 'open', rowId: row.rowId })}
        open={
          ['pdf', 'archive', 'text'].includes(selectedFile.kind)
            ? () => setDocumentFile(selectedFile)
            : selectedFile.kind === 'image'
              ? () => setFileReader(true)
              : undefined
        }
      >
        {documentFile && (
          <DocumentViewer
            rowId={row.rowId}
            file={documentFile}
            close={() => setDocumentFile(undefined)}
            row={row}
            run={run}
            next={nextText(documentFile)}
          />
        )}
        {selectedFile.kind === 'image' && fileReader && (
          <Suspense fallback={<PanelSkeleton />}>
            <Reader
              images={content.entries.filter((entry) => entry.kind === 'image')}
              start={content.entries
                .filter((entry) => entry.kind === 'image')
                .findIndex((entry) => entry.id === selectedFile.id)}
              manga={kind === 'book'}
              // R-322: an image picked by hand opens at that image, never at the book's saved page.
              resume={false}
              prefs={row.record?.details?.reading}
              close={() => setFileReader(false)}
              save={(prefs) => {
                if (row.record && !row.readonly && !row.stopped && !row.error)
                  void run({
                    action: 'reading',
                    rowId: row.rowId,
                    revision: row.record.revision,
                    prefs,
                  })
              }}
            />
          </Suspense>
        )}
      </FilePage>
    )
  if (selectedFile?.kind === 'video')
    return (
      <Suspense fallback={<p>{tr('載入播放器…')}</p>}>
        <VideoViewer
          initialFileId={selectedFile?.id}
          key={row.rowId}
          row={row}
          entries={visibleEntries}
          run={run}
          busy={busy}
          autoplay
          autoNext={false}
          changeAutoplay={async () => false}
          changeAutoNext={async () => false}
        />
      </Suspense>
    )
  if (page === 'game')
    return (
      <GamePage row={row} project={project} run={run} act={act} busy={busy} configure={configure} />
    )
  const first = content.entries.find((e) => e.kind === 'image'),
    // R-362: only an edited book template from before the cover became a component still has it drawn beside it.
    legacyCover =
      kind === 'book' && project.contentCells?.book !== undefined && !project.contentCover
  // The pictures the reader will show, and the saved place among them once the whole folder is listed.
  const pages = visibleEntries.filter((entry) => entry.kind === 'image'),
    firstPage = pages[0],
    place = content.nextCursor ? undefined : savedPlace(row.record?.details?.reading, pages.length)
  // R-390: a folder of text books: one EPUB gets a book card; 繼續閱讀 goes back to the book read most recently.
  const books = content.entries.filter((entry) => entry.kind === 'text'),
    epubs = books.filter((entry) => /\.epub$/i.test(entry.name)),
    novels = row.record?.details?.novels ?? {},
    lastRead = books
      .filter((entry) => {
        const saved = novels[entry.name]
        return saved && saved.percent > 0 && saved.percent < 1
      })
      .sort((a, b) => (novels[b.name]!.updated > novels[a.name]!.updated ? 1 : -1))[0]
  // The book page (R-389: the fill-ins of the shared folder page).
  return (
    <FolderPage
      page={page}
      row={row}
      project={project}
      openFolder={() => void act({ action: 'open', rowId: row.rowId })}
      folders={content.entries.filter((e) => e.kind === 'folder')}
      childNames={childNames}
      busy={busy}
      onChild={onChild}
      overlay={
        <>
          {galleryFile && (
            <MediaViewer
              row={row}
              project={project}
              file={galleryFile}
              entries={visibleEntries}
              loading={!!content.nextCursor}
              run={run}
              act={act}
              busy={busy}
              manga={kind === 'book'}
              close={() => {
                setGalleryFile(undefined)
                setGalleryImmersive(false)
              }}
              nextBook={nextBook}
              startImmersive={galleryImmersive}
            />
          )}
          {documentFile && (
            <DocumentViewer
              rowId={row.rowId}
              file={documentFile}
              close={() => setDocumentFile(undefined)}
              row={row}
              run={run}
              next={nextText(documentFile)}
            />
          )}
        </>
      }
      lead={
        <BookShelf
          row={row}
          entries={content.entries.filter((entry) =>
            ['archive', 'pdf', 'text'].includes(entry.kind)
          )}
          open={setDocumentFile}
        />
      }
      notice={
        error && (
          <p role="alert" className="media-content-error">
            {tr('部分內容讀取未完成，已載入的圖片仍可查看。')}
            {error}
            <Button
              size="compact-xs"
              variant="subtle"
              onClick={() => setReload((value) => value + 1)}
            >
              {tr('重新載入')}
            </Button>
          </p>
        )
      }
      visual={
        <div className="media-info-template">
          {!firstPage && epubs.length === 1 && <BookCard row={row} file={epubs[0]} />}
          {legacyCover && first && (
            <img
              className="manga-cover"
              src={first.thumb ?? first.url}
              onError={(e) => {
                if (e.currentTarget.src !== first.url) e.currentTarget.src = first.url
                else e.currentTarget.style.display = 'none'
              }}
              alt={first.name}
            />
          )}
          {/* The default template (name and path) repeats the panel header and folder details, so only a user-edited one is
            shown; a book always shows its template, which starts with the cover (R-362). */}
          {kind === 'book' || project.contentCells?.[kind]?.length ? (
            <Card
              project={{
                ...project,
                folderLayouts: undefined,
                cells:
                  kind === 'book'
                    ? bookCellsFor(project, row.record?.folderId, contentCells(project, kind))
                    : contentCells(project, kind),
              }}
              row={row}
              open={() => {
                void window.media.request({ action: 'open', rowId: row.rowId })
              }}
            />
          ) : null}
        </div>
      }
      actions={
        // R-390: where the manga was left and the button to read on. The reader decides the page itself (R-253), so
        // this opens it at the first picture like a click on the first thumbnail.
        !firstPage && lastRead ? (
          <div className="book-actions">
            <Button size="compact-sm" onClick={() => setDocumentFile(lastRead)}>
              {tr('繼續閱讀')}
            </Button>
            <small>{lastRead.name.replace(/\.(txt|epub|md)$/i, '')}</small>
          </div>
        ) : (
          firstPage && (
            <div className="book-actions">
              <Button size="compact-sm" onClick={() => setGalleryFile(firstPage)}>
                {(place?.resumes ??
                (!!content.nextCursor && (row.record?.details?.reading?.page ?? 0) > 0))
                  ? tr('繼續閱讀')
                  : tr('開始閱讀')}
              </Button>
              {place && <small>{tr('讀到 {0} / {1} 頁', place.page, place.total)}</small>}
            </div>
          )
        )
      }
      list={
        // R-338: a folder of books only has no picture list to show.
        (content.entries.some((entry) => entry.kind === 'image') ||
          !content.entries.some((entry) => ['archive', 'pdf', 'text'].includes(entry.kind))) && (
          <Gallery
            entries={content.entries}
            loading={!!content.nextCursor && !error}
            manga={kind === 'book'}
            prefs={row.record?.details?.reading}
            onReader={setReader}
            suspended={!!galleryFile}
            onOpen={(entry) => setGalleryFile(entry)}
            save={(prefs) => {
              if (row.record && !row.readonly && !row.stopped && !row.error)
                void run({
                  action: 'reading',
                  rowId: row.rowId,
                  revision: row.record.revision,
                  prefs,
                })
            }}
          />
        )
      }
    />
  )
}
