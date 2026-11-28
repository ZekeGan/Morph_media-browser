import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'

// R-372, R-373, R-374: reading on in the manga reader. The wheel turns the page (Ctrl + wheel zooms), Space and the
// Page keys finish a page larger than the window before turning it, and in two-page mode a page wider than tall
// gets the screen to itself.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'reader-read-on-ui-'))
const comic = path.join(root, 'Book')
const local = path.join(root, 'local')
await fs.mkdir(comic)
const exec = promisify(execFile)
// Page 4 is a spread drawn as one picture.
for (let i = 1; i <= 8; i++) {
  await exec(
    'ffmpeg',
    [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      `color=c=${i % 2 ? '#526c85' : '#ac997f'}:s=${i === 4 ? '320x160' : '100x160'}`,
      '-frames:v',
      '1',
      path.join(comic, String(i).padStart(3, '0') + '.png'),
    ],
    { windowsHide: true }
  )
}
const library = new Library(local, undefined, false)
await library.init()
await library.create(comic, {
  name: 'Read on test',
  depth: { mode: 'through', level: 1 },
  scanAll: true,
})
const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1100, height: 800 })
const reader = () => page.getByRole('dialog', { name: '漫畫閱讀器', exact: true })
const waitPages = (value: string) =>
  page.waitForFunction(
    (pages) =>
      document.querySelector('.reader-frame-layer.is-active')?.getAttribute('data-pages') === pages,
    value
  )
const shown = () =>
  page.evaluate(() =>
    document.querySelector('.reader-frame-layer.is-active')?.getAttribute('data-pages')
  )
const scrollTop = () =>
  reader()
    .locator('.reader-stage')
    .evaluate((element) => element.scrollTop)
