import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Library } from '../electron/library'
import { closeApp, launchApp, openLayoutConfig, removeTestRoot, reportFailure } from './support/app'

// R-483: the layout configuration window starts its folder list at the folder being browsed; a breadcrumb above the
// list moves the start up to any folder above it without closing the window.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'layout-breadcrumb-ui-'))
const media = path.join(root, 'Library')
const local = path.join(root, 'local')
for (const dir of ['Artist/Album', 'Other/Single']) {
  await fs.mkdir(path.join(media, dir), { recursive: true })
}
await fs.writeFile(path.join(media, 'Artist', 'Album', '01.mp3'), 'not audio')
const lib = new Library(local, undefined, false)
await lib.init()
await lib.create(media, { name: 'Crumbs', scanAll: true, depth: { mode: 'through', level: 3 } })
const errors: string[] = []
const { page, app } = await launchApp(local, errors)
let passed = false
try {
  await page.getByRole('button', { name: '開啟專案 Crumbs', exact: true }).first().click()
  // Enter Artist from the folder bar so it is the folder being browsed.
  await page.locator('.folder-card').filter({ hasText: 'Artist' }).first().dblclick()
  await page.getByRole('navigation', { name: '資料夾路徑' }).getByText('Artist').waitFor()
  await openLayoutConfig(page)
  const dialog = page.getByRole('dialog', { name: '版面配置' })
  await dialog.waitFor()
  // R-545: with only one card layout and no level rules, show the concise hint and fold "by level".
  await dialog.locator('.layout-config-single-hint').waitFor()
  assert.equal(
    await dialog.getByRole('button', { name: '依層級', exact: true }).getAttribute('aria-expanded'),
    'false'
  )
  const item = (name: string) =>
    dialog.locator('.layout-config-item').filter({ has: page.getByText(name, { exact: true }) })
  const crumbs = dialog.getByRole('navigation', { name: '清單從哪個資料夾開始' })
  await item('Album').first().waitFor()
  assert.equal(await item('Other').count(), 0, 'the list starts at the folder being browsed')
  assert.equal((await crumbs.innerText()).replace(/\s+/g, ' '), 'Library \\ Artist')
  // Moving the start up shows the folders above; the window stays open and Artist stays the current crumb's child.
  await crumbs.getByRole('button', { name: 'Library', exact: true }).click()
  await item('Other').first().waitFor()
  await item('Album').first().waitFor()
  assert.equal(await dialog.isVisible(), true)
  await crumbs.locator('[aria-current="page"]').getByText('Library').waitFor()
  await page.screenshot({ path: path.join(base, 'shot', 'r483-layout-breadcrumb.png') })
  // Closing and opening again starts from the folder being browsed once more.
  await dialog.getByRole('button', { name: '取消' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await openLayoutConfig(page)
  await item('Album').first().waitFor()
  assert.equal(await item('Other').count(), 0)
  assert.deepEqual(errors, [])
  passed = true
  console.log('PASS layout window breadcrumb: start moves up and resets. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
