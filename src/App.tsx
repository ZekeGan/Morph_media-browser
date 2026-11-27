// Top-level application coordinator: owns the library snapshot, unsaved-draft guards, serialized
// library/explorer IPC requests, browse/editor view switching, and application-level dialogs.
import { Alert, Button, Checkbox, Group, Modal, Stack } from '@mantine/core'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { type ExplorerRequest, type ExplorerResponse, panelEditorStart } from '../shared/explorer'
import { type FolderKind, isFolderKind } from '../shared/kind'
import {
  fromPanelEditor,
  panelEditorProject,
  saveCardPreset,
  selectPreset,
  syncPresetDraft,
  visibleCells,
} from '../shared/layouts'
import type { CleanupPreview, Project, Request, Response } from '../shared/model'
import type { Notice } from '../shared/notifications'

import { BrowseWorkspace } from './browse/BrowseWorkspace'
import { RefreshContext } from './browse/refresh'
import { usePlayback } from './media/Playback'
import { describeError } from './notices/errors'
import { Toasts } from './notices/Toasts'
import { ApplicationSettings } from './settings/ApplicationSettings'
import { ProjectSettings } from './settings/ProjectSettings'
import { CreateProjectDialog } from './shell/CreateProjectDialog'
import { DesktopShell } from './shell/DesktopShell'
import { problemCount, ProblemsDialog } from './storage/ProblemsDialog'
import { t as tr, useLocale } from './i18n'
import { useCreateProject } from './useCreateProject'
import { useDrafts } from './useDrafts'
import { useSnapshot } from './useSnapshot'

// R-503: the layout editor (with its grid library) is loaded the first time it opens, not at start.
const Editor = lazy(() => import('./editor/Editor').then((module) => ({ default: module.Editor })))

type LibraryRequestFn = (request: Request) => Promise<Response | undefined>

interface EditorSession {
  category?: string
  // R-363: the template to open first (one folder's own); saving it leaves the project default alone.
  preset?: string
  // R-460: the folder the editor was opened for, used as its first preview.
  previewRowId?: string
}

interface AppSettingsStart {
  tab: string
  site?: string
}

