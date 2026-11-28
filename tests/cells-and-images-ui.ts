// R-239 / R-409 / R-509 / R-531:
// Consolidated image delete, n-th image & folder cover, condition rules, and scrolling tag cell checks in one Electron session.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

import { type Cell, DATA_DIR, type Project } from '../shared/model'

import { crc32 } from '../electron/archive'
import {
  ensureFolder,
  folderFile,
  projectFile,
  readFolder,
  readJson,
  saveFolder,
} from '../electron/files'
import { Library } from '../electron/library'
import {
  closeApp,
  launchApp,
  openLayoutEditor,
  openPanel,
  removeTestRoot,
  reportFailure,
} from './support/app'

function solidPng(width: number, height: number) {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data])
    const head = Buffer.alloc(4)
    const tail = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    tail.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([head, body, tail])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 120)])
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'cells-and-images-ui-'))
const local = path.join(root, 'local')
const style = { textColor: '#e4e6e8', backgroundColor: 'transparent' }

// Project 1: Pics (image delete).
const picsMedia = path.join(root, 'Pics')
await fs.mkdir(picsMedia, { recursive: true })
await fs.writeFile(path.join(picsMedia, 'original.txt'), 'PRESERVE ORIGINAL')

// Project 2: Nth (n-th image cell & cover).
const nthMedia = path.join(root, 'NthLib')
await fs.mkdir(path.join(nthMedia, 'Pictures'), { recursive: true })
await fs.mkdir(path.join(nthMedia, 'Empty'), { recursive: true })
await fs.writeFile(path.join(nthMedia, 'Empty', 'notes.txt'), 'no images')
for (const name of ['2.png', '1.png']) {
  await fs.writeFile(path.join(nthMedia, 'Pictures', name), solidPng(16, 16))
}

// Project 3: Rules (text rules & multi-conditions).
const rulesMedia = path.join(root, 'RulesLib')
await fs.mkdir(rulesMedia, { recursive: true })

// Project 4: Scroll (scrolling tag cell & +N overflow).
const scrollMedia = path.join(root, 'ScrollLib')
await fs.mkdir(path.join(scrollMedia, 'Many'), { recursive: true })

const lib = new Library(local, undefined, false)
await lib.init()

// Setup Pics.
await lib.create(picsMedia, { name: 'Pics', scanAll: true, depth: { mode: 'through', level: 2 } })
const picsRow = lib.snapshot().rows.find((r) => r.path === picsMedia)!
const picsRecord = await readFolder(picsRow.path)
const assetIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
await fs.mkdir(path.join(picsRow.path, DATA_DIR, 'assets'), { recursive: true })
const smallPng = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)])
for (const [i, assetId] of assetIds.entries()) {
  await fs.writeFile(path.join(picsRow.path, DATA_DIR, 'assets', assetId + '.png'), smallPng)
  picsRecord.assets.push({
    assetId,
    relativePath: `assets/${assetId}.png`,
    originalName: `pic${i + 1}.png`,
    mediaType: 'image/png',
  })
}
await saveFolder(picsRow.path, picsRecord, picsRecord.revision)

// Setup Nth.
await lib.create(nthMedia, { name: 'Nth', scanAll: true, depth: { mode: 'through', level: 2 } })
const nthProject = lib.snapshot().projects.find((p) => p.project?.name === 'Nth')!.project!
const nthCells: Cell[] = [
  { cellId: 'name', kind: 'name', grid: { x: 0, y: 0, w: 12, h: 1 }, style },
  {
    cellId: 'second',
    kind: 'image',
    attributeId: 'pic',
    imageIndex: 2,
    grid: { x: 0, y: 1, w: 6, h: 3 },
    style,
  },
  {
    cellId: 'third',
    kind: 'image',
    attributeId: 'pic3',
    imageIndex: 3,
    grid: { x: 6, y: 1, w: 6, h: 3 },
    style,
  },
  {
    cellId: 'cover',
    kind: 'image',
    attributeId: 'pic4',
    imageCover: true,
    grid: { x: 0, y: 4, w: 6, h: 3 },
    style,
  },
]
await lib.saveProject({
  ...nthProject,
  cells: nthCells,
  layoutPresets: [{ id: 'default', name: 'Default', cells: nthCells }],
  activeLayoutId: 'default',
  cardView: { mode: 'single', level: 2 },
})

