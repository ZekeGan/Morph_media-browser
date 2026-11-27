import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'

// R-381: application settings keep the order external sources are read in. It follows the interface language until
// the user takes it over, moves with the grip (drag or Alt+arrows), is kept on this computer, and goes back to "follow".
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'source-language-ui-'))
const media = path.join(root, 'Library')
const local = path.join(root, 'local')
await fs.mkdir(path.join(media, 'Film'), { recursive: true })
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Language test',
  depth: { mode: 'through', level: 2 },
  scanAll: true,
})
const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1300, height: 860 })
let passed = false
try {
  await page.locator('.titlebar').getByRole('button', { name: '應用程式設定', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '應用程式設定', exact: true })
  const section = settings.getByRole('region', { name: '外部來源語言', exact: true })
  const follow = section.getByRole('checkbox', { name: '跟著介面語言', exact: true })
  await follow.waitFor()
  assert.equal(await follow.isChecked(), true)
  assert.equal(await section.getByRole('listitem').count(), 0)
  const saved = () =>
    page.evaluate(async () => (await window.desktop.workspace()).prefs.sourceLanguages ?? null)
  assert.equal(await saved(), null)
  // Taking it over starts from the interface language (the test runs in 繁體中文) and lists all five.
  await follow.click()
  await section.getByRole('listitem').first().waitFor()
  assert.equal(await section.getByRole('listitem').count(), 5)
  assert.deepEqual(await saved(), ['zh-TW', 'ja', 'zh-CN', 'en', 'es'])
  // Moved with the keyboard (Alt+↓ on the grip); the drag itself shares the sort menu's behaviour.
  const grip = section.getByRole('button', { name: '移動語言順序 繁體中文', exact: true })
  await grip.focus()
  await page.keyboard.press('Alt+ArrowDown')
  await page.waitForFunction(
    async () => (await window.desktop.workspace()).prefs.sourceLanguages?.[0] === 'ja'
  )
  assert.deepEqual(await saved(), ['ja', 'zh-TW', 'zh-CN', 'en', 'es'])
  // The grip keeps keyboard focus while the move is saved, so it can be moved again right away.
  assert.equal(await grip.evaluate((node) => node === document.activeElement), true)
  await page.keyboard.press('Alt+ArrowDown')
  await page.waitForFunction(
    async () => (await window.desktop.workspace()).prefs.sourceLanguages?.[2] === 'zh-TW'
  )
  assert.equal(await grip.evaluate((node) => node === document.activeElement), true)
  await page.keyboard.press('Alt+ArrowUp')
  await page.waitForFunction(
    async () => (await window.desktop.workspace()).prefs.sourceLanguages?.[1] === 'zh-TW'
  )
  assert.match(
    (await section.getByRole('listitem').first().innerText()).replace(/\s+/g, ' '),
    /1 日本語/
  )
  // R-480: while dragging, a line on the row's top or bottom edge shows where the row will land, and no line shows
  // where dropping changes nothing; dropping puts the row there.
  const rows = section.getByRole('listitem')
  const fire = (index: number, type: string, half: 'top' | 'bottom' | 'none') =>
    rows.nth(index).evaluate(
      (el, [type, half]) => {
        const box = el.getBoundingClientRect()
        const data = new DataTransfer()
        el.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
            clientY: half === 'top' ? box.top + 2 : box.bottom - 2,
          })
        )
      },
      [type, half]
    )
  const marks = () =>
    rows.evaluateAll((list) => list.map((el) => el.className.replace(/sort-key ?/, '')))
  await rows
    .nth(0)
    .getByRole('button')
    .first()
    .dispatchEvent('dragstart', {
      dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
    })
  await fire(3, 'dragover', 'bottom')
  assert.deepEqual(await marks(), ['dragging', '', '', 'drop-after', ''])
  await fire(3, 'dragover', 'top')
  assert.deepEqual(await marks(), ['dragging', '', '', 'drop-before', ''])
  await page.screenshot({ path: path.join(base, 'shot', 'r480-drop-line.png') })
  await fire(1, 'dragover', 'top')
  assert.deepEqual(
    await marks(),
    ['dragging', '', '', '', ''],
    'no line where nothing would change'
  )
  await fire(3, 'dragover', 'bottom')
  await fire(3, 'drop', 'bottom')
  await page.waitForFunction(
    async () => (await window.desktop.workspace()).prefs.sourceLanguages?.[3] === 'ja'
  )
  assert.deepEqual(await saved(), ['zh-TW', 'zh-CN', 'en', 'ja', 'es'])
  assert.deepEqual(await marks(), ['', '', '', '', ''])
  await page.screenshot({ path: path.join(base, 'shot', 'r381-source-languages.png') })
  await follow.click()
  await page.waitForFunction(async () => !(await window.desktop.workspace()).prefs.sourceLanguages)
  assert.equal(await section.getByRole('listitem').count(), 0)
  assert.deepEqual(errors, [])
  passed = true
  console.log('PASS source language order: follow, take over, move, back to follow. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
