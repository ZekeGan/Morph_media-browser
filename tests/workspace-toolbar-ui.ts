import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { _electron as electron } from 'playwright-core'

import { Library } from '../electron/library'
import { closeApp } from './support/app'

const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'toolbar-ui-'))
const media = path.join(root, 'Media')
const local = path.join(root, 'local')
await fs.mkdir(path.join(media, 'Child'), { recursive: true })
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Toolbar',
  scanAll: true,
  depth: { mode: 'through', level: 2 },
})
const original = await fs.readFile(path.join(media, '.media-viewer', 'folder.json'))
const env = Object.fromEntries(
  Object.entries({ ...process.env, MEDIA_VIEWER_TEST_DATA: local }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined
  )
)
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env, timeout: 30000 })
const page = await app.firstWindow()
page.setDefaultTimeout(15000)
await page.evaluate('window.__name=(target)=>target')
const button = (name: string) => page.getByRole('button', { name, exact: true })
try {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setMinimumSize(500, 400)
    w.setBounds({ width: 1440, height: 900 })
  })
  await button('開啟專案 Toolbar').first().click()
  // One refresh control lives in the top bar next to the application settings; the old rescan / panel buttons are gone.
  assert.equal(await button('重新整理').count(), 1)
  assert.equal(await page.locator('.titlebar').getByRole('button', { name: '重新整理' }).count(), 1)
  assert.equal(await button('重新掃描').count(), 0)
  // R-547: at root on a wide window, navigation merges into the main toolbar (no separate breadcrumb bar).
  assert.equal(await page.locator('.toolbar-nav').count(), 1)
  assert.equal(await page.locator('.workspace-breadcrumb').count(), 0)
  // Display settings live in one View Options popover button instead of a permanent row.
  assert.equal(await page.locator('.card-inline-controls').count(), 0)
  await button('檢視選項').click()
  await page.locator('.card-inline-controls').waitFor()
  assert.equal(await page.getByLabel('每頁筆數', { exact: true }).count(), 1)
  await button('檢視選項').click()
  await page.locator('.card-inline-controls').waitFor({ state: 'detached' })
  await page.locator('.center-mode').getByText('表格', { exact: true }).click()
  await button('檢視選項').click()
  await page.getByRole('checkbox', { name: '目前路徑', exact: true }).uncheck()
  assert.equal(
    await page.getByRole('checkbox', { name: '資料夾名稱', exact: true }).isDisabled(),
    true
  )
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.folder-table th').filter({ hasText: '目前路徑' }).count(), 0)
  await page
    .locator('.folder-table th')
    .filter({ hasText: '資料夾名稱' })
    .dragTo(page.locator('.folder-table th').filter({ hasText: '層級' }), {
      targetPosition: { x: 2, y: 8 },
    })
  assert.equal(await page.locator('.folder-table th').count(), 2)
  // R-500: a column follows its resizer while dragged and keeps the width when let go.
  const levelHead = page.locator('.folder-table th').filter({ hasText: '層級' })
  const headWidth = async () => (await levelHead.boundingBox())!.width
  const before = await headWidth()
  const grip = (await levelHead.locator('.column-resizer').boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + grip.height / 2, { steps: 4 })
  await page.waitForFunction(
    (width) =>
      [...document.querySelectorAll<HTMLElement>('.folder-table th')]
        .find((th) => th.textContent?.includes('層級'))!
        .getBoundingClientRect().width >
      width + 40,
    before
  )
  await page.mouse.up()
  await page.waitForTimeout(200)
  assert.ok((await headWidth()) > before + 40)
  await page.keyboard.press('Alt+Enter')
  await page.locator('.folder-panel-dock-settings').waitFor()
  await page
    .locator('.folder-panel-dock-tabs')
    .getByRole('tab', { name: '內容', exact: true })
    .click()
  await page.locator('.workspace-toolbar').getByText('檔案總覽', { exact: true }).click()
  await page.locator('.workspace-file-scope [aria-label="檔案總覽範圍設定"]').waitFor()
  // R-402, R-446: the first time the scope switch opens (in a popover still appearing), the chosen item is marked by
  // its own background; the sliding indicator, which was measured too early, is not drawn.
  await page.locator('.workspace-file-scope [aria-label="檔案總覽範圍設定"]').click()
  await page.getByRole('radiogroup', { name: '檔案總覽範圍' }).waitFor()
  const mark = await page.evaluate(() => {
    const group = document.querySelector('[aria-label="檔案總覽範圍"]')!
    const indicator = group.querySelector('.mantine-SegmentedControl-indicator')
    const active = group.querySelector('.mantine-SegmentedControl-label[data-active]')!
    return {
      indicator: indicator ? getComputedStyle(indicator).display : 'none',
      mark: getComputedStyle(active, '::before').display,
    }
  })
  assert.deepEqual(mark, { indicator: 'none', mark: 'block' }, 'the chosen item is marked itself')
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.file-overview .file-overview-toolbar').count(), 0)
  assert.equal(await button('檢視選項').count(), 0)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 700, height: 760 })
  )
  // R-547: in a narrow window the slim breadcrumb bar appears below the toolbar.
  await page.locator('.workspace-breadcrumb').waitFor()
  await page.screenshot({ path: path.join(root, 'narrow.png') })
  assert.ok((await page.locator('.workspace-file-tools').boundingBox())!.width < 700)
  assert.deepEqual(await fs.readFile(path.join(media, '.media-viewer', 'folder.json')), original)
  console.log(
    'PASS: inline CARD controls, TABLE visibility, accessible setting shortcut, theme headers and top file controls. Artifacts: ' +
      root
  )
} catch (error) {
  await page.screenshot({ path: path.join(root, 'failure.png') }).catch(() => {})
  console.error(root)
  throw error
} finally {
  await app.evaluate(({ BrowserWindow }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.removeAllListeners('close')
      w.webContents.on('will-prevent-unload', (e) => e.preventDefault())
    }
  })
  await closeApp(app)
}
