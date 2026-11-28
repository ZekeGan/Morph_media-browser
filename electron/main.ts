// Electron main-process entry: enforces single-instance startup, registers trusted app:// and
// media:// protocols, guards IPC channels, and owns BrowserWindow security and lifecycle hooks.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  net,
  protocol,
  safeStorage,
  screen,
  shell,
} from 'electron'

import type { LocaleId } from '../shared/locales'
import type { Response } from '../shared/model'
import { nativeText } from '../shared/native-messages'
import type { WindowAction } from '../shared/workspace'

import { searchSources } from './sources/search'
import { type DesktopOperations, Explorer } from './explorer'
import { safePath } from './files'
import { warmHiddenHelper } from './hidden'
import { isExplorerRequest, isLibraryRequest, isWorkspaceCommand, ref } from './ipc-requests'
import { KeyStore } from './keys'
import { Library } from './library'
import { libraryDispatcher } from './library-dispatch'
import { THUMB_EDGE } from './media-files'
import { decodeThumbnail, SHARP_TYPES } from './thumbnail-decode'
import { WorkspaceStore } from './workspace'

const directory = path.dirname(fileURLToPath(import.meta.url))
// Taskbar and Alt+Tab icon; a build without the build/ folder simply keeps the default icon.
const appIcon = path.join(directory, '../../build/icon.ico')
const rendererRoot = path.resolve(directory, '../renderer')
const devUrl = process.env.ELECTRON_RENDERER_URL

protocol.registerSchemesAsPrivileged(
  ['app', 'media'].map((scheme) => ({
    scheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  }))
)

let win: BrowserWindow | undefined
let library: Library
let workspace: WorkspaceStore
let pendingRequests = 0
let nativeLocale: LocaleId = 'zh-TW'

const nt = (source: Parameters<typeof nativeText>[0]) => nativeText(source, nativeLocale)

function isTrustedOrigin(url: string): boolean {
  try {
    return devUrl
      ? new URL(url).origin === new URL(devUrl).origin
      : new URL(url).protocol === 'app:' && new URL(url).hostname === 'ui'
  } catch {
    return false
  }
}

function allowedRendererOrigin(): string {
  return devUrl ? new URL(devUrl).origin : 'app://ui'
}

function assertTrustedSender(event: Electron.IpcMainInvokeEvent): void {
  if (
    event.sender !== win?.webContents ||
    event.senderFrame !== win.webContents.mainFrame ||
    !isTrustedOrigin(event.senderFrame.url)
  ) {
    throw new Error('拒絕未授權的操作')
  }
}

// Automated UI tests run the real app. Unless MEDIA_VIEWER_TEST_VISIBLE=1 their window stays out of the way:
// fully transparent, click-through, never activated and not in the taskbar. It is still a normal visible window to
// Chromium, so rendering and screenshots keep their normal speed (an off-screen window was ten times slower). Real use and `pnpm dev` are unaffected.
const quietTest =
  !!process.env.MEDIA_VIEWER_TEST_DATA && process.env.MEDIA_VIEWER_TEST_VISIBLE !== '1'
// MEDIA_VIEWER_TEST_VISIBLE=1 lets you watch: half transparent, click-through and never activated, so the window
// you are working in keeps the focus and the clicks.
const watchTest = !!process.env.MEDIA_VIEWER_TEST_DATA && !quietTest

if (quietTest || watchTest) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
  app.commandLine.appendSwitch('disable-renderer-backgrounding')
}

// C-149, Beta only: security software that does not know the unsigned Morph.exe (Kaspersky injects klhkum.dll) puts
// its own DLL into Chromium's sandboxed page process, which then stops at once and the window never loads. Until the
// releases are signed (R-SIGN, before 1.0.0) a -beta version runs without the process sandbox. Context isolation,
// no Node in the page and the sandboxed preload (webPreferences below) stay as they are. The version number ends this
// on its own: 1.0.0 has no -beta, so the sandbox is back.
if (/-beta\.\d+$/.test(app.getVersion())) app.commandLine.appendSwitch('no-sandbox')

// The product is called M:orph now, but its data stays in the original folder so no settings or index are lost.
if (process.env.MEDIA_VIEWER_TEST_DATA) {
  app.setPath('userData', path.resolve(process.env.MEDIA_VIEWER_TEST_DATA))
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'media-viewer'))
}

