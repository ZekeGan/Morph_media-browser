// R-333 / R-360 / R-483 / R-531 / R-534 / R-545:
// Consolidated shell, panel preview, layout breadcrumb, problems dialog, and uncaught error recovery checks in one Electron session.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Library } from '../electron/library'
import { closeApp, launchApp, openLayoutConfig, removeTestRoot, reportFailure } from './support/app'

const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'shell-checks-ui-'))
const local = path.join(root, 'local')

const peekMedia = path.join(root, 'PeekLib')
await fs.mkdir(path.join(peekMedia, 'A'), { recursive: true })

const problemsMedia = path.join(root, 'ProblemsLib')
await fs.mkdir(path.join(problemsMedia, 'Game A', 'Game_Data'), { recursive: true })
await fs.writeFile(path.join(problemsMedia, 'Game A', 'Game.exe'), 'x')

const previewMedia = path.join(root, 'Games')
for (const name of ['Game A', 'Game B']) {
  await fs.mkdir(path.join(previewMedia, name), { recursive: true })
  await fs.writeFile(path.join(previewMedia, name, 'readme.txt'), 'x')
}

const crumbsMedia = path.join(root, 'Library')
for (const dir of ['Artist/Album', 'Other/Single']) {
  await fs.mkdir(path.join(crumbsMedia, dir), { recursive: true })
}
await fs.writeFile(path.join(crumbsMedia, 'Artist', 'Album', '01.mp3'), 'not audio')

const library = new Library(local, undefined, false)
await library.init()
await library.create(peekMedia, { name: 'Peek', depth: { mode: 'through', level: 2 } })
await library.create(problemsMedia, { name: 'Problems', depth: { mode: 'through', level: 2 } })
await library.create(previewMedia, {
  name: 'Preview',
  scanAll: true,
  depth: { mode: 'through', level: 2 },
})
await library.create(crumbsMedia, {
  name: 'Crumbs',
  scanAll: true,
  depth: { mode: 'through', level: 3 },
})

