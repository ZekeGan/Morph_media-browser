import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

import { folderFile, projectFile } from '../electron/files'
import { Library } from '../electron/library'
import { WorkspaceStore } from '../electron/workspace'
import { closeApp } from './support/app'
import { tinyPng } from './support/archive-fixture'
import { videoFixture } from './support/video-fixture'

const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'media-feedback-'))
const media = path.join(root, 'Media')
const manga = path.join(root, 'Manga')
const single = path.join(media, 'Single')
const local = path.join(root, 'local')
await fs.mkdir(single, { recursive: true })
await fs.mkdir(manga)
await fs.writeFile(path.join(single, 'COVER.png'), tinyPng)
await fs.writeFile(path.join(media, 'cover.png'), tinyPng)
await fs.writeFile(path.join(media, 'folder.png'), tinyPng)
await fs.writeFile(path.join(media, 'broken.png'), 'BROKEN COVER')
await fs.writeFile(path.join(manga, 'page.png'), tinyPng)
// Playback is outside this regression: use a controlled WAV for metadata only.
const wav = Buffer.alloc(46)
wav.write('RIFF')
wav.writeUInt32LE(38, 4)
wav.write('WAVEfmt ', 8)
wav.writeUInt32LE(16, 16)
wav.writeUInt16LE(1, 20)
wav.writeUInt16LE(1, 22)
wav.writeUInt32LE(44100, 24)
wav.writeUInt32LE(88200, 28)
wav.writeUInt16LE(2, 32)
wav.writeUInt16LE(16, 34)
wav.write('data', 36)
wav.writeUInt32LE(2, 40)
await fs.writeFile(path.join(media, 'track.wav'), wav)
await fs.writeFile(path.join(single, 'track.wav'), wav)
for (const name of ['first.mp4', 'second.mp4']) {
  await fs.copyFile(await videoFixture(), path.join(media, name))
}
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Media feedback',
  scanAll: true,
  depth: { mode: 'through', level: 1 },
})
await library.create(manga, {
  name: 'Manga feedback',
  scanAll: true,
  depth: { mode: 'through', level: 1 },
})
const snapshot = library.snapshot()
const projects = snapshot.projects.map((entry) => entry.project!)
const rootOf = (projectId: string) => snapshot.projects.find((e) => e.projectId === projectId)!.root
const mangaProject = snapshot.projects.find((entry) => entry.root === manga)!.project!
const store = new WorkspaceStore(local, ['zh-TW'])
await store.init()
await store.update(
  { action: 'appearance', theme: 'glass', locale: 'zh-TW' },
  projects.map((project) => project.projectId)
)
await store.update(
  {
    action: 'browse',
    projectId: mangaProject.projectId,
    value: { mode: 'CARD', location: '', widths: {}, panelWidth: 420, contentMode: 'files' },
  },
  projects.map((project) => project.projectId)
)
const originals = new Map<string, Buffer>()
for (const dir of [media, manga, single]) {
  for (const name of await fs.readdir(dir)) {
    const file = path.join(dir, name)
    if ((await fs.stat(file)).isFile()) originals.set(file, await fs.readFile(file))
  }
  originals.set(folderFile(dir), await fs.readFile(folderFile(dir)))
}
for (const project of projects) {
  originals.set(
    projectFile(rootOf(project.projectId), project.projectId),
    await fs.readFile(projectFile(rootOf(project.projectId), project.projectId))
  )
}
const env = Object.fromEntries(
  Object.entries({ ...process.env, MEDIA_VIEWER_TEST_DATA: local }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env, timeout: 30000 })