function createDesktopOperations(userData: string): DesktopOperations {
  return {
    external: (url) => shell.openExternal(url),
    choose: async (kind, initialPath) => {
      const result = await dialog.showOpenDialog(win!, {
        defaultPath: initialPath,
        properties: [kind === 'folder' ? 'openDirectory' : 'openFile'],
        ...(['folder', 'file'].includes(kind)
          ? {}
          : {
              filters: [
                {
                  name: nt(kind === 'subtitle' ? '字幕' : '程式'),
                  extensions:
                    kind === 'game'
                      ? ['exe', 'swf']
                      : kind === 'exe'
                        ? ['exe']
                        : ['srt', 'vtt', 'ass', 'ssa'],
                },
              ],
            }),
      })
      return result.canceled ? undefined : result.filePaths[0]
    },
    open: async (file) => {
      const error = await shell.openPath(file)
      if (error) throw new Error(error)
    },
    reveal: (file) => shell.showItemInFolder(file),
    launch: (file, args, onExit) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(file, args, {
          cwd: path.dirname(file),
          shell: false,
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        })
        child.once('error', reject)
        child.once('spawn', () => {
          // R-308: only this process is followed; if M:orph closes first, the session is not counted.
          const started = Date.now()
          if (onExit) child.once('exit', () => onExit(started, Date.now()))
          child.unref()
          resolve()
        })
      }),
    protocolReady: (scheme) => !!app.getApplicationNameForProtocol(scheme + '://'),
    localeEmulator: () => workspace.localeEmulatorPath(),
    setLocaleEmulator: async (file) => {
      await workspace.setLocaleEmulator(file)
    },
    sourceLanguages: () => workspace.sourceLanguages(),
    subtitleProgress: (progress) => win?.webContents.send('explorer:subtitleProgress', progress),
    flashPlayer: () => workspace.flashPlayerPath(),
    setFlashPlayer: async (file) => {
      await workspace.setFlashPlayer(file)
    },
    videoPlayer: () => workspace.videoPlayerPath(),
    setVideoPlayer: async (file) => {
      await workspace.setVideoPlayer(file)
    },
    keyStore: new KeyStore(userData, {
      // Linux without a keyring falls back to plain text; keys are not stored then.
      available: () =>
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== 'linux' ||
          safeStorage.getSelectedStorageBackend?.() !== 'basic_text'),
      encrypt: (text) => safeStorage.encryptString(text),
      decrypt: (data) => safeStorage.decryptString(data),
    }),
    played: (folderId, started, ended) => {
      void workspace.recordPlay(folderId, started, ended).catch(() => {})
    },
    thumbnail: async (file, mime, url) => {
      if (mime?.startsWith('video/')) {
        // A box, not a fixed size: the shell keeps the aspect ratio. 160x90 looked blurry in tiles.
        const image = await nativeImage.createThumbnailFromPath(file, {
          width: 480,
          height: 480,
        })
        if (image.isEmpty()) throw new Error('無影片縮圖')
        return image.toJPEG(85)
      }
      // R-518: pictures are decoded here with sharp from the checked file; an audio file's embedded cover, BMP,
      // ICO and files sharp cannot read still go to the window below.
      if (url?.startsWith('media://file/') && mime && SHARP_TYPES.has(mime)) {
        try {
          return await decodeThumbnail(file)
        } catch {
          // The window decoder below tries the same file.
        }
      }
      if (
        !win ||
        win.isDestroyed() ||
        !isTrustedOrigin(win.webContents.getURL()) ||
        !(url?.startsWith('media://file/') || url?.startsWith('media://audio-cover/'))
      ) {
        throw new Error('圖片解碼器尚未就緒')
      }
      // Decode asynchronously from the already-scoped stream. No original image
      // buffer/base64 crosses IPC, and full bitmap decoding stays off main.
      // R-498: the picture's size is read first (loading an <img> reads the header, it does not draw), so it is
      // scaled once, with high quality, to THUMB_EDGE on its longer side; never enlarged.
      const bytes = await win.webContents.executeJavaScript(
        // i18n-ignore: script source run in the hidden window; its two messages have their own keys
        `(async()=>{const response=await fetch(${JSON.stringify(url)});if(!response.ok)throw new Error('找不到圖片來源');const blob=await response.blob(),link=URL.createObjectURL(blob);let width=0,height=0;try{const image=new Image();image.src=link;await new Promise((done)=>{image.onload=image.onerror=done});width=image.naturalWidth;height=image.naturalHeight}finally{URL.revokeObjectURL(link)}if(!width||!height)throw new DOMException('undecodable','EncodingError');if(width*height>100000000)throw new Error('圖片尺寸過大');const scale=Math.min(1,${THUMB_EDGE}/Math.max(width,height));const bitmap=await createImageBitmap(blob,{resizeWidth:Math.max(1,Math.round(width*scale)),resizeHeight:Math.max(1,Math.round(height*scale)),resizeQuality:'high'});try{const canvas=new OffscreenCanvas(bitmap.width,bitmap.height);canvas.getContext('2d').drawImage(bitmap,0,0);return Array.from(new Uint8Array(await(await canvas.convertToBlob({type:'image/jpeg',quality:.85})).arrayBuffer()))}finally{bitmap.close()}})()`
      )
      return Buffer.from(bytes)
    },
  }
}

