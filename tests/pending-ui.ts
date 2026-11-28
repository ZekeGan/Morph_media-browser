import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

import { addPreset, presetDraft, syncPresetDraft } from '../shared/layouts'

import { folderFile, readFolder, saveFolder } from '../electron/files'
import { Library } from '../electron/library'
import { WorkspaceStore } from '../electron/workspace'
import { closeApp, openLayoutEditor } from './support/app'

const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'pending-ui-'))
const media = path.join(root, 'Album')
const local = path.join(root, 'local')
await fs.mkdir(media)
for (const name of ['a', 'A', '2', '10']) {
  await fs.mkdir(path.join(media, name, 'child'), { recursive: true })
}
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jB5kAAAAASUVORK5CYII=',
  'base64'
)
await fs.writeFile(path.join(media, 'cover.png'), pixel)
await fs.writeFile(path.join(media, 'a', 'page.png'), pixel)
const lib = new Library(local, undefined, false)
await lib.init()
await lib.create(media, {
  name: 'Pending Album',
  scanAll: true,
  depth: { mode: 'through', level: 3 },
})
let project = presetDraft(lib.snapshot().projects[0].project!)
project = addPreset(project, 'Alternative', 'alternative', true)
project.fieldBindings = [{ attributeId: 'flag', alias: 'Flag', type: 'boolean' }]
await lib.saveProject(syncPresetDraft(project))
await lib.create(media, {
  name: 'Pending Manga',
  scanAll: true,
  depth: { mode: 'through', level: 3 },
})
// Folder types are detected from the files; these fixtures are comics, so say so.
for (const dir of [path.join(media, 'a')]) {
  const record = await readFolder(dir)
  record.details = { ...(record.details ?? { schemaVersion: 1 }), kind: 'book' }
  await saveFolder(dir, record, record.revision)
}
const workspace = new WorkspaceStore(local, ['zh-TW'])
await workspace.init()
await workspace.update(
  { action: 'createGroup', name: 'One' },
  lib.snapshot().projects.map((p) => p.projectId)
)
await workspace.update(
  { action: 'createGroup', name: 'Two' },
  lib.snapshot().projects.map((p) => p.projectId)
)
const original = await fs.readFile(folderFile(media), 'utf8')
const env = Object.fromEntries(
  Object.entries({ ...process.env, MEDIA_VIEWER_TEST_DATA: local }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env, timeout: 30000 })
