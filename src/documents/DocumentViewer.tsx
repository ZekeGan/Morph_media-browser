import { Button, FocusTrap, Group } from '@mantine/core'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import type {
  ExplorerRequest,
  ExplorerResponse,
  MediaEntry,
  ReadingPrefs,
} from '../../shared/explorer'
import type { FolderRow } from '../../shared/model'

import { t as tr, useLocale } from '../i18n'

const Reader = lazy(() => import('../reader/Reader').then((module) => ({ default: module.Reader })))
const NovelReader = lazy(() =>
  import('../novel/NovelReader').then((module) => ({ default: module.NovelReader }))
)

export function DocumentViewer({
  rowId,
  file,
  close,
  embedded = false,
  row,
  run,
  next,
}: {
  rowId: string
  file: MediaEntry
  close: () => void
  embedded?: boolean
  // Text books (R-282) open in the novel reader, which keeps the place in the folder record.
  row?: FolderRow
  run?: (request: ExplorerRequest) => Promise<ExplorerResponse | undefined>
  next?: { name: string; open: () => void }
}) {
  useLocale()
  // The pages belong to the archive they were read from: when the file changes, the previous book's pages are gone in
  // the same render (R-436), so the reader never mounts with another book's pages under the new key.
  const [loaded, setLoaded] = useState<{ id: string; entries: MediaEntry[] }>()
  const images = loaded?.id === file.id ? loaded.entries : undefined
  const [error, setError] = useState('')
  // R-430: the settings and immersive reading of the volume just finished, which the next volume starts with (the
  // folder's saved settings may not have come back from the save yet).
  const [carried, setCarried] = useState<{ settings: ReadingPrefs; immersive: boolean }>()
  const returnFocus = useRef(document.activeElement as HTMLElement)
  const onClose = useRef(close)
  onClose.current = close
  useEffect(() => () => returnFocus.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    if (images || file.kind === 'text') return
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault()
        onClose.current()
      }
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [images])
  useEffect(() => {
    if (file.kind !== 'archive') return
    let alive = true
    setError('')
    void window.explorer
      .request({ action: 'archive', rowId, fileId: file.id })
      .then((result) => {
        if (!alive) return
        if (!result.content?.entries.length) throw new Error(tr('壓縮檔內沒有支援的圖片'))
        setLoaded({ id: file.id, entries: result.content.entries })
      })
      .catch((reason) => {
        if (alive) setError(String(reason))
      })
    return () => {
      alive = false
    }
  }, [rowId, file.id, file.kind])
  if (file.kind === 'text' && row) {
    return (
      <Suspense fallback={<p>{tr('載入內容…')}</p>}>
        <NovelReader
          // R-345: the next book gets a fresh reader that starts from its own saved place.
          key={file.id}
          row={row}
          file={file}
          run={run}
          close={close}
          next={next}
          embedded={embedded}
        />
      </Suspense>
    )
  }
  // R-407: a comic archive of a book folder reads with the folder's shared reading settings and remembers its own page.
  const comic = file.kind === 'archive' && /\.(cbz|cbr|cb7)$/i.test(file.name) && !!row && !!run
  const reading = comic ? (carried?.settings ?? row?.record?.details?.reading) : undefined
  const volume = comic ? row?.record?.details?.volumes?.[file.name] : undefined
  const saveReading = (prefs: ReadingPrefs) => {
    if (!comic || !row?.record || !run || !images || row.readonly || row.stopped || row.error) {
      return
    }
    const { page, ...settings } = prefs
    const keys = [
      'spread',
      'rtl',
      'firstSingle',
      'webtoon',
      'webtoonWidth',
      'webtoonAsked',
    ] as const
    const sameSettings = keys.every(
      (key) =>
        // A direction nobody chose reads right to left, as the reader assumes.
        (key === 'rtl'
          ? (settings.rtl ?? true) === (reading?.rtl ?? true)
          : !!settings[key] === !!reading?.[key]) &&
        (key !== 'webtoonWidth' || settings[key] === reading?.[key])
    )
    // Just looking (still on the first page, nothing changed) writes nothing.
    if (sameSettings && (volume ? volume.page === page && volume.total === images.length : !page)) {
      return
    }
    void run({
      action: 'volumeProgress',
      rowId: row.rowId,
      fileId: file.id,
      page: page ?? 0,
      total: images.length,
      ...(sameSettings ? {} : { prefs: settings }),
    })
  }
  if (images) {
    return (
      <Suspense fallback={<p>{tr('載入內容…')}</p>}>
        <Reader
          key={file.id}
          embedded={embedded}
          images={images}
          start={0}
          manga
          prefs={comic ? { ...reading, page: volume?.page } : undefined}
          close={close}
          save={saveReading}
          // R-415: past the last page the reader offers the next book of the folder, as the text reader does.
          startImmersive={carried?.immersive}
          nextBook={
            next && {
              name: next.name,
              open: (immersive, settings) => {
                if (settings) setCarried({ settings, immersive })
                next.open()
              },
            }
          }
        />
      </Suspense>
    )
  }
  const view = (
    <FocusTrap active={!embedded}>
      <div
        className={'document-viewer' + (embedded ? ' document-embedded' : ' overlay-frame')}
        role="dialog"
        aria-modal="true"
        aria-label={file.name}
      >
        {!embedded && (
          <Group justify="space-between">
            <strong>{file.name}</strong>
            <Button data-autofocus variant="default" onClick={close}>
              {tr('關閉')}
            </Button>
          </Group>
        )}
        {error ? (
          <p role="alert">{error}</p>
        ) : file.kind === 'pdf' ? (
          <iframe title={file.name} src={file.url} />
        ) : (
          <p>{tr('載入內容…')}</p>
        )}
      </div>
    </FocusTrap>
  )
  return embedded ? view : createPortal(view, document.body)
}
