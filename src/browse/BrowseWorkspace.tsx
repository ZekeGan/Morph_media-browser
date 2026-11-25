import '../media/media-workspace.css'
import { isGameFolder } from '../../shared/media'
import { playValue, usePlaytimes } from '../game/playtime'
import { FileOverview } from '../files/FileOverview'
import type { OverviewEntry } from '../../shared/explorer'
import type { FolderNavigation } from '../../shared/workspace'
import { t as tr, useLocale, currentLocale } from '../i18n'
import { layoutName } from '../editor/layoutName'
import { Icon } from '../common/icons'
import { BrowseToolbar } from './BrowseToolbar'
import { BrowsePanel } from './BrowsePanel'
import {
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { ActionIcon, Pagination, Tooltip } from '@mantine/core'
import { BrowseNav } from './BrowseNav'
import { isLayoutWork, KindRowsContext, LayoutWorksContext } from './folderKind'
import { FolderCards } from './FolderCards'
import { Card } from '../cells/Card'
import { useCardSettings } from './useCardSettings'
import { useWidthDrag } from './useWidthDrag'
import { useFolderMarks } from './useFolderMarks'
import { useWarmThumbnails } from './useWarmThumbnails'
import { useTableColumns } from './useTableColumns'
import { FolderTable } from './FolderTable'
import { KindBatchBar } from './KindBatchBar'
import { cardChoice, cardPresets } from '../../shared/layouts'
import { LayoutConfig } from './LayoutConfig'
import {
  browserRows,
  columnValue,
  folderBreadcrumbs,
  isWork,
  maxBrowseDepth,
  pathKey,
  sortRows,
  treeStructure,
  type SortKey,
} from '../../shared/browse'
import type { FolderRow, Project, Request, Response } from '../../shared/model'
import type {
  BrowseMode,
  BrowseState,
  ExplorerRequest,
  ExplorerResponse,
  ReadingPrefs,
} from '../../shared/explorer'
const FolderPanel = lazy(() =>
  import('../panel/FolderPanel').then((m) => ({ default: m.FolderPanel }))
)
const Tree = lazy(() => import('./TreeView'))
const initial: BrowseState = {
  mode: 'CARD',
  location: '',
  widths: { name: 200, path: 320, depth: 90 },
  panelWidth: 420,
  panelVisible: true,
}
type Act = (r: Request) => Promise<Response | undefined>
type Run = (r: ExplorerRequest) => Promise<ExplorerResponse | undefined>
interface Props {
  toolbarTarget: HTMLDivElement | null
  project: Project
  root: string
  rows: FolderRow[]
  sharedFolders: Set<string>
  structure: FolderRow[]
  busy: boolean
  selected?: string
  onSelect: (id: string) => boolean
  onClose: () => void
  act: Act
  run: Run
  onDirty: (v: boolean) => void
  // `rowId`: the folder the editor is opened for (its preview, R-460).
  edit: (category?: string, preset?: string, rowId?: string) => void
  notify: (message: string) => void
  onOverlay: (v: boolean) => void
  // R-459: coming back from the layout editor: stay where the browser was, keeping the selected folder selected
  // without going into it.
  resume?: boolean
  onResumed?: () => void
}
// R-404: lets a folder's icon, badge and panel find the folder above it by path.
export function BrowseWorkspace(props: Props) {
  const all = props.structure.length ? props.structure : props.rows,
    kindRows = useMemo(() => new Map(all.map((r) => [pathKey(r.path), r])), [all]),
    works = useMemo(() => {
      const { children } = treeStructure(all)
      return new Map(all.map((r) => [r.rowId, isWork(r, children)]))
    }, [all])
  return (
    <KindRowsContext.Provider value={kindRows}>
      <LayoutWorksContext.Provider value={works}>
        <BrowseWorkspaceBody {...props} />
      </LayoutWorksContext.Provider>
    </KindRowsContext.Provider>
  )
}
function BrowseWorkspaceBody({
  toolbarTarget,
  project,
  root,
  rows,
  sharedFolders,
  structure,
  busy,
  selected,
  onSelect,
  act,
  run,
  onDirty,
  edit,
  notify,
  onOverlay,
  resume,
  onResumed,
}: Props) {
  const locale = useLocale()
  const works = useContext(LayoutWorksContext),
    [layoutsOpen, setLayoutsOpen] = useState(false),
    // R-409: the layout window opened from a folder's settings starts at that folder, on cards or the right panel.
    [layoutsFrom, setLayoutsFrom] = useState<{ row: FolderRow; target: 'card' | 'panel' }>()

  const [browse, setBrowse] = useState(initial),
    [readNext, setReadNext] = useState<{
      id: string
      immersive: boolean
      settings?: ReadingPrefs
    }>(),
    [ready, setReady] = useState(false),
    [page, setPage] = useState(1)
  const [highlight, setHighlight] = useState<string>(),
    [configId, setConfigId] = useState<string>(),
    [configDirty, setConfigDirty] = useState(false),
    [expanded, setExpanded] = useState(false)
  const [filePreview, setFilePreview] = useState<OverviewEntry>()
  // Read at the time of a gesture; everything here is defined further down.
  const { marked, setMarked, gestures, cancelClear } = useFolderMarks(() => ({
    current,
    highlight,
    setHighlight,
    open: (id) => void open(id),
    openConfig,
    clearSelection,
  }))
  const panelSlot = useRef<HTMLDivElement>(null),
    panelToggle = useRef<HTMLButtonElement>(null)
  const panelBody = useRef<HTMLDivElement>(null),
    [canReturnTop, setCanReturnTop] = useState(false)
  const navigation = useRef(0),
    mounted = useRef(false)
  const workspaceRoot = useRef<HTMLDivElement>(null),
    sideNavigation = useRef<(event: FolderNavigation) => void>(() => {})
  useEffect(() => window.desktop.onFolderNavigation((event) => sideNavigation.current(event)), [])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      navigation.current++
    }
  }, [])
  const [overviewScope, setOverviewScope] = useState<HTMLDivElement | null>(null),
    [overviewTools, setOverviewTools] = useState<HTMLDivElement | null>(null),
    [columnQuery, setColumnQuery] = useState(''),
    [configTab, setConfigTab] = useState('fields')
  const histories = useRef<Partial<Record<BrowseMode, { items: string[]; index: number }>>>({}),
    [, renderHistory] = useState(0)
  const scroll = useRef<HTMLDivElement>(null),
    state = useRef(browse),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // The dragged width is kept in the browse state and saved once the drag ends.
  const { resize, moveWidth, stopWidth } = useWidthDrag((id, width) =>
    persist(
      id === 'panel'
        ? { ...state.current, panelWidth: width }
        : { ...state.current, widths: { ...state.current.widths, [id]: width } }
    )
  )
  const all = structure.length ? structure : rows,
    rootRow = all.find((r) => pathKey(r.path) === pathKey(root)),
    detail = all.find((r) => r.rowId === selected),
    config = all.find((r) => r.rowId === configId),
    deepest = maxBrowseDepth(all)
  const { display, setDisplay, density, setDensity, liveList, cardSaveError, changedCard } =
    useCardSettings({ project, deepest, busy, act, mounted })
  const card = display
  state.current = browse
  useEffect(() => {
    let alive = true
    window.desktop
      .workspace()
      .then((r) => {
        if (!alive) return
        const saved = r.prefs.browse?.[project.projectId] ?? initial,
          target = all.find((r) => r.rowId === (selected ?? saved.detailId)) ?? rootRow,
          next = {
            ...saved,
            location:
              !resume && target && pathKey(target.path) !== pathKey(root)
                ? target.path
                : saved.location || '',
            locations: undefined,
            detailId: target?.rowId,
            panelVisible: saved.panelVisible ?? true,
          }
        setBrowse(next)
        state.current = next
        const history = { items: [next.location], index: 0 }
        histories.current = { CARD: history, TABLE: history, TREE: history }
        setHighlight(target?.rowId)
        setReady(true)
        if (target?.record) onSelect(target.rowId)
        if (resume) onResumed?.()
      })
      .catch((e) => {
        notify(String(e))
        setReady(true)
      })
    return () => {
      alive = false
      clearTimeout(timer.current)
    }
  }, [project.projectId])
  const persist = (next: BrowseState) => {
    state.current = next
    setBrowse(next)
    if (ready)
      void window.desktop
        .updateWorkspace({ action: 'browse', projectId: project.projectId, value: next })
        .catch((e) => notify(String(e)))
  }
  const reportDirty = useCallback(
    (value: boolean) => {
      setConfigDirty(value)
      onDirty(value)
    },
    [onDirty]
  )
  useEffect(() => {
    onOverlay(!!configId)
    return () => onOverlay(false)
  }, [configId, onOverlay])
  useEffect(() => {
    setPage(1)
  }, [browse.location, browse.mode, project.cardView, project.list.pageSize])
  useEffect(() => {
    if (ready) scroll.current?.scrollTo(0, browse.scrolls?.[browse.mode] ?? 0)
  }, [browse.mode, ready])
  useEffect(() => {
    if (ready && selected && selected !== state.current.detailId && !busy) void open(selected)
  }, [selected, ready, busy])
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !document.querySelector('.reader,.mantine-Drawer-content,.mantine-Modal-content') &&
        expanded
      ) {
        e.preventDefault()
        setExpanded(false)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [expanded])
  const location =
    browse.location && all.some((r) => pathKey(r.path) === pathKey(browse.location))
      ? browse.location
      : ''
  const currentFolder = all.find((r) => pathKey(r.path) === pathKey(location || root))
  // Entering another folder replaces the list at once; a short fade keeps the swap from flashing.
  const shownLocation = useRef(location)
  useEffect(() => {
    if (shownLocation.current === location) return
    shownLocation.current = location
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches)
      scroll.current?.animate([{ opacity: 0.35 }, { opacity: 1 }], {
        duration: 140,
        easing: 'ease-out',
      })
  }, [location])
  const base = useMemo(
    () =>
      browserRows(
        all,
        { ...project, cardView: display, list: liveList },
        root,
        browse.mode,
        location
      ),
    [all, project, root, browse.mode, location, display, density]
  )
  const plays = usePlaytimes()
  // R-466: TREE nodes as cards, when chosen.
  const treeCards = useMemo(
    () =>
      browse.treeCards
        ? {
            project,
            isWork: (rowId: string) => isLayoutWork(works, rowId),
            card: (row: FolderRow, open: () => void) => (
              <Card project={project} row={row} open={open} />
            ),
          }
        : undefined,
    [browse.treeCards, project, works]
  )
  const valueOf = (row: FolderRow, id: string) =>
    id.startsWith('@') ? playValue(row, id, plays) : columnValue(project, row, id)
  // R-467: the sort keys and folders first are this project's saved browse choices (cards and table share them).
  const sortKeys = useMemo(() => browse.sortKeys ?? [], [browse.sortKeys]),
    foldersFirst = browse.foldersFirst !== false
  const setSort = (keys: SortKey[]) => {
    persist({ ...state.current, sortKeys: keys })
    setPage(1)
  }
  const filtered = useMemo(
    () =>
      sortRows(
        base,
        sortKeys,
        currentLocale(),
        valueOf,
        foldersFirst ? (row) => !isLayoutWork(works, row.rowId) : undefined
      ),
    [base, sortKeys, foldersFirst, works, locale, project.cells, plays]
  )
  const pageSize = browse.mode === 'CARD' ? liveList.pageSize : 100,
    pages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    current = filtered.slice(
      (Math.min(page, pages) - 1) * pageSize,
      Math.min(page, pages) * pageSize
    )
  // R-505: the listed folders' pictures get their thumbnails while the window is idle.
  useWarmThumbnails(
    ready && !busy
      ? current.filter((r) => r.record && !r.readonly && !r.error).map((r) => r.rowId)
      : []
  )
  useEffect(() => {
    if (browse.mode !== 'CARD' || !ready || card.mode !== 'multi' || !selected) return
    const index = filtered.findIndex((r) => r.rowId === selected)
    if (index < 0) return
    setPage(Math.floor(index / pageSize) + 1)
    const frame = requestAnimationFrame(() =>
      scroll.current
        ?.querySelector<HTMLElement>('[data-row-id="' + selected + '"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    )
    return () => cancelAnimationFrame(frame)
  }, [browse.mode, browse.location, ready, selected, filtered, pageSize, card.mode])
  const history = histories.current[browse.mode] ?? { items: [location], index: 0 }
  const moveTo = (target: string) => {
    const mode = state.current.mode,
      h = histories.current[mode] ?? { items: [state.current.location], index: 0 }
    if (pathKey(target || root) !== pathKey(state.current.location || root)) {
      const items = [...h.items.slice(0, h.index + 1), target].slice(-100)
      const next = { items, index: items.length - 1 }
      histories.current = { CARD: next, TABLE: next, TREE: next }
      renderHistory((v) => v + 1)
    }
    persist({
      ...state.current,
      location: target,
      locations: undefined,
    })
  }
  // Entering a folder: the center moves there and the panel follows. Whether the panel is open stays the user's call.
  const open = async (id: string, fromHistory?: number, via?: string) => {
    // Entering wins over a pending "clear the selection" from a click on the selected folder.
    cancelClear()
    // A single click already started showing this folder in the panel; let that finish instead of dropping the double click.
    const pending = previewing.current
    if (pending) await pending
    const row = all.find((r) => r.rowId === id)
    if (!row || (busy && !pending) || draftBlocks(id, true)) return
    const operation = ++navigation.current
    const result = await run({ action: 'visit', rowId: id })
    if (!mounted.current || operation !== navigation.current || !result?.snapshot || !onSelect(id))
      return
    setFilePreview(undefined)
    setHighlight(id)
    persist({
      ...state.current,
      detailId: id,
    })
    {
      if (fromHistory !== undefined) {
        const next = { ...history, index: fromHistory }
        histories.current = { CARD: next, TABLE: next, TREE: next }
        renderHistory((v) => v + 1)
        persist({
          ...state.current,
          location: row.path,
          locations: undefined,
        })
      } else {
        // Entering from the panel's subfolder list: the previewed folder goes into the history first, so Back returns to it.
        if (via) moveTo(via)
        moveTo(row.path)
      }
    }
  }
  // A single click shows that folder in the right panel at once, without entering it: the center stays where it is.
  const previewing = useRef<Promise<void> | undefined>(undefined)
  // R-255: the folder after the shown one in the current list and order, if it can be read.
  const detailAt = detail ? filtered.findIndex((row) => row.rowId === detail.rowId) : -1,
    following = detailAt >= 0 ? filtered[detailAt + 1] : undefined,
    nextBook =
      following?.record && !following.error && !following.stopped && !following.readonly
        ? following
        : undefined
  // The folder to open straight into reading is only good for the switch it was asked for.
  useEffect(() => setReadNext(undefined), [detail?.rowId])
  // Returns false when the switch was not started (nothing to wait for).
  const previewDetail = (id: string) => {
    const target = all.find((r) => r.rowId === id)
    if (!ready || !target || id === state.current.detailId) return false
    // A folder that can be visited as-is is shown at once; the visit (which refreshes its record) runs behind it.
    // Anything that might be refused (no record, protected, broken) still waits for the answer.
    const healthy = !!target.record && !target.error && !target.stopped && !target.readonly
    if (!healthy && busy) return false
    if (draftBlocks(id, false)) return false
    const operation = ++navigation.current
    const task = (async () => {
      if (healthy) {
        const previous = state.current.detailId
        if (!onSelect(id)) return
        setFilePreview(undefined)
        persist({ ...state.current, detailId: id })
        // Another request in flight means the visit is skipped (not refused), so only an idle refusal is undone.
        const idle = !busy
        const result = await run({ action: 'visit', rowId: id })
        if (
          idle &&
          !result?.snapshot &&
          mounted.current &&
          operation === navigation.current &&
          previous &&
          state.current.detailId === id
        ) {
          // The visit was refused (for example the record is gone on disk): go back to what was shown.
          onSelect(previous)
          persist({ ...state.current, detailId: previous })
        }
        return
      }
      const result = await run({ action: 'visit', rowId: id })
      if (
        !mounted.current ||
        operation !== navigation.current ||
        !result?.snapshot ||
        !onSelect(id)
      )
        return
      setFilePreview(undefined)
      persist({ ...state.current, detailId: id })
    })()
    previewing.current = task
    void task.finally(() => {
      if (previewing.current === task) previewing.current = undefined
    })
    return true
  }
  // The panel always shows what is selected; when it is hidden nothing loads until it is opened.
  useEffect(() => {
    if (highlight && browse.panelVisible !== false) previewDetail(highlight)
  }, [highlight, browse.panelVisible])
  // Unsaved folder settings are never dropped silently: switching waits for an answer shown in the panel.
  const [switching, setSwitching] = useState<{ id: string; enter: boolean }>()
  const draftBlocks = (id: string, enter: boolean) => {
    if (discardOnce.current) {
      discardOnce.current = false
      return false
    }
    if (!configDirty || !configId || id === configId) return false
    setSwitching({ id, enter })
    return true
  }
  useEffect(() => {
    if (!configDirty) setSwitching(undefined)
  }, [configDirty])
  const discardOnce = useRef(false)
  const switchDiscard = () => {
    const target = switching
    if (!target) return
    setSwitching(undefined)
    discardOnce.current = true
    setConfigDirty(false)
    onDirty(false)
    if (target.enter) void open(target.id)
    else previewDetail(target.id)
  }
  const switchStay = () => {
    setSwitching(undefined)
    if (configId) setHighlight(configId)
  }
  // With nothing selected the panel shows the folder the path bar is on.
  const clearSelection = () => {
    setHighlight(undefined)
    if (currentFolder && currentFolder.rowId !== state.current.detailId)
      previewDetail(currentFolder.rowId)
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || expanded || !(highlight || marked.length)) return
      // Closed selects keep an invisible dropdown in the page, so only visible overlays count.
      const overlayOpen = Array.from(
        document.querySelectorAll(
          '.reader,.mantine-Drawer-content,.mantine-Modal-content,[role="dialog"],.mantine-Menu-dropdown,.mantine-Popover-dropdown'
        )
      ).some(
        (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden'
      )
      if (
        overlayOpen ||
        (e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')
      )
        return
      e.preventDefault()
      if (marked.length) setMarked([])
      else clearSelection()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  const previewFile = async (entry: OverviewEntry) => {
    if (busy) return
    const operation = ++navigation.current,
      result = await run({ action: 'visit', rowId: entry.rowId })
    if (
      !mounted.current ||
      operation !== navigation.current ||
      !result?.snapshot ||
      !onSelect(entry.rowId)
    )
      return
    setFilePreview(entry)
    persist({ ...state.current, detailId: entry.rowId, panelVisible: true })
  }
  const navHistory = (delta: number) => {
    if (
      !ready ||
      busy ||
      Array.from(
        document.querySelectorAll(
          '.reader,.media-viewer-shell,.document-viewer,.mantine-Drawer-content,.mantine-Modal-content,.mantine-Menu-dropdown,.mantine-Select-dropdown,[role="dialog"]'
        )
      ).some(
        (node) => node.getClientRects().length > 0 && getComputedStyle(node).visibility !== 'hidden'
      )
    )
      return
    const i = history.index + delta
    if (i < 0 || i >= history.items.length) return
    const target = all.find((r) => pathKey(r.path) === pathKey(history.items[i] || root))
    if (target) void open(target.rowId, i)
  }
  sideNavigation.current = (event) => {
    if (
      !Number.isFinite(event.x) ||
      !Number.isFinite(event.y) ||
      (event.delta !== -1 && event.delta !== 1)
    )
      return
    const target = document.elementFromPoint(event.x, event.y)
    if (target && workspaceRoot.current?.contains(target)) navHistory(event.delta)
  }
  const openConfig = (id: string, tab = 'fields') => {
    if (configDirty && id !== configId && !window.confirm(tr('放棄尚未保存的資料夾設定？'))) return
    setHighlight(id)
    setConfigTab(tab)
    setConfigId(id)
    if (state.current.panelVisible === false) persist({ ...state.current, panelVisible: true })
  }
  const closeConfig = () => {
    if (!configDirty || window.confirm(tr('放棄尚未保存的資料夾設定？'))) setConfigId(undefined)
  }
  // The settings tab belongs to the folder shown in the panel: follow it when another folder is opened.
  useEffect(() => {
    if (!configId || !detail || detail.rowId === configId || configDirty) return
    setConfigId(detail.rowId)
  }, [detail?.rowId])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.altKey &&
        event.key === 'Enter' &&
        !event.isComposing &&
        !event.repeat &&
        currentFolder &&
        !busy &&
        !document.querySelector('.reader,.mantine-Drawer-content,.mantine-Modal-content') &&
        !(event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')
      ) {
        event.preventDefault()
        openConfig(currentFolder.rowId)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [currentFolder?.rowId, busy, configDirty])
  const child = (name: string) => {
    if (!detail) return
    const next = all.find((r) => pathKey(r.path) === pathKey(detail.path + '/' + name))
    if (next) void open(next.rowId, undefined, detail.path)
    else
      notify(
        detail.boundary
          ? tr('這是遊戲裡面的資料夾，受保護，不能加資訊')
          : tr('此資料夾尚未建立資料，請先明確重新掃描')
      )
  }
  const {
    orderedColumns,
    columns,
    dragColumn,
    setDragColumn,
    draggingColumn,
    columnDrop,
    setColumnDrop,
    droppedColumn,
    reorderColumn,
    endColumnDrag,
  } = useTableColumns({
    project,
    browse,
    busy,
    saveOrder: (columnOrder) => persist({ ...state.current, columnOrder }),
    games: all.some(isGameFolder),
    books: all.some((row) => !!row.record?.details?.novels),
  })
  const crumbs = folderBreadcrumbs(all, root, currentFolder?.path ?? root)
  const overviewRoot = currentFolder ?? rootRow
  const folderMode = browse.contentMode !== 'files'
  const panelOpen = !!detail && browse.panelVisible !== false
  const settingsBody = config && (
    <Suspense fallback={<p>{tr('載入設定…')}</p>}>
      <FolderPanel
        key={config.rowId}
        initialTab={configTab}
        row={config}
        shared={!!config.record && sharedFolders.has(config.record.folderId)}
        project={project}
        busy={busy}
        act={act}
        run={run}
        onDirty={reportDirty}
        // R-460: the card layout this folder shows, with its data in the preview.
        onEditLayout={() =>
          config
            ? edit(
                undefined,
                cardChoice(project, config, isLayoutWork(works, config.rowId)).id,
                config.rowId
              )
            : edit()
        }
        onLayoutConfig={(target) => {
          setLayoutsFrom({ row: config, target })
          setLayoutsOpen(true)
        }}
      />
    </Suspense>
  )
  useEffect(() => {
    const body = panelBody.current
    setCanReturnTop(false)
    if (!body || !panelOpen) return
    const update = () => setCanReturnTop(body.scrollTop > 0)
    const resize = new ResizeObserver(update),
      mutation = new MutationObserver(update)
    resize.observe(body)
    mutation.observe(body, { childList: true, subtree: true, attributes: true })
    body.addEventListener('scroll', update, { passive: true })
    update()
    return () => {
      resize.disconnect()
      mutation.disconnect()
      body.removeEventListener('scroll', update)
    }
  }, [panelOpen, detail?.rowId, filePreview?.id])
  useLayoutEffect(() => {
    const slot = panelSlot.current
    if (!slot) return
    if (!panelOpen && slot.contains(document.activeElement)) panelToggle.current?.focus()
    slot.inert = !panelOpen
  }, [panelOpen])
  // R-379: the panel a project opens with is simply there. The workspace is built anew for each project and its
  // saved folder arrives a moment later, so the panel used to slide shut and open again on every project change.
  // Only opening or closing it afterwards slides.
  useLayoutEffect(() => {
    if (panelSlot.current) panelSlot.current.dataset.instant = 'true'
  }, [])
  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => delete panelSlot.current?.dataset.instant, 600)
    return () => clearTimeout(timer)
  }, [ready])
  // R-413: the button shows the layout the folder being browsed uses; it opens the layout configuration window.
  const layoutLabel = (() => {
    const presets = cardPresets(project),
      id = currentFolder
        ? cardChoice(project, currentFolder, isLayoutWork(works, currentFolder.rowId)).id
        : (project.activeLayoutId ?? presets[0].id),
      preset = presets.find((p) => p.id === id) ?? presets[0]
    return layoutName(preset)
  })()
  const switchMode = async (mode: BrowseMode) => {
    if (busy || !ready) return
    if (highlight && highlight !== state.current.detailId) {
      const row = all.find((r) => r.rowId === highlight),
        result = await run({ action: 'visit', rowId: highlight })
      if (!row || !result?.snapshot || !onSelect(highlight)) return
      moveTo(row.path)
      persist({ ...state.current, detailId: highlight })
    }
    persist({ ...state.current, mode, locations: undefined })
    renderHistory((v) => v + 1)
  }
  const showPanelFor = (id: string) => {
    setHighlight(id)
    persist({ ...state.current, panelVisible: true })
  }
  // The files view lists what is under the folder shown in the path bar. Switching to it from a selected folder
  // goes there first, so both views always describe the same place.
  const switchContent = async (value: 'folders' | 'files') => {
    setFilePreview(undefined)
    if (value === 'files' && highlight && highlight !== currentFolder?.rowId) await open(highlight)
    persist({
      ...state.current,
      contentMode: value,
      filePresentation: state.current.filePresentation ?? 'tiles',
      fileScope: state.current.fileScope ?? 'descendants',
    })
  }
  // The panel's code is fetched while the app is idle (and when the pointer reaches its button), so the first
  // opening does not wait for it.
  const preloadPanel = () => {
    void import('../panel/FolderContent')
    void import('../panel/FolderPanel')
  }
  useEffect(() => {
    const timer = window.setTimeout(preloadPanel, 1200)
    return () => window.clearTimeout(timer)
  }, [])
  const togglePanel = () => {
    if (panelSlot.current?.contains(document.activeElement)) panelToggle.current?.focus()
    setExpanded(false)
    persist({ ...state.current, panelVisible: state.current.panelVisible === false })
  }
  return (
    <div
      ref={workspaceRoot}
      className={'project-workspace' + (expanded ? ' content-expanded' : '')}
    >
      {toolbarTarget &&
        createPortal(
          <Tooltip label={browse.panelVisible === false ? tr('顯示詳情內容') : tr('隱藏詳情內容')}>
            <ActionIcon
              ref={panelToggle}
              variant="subtle"
              color="gray"
              aria-label={tr('切換詳情內容')}
              onMouseEnter={preloadPanel}
              aria-pressed={browse.panelVisible !== false}
              disabled={!ready}
              onClick={togglePanel}
            >
              <Icon name="panel-right" size={20} />
            </ActionIcon>
          </Tooltip>,
          toolbarTarget
        )}
      <LayoutConfig
        opened={layoutsOpen}
        close={() => {
          setLayoutsOpen(false)
          setLayoutsFrom(undefined)
        }}
        project={project}
        rows={all}
        start={layoutsFrom?.row ?? currentFolder}
        initialTarget={layoutsFrom?.target}
        editPanel={(kind, preset, rowId) => edit(kind, preset, rowId)}
        editCard={(preset, rowId) => edit(undefined, preset, rowId)}
        busy={busy}
        save={async (next) => !!(await act({ action: 'saveProject', project: next }))}
      />
      <section className="center-pane" aria-label={tr('資料夾瀏覽區')}>
        <BrowseToolbar
          browse={browse}
          busy={busy}
          cardSaveError={cardSaveError}
          changedCard={changedCard}
          columnQuery={columnQuery}
          currentFolder={currentFolder}
          deepest={deepest}
          density={density}
          display={display}
          folderMode={folderMode}
          switchContent={switchContent}
          openConfig={openConfig}
          orderedColumns={orderedColumns}
          persist={persist}
          layoutLabel={layoutLabel}
          openLayouts={() => setLayoutsOpen(true)}
          project={project}
          ready={ready}
          setColumnQuery={setColumnQuery}
          setDensity={setDensity}
          setDisplay={setDisplay}
          setOverviewTools={setOverviewTools}
          setPage={setPage}
          setOverviewScope={setOverviewScope}
          state={state}
          switchMode={switchMode}
        />
        <BrowseNav
          ready={ready}
          busy={busy}
          history={history}
          navHistory={navHistory}
          crumbs={crumbs}
          title={location || root}
          open={(id) => void open(id)}
          openConfig={openConfig}
          summary={
            folderMode
              ? filtered.length +
                ' ' +
                tr('筆') +
                (browse.mode === 'CARD'
                  ? ' · ' +
                    (card.works
                      ? tr('所有作品') +
                        (card.level === 'all' ? '' : ' · ' + tr('最多 {0} 層', card.level))
                      : tr('逐層瀏覽'))
                  : '')
              : undefined
          }
        />
        <div
          className="browse-main"
          ref={scroll}
          onScroll={(e) => {
            state.current = {
              ...state.current,
              scrolls: { ...state.current.scrolls, [browse.mode]: e.currentTarget.scrollTop },
            }
            clearTimeout(timer.current)
            timer.current = setTimeout(() => persist(state.current), 400)
          }}
        >
          {folderMode && marked.length > 0 && (
            <KindBatchBar
              rows={all.filter((r) => marked.includes(r.rowId))}
              busy={busy}
              run={run}
              clear={() => setMarked([])}
            />
          )}
          {!folderMode && overviewRoot ? (
            <FileOverview
              toolbarTarget={overviewTools}
              scopeTarget={overviewScope}
              root={overviewRoot}
              scope={browse.fileScope ?? 'descendants'}
              presentation={browse.filePresentation ?? 'tiles'}
              busy={busy}
              change={(scope, presentation) => {
                setFilePreview(undefined)
                persist({ ...state.current, fileScope: scope, filePresentation: presentation })
              }}
              chooseRoot={(id) => void open(id)}
              open={(entry) => void previewFile(entry)}
              rows={all}
              project={project}
            />
          ) : browse.mode === 'TREE' ? (
            <Suspense fallback={<p>{tr('載入樹狀圖…')}</p>}>
              <Tree
                rows={base}
                selected={highlight}
                focusId={location ? currentFolder?.rowId : undefined}
                onSelect={setHighlight}
                onOpen={(id) => void open(id)}
                onConfigure={openConfig}
                collapsed={browse.treeCollapsed}
                onCollapsed={(treeCollapsed) => persist({ ...state.current, treeCollapsed })}
                viewport={browse.viewport}
                save={(viewport) => persist({ ...state.current, viewport })}
                cards={treeCards}
              />
            </Suspense>
          ) : browse.mode === 'TABLE' ? (
            <FolderTable
              columns={columns}
              rows={current}
              sort={sortKeys}
              setSort={setSort}
              browse={browse}
              busy={busy}
              dragColumn={dragColumn}
              draggingColumn={draggingColumn}
              valueOf={valueOf}
              labelsOf={(id) =>
                project.fieldBindings.find(
                  (field) =>
                    field.attributeId === id ||
                    project.fieldGroups?.some(
                      (group) =>
                        'group:' + group.groupId === id && group.memberIds[0] === field.attributeId
                    )
                )
              }
              setDragColumn={setDragColumn}
              columnDrop={columnDrop}
              setColumnDrop={setColumnDrop}
              droppedColumn={droppedColumn}
              reorderColumn={reorderColumn}
              endColumnDrag={endColumnDrag}
              persist={persist}
              state={state}
              resize={resize}
              moveWidth={moveWidth}
              stopWidth={stopWidth}
              highlight={highlight}
              marked={marked}
              gestures={gestures}
              panelOpen={panelOpen}
              showPanelFor={showPanelFor}
            />
          ) : (
            <FolderCards
              rows={current}
              project={project}
              itemsPerRow={liveList.itemsPerRow}
              highlight={highlight}
              marked={marked}
              gestures={gestures}
              showPanelFor={showPanelFor}
              act={act}
            />
          )}
          {!current.length && browse.mode !== 'TREE' && (
            <div className="empty-folder">
              {tr('此資料夾沒有子資料夾')}
              <small>{tr('資料夾的內容顯示在詳情面板。')}</small>
            </div>
          )}
        </div>
        {folderMode && browse.mode !== 'TREE' && (
          <div className="browse-pagination">
            <Pagination size="xs" total={pages} value={Math.min(page, pages)} onChange={setPage} />
            <small>
              {tr('每頁')}
              {pageSize} {tr('筆')}
            </small>
          </div>
        )}
      </section>
      {panelOpen && <div className="panel-scrim" aria-hidden="true" onClick={togglePanel} />}
      <BrowsePanel
        persist={persist}
        act={act}
        all={all}
        browse={browse}
        busy={busy}
        canReturnTop={canReturnTop}
        child={child}
        closeConfig={closeConfig}
        config={config}
        detail={detail}
        layoutConfig={(row) => {
          setLayoutsFrom({ row, target: 'panel' })
          setLayoutsOpen(true)
        }}
        expanded={expanded}
        filePreview={filePreview}
        folderMode={folderMode}
        canEnter={!!detail && pathKey(detail.path) !== pathKey(location || root)}
        switchTo={switching ? all.find((r) => r.rowId === switching.id) : undefined}
        switchDiscard={switchDiscard}
        switchStay={switchStay}
        nextBook={
          nextBook && {
            name: nextBook.name,
            open: (immersive: boolean, settings?: ReadingPrefs) => {
              // R-430: no fixed time limit. The request stays until the next folder's panel has taken it (it opens
              // reading when its pictures are listed), and is dropped when the switch is refused or the user goes elsewhere.
              if (previewDetail(nextBook.rowId))
                setReadNext({ id: nextBook.rowId, immersive, settings })
            },
          }
        }
        readNext={readNext}
        readNextDone={() => setReadNext(undefined)}
        moveWidth={moveWidth}
        navHistory={navHistory}
        open={open}
        openConfig={openConfig}
        panelBody={panelBody}
        panelOpen={panelOpen}
        panelSlot={panelSlot}
        project={project}
        ready={ready}
        resize={resize}
        run={run}
        setExpanded={setExpanded}
        settingsBody={settingsBody}
        stopWidth={stopWidth}
        togglePanel={togglePanel}
        history={history}
      />
    </div>
  )
}
