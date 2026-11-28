import {
  ActionIcon,
  Button,
  Menu,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Tooltip,
} from '@mantine/core'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  builtinPanelFor,
  type ContentResult,
  type ExplorerRequest,
  type ExplorerResponse,
  type MediaEntry,
  type MediaPrefs,
  type OverviewEntry,
} from '../../shared/explorer'
import { effectiveKind, type FolderKind } from '../../shared/kind'
import {
  canPreviewMedia,
  matchesMedia,
  type MediaFilter,
  type MediaSort,
  type MediaSortField,
  mediaSortFields,
  sortMedia,
  visibleFile,
} from '../../shared/media'
import type { FolderRow, Project, Request, Response } from '../../shared/model'

import { useRefreshNonce } from '../browse/refresh'
import { PanelCard } from '../cells/PanelContent'
import { iconLabel } from '../common/IconLabel'
import { Icon } from '../common/icons'
import { Gallery } from '../gallery/Gallery'
import { t as tr, useLocale } from '../i18n'
import { FolderPage } from '../panel/FolderPage'
import { AlbumActions, AlbumTracks, useAlbum } from './AlbumView'
import { MediaViewer } from './MediaViewer'
import { usePlayback } from './Playback'
import { podcastFolder } from './podcast'
import { placeProgress, useVideoPlaces, videoPlace } from './videoPlace'

import './media-workspace.css'