// Setup Rules.
await lib.create(rulesMedia, { name: 'Rules', scanAll: true, depth: { mode: 'through', level: 1 } })
const rulesProject = lib.snapshot().projects.find((p) => p.project?.name === 'Rules')!.project!
await lib.saveProject({
  ...rulesProject,
  fieldBindings: [
    { alias: 'Released', attributeId: 'released', type: 'date' },
    { alias: 'Score', attributeId: 'score', type: 'number' },
  ],
  cells: [
    ...rulesProject.cells,
    { cellId: 'label', kind: 'static-text', text: '', grid: { x: 0, y: 10, w: 6, h: 1 }, style },
    {
      cellId: 'note',
      kind: 'static-text',
      text: 'Shown',
      grid: { x: 6, y: 10, w: 6, h: 1 },
      style,
    },
  ],
})
const recent = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10)
const rulesRecord = await readFolder(rulesMedia)
rulesRecord.attributes = [
  { attributeId: 'released', key: 'Released', type: 'date', value: recent, source: 'manual' },
  { attributeId: 'score', key: 'Score', type: 'number', value: 2, source: 'manual' },
]
await fs.writeFile(folderFile(rulesMedia), JSON.stringify(rulesRecord))

// Setup Scroll.
await lib.create(scrollMedia, {
  name: 'Scroll',
  scanAll: true,
  depth: { mode: 'through', level: 2 },
})
const scrollProject = lib.snapshot().projects.find((p) => p.project?.name === 'Scroll')!.project!
const scrollCells: Cell[] = [
  { cellId: 'name', kind: 'name', grid: { x: 0, y: 0, w: 12, h: 1 }, style },
  {
    cellId: 'scrolling',
    kind: 'field-tags',
    attributeId: 'tags',
    scroll: true,
    grid: { x: 0, y: 1, w: 12, h: 2 },
    style,
  },
  {
    cellId: 'cut',
    kind: 'field-tags',
    attributeId: 'tags',
    grid: { x: 0, y: 3, w: 12, h: 2 },
    style,
  },
]
await lib.saveProject({
  ...scrollProject,
  fieldBindings: [{ alias: '標籤', attributeId: 'tags', type: 'tags' }],
  cells: scrollCells,
  layoutPresets: [{ id: 'default', name: 'Default', cells: scrollCells }],
  activeLayoutId: 'default',
  cardView: { mode: 'single', level: 2 },
})
await ensureFolder(path.join(scrollMedia, 'Many'), false)
const scrollRecord = await readFolder(path.join(scrollMedia, 'Many'))
scrollRecord.attributes.push({
  attributeId: 'tags',
  key: 'TAGS',
  type: 'tags',
  value: Array.from({ length: 40 }, (_, i) => 'female:tag number ' + i),
  source: 'manual',
})
await fs.writeFile(folderFile(path.join(scrollMedia, 'Many')), JSON.stringify(scrollRecord))
await lib.scan()

