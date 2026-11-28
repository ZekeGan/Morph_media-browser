import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { Cell } from '../shared/model'

import { projectFile } from '../electron/files'
import { Library } from '../electron/library'
import { closeApp, launchApp, openLayoutConfig, removeTestRoot, reportFailure } from './support/app'

// R-413: the layout configuration window. A folder that is not a work takes its level's layout, a work its kind's;
// the tree shows each choice and where it comes from, and a folder's own layout set there is saved in the project's
// layout rules and shown on its card.
const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'layout-config-ui-'))
const media = path.join(root, 'Library')
const local = path.join(root, 'local')
const album = path.join(media, 'Artist', 'Album')
await fs.mkdir(album, { recursive: true })
for (const name of ['01.mp3', '02.mp3']) await fs.writeFile(path.join(album, name), 'not audio')
const lib = new Library(local, undefined, false)
await lib.init()
await lib.create(media, { name: 'Layouts', scanAll: true, depth: { mode: 'through', level: 3 } })
const project = lib.snapshot().projects[0].project!
const style = { textColor: '#e4e6e8', backgroundColor: 'transparent' }
const layout = (text: string): Cell[] => [
  { cellId: 'name', kind: 'name', grid: { x: 0, y: 0, w: 12, h: 1 }, style },
  { cellId: 'tag', kind: 'static-text', text, grid: { x: 0, y: 1, w: 12, h: 1 }, style },
]
await lib.saveProject({
  ...project,
  cells: layout('LAYOUT-0'),
  layoutPresets: [
    { id: 'zero', name: 'Zero', cells: layout('LAYOUT-0') },
    { id: 'top', name: 'Top', cells: layout('LAYOUT-T') },
    { id: 'albums', name: 'Albums', cells: layout('LAYOUT-A') },
  ],
  activeLayoutId: 'zero',
  panelPresets: [{ id: 'panel-album', name: 'Panel Album', cells: layout('PANEL-A') }],
  layoutRules: { card: { types: { music: 'albums' }, levels: ['top'] } },
  cardView: { mode: 'single', level: 2 },
})
await lib.scan()