function registerIpcHandlers(
  explorer: Explorer,
  dispatch: ReturnType<typeof libraryDispatcher>,
  startupError: string,
  projectIds: () => string[]
): void {
  ipcMain.handle('explorer:request', async (event, request: unknown) => {
    assertTrustedSender(event)
    if (!isExplorerRequest(request)) throw new Error('無效的操作')
    pendingRequests++
    try {
      // R-418: a name search only asks websites; it needs neither the library nor the explorer.
      if (request.action === 'metadataSearch') {
        return await searchSources(request.query, fetch, workspace.sourceLanguages(), {
          sources: request.sources,
          keyFor: (site) => explorer.desktop.keyStore?.get(site) ?? Promise.resolve(undefined),
        })
      }
      return await library.run(() => explorer.request(request))
    } finally {
      pendingRequests--
    }
  })

  ipcMain.handle('explorer:subtitleDrop', async (event, rowId: unknown, file: unknown) => {
    assertTrustedSender(event)
    if (!ref(rowId) || !ref(file)) throw new Error('無效的操作')
    pendingRequests++
    try {
      return await library.run(() => explorer.droppedSubtitle(rowId, file))
    } finally {
      pendingRequests--
    }
  })

  ipcMain.handle('workspace:read', async (event) => {
    assertTrustedSender(event)
    pendingRequests++
    try {
      return await workspace.read(projectIds())
    } finally {
      pendingRequests--
    }
  })

  ipcMain.handle('workspace:update', async (event, command: unknown) => {
    assertTrustedSender(event)
    if (!isWorkspaceCommand(command)) throw new Error('無效的操作')
    pendingRequests++
    try {
      const state = await workspace.update(command, projectIds())
      nativeLocale = state.prefs.locale ?? 'zh-TW'
      return state
    } finally {
      pendingRequests--
    }
  })

  ipcMain.handle('window:action', (event, action: WindowAction) => {
    assertTrustedSender(event)
    if (!['state', 'minimize', 'toggleMaximize', 'close'].includes(action)) {
      throw new Error('不支援的視窗操作')
    }
    if (action === 'minimize') win!.minimize()
    if (action === 'toggleMaximize') {
      if (win!.isMaximized()) win!.unmaximize()
      else win!.maximize()
    }
    const state = {
      maximized: win!.isMaximized(),
      visible: win!.isVisible() && !win!.isMinimized(),
    }
    if (action === 'close') win!.close()
    return state
  })

  ipcMain.handle('library:request', async (event, request: unknown) => {
    assertTrustedSender(event)
    if (!isLibraryRequest(request)) throw new Error('無效的操作')
    if (request.action === 'cancelScan') {
      library.cancelScan()
      return { snapshot: library.snapshot() }
    }
    if (request.action === 'snapshot' && startupError) {
      return {
        snapshot: library.snapshot(),
        notice: { level: 'error', message: startupError },
      } satisfies Response
    }
    pendingRequests++
    try {
      return await library.run(() => dispatch(request))
    } finally {
      pendingRequests--
    }
  })
}

