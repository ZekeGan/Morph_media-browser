import { selectPreset, syncPresetDraft } from '../shared/layouts'
import { t as tr, useLocale } from './i18n'
import {
  startTransition,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import { Alert, Button, Checkbox, Group, Modal, Stack } from '@mantine/core'
import type {
  RootSelection,
  CleanupPreview,
  Project,
  ProjectInput,
  Request,
  Response,
  Snapshot,
} from '../shared/model'
import { usePlayback } from './media/Playback'
import { keepUnchanged } from './common/keepUnchanged'
// R-503: the layout editor (with its grid library) is loaded the first time it opens, not at start.
const Editor = lazy(() => import('./editor/Editor').then((module) => ({ default: module.Editor })))
import { ProjectSettings } from './settings/ProjectSettings'
import { ProblemsDialog, problemCount } from './storage/ProblemsDialog'
import { CreateProjectDialog } from './shell/CreateProjectDialog'
import { ApplicationSettings } from './settings/ApplicationSettings'
import { DesktopShell } from './shell/DesktopShell'
import { RefreshContext } from './browse/refresh'
import { Toasts } from './notices/Toasts'
import {
  fromPanelEditor,
  panelEditorProject,
  saveCardPreset,
  visibleCells,
} from '../shared/layouts'
import { isFolderKind, type FolderKind } from '../shared/kind'
import { BrowseWorkspace } from './browse/BrowseWorkspace'
import { panelEditorStart, type ExplorerRequest, type ExplorerResponse } from '../shared/explorer'
import type { WorkspacePrefs } from '../shared/workspace'
import { describeError } from './notices/errors'
import type { Notice } from '../shared/notifications'

const empty: Snapshot = {
  projects: [],
  rows: [],
  problems: [],
  progress: { visited: 0, created: 0, errors: 0, active: false, cancelled: false },
}
type Act = (request: Request) => Promise<Response | undefined>
export function App() {
  useLocale()

  const [snapshot, setSnapshot] = useState(empty),
    [selected, setSelected] = useState('')
  // R-448: the newest snapshot generation taken in (from main), and a reading save's snapshot waiting for an idle
  // moment. A snapshot older than what is shown is never taken in.
  const shownGeneration = useRef(0),
    waiting = useRef<Snapshot | undefined>(undefined)
  const takeSnapshot = (next: Snapshot) => {
    // One without a number (not from main's library) is taken in as it is, leaving the mark where it was.
    if (next.generation !== undefined) {
      if (next.generation <= shownGeneration.current) return
      shownGeneration.current = next.generation
    }
    // R-501: folders and projects that did not change keep their objects, so cards that show them are not drawn again.
    setSnapshot((previous) => ({
      ...next,
      projects: keepUnchanged(previous.projects, next.projects, (p) => p.projectId)!,
      rows: keepUnchanged(previous.rows, next.rows, (r) => r.rowId)!,
      structure: keepUnchanged(previous.structure, next.structure, (r) => r.rowId),
    }))
  }
  // A reading place saved in the background: its snapshot is taken in when the window is idle, newest only.
  const takeLater = (next: Snapshot) => {
    if ((next.generation ?? 0) <= (waiting.current?.generation ?? 0)) return
    const first = !waiting.current
    waiting.current = next
    if (!first) return
    const take = () => {
      const latest = waiting.current
      waiting.current = undefined
      if (latest) startTransition(() => takeSnapshot(latest))
    }
    if ('requestIdleCallback' in window) window.requestIdleCallback(take, { timeout: 3000 })
    else setTimeout(take, 0)
  }
  // Pressing anything outside the novel reader first takes in a waiting snapshot, so an edit made right after
  // reading sends the record's current revision (capture phase: before React's handlers read their props).
  useEffect(() => {
    const flush = (event: Event) => {
      const latest = waiting.current
      if (!latest) return
      if ((event.target as Element | null)?.closest?.('.novel-reader')) return
      waiting.current = undefined
      flushSync(() => takeSnapshot(latest))
    }
    document.addEventListener('pointerdown', flush, true)
    document.addEventListener('keydown', flush, true)
    return () => {
      document.removeEventListener('pointerdown', flush, true)
      document.removeEventListener('keydown', flush, true)
    }
  }, [])
  const [busy, setBusy] = useState(false),
    busyRef = useRef(false)
  const [notice, setNoticeState] = useState<Notice>(),
    [noticeVersion, setNoticeVersion] = useState(0)
  const setNotice = useCallback((value: Notice | undefined) => {
    setNoticeState(value)
    setNoticeVersion((v) => v + 1)
  }, [])
  const dismissNotice = useCallback(() => setNoticeState(undefined), [])
  const notifyError = useCallback(
    (message: string) => setNotice({ level: 'error', ...describeError(message) }),
    [setNotice]
  )
  // Async failures nobody caught used to vanish silently; surface them instead.
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
      if (/AbortError|aborted|interrupted/i.test(reason + String(event.reason?.name))) return
      event.preventDefault()
      notifyError(reason)
    }
    window.addEventListener('unhandledrejection', onRejection)
    return () => window.removeEventListener('unhandledrejection', onRejection)
  }, [notifyError])
  const [settingsOverlay, setSettingsOverlay] = useState(false)
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [createOpen, setCreateOpen] = useState(false),
    [input, setInput] = useState<ProjectInput>({
      // Filled with the localized default when the dialog opens (the locale is not loaded yet at first render).
      name: '',
      depth: { mode: 'through', level: 50 },
      scanAll: true,
    })
  const [rootChoice, setRootChoice] = useState<RootSelection>(),
    [createGroup, setCreateGroup] = useState(''),
    [groups, setGroups] = useState<WorkspacePrefs['groups']>([]),
    [settingsOpen, setSettingsOpen] = useState(false),
    [settingsStart, setSettingsStart] = useState<{ tab: string; site?: string }>()
  useEffect(() => {
    if (createOpen)
      void window.desktop
        .workspace()
        .then((r) => setGroups(r.prefs.groups))
        .catch((e) => notifyError(String(e)))
  }, [createOpen, notifyError])
  const [templateCategory, setTemplateCategory] = useState<string>()
  // R-363: the book template to open first (one folder's own); saving it then leaves the project default alone.
  const [templatePreset, setTemplatePreset] = useState<string>()
  // R-460: the folder the editor was opened for, its first preview. R-459: the project whose browser comes back
  // from the editor where it was.
  const [templateRow, setTemplateRow] = useState<string>(),
    [resumeProject, setResumeProject] = useState<string>()
  const [settings, setSettings] = useState<Project>(),
    [editor, setEditor] = useState(false),
    [detailsId, setDetailsId] = useState<string>(),
    [problems, setProblems] = useState(false)
  const [detailDirty, setDetailDirty] = useState(false),
    [editorDirty, setEditorDirty] = useState(false)
  const [shellDirty, setShellDirty] = useState(false),
    [shellOverlay, setShellOverlay] = useState(false)
  const [appearanceDirty, setAppearanceDirty] = useState(false)
  const [cleanup, setCleanup] = useState<CleanupPreview>(),
    [restart, setRestart] = useState(false)
  const act: Act = useCallback(
    async (request) => {
      if (busyRef.current && request.action !== 'cancelScan') return
      const ownBusy = request.action !== 'cancelScan'
      if (ownBusy) {
        busyRef.current = true
        setBusy(true)
      }
      try {
        const result = await window.media.request(request)
        takeSnapshot(result.snapshot)
        if (!['snapshot', 'scan'].includes(request.action)) setNotice(undefined)
        if (result.notice) setNotice(result.notice)
        if (result.preview?.scope === 'all') {
          setCleanup(result.preview)
          setRestart(false)
        }
        return result
      } catch (error) {
        notifyError(String(error))
      } finally {
        if (ownBusy) {
          busyRef.current = false
          setBusy(false)
        }
      }
    },
    [notifyError, setNotice]
  )
  useEffect(() => {
    act({ action: 'snapshot' })
    return window.media.onProgress((progress) => setSnapshot((s) => ({ ...s, progress })))
  }, [act])
  useEffect(() => {
    if (selected && !snapshot.projects.some((p) => p.projectId === selected)) setSelected('')
  }, [snapshot.projects, selected])
  const modalOpen =
    createOpen ||
    settingsOpen ||
    !!settings ||
    editor ||
    detailDirty ||
    !!cleanup ||
    problems ||
    shellOverlay ||
    settingsOverlay
  useEffect(() => {
    const focus = () => {
      if (
        selected &&
        !modalOpen &&
        !busyRef.current &&
        !document.querySelector(
          '.mantine-Modal-content,.mantine-Drawer-content,.reader,.media-viewer-shell,.document-viewer'
        )
      )
        act({ action: 'scan' })
    }
    window.addEventListener('focus', focus)
    return () => window.removeEventListener('focus', focus)
  }, [modalOpen, selected, act])
  // Other parts of the window can open the settings on a tab, e.g. the website keys from a source preview (R-285).
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ tab: string; site?: string }>).detail
      setSettingsStart(detail)
      setSettingsOpen(true)
    }
    window.addEventListener('morph:open-settings', open)
    return () => window.removeEventListener('morph:open-settings', open)
  }, [])
  const playback = usePlayback()
  useEffect(() => {
    playback?.reconcile(snapshot.projects.map((link) => link.projectId))
  }, [snapshot.projects])
  const linked = snapshot.projects.find((p) => p.projectId === selected),
    project = linked?.project
  const settingsDirty =
    !!settings &&
    JSON.stringify(settings) !==
      JSON.stringify(snapshot.projects.find((p) => p.projectId === settings.projectId)?.project)
  const unsaved = detailDirty || editorDirty || settingsDirty || shellDirty || appearanceDirty
  const dirty = unsaved || createOpen
  const clearEditors = () => {
    setEditor(false)
    setTemplateCategory(undefined)
    setDetailsId(undefined)
    setSettings(undefined)
    setSettingsOpen(false)
  }
  const confirmLeave = () => !dirty || window.confirm(tr('離開會放棄尚未保存的草稿，確定繼續？'))
  const openProject = (id: string, rowId?: string, confirmed = false) => {
    if (!confirmed && !confirmLeave()) return false
    clearEditors()
    setCreateOpen(false)
    setSelected(id)
    if (rowId) setDetailsId(rowId)
    return true
  }
  const beginCreate = () => {
    if (confirmLeave()) {
      clearEditors()
      setInput((current) => ({ ...current, name: '' }))
      setRootChoice(undefined)
      setCreateGroup('')
      setCreateOpen(true)
    }
  }
  const beginLink = () => beginCreate()
  useLayoutEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty || busyRef.current) {
        event.preventDefault()
        event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [dirty])
  const rows = useMemo(
      () => snapshot.rows.filter((r) => r.projectId === selected),
      [snapshot.rows, selected]
    ),
    // R-501: kept between renders, so the browse view's folder kinds (which every card reads) are not rebuilt.
    projectStructure = useMemo(
      () => (snapshot.structure ?? snapshot.rows).filter((r) => r.projectId === selected),
      [snapshot.structure, snapshot.rows, selected]
    )
  // Folders that more than one linked project shows; only these need the shared / this-project switch.
  const sharedFolders = useMemo(() => {
    const owners = new Map<string, Set<string>>()
    for (const r of snapshot.rows) {
      const id = r.record?.folderId
      if (id) owners.set(id, (owners.get(id) ?? new Set()).add(r.projectId))
    }
    return new Set([...owners].filter(([, set]) => set.size > 1).map(([id]) => id))
  }, [snapshot.rows])
  const chooseDetail = (id: string) => {
    setDetailsId(id)
    return true
  }
  const closeDetail = () => setDetailsId(undefined)
  const explore = async (request: ExplorerRequest): Promise<ExplorerResponse | undefined> => {
    // Preserve reader preferences even while another setting is saving.
    // Reading places (manga pages, novel positions) are saved even while something else runs.
    const reading =
      request.action === 'reading' ||
      request.action === 'novelProgress' ||
      request.action === 'volumeProgress'
    if (busyRef.current && !reading) return
    // Only a novel's place, saved while scrolling, waits for idle; the manga reading settings and volume places are
    // followed by requests that send the record's revision, so their snapshot is taken in at once.
    const later = request.action === 'novelProgress'
    // R-448: a reading place is saved in the background while the reader goes on: it does not mark the app busy
    // (that redrew the whole window at every chapter crossed), and the snapshot it brings back is taken in when the
    // window is idle (newer ones only).
    const ownBusy = !reading && !busyRef.current
    if (ownBusy) {
      busyRef.current = true
      setBusy(true)
    }
    try {
      const result = await window.explorer.request(request)
      const next = result.snapshot
      if (next) {
        if (later) takeLater(next)
        else takeSnapshot(next)
      }
      if (result.notice) setNotice(result.notice)
      return result
    } catch (error) {
      notifyError(String(error))
    } finally {
      if (ownBusy) {
        busyRef.current = false
        setBusy(false)
      }
    }
  }
  // R-409: the panel editor works on the right-panel layouts of one kind.
  const panelKind: FolderKind | undefined = isFolderKind(templateCategory)
    ? templateCategory
    : undefined
  const panelProject = (p: Project) =>
    panelEditorProject(p, panelKind!, panelEditorStart(p, panelKind!), templatePreset)
  // R-444: the card editor opened from the layout window at a layout other than the default one edits that layout and
  // leaves the default as it was (unless another layout is picked in the editor, which makes that one the default).
  const cardOther =
    !panelKind &&
    !!templatePreset &&
    templatePreset !== project?.activeLayoutId &&
    !!project?.layoutPresets?.some((p) => p.id === templatePreset)
  const keepDefault = (p: Project) => {
    const next = syncPresetDraft(p),
      original = next.layoutPresets?.find((x) => x.id === project!.activeLayoutId)
    return cardOther && p.activeLayoutId === templatePreset && original
      ? { ...next, activeLayoutId: original.id, cells: structuredClone(original.cells) }
      : next
  }
  const saveEdited = async (p: Project, preset?: { name: string; asNew: boolean }) => {
    try {
      const next = panelKind
        ? fromPanelEditor(project!, p, panelKind, !!templatePreset)
        : p.layoutPresets
          ? keepDefault(p)
          : saveCardPreset(
              p,
              preset ?? { name: tr('預設版面'), asNew: false },
              () => crypto.randomUUID(),
              project!
            )
      return !!(await act({ action: 'saveProject', project: next }))
    } catch (e) {
      notifyError(String(e))
      return false
    }
  }
  return (
    <>
      <Toasts
        notice={notice}
        version={noticeVersion}
        close={dismissNotice}
        progress={
          snapshot.progress.active ? (
            <>
              {tr('掃描 ') +
                snapshot.progress.visited +
                tr(' 筆 · 已建立 ') +
                snapshot.progress.created +
                tr(' 筆')}
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => void act({ action: 'cancelScan' })}
              >
                {tr('取消掃描')}
              </Button>
            </>
          ) : null
        }
      />
      <RefreshContext.Provider value={refreshNonce}>
        <DesktopShell
          toolbarRef={setToolbarTarget}
          projects={snapshot.projects}
          rows={snapshot.rows}
          selected={selected}
          busy={busy}
          dirty={unsaved}
          onSelect={openProject}
          onCreate={() => beginCreate()}
          onSettings={() => {
            if (!confirmLeave()) return
            setSettingsStart(undefined)
            setSettingsOpen(true)
          }}
          onRefresh={() => {
            if (editor) return
            setRefreshNonce((value) => value + 1)
            void act({ action: 'scan' })
          }}
          onProjectSettings={(id) => {
            if (confirmLeave()) {
              const p = snapshot.projects.find((p) => p.projectId === id)?.project
              if (p) setSettings(structuredClone(p))
            }
          }}
          onProblems={() => setProblems(true)}
          problemCount={problemCount(snapshot)}
          onOverlay={setShellOverlay}
          onDirty={setShellDirty}
          onSnapshot={takeSnapshot}
          status={
            snapshot.progress.active
              ? tr(
                  '掃描 {0} 筆 · 已建 {1} · 問題 {2}',
                  snapshot.progress.visited,
                  snapshot.progress.created,
                  snapshot.progress.errors
                )
              : busy
                ? tr('處理中…')
                : unsaved
                  ? tr('尚未保存')
                  : tr('就緒')
          }
          banner={null}
        >
          {editor && project ? (
            <Suspense fallback={null}>
              <Editor
                key={`${project.projectId}:${templateCategory ?? 'card'}:${templatePreset ?? ''}`}
                act={act}
                presets={!panelKind}
                presetTools={!!panelKind}
                panelKind={panelKind}
                fromSaved={panelKind ? panelProject : undefined}
                targetLabel={
                  panelKind
                    ? tr(
                        '{0}資訊版面',
                        {
                          book: tr('書籍／漫畫'),
                          game: tr('遊戲'),
                          music: tr('音樂'),
                          video: tr('影片'),
                          general: tr('一般'),
                        }[panelKind]
                      )
                    : tr('卡片')
                }
                onDirty={setEditorDirty}
                project={
                  panelKind
                    ? panelProject(project)
                    : cardOther
                      ? selectPreset(project, templatePreset!)
                      : { ...project, cells: visibleCells(project) }
                }
                rows={(snapshot.structure ?? snapshot.rows).filter(
                  (r) => r.projectId === selected && !r.readonly
                )}
                busy={busy}
                save={saveEdited}
                previewRow={templateRow}
                close={() => {
                  setEditor(false)
                  setTemplateCategory(undefined)
                  setTemplatePreset(undefined)
                  setTemplateRow(undefined)
                  setResumeProject(project.projectId)
                }}
              />
            </Suspense>
          ) : project && !linked?.error ? (
            <BrowseWorkspace
              toolbarTarget={toolbarTarget}
              key={project.projectId}
              project={project}
              root={linked!.root}
              rows={rows}
              sharedFolders={sharedFolders}
              structure={projectStructure}
              selected={detailsId}
              onSelect={chooseDetail}
              onClose={closeDetail}
              busy={busy}
              act={act}
              run={explore}
              onDirty={setDetailDirty}
              onOverlay={setSettingsOverlay}
              notify={notifyError}
              edit={(category, preset, rowId) => {
                if (!detailDirty || window.confirm(tr('放棄欄位草稿後編輯版面？'))) {
                  setTemplateCategory(category)
                  setTemplatePreset(preset)
                  setTemplateRow(rowId)
                  setEditor(true)
                }
              }}
              resume={resumeProject === project.projectId}
              onResumed={() => setResumeProject(undefined)}
            />
          ) : (
            <div className="empty">
              <h1>{tr('專案暫不可用')}</h1>
              <p className="path">{linked?.root}</p>
              <p>{tr('資料夾可能已搬移、離線，或資料夾資訊需要復原。')}</p>
              <Alert color="orange" mt="lg">
                {linked?.error ?? tr('請選擇專案或重新連結。')}
              </Alert>
              <Group justify="center" mt="md">
                <Button disabled={busy} onClick={beginLink}>
                  {tr('重新連結專案位置')}
                </Button>
                {linked && (
                  <>
                    <Button
                      color="orange"
                      variant="light"
                      disabled={busy}
                      onClick={() =>
                        window.confirm(
                          tr('從有效備份恢復主資料夾的資訊與專案設定？目前損壞的檔案會另外保留。')
                        ) && act({ action: 'restoreProject', projectId: linked.projectId })
                      }
                    >
                      {tr('從備份復原專案')}
                    </Button>
                    <Button
                      variant="default"
                      disabled={busy}
                      onClick={() => act({ action: 'unlink', projectId: linked.projectId })}
                    >
                      {tr('取消失效連結（保留資料夾資訊）')}
                    </Button>
                  </>
                )}
              </Group>
            </div>
          )}
        </DesktopShell>
      </RefreshContext.Provider>
      <CreateProjectDialog
        opened={createOpen}
        busy={busy}
        input={input}
        setInput={setInput}
        groups={groups}
        group={createGroup}
        setGroup={setCreateGroup}
        rootChoice={rootChoice}
        setRootChoice={setRootChoice}
        act={act}
        link={async (rootToken) => {
          const before = new Set(snapshot.projects.map((p) => p.projectId)),
            result = await act({ action: 'link', rootToken })
          if (!result || result.cancelled) return
          setCreateOpen(false)
          const next =
            result.snapshot.projects.find((p) => !before.has(p.projectId)) ??
            result.snapshot.projects.at(-1)
          if (next) openProject(next.projectId, undefined, true)
        }}
        close={() => {
          if (
            !busy &&
            ((!rootChoice && !input.name.trim()) ||
              window.confirm(tr('取消新增專案？尚未建立資料。')))
          )
            setCreateOpen(false)
        }}
        create={async () => {
          const result = await act({ action: 'create', input, rootToken: rootChoice!.token })
          if (result && !result.cancelled) {
            const id = result.snapshot.projects.at(-1)?.projectId
            if (id) {
              if (createGroup)
                try {
                  await window.desktop.updateWorkspace({
                    action: 'moveProject',
                    projectId: id,
                    groupId: createGroup,
                  })
                } catch (e) {
                  notifyError(tr('專案已建立，但群組保存失敗：') + String(e))
                }
              openProject(id, undefined, true)
            }
          }
        }}
      />
      <ApplicationSettings
        opened={settingsOpen}
        close={() => setSettingsOpen(false)}
        onDirty={setAppearanceDirty}
        act={act}
        busy={busy}
        start={settingsStart}
      />
      <Modal
        opened={!!settings}
        onClose={() => {
          if (!busy && (!settingsDirty || window.confirm(tr('放棄尚未保存的專案設定？'))))
            setSettings(undefined)
        }}
        title={
          tr('專案設定 · ') +
          (snapshot.projects.find((p) => p.projectId === settings?.projectId)?.project?.name ?? '')
        }
        size="lg"
      >
        {settings && (
          <ProjectSettings
            key={settings.projectId}
            project={settings}
            root={snapshot.projects.find((p) => p.projectId === settings.projectId)?.root ?? ''}
            busy={busy}
            dirty={settingsDirty}
            change={setSettings}
            act={act}
            close={() => setSettings(undefined)}
            saved={
              snapshot.projects.find((p) => p.projectId === settings.projectId)?.project ?? settings
            }
          />
        )}
      </Modal>
      <ProblemsDialog
        opened={problems}
        close={() => setProblems(false)}
        snapshot={snapshot}
        busy={busy}
        act={act}
        run={explore}
        relink={() => {
          setProblems(false)
          void beginLink()
        }}
        openFolder={(row) => {
          setProblems(false)
          openProject(row.projectId, row.rowId)
        }}
      />
      <Modal
        opened={!!cleanup}
        onClose={() => setCleanup(undefined)}
        title={tr('清理預覽：原始媒體不刪除')}
        size="xl"
      >
        {cleanup && (
          <Stack>
            <p>
              {tr('範圍：')}
              {cleanup.scope === 'all'
                ? tr('全部已連結可存取資料；完成後退出連結')
                : cleanup.scope === 'private'
                  ? tr('只在這個專案的資訊')
                  : tr('此資料夾所有 M:orph 建立的資訊')}
              {tr('。找到')}
              {cleanup.count} {tr('個資料夾的資訊。')}
            </p>
            <div className="file-list">
              {cleanup.paths.map((p) => (
                <div key={p}>{p}</div>
              ))}
            </div>
            <Alert color="orange">
              {tr('未連結或離線的副本不在這次範圍內。不認得的檔案與無法確認的資訊都會保留。')}
              {cleanup.skipped.map((s, i) => (
                <div key={i}>{tr(s)}</div>
              ))}
            </Alert>
            {cleanup.scope === 'folder' && (
              <Checkbox
                label={tr('清除後立即重新開始記錄（預設為停止記錄）')}
                checked={restart}
                onChange={(e) => setRestart(e.currentTarget.checked)}
              />
            )}
            <Button
              color="red"
              loading={busy}
              onClick={async () => {
                if (await act({ action: 'cleanup', token: cleanup.token, restart })) {
                  setCleanup(undefined)
                  setDetailsId(undefined)
                }
              }}
            >
              {tr('確認清除列出的 M:orph 資訊')}
            </Button>
          </Stack>
        )}
      </Modal>
    </>
  )
}
