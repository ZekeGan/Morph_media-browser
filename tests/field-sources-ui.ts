import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { readFolder, saveFolder } from '../electron/files'
import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'

// R-339: the Data tab shows your own fields first (empty ones as "fill in" chips) and each website's imported values
// read-only, with "change by hand" per field and "remove this site's data" per site.
const base = path.resolve('.test-output')
await fs.mkdir(base, { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'field-sources-ui-'))
const media = path.join(root, 'Library')
const work = path.join(media, 'Work')
const local = path.join(root, 'local')
await fs.mkdir(work, { recursive: true })
const library = new Library(local, undefined, false)
await library.init()
const created = await library.create(media, {
  name: 'Sources',
  scanAll: true,
  depth: { mode: 'through', level: 2 },
})
const project = created.projects[0].project!
const note = crypto.randomUUID()
const rating = crypto.randomUUID()
await library.saveProject({
  ...project,
  fieldBindings: [
    { alias: '備註', attributeId: note, type: 'string' },
    { alias: '評分', attributeId: rating, type: 'string' },
    { alias: '標題（VNDB）', attributeId: 'vndb-title', type: 'string' },
  ],
})
const record = await readFolder(media)
const sourceRecord = {
  provider: 'vndb',
  url: 'https://vndb.org/v97',
  fetchedAt: '2026-11-13T00:00:00Z',
}
record.attributes.push(
  { attributeId: note, key: '備註', type: 'string', value: '我的備註', source: 'manual' },
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
await saveFolder(media, record, record.revision)

const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1500, height: 950 })
let passed = false
try {
  await page.getByRole('button', { name: '開啟專案 Sources', exact: true }).first().click()
  await page.getByRole('button', { name: '目前資料夾設定', exact: true }).click()
  // Your own field is editable; the empty own field waits inside the compact "+ 填入其他" menu.
  await page.getByRole('textbox', { name: '備註', exact: true }).waitFor()
  await page.getByRole('button', { name: '填入其他 (1)', exact: true }).click()
  await page.getByRole('menuitem', { name: '評分', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('checkbox', { name: /顯示未填欄位/ }).count(), 0) // ui-names: ignore
  // R-538 / R-561: website-imported values render as compact 2-column click-to-edit rows inside a source card.
  const site = page.locator('.site-fields')
  await site.locator('summary').click()
  await site.getByRole('button', { name: '編輯 標題（VNDB）', exact: true }).click()
  const titleInput = site.getByRole('textbox', { name: '標題（VNDB）', exact: true })
  await titleInput.waitFor()
  assert.equal(await titleInput.inputValue(), 'Saya no Uta')
  await titleInput.fill('沙耶の唄')
  await page.getByRole('button', { name: '保存欄位資料', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.settings-savebar'))
  // The hand-made value is on disk with originalValue preserved for restore.
  for (let i = 0; i < 50; i++) {
    const now = (await readFolder(media)).attributes.find((x) => x.attributeId === 'vndb-title')
    if (now?.value === '沙耶の唄' && now.source === 'manual') break
    await page.waitForTimeout(100)
  }
  let edited = (await readFolder(media)).attributes.find((x) => x.attributeId === 'vndb-title')
  assert.equal(edited?.value, '沙耶の唄')
  assert.equal(edited?.source, 'manual')
  assert.equal(edited?.sourceRecord?.originalValue, 'Saya no Uta')
  await page.screenshot({ path: path.join(base, 'shot', 'r561-fields.png') })
  // Restoring the source value returns the original imported value and source.
  await site.getByRole('button', { name: '恢復來源值 標題（VNDB）', exact: true }).click()
  for (let i = 0; i < 50; i++) {
    const now = (await readFolder(media)).attributes.find((x) => x.attributeId === 'vndb-title')
    if (now?.value === 'Saya no Uta' && now.source !== 'manual') break
    await page.waitForTimeout(100)
  }
  const restored = (await readFolder(media)).attributes.find((x) => x.attributeId === 'vndb-title')
  assert.equal(restored?.value, 'Saya no Uta')
  assert.notEqual(restored?.source, 'manual')
  assert.equal(restored?.sourceRecord?.originalValue, undefined)
  // Edit again and save so we can verify "remove this site's data" keeps manual edits and strips sourceRecord.
  await titleInput.fill('沙耶の唄')
  await page.getByRole('button', { name: '保存欄位資料', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.settings-savebar'))
  for (let i = 0; i < 50; i++) {
    const now = (await readFolder(media)).attributes.find((x) => x.attributeId === 'vndb-title')
    if (now?.value === '沙耶の唄' && now.source === 'manual') break
    await page.waitForTimeout(100)
  }
  await page.waitForTimeout(300)
  // Removing VNDB's data keeps the value changed by hand and removes the site's sourceRecord.
  await page.evaluate(() => {
    window.confirm = () => true
  })
  await site.getByRole('button', { name: '移除這個來源的資料', exact: true }).click()
  let saved = await readFolder(media)
  for (let i = 0; i < 50 && saved.attributes.some((a) => a.attributeId === 'vndb-released'); i++) {
    await page.waitForTimeout(100)
    saved = await readFolder(media)
  }
  assert.deepEqual(
    saved.attributes.map((a) => [a.attributeId, a.value]).sort(),
    [
      [note, '我的備註'],
      ['vndb-title', '沙耶の唄'],
    ].sort()
  )
  assert.equal(
    saved.attributes.find((a) => a.attributeId === 'vndb-title')?.sourceRecord,
    undefined
  )
  assert.deepEqual(errors, [])
  passed = true
  console.log(
    'PASS own fields, fill-in chips, click-to-edit site values, restore source value, remove a site. ' +
      root
  )
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
