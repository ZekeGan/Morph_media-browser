import { Button } from '@mantine/core'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'

import {
  builtinPanel,
  type ContentResult,
  type ExplorerRequest,
  type ExplorerResponse,
  type MediaPrefs,
  type ReadingPrefs,
  withBookCard,
} from '../../shared/explorer'
import { effectiveKind, sampleOf, templateKind } from '../../shared/kind'
import { isGameFolder, visibleFile } from '../../shared/media'
import { type FolderRow, type Project, type Request, type Response } from '../../shared/model'
import { savedPlace, sortVolumes } from '../../shared/reader'

import { useParentKind } from '../browse/folderKind'
import { cacheFolderStats } from '../browse/folderStats'
import { useRefreshNonce } from '../browse/refresh'
import { PanelCard } from '../cells/PanelContent'
import { Gallery } from '../gallery/Gallery'
import { GamePage } from '../game/GamePage'
import { t as tr, useLocale } from '../i18n'
import { MediaBrowser } from '../media/MediaBrowser'
import { MediaViewer } from '../media/MediaViewer'
import { BookShelf, FilePage } from './FilePage'
import { FolderPage, folderPageKind } from './FolderPage'
import { PanelSkeleton } from './PanelSkeleton'

const Reader = lazy(() => import('../reader/Reader').then((module) => ({ default: module.Reader })))
// R-503: the document viewer comes with the first document opened (it was bundled here although lazy elsewhere).
const DocumentViewer = lazy(() =>
  import('../documents/DocumentViewer').then((m) => ({ default: m.DocumentViewer }))
)
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
  autoReadSettings,
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
  nextBook?: { name: string; open: (keepImmersive: boolean, settings?: ReadingPrefs) => void }
  // 'immersive' when the previous book was read in immersive mode, which carries over (R-275).
  autoRead?: 'normal' | 'immersive'
  // R-430: the reading settings of the previous book, used by this one while it has none of its own.
  autoReadSettings?: ReadingPrefs
  onAutoRead?: () => void
}) {
  useLocale()
  const parentKind = useParentKind(row)
  const contentRow = useRef(row.rowId)
  const [galleryFile, setGalleryFile] = useState<ContentResult['entries'][number]>()
  // R-517: true when the reader was opened by "繼續閱讀" (continue at the saved page), false for a picked picture.
  const [galleryResume, setGalleryResume] = useState(false)
  const [galleryImmersive, setGalleryImmersive] = useState(false)

  const [content, setContent] = useState<ContentResult | undefined>(() =>
    contentCache.get(row.rowId)
  )
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const refresh = useRefreshNonce()
  const [, setReader] = useState(false)
  const [fileReader, setFileReader] = useState(false)
  const [documentFile, setDocumentFile] = useState<ContentResult['entries'][number]>()
  // What the folder holds decides its kind; counted once per listing, not on every render (R-479 reads names).
  // R-494: the main process counts the whole folder with the first batch, so the kind does not change as the rest
  // comes in.
  const sample = useMemo(
    () => (content ? (content.sample ?? sampleOf(content.entries)) : undefined),
    [content?.entries, content?.sample]
  )
  // R-492: the file list asks for its batches in the order it shows; the other pages read files by name.
  const listOrder = useRef({ parentKind, sort: mediaPrefs?.sort })
  listOrder.current = { parentKind, sort: mediaPrefs?.sort }
  // R-282: after the last page of a text book, the next text book in this folder. R-415: a comic archive (CBZ) goes on
  // to the next archive the same way.
  const nextText = (file: ContentResult['entries'][number]) => {
    const books = sortVolumes((content?.entries ?? []).filter((entry) => entry.kind === file.kind))
    const following = books[books.findIndex((entry) => entry.id === file.id) + 1]
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
    // A folder listed before keeps showing that complete list while it is read again; the new list replaces it once,
    // when it is complete. Swapping in each part would shrink the list to its first part and re-sort it as the rest
    // comes in, so the page visibly jumps (a first visit still shows the parts as they come).
    const quiet = !!contentCache.get(row.rowId)
    // Whether the folder opens as the file list, guessed from what the scan counted (or the last listing) and checked
    // against the whole folder once the first batch is in.
    const { sort, parentKind: parent } = listOrder.current
    const isList = (counts?: ContentResult['sample']) =>
      folderPageKind(templateKind(effectiveKind(row, counts, parent)), row) === 'media'
    let sorted = !!sort && isList(contentCache.get(row.rowId)?.sample ?? row.contents)
    void (async () => {
      let cursor: string | undefined
      const counted: ContentResult['entries'] = []
      let accumulated: ContentResult | undefined
      let again = false
      do {
        again = false
        const response = await window.explorer.request({
          action: 'content',
          rowId: row.rowId,
          ...(paged ? { limit: cursor ? 256 : 96, cursor } : {}),
          ...(paged && sorted && !cursor ? { sort } : {}),
        })
        if (!alive) return
        const chunk = response.content
        if (!chunk) throw new Error(tr('無法取得資料夾內容'))
        // The guess was wrong: read again from the start in the order that page uses (once, the kind is now known).
        if (!cursor && paged && sort && chunk.sample && isList(chunk.sample) !== sorted) {
          sorted = !sorted
          again = true
          continue
        }
        const append = !!cursor
        accumulated =
          append && accumulated
            ? {
                ...chunk,
                entries: [...accumulated.entries, ...chunk.entries],
                notices: [...accumulated.notices, ...chunk.notices],
              }
            : chunk
        if (!quiet || !chunk.nextCursor) setContent(accumulated)
        counted.push(...chunk.entries)
        cursor = chunk.nextCursor
        if (!cursor) {
          cacheFolderStats(row.rowId, counted)
          if (accumulated) rememberContent(row.rowId, accumulated)
        }
        // Yield between chunks so navigation and the first screen can render.
        if (cursor) await new Promise((resolve) => setTimeout(resolve, 50))
      } while (alive && (cursor || again))
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
  const inherited = useRef(autoReadSettings)
  useEffect(() => {
    if (!readFirst.current || !content) return
    const first = content.entries.find((entry) => entry.kind === 'image' && visibleFile(entry))
    const immersive = readFirst.current === 'immersive'
    readFirst.current = undefined
    if (first) {
      setGalleryImmersive(immersive)
      setGalleryResume(false)
      setGalleryFile(first)
    } else if (immersive && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    }
    onAutoRead?.()
  }, [content])
  if (error && !content) {
    return (
      <p role="alert" className="media-content-error">
        {error}
        <Button size="compact-xs" variant="subtle" onClick={() => setReload((value) => value + 1)}>
          {tr('重新載入')}
        </Button>
      </p>
    )
  }
  if (!content) return <PanelSkeleton />
  const visibleEntries = content.entries.filter((entry) => visibleFile(entry))
  const selectedFile = visibleEntries.find((entry) => entry.id === selectedFileId) ?? selectedEntry
  // Music and video folders share one page and one content template (R-387).
  const folderKind = effectiveKind(row, sample, parentKind)
  const kind = templateKind(folderKind)
  // R-389: every kind is drawn by the same skeleton (FolderPage); the kind only picks its page. Everything that is
  // not a game main folder or a book uses the unified file page.
  const page = folderPageKind(kind, row)
  if (page === 'media' && (!selectedFile || ['audio', 'video'].includes(selectedFile.kind))) {
    return (
      <MediaBrowser
        prefs={mediaPrefs}
        onPrefs={onMediaPrefs}
        row={row}
        project={project}
        album={folderKind === 'music'}
        video={folderKind === 'video'}
        kind={folderKind}
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
  }
  if (selectedFile && selectedFile.kind !== 'video') {
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
          <Suspense fallback={null}>
            <DocumentViewer
              rowId={row.rowId}
              file={documentFile}
              close={() => setDocumentFile(undefined)}
              row={row}
              run={run}
              next={nextText(documentFile)}
            />
          </Suspense>
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
                if (row.record && !row.readonly && !row.stopped && !row.error) {
                  void run({
                    action: 'reading',
                    rowId: row.rowId,
                    revision: row.record.revision,
                    prefs,
                  })
                }
              }}
            />
          </Suspense>
        )}
      </FilePage>
    )
  }
  if (selectedFile?.kind === 'video') {
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
  }
  if (page === 'game') {
    return (
      <GamePage row={row} project={project} run={run} act={act} busy={busy} configure={configure} />
    )
  }
  // The pictures the reader will show, and the saved place among them once the whole folder is listed.
  const pages = visibleEntries.filter((entry) => entry.kind === 'image')
  const firstPage = pages[0]
  const place = content.nextCursor
    ? undefined
    : savedPlace(row.record?.details?.reading, pages.length)
  // R-390: a folder of text books: one EPUB gets a book card; 繼續閱讀 goes back to the book read most recently.
  const books = content.entries.filter((entry) => entry.kind === 'text')
  const epubs = books.filter((entry) => /\.epub$/i.test(entry.name))
  const bookCard = !firstPage && epubs.length === 1 ? epubs[0] : undefined
  const novels = row.record?.details?.novels ?? {}
  const lastRead = books
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
              inheritedPrefs={inherited.current}
              resume={galleryResume}
            />
          )}
          {documentFile && (
            <Suspense fallback={null}>
              <DocumentViewer
                rowId={row.rowId}
                file={documentFile}
                close={() => setDocumentFile(undefined)}
                row={row}
                run={run}
                next={nextText(documentFile)}
              />
            </Suspense>
          )}
        </>
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
        // R-409: the right panel's layout, else the built-in one; a folder of text books with one EPUB starts with
        // its book card.
        <PanelCard
          project={project}
          row={row}
          kind={folderKind}
          content={{
            entries: content.entries,
            epub: bookCard,
            // The same button and place the actions row below shows (R-438).
            readPlace: place && { page: place.page, total: place.total },
            readOn:
              !firstPage && lastRead
                ? {
                    label: tr('繼續閱讀'),
                    detail: lastRead.name.replace(/\.(txt|epub|md)$/i, ''),
                    open: () => setDocumentFile(lastRead),
                  }
                : firstPage
                  ? {
                      label:
                        (place?.resumes ??
                        (!!content.nextCursor && (row.record?.details?.reading?.page ?? 0) > 0))
                          ? tr('繼續閱讀')
                          : tr('開始閱讀'),
                      detail: place ? tr('讀到 {0} / {1} 頁', place.page, place.total) : undefined,
                      open: () => {
                        setGalleryResume(true)
                        setGalleryFile(firstPage)
                      },
                    }
                  : undefined,
          }}
          builtin={(k) =>
            bookCard ? withBookCard(builtinPanel(project, k)) : builtinPanel(project, k)
          }
          open={() => void window.media.request({ action: 'open', rowId: row.rowId })}
        />
      }
      actions={
        // R-390: where the manga was left and the button to read on. It opens the first picture with resume on, so the
        // reader goes to the saved page (R-253); a click on a thumbnail opens that page instead (R-517).
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
              <Button
                size="compact-sm"
                onClick={() => {
                  setGalleryResume(true)
                  setGalleryFile(firstPage)
                }}
              >
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
        <>
          {/* R-407, R-429: the book files, right under the actions like every page's content. */}
          <BookShelf
            row={row}
            entries={content.entries.filter((entry) =>
              ['archive', 'pdf', 'text'].includes(entry.kind)
            )}
            open={setDocumentFile}
          />
          {
            // R-338: a folder of books only has no picture list to show.
            (content.entries.some((entry) => entry.kind === 'image') ||
              !content.entries.some((entry) =>
                ['archive', 'pdf', 'text'].includes(entry.kind)
              )) && (
              <Gallery
                entries={content.entries}
                loading={!!content.nextCursor && !error}
                manga={kind === 'book'}
                prefs={row.record?.details?.reading}
                onReader={setReader}
                suspended={!!galleryFile}
                onOpen={(entry) => {
                  setGalleryResume(false)
                  setGalleryFile(entry)
                }}
                save={(prefs) => {
                  if (row.record && !row.readonly && !row.stopped && !row.error) {
                    void run({
                      action: 'reading',
                      rowId: row.rowId,
                      revision: row.record.revision,
                      prefs,
                    })
                  }
                }}
              />
            )
          }
        </>
      }
    />
  )
}
