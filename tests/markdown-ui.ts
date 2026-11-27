import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'

// R-399: a Markdown file opens in the text reader typeset (headings, lists, tables, code), with no HTML run and no
// picture loaded, and the toolbar switches it back to the plain text.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'markdown-ui-'))
const media = path.join(root, 'Notes')
const local = path.join(root, 'local')
await fs.mkdir(media)
await fs.writeFile(
  path.join(media, 'note.md'),
  [
    '# Release notes',
    '',
    'A [site](https://example.com/page) and **bold** text.',
    '',
    '- first',
    '- second',
    '',
    '| name | value |',
    '| --- | --- |',
    '| a | 1 |',
    '',
    '```',
    'const x = 1',
    '```',
    '',
    '![remote](https://example.com/a.png)',
    '',
    '<script>window.hacked = 1</script>',
    '',
  ].join('\n')
)
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Markdown test',
  depth: { mode: 'through', level: 1 },
  scanAll: true,
})
const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1200, height: 820 })
const reader = () => page.getByRole('dialog', { name: '小說閱讀器', exact: true })
let passed = false
try {
  await page.getByRole('button', { name: '開啟專案 Markdown test', exact: true }).first().click()
  await page.getByText('note.md', { exact: true }).dblclick()
  await reader().waitFor()
  await reader().locator('.novel-md h1').waitFor()
  assert.equal(await reader().locator('.novel-md h1').innerText(), 'Release notes')
  assert.equal(await reader().locator('.novel-md li').count(), 2)
  assert.equal(await reader().locator('.novel-md table td').count(), 2)
  assert.equal(await reader().locator('.novel-md pre code').innerText(), 'const x = 1\n')
  assert.equal(await reader().locator('.novel-md a[role="link"]').count(), 1)
  assert.equal(
    await reader().locator('.novel-md a[href]').count(),
    0,
    'links carry no address to navigate to'
  )
  assert.equal(await reader().locator('.novel-content img, .novel-content script').count(), 0)
  assert.equal(await page.evaluate(() => (window as any).hacked), undefined)
  assert.match(await reader().locator('.novel-md').innerText(), /<script>/)
  await page.screenshot({ path: path.join(base, 'shot', 'r399-markdown.png') })
  // Back to the plain text and again to the typeset view.
  const toggle = reader().getByRole('button', { name: 'Markdown 排版', exact: true })
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true')
  await toggle.click()
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
  assert.equal(await reader().locator('.novel-md').count(), 0)
  assert.match(await reader().locator('.novel-content').innerText(), /# Release notes/)
  await page.screenshot({ path: path.join(base, 'shot', 'r399-markdown-plain.png') })
  await toggle.click()
  await reader().locator('.novel-md h1').waitFor()
  assert.deepEqual(errors, [])
  passed = true
  console.log('PASS markdown: typeset, no HTML or pictures, switch to plain text. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
