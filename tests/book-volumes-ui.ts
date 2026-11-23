import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Library } from '../electron/library'
import { readFolder } from '../electron/files'
import { rarFixture, tinyPng, zipFixture } from './support/archive-fixture'
import { closeApp, launchApp, reportFailure } from './support/app'

// R-407: the comic archives of a book folder are a list in file name order (numbers as numbers) under the folder's
// details; they share the folder's reading settings, each remembers its own page, and RAR (CBR) archives open too.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'book-volumes-')),
  media = path.join(root, 'Series'),
  local = path.join(root, 'local')
await fs.mkdir(media)
const pages = (count: number) =>
  zipFixture(
    Array.from({ length: count }, (_, i) => ({
      name: String(i + 1).padStart(3, '0') + '.png',
      bytes: tinyPng,
    }))
  )
await fs.writeFile(path.join(media, 'vol10.cbz'), pages(3))
await fs.writeFile(path.join(media, 'vol2.cbz'), pages(8))
await fs.writeFile(
  path.join(media, 'vol3.cbr'),
  rarFixture(Array.from({ length: 4 }, (_, i) => ({ name: `${i + 1}.png`, bytes: tinyPng })))
)
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Volumes test',
  depth: { mode: 'through', level: 1 },
  scanAll: true,
})
const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1100, height: 800 })
const reader = () => page.getByRole('dialog', { name: '漫畫閱讀器', exact: true })
const shown = () =>
  page.evaluate(() => document.querySelector('.reader-info strong')?.textContent ?? '')
const shelf = () => page.locator('.book-shelf li')
try {
  await page.getByRole('button', { name: '開啟專案 Volumes test', exact: true }).first().click()
  await page.locator('.book-shelf').waitFor()
  // A list, not tiles; numbers count as numbers; CBR is listed.
  assert.equal(await page.locator('.book-volumes').count(), 0)
  assert.deepEqual(await shelf().locator('.book-shelf-name span').allInnerTexts(), [
    'vol2',
    'vol3',
    'vol10',
  ])
  assert.equal(
    await page.evaluate(() =>
      document
        .querySelector('.book-shelf')!
        .parentElement!.firstElementChild!.classList.contains('book-shelf')
    ),
    false,
    'the list is under the details'
  )
  await page.screenshot({ path: path.join(base, 'shot', 'r407-volume-list.png') })
  // Read vol2 to the fourth page, with two-page spreads switched on, and leave.
  await page.getByRole('button', { name: '開始閱讀 vol2.cbz', exact: true }).click()
  await reader().waitFor()
  await page.waitForFunction(() =>
    /\/ 8 頁/.test(document.querySelector('.reader-info strong')?.textContent ?? '')
  )
  await page.keyboard.press('d')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(() =>
    /第 [3-5]/.test(document.querySelector('.reader-info strong')?.textContent ?? '')
  )
  const left = await shown()
  await page.keyboard.press('Escape')
  await reader().waitFor({ state: 'detached' })
  // R-448: reading places are saved in the background (the app is not marked busy): wait for the record itself.
  let saved = (await readFolder(media)).details
  for (let i = 0; i < 50 && !(saved?.reading?.spread && saved?.volumes?.['vol2.cbz']); i++) {
    await page.waitForTimeout(100)
    saved = (await readFolder(media)).details
  }
  assert.equal(saved?.reading?.spread, true)
  assert.ok((saved?.volumes?.['vol2.cbz']?.page ?? 0) >= 2, JSON.stringify(saved?.volumes))
  assert.equal(saved?.volumes?.['vol2.cbz']?.total, 8)
  assert.equal(saved?.volumes?.['vol10.cbz'], undefined)
  // The list says where it was left; another archive shares the settings but starts at its own first page.
  await shelf()
    .filter({ hasText: 'vol2' })
    .getByText(/^讀到 \d+ \/ 8 頁$/)
    .waitFor()
  await page.getByRole('button', { name: '繼續閱讀 vol2.cbz', exact: true }).waitFor()
  await page.getByRole('button', { name: '開始閱讀 vol10.cbz', exact: true }).click()
  await reader().waitFor()
  await page.waitForFunction(() =>
    /\/ 3 頁/.test(document.querySelector('.reader-info strong')?.textContent ?? '')
  )
  assert.equal(
    await reader().getByRole('button', { name: '雙頁', exact: true }).getAttribute('aria-pressed'),
    'true'
  )
  assert.match(await shown(), /第 1/)
  await page.keyboard.press('Escape')
  await reader().waitFor({ state: 'detached' })
  // vol2 comes back where it was left.
  await page.getByRole('button', { name: '繼續閱讀 vol2.cbz', exact: true }).click()
  await reader().waitFor()
  await page.getByText(/從第 \d+ 頁繼續/).waitFor()
  await page.waitForFunction(
    (expected) => document.querySelector('.reader-info strong')?.textContent === expected,
    left
  )
  await page.keyboard.press('Escape')
  await reader().waitFor({ state: 'detached' })
  // A RAR archive opens like a CBZ.
  await page.getByRole('button', { name: '開始閱讀 vol3.cbr', exact: true }).click()
  await reader().waitFor()
  await page.waitForFunction(() =>
    /\/ 4 頁/.test(document.querySelector('.reader-info strong')?.textContent ?? '')
  )
  await page.waitForFunction(() => {
    const image = document.querySelector('.reader-spread img') as HTMLImageElement | null
    return !!image && image.complete && image.naturalWidth > 0
  })
  await page.screenshot({ path: path.join(base, 'shot', 'r407-cbr.png') })
  await page.keyboard.press('Escape')
  await reader().waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  console.log('PASS volume list, shared settings, per-archive page, CBR. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
}
