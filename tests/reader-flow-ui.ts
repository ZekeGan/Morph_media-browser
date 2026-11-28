// R-255 / R-275 / R-415 / R-426 / R-430 / R-436 / R-531:
// Consolidated reader next-book, carry-over settings, CBZ next-volume, and CBZ immersive tests in one Electron session.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { createServer } from 'vite'

import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'
import { tinyPng, zipFixture } from './support/archive-fixture'

const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'reader-flow-'))
const local = path.join(root, 'local')
const exec = promisify(execFile)

const makeShelf = async (name: string) => {
  const shelf = path.join(root, name)
  for (const [book, color] of [
    ['Book 1', '#526c85'],
    ['Book 2', '#ac997f'],
  ]) {
    const folder = path.join(shelf, book)
    await fs.mkdir(folder, { recursive: true })
    const first = path.join(folder, '001.png')
    await exec(
      'ffmpeg',
      ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=100x160`, '-frames:v', '1', first],
      { windowsHide: true }
    )
    for (let i = 2; i <= 6; i++) {
      await fs.copyFile(first, path.join(folder, String(i).padStart(3, '0') + '.png'))
    }
  }
  return shelf
}

const cbzPages = (count: number) =>
  zipFixture(
    Array.from({ length: count }, (_, i) => ({
      name: String(i + 1).padStart(3, '0') + '.png',
      bytes: tinyPng,
    }))
  )

const makeCbzSeries = async (name: string) => {
  const media = path.join(root, name)
  await fs.mkdir(media, { recursive: true })
  await fs.writeFile(path.join(media, 'vol1.cbz'), cbzPages(2))
  await fs.writeFile(path.join(media, 'vol2.cbz'), cbzPages(5))
  return media
}

const carryShelf = await makeShelf('CarryShelf')
const nextShelf = await makeShelf('NextShelf')
const cbzNextMedia = await makeCbzSeries('CbzNextSeries')
const cbzImmersiveMedia = await makeCbzSeries('CbzImmersiveSeries')

const library = new Library(local, undefined, false)
await library.init()
for (const [dir, name] of [
  [carryShelf, 'Carry test'],
  [nextShelf, 'Next test'],
  [cbzNextMedia, 'Cbz next test'],
  [cbzImmersiveMedia, 'Cbz immersive test'],
]) {
  await library.create(dir, { name, depth: { mode: 'through', level: 1 }, scanAll: true })
}

// READER_DEV_RENDERER=1 runs the window from the Vite dev server (React StrictMode).
const server = process.env.READER_DEV_RENDERER
  ? await createServer({
      configFile: false,
      root: path.resolve('src'),
      esbuild: { jsx: 'automatic' },
      define: {
        __APP_VERSION__: JSON.stringify(
          JSON.parse(await fs.readFile('package.json', 'utf8')).version
        ),
      },
      server: { host: '127.0.0.1', port: 0 },
    })
  : undefined
if (server) {
  await server.listen()
  process.env.ELECTRON_RENDERER_URL = server.resolvedUrls!.local[0]
}

const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1400, height: 900 })
const reader = () => page.getByRole('dialog', { name: '漫畫閱讀器', exact: true })
const shownPages = () =>
  page.evaluate(
    () => document.querySelector('.reader-frame-layer.is-active')?.getAttribute('data-pages') ?? ''
  )
const shownInfo = () =>
  page.evaluate(() => document.querySelector('.reader-info strong')?.textContent ?? '')
const waitPages = (expected: string) =>
  page.waitForFunction(
    (value) =>
      document.querySelector('.reader-frame-layer.is-active')?.getAttribute('data-pages') === value,
    expected
  )
const fullscreen = (value: boolean) =>
  page.waitForFunction((expected) => !!document.fullscreenElement === expected, value)
const openProject = async (name: string) => {
  await page
    .getByRole('button', { name: '開啟專案 ' + name, exact: true })
    .first()
    .click()
}
const ensurePanelOpen = async () => {
  if (!(await page.locator('.folder-panel').count())) {
    await page.getByRole('button', { name: '切換詳情內容', exact: true }).click()
  }
}

let passed = false
try {
  // 1. R-426 / R-430: finished spread books and settings carried to the next book.
  await openProject('Carry test')
  await page.locator('.folder-card', { hasText: 'Book 1' }).first().click()
  await page.locator('.folder-panel-header strong').getByText('Book 1', { exact: true }).waitFor()
  await page.locator('.manga-gallery .media-thumbnail').first().click()
  await reader().waitFor()
  await reader().getByRole('button', { name: '雙頁', exact: true }).click()
  await waitPages('1–2')
  await reader().getByRole('button', { name: '閱讀設定', exact: true }).click()
  await page.getByRole('button', { name: '由右至左', exact: true }).click()
  await page.getByRole('button', { name: '由左至右', exact: true }).waitFor()
  await reader().getByRole('button', { name: '閱讀設定', exact: true }).click()
  for (const pages of ['3–4', '5–6']) {
    await page.keyboard.press('ArrowRight')
    await waitPages(pages)
  }
  await page.keyboard.press('ArrowRight')
  await reader().locator('.reader-end').waitFor()
  assert.match((await reader().locator('.reader-end').textContent()) ?? '', /下一本：Book 2/)
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(
    () => document.querySelector('.folder-panel-header strong')?.textContent?.trim() === 'Book 2'
  )
  await waitPages('1–2')
  await reader().getByRole('button', { name: '閱讀設定', exact: true }).click()
  await page.getByRole('button', { name: '由左至右', exact: true }).waitFor()
  await reader().getByRole('button', { name: '閱讀設定', exact: true }).click()
  await page.keyboard.press('ArrowRight')
  await waitPages('3–4')
  await page.keyboard.press('Escape')
  await reader().waitFor({ state: 'detached' })
  await page.getByText('讀到 3 / 6 頁').first().waitFor()
  await page.locator('.folder-card', { hasText: 'Book 2' }).first().click()
  await page.locator('.folder-card', { hasText: 'Book 1' }).first().click()
  await page.getByText('讀到 6 / 6 頁').first().waitFor()
  await page.locator('.manga-gallery .media-thumbnail').first().click()
  await reader().waitFor()
  await waitPages('1–2')
  assert.equal(await shownPages(), '1–2', 'a finished book opens from the beginning')
  await page.keyboard.press('Escape')
  await reader().waitFor({ state: 'detached' })
  await page.locator('.folder-card', { hasText: 'Book 2' }).first().click()
  await page.getByText('讀到 3 / 6 頁').first().waitFor()

  // 2. R-255 / R-275: next book opens from the last page and keeps immersive reading.
  await openProject('Next test')
  await page.locator('.folder-card', { hasText: 'Book 1' }).first().click()
  await page.locator('.folder-panel-header strong').getByText('Book 1', { exact: true }).waitFor()
  await page.locator('.manga-gallery .media-thumbnail').first().click()
  await reader().waitFor()
  await page.keyboard.press('F11')
  await fullscreen(true)
  for (let i = 0; i < 12 && !(await reader().locator('.reader-end').count()); i++) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(250)
  }
  await reader().locator('.reader-end').waitFor()
  assert.match((await reader().locator('.reader-end').textContent()) ?? '', /下一本：Book 2/)
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(() =>
    /^1(–2)?$/.test(
      document.querySelector('.reader-frame-layer.is-active')?.getAttribute('data-pages') ?? ''
    )
  )
  await page.waitForTimeout(500)
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
  await page.keyboard.press('Escape')
  await fullscreen(false)
  await page.keyboard.press('Escape')
  await reader().waitFor({ state: 'detached' })

  // 3. R-415 / R-430: comic archive continues with the next archive and carries settings.
  await openProject('Cbz next test')
  await ensurePanelOpen()
  await page.getByRole('button', { name: '開始閱讀 vol1.cbz', exact: true }).click()
  await reader().waitFor()
  await page.waitForFunction(() =>
    /\/ 2 頁/.test(document.querySelector('.reader-info strong')?.textContent ?? '')
  )
  await reader().getByRole('button', { name: '雙頁', exact: true }).click()
  for (let i = 0; i < 6 && !(await reader().locator('.reader-end').count()); i++) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(250)
  }
  await reader().locator('.reader-end').waitFor()
  assert.match((await reader().locator('.reader-end').textContent()) ?? '', /下一本：vol2\.cbz/)
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(() =>
    /\/ 5 頁/.test(document.querySelector('.reader-info strong')?.textContent ?? '')
  )
  assert.match(await shownInfo(), /第 1–2 \/ 5 頁/)
  for (let i = 0; i < 8 && !(await reader().locator('.reader-end').count()); i++) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(250)
  }
  await reader().locator('.reader-end').waitFor()
  assert.doesNotMatch((await reader().locator('.reader-end').textContent()) ?? '', /下一本/)
  await reader().getByRole('button', { name: '退出閱讀器', exact: true }).click()
  await reader().waitFor({ state: 'detached' })

  // 4. R-436: next comic archive keeps fullscreen and immersive reading.
  await openProject('Cbz immersive test')
  await ensurePanelOpen()
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
  assert.match(
    (await page.locator('.reader-frame-layer.is-active').getAttribute('data-pages')) ?? '',
    /^1(–2)?$/
  )
  assert.equal(await reader().locator('.reader-end').count(), 0)
  await page.keyboard.press('Escape')
  await fullscreen(false)

  assert.deepEqual(errors, [])
  passed = true
  console.log('PASS reader flow (carry, next book, CBZ next, CBZ immersive). ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  await server?.close()
  if (passed) await removeTestRoot(root)
}