export function MediaBrowser({
  row,
  project,
  entries,
  loading,
  error,
  onChild,
  run,
  act,
  busy,
  configure,
  childNames,
  sourceRows,
  onSource,
  prefs,
  onPrefs,
  album = false,
  video = false,
  kind,
}: {
  row: FolderRow
  project: Project
  // A music folder: shown as an album (R-390).
  album?: boolean
  // A video folder: its header offers to play the videos (R-390).
  video?: boolean
  // The folder's kind, whose right-panel layout the page shows (R-409).
  kind: FolderKind
  entries: ContentResult['entries']
  loading: boolean
  error: string
  onChild: (name: string) => void
  configure: () => void
  childNames?: string[]
  sourceRows: FolderRow[]
  onSource: (id: string) => void
  prefs?: MediaPrefs
  onPrefs?: (prefs: MediaPrefs) => void
  run: (request: ExplorerRequest) => Promise<ExplorerResponse | undefined>
  act: (request: Request) => Promise<Response | undefined>
  busy: boolean
}) {
  useLocale()
  const [filter, setFilter] = useState<MediaFilter>(prefs?.filter ?? 'all')
  const [view, setView] = useState<string>(prefs?.view ?? 'masonry')
  const [scope, setScope] = useState<'current' | 'descendants'>(prefs?.scope ?? 'current')
  const [grouped, setGrouped] = useState(prefs?.grouped ?? false)
  // R-486: undefined keeps the order the files are listed in (shown as name, ascending).
  const [sort, setSort] = useState<MediaSort | undefined>(prefs?.sort)
  const version = useRefreshNonce()
  const [overview, setOverview] = useState<{
    entries: OverviewEntry[]
    notices: string[]
    loading: boolean
  }>({ entries: [], notices: [], loading: false })
  const [session, setSession] = useState<{
    file: MediaEntry
    source: FolderRow
    filter: MediaFilter
  }>()
  const [opening, setOpening] = useState('')
  const alive = useRef(true)
  const operation = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      operation.current++
    }
  }, [])
  // Remember the list's choices per project (scope, type, layout, grouping) once the user changes them.
  const mounted = useRef(false)
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true
      return
    }
    const next: MediaPrefs = {
      scope,
      filter,
      view: view as MediaPrefs['view'],
      grouped,
      ...(sort ? { sort } : {}),
    }
    if (JSON.stringify(next) !== JSON.stringify({ ...prefs })) onPrefs?.(next)
  }, [scope, filter, view, grouped, sort])
  useEffect(() => {
    if (scope !== 'descendants') return
    let active = true
    setOverview({ entries: [], notices: [], loading: true })
    void (async () => {
      let cursor: string | undefined
      do {
        const response = await window.explorer.request({
          action: 'overview',
          rowId: row.rowId,
          scope,
          limit: cursor ? 200 : 96,
          cursor,
          // R-492: each folder's files come in the order the list shows.
          ...(sort && !cursor ? { sort } : {}),
        })
        if (!active) return
        const page = response.overview
        if (!page) throw new Error(tr('無法取得檔案總覽'))
        setOverview((previous) => ({
          entries: [...previous.entries, ...page.entries],
          notices: [...new Set([...previous.notices, ...page.notices])].slice(0, 100),
          loading: !!page.nextCursor,
        }))
        cursor = page.nextCursor
        if (cursor) await new Promise((resolve) => setTimeout(resolve, 20))
      } while (active && cursor)
    })().catch((reason) => {
      if (active) {
        setOverview((previous) => ({
          ...previous,
          notices: [...previous.notices, String(reason)],
          loading: false,
        }))
      }
    })
    return () => {
      active = false
    }
  }, [scope, row.rowId, version])
  const files = useMemo(
    () =>
      scope === 'descendants'
        ? overview.entries
        : entries
            .filter((entry) => entry.kind !== 'folder')
            .map((entry) => ({
              ...entry,
              rowId: row.rowId,
              folderName: row.name,
              sourcePath: row.path,
            })),
    [scope, overview.entries, entries, row.rowId, row.name, row.path]
  )
  const visible = useMemo(() => files.filter((entry) => visibleFile(entry)), [files])
  const shown = useMemo(() => {
    const list = visible.filter((entry) => matchesMedia(entry, filter))
    return sort ? sortMedia(list, sort) : list
  }, [visible, filter, sort])
  // The viewer and the play queue follow the order the list shows (R-486).
  const ordered = useMemo(() => (sort ? sortMedia(visible, sort) : visible), [visible, sort])
  // R-488: how many files each type has (the filter chips); a type with none is left out unless it is the chosen one.
  const typeNames: Record<MediaFilter, string> = {
    all: tr('全部'),
    video: tr('影片'),
    image: tr('圖片'),
    audio: tr('音樂'),
    other: tr('其他'),
  }
  const counts = useMemo(() => {
    const out = { all: 0, video: 0, image: 0, audio: 0, other: 0 } as Record<MediaFilter, number>
    for (const entry of visible) {
      for (const type of ['all', 'video', 'image', 'audio', 'other'] as const) {
        if (matchesMedia(entry, type)) out[type]++
      }
    }
    return out
  }, [visible])
  const types = (['all', 'video', 'image', 'audio', 'other'] as const).filter(
    (type) => type === 'all' || counts[type] > 0 || type === filter
  )
  const sortNames: Record<MediaSortField, string> = {
    name: tr('名稱'),
    kind: tr('類型'),
    size: tr('大小'),
    modified: tr('修改日期'),
  }
  const current = sort ?? { field: 'name' as const, asc: true }
  const sortSummary = sortNames[current.field] + ' ' + (current.asc ? '↑' : '↓')
  const folders = entries.filter((entry) => entry.kind === 'folder')
  const pending = scope === 'descendants' ? overview.loading : loading
  const playback = usePlayback()
  // R-405: the thin line on a video's thumbnail; places live on this computer only.
  useVideoPlaces()
  const videoProgress = (entry: MediaEntry) => {
    if (entry.kind !== 'video') return undefined
    const owner = (entry as OverviewEntry).rowId
    const source = (owner && sourceRows.find((item) => item.rowId === owner)) || row
    return placeProgress(videoPlace(podcastFolder(source), entry.id))
  }
  useEffect(() => {
    playback?.source({ row, project, entries: entries.filter((entry) => entry.kind !== 'folder') })
  }, [row.rowId, entries, project])
  const open = async (entry: MediaEntry) => {
    if (!canPreviewMedia(entry) || busy || opening) return
    const sourceId = (entry as OverviewEntry).rowId ?? row.rowId
    const token = ++operation.current
    setOpening(sourceId)
    try {
      const result = await run({ action: 'visit', rowId: sourceId })
      if (!alive.current || token !== operation.current || !result?.snapshot) return
      const source = (result.snapshot.structure ?? result.snapshot.rows).find(
        (item) => item.rowId === sourceId
      )
      if (source?.record && ['audio', 'video'].includes(entry.kind) && playback) {
        await playback.open(
          { row: source, project, entries: ordered.filter((file) => file.rowId === source.rowId) },
          entry
        )
        return
      }
      if (source?.record) setSession({ file: entry, source, filter })
    } finally {
      if (alive.current && token === operation.current) setOpening('')
    }
  }
  const own = useMemo(() => entries.filter((entry) => entry.kind !== 'folder'), [entries])
  const albumData = useAlbum(row, album ? own : [])
  // The album list replaces the picture list for this folder's own tracks; other files (booklet scans, cue sheets)
  // follow under it. Looking through subfolders or at one other type shows the usual list.
  const asAlbum = album && scope === 'current' && (filter === 'all' || filter === 'audio')
  const sourceFiles = session ? ordered.filter((entry) => entry.rowId === session.source.rowId) : []
  // R-559: when "include subfolders" is active and viewing images (not a manga/book folder), browse across subfolders continuously.
  const crossSubfolderImages =
    !!session &&
    scope === 'descendants' &&
    session.file.kind === 'image' &&
    effectiveKind(session.source) !== 'book'
  const viewerFiles = session
    ? (crossSubfolderImages ? ordered : sourceFiles).filter(
        (entry) => entry.kind === 'subtitle' || matchesMedia(entry, session.filter)
      )
    : []
  return (
    <FolderPage
      page={album ? 'music' : 'media'}
      row={row}
      project={project}
      openFolder={() => void act({ action: 'open', rowId: row.rowId })}
      folders={folders}
      childNames={childNames}
      busy={busy}
      onChild={onChild}
      visual={
        <PanelCard
          project={project}
          row={row}
          kind={kind}
          content={{ entries: own, album: album ? albumData : undefined }}
          builtin={(k) =>
            builtinPanelFor(
              project,
              k,
              own.some((entry) => entry.kind === 'audio')
            )
          }
          open={() => void act({ action: 'open', rowId: row.rowId })}
        />
      }
      actions={
        album && <AlbumActions row={row} project={project} entries={own} album={albumData} />
      }
      controls={
        <div className="mixed-media-toolbar">
          <div className="media-toolbar-filters">
            <div className="media-type-chips" role="group" aria-label={tr('檔案類型')}>
              {types.map((type) => (
                <button
                  key={type}
                  type="button"
                  className={'media-type-chip' + (filter === type ? ' active' : '')}
                  aria-pressed={filter === type}
                  onClick={() => setFilter(type)}
                >
                  {typeNames[type]} <span>{counts[type]}</span>
                </button>
              ))}
            </div>
            <Select
              className="media-type-select"
              aria-label={tr('檔案類型')}
              size="xs"
              allowDeselect={false}
              value={filter}
              onChange={(value) => value && setFilter(value as MediaFilter)}
              data={types.map((type) => ({
                value: type,
                label: typeNames[type] + ' ' + counts[type],
              }))}
            />
            {scope === 'descendants' && (
              <button
                type="button"
                className="media-scope-pill"
                disabled={busy || !!opening}
                aria-label={tr('取消包含子資料夾')}
                onClick={() => setScope('current')}
              >
                <span>{tr('含子資料夾')}</span>
                <Icon name="close" size={11} />
              </button>
            )}
          </div>
          <div className="media-toolbar-controls">
            <Menu position="bottom-end">
              <Menu.Target>
                <Button
                  size="xs"
                  variant="default"
                  className="media-sort-button"
                  aria-label={tr('排序：{0}', sortSummary)}
                  leftSection={<Icon name="sort" size={14} />}
                >
                  <span className="media-sort-summary">{sortSummary}</span>
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{tr('排序依據')}</Menu.Label>
                {mediaSortFields.map((field) => (
                  <Menu.Item
                    key={field}
                    leftSection={current.field === field ? <Icon name="check" /> : null}
                    onClick={() => setSort({ field, asc: current.asc })}
                  >
                    {sortNames[field]}
                  </Menu.Item>
                ))}
                <Menu.Divider />
                {([true, false] as const).map((asc) => (
                  <Menu.Item
                    key={String(asc)}
                    leftSection={current.asc === asc ? <Icon name="check" /> : null}
                    onClick={() => setSort({ field: current.field, asc })}
                  >
                    {asc ? tr('由小到大（↑）') : tr('由大到小（↓）')}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
            <div className="media-toolbar-view-group">
              <SegmentedControl
                className="media-view-select"
                aria-label={tr('檔案展示方式')}
                size="xs"
                value={view}
                onChange={setView}
                data={(
                  [
                    ['masonry', 'masonry', '瀑布流'],
                    ['tiles', 'grid', '縮圖'],
                    ['list', 'list', '列表'],
                  ] as const
                ).map(([value, icon, label]) => ({ value, label: iconLabel(icon, tr(label)) }))}
              />
              <Popover position="bottom-end" shadow="md" width={220}>
                <Popover.Target>
                  <Tooltip label={tr('檢視選項')}>
                    <ActionIcon
                      size={28}
                      variant={scope === 'descendants' ? 'light' : 'default'}
                      color={scope === 'descendants' ? undefined : 'gray'}
                      className={
                        'media-options-button' + (scope === 'descendants' ? ' active' : '')
                      }
                      aria-label={tr('檢視選項')}
                    >
                      <Icon name="sliders" size={14} />
                      {scope === 'descendants' && (
                        <span className="media-options-dot" aria-hidden="true" />
                      )}
                    </ActionIcon>
                  </Tooltip>
                </Popover.Target>
                <Popover.Dropdown>
                  <Stack gap="xs">
                    <Switch
                      size="xs"
                      label={tr('包含子資料夾')}
                      checked={scope === 'descendants'}
                      disabled={busy || !!opening}
                      onChange={(event) =>
                        setScope(event.currentTarget.checked ? 'descendants' : 'current')
                      }
                    />
                    <Switch
                      size="xs"
                      label={tr('依來源分組')}
                      aria-label={tr('依來源分組')}
                      description={
                        scope !== 'descendants' ? tr('開啟「包含子資料夾」後可用') : undefined
                      }
                      checked={grouped && scope === 'descendants'}
                      disabled={scope !== 'descendants'}
                      onChange={(event) => setGrouped(event.currentTarget.checked)}
                    />
                  </Stack>
                </Popover.Dropdown>
              </Popover>
            </div>
          </div>
        </div>
      }
      notice={
        <>
          {(error || overview.notices.length > 0) && (
            <p role="alert">
              {[error, ...(scope === 'descendants' ? overview.notices : [])]
                .filter(Boolean)
                .join('\n')}
            </p>
          )}
          {!!opening && <small role="status">{tr('載入內容…')}</small>}
        </>
      }
      list={
        <>
          {asAlbum && <AlbumTracks row={row} project={project} entries={own} album={albumData} />}
          {(!asAlbum || shown.some((entry) => entry.kind !== 'audio')) && (
            <Gallery
              key={scope + '/' + filter + '/' + view}
              entries={asAlbum ? shown.filter((entry) => entry.kind !== 'audio') : shown}
              mixed
              manga={false}
              presentation={view}
              suspended={!!session}
              loading={pending}
              groupBySource={grouped && scope === 'descendants'}
              sourceRoot={row.path}
              onSource={(id) => {
                if (
                  !busy &&
                  sourceRows.some(
                    (source) =>
                      source.rowId === id &&
                      source.record &&
                      !source.readonly &&
                      !source.error &&
                      !source.stopped
                  )
                ) {
                  onSource(id)
                }
              }}
              onReader={() => {}}
              save={() => {}}
              onOpen={(entry) => void open(entry)}
              progress={videoProgress}
              onOpenFolder={(entry) =>
                void act({ action: 'open', rowId: (entry as OverviewEntry).rowId ?? row.rowId })
              }
              onEnqueue={
                playback
                  ? (files) => {
                      for (const source of sourceRows) {
                        const group = files.filter(
                          (file) => ((file as OverviewEntry).rowId ?? row.rowId) === source.rowId
                        )
                        if (group.length) {
                          playback.add(
                            {
                              row: source,
                              project,
                              entries: ordered.filter((file) => file.rowId === source.rowId),
                            },
                            group
                          )
                        }
                      }
                    }
                  : undefined
              }
            />
          )}
        </>
      }
      overlay={
        session && (
          <MediaViewer
            row={session.source}
            project={project}
            file={session.file}
            entries={viewerFiles}
            coverEntries={sourceFiles}
            loading={pending}
            run={run}
            act={act}
            busy={busy}
            close={() => setSession(undefined)}
          />
        )
      }
    />
  )
}
