import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { Cell } from '../shared/model'

import { ensureFolder, folderFile, readFolder } from '../electron/files'
import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'

// R-398: a row whose components are all hidden collapses, and a component set to grow takes the rows its content needs
// (up to its limit) and pushes the components below it down.
const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'card-grid-ui-'))
const media = path.join(root, 'Library')
const local = path.join(root, 'local')
for (const name of ['Plain', 'Noted', 'Huge']) {
  await fs.mkdir(path.join(media, name), { recursive: true })
}
const lib = new Library(local, undefined, false)
await lib.init()
await lib.create(media, { name: 'Grid', scanAll: true, depth: { mode: 'through', level: 2 } })
const project = lib.snapshot().projects[0].project!
const style = { textColor: '#e4e6e8', backgroundColor: 'transparent' }
const cells: Cell[] = [
  { cellId: 'name', kind: 'name', grid: { x: 0, y: 0, w: 12, h: 1 }, style },
  {
    cellId: 'note',
    kind: 'field-text',
    attributeId: 'note',
    condition: { attributeId: 'note', operator: 'set' },
    grid: { x: 0, y: 1, w: 12, h: 1 },
    style,
  },
  {
    cellId: 'long',
    kind: 'field-text',
    attributeId: 'long',
    growMax: 3,
    grid: { x: 0, y: 2, w: 12, h: 1 },
    style,
  },
  {
    cellId: 'after',
    kind: 'static-text',
    text: 'AFTER',
    grid: { x: 0, y: 3, w: 12, h: 1 },
    style,
  },
]
await lib.saveProject({
  ...project,
  fieldBindings: [
    { alias: '備註', attributeId: 'note', type: 'text' },
    { alias: '長文', attributeId: 'long', type: 'text' },
  ],
  cells,
  layoutPresets: [{ id: 'default', name: 'Default', cells }],
  activeLayoutId: 'default',
  cardView: { mode: 'single', level: 2 },
})
const words = (count: number) => Array.from({ length: count }, (_, i) => 'word' + i).join(' ')
for (const [name, values] of Object.entries({
  Plain: { long: words(14) },
  Noted: { note: 'has a note', long: 'short' },
  Huge: { long: words(2000) },
})) {
  await ensureFolder(path.join(media, name), false)
  const record = await readFolder(path.join(media, name))
  for (const [attributeId, value] of Object.entries(values)) {
    record.attributes.push({ attributeId, key: attributeId, type: 'text', value, source: 'manual' })
  }
  await fs.writeFile(folderFile(path.join(media, name)), JSON.stringify(record))
}
await lib.scan()

const errors: string[] = []
const { app, page } = await launchApp(local, errors)
let passed = false
try {
  await page.getByRole('button', { name: '開啟專案 Grid', exact: true }).first().click()
  const card = (name: string) => page.locator('.folder-card').filter({ hasText: name }).first()
  const boxes = (name: string) =>
    card(name)
      .locator('.card-cell')
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect()
          return {
            text: (node as HTMLElement).innerText.trim().slice(0, 12),
            top: Math.round(rect.top),
            bottom: Math.round(rect.bottom),
            height: Math.round(rect.height),
            cut: node.scrollHeight > node.clientHeight + 1,
          }
        })
      )
  await card('Plain').waitFor()
  // Plain: no note, so the note row is gone: three components, each directly under the one before (4px gap).
  await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll('.folder-card')]
        .find((c) => c.textContent?.includes(name))
        ?.querySelectorAll('.card-cell').length === 3,
    'Plain'
  )
  let plain = await boxes('Plain')
  assert.equal(plain.length, 3, JSON.stringify(plain))
  assert.equal(plain[1].top - plain[0].bottom, 4, 'the hidden note row is gone, not left blank')
  // The long text takes more than its one row, is not cut, and the component below follows it.
  assert.ok(plain[1].height > 42 && plain[1].height < 4 * 42 + 3 * 4, JSON.stringify(plain))
  assert.equal(plain[1].cut, false, 'grown to fit ' + JSON.stringify(plain))
  assert.equal(plain[2].top - plain[1].bottom, 4, 'the component below moved down with it')
  // Noted: the note row is back, the short text stays one row.
  const noted = await boxes('Noted')
  assert.equal(noted.length, 4, JSON.stringify(noted))
  assert.equal(noted[2].height, 42, 'short content keeps its single row')
  assert.equal(noted[3].top - noted[2].bottom, 4)
  // Huge: capped at 1 + 3 rows; what does not fit is cut, and the next component still follows.
  const huge = await boxes('Huge')
  assert.equal(huge[1].height, 4 * 42 + 3 * 4, JSON.stringify(huge))
  assert.equal(huge[2].top - huge[1].bottom, 4)
  // Resizing the window re-wraps the text, and the card follows without a reload.
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ x: 0, y: 0, width: 420, height: 900 })
  )
  await page.waitForFunction((before) => {
    const cell = [...document.querySelectorAll('.folder-card')]
      .find((c) => c.textContent?.includes('Plain'))
      ?.querySelectorAll('.card-cell')[1]
    return !!cell && cell.getBoundingClientRect().height > before
  }, plain[1].height)
  plain = await boxes('Plain')
  assert.ok(
    !plain[1].cut || plain[1].height === 4 * 42 + 3 * 4,
    'fits, or is capped: ' + JSON.stringify(plain)
  )
  assert.equal(plain[2].top - plain[1].bottom, 4)
  await page.screenshot({ path: path.join(root, 'card-grid.png') })
  assert.deepEqual(errors, [])
  passed = true
  console.log(
    'PASS card grid: hidden row collapses, content-height growth with cap and push. ' + root
  )
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