function registerProtocols(explorer: Explorer): void {
  protocol.handle('app', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.hostname !== 'ui') return new Response(null, { status: 403 })
      const file = path.resolve(rendererRoot, '.' + decodeURIComponent(url.pathname))
      await safePath(rendererRoot, file)
      return net.fetch(pathToFileURL(file).toString())
    } catch {
      return new Response(null, { status: 404 })
    }
  })

  protocol.handle('media', async (request) => {
    try {
      const url = new URL(request.url)
      const parts = url.pathname.split('/').filter(Boolean)
      if (url.hostname === 'audio-cover' && parts.length === 2) {
        const response = await explorer.audioCover(parts[0], parts[1], request.signal)
        response.headers.set('Access-Control-Allow-Origin', allowedRendererOrigin())
        return response
      }
      if (['file', 'thumb'].includes(url.hostname) && parts.length === 2) {
        const response = await explorer.stream(
          parts[0],
          parts[1],
          request,
          url.hostname === 'thumb'
        )
        response.headers.set('Access-Control-Allow-Origin', allowedRendererOrigin())
        response.headers.set('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges')
        return response
      }
      if (url.hostname === 'cover' && parts.length === 1) {
        const response = await explorer.folderCover(parts[0], request)
        response.headers.set('Access-Control-Allow-Origin', allowedRendererOrigin())
        return response
      }
      if (url.hostname === 'nth' && parts.length === 2) {
        const response = await explorer.nthImage(parts[0], Number(parts[1]), request)
        response.headers.set('Access-Control-Allow-Origin', allowedRendererOrigin())
        return response
      }
      if (url.hostname === 'archive' && parts.length === 4) {
        return explorer.archiveStream(parts[0], parts[1], parts[2], parts[3])
      }
      if (url.hostname !== 'asset' || parts.length !== 2) {
        return new Response(null, { status: 403 })
      }
      const asset = await library.asset(parts[0], parts[1])
      return net.fetch(pathToFileURL(asset.file).toString())
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

function createMainWindow(): BrowserWindow {
  const browserWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 760,
    minHeight: 580,
    frame: false,
    backgroundColor: '#202124',
    ...(existsSync(appIcon) ? { icon: appIcon } : {}),
    ...(quietTest ? { opacity: 0, skipTaskbar: true } : watchTest ? { opacity: 0.6 } : {}),
    show: false,
    webPreferences: {
      preload: path.join(directory, '../preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      plugins: true,
      ...(quietTest || watchTest ? { backgroundThrottling: false } : {}),
    },
  })
  browserWindow.setMenu(null)
  // UI tests play test tones; the window is silent then (the players' own volume and mute still work and are
  // what the tests check).
  if (quietTest || watchTest) browserWindow.webContents.setAudioMuted(true)

  browserWindow.on('app-command', (event, command) => {
    if (command !== 'browser-backward' && command !== 'browser-forward') return
    event.preventDefault()
    if (!browserWindow.isFocused() || !browserWindow.isVisible() || browserWindow.isMinimized()) {
      return
    }
    const cursor = screen.getCursorScreenPoint()
    const bounds = browserWindow.getContentBounds()
    const zoom = browserWindow.webContents.getZoomFactor()
    browserWindow.webContents.send('folder:navigate', {
      delta: command === 'browser-backward' ? -1 : 1,
      x: (cursor.x - bounds.x) / zoom,
      y: (cursor.y - bounds.y) / zoom,
    })
  })

  const contents = browserWindow.webContents
  contents.on('before-input-event', (event, input) => {
    if (input.key !== 'F12') return
    event.preventDefault()
    if (input.type === 'keyDown' && !input.isAutoRepeat) contents.toggleDevTools()
  })

  const publishWindowState = () =>
    browserWindow.webContents.send('window:state', {
      maximized: browserWindow.isMaximized(),
      visible: browserWindow.isVisible() && !browserWindow.isMinimized(),
    })
  browserWindow.on('maximize', publishWindowState)
  browserWindow.on('unmaximize', publishWindowState)
  browserWindow.on('hide', publishWindowState)
  browserWindow.on('show', publishWindowState)
  browserWindow.on('minimize', publishWindowState)
  browserWindow.on('restore', publishWindowState)

  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  browserWindow.on('close', (event) => {
    if (pendingRequests) {
      event.preventDefault()
      dialog.showMessageBoxSync(browserWindow, {
        type: 'info',
        message: nt('操作仍在進行'),
        detail: nt('請等候保存完成；掃描可先按「取消掃描」，再關閉程式。'),
        buttons: [nt('繼續等待')],
      })
    }
  })

  contents.on('will-prevent-unload', (event) => {
    if (pendingRequests) return
    const choice = dialog.showMessageBoxSync(browserWindow, {
      type: 'question',
      message: nt('要放棄尚未保存的變更嗎？'),
      detail: nt('返回可繼續編輯；放棄後會關閉或重新載入畫面。'),
      buttons: [nt('返回編輯'), nt('放棄變更')],
      defaultId: 0,
      cancelId: 0,
    })
    if (choice === 1) event.preventDefault()
  })

  contents.on('will-navigate', (event, url) => {
    if (!isTrustedOrigin(url)) event.preventDefault()
  })

  // C-149: with the process sandbox off in Beta, a redirect of the page or a frame (the PDF viewer's media://
  // frame) may not lead to a web or file address either.
  contents.on('will-redirect', (details) => {
    if (
      details.isMainFrame ? !isTrustedOrigin(details.url) : /^(https?|file|ftp):/i.test(details.url)
    ) {
      details.preventDefault()
    }
  })

  contents.on('will-frame-navigate', (details) => {
    if (!details.isMainFrame && /^(https?|file|ftp):/i.test(details.url)) {
      details.preventDefault()
    }
  })

  const allowFullscreen = (
    requestContents: Electron.WebContents | null,
    permission: string,
    details: { isMainFrame?: boolean; requestingUrl?: string }
  ) =>
    permission === 'fullscreen' &&
    !!requestContents &&
    requestContents === browserWindow.webContents &&
    details.isMainFrame === true &&
    isTrustedOrigin(details.requestingUrl ?? '') &&
    isTrustedOrigin(requestContents.getURL())

  contents.session.setPermissionCheckHandler((requestContents, permission, _origin, details) =>
    allowFullscreen(requestContents, permission, details)
  )
  contents.session.setPermissionRequestHandler((requestContents, permission, callback, details) =>
    callback(allowFullscreen(requestContents, permission, details))
  )

  // A crashed renderer would leave a blank window; reload it (the data on disk is untouched).
  contents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details.reason)
    if (details.reason === 'clean-exit') return
    setTimeout(() => {
      if (!browserWindow.isDestroyed()) browserWindow.webContents.reload()
    }, 300)
  })

  browserWindow.once('ready-to-show', () => {
    if (!quietTest && !watchTest) return browserWindow.show()
    browserWindow.setIgnoreMouseEvents(true)
    browserWindow.showInactive()
  })

  return browserWindow
}