const page = await app.firstWindow()
const errors: string[] = []
page.on('pageerror', (error) => errors.push(error.message))
page.setDefaultTimeout(15000)
await page.evaluate('window.__name=(target)=>target')
const button = (name: string) => page.getByRole('button', { name, exact: true })
try {
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1500, height: 900 })
  )
  await page.locator('.section-toggle').filter({ hasText: 'Two' }).waitFor()
  const groups = (await workspace.read(lib.snapshot().projects.map((p) => p.projectId))).prefs
    .groups
  const one = page.locator(`[data-group-id="${groups[0].id}"] .section-toggle`)
  const two = page.locator(`[data-group-id="${groups[1].id}"] .section-toggle`)
  await page.evaluate(() => {
    const original = Element.prototype.animate
    ;(window as unknown as { groupMoves: number }).groupMoves = 0
    Element.prototype.animate = function (...args) {
      if (this.matches('.sidebar-section')) {
        ;(window as unknown as { groupMoves: number }).groupMoves++
      }
      return original.apply(this, args)
    }
  })
  await two.dragTo(one, { targetPosition: { x: 20, y: 2 } })
  await page.waitForFunction(
    (first) =>
      [...document.querySelectorAll('[data-group-id]')][1]?.getAttribute('data-group-id') === first,
    groups[1].id
  )
  assert.ok(
    (await page.evaluate(() => (window as unknown as { groupMoves: number }).groupMoves)) > 0
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => ((window as unknown as { groupMoves: number }).groupMoves = 0))
  await one.dragTo(two, { targetPosition: { x: 20, y: 2 } })
  await page.waitForFunction(
    (first) =>
      [...document.querySelectorAll('[data-group-id]')][1]?.getAttribute('data-group-id') === first,
    groups[0].id
  )
  assert.equal(
    await page.evaluate(() => (window as unknown as { groupMoves: number }).groupMoves),
    0
  )
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await button('開啟專案 Pending Album').first().click()
  await button('目前資料夾設定').click()
  const drawer = page.locator('.folder-panel-dock-settings')
  const layouts = drawer.getByRole('group', { name: '此資料夾的版面', exact: true })
  // Pending Manga shows the same folder, so the shared / this-project switch is offered here.
  await drawer.locator('label').filter({ hasText: '僅此專案' }).waitFor()
  // The layouts are shown in the Appearance tab (R-235) and set in the layout window, which opens at this folder
  // (R-409); cancelling it writes nothing.
  await drawer.getByRole('tab', { name: '類型與版面', exact: true }).click()
  await layouts.getByText('內建詳情', { exact: true }).waitFor()
  await layouts.getByRole('button', { name: '卡片版面配置…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '版面配置' })
  await dialog.locator('.layout-config-item.picked').waitFor()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page
    .locator('.folder-panel-dock-tabs')
    .getByRole('tab', { name: '內容', exact: true })
    .click()
  assert.equal(await fs.readFile(folderFile(media), 'utf8'), original)
  const body = page.locator('.folder-panel-body')
  // The content tab draws once the settings close; scroll only after it has.
  await body.getByText('cover.png', { exact: true }).first().waitFor()
  await body.evaluate((element) => {
    const spacer = document.createElement('div')
    spacer.id = 'controlled-scroll-content'
    spacer.style.height = '3000px'
    element.append(spacer)
    element.scrollTop = 200
  })
  await button('返回頂部').waitFor()
  await button('返回頂部').click()
  await page.waitForFunction(() => document.querySelector('.folder-panel-body')?.scrollTop === 0)
  await button('返回頂部').waitFor({ state: 'detached' })
  await body.evaluate((element) => element.querySelector('#controlled-scroll-content')?.remove())
  const toolbar = page.locator('.workspace-toolbar')
  const mode = toolbar.locator('.center-mode')
  // R-413: the layout picker became the button that opens the layout setup window.
  const preset = toolbar.getByRole('button', { name: /^版面配置：/ })
  const modeBox = (await mode.boundingBox())!
  const presetBox = (await preset.boundingBox())!
  assert.ok(Math.abs(modeBox.y - presetBox.y) < 12)
  const toggle = toolbar.locator('[aria-label="展示內容"]')
  const before = await toggle.boundingBox()
  await toolbar.getByText('檔案', { exact: true }).click()
  assert.equal(await button('卡片顯示設定').count(), 0)
  assert.equal(await preset.count(), 0)
  if (before) {
    assert.equal(Math.round((await toggle.boundingBox())!.width), Math.round(before.width))
  }
  await page.locator('.file-overview-item').first().waitFor()
  await page.locator('.file-overview-item').filter({ hasText: 'cover.png' }).click()
  const preview = page.locator('.file-page')
  await preview.getByRole('button', { name: '檢視圖片 · cover.png', exact: true }).click()
  await page.getByRole('dialog', { name: '圖片檢視', exact: true }).waitFor()
  // R-406: image mode has no page-turn transition or reading-direction control.
  assert.equal(await button('翻頁過渡').count(), 0)
  assert.equal(await button('由右至左').count(), 0)
  await button('放大').click()
  await page.waitForFunction(
    () => document.querySelector('.reader-zoom-value')?.textContent === '125%'
  )
  await page.keyboard.press('r')
  await page.waitForFunction(
    () => document.querySelector('.reader-zoom-value')?.textContent === '100%'
  )
  await button('退出閱讀器').click()
  await toolbar.getByText('資料夾', { exact: true }).click()
  await openLayoutEditor(page)
  await page.locator('.editor-toolbar').waitFor()
  const saveBox = (await button('儲存').boundingBox())!
  const undoBox = (await button('復原').boundingBox())!
  assert.ok(Math.abs(saveBox.y - undoBox.y) < 12)
  await page.screenshot({ path: path.join(root, 'editor.png') })
  await page.getByRole('button', { name: /^(放棄變更|關閉)$/ }).click()
  await openLayoutEditor(page)
  const deleteField = async () => {
    await button('欄位操作 Flag').click()
    await page.getByRole('menuitem', { name: '刪除欄位及資料', exact: true }).click()
  }
  await deleteField()
  const deletion = page.getByRole('dialog', { name: '刪除自訂欄位', exact: true })
  await deletion.waitFor()
  assert.ok((await deletion.textContent())!.includes('會刪掉 1 個欄位'))
  await deletion.getByRole('button', { name: '取消', exact: true }).click()
  await deleteField()
  await button('確認刪除欄位及資料').click()
  await deletion.waitFor({ state: 'hidden' })
  assert.equal(await button('欄位操作 Flag').count(), 0)
  await page.getByRole('button', { name: /^(放棄變更|關閉)$/ }).click()
  await button('開啟專案 Pending Manga').first().click()
  await page.locator('.media-subfolders').getByRole('button', { name: 'a', exact: true }).click()
  await page.locator('.media-thumbnail').filter({ hasText: 'page.png' }).click()
  await page.getByRole('dialog', { name: '漫畫閱讀器', exact: true }).waitFor()
  assert.equal(await page.locator('.reader-page-total').textContent(), '/ 1')
  await button('退出閱讀器').click()
  await button('開啟專案 Pending Manga').first().hover()
  await button('專案選單 Pending Manga').click()
  await page.getByRole('menuitem', { name: '專案設定', exact: true }).click()
  // Unsaved project settings show the same fixed save bar as folder settings; discard restores them.
  const nameInput = page.getByRole('textbox', { name: '專案名稱', exact: true })
  const savebar = page.getByRole('region', { name: '未保存的變更', exact: true })
  assert.equal(await savebar.count(), 0)
  await nameInput.fill('Renamed Manga')
  await savebar.waitFor()
  await savebar.getByRole('button', { name: '放棄', exact: true }).click()
  await savebar.waitFor({ state: 'hidden' })
  assert.equal(await nameInput.inputValue(), 'Pending Manga')
  // Saving clears the bar, and a second save right after works (the draft follows the saved revision).
  for (const name of ['Renamed Manga', 'Pending Manga']) {
    await nameInput.fill(name)
    await savebar.getByRole('button', { name: '保存', exact: true }).click()
    await savebar.waitFor({ state: 'hidden' })
  }
  assert.equal(await page.locator('.app-toasts [data-level="error"]').count(), 0)
  await page.getByRole('tab', { name: '移除', exact: true }).click()
  const beforeRemoval = await fs.readFile(folderFile(media), 'utf8')
  const settings = page.getByRole('dialog', { name: '專案設定 · Pending Manga', exact: true })
  // Removing from the list keeps everything; deleting info removes only this project's own info unless
  // the wider option is ticked; Pending Album uses the same folders, so it is listed.
  await settings.getByRole('button', { name: '從清單移除', exact: true }).waitFor()
  await settings.getByRole('button', { name: '刪除這個專案的資訊…', exact: true }).click()
  const alsoShared = settings.getByRole('checkbox', {
    name: '也刪除這些資料夾裡 M:orph 建立的其他資訊',
  })
  await alsoShared.waitFor()
  assert.equal(await alsoShared.isChecked(), false)
  assert.ok((await settings.textContent())!.includes('Pending Album'))
  await settings.getByRole('button', { name: '取消', exact: true }).click()
  await alsoShared.waitFor({ state: 'hidden' })
  assert.equal(await fs.readFile(folderFile(media), 'utf8'), beforeRemoval)
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'hidden' })
  assert.deepEqual(errors, [])
  assert.deepEqual(await fs.readFile(path.join(media, 'cover.png')), pixel)
  console.log(
    'PASS: folder inheritance and data preservation; toolbar mode sizing/visibility; image click reader and reset; compact editor. Artifacts: ' +
      root
  )
} catch (error) {
  await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {})
  console.error('Artifacts: ' + root)
  throw error
} finally {
  await app.evaluate(({ BrowserWindow }) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.removeAllListeners('close')
      win.webContents.on('will-prevent-unload', (event) => event.preventDefault())
    }
  })
  await closeApp(app)
}
