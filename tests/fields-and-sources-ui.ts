// R-234 / R-240 / R-339 / R-381 / R-443 / R-480 / R-531 / R-538 / R-561:
// Consolidated field types, choices, yes/no wording, website-imported fields, source language order, and search sources in one Electron session.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { folderFile, readFolder, saveFolder } from '../electron/files'
import { Library } from '../electron/library'
import { closeApp, launchApp, openLayoutEditor, removeTestRoot, reportFailure } from './support/app'

const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'fields-and-sources-ui-'))
const local = path.join(root, 'local')

// Project 1: Dates (date <-> text conversion).
const datesMedia = path.join(root, 'DatesLib')
for (const name of ['Work A', 'Work B']) {
  await fs.mkdir(path.join(datesMedia, name), { recursive: true })
}
// Project 2: Choices (enum option add + folder type).
const choicesMedia = path.join(root, 'ChoicesLib')
await fs.mkdir(path.join(choicesMedia, 'Work'), { recursive: true })
// Project 3: Sources (own fields + click-to-edit site fields + restore + remove site).
const sourcesMedia = path.join(root, 'SourcesLib')
await fs.mkdir(path.join(sourcesMedia, 'Work'), { recursive: true })
// Project 4: Wording (custom yes/no wording).
const wordingMedia = path.join(root, 'WordingLib')
await fs.mkdir(wordingMedia, { recursive: true })
// Project 5: Search (source search sources + language order).
const searchMedia = path.join(root, 'SearchLib')
await fs.mkdir(path.join(searchMedia, 'Work'), { recursive: true })

const library = new Library(local, undefined, false)
await library.init()

// Setup Dates project.
const datesCreated = await library.create(datesMedia, {
  name: 'Dates',
  scanAll: true,
  depth: { mode: 'through', level: 2 },
})
const datesProject = datesCreated.projects.find((p) => p.project?.name === 'Dates')!.project!
const style = { textColor: '#e4e6e8', backgroundColor: 'transparent' }
const released = crypto.randomUUID()
const dateNote = crypto.randomUUID()
for (const [name, value] of [
  ['Work A', '12 Nov, 2020'],
  ['Work B', '1999'],
]) {
  const dir = path.join(datesMedia, name)
  const record = await readFolder(dir)
  record.attributes.push({
    attributeId: dateNote,
    key: '備註',
    type: 'string',
    value,
    source: 'manual',
  })
  await saveFolder(dir, record, record.revision)
}
await library.saveProject({
  ...datesProject,
  fieldBindings: [
    { alias: '發售日', attributeId: released, type: 'date' },
    { alias: '備註', attributeId: dateNote, type: 'string' },
  ],
  cells: [
    ...datesProject.cells,
    {
      cellId: crypto.randomUUID(),
      kind: 'field-date-only',
      attributeId: released,
      grid: { x: 0, y: 6, w: 12, h: 1 },
      style,
    },
    {
      cellId: crypto.randomUUID(),
      kind: 'static-text',
      text: '新作',
      grid: { x: 0, y: 7, w: 12, h: 1 },
      style,
      condition: { attributeId: released, operator: 'within', value: 90 },
    },
    {
      cellId: crypto.randomUUID(),
      kind: 'field-text',
      attributeId: dateNote,
      grid: { x: 0, y: 8, w: 12, h: 1 },
      style,
    },
  ],
})

// Setup Choices project.
const choicesCreated = await library.create(choicesMedia, {
  name: 'Choices',
  scanAll: true,
  depth: { mode: 'through', level: 2 },
})
const choicesProject = choicesCreated.projects.find((p) => p.project?.name === 'Choices')!.project!
const statusId = crypto.randomUUID()
await library.saveProject({
  ...choicesProject,
  fieldBindings: [
    { alias: '狀態', attributeId: statusId, type: 'enum', options: ['進行中', '已完成'] },
  ],
})