const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1500, height: 950 })
const button = (name: string) => page.getByRole('button', { name, exact: true })
const box = (name: string) => page.getByRole('textbox', { name, exact: true })
const pick = async (name: string, option: string) => {
  await box(name).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
let passed = false
try {
  // 1. Image delete: confirm, cancel keeps, delete removes record and managed file.
  await page.getByRole('button', { name: '開啟專案 Pics', exact: true }).first().click()
  await openPanel(page)
  await page.locator('.folder-panel-header').waitFor()
  await page.getByRole('tab', { name: '設定', exact: true }).click()
  await page.locator('.folder-panel-dock-settings').waitFor()
  await page.getByRole('tab', { name: '圖片', exact: true }).click()
  assert.equal(await page.locator('.images figure').count(), 2)
  const del = button('刪除圖片 pic1.png')
  await page.evaluate(() => {
    ;(window as unknown as { __msg: string }).__msg = ''
    window.confirm = (msg) => {
      ;(window as unknown as { __msg: string }).__msg = String(msg)
      return false
    }
  })
  await del.focus()
  await page.keyboard.press('Enter')
  assert.match(
    await page.evaluate(() => (window as unknown as { __msg: string }).__msg),
    /pic1\.png/
  )
  assert.equal(await page.locator('.images figure').count(), 2)
  assert.equal((await readFolder(picsRow.path)).assets.length, 2)
  await page.evaluate(() => {
    window.confirm = () => true
  })
  await del.click()
  await page.waitForFunction(() => document.querySelectorAll('.images figure').length === 1)
  const afterDel = await readFolder(picsRow.path)
  assert.deepEqual(
    afterDel.assets.map((a) => a.assetId),
    [assetIds[1]]
  )
  await assert.rejects(fs.access(path.join(picsRow.path, DATA_DIR, 'assets', assetIds[0] + '.png')))
  await fs.access(path.join(picsRow.path, DATA_DIR, 'assets', assetIds[1] + '.png'))
  assert.equal(await fs.readFile(path.join(picsMedia, 'original.txt'), 'utf8'), 'PRESERVE ORIGINAL')

  // 2. R-409 / R-509: n-th image cell, folder cover, missing placeholder, Images tab.
  await page.getByRole('button', { name: '開啟專案 Nth', exact: true }).first().click()
  const card = (name: string) =>
    page
      .locator('.folder-card')
      .filter({ has: page.locator('.cell-name').getByText(name, { exact: true }) })
  await card('Pictures').waitFor()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.folder-card img.cell-image')].filter(
        (img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0
      ).length === 2
  )
  assert.equal(await card('Pictures').locator('img.cell-image').count(), 2)
  assert.equal(await card('Pictures').locator('img.cell-image[src*="media://cover/"]').count(), 1)
  assert.equal(await card('Pictures').getByText('沒有圖片').count(), 1)
  await card('Empty').waitFor()
  await card('Empty').getByText('沒有圖片').first().waitFor()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('.folder-card')].some(
      (c) => c.textContent?.includes('Empty') && c.textContent.split('沒有圖片').length === 4
    )
  )
  await card('Pictures').locator('.cell-name').click()
  await page.getByRole('tab', { name: /^設定/ }).click()
  await page.getByRole('tab', { name: '圖片', exact: true }).click()
  const cover = page.locator('.image-cover')
  await cover.getByText('自動：資料夾裡的圖片或音樂封面', { exact: true }).waitFor()
  await cover.locator('.image-thumb-auto').waitFor()
  const others = page.locator('.image-others')
  await others.getByText('版面上的其他圖片', { exact: true }).waitFor()
  assert.equal(
    await others.locator('.image-slot').count(),
    2,
    'n-th components listed, cover component not'
  )
  await others.getByText('卡片的圖片 1', { exact: true }).waitFor()
  await others.getByText('沒選圖時：資料夾裡第 2 張圖', { exact: true }).waitFor()
  await others.locator('.image-slot').first().locator('.image-thumb-auto').waitFor()
  await others.locator('.image-slot').nth(1).getByText('選擇圖片', { exact: true }).waitFor()

  // 3. R-239: layout text rules and two display conditions (any).
  await page.getByRole('button', { name: '開啟專案 Rules', exact: true }).first().click()
  await openLayoutEditor(page)
  await page.locator('.editor-page').waitFor()
  await page.locator('.editor-cell[data-cell-id="label"]').click()
  await page.getByRole('tab', { name: '內容', exact: true }).click()
  await button('新增規則').click()
  await pick('規則 1 的欄位', 'Released')
  await pick('規則 1 的條件', '距今 N 天內')
  await page.getByRole('textbox', { name: '規則 1 的比較值' }).fill('90')
  await box('規則 1 顯示的文字').fill('New')
  await page.getByLabel('其他情況顯示的文字（留空就不顯示）').waitFor()
  await page
    .locator('.editor-cell[data-cell-id="label"]')
    .getByText('New', { exact: true })
    .waitFor()
  await page.locator('.editor-cell[data-cell-id="note"]').click()
  await button('其他選項').click()
  await pick('顯示條件欄位', 'Score')
  await pick('顯示條件', '大於')
  await page.getByRole('textbox', { name: '比較值' }).fill('4')
  await page.locator('.editor-cell[data-cell-id="note"] .cell-condition-hidden').waitFor()
  await button('新增條件').click()
  await pick('條件 2 的欄位', 'Released')
  await pick('條件 2', '距今 N 天內')
  await page.getByRole('radiogroup', { name: '條件要', exact: true }).getByText('任一符合').click()
  await page
    .locator('.editor-cell[data-cell-id="note"]')
    .getByText('Shown', { exact: true })
    .waitFor()
  await button('儲存').click()
  await page.locator('.editor-page').waitFor({ state: 'hidden' })
  const savedRules = (await readJson(projectFile(rulesMedia, rulesProject.projectId))) as Project
  const labelCell = savedRules.cells.find((c) => c.cellId === 'label')!
  const noteCell = savedRules.cells.find((c) => c.cellId === 'note')!
  assert.deepEqual(labelCell.textRules, [
    { when: { attributeId: 'released', operator: 'within', value: 90 }, text: 'New' },
  ])
  assert.equal(noteCell.condition?.operator, 'gt')
  assert.equal(noteCell.moreConditions?.[0].operator, 'within')
  assert.equal(noteCell.conditionMode, 'any')
  await page.locator('.card-grid').getByText('New', { exact: true }).first().waitFor()

  // 4. Scrolling tag cell, +N overflow tooltip, wheel & keyboard scroll, palette real-data preview.
  await page.getByRole('button', { name: '開啟專案 Scroll', exact: true }).first().click()
  const body = page.locator('.folder-card .cell-scroll-body')
  await body.waitFor()
  assert.equal(
    await page.locator('.folder-card .cell-scroll-body').count(),
    1,
    'only the scrolling cell'
  )
  assert.equal(await body.locator('.mantine-Badge-root').count(), 40, 'every tag is there')
  const cut = page.locator('.folder-card .tag-list-fit')
  await cut.waitFor()
  const more = cut.locator('[data-more]')
  await page.waitForFunction(
    () =>
      document
        .querySelector('.folder-card .tag-list-fit [data-more]')
        ?.getAttribute('style')
        ?.includes('display: none') === false
  )
  await page.waitForFunction(() => {
    const list = document.querySelector('.folder-card .tag-list-fit')
    const hidden = [...(list?.querySelectorAll<HTMLElement>('[data-tag]') ?? [])].filter(
      (node) => node.style.display === 'none'
    ).length
    return hidden > 0 && list?.querySelector<HTMLElement>('[data-more]')?.innerText === '+' + hidden
  })
  const hidden = await cut
    .locator('[data-tag]')
    .evaluateAll(
      (nodes) => nodes.filter((node) => (node as HTMLElement).style.display === 'none').length
    )
  assert.ok(hidden > 0 && (await more.innerText()) === '+' + hidden, String(hidden))
  assert.ok(((await cut.getAttribute('title')) ?? '').includes('tag number 39'))
  assert.equal(await body.locator('[data-more]').count(), 0, 'a scrolling cell hides nothing')
  const metrics = () =>
    body.evaluate((node) => ({
      client: node.clientHeight,
      scroll: node.scrollHeight,
      top: node.scrollTop,
      parent: node.parentElement!.clientHeight,
    }))
  const before = await metrics()
  assert.ok(before.scroll > before.client && before.client <= before.parent, JSON.stringify(before))
  await body.hover()
  await page.mouse.wheel(0, 120)
  await page.waitForFunction(
    () => document.querySelector('.folder-card .cell-scroll-body')!.scrollTop > 0
  )
  await body.focus()
  await page.keyboard.press('PageDown')
  assert.ok((await metrics()).top > 0)
  await openLayoutEditor(page)
  const value = page.locator('.palette-field[data-attribute-id="tags"] .palette-field-value')
  await value.waitFor()
  assert.equal(await value.innerText(), '沒有值', 'a folder without the field')
  await page.getByRole('textbox', { name: '使用真實資料預覽', exact: true }).click()
  await page.getByRole('option', { name: /^Many/ }).click()
  assert.ok((await value.innerText()).startsWith('female:tag number 0, '))
  assert.ok(((await value.getAttribute('title')) ?? '').includes('tag number 39'))
  assert.equal(
    await value.evaluate((node) => node.scrollWidth > node.clientWidth && node.clientHeight < 24),
    true,
    'one line, cut with an ellipsis'
  )

  assert.deepEqual(errors, [])
  passed = true
  console.log(
    'PASS cells & images (image delete, n-th image & cover, condition rules, scrolling tags). ' +
      root
  )
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