const errors: string[] = []
const { page, app } = await launchApp(local, errors)
let passed = false
try {
  await page.getByRole('button', { name: '開啟專案 Layouts', exact: true }).first().click()
  const card = page.locator('.folder-card').filter({ hasText: 'Artist' }).first()
  // Artist holds only a folder: not a work, so it takes the first level's layout.
  await card.getByText('LAYOUT-T').waitFor()
  await openLayoutConfig(page)
  const dialog = page.getByRole('dialog', { name: '版面配置' })
  await dialog.waitFor()
  await fs.mkdir(path.resolve('.test-output', 'shot'), { recursive: true })
  const item = (name: string) =>
    dialog
      .locator('.layout-config-item')
      .filter({ has: page.getByText(name, { exact: true }) })
      .first()
  // The list says what each folder uses and why: Artist by level, Album (music) by kind; the rules say how many
  // folders they reach.
  await item('Album').locator('.layout-config-source', { hasText: '類型' }).waitFor()
  await item('Artist').locator('.layout-config-source', { hasText: '層級' }).waitFor()
  assert.equal(
    await item('Artist').getByRole('combobox', { name: 'Artist 的版面' }).inputValue(),
    ''
  )
  await dialog.getByText('1 個資料夾').first().waitFor()
  // Artist gets a layout of its own; the preview below shows its card with it before saving.
  await item('Artist').getByRole('combobox', { name: 'Artist 的版面' }).selectOption('albums')
  await item('Artist').locator('.layout-config-source', { hasText: '專屬' }).waitFor()
  await dialog.locator('.layout-config-preview').getByText('LAYOUT-A').first().waitFor()
  await dialog.getByText('1 處尚未保存').waitFor()
  // R-409: the right panel has the same rules; switching keeps the card change. Music gets a panel layout and Album's
  // right panel shows it in the preview.
  await dialog.getByText('詳情', { exact: true }).click()
  await item('Album').locator('.layout-config-source', { hasText: '預設' }).waitFor()
  await dialog.getByRole('combobox', { name: '音樂的版面' }).selectOption('panel-album')
  await item('Album').locator('.layout-config-source', { hasText: '類型' }).waitFor()
  await item('Album').click()
  await dialog.locator('.layout-config-preview').getByText('PANEL-A').waitFor()
  await dialog.getByText('2 處尚未保存').waitFor()
  await page.screenshot({
    path: path.resolve('.test-output', 'shot', 'r409-layout-config-panel.png'),
  })
  await dialog.getByText('卡片', { exact: true }).click()
  // R-444: the level is shown on the folder the level rules reach (Artist), not on a work (Album); only the kinds the
  // project has folders of are listed.
  await item('Artist').locator('.layout-config-level', { hasText: '第 1 層' }).waitFor()
  assert.equal(await item('Album').locator('.layout-config-level').count(), 0)
  await dialog.getByRole('combobox', { name: '音樂的版面' }).waitFor()
  assert.equal(await dialog.getByRole('combobox', { name: '影片的版面' }).count(), 0)
  // Picking the layout the rules already give a folder makes no own choice.
  await item('Album').getByRole('combobox', { name: 'Album 的版面' }).selectOption('albums')
  await item('Album').locator('.layout-config-source', { hasText: '類型' }).waitFor()
  await dialog.getByText('2 處尚未保存').waitFor()
  // Filters: only the folders with their own layout (and the folders above them).
  await dialog.getByText('只看專屬', { exact: true }).click()
  await item('Artist').waitFor()
  assert.equal(await item('Album').count(), 0)
  await dialog.getByText('全部', { exact: true }).click()
  await item('Album').waitFor()
  // Ctrl+click marks a second folder: the bar for marked folders shows, and the preview draws both.
  await item('Album').click()
  await item('Artist').click({ modifiers: ['Control'] })
  await dialog.getByText('已選 2 個資料夾').waitFor()
  await dialog.getByText('預覽：所選的 2 個資料夾').waitFor()
  await dialog.getByRole('button', { name: '取消選取', exact: true }).click()
  await dialog.getByText('已選 2 個資料夾').waitFor({ state: 'detached' })
  // The preview, the whole rules column and each group of rules fold and open again.
  await dialog.getByRole('button', { name: '收合預覽', exact: true }).click()
  assert.equal(await dialog.locator('.layout-config-cards').count(), 0)
  await dialog.getByRole('button', { name: '展開預覽', exact: true }).click()
  await dialog.locator('.layout-config-cards').waitFor()
  await dialog.getByRole('button', { name: '作品依類型', exact: true }).click()
  assert.equal(await dialog.getByRole('combobox', { name: '音樂的版面' }).count(), 0)
  await dialog.getByRole('button', { name: '作品依類型', exact: true }).click()
  await dialog.getByRole('combobox', { name: '音樂的版面' }).waitFor()
  await dialog.getByRole('button', { name: '收合規則', exact: true }).click()
  await dialog.getByRole('combobox', { name: '音樂的版面' }).waitFor({ state: 'hidden' })
  await dialog.getByRole('button', { name: '展開規則', exact: true }).click()
  await dialog.getByRole('combobox', { name: '音樂的版面' }).waitFor()
  // Screenshots for review: wide, then the 900-wide window.
  const shots = path.resolve('.test-output', 'shot')
  await page.screenshot({ path: path.join(shots, 'r413-layout-config-wide.png') })
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 900, height: 900 })
  )
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(shots, 'r413-layout-config-900.png') })
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await card.getByText('LAYOUT-A').waitFor()
  const file = JSON.parse(await fs.readFile(projectFile(media, project.projectId), 'utf8'))
  const saved = file.project ?? file
  const artist = lib.snapshot().rows.find((r) => r.name === 'Artist')
  assert.equal(saved.layoutRules?.card?.folders?.[artist?.record?.folderId ?? ''], 'albums')
  assert.deepEqual(saved.layoutRules?.card?.levels, ['top'])
  assert.deepEqual(saved.layoutRules?.panel, { types: { music: 'panel-album' } })
  await page.screenshot({ path: path.join(root, 'layout-config.png') })
  // R-452: the right panel of a music folder is edited with its own kind's section of main visuals only.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 1500, height: 950 })
  )
  await page.waitForTimeout(300)
  // R-459: Artist (a card at the top level of the browser) is selected before the editor is opened.
  await card.click()
  await page.locator('.folder-panel-header strong').getByText('Artist', { exact: true }).waitFor()
  await openLayoutConfig(page)
  await dialog.waitFor()
  await dialog.getByText('詳情', { exact: true }).click()
  await item('Album').click()
  await dialog.getByRole('button', { name: '編輯詳情版面', exact: true }).click()
  const palette = page.locator('.editor-palette')
  await palette.waitFor()
  await palette.locator('.palette-section-toggle', { hasText: '專輯' }).waitFor()
  assert.equal(await palette.locator('.palette-section-toggle', { hasText: '書籍' }).count(), 0)
  assert.equal(await palette.locator('.palette-section-toggle', { hasText: '影片' }).count(), 0)
  // R-460: the editor opens Album's own layout with Album's data in the preview.
  await page.locator('.react-grid-layout').getByText('PANEL-A').waitFor()
  assert.match(
    await page.getByRole('textbox', { name: '使用真實資料預覽', exact: true }).inputValue(),
    /^Album · /
  )
  // R-459: back in the browser it is where it was (Artist's card still listed: it did not go into Artist), with
  // Artist still selected.
  await page.getByRole('button', { name: '關閉', exact: true }).click()
  await palette.waitFor({ state: 'hidden' })
  await card.waitFor()
  await page.locator('.folder-panel-header strong').getByText('Artist', { exact: true }).waitFor()
  assert.equal(
    (await page
      .getByRole('button', { name: /^編輯目前版面：/ })
      .filter({ visible: true })
      .count()) > 0,
    true
  )
  assert.deepEqual(errors, [])
  passed = true
  console.log(
    'PASS layout configuration: level and kind rules, own layout saved in rules, right-panel rules. ' +
      root
  )
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