const errors: string[] = []
const { app, page } = await launchApp(local, errors)
let passed = false
try {
  // 1. Sidebar hover peek (R-333 / R-360).
  await page.getByRole('button', { name: '切換專案欄', exact: true }).click()
  const slot = page.locator('.sidebar-slot')
  await page.waitForFunction(
    () => document.querySelector('.sidebar-slot')?.getAttribute('data-open') === 'false'
  )
  assert.equal(await slot.getAttribute('data-peek'), 'false')
  await page.waitForFunction(
    () => document.querySelector('.sidebar-slot')!.getBoundingClientRect().width === 0
  )
  await page.mouse.move(2, 500)
  await page.mouse.move(1, 520)
  await page.waitForTimeout(400)
  assert.equal(await slot.getAttribute('data-peek'), 'false', 'the left edge does not open it')
  assert.equal(await page.locator('.sidebar-edge').count(), 0)
  const toggle = page.getByRole('button', { name: '切換專案欄', exact: true })
  const before = await page
    .locator('.desktop-body > .center-pane, .project-workspace, .home-page')
    .first()
    .boundingBox()
  await toggle.hover()
  await page.waitForFunction(
    () => document.querySelector('.sidebar-slot')?.getAttribute('data-peek') === 'true'
  )
  assert.ok((await page.locator('.project-sidebar').boundingBox())!.width > 150)
  const after = await page
    .locator('.desktop-body > .center-pane, .project-workspace, .home-page')
    .first()
    .boundingBox()
  assert.equal(Math.round(after!.x), Math.round(before!.x), 'the page does not move')
  await page.keyboard.press('Escape')
  await page.waitForFunction(
    () => document.querySelector('.sidebar-slot')?.getAttribute('data-peek') === 'false'
  )
  const closed = await page
    .locator('.desktop-body > .center-pane, .project-workspace, .home-page')
    .first()
    .boundingBox()
  assert.equal(
    Math.round(closed!.x),
    Math.round(before!.x),
    'the page does not move when it closes'
  )
  await page.mouse.move(900, 500)
  await toggle.hover()
  await page.waitForFunction(
    () => document.querySelector('.sidebar-slot')?.getAttribute('data-peek') === 'true'
  )
  await page.getByRole('button', { name: '開啟專案 Peek', exact: true }).first().click()
  await page.waitForFunction(
    () => document.querySelector('.sidebar-slot')?.getAttribute('data-peek') === 'false'
  )
  assert.equal(await slot.getAttribute('data-open'), 'false')
  await page.mouse.move(900, 500)
  await toggle.hover()
  assert.equal(await page.getByRole('button', { name: '固定展開專案欄', exact: true }).count(), 0) // ui-names: ignore
  // Re-open sidebar for the remaining sub-tests.
  await toggle.click()
  await page.waitForFunction(
    () => document.querySelector('.sidebar-slot')?.getAttribute('data-open') === 'true'
  )

  // 2. Problems dialog: candidate games are confirmed without counting as problems.
  await page.getByRole('button', { name: '開啟專案 Problems', exact: true }).first().click()
  await page.locator('.project-workspace').waitFor()
  await page.waitForFunction(
    () => document.querySelector('.status-problems')?.textContent === '沒有問題'
  )
  await page.getByRole('button', { name: '查看問題', exact: true }).click()
  const problemsDialog = page.getByRole('dialog', { name: '問題與復原', exact: true })
  await problemsDialog.getByText('待確認的遊戲', { exact: true }).waitFor()
  await problemsDialog
    .getByRole('button', { name: /^確認為遊戲主資料夾/ })
    .first()
    .click()
  await problemsDialog.getByText('待確認的遊戲', { exact: true }).waitFor({ state: 'detached' })
  await problemsDialog.getByText('目前沒有需要處理的問題。').waitFor()
  await page.keyboard.press('Escape')
  await problemsDialog.waitFor({ state: 'hidden' })

  // 3. Single-click panel preview & R-534 double-click leaf work expands full-width details.
  await page.getByRole('button', { name: '開啟專案 Preview', exact: true }).first().click()
  const card = (name: string) =>
    page
      .locator('.folder-card')
      .filter({ has: page.locator('.cell-name').getByText(name, { exact: true }) })
  const title = () => page.locator('.folder-panel-header strong')
  const crumb = async () =>
    (await page.locator('.workspace-breadcrumb').innerText()).replace(/\s+/g, ' ')
  await card('Game B').waitFor()
  await page.getByRole('button', { name: '切換詳情內容', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.folder-panel-header strong')?.textContent === 'Games'
  )
  await card('Game B').click()
  await page.waitForFunction(
    () => document.querySelector('.folder-panel-header strong')?.textContent === 'Game B'
  )
  assert.match(await crumb(), /^Games\b/)
  assert.doesNotMatch(await crumb(), /Game B/, 'the center did not enter the folder')
  await card('Game A').click()
  await page.waitForFunction(
    () => document.querySelector('.folder-panel-header strong')?.textContent === 'Game A'
  )
  assert.doesNotMatch(await crumb(), /Game A/)
  await card('Game A').click()
  await page.waitForFunction(
    () => document.querySelector('.folder-panel-header strong')?.textContent === 'Games'
  )
  await card('Game A').click()
  await page.waitForFunction(
    () => document.querySelector('.folder-panel-header strong')?.textContent === 'Game A'
  )
  await page.keyboard.press('Escape')
  await page.waitForFunction(
    () => document.querySelector('.folder-panel-header strong')?.textContent === 'Games'
  )
  await card('Game B').dblclick()
  await page.locator('.project-workspace.content-expanded').waitFor()
  assert.equal((await title().innerText()).trim(), 'Game B')

  // 4. Layout config breadcrumb (R-483 / R-545).
  await page.getByRole('button', { name: '開啟專案 Crumbs', exact: true }).first().click()
  await page.locator('.folder-card').filter({ hasText: 'Artist' }).first().dblclick()
  await page.getByRole('navigation', { name: '資料夾路徑' }).getByText('Artist').waitFor()
  await openLayoutConfig(page)
  const layoutDialog = page.getByRole('dialog', { name: '版面配置' })
  await layoutDialog.waitFor()
  await layoutDialog.locator('.layout-config-single-hint').waitFor()
  assert.equal(
    await layoutDialog
      .getByRole('button', { name: '依層級', exact: true })
      .getAttribute('aria-expanded'),
    'false'
  )
  const item = (name: string) =>
    layoutDialog
      .locator('.layout-config-item')
      .filter({ has: page.getByText(name, { exact: true }) })
  const crumbs = layoutDialog.getByRole('navigation', { name: '清單從哪個資料夾開始' })
  await item('Album').first().waitFor()
  assert.equal(await item('Other').count(), 0, 'the list starts at the folder being browsed')
  assert.equal((await crumbs.innerText()).replace(/\s+/g, ' '), 'Library \\ Artist')
  await crumbs.getByRole('button', { name: 'Library', exact: true }).click()
  await item('Other').first().waitFor()
  await item('Album').first().waitFor()
  assert.equal(await layoutDialog.isVisible(), true)
  await crumbs.locator('[aria-current="page"]').getByText('Library').waitFor()
  await page.screenshot({ path: path.join(base, 'shot', 'r483-layout-breadcrumb.png') })
  await layoutDialog.getByRole('button', { name: '取消' }).click()
  await layoutDialog.waitFor({ state: 'hidden' })
  await openLayoutConfig(page)
  await item('Album').first().waitFor()
  assert.equal(await item('Other').count(), 0)
  await layoutDialog.getByRole('button', { name: '取消' }).click()
  await layoutDialog.waitFor({ state: 'hidden' })

  assert.deepEqual(errors, [])

  // 5. Uncaught failure toast with technical detail; AbortError stays quiet.
  await page.evaluate(() => {
    void Promise.reject(new Error("EPERM: operation not permitted, open 'C:\\data\\a.json'"))
  })
  const toast = page.locator('.app-toasts [role=alert]')
  await toast.waitFor()
  assert.match(await toast.innerText(), /沒有權限完成這個操作/)
  assert.match(await toast.innerText(), /沒有設為唯讀/)
  await toast.getByText('技術細節').click()
  assert.match(await toast.innerText(), /EPERM: operation not permitted/)
  await toast.getByRole('button').first().click()
  await toast.waitFor({ state: 'detached' })
  await page.evaluate(() => {
    void Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
  })
  await page.waitForTimeout(400)
  assert.equal(await toast.count(), 0)

  passed = true
  console.log(
    'PASS shell checks (sidebar peek, problems, panel preview, layout breadcrumb, error recovery). ' +
      root
  )
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
