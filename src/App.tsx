import { selectPreset, syncPresetDraft } from '../shared/layouts'
import { t as tr, useLocale } from './i18n'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Group, Modal, Stack } from '@mantine/core'
import type { CleanupPreview, Project, Request, Response } from '../shared/model'
import { usePlayback } from './media/Playback'
import { useCreateProject } from './useCreateProject'
import { useSnapshot } from './useSnapshot'
import { useDrafts } from './useDrafts'
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
import { describeError } from './notices/errors'
import type { Notice } from '../shared/notifications'

type Act = (request: Request) => Promise<Response | undefined>
export function App() {
  useLocale()

  const { snapshot, takeSnapshot, takeLater, takeProgress } = useSnapshot()
  const [selected, setSelected] = useState('')
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
  const create = useCreateProject(notifyError),
    createOpen = create.opened,
    setCreateOpen = create.setOpened
  const [settingsOpen, setSettingsOpen] = useState(false),
    [settingsStart, setSettingsStart] = useState<{ tab: string; site?: string }>()
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
  const [shellOverlay, setShellOverlay] = useState(false)
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
    return window.media.onProgress(takeProgress)
  }, [act])
  useEffect(() => {
    if (selected && !snapshot.projects.some((p) => p.projectId === selected)) setSelected('')
  }, [snapshot.projects, selected])
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
  const {
    detailDirty,
    setDetailDirty,
    setEditorDirty,
    setShellDirty,
    setAppearanceDirty,
    unsaved,
    confirmLeave,
  } = useDrafts({ settingsDirty, creating: createOpen, busy: busyRef })
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
  const clearEditors = () => {
    setEditor(false)
    setTemplateCategory(undefined)
    setDetailsId(undefined)
    setSettings(undefined)
    setSettingsOpen(false)
  }
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
      create.begin()
    }
  }
  const beginLink = () => beginCreate()
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
                  '{0} 個資料夾 · 新增 {1} · 問題 {2}',
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
                if (
                  !detailDirty ||
                  window.confirm(tr('還有沒保存的修改，要放棄並去編輯版面嗎？'))
                ) {
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
                          tr('用最近一次正常的備份修復這個專案？壞掉的檔案會另外留著。')
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
                      {tr('從清單移除（資料夾裡的資訊保留）')}
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
        {...create.fields}
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
          if (!busy && (create.empty || window.confirm(tr('取消新增專案？目前還沒建立任何東西。'))))
            setCreateOpen(false)
        }}
        create={async () => {
          const { input, rootChoice, group } = create.fields
          const result = await act({ action: 'create', input, rootToken: rootChoice!.token })
          if (result && !result.cancelled) {
            const id = result.snapshot.projects.at(-1)?.projectId
            if (id) {
              if (group)
                try {
                  await window.desktop.updateWorkspace({
                    action: 'moveProject',
                    projectId: id,
                    groupId: group,
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
        title={tr('預覽：你的檔案不會被刪')}
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
              {tr('沒接上的磁碟、不在清單裡的副本不會處理；認不得的檔案一律保留。')}
              {cleanup.skipped.map((s, i) => (
                <div key={i}>{tr(s)}</div>
              ))}
            </Alert>
            {cleanup.scope === 'folder' && (
              <Checkbox
                label={tr('清除後繼續記錄這個資料夾')}
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