let passed = false
try {
  await page.getByRole('button', { name: '開啟專案 Read on test', exact: true }).first().click()
  await page.getByRole('button', { name: '切換詳情內容', exact: true }).click()
  await page.locator('.manga-gallery .media-thumbnail').first().click()
  await reader().waitFor()
  await waitPages('1')
  await reader().locator('.reader-stage').hover()
  // The wheel turns the page; a second notch right after the first does not turn another.
  await page.mouse.wheel(0, 100)
  await page.waitForTimeout(40)
  await page.mouse.wheel(0, 100)
  await waitPages('2')
  await page.waitForTimeout(400)
  assert.equal(await shown(), '2', 'two quick notches turn one page')
  await page.mouse.wheel(0, -100)
  await waitPages('1')
  await page.waitForTimeout(300)
  // Ctrl + wheel zooms.
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -400)
  await page.keyboard.up('Control')
  await page.waitForFunction(
    () =>
      document.querySelector('.is-active .reader-spread')!.getBoundingClientRect().height >
      document.querySelector('.reader-stage')!.getBoundingClientRect().height * 1.5
  )
  assert.equal(await shown(), '1')
  // The wheel now moves the enlarged page, and reaching its end does not turn it in the same spin.
  await page.mouse.wheel(0, 5000)
  await page.waitForFunction(() => document.querySelector('.reader-stage')!.scrollTop > 0)
  await page.mouse.wheel(0, 100)
  await page.waitForTimeout(100)
  assert.equal(await shown(), '1', 'the spin that reached the end does not turn the page')
  await reader()
    .locator('.reader-stage')
    .evaluate((element) => (element.scrollTop = 0))
  // Space reads the rest of the page first, then turns it; the new page starts at its top.
  await page.keyboard.press(' ')
  assert.ok((await scrollTop()) > 0, 'Space moves down the page')
  assert.equal(await shown(), '1')
  for (let i = 0; i < 12 && (await shown()) === '1'; i++) {
    await page.keyboard.press('PageDown')
    await page.waitForTimeout(60)
  }
  await waitPages('2')
  assert.equal(await scrollTop(), 0)
  await page.keyboard.press('r')
  await page.keyboard.press('Shift+ ')
  await waitPages('1')
  // Two-page mode: the wide page 4 stands alone, and so does page 3 before it.
  await page.keyboard.press('d')
  await waitPages('1–2')
  await page.keyboard.press('ArrowDown')
  await waitPages('3')
  await page.keyboard.press(' ')
  await waitPages('4')
  // Let the page turn finish sliding.
  await page.waitForTimeout(400)
  await page.screenshot({ path: path.join(base, 'shot', 'r374-reader-wide-page.png') })
  await page.keyboard.press(' ')
  await waitPages('5–6')
  await page.keyboard.press('PageUp')
  await waitPages('4')
  await page.keyboard.press('ArrowUp')
  await waitPages('3')
  // R-558: in non-immersive mode, clicking the middle third keeps the toolbar visible and does not turn the page.
  const stage = (await reader().locator('.reader-stage').boundingBox())!
  await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height / 2)
  await page.locator('.reader-toolbar').waitFor()
  assert.equal(await shown(), '3')
  // R-392: dragging part of the way shows the page beside it coming in; letting go short puts both back.
  const middle = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 }
  await page.mouse.move(middle.x, middle.y)
  await page.mouse.down()
  await page.mouse.move(middle.x - 40, middle.y, { steps: 4 })
  await page.mouse.move(middle.x - 80, middle.y, { steps: 4 })
  await page.waitForTimeout(100)
  const peek = page.locator('.reader-peek-right')
  assert.equal(await peek.evaluate((node) => getComputedStyle(node).visibility), 'visible')
  assert.ok((await peek.locator('img').count()) >= 1, 'the next page is drawn beside')
  // R-392: every page has the whole window; the one beside waits exactly one window away and moves with the drag.
  const slot = await peek.evaluate((node) => node.getBoundingClientRect().left)
  const current = await page
    .locator('.reader-frame-layer.is-active')
    .evaluate((node) => node.getBoundingClientRect().left)
  assert.ok(Math.abs(slot - current - stage.width) < 2, `one window apart: ${current} → ${slot}`)
  assert.ok(current < stage.x - 40, 'the strip has moved with the pointer: ' + current)
  await page.mouse.move(middle.x - 300, middle.y, { steps: 6 })
  await page.screenshot({ path: path.join(base, 'shot', 'r392-drag-peek.png') })
  await page.mouse.move(middle.x - 80, middle.y, { steps: 6 })
  // Held for a moment, so the release is not a quick flick (which turns the page).
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.waitForTimeout(400)
  assert.equal(await peek.evaluate((node) => getComputedStyle(node).visibility), 'hidden')
  assert.equal(await shown(), '3', 'a short drag does not turn')
  // R-378 / R-557: page-turn transition lives inside the Reading Settings popover (or toggled via 'a').
  const settingsBtn = reader().getByRole('button', { name: '閱讀設定', exact: true })
  const transition = page.getByRole('button', { name: /^翻頁過渡/ })
  await settingsBtn.click()
  assert.equal(await transition.getAttribute('aria-pressed'), 'true')
  await settingsBtn.click()
  const entering = () =>
    page.evaluate(() =>
      /enter-/.test(document.querySelector('.reader-frame-layer.is-active')?.className ?? '')
    )
  await page.keyboard.press('a')
  await settingsBtn.click()
  assert.equal(await transition.getAttribute('aria-pressed'), 'false')
  await settingsBtn.click()
  // R-392: with the transition off a drag does not move the page or show the one beside.
  await page.mouse.move(middle.x, middle.y)
  await page.mouse.down()
  await page.mouse.move(middle.x - 120, middle.y, { steps: 6 })
  assert.equal(
    await page
      .locator('.reader-frame-layer.is-active')
      .evaluate((node) => (node as HTMLElement).style.transform),
    ''
  )
  assert.equal(
    await page.locator('.reader-peek-right').evaluate((node) => getComputedStyle(node).visibility),
    'hidden'
  )
  await page.mouse.move(middle.x, middle.y, { steps: 3 })
  await page.waitForTimeout(300)
  await page.mouse.up()
  await reader().locator('.reader-stage').focus()
  await page.keyboard.press(' ')
  await waitPages('4')
  assert.equal(await entering(), false, 'no slide with the transition off')
  await settingsBtn.click()
  await transition.click()
  assert.equal(await transition.getAttribute('aria-pressed'), 'true')
  await settingsBtn.click()
  await reader().locator('.reader-stage').focus()
  await page.keyboard.press('PageUp')
  await waitPages('3')
  assert.equal(await entering(), true, 'the slide is back')
  // R-376: in immersive reading Tab on the page does not walk into the hidden tool rail.
  await page.keyboard.press('t')
  await page.waitForFunction(() => !!document.fullscreenElement)
  await page.waitForFunction(() => document.activeElement?.matches('.reader-stage'))
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  await page.waitForTimeout(150)
  assert.ok(
    await page.evaluate(() => document.activeElement?.matches('.reader-stage')),
    'Tab leaves the focus on the page'
  )
  assert.equal(await page.locator('.reader-rail:has(:focus-visible)').count(), 0)
  await page.keyboard.press('t')
  await page.waitForFunction(() => !document.fullscreenElement)
  // Outside immersive reading Tab moves through the toolbar as before.
  await page.waitForFunction(() => document.activeElement?.matches('.reader-stage'))
  // The toolbar comes back with the window leaving fullscreen; Tab goes into it once it is there.
  await page.locator('.reader-toolbar').waitFor()
  await page.keyboard.press('Tab')
  await page.waitForFunction(() => !document.activeElement?.matches('.reader-stage'))
  assert.deepEqual(errors, [])
  passed = true
  console.log('PASS wheel turns and zooms, keys read on, wide pages stand alone. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