async function bootstrap(): Promise<void> {
  const userData = app.getPath('userData')
  library = new Library(userData, (progress) => win?.webContents.send('library:progress', progress))

  let startupError = ''
  try {
    await library.init()
  } catch (error) {
    startupError = String(error)
    console.error(error)
  }

  workspace = new WorkspaceStore(
    userData,
    process.env.MEDIA_VIEWER_TEST_DATA ? ['zh-TW'] : app.getPreferredSystemLanguages()
  )
  await workspace.init()

  const dispatch = libraryDispatcher({
    library,
    workspace,
    window: () => win!,
    text: nt,
  })
  const projectIds = () => library.snapshot().projects.map((link) => link.projectId)
  nativeLocale = (await workspace.read(projectIds())).prefs.locale ?? 'zh-TW'

  const explorer = new Explorer(library, userData, createDesktopOperations(userData))
  warmHiddenHelper()
  app.on('will-quit', () => explorer.close())

  registerIpcHandlers(explorer, dispatch, startupError, projectIds)
  registerProtocols(explorer)

  win = createMainWindow()
  await win.loadURL(devUrl ?? 'app://ui/index.html')
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    win?.restore()
    win?.focus()
  })
  app.on('window-all-closed', () => app.quit())
  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      console.error(error)
      dialog.showErrorBox(nt('啟動失敗'), String(error))
      app.quit()
    })
}
