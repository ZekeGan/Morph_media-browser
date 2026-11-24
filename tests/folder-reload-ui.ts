import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Library } from '../electron/library'
import { tinyPng } from './support/archive-fixture'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'

// (File names that are not page numbers, so the folder is a general one with the file list, R-479.)
// Coming back to a folder listed before: its complete list stays on screen while the folder is read again and is
// replaced once, when the new list is complete. It used to drop to the first part (96 files) and grow back part by
// part, re-sorting each time, so the page visibly jumped.
const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'folder-reload-ui-')),
  media = path.join(root, 'Media'),
  local = path.join(root, 'local')
await fs.mkdir(path.join(media, 'Sub'), { recursive: true })
await fs.writeFile(path.join(media, 'Sub', 'only.png'), tinyPng)
const count = 300
for (let i = 0; i < count; i++)
  await fs.writeFile(path.join(media, `pic_${String(i).padStart(3, '0')}_x.png`), tinyPng)
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Reload',
  scanAll: true,
  depth: { mode: 'through', level: 2 },
})
const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1500, height: 950 })
let passed = false
try {
  await page.getByRole('button', { name: '開啟專案 Reload', exact: true }).first().click()
  const all = page.locator('.media-type-chip').first()
  await page.waitForFunction(
    (n) =>
      document.querySelector('.media-type-chip')?.textContent?.replace(/\s+/g, ' ') === `全部 ${n}`,
    count
  )
  await page.locator('.media-subfolders button').filter({ hasText: 'Sub' }).click()
  await page.waitForFunction(
    () => document.querySelector('.media-type-chip')?.textContent?.replace(/\s+/g, ' ') === '全部 1'
  )
  // Watch every count the list shows from here on.
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { seen: string[] }).seen = seen
    new MutationObserver(() => {
      const text = document.querySelector('.media-type-chip')?.textContent?.replace(/\s+/g, ' ')
      if (text && seen[seen.length - 1] !== text) seen.push(text)
    }).observe(document.body, { subtree: true, childList: true, characterData: true })
  })
  await page
    .locator('.workspace-breadcrumb')
    .getByRole('button', { name: '返回', exact: true })
    .click()
  await page.waitForFunction(
    (n) => (window as unknown as { seen: string[] }).seen.includes(`全部 ${n}`),
    count
  )
  // Give the background re-read time to finish and swap in its list.
  await page.waitForTimeout(1500)
  const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen)
  const partial = seen.filter((text) => {
    const n = Number(text.replace(/\D+/g, ''))
    return n > 1 && n < count
  })
  assert.deepEqual(
    partial,
    [],
    'the list shrank to a part while the folder was read again: ' + seen.join(' → ')
  )
  assert.equal((await all.textContent())?.replace(/\s+/g, ' '), `全部 ${count}`)
  assert.deepEqual(errors, [])
  passed = true
  console.log('PASS a folder listed before keeps its full list while it is read again. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