// Setup Sources project.
const sourcesCreated = await library.create(sourcesMedia, {
  name: 'Sources',
  scanAll: true,
  depth: { mode: 'through', level: 2 },
})
const sourcesProject = sourcesCreated.projects.find((p) => p.project?.name === 'Sources')!.project!
const srcNote = crypto.randomUUID()
const srcRating = crypto.randomUUID()
await library.saveProject({
  ...sourcesProject,
  fieldBindings: [
    { alias: '備註', attributeId: srcNote, type: 'string' },
    { alias: '評分', attributeId: srcRating, type: 'string' },
    { alias: '標題（VNDB）', attributeId: 'vndb-title', type: 'string' },
  ],
})
const srcRecord = await readFolder(sourcesMedia)
const sourceRecord = {
  provider: 'vndb',
  url: 'https://vndb.org/v97',
  fetchedAt: '2026-11-13T00:00:00Z',
}
srcRecord.attributes.push(
  { attributeId: srcNote, key: '備註', type: 'string', value: '我的備註', source: 'manual' },
  {
    attributeId: 'vndb-title',
    key: 'TITLE',
    type: 'string',
    value: 'Saya no Uta',
    source: 'vndb',
    sourceRecord,
  },
  {
    attributeId: 'vndb-released',
    key: 'RELEASE_DATE',
    type: 'string',
    value: '2003-12-26',
    source: 'vndb',
    sourceRecord,
  },
  {
    attributeId: 'vndb-source_url',
    key: 'SOURCE_URL',
    type: 'string',
    value: 'https://vndb.org/v97',
    source: 'vndb',
    sourceRecord,
  }
)
await saveFolder(sourcesMedia, srcRecord, srcRecord.revision)

// Setup Wording project.
const wordingCreated = await library.create(wordingMedia, {
  name: 'Wording',
  scanAll: true,
  depth: { mode: 'through', level: 1 },
})
const wordingProject = wordingCreated.projects.find((p) => p.project?.name === 'Wording')!.project!
await library.saveProject({
  ...wordingProject,
  fieldBindings: [{ alias: 'Owned', attributeId: 'owned', type: 'boolean' }],
  cells: [
    ...wordingProject.cells,
    {
      cellId: 'owned-cell',
      kind: 'field-boolean',
      attributeId: 'owned',
      grid: { x: 0, y: 10, w: 12, h: 1 },
      style,
    },
  ],
})
const wordingRecord = await readFolder(wordingMedia)
wordingRecord.attributes = [
  { attributeId: 'owned', key: 'Owned', type: 'boolean', value: true, source: 'manual' },
]
await fs.writeFile(folderFile(wordingMedia), JSON.stringify(wordingRecord))

// Setup Search project.
await library.create(searchMedia, {
  name: 'Search',
  scanAll: true,
  depth: { mode: 'through', level: 2 },
})
await library.scan()