const page = await app.firstWindow()
page.setDefaultTimeout(12000)
await page.evaluate('window.__name=(target)=>target')
const errors: string[] = []
page.on('pageerror', (error) => errors.push(error.message))
const button = (name: string) => page.getByRole('button', { name, exact: true })
const filter = async (name: string) => {
  await page
    .locator('.media-type-chips')
    .getByRole('button', { name: new RegExp('^' + name) })
    .click()
}
const open = async (name: string) => {
  await page
    .locator('.mixed-media-browser .media-thumbnail')
    .filter({ has: page.getByText(name, { exact: true }) })
    .click()
  await page.locator('.media-viewer-shell').waitFor()
  if ((await button('切換媒體佇列').getAttribute('aria-pressed')) !== 'true') {
    await button('切換媒體佇列').click()
  }
  await page.locator('.playback-queue-open').waitFor({ state: 'visible' })
}
try {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1400, height: 900 })
  )
  await button('開啟專案 Media feedback').first().click()
  const panelToggle = button('切換詳情內容')
  await panelToggle.waitFor()
  if ((await panelToggle.getAttribute('aria-pressed')) !== 'true') await panelToggle.click()
  await page.locator('.mixed-media-browser').waitFor()
  await page.locator('.gallery-loading').waitFor({ state: 'detached' })
  await filter('音樂')
  await open('track.wav')
  // Multiple candidates must be explicit, never an arbitrary first image.
  await button('選擇專輯封面').click()
  await page.getByRole('menuitem', { name: 'cover.png', exact: true }).click()
  await page.waitForFunction(() => {
    const img = document.querySelector('.album-cover img') as HTMLImageElement
    return !!img && img.complete && img.naturalWidth > 0
  })
  assert.equal(await page.locator('.playback-item').count(), 3)
  await button('選擇專輯封面').click()
  await page.getByRole('menuitem', { name: 'broken.png', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '無法載入專輯封面' }).waitFor()
  await button('選擇專輯封面').click()
  await page.getByRole('menuitem', { name: 'folder.png', exact: true }).click()
  await page.waitForFunction(() => {
    const img = document.querySelector('.album-cover img') as HTMLImageElement
    return !!img && img.complete && img.naturalWidth > 0
  })
  await page.screenshot({ path: path.join(root, 'cover.png') })
  await button('關閉媒體檢視器').click()
  await filter('影片')
  await open('first.mp4')
  await page.locator('video').waitFor()
  await page.evaluate(() => {
    ;(window as any).feedbackVideo = document.querySelector('video')
  })
  await button('圖片模式').click()
  assert.equal(
    await page.evaluate(() => document.querySelector('video') === (window as any).feedbackVideo),
    true
  )
  assert.equal(await page.locator('.playback-items-images .playback-item').count(), 3)
  const listFillsPanel = () =>
    page.evaluate(() => {
      const list = [...document.querySelectorAll('.playback-queue-open .playback-items')].find(
        (node) => (node as HTMLElement).offsetParent
      )!
      const panel = document.querySelector('.playback-queue-open')!
      const pad = parseFloat(getComputedStyle(panel).paddingBottom)
      return panel.getBoundingClientRect().bottom - pad - list.getBoundingClientRect().bottom
    })
  assert.ok(Math.abs(await listFillsPanel()) <= 2, 'queue list reaches the panel bottom')
  // A trial play is not queued: the folder tab lists the siblings to switch to.
  await page.getByRole('tab', { name: /目前資料夾/ }).click()
  assert.ok(Math.abs(await listFillsPanel()) <= 2, 'folder list reaches the panel bottom')
  const second = page
    .locator('.playback-item')
    .filter({ hasText: 'second.mp4' })
    .locator('button')
    .first()
  await second.click()
  await page.waitForFunction(
    () => document.querySelector('.media-viewer-shell>header strong')?.textContent === 'second.mp4'
  )
  await page.evaluate(() => {
    ;(window as any).feedbackVideo = document.querySelector('video')
  })
  await button('清單模式').click()
  await button('圖片模式').click()
  assert.equal(
    await page.evaluate(() => document.querySelector('video') === (window as any).feedbackVideo),
    true
  )
  await page.screenshot({ path: path.join(root, 'video-thumbnails.png') })
  await button('關閉媒體檢視器').click()
  await open('first.mp4')
  // The chosen queue view is remembered while the app runs.
  assert.equal(await button('圖片模式').getAttribute('aria-pressed'), 'true')
  await button('關閉媒體檢視器').click()
  await page.locator('.media-subfolders button').filter({ hasText: 'Single' }).click()
  // R-390: a folder of one track and its cover is a music album; its header shows the single cover image. The type
  // filter is still on video from above, which shows the plain list, so it goes back to all first.
  await filter('全部')
  await page.locator('.album-track').filter({ hasText: 'track' }).waitFor()
  await page.waitForFunction(() => {
    const img = document.querySelector('.media-info-template img.cell-image') as HTMLImageElement
    return !!img && img.complete && img.naturalWidth > 0
  })
  // 全部播放 makes the album the play queue and marks the track playing; the previous queue can be put back.
  await button('全部播放').click()
  await page.locator('.album-track[aria-current="true"]').waitFor()
  await page.screenshot({ path: path.join(path.resolve('.test-output'), 'shot', 'r390-album.png') })
  // The queue was empty, so there is nothing to put back; the second time it held the album.
  assert.equal(await page.locator('.album-undo').count(), 0)
  await button('隨機播放').click()
  await page.getByRole('button', { name: '復原', exact: true }).click()
  await page.locator('.album-undo').waitFor({ state: 'detached' })
  // R-521: playback stops first. The one-sample track may still be playing; when it ends after the folder became a
  // podcast its place is saved and the episode reads 已聽完 instead of 未聽.
  await button('關閉媒體檢視器').click()
  await page.locator('.media-viewer-shell').waitFor({ state: 'detached' })
  // Shown as a podcast (kept on this computer only): newest first, how far each episode was heard, no shuffle.
  await page.getByRole('switch', { name: '以 Podcast 顯示', exact: true }).click()
  await button('播放最新一集').waitFor()
  assert.equal(await button('隨機播放').count(), 0)
  await page.locator('.podcast-episode').filter({ hasText: '未聽' }).waitFor()
  await page.locator('.podcast-episode').click()
  await page.locator('.podcast-episode[aria-current="true"]').waitFor()
  await page.getByRole('switch', { name: '以 Podcast 顯示', exact: true }).click()
  await button('全部播放').waitFor()
  await button('開啟專案 Manga feedback').first().click()
  await page.locator('.project-workspace').waitFor()
  assert.equal(await page.getByLabel('展示內容', { exact: true }).count(), 1)
  for (const [file, bytes] of originals) assert.deepEqual(await fs.readFile(file), bytes)
  assert.deepEqual(errors, [])
  console.log(
    'PASS filtered music covers, explicit selection/error recovery, video thumbnail switching and stable player, manga file-mode fallback; original files and portable records unchanged. ' +
      root
  )
} catch (error) {
  await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {})
  console.error(root)
  throw error
} finally {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.removeAllListeners('close')
      win.webContents.on('will-prevent-unload', (event) => event.preventDefault())
    }
  })
  await closeApp(app)
}
