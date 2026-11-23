import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'
import { videoFixture } from './support/video-fixture'

// R-447: a focus given by the mouse stays quiet once a key is pressed. The timeline clicked keeps no ring and the
// controls still fade while it holds the focus; the picture clicked and Space pressed draws no frame around it.
// Moving with Tab shows the focus again.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'player-focus-ui-')),
  media = path.join(root, 'Clips'),
  local = path.join(root, 'local')
await fs.mkdir(media, { recursive: true })
await fs.copyFile(await videoFixture(), path.join(media, 'clip.mp4'))
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, { name: 'Clips', scanAll: true, depth: { mode: 'through', level: 1 } })

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
  await page.getByRole('button', { name: '開啟專案 Clips', exact: true }).first().click()
  await page
    .locator('.mixed-media-browser .media-thumbnail')
    .filter({ has: page.getByText('clip.mp4', { exact: true }) })
    .click()
  await page.locator('.media-viewer-shell').waitFor()
  await playing()
  // The timeline clicked with the mouse holds the focus; a key pressed then draws no ring on it, and the controls
  // still fade while the video plays.
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
  // The picture clicked, then Space: no frame around it.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3)
  await page.waitForFunction(() => document.activeElement?.classList.contains('custom-video-stage'))
  await page.keyboard.press('Space')
  assert.equal(await outline('.custom-video-stage'), 'none', 'no frame around the clicked picture')
  await page.screenshot({ path: path.join(base, 'shot', 'r447-player-focus.png') })
  // Tab moves with the keyboard: the focus is shown again.
  await stage.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.input), 'keyboard')
  await page.waitForFunction(() => document.activeElement?.classList.contains('custom-video-stage'))
  assert.notEqual(await outline('.custom-video-stage'), 'none', 'Tab shows the focus')
  assert.deepEqual(errors, [])
  passed = true
  console.log('PASS mouse-given focus stays quiet after a key; Tab shows it. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