const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1500, height: 950 })
const button = (name: string) => page.getByRole('button', { name, exact: true })
let passed = false
try {
  // 1. R-381 / R-480: source language order in application settings.
  await page.locator('.titlebar').getByRole('button', { name: '應用程式設定', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '應用程式設定', exact: true })
  const langSection = settings.getByRole('region', { name: '外部來源語言', exact: true })
  const follow = langSection.getByRole('checkbox', { name: '跟著介面語言', exact: true })
  await follow.waitFor()
  assert.equal(await follow.isChecked(), true)
  assert.equal(await langSection.getByRole('listitem').count(), 0)
  const savedLangs = () =>
    page.evaluate(async () => (await window.desktop.workspace()).prefs.sourceLanguages ?? null)
  assert.equal(await savedLangs(), null)
  await follow.click()
  await langSection.getByRole('listitem').first().waitFor()
  assert.equal(await langSection.getByRole('listitem').count(), 5)
  assert.deepEqual(await savedLangs(), ['zh-TW', 'ja', 'zh-CN', 'en', 'es'])
  const grip = langSection.getByRole('button', { name: '移動語言順序 繁體中文', exact: true })
  await grip.focus()
  await page.keyboard.press('Alt+ArrowDown')
  await page.waitForFunction(
    async () => (await window.desktop.workspace()).prefs.sourceLanguages?.[0] === 'ja'
  )
  assert.deepEqual(await savedLangs(), ['ja', 'zh-TW', 'zh-CN', 'en', 'es'])
  assert.equal(await grip.evaluate((node) => node === document.activeElement), true)
  await page.keyboard.press('Alt+ArrowDown')
  await page.waitForFunction(
    async () => (await window.desktop.workspace()).prefs.sourceLanguages?.[2] === 'zh-TW'
  )
  assert.equal(await grip.evaluate((node) => node === document.activeElement), true)
  await page.keyboard.press('Alt+ArrowUp')
  await page.waitForFunction(
    async () => (await window.desktop.workspace()).prefs.sourceLanguages?.[1] === 'zh-TW'
  )
  assert.match(
    (await langSection.getByRole('listitem').first().innerText()).replace(/\s+/g, ' '),
    /1 日本語/
  )
  const rows = langSection.getByRole('listitem')
  const fire = (index: number, type: string, half: 'top' | 'bottom' | 'none') =>
    rows.nth(index).evaluate(
      (el, [type, half]) => {
        const box = el.getBoundingClientRect()
        const data = new DataTransfer()
        el.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: data,
            clientY: half === 'top' ? box.top + 2 : box.bottom - 2,
          })
        )
      },
      [type, half]
    )
  const marks = () =>
    rows.evaluateAll((list) => list.map((el) => el.className.replace(/sort-key ?/, '')))
  await rows
    .nth(0)
    .getByRole('button')
    .first()
    .dispatchEvent('dragstart', {
      dataTransfer: await page.evaluateHandle(() => new DataTransfer()),
    })
  await fire(3, 'dragover', 'bottom')
  assert.deepEqual(await marks(), ['dragging', '', '', 'drop-after', ''])
  await fire(3, 'dragover', 'top')
  assert.deepEqual(await marks(), ['dragging', '', '', 'drop-before', ''])
  await page.screenshot({ path: path.join(base, 'shot', 'r480-drop-line.png') })
  await fire(1, 'dragover', 'top')
  assert.deepEqual(
    await marks(),
    ['dragging', '', '', '', ''],
    'no line where nothing would change'
  )
  await fire(3, 'dragover', 'bottom')
  await fire(3, 'drop', 'bottom')
  await page.waitForFunction(
    async () => (await window.desktop.workspace()).prefs.sourceLanguages?.[3] === 'ja'
  )
  assert.deepEqual(await savedLangs(), ['zh-TW', 'zh-CN', 'en', 'ja', 'es'])
  assert.deepEqual(await marks(), ['', '', '', '', ''])
  await page.screenshot({ path: path.join(base, 'shot', 'r381-source-languages.png') })
  await follow.click()
  await page.waitForFunction(async () => !(await window.desktop.workspace()).prefs.sourceLanguages)
  assert.equal(await langSection.getByRole('listitem').count(), 0)
  await page.keyboard.press('Escape')
  await settings.waitFor({ state: 'hidden' })

  // 2. R-240: date field to text and refused text to date.
  await page.getByRole('button', { name: '開啟專案 Dates', exact: true }).first().click()
  await openLayoutEditor(page)
  await page.locator('.editor-page').waitFor()
  await page.getByRole('button', { name: '更多欄位操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '管理全部欄位', exact: true }).click()
  const fieldDialog = page.getByRole('dialog', { name: '管理欄位' })
  const pickField = (name: string) =>
    fieldDialog.locator('button').filter({ hasText: name }).first().click()
  await pickField('發售日')
  await fieldDialog.getByRole('button', { name: '改成文字', exact: true }).click()
  const change = fieldDialog.locator('.field-detail-change')
  await change.getByText('1 個比較日期的條件（大於、小於、距今）會移除').waitFor()
  await change.getByRole('button', { name: '確認改用途', exact: true }).click()
  await change.waitFor({ state: 'hidden' })
  await fieldDialog.locator('.field-detail-purpose').getByText('文字', { exact: true }).waitFor()
  await pickField('備註')
  await fieldDialog.getByRole('button', { name: '改成…', exact: true }).click()
  await page.getByRole('menuitem', { name: '日期', exact: true }).click()
  const refusal = fieldDialog.locator('.field-detail-change').getByRole('alert')
  await refusal.waitFor()
  assert.match(await refusal.innerText(), /1999/)
  assert.doesNotMatch(await refusal.innerText(), /12 Nov/)
  assert.equal(
    await fieldDialog.getByRole('button', { name: '確認改用途', exact: true }).isDisabled(),
    true
  )
  await page.keyboard.press('Escape')
  await fieldDialog.waitFor({ state: 'hidden' })
  await page.evaluate(() => {
    window.confirm = () => true
  })
  await page.getByRole('button', { name: /^(放棄變更|關閉)$/ }).click()
  await page.locator('.editor-page').waitFor({ state: 'hidden' })

  // 3. Add enum choice option from folder settings + folder type detection/switching.
  await page.getByRole('button', { name: '開啟專案 Choices', exact: true }).first().click()
  await button('目前資料夾設定').click()
  await page.getByRole('button', { name: /^填入其他/ }).click()
  await page.getByRole('menuitem', { name: '狀態', exact: true }).click()
  const optInput = page.getByRole('textbox', { name: '新增選項 狀態', exact: true })
  await optInput.fill('暫停')
  await button('新增選項').click()
  await page.getByRole('textbox', { name: '狀態', exact: true }).waitFor()
  await page.waitForFunction(
    () =>
      (document.querySelector('input[aria-label="新增選項 狀態"]') as HTMLInputElement)?.value ===
      ''
  )
  assert.equal(await page.getByRole('textbox', { name: '狀態', exact: true }).inputValue(), '暫停')
  await page.getByRole('textbox', { name: '狀態', exact: true }).click()
  const options = await page.getByRole('option').allInnerTexts()
  assert.deepEqual(options, ['進行中', '已完成', '暫停'])
  await page.keyboard.press('Escape')
  const savebar = page.getByRole('region', { name: '未保存的變更', exact: true })
  await savebar.waitFor()
  await savebar.getByText('有 1 項未保存').waitFor()
  assert.equal(await page.getByRole('img', { name: '未保存', exact: true }).count(), 1)
  await savebar.getByRole('button', { name: '放棄', exact: true }).click()
  await savebar.waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('textbox', { name: '狀態', exact: true }).inputValue(), '')
  assert.equal(await page.locator('label').filter({ hasText: '僅此專案' }).count(), 0)
  await page.getByRole('tab', { name: '類型與版面', exact: true }).click()
  const kind = page.getByRole('textbox', { name: '資料夾類型', exact: true })
  await kind.waitFor()
  assert.match(await kind.inputValue(), /^自動（偵測為 /)
  await kind.click()
  await page.getByRole('option', { name: '一般', exact: true }).click()
  await page.waitForFunction(() =>
    [...document.querySelectorAll('input')].some((input) => input.value === '一般')
  )
  assert.equal(await page.getByRole('tab', { name: '遊戲操作', exact: true }).count(), 0)
  await kind.click()
  await page.getByRole('option', { name: '遊戲', exact: true }).click()
  await page.getByRole('tab', { name: '遊戲操作', exact: true }).waitFor()
  await kind.click()
  await page.getByRole('option', { name: '一般', exact: true }).click()
  await page.getByRole('tab', { name: '遊戲操作', exact: true }).waitFor({ state: 'detached' })
  await page.getByRole('tab', { name: '進階', exact: true }).click()
  await page.getByText('技術細節（原始資料）').waitFor()
  await page
    .getByRole('tabpanel', { name: '進階' })
    .getByText('掃描範圍', { exact: true })
    .waitFor()

  // 4. R-339 / R-538 / R-561: own fields, fill-in menu, click-to-edit site values, restore, remove site.
  await page.getByRole('button', { name: '開啟專案 Sources', exact: true }).first().click()
  await button('目前資料夾設定').click()
  await page.getByRole('textbox', { name: '備註', exact: true }).waitFor()
  await page.getByRole('button', { name: '填入其他 (1)', exact: true }).click()
  await page.getByRole('menuitem', { name: '評分', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('checkbox', { name: /顯示未填欄位/ }).count(), 0) // ui-names: ignore
  const site = page.locator('.site-fields')
  await site.locator('summary').click()
  await site.getByRole('button', { name: '編輯 標題（VNDB）', exact: true }).click()
  const titleInput = site.getByRole('textbox', { name: '標題（VNDB）', exact: true })
  await titleInput.waitFor()
  assert.equal(await titleInput.inputValue(), 'Saya no Uta')
  await titleInput.fill('沙耶の唄')
  await button('保存欄位資料').click()
  await page.waitForFunction(() => !document.querySelector('.settings-savebar'))
  for (let i = 0; i < 50; i++) {
    const now = (await readFolder(sourcesMedia)).attributes.find(
      (x) => x.attributeId === 'vndb-title'
    )
    if (now?.value === '沙耶の唄' && now.source === 'manual') break
    await page.waitForTimeout(100)
  }
  const edited = (await readFolder(sourcesMedia)).attributes.find(
    (x) => x.attributeId === 'vndb-title'
  )
  assert.equal(edited?.value, '沙耶の唄')
  assert.equal(edited?.source, 'manual')
  assert.equal(edited?.sourceRecord?.originalValue, 'Saya no Uta')
  await page.screenshot({ path: path.join(base, 'shot', 'r561-fields.png') })
  await site.getByRole('button', { name: '恢復來源值 標題（VNDB）', exact: true }).click()
  for (let i = 0; i < 50; i++) {
    const now = (await readFolder(sourcesMedia)).attributes.find(
      (x) => x.attributeId === 'vndb-title'
    )
    if (now?.value === 'Saya no Uta' && now.source !== 'manual') break
    await page.waitForTimeout(100)
  }
  const restored = (await readFolder(sourcesMedia)).attributes.find(
    (x) => x.attributeId === 'vndb-title'
  )
  assert.equal(restored?.value, 'Saya no Uta')
  assert.notEqual(restored?.source, 'manual')
  assert.equal(restored?.sourceRecord?.originalValue, undefined)
  await titleInput.fill('沙耶の唄')
  await button('保存欄位資料').click()
  await page.waitForFunction(() => !document.querySelector('.settings-savebar'))
  for (let i = 0; i < 50; i++) {
    const now = (await readFolder(sourcesMedia)).attributes.find(
      (x) => x.attributeId === 'vndb-title'
    )
    if (now?.value === '沙耶の唄' && now.source === 'manual') break
    await page.waitForTimeout(100)
  }
  await page.waitForTimeout(300)
  await page.evaluate(() => {
    window.confirm = () => true
  })
  await site.getByRole('button', { name: '移除這個來源的資料', exact: true }).click()
  let savedSrc = await readFolder(sourcesMedia)
  for (
    let i = 0;
    i < 50 && savedSrc.attributes.some((a) => a.attributeId === 'vndb-released');
    i++
  ) {
    await page.waitForTimeout(100)
    savedSrc = await readFolder(sourcesMedia)
  }
  assert.deepEqual(
    savedSrc.attributes.map((a) => [a.attributeId, a.value]).sort(),
    [
      [srcNote, '我的備註'],
      ['vndb-title', '沙耶の唄'],
    ].sort()
  )
  assert.equal(
    savedSrc.attributes.find((a) => a.attributeId === 'vndb-title')?.sourceRecord,
    undefined
  )

  // 5. R-234: custom yes/no wording on canvas, palette, card, and folder settings.
  await page.getByRole('button', { name: '開啟專案 Wording', exact: true }).first().click()
  await page.locator('.workspace-toolbar').waitFor()
  await openLayoutEditor(page)
  await page.locator('.editor-page').waitFor()
  await button('欄位操作 Owned').click()
  await page.getByRole('menuitem', { name: '欄位設定…', exact: true }).click()
  const manager = page.getByRole('dialog', { name: '管理欄位', exact: true })
  await manager.getByRole('textbox', { name: '「是」顯示為', exact: true }).fill('已收藏')
  await manager.getByRole('textbox', { name: '「否」顯示為', exact: true }).fill('未收藏')
  await page.keyboard.press('Escape')
  await manager.waitFor({ state: 'hidden' })
  await page.locator('.editor-cell').getByText('已收藏', { exact: true }).waitFor()
  await page
    .locator('.palette-field')
    .filter({ hasText: 'Owned' })
    .getByText('已收藏', { exact: true })
    .waitFor()
  await button('儲存').click()
  await page.locator('.editor-page').waitFor({ state: 'hidden' })
  await page
    .locator('.folder-card, .card-grid')
    .getByText('已收藏', { exact: true })
    .first()
    .waitFor()
  await button('目前資料夾設定').click()
  const owned = page.getByRole('textbox', { name: 'Owned', exact: true })
  await owned.waitFor()
  assert.equal(await owned.inputValue(), '已收藏')

  // 6. R-443: name search sources selector button, groups, keyless sources, empty choice, defaults.
  await page.getByRole('button', { name: '開啟專案 Search', exact: true }).first().click()
  await page.locator('.folder-card', { hasText: 'Work' }).first().waitFor()
  await button('目前資料夾設定').click()
  await page.locator('.folder-panel-dock-settings').waitFor()
  await button('從網站匯入…').click()
  const sourcesBtn = page.locator('.source-search-sources')
  await sourcesBtn.waitFor()
  assert.equal((await sourcesBtn.innerText()).trim(), 'VNDB +6')
  const searchButton = button('搜尋')
  assert.equal(await searchButton.isDisabled(), false)
  assert.equal(await page.getByRole('textbox', { name: '搜尋的來源', exact: true }).count(), 0)
  await sourcesBtn.click()
  const menu = page.locator('.source-search-menu')
  await menu.getByText('需要金鑰', { exact: true }).waitFor()
  await menu.getByText('成人向', { exact: true }).waitFor()
  assert.equal(await menu.getByRole('checkbox', { name: /^TMDB/ }).isDisabled(), true)
  await page.screenshot({ path: path.join(base, 'shot', 'r443-sources.png') })
  await menu.getByRole('checkbox', { name: 'VNDB', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.source-search-sources')?.textContent?.trim() === 'MusicBrainz +5'
  )
  await page.waitForFunction(async () => {
    const saved = (await window.desktop.workspace()).prefs.searchSources?.general
    return !!saved && !saved.includes('vndb') && saved.includes('musicbrainz')
  })
  for (const name of ['MusicBrainz', 'AniList', 'Bangumi', 'Steam', 'DLsite', 'nhentai']) {
    await menu.getByRole('checkbox', { name, exact: true }).click()
  }
  await page.waitForFunction(
    () => document.querySelector('.source-search-sources')?.textContent?.trim() === '未選來源'
  )
  assert.equal(await searchButton.isDisabled(), true)
  await menu.getByRole('button', { name: '還原此類型預設', exact: true }).click()
  await page.waitForFunction(
    () => document.querySelector('.source-search-sources')?.textContent?.trim() === 'VNDB +6'
  )
  assert.equal(await searchButton.isDisabled(), false)

  assert.deepEqual(errors, [])
  passed = true
  console.log(
    'PASS fields & sources (language order, date fields, enum choices, site fields, yes/no wording, search sources). ' +
      root
  )
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