export function App() {
  useLocale()

  const { snapshot, takeSnapshot, takeLater, takeProgress } = useSnapshot()
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedRowId, setSelectedRowId] = useState<string>()
  const [isBusy, setIsBusy] = useState(false)
  const busyRef = useRef(false)
  const [notice, setNoticeState] = useState<Notice>()
  const [noticeVersion, setNoticeVersion] = useState(0)

  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [hasBrowseOverlay, setHasBrowseOverlay] = useState(false)
  const [hasShellOverlay, setHasShellOverlay] = useState(false)

  const [isAppSettingsOpen, setIsAppSettingsOpen] = useState(false)
  const [appSettingsStart, setAppSettingsStart] = useState<AppSettingsStart>()
  const [projectSettingsDraft, setProjectSettingsDraft] = useState<Project>()
  const [editorSession, setEditorSession] = useState<EditorSession | null>(null)
  // R-459: the project whose browser should resume where it was after closing the layout editor.
  const [resumeProjectId, setResumeProjectId] = useState<string>()
  const [isProblemsOpen, setIsProblemsOpen] = useState(false)
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreview>()
  const [shouldRestartAfterCleanup, setShouldRestartAfterCleanup] = useState(false)

  const setNotice = useCallback((value: Notice | undefined) => {
    setNoticeState(value)
    setNoticeVersion((version) => version + 1)
  }, [])
  const dismissNotice = useCallback(() => setNoticeState(undefined), [])
  const notifyError = useCallback(
    (message: string) => setNotice({ level: 'error', ...describeError(message) }),
    [setNotice]
  )

  const createProject = useCreateProject(notifyError)
  const isCreateDialogOpen = createProject.opened
  const setIsCreateDialogOpen = createProject.setOpened

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

  const requestLibrary: LibraryRequestFn = useCallback(
    async (request) => {
      if (busyRef.current && request.action !== 'cancelScan') return
      const ownBusy = request.action !== 'cancelScan'
      if (ownBusy) {
        busyRef.current = true
        setIsBusy(true)
      }
      try {
        const result = await window.media.request(request)
        takeSnapshot(result.snapshot)
        if (!['snapshot', 'scan'].includes(request.action)) setNotice(undefined)
        if (result.notice) setNotice(result.notice)
        if (result.preview?.scope === 'all') {
          setCleanupPreview(result.preview)
          setShouldRestartAfterCleanup(false)
        }
        return result
      } catch (error) {
        notifyError(String(error))
      } finally {
        if (ownBusy) {
          busyRef.current = false
          setIsBusy(false)
        }
      }
    },
    [notifyError, setNotice]
  )

  useEffect(() => {
    requestLibrary({ action: 'snapshot' })
    return window.media.onProgress(takeProgress)
  }, [requestLibrary])

  useEffect(() => {
    if (
      selectedProjectId &&
      !snapshot.projects.some((link) => link.projectId === selectedProjectId)
    ) {
      setSelectedProjectId('')
    }
  }, [snapshot.projects, selectedProjectId])

  // Other parts of the window can open the settings on a tab, e.g. the website keys from a source preview (R-285).
  useEffect(() => {
    const openAppSettings = (event: Event) => {
      const detail = (event as CustomEvent<AppSettingsStart>).detail
      setAppSettingsStart(detail)
      setIsAppSettingsOpen(true)
    }
    window.addEventListener('morph:open-settings', openAppSettings)
    return () => window.removeEventListener('morph:open-settings', openAppSettings)
  }, [])

  const playback = usePlayback()
  useEffect(() => {
    playback?.reconcile(snapshot.projects.map((link) => link.projectId))
  }, [snapshot.projects])

  const selectedLink = snapshot.projects.find((link) => link.projectId === selectedProjectId)
  const selectedProject = selectedLink?.project
  const isEditorOpen = editorSession !== null
  const savedProjectForDraft = projectSettingsDraft
    ? snapshot.projects.find((link) => link.projectId === projectSettingsDraft.projectId)
    : undefined
  const isProjectSettingsDirty =
    !!projectSettingsDraft &&
    JSON.stringify(projectSettingsDraft) !== JSON.stringify(savedProjectForDraft?.project)

  const {
    detailDirty,
    setDetailDirty,
    setEditorDirty,
    setShellDirty,
    setAppearanceDirty,
    unsaved,
    confirmLeave,
  } = useDrafts({
    settingsDirty: isProjectSettingsDirty,
    creating: isCreateDialogOpen,
    busy: busyRef,
  })

  const hasBlockingModal =
    isCreateDialogOpen ||
    isAppSettingsOpen ||
    !!projectSettingsDraft ||
    isEditorOpen ||
    detailDirty ||
    !!cleanupPreview ||
    isProblemsOpen ||
    hasShellOverlay ||
    hasBrowseOverlay

  useEffect(() => {
    const onWindowFocus = () => {
      if (
        selectedProjectId &&
        !hasBlockingModal &&
        !busyRef.current &&
        !document.querySelector(
          '.mantine-Modal-content,.mantine-Drawer-content,.reader,.media-viewer-shell,.document-viewer'
        )
      ) {
        requestLibrary({ action: 'scan' })
      }
    }
    window.addEventListener('focus', onWindowFocus)
    return () => window.removeEventListener('focus', onWindowFocus)
  }, [hasBlockingModal, selectedProjectId, requestLibrary])

  const closeActiveEditors = () => {
    setEditorSession(null)
    setSelectedRowId(undefined)
    setProjectSettingsDraft(undefined)
    setIsAppSettingsOpen(false)
  }

  const openProject = (projectId: string, rowId?: string, confirmed = false) => {
    if (!confirmed && !confirmLeave()) return false
    closeActiveEditors()
    setIsCreateDialogOpen(false)
    setSelectedProjectId(projectId)
    if (rowId) setSelectedRowId(rowId)
    return true
  }

  const beginCreateProject = () => {
    if (confirmLeave()) {
      closeActiveEditors()
      createProject.begin()
    }
  }

  const projectRows = useMemo(
    () => snapshot.rows.filter((row) => row.projectId === selectedProjectId),
    [snapshot.rows, selectedProjectId]
  )

  // R-501: kept between renders, so the browse view's folder kinds (which every card reads) are not rebuilt.
  const projectStructure = useMemo(
    () =>
      (snapshot.structure ?? snapshot.rows).filter((row) => row.projectId === selectedProjectId),
    [snapshot.structure, snapshot.rows, selectedProjectId]
  )

  // Folders that more than one linked project shows; only these need the shared / this-project switch.
  const sharedFolders = useMemo(() => {
    const owners = new Map<string, Set<string>>()
    for (const row of snapshot.rows) {
      const folderId = row.record?.folderId
      if (folderId) owners.set(folderId, (owners.get(folderId) ?? new Set()).add(row.projectId))
    }
    return new Set([...owners].filter(([, set]) => set.size > 1).map(([folderId]) => folderId))
  }, [snapshot.rows])

  const selectDetailRow = (rowId: string) => {
    setSelectedRowId(rowId)
    return true
  }
  const closeDetailRow = () => setSelectedRowId(undefined)

  const requestExplorer = async (
    request: ExplorerRequest
  ): Promise<ExplorerResponse | undefined> => {
    // Preserve reader preferences even while another setting is saving.
    // Reading places (manga pages, novel positions) are saved even while something else runs.
    const isReadingProgress =
      request.action === 'reading' ||
      request.action === 'novelProgress' ||
      request.action === 'volumeProgress'
    if (busyRef.current && !isReadingProgress) return
    // Only a novel's place, saved while scrolling, waits for idle; the manga reading settings and volume places are
    // followed by requests that send the record's revision, so their snapshot is taken in at once.
    const deferSnapshot = request.action === 'novelProgress'
    // R-448: a reading place is saved in the background while the reader goes on: it does not mark the app busy
    // (that redrew the whole window at every chapter crossed), and the snapshot it brings back is taken in when the
    // window is idle (newer ones only).
    const ownBusy = !isReadingProgress && !busyRef.current
    if (ownBusy) {
      busyRef.current = true
      setIsBusy(true)
    }
    try {
      const result = await window.explorer.request(request)
      const nextSnapshot = result.snapshot
      if (nextSnapshot) {
        if (deferSnapshot) takeLater(nextSnapshot)
        else takeSnapshot(nextSnapshot)
      }
      if (result.notice) setNotice(result.notice)
      return result
    } catch (error) {
      notifyError(String(error))
    } finally {
      if (ownBusy) {
        busyRef.current = false
        setIsBusy(false)
      }
    }
  }

  // R-409: the panel editor works on the right-panel layouts of one kind.
  const panelEditorKind: FolderKind | undefined = isFolderKind(editorSession?.category)
    ? editorSession.category
    : undefined
  const buildPanelEditorProject = (project: Project) =>
    panelEditorProject(
      project,
      panelEditorKind!,
      panelEditorStart(project, panelEditorKind!),
      editorSession?.preset
    )

  // R-444: the card editor opened from the layout window at a layout other than the default one edits that layout and
  // leaves the default as it was (unless another layout is picked in the editor, which makes that one the default).
  const isEditingNonDefaultCardPreset =
    !panelEditorKind &&
    !!editorSession?.preset &&
    editorSession.preset !== selectedProject?.activeLayoutId &&
    !!selectedProject?.layoutPresets?.some((preset) => preset.id === editorSession.preset)

  const preserveDefaultCardLayout = (draft: Project) => {
    const synced = syncPresetDraft(draft)
    const original = synced.layoutPresets?.find(
      (preset) => preset.id === selectedProject!.activeLayoutId
    )
    return isEditingNonDefaultCardPreset &&
      draft.activeLayoutId === editorSession?.preset &&
      original
      ? { ...synced, activeLayoutId: original.id, cells: structuredClone(original.cells) }
      : synced
  }

  const saveEditedLayout = async (draft: Project, preset?: { name: string; asNew: boolean }) => {
    try {
      const nextProject = panelEditorKind
        ? fromPanelEditor(selectedProject!, draft, panelEditorKind, !!editorSession?.preset)
        : draft.layoutPresets
          ? preserveDefaultCardLayout(draft)
          : saveCardPreset(
              draft,
              preset ?? { name: tr('預設版面'), asNew: false },
              () => crypto.randomUUID(),
              selectedProject!
            )
      return !!(await requestLibrary({ action: 'saveProject', project: nextProject }))
    } catch (error) {
      notifyError(String(error))
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
                onClick={() => void requestLibrary({ action: 'cancelScan' })}
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
          selected={selectedProjectId}
          busy={isBusy}
          dirty={unsaved}
          onSelect={openProject}
          onCreate={() => beginCreateProject()}
          onSettings={() => {
            if (!confirmLeave()) return
            setAppSettingsStart(undefined)
            setIsAppSettingsOpen(true)
          }}
          onRefresh={() => {
            if (isEditorOpen) return
            setRefreshNonce((value) => value + 1)
            void requestLibrary({ action: 'scan' })
          }}
          onProjectSettings={(projectId) => {
            if (confirmLeave()) {
              const found = snapshot.projects.find((link) => link.projectId === projectId)?.project
              if (found) setProjectSettingsDraft(structuredClone(found))
            }
          }}
          onProblems={() => setIsProblemsOpen(true)}
          problemCount={problemCount(snapshot)}
          onOverlay={setHasShellOverlay}
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
              : isBusy
                ? tr('處理中…')
                : unsaved
                  ? tr('尚未保存')
                  : tr('就緒')
          }
          banner={null}
        >
          {isEditorOpen && selectedProject ? (
            <Suspense fallback={null}>
              <Editor
                key={`${selectedProject.projectId}:${editorSession.category ?? 'card'}:${editorSession.preset ?? ''}`}
                act={requestLibrary}
                presets={!panelEditorKind}
                presetTools={!!panelEditorKind}
                panelKind={panelEditorKind}
                fromSaved={panelEditorKind ? buildPanelEditorProject : undefined}
                targetLabel={
                  panelEditorKind
                    ? tr(
                        '{0}資訊版面',
                        {
                          book: tr('書籍／漫畫'),
                          game: tr('遊戲'),
                          music: tr('音樂'),
                          video: tr('影片'),
                          general: tr('一般'),
                        }[panelEditorKind]
                      )
                    : tr('卡片')
                }
                onDirty={setEditorDirty}
                project={
                  panelEditorKind
                    ? buildPanelEditorProject(selectedProject)
                    : isEditingNonDefaultCardPreset
                      ? selectPreset(selectedProject, editorSession.preset!)
                      : { ...selectedProject, cells: visibleCells(selectedProject) }
                }
                rows={(snapshot.structure ?? snapshot.rows).filter(
                  (row) => row.projectId === selectedProjectId && !row.readonly
                )}
                busy={isBusy}
                save={saveEditedLayout}
                previewRow={editorSession.previewRowId}
                close={() => {
                  setEditorSession(null)
                  setResumeProjectId(selectedProject.projectId)
                }}
              />
            </Suspense>
          ) : selectedProject && !selectedLink?.error ? (
            <BrowseWorkspace
              toolbarTarget={toolbarTarget}
              key={selectedProject.projectId}
              project={selectedProject}
              root={selectedLink!.root}
              rows={projectRows}
              sharedFolders={sharedFolders}
              structure={projectStructure}
              selected={selectedRowId}
              onSelect={selectDetailRow}
              onClose={closeDetailRow}
              busy={isBusy}
              act={requestLibrary}
              run={requestExplorer}
              onDirty={setDetailDirty}
              onOverlay={setHasBrowseOverlay}
              notify={notifyError}
              edit={(category, preset, rowId) => {
                if (
                  !detailDirty ||
                  window.confirm(tr('還有沒保存的修改，要放棄並去編輯版面嗎？'))
                ) {
                  setEditorSession({ category, preset, previewRowId: rowId })
                }
              }}
              resume={resumeProjectId === selectedProject.projectId}
              onResumed={() => setResumeProjectId(undefined)}
            />
          ) : (
            <div className="empty">
              <h1>{tr('專案暫不可用')}</h1>
              <p className="path">{selectedLink?.root}</p>
              <p>{tr('資料夾可能已搬移、離線，或資料夾資訊需要復原。')}</p>
              <Alert color="orange" mt="lg">
                {selectedLink?.error ?? tr('請選擇專案或重新連結。')}
              </Alert>
              <Group justify="center" mt="md">
                <Button disabled={isBusy} onClick={beginCreateProject}>
                  {tr('重新連結專案位置')}
                </Button>
                {selectedLink && (
                  <>
                    <Button
                      color="orange"
                      variant="light"
                      disabled={isBusy}
                      onClick={() =>
                        window.confirm(
                          tr('用最近一次正常的備份修復這個專案？壞掉的檔案會另外留著。')
                        ) &&
                        requestLibrary({
                          action: 'restoreProject',
                          projectId: selectedLink.projectId,
                        })
                      }
                    >
                      {tr('從備份復原專案')}
                    </Button>
                    <Button
                      variant="default"
                      disabled={isBusy}
                      onClick={() =>
                        requestLibrary({ action: 'unlink', projectId: selectedLink.projectId })
                      }
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
        opened={isCreateDialogOpen}
        busy={isBusy}
        {...createProject.fields}
        act={requestLibrary}
        link={async (rootToken) => {
          const existingIds = new Set(snapshot.projects.map((link) => link.projectId))
          const result = await requestLibrary({ action: 'link', rootToken })
          if (!result || result.cancelled) return
          setIsCreateDialogOpen(false)
          const addedLink =
            result.snapshot.projects.find((link) => !existingIds.has(link.projectId)) ??
            result.snapshot.projects.at(-1)
          if (addedLink) openProject(addedLink.projectId, undefined, true)
        }}
        close={() => {
          if (
            !isBusy &&
            (createProject.empty || window.confirm(tr('取消新增專案？目前還沒建立任何東西。')))
          ) {
            setIsCreateDialogOpen(false)
          }
        }}
        create={async () => {
          const { input, rootChoice, group } = createProject.fields
          const result = await requestLibrary({
            action: 'create',
            input,
            rootToken: rootChoice!.token,
          })
          if (result && !result.cancelled) {
            const createdProjectId = result.snapshot.projects.at(-1)?.projectId
            if (createdProjectId) {
              if (group) {
                try {
                  await window.desktop.updateWorkspace({
                    action: 'moveProject',
                    projectId: createdProjectId,
                    groupId: group,
                  })
                } catch (error) {
                  notifyError(tr('專案已建立，但群組保存失敗：') + String(error))
                }
              }
              openProject(createdProjectId, undefined, true)
            }
          }
        }}
      />
      <ApplicationSettings
        opened={isAppSettingsOpen}
        close={() => setIsAppSettingsOpen(false)}
        onDirty={setAppearanceDirty}
        act={requestLibrary}
        busy={isBusy}
        start={appSettingsStart}
      />
      <Modal
        opened={!!projectSettingsDraft}
        onClose={() => {
          if (
            !isBusy &&
            (!isProjectSettingsDirty || window.confirm(tr('放棄尚未保存的專案設定？')))
          ) {
            setProjectSettingsDraft(undefined)
          }
        }}
        title={tr('專案設定 · ') + (savedProjectForDraft?.project?.name ?? '')}
        size="lg"
      >
        {projectSettingsDraft && (
          <ProjectSettings
            key={projectSettingsDraft.projectId}
            project={projectSettingsDraft}
            root={savedProjectForDraft?.root ?? ''}
            busy={isBusy}
            dirty={isProjectSettingsDirty}
            change={setProjectSettingsDraft}
            act={requestLibrary}
            close={() => setProjectSettingsDraft(undefined)}
            saved={savedProjectForDraft?.project ?? projectSettingsDraft}
          />
        )}
      </Modal>
      <ProblemsDialog
        opened={isProblemsOpen}
        close={() => setIsProblemsOpen(false)}
        snapshot={snapshot}
        busy={isBusy}
        act={requestLibrary}
        run={requestExplorer}
        relink={() => {
          setIsProblemsOpen(false)
          void beginCreateProject()
        }}
        openFolder={(row) => {
          setIsProblemsOpen(false)
          openProject(row.projectId, row.rowId)
        }}
      />
      <Modal
        opened={!!cleanupPreview}
        onClose={() => setCleanupPreview(undefined)}
        title={tr('預覽：你的檔案不會被刪')}
        size="xl"
      >
        {cleanupPreview && (
          <Stack>
            <p>
              {tr('範圍：')}
              {cleanupPreview.scope === 'all'
                ? tr('全部已連結可存取資料；完成後退出連結')
                : cleanupPreview.scope === 'private'
                  ? tr('只在這個專案的資訊')
                  : tr('此資料夾所有 M:orph 建立的資訊')}
              {tr('。找到')}
              {cleanupPreview.count} {tr('個資料夾的資訊。')}
            </p>
            <div className="file-list">
              {cleanupPreview.paths.map((itemPath) => (
                <div key={itemPath}>{itemPath}</div>
              ))}
            </div>
            <Alert color="orange">
              {tr('沒接上的磁碟、不在清單裡的副本不會處理；認不得的檔案一律保留。')}
              {cleanupPreview.skipped.map((skippedMessage, index) => (
                <div key={index}>{tr(skippedMessage)}</div>
              ))}
            </Alert>
            {cleanupPreview.scope === 'folder' && (
              <Checkbox
                label={tr('清除後繼續記錄這個資料夾')}
                checked={shouldRestartAfterCleanup}
                onChange={(event) => setShouldRestartAfterCleanup(event.currentTarget.checked)}
              />
            )}
            <Button
              color="red"
              loading={isBusy}
              onClick={async () => {
                if (
                  await requestLibrary({
                    action: 'cleanup',
                    token: cleanupPreview.token,
                    restart: shouldRestartAfterCleanup,
                  })
                ) {
                  setCleanupPreview(undefined)
                  setSelectedRowId(undefined)
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
