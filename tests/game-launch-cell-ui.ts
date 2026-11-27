import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { Cell } from '../shared/model'

import { ensureFolder, folderFile, readFolder } from '../electron/files'
import { Library } from '../electron/library'
import { closeApp, launchApp, openLayoutEditor, removeTestRoot, reportFailure } from './support/app'

// The "launch game" cell: disabled until the folder has a bound launch file, enabled afterwards. Never clicked here.
const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'game-launch-cell-ui-'))
const media = path.join(root, 'Games')
const local = path.join(root, 'local')
for (const name of ['Unbound', 'Bound']) {
  await fs.mkdir(path.join(media, name), { recursive: true })
  await fs.writeFile(path.join(media, name, 'Game.exe'), 'x')
  await fs.writeFile(path.join(media, name, 'Game - LE.lnk'), 'fake shortcut')
  // R-409: an RPG Maker MZ game, so the scan finds its engine; only Bound has saved.
  await fs.mkdir(path.join(media, name, 'www', 'js'), { recursive: true })
  await fs.mkdir(path.join(media, name, 'www', 'data'), { recursive: true })
  await fs.writeFile(path.join(media, name, 'www', 'js', 'rmmz_core.js'), '//')
  await fs.writeFile(path.join(media, name, 'www', 'data', 'System.json'), '{}')
}
await fs.mkdir(path.join(media, 'Bound', 'www', 'save'), { recursive: true })
await fs.writeFile(path.join(media, 'Bound', 'www', 'save', 'file1.rpgsave'), 'SAVE')
const lib = new Library(local, undefined, false)
await lib.init()
await lib.create(media, {
  name: 'Launch',
  scanAll: true,
  depth: { mode: 'through', level: 2 },
})
const project = lib.snapshot().projects[0].project!
const style = { textColor: '#e4e6e8', backgroundColor: 'transparent' }
const cells: Cell[] = [
  { cellId: 'name', kind: 'name', grid: { x: 0, y: 0, w: 12, h: 1 }, style },
  { cellId: 'launch', kind: 'game-launch', grid: { x: 0, y: 1, w: 6, h: 1 }, style },
  { cellId: 'le', kind: 'game-launch', actionId: 'le', grid: { x: 6, y: 1, w: 6, h: 1 }, style },
  // R-409: a game's extra button and its engine.
  {
    cellId: 'save',
    kind: 'game-extra',
    gameExtra: 'save',
    grid: { x: 0, y: 2, w: 6, h: 1 },
    style,
  },
  {
    cellId: 'engine',
    kind: 'system-info',
    systemInfo: 'engine',
    grid: { x: 6, y: 2, w: 6, h: 1 },
    style,
  },
]
await lib.saveProject({
  ...project,
  actionTemplates: [
    { id: 'default-launch-game', label: '啟動遊戲', kind: 'exe', color: '#168c77' },
    { id: 'le', label: '用 LE 啟動', kind: 'shortcut', color: '#123456' },
  ],
  cells,
  layoutPresets: [{ id: 'default', name: 'Default', cells }],
  activeLayoutId: 'default',
  cardView: { mode: 'single', level: 2 },
})
await ensureFolder(path.join(media, 'Bound'), false)
const record = await readFolder(path.join(media, 'Bound'))
record.details = {
  schemaVersion: 1,
  kind: 'game',
  targets: {
    'default-launch-game': { kind: 'exe', path: 'Game.exe', relative: true, args: [] },
    le: { kind: 'shortcut', path: 'Game - LE.lnk', relative: true, args: [] },
  },
}
await fs.writeFile(folderFile(path.join(media, 'Bound')), JSON.stringify(record))
const unbound = await readFolder(path.join(media, 'Unbound'))
unbound.details = { schemaVersion: 1, kind: 'game' }
await fs.writeFile(folderFile(path.join(media, 'Unbound')), JSON.stringify(unbound))
await lib.scan()

