import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Menu, SegmentedControl, Select, Switch, Tooltip } from '@mantine/core'
import type {
  ContentResult,
  ExplorerRequest,
  ExplorerResponse,
  MediaPrefs,
  MediaEntry,
  OverviewEntry,
} from '../../shared/explorer'
import type { FolderRow, Project, Request, Response } from '../../shared/model'
import { builtinPanelFor } from '../../shared/explorer'
import {
  canPreviewMedia,
  matchesMedia,
  mediaSortFields,
  sortMedia,
  visibleFile,
  type MediaFilter,
  type MediaSort,
  type MediaSortField,
} from '../../shared/media'
import { Gallery } from '../gallery/Gallery'
import { MediaViewer } from './MediaViewer'
import { AlbumActions, AlbumTracks, useAlbum } from './AlbumView'
import { PanelCard } from '../cells/PanelContent'
import type { FolderKind } from '../../shared/kind'
import { usePlayback } from './Playback'
import { podcastFolder } from './podcast'
import { placeProgress, useVideoPlaces, videoPlace } from './videoPlace'
import { FolderPage } from '../panel/FolderPage'
import { useRefreshNonce } from '../browse/refresh'
import { Icon } from '../common/icons'
import { iconLabel } from '../common/IconLabel'
import { t as tr, useLocale } from '../i18n'
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
  const [filter, setFilter] = useState<MediaFilter>(prefs?.filter ?? 'all'),
    [view, setView] = useState<string>(prefs?.view ?? 'masonry')
  const [scope, setScope] = useState<'current' | 'descendants'>(prefs?.scope ?? 'current'),
    [grouped, setGrouped] = useState(prefs?.grouped ?? false),
    // R-486: undefined keeps the order the files are listed in (shown as name, ascending).
    [sort, setSort] = useState<MediaSort | undefined>(prefs?.sort)
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
    }>(),
    [opening, setOpening] = useState('')
  const alive = useRef(true),
    operation = useRef(0)
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
      if (active)
        setOverview((previous) => ({
          ...previous,
          notices: [...previous.notices, String(reason)],
          loading: false,
        }))
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
    for (const entry of visible)
      for (const type of ['all', 'video', 'image', 'audio', 'other'] as const)
        if (matchesMedia(entry, type)) out[type]++
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
  const current = sort ?? { field: 'name' as const, asc: true },
    sortSummary = sortNames[current.field] + ' ' + (current.asc ? '↑' : '↓')
  const folders = entries.filter((entry) => entry.kind === 'folder'),
    pending = scope === 'descendants' ? overview.loading : loading
  const playback = usePlayback()
  // R-405: the thin line on a video's thumbnail; places live on this computer only.
  useVideoPlaces()
  const videoProgress = (entry: MediaEntry) => {
    if (entry.kind !== 'video') return undefined
    const owner = (entry as OverviewEntry).rowId,
      source = (owner && sourceRows.find((item) => item.rowId === owner)) || row
    return placeProgress(videoPlace(podcastFolder(source), entry.id))
  }
  useEffect(() => {
    playback?.source({ row, project, entries: entries.filter((entry) => entry.kind !== 'folder') })
  }, [row.rowId, entries, project])
  const open = async (entry: MediaEntry) => {
    if (!canPreviewMedia(entry) || busy || opening) return
    const sourceId = (entry as OverviewEntry).rowId ?? row.rowId,
      token = ++operation.current
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
  const viewerFiles = session
    ? sourceFiles.filter(
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
          <Switch
            className="media-scope-switch"
            size="xs"
            label={tr('包含子資料夾')}
            checked={scope === 'descendants'}
            disabled={busy || !!opening}
            onChange={(event) => setScope(event.currentTarget.checked ? 'descendants' : 'current')}
          />
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
          <Menu position="bottom-end">
            <Menu.Target>
              <Button
                size="xs"
                variant="default"
                className="media-sort-button"
                aria-label={tr('排序：{0}', sortSummary)}
                leftSection={<Icon name="sort" size={15} />}
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
          <Tooltip
            label={
              scope === 'descendants' ? tr('依來源分組') : tr('依來源分組（要先包含子資料夾）')
            }
            withArrow
          >
            <Button
              size="xs"
              variant={grouped ? 'light' : 'default'}
              className="media-group-button"
              aria-label={tr('依來源分組')}
              aria-pressed={grouped}
              disabled={scope !== 'descendants'}
              onClick={() => setGrouped((value) => !value)}
            >
              <Icon name="folder" size={15} />
            </Button>
          </Tooltip>
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
              groupBySource={grouped}
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
                )
                  onSource(id)
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
                        if (group.length)
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
