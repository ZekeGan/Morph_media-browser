import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Library } from '../electron/library'
import { projectFile } from '../electron/files'
import type { Cell } from '../shared/model'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'

// R-413: the layout configuration window. A folder that is not a work takes its level's layout, a work its kind's;
// the tree shows each choice and where it comes from, and a folder's own layout set there is saved in the project's
// layout rules and shown on its card.
const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'layout-config-ui-')),
  media = path.join(root, 'Library'),
  local = path.join(root, 'local')
const album = path.join(media, 'Artist', 'Album')
await fs.mkdir(album, { recursive: true })
for (const name of ['01.mp3', '02.mp3']) await fs.writeFile(path.join(album, name), 'not audio')
const lib = new Library(local, undefined, false)
await lib.init()
await lib.create(media, { name: 'Layouts', scanAll: true, depth: { mode: 'through', level: 3 } })
const project = lib.snapshot().projects[0].project!,
  style = { textColor: '#e4e6e8', backgroundColor: 'transparent' },
  layout = (text: string): Cell[] => [
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
  const button = page.getByRole('button', { name: /^版面配置：/ }).first()
  await button.click()
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
  await dialog.getByText('右側', { exact: true }).click()
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
  const file = JSON.parse(await fs.readFile(projectFile(media, project.projectId), 'utf8')),
    saved = file.project ?? file
  const artist = lib.snapshot().rows.find((r) => r.name === 'Artist')
  assert.equal(saved.layoutRules?.card?.folders?.[artist?.record?.folderId ?? ''], 'albums')
  assert.deepEqual(saved.layoutRules?.card?.levels, ['top'])
  assert.deepEqual(saved.layoutRules?.panel, { types: { music: 'panel-album' } })
  await page.screenshot({ path: path.join(root, 'layout-config.png') })
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
