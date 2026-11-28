import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Library } from '../electron/library'
import { closeApp, launchApp, reportFailure } from './support/app'
import { tinyPng, zipFixture } from './support/archive-fixture'

// R-436: going on from one comic archive (CBZ) to the next keeps the window in fullscreen and immersive reading,
// as moving from one image folder to the next does (R-275).
const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'reader-cbz-immersive-'))
const media = path.join(root, 'Series')
const local = path.join(root, 'local')
await fs.mkdir(media)
const pages = (count: number) =>
  zipFixture(
    Array.from({ length: count }, (_, i) => ({
      name: String(i + 1).padStart(3, '0') + '.png',
      bytes: tinyPng,
    }))
  )
await fs.writeFile(path.join(media, 'vol1.cbz'), pages(2))
await fs.writeFile(path.join(media, 'vol2.cbz'), pages(5))
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Cbz immersive test',
  depth: { mode: 'through', level: 1 },
  scanAll: true,
})
const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1100, height: 800 })
const reader = () => page.getByRole('dialog', { name: '漫畫閱讀器', exact: true })
const fullscreen = (value: boolean) =>
  page.waitForFunction((expected) => !!document.fullscreenElement === expected, value)
try {
  await page
    .getByRole('button', { name: '開啟專案 Cbz immersive test', exact: true })
    .first()
    .click()
  await page.getByRole('button', { name: '切換詳情內容', exact: true }).click()
  await page.getByRole('button', { name: '開始閱讀 vol1.cbz', exact: true }).click()
  await reader().waitFor()
  await page.waitForFunction(() =>
    /\/ 2 頁/.test(document.querySelector('.reader-info strong')?.textContent ?? '')
  )
  await page.keyboard.press('F11')
  await fullscreen(true)
  for (let i = 0; i < 6 && !(await reader().locator('.reader-end').count()); i++) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(250)
  }
  await reader().locator('.reader-end').waitFor()
  await page.keyboard.press('ArrowLeft')
  await page.locator('.reader-frame-layer.is-active[data-pages]').waitFor()
  await page.waitForTimeout(800)
  assert.equal(
    await page.evaluate(() => !!document.fullscreenElement),
    true,
    'still fullscreen after moving on'
  )
  assert.equal(
    await reader().evaluate((node) => node.classList.contains('reader-focused')),
    true,
    'still immersive after moving on'
  )
  // The second archive (five pages) is the one being read, from its first page.
  assert.match(
    (await page.locator('.reader-frame-layer.is-active').getAttribute('data-pages')) ?? '',
    /^1(–2)?$/
  )
  assert.equal(await reader().locator('.reader-end').count(), 0)
  await page.keyboard.press('Escape')
  await fullscreen(false)
  assert.deepEqual(errors, [])
  console.log('PASS next comic archive keeps fullscreen and immersive reading. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
}
