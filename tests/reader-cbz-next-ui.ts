import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Library } from '../electron/library'
import { closeApp, launchApp, reportFailure } from './support/app'
import { tinyPng, zipFixture } from './support/archive-fixture'

// R-415: a comic archive (CBZ) opened from a book folder goes on to the next archive of the folder, in file name
// order, the same way a text book does: the last page says which book comes next and the next press opens it.
const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'reader-cbz-next-'))
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
  name: 'Cbz next test',
  depth: { mode: 'through', level: 1 },
  scanAll: true,
})
const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1100, height: 800 })
const reader = () => page.getByRole('dialog', { name: '漫畫閱讀器', exact: true })
const shown = () =>
  page.evaluate(() => document.querySelector('.reader-info strong')?.textContent ?? '')
try {
  await page.getByRole('button', { name: '開啟專案 Cbz next test', exact: true }).first().click()
  await page.getByRole('button', { name: '開始閱讀 vol1.cbz', exact: true }).click()
  await reader().waitFor()
  await page.waitForFunction(() =>
    /\/ 2 頁/.test(document.querySelector('.reader-info strong')?.textContent ?? '')
  )
  // R-430: the settings of the volume just read carry over to the next one (two pages at a time here).
  await reader().getByRole('button', { name: '雙頁', exact: true }).click()
  // Right to left: the left arrow reads on. The last page names the next volume; the next press opens it.
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
  assert.match(await shown(), /第 1–2 \/ 5 頁/)
  // The last volume has no next book: the notice only says the book ends.
  for (let i = 0; i < 8 && !(await reader().locator('.reader-end').count()); i++) {
    await page.keyboard.press('ArrowLeft')
    await page.waitForTimeout(250)
  }
  await reader().locator('.reader-end').waitFor()
  assert.doesNotMatch((await reader().locator('.reader-end').textContent()) ?? '', /下一本/)
  assert.deepEqual(errors, [])
  console.log('PASS comic archive continues with the next archive of the folder. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
}