const errors: string[] = []
const { app, page } = await launchApp(local, errors)
let passed = false
try {
  await page.getByRole('button', { name: '開啟專案 Launch', exact: true }).first().click()
  const card = (name: string) =>
    page
      .locator('.folder-card')
      .filter({ has: page.locator('.cell-name').getByText(name, { exact: true }) })
  await card('Bound').waitFor()
  assert.equal(await card('Unbound').getByRole('button', { name: '啟動遊戲' }).isDisabled(), true)
  assert.equal(await card('Bound').getByRole('button', { name: '啟動遊戲' }).isDisabled(), false)
  // R-409: the save-folder button is usable where there are saves; elsewhere it is grey and says why.
  await card('Bound').getByText('RPG Maker', { exact: false }).first().waitFor()
  const save = (name: string) => card(name).getByRole('button', { name: /^開啟存檔資料夾/ })
  for (let i = 0; i < 50 && (await save('Bound').isDisabled()); i++) await page.waitForTimeout(100)
  assert.equal(await save('Bound').isDisabled(), false)
  await card('Unbound').getByRole('button', { name: '開啟存檔資料夾（還沒有存檔）' }).waitFor()
  assert.equal(await save('Unbound').isDisabled(), true)
  // A second launch cell starts another action (the shortcut) under that action's own name.
  assert.equal(await card('Bound').getByRole('button', { name: '用 LE 啟動' }).isDisabled(), false)
  assert.equal(await card('Unbound').getByRole('button', { name: '用 LE 啟動' }).isDisabled(), true)
  // Bind the unbound folder's shortcut from the list of shortcuts in that folder.
  await card('Unbound').click()
  await page.waitForFunction(
    () => document.querySelector('.folder-panel-header strong')?.textContent === 'Unbound'
  )
  await page.getByRole('tab', { name: '設定', exact: true }).click()
  await page.getByRole('tab', { name: '遊戲操作', exact: true }).click()
  await page.getByRole('textbox', { name: '選擇資料夾內的捷徑' }).click()
  await page.getByRole('option', { name: 'Game - LE.lnk', exact: true }).click()
  await page.getByRole('button', { name: '使用這個捷徑', exact: true }).click()
  await page.locator('.game-target .path').filter({ hasText: 'Game - LE.lnk' }).waitFor()
  await page
    .locator('.folder-panel-dock-tabs')
    .getByRole('tab', { name: '內容', exact: true })
    .click()
  assert.equal(
    await card('Unbound').getByRole('button', { name: '用 LE 啟動' }).isDisabled(),
    false
  )
  // The editor offers it for game projects only.
  await openLayoutEditor(page)
  await page
    .locator('.basic-palette')
    .getByRole('button', { name: '啟動遊戲', exact: true })
    .waitFor()
  for (const name of ['遊戲附加按鈕', '遊玩時間', '遊戲引擎']) {
    await page.locator('.basic-palette').getByRole('button', { name, exact: true }).waitFor()
  }
  // R-454: a click only marks a palette row and shows what it does; Enter adds it.
  const editorCells = page.locator('.react-grid-layout .editor-cell')
  const undo = page.getByRole('button', { name: '復原', exact: true })
  const presetRow = (name: string) =>
    page
      .locator('.basic-palette .palette-item')
      .filter({ has: page.getByRole('button', { name, exact: true }) })
  const start = await editorCells.count()
  await presetRow('遊玩時間').getByRole('button').click()
  await presetRow('遊玩時間').getByText('從 M:orph 啟動的累計遊玩時間', { exact: true }).waitFor()
  await page.waitForTimeout(200)
  assert.equal(await editorCells.count(), start, 'a click adds nothing')
  await presetRow('遊玩時間').getByRole('button').press('Enter')
  await page.waitForFunction(
    (n) => document.querySelectorAll('.react-grid-layout .editor-cell').length === n + 1,
    start
  )
  await undo.click()
  // R-453: a preset row (a system-info component with its setting) can be dragged onto the canvas.
  {
    const transfer = await page.evaluateHandle(() => new DataTransfer())
    const grid = (await page.locator('.react-grid-layout').boundingBox())!
    const at = { clientX: grid.x + 90, clientY: grid.y + 300, dataTransfer: transfer }
    await presetRow('遊戲引擎').dispatchEvent('dragstart', { dataTransfer: transfer })
    await page.locator('.react-grid-layout').dispatchEvent('dragenter', at)
    await page.locator('.react-grid-layout').dispatchEvent('drop', at)
    await presetRow('遊戲引擎').dispatchEvent('dragend', { dataTransfer: transfer })
    await page.waitForFunction(
      (n) => document.querySelectorAll('.react-grid-layout .editor-cell').length === n + 1,
      start
    )
    await undo.click()
  }
  // R-385: a new game action is added from the launch component's settings and chosen for it.
  await page
    .locator('.basic-palette')
    .getByRole('button', { name: '啟動遊戲', exact: true })
    .dblclick()
  await page.getByRole('textbox', { name: '新操作的按鈕文字', exact: true }).fill('Manual')
  await page.getByRole('textbox', { name: '新操作的類型', exact: true }).click()
  await page.getByRole('option', { name: '開啟資料夾內的檔案', exact: true }).click()
  await page.getByRole('button', { name: '新增', exact: true }).click()
  await page.locator('.editor-inspector input[value="Manual"]').waitFor()
  assert.deepEqual(errors, [])
  passed = true
  console.log(
    'PASS game launch cell: disabled when unbound, enabled when bound, offered in the editor. ' +
      root
  )
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
