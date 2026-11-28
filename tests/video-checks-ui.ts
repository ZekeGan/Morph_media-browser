// R-447 / R-531: consolidated video failure diagnosis + video player mouse/keyboard focus checks in one Electron session.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'
import { videoFixture } from './support/video-fixture'

const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'video-checks-ui-'))
const brokenMedia = path.join(root, 'Videos')
const clipsMedia = path.join(root, 'Clips')
const local = path.join(root, 'local')
await fs.mkdir(brokenMedia, { recursive: true })
await fs.mkdir(clipsMedia, { recursive: true })
await fs.writeFile(
  path.join(brokenMedia, 'zipped.mp4'),
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(4096, 7)])
)
await fs.copyFile(await videoFixture(), path.join(clipsMedia, 'clip.mp4'))

const library = new Library(local, undefined, false)
await library.init()
await library.create(brokenMedia, {
  name: 'Broken',
  scanAll: true,
  depth: { mode: 'through', level: 1 },
})
await library.create(clipsMedia, {
  name: 'Clips',
  scanAll: true,
  depth: { mode: 'through', level: 1 },
})

const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1400, height: 900 })
const outline = (selector: string) =>
  page.evaluate((s) => getComputedStyle(document.querySelector(s)!).outlineStyle, selector)
const playing = () =>
  page.waitForFunction(() => {
    const video = document.querySelector('video')
    return !!video && !video.paused && video.currentTime > 0
  })

let passed = false
try {
  // 1. Undecodable disguised ZIP video explains cause and offers external open + reveal.
  await page.getByRole('button', { name: '開啟專案 Broken', exact: true }).first().click()
  await page.getByRole('button', { name: '切換詳情內容', exact: true }).click()
  await page.locator('.media-thumbnail').filter({ hasText: 'zipped.mp4' }).click()
  const alert = page.locator('.video-error')
  await alert.waitFor()
  await page.getByText('其實是 ZIP 壓縮檔').waitFor()
  assert.equal(await alert.getByRole('button', { name: '用系統預設播放器開啟' }).count(), 1)
  assert.equal(await alert.getByRole('button', { name: '在檔案總管顯示' }).count(), 1)
  await page.getByRole('button', { name: '關閉媒體檢視器', exact: true }).click()
  await page.locator('.global-playback').waitFor({ state: 'detached' })

  // 2. R-447: mouse-given focus stays quiet after a key; Tab restores visible focus.
  await page.getByRole('button', { name: '開啟專案 Clips', exact: true }).first().click()
  if (!(await page.locator('.folder-panel').count())) {
    await page.getByRole('button', { name: '切換詳情內容', exact: true }).click()
  }
  await page
    .locator('.mixed-media-browser .media-thumbnail')
    .filter({ has: page.getByText('clip.mp4', { exact: true }) })
    .click()
  await page.locator('.media-viewer-shell').waitFor()
  await playing()
  const stage = page.locator('.custom-video-stage')
  const box = (await stage.boundingBox())!
  const timeline = page.locator('.player-timeline input').first()
  await timeline.click()
  assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'INPUT')
  await page.keyboard.press('Shift')
  await page.evaluate(() => void document.querySelector('video')!.play())
  await playing()
  assert.equal(await outline('.player-timeline input'), 'none', 'no ring on the clicked timeline')
  await page.mouse.move(box.x + 5, box.y + 5)
  await page
    .locator('.video-controls[data-visible="false"]')
    .waitFor({ state: 'attached', timeout: 6000 })
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3)
  await page.waitForFunction(() => document.activeElement?.classList.contains('custom-video-stage'))
  await page.keyboard.press('Space')
  assert.equal(await outline('.custom-video-stage'), 'none', 'no frame around the clicked picture')
  await page.screenshot({ path: path.join(base, 'shot', 'r447-player-focus.png') })
  await stage.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.input), 'keyboard')
  await page.waitForFunction(() => document.activeElement?.classList.contains('custom-video-stage'))
  assert.notEqual(await outline('.custom-video-stage'), 'none', 'Tab shows the focus')
  assert.deepEqual(errors, [])
  passed = true
  console.log('PASS video checks (disguised archive failure + mouse/keyboard focus). ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
