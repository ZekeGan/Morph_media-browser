// R-426 / R-430: a two-page book read to its last spread counts as finished (the list says the last page and the book
// opens from the start again), and the next book without settings of its own takes the previous book's direction and
// two-page mode, and starts reading once its pictures are listed.
import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Library } from '../electron/library'
import { closeApp, launchApp, reportFailure } from './support/app'

const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'reader-carry-')),
  shelf = path.join(root, 'Shelf'),
  local = path.join(root, 'local')
const exec = promisify(execFile)
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
  for (let i = 2; i <= 6; i++)
    await fs.copyFile(first, path.join(folder, String(i).padStart(3, '0') + '.png'))
}
const library = new Library(local, undefined, false)
await library.init()
await library.create(shelf, {
  name: 'Carry test',
  depth: { mode: 'through', level: 1 },
  scanAll: true,
})
const errors: string[] = []
const { app, page } = await launchApp(local, errors)
const reader = () => page.getByRole('dialog', { name: '漫畫閱讀器', exact: true })
const source = () => page.locator('.media-viewer-source').first()
const shown = () =>
  page.evaluate(
    () => document.querySelector('.reader-frame-layer.is-active')?.getAttribute('data-pages') ?? ''
  )
const waitPages = (expected: string) =>
  page.waitForFunction(
    (value) =>
      document.querySelector('.reader-frame-layer.is-active')?.getAttribute('data-pages') === value,
    expected
  )
try {
  await page.getByRole('button', { name: '開啟專案 Carry test', exact: true }).first().click()
  await page.locator('.folder-card', { hasText: 'Book 1' }).first().click()
  await page.locator('.manga-gallery .media-thumbnail').first().click()
  await reader().waitFor()
  assert.equal(await source().textContent(), 'Book 1')
  // Two pages at a time, left to right (the right arrow reads on).
  await reader().getByRole('button', { name: '雙頁', exact: true }).click()
  await waitPages('1–2')
  await reader().getByRole('button', { name: '由右至左', exact: true }).click()
  await reader().getByRole('button', { name: '由左至右', exact: true }).waitFor()
  for (const pages of ['3–4', '5–6']) {
    await page.keyboard.press('ArrowRight')
    await waitPages(pages)
  }
  await page.keyboard.press('ArrowRight')
  await reader().locator('.reader-end').waitFor()
  assert.match((await reader().locator('.reader-end').textContent()) ?? '', /下一本：Book 2/)
  await page.keyboard.press('ArrowRight')
  // R-430: Book 2 has no settings of its own yet; it opens reading with two pages, left to right.
  await page.waitForFunction(
    () => document.querySelector('.media-viewer-source')?.textContent === 'Book 2'
  )
  await waitPages('1–2')
  await reader().getByRole('button', { name: '由左至右', exact: true }).waitFor()
  await page.keyboard.press('ArrowRight')
  await waitPages('3–4')
  await page.keyboard.press('Escape')
  await reader().waitFor({ state: 'detached' })
  await page.getByText('讀到 3 / 6 頁').first().waitFor()
  // The list still highlights Book 1; a click on it would clear the preview, so go through Book 2 first.
  await page.locator('.folder-card', { hasText: 'Book 2' }).first().click()
  // R-430: moving on wrote Book 2's settings (it was read), Book 1 keeps its own.
  await page.locator('.folder-card', { hasText: 'Book 1' }).first().click()
  // R-426: Book 1 was left on its last spread: the list says the last page and the reader starts from the start.
  await page.getByText('讀到 6 / 6 頁').first().waitFor()
  await page.locator('.manga-gallery .media-thumbnail').first().click()
  await reader().waitFor()
  assert.equal(await source().textContent(), 'Book 1')
  await waitPages('1–2')
  assert.equal(await shown(), '1–2', 'a finished book opens from the beginning')
  await page.keyboard.press('Escape')
  await reader().waitFor({ state: 'detached' })
  await page.locator('.folder-card', { hasText: 'Book 2' }).first().click()
  await page.getByText('讀到 3 / 6 頁').first().waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS finished spread books and settings carried to the next book. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
}
