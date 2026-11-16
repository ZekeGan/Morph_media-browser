import { useEffect, useState, type ReactNode } from 'react'
import { ActionIcon, Button, Group, Progress, Text, Tooltip } from '@mantine/core'
import type { MediaEntry, NovelBook } from '../../shared/explorer'
import type { FolderRow } from '../../shared/model'
import { currentLocale, t as tr, useLocale } from '../i18n'
import { Icon, type IconName } from '../common/icons'
import { audioCover } from '../media/MediaThumb'
import { fileSize, friendlyType } from '../media/fileLabels'

// R-337: one file in the right panel — a large preview, the kind and size in words, the main action for its kind,
// and the details folded away. R-338: a text book shows its cover, title, author, chapters and the place it was left.
const kindIcon: Record<string, IconName> = {
  image: 'image',
  audio: 'music',
  video: 'video',
  text: 'book',
  pdf: 'file',
  archive: 'file',
}

export function FilePage({
  row,
  file,
  open,
  openFolder,
  children,
}: {
  row: FolderRow
  file: MediaEntry
  // The main action: read, view or play the file.
  open?: () => void
  openFolder: () => void
  // The viewer, when it is open.
  children?: ReactNode
}) {
  useLocale()
  const [book, setBook] = useState<NovelBook>(),
    [cover, setCover] = useState<string>()
  useEffect(() => {
    setBook(undefined)
    setCover(undefined)
    let alive = true
    if (file.kind === 'text')
      void window.explorer
        .request({ action: 'novel', rowId: row.rowId, fileId: file.id, summary: true })
        .then((result) => alive && setBook(result.novel))
        .catch(() => {})
    if (file.kind === 'audio') void audioCover(file.url).then((url) => alive && setCover(url))
    return () => {
      alive = false
    }
  }, [row.rowId, file.id, file.kind, file.url])
  const saved = file.kind === 'text' ? row.record?.details?.novels?.[file.name] : undefined
  const preview =
    file.kind === 'image'
      ? file.url
      : file.kind === 'audio'
        ? cover
        : file.kind === 'text'
          ? book?.cover
          : file.thumb
  const chapterName = (index: number) =>
    book?.chapters[index]?.title || tr('第 {0} 部分', index + 1)
  const action =
    file.kind === 'text'
      ? saved && saved.percent > 0 && saved.percent < 1
        ? tr('繼續閱讀（{0}）', chapterName(saved.chapter))
        : tr('開始閱讀')
      : file.kind === 'audio' || file.kind === 'video'
        ? tr('播放')
        : file.kind === 'image'
          ? tr('檢視圖片')
          : tr('開啟檢視器')
  return (
    <div className="file-page">
      <button
        type="button"
        className={'file-page-preview' + (preview ? '' : ' empty')}
        aria-label={action + ' · ' + file.name}
        disabled={!open}
        onClick={open}
      >
        {preview ? (
          <img src={preview} alt="" />
        ) : (
          <Icon name={kindIcon[file.kind] ?? 'file'} size={48} />
        )}
      </button>
      <div className="file-page-heading">
        <h3 title={file.name}>{book?.title || file.name}</h3>
        <Tooltip label={tr('開啟所在資料夾')}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={tr('開啟所在資料夾')}
            onClick={openFolder}
          >
            <Icon name="folder" size={15} />
          </ActionIcon>
        </Tooltip>
      </div>
      {book?.author && <Text size="sm">{book.author}</Text>}
      <Text size="sm" c="dimmed">
        {[
          friendlyType(file),
          fileSize(file.size),
          ...(book ? [tr('{0} 章', book.chapters.length)] : []),
        ].join(' · ')}
      </Text>
      {saved && saved.percent > 0 && (
        <div className="file-page-progress">
          <Progress value={Math.round(saved.percent * 100)} size="sm" aria-label={tr('閱讀進度')} />
          <Text size="xs" c="dimmed">
            {tr(
              '讀到 {0} · {1}% · {2}',
              chapterName(saved.chapter),
              Math.round(saved.percent * 100),
              new Date(saved.updated).toLocaleDateString(currentLocale())
            )}
          </Text>
        </div>
      )}
      {open && (
        <Group>
          <Button onClick={open}>{action}</Button>
        </Group>
      )}
      <details className="file-page-details">
        <summary>{tr('詳細資料')}</summary>
        <dl>
          <dt>{tr('檔名')}</dt>
          <dd>{file.name}</dd>
          <dt>{tr('格式')}</dt>
          <dd>{file.mime}</dd>
          <dt>{tr('大小')}</dt>
          <dd>{tr('{0} 位元組', file.size.toLocaleString(currentLocale()))}</dd>
          <dt>{tr('修改日期')}</dt>
          <dd>{new Date(file.modified).toLocaleString(currentLocale())}</dd>
          {book?.format === 'txt' && (
            <>
              <dt>{tr('編碼')}</dt>
              <dd>{book.encoding.toUpperCase()}</dd>
            </>
          )}
          <dt>{tr('位置')}</dt>
          <dd className="path">{row.path}</dd>
        </dl>
      </details>
      {children}
    </div>
  )
}

// A comic archive the reader can open (CBZ; CBR and CB7 are not read yet and are not listed as books).
export const isComicArchive = (entry: { kind: string; name: string }) =>
  entry.kind === 'archive' && /\.cbz$/i.test(entry.name)

// R-338: the text books (and other documents) in a folder, each with how far it has been read.
export function BookShelf({
  row,
  entries,
  open,
}: {
  row: FolderRow
  entries: MediaEntry[]
  open: (entry: MediaEntry) => void
}) {
  useLocale()
  // R-390: two or more comic archives are the volumes of one work and are shown as tiles; everything else (and a
  // single archive) stays in the list.
  const comics = entries.filter(isComicArchive),
    volumes = comics.length >= 2 ? comics : [],
    listed = entries.filter((entry) => !volumes.includes(entry))
  if (!entries.length) return null
  return (
    <>
      {!!volumes.length && (
        <ul className="book-volumes" aria-label={tr('分冊')}>
          {volumes.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="book-volume"
                aria-label={tr('開啟') + ' ' + entry.name}
                title={entry.name}
                onClick={() => open(entry)}
              >
                <span className="book-volume-cover" aria-hidden="true">
                  <Icon name="page-spread" size={32} />
                </span>
                <span className="book-volume-name">{entry.name.replace(/\.cbz$/i, '')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!!listed.length && (
        <ul className="book-shelf" aria-label={tr('文字書與文件')}>
          {listed.map((entry) => {
            const saved =
                entry.kind === 'text' ? row.record?.details?.novels?.[entry.name] : undefined,
              percent = saved ? Math.round(saved.percent * 100) : 0
            return (
              <li key={entry.id}>
                <Icon name={kindIcon[entry.kind] ?? 'file'} size={18} />
                <div className="book-shelf-name">
                  <span title={entry.name}>{entry.name.replace(/\.(txt|epub)$/i, '')}</span>
                  {entry.kind === 'text' && (
                    <Progress value={percent} size="xs" aria-label={tr('閱讀進度')} />
                  )}
                </div>
                <small>{saved ? percent + '%' : friendlyType(entry)}</small>
                {(() => {
                  const label =
                    entry.kind !== 'text'
                      ? tr('開啟')
                      : saved && saved.percent > 0 && saved.percent < 1
                        ? tr('繼續閱讀')
                        : tr('開始閱讀')
                  return (
                    <Button
                      size="compact-sm"
                      variant="light"
                      aria-label={label + ' ' + entry.name}
                      onClick={() => open(entry)}
                    >
                      {label}
                    </Button>
                  )
                })()}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
