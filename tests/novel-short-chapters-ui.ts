import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Library } from '../electron/library'
import { tinyPng, zipFixture } from './support/archive-fixture'
import { closeApp, launchApp, reportFailure } from './support/app'

// R-427: in scroll mode a book whose first chapters are shorter than the window (a cover picture page, the cover, the
// contents, a one-line first chapter) can be read on with the wheel: the view is not pinned to the start, and the
// reading goes on into the first long chapter.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'novel-short-')),
  media = path.join(root, 'Novels'),
  local = path.join(root, 'local')
await fs.mkdir(media)
const xml = (name: string, value: string) => ({ name, bytes: Buffer.from(value) })
const page = (body: string) =>
  `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`
const longText = Array.from(
  { length: 60 },
  (_, i) => `<p>長い本文 ${i + 1}。` + '吾輩は猫である。名前はまだ無い。'.repeat(8) + '</p>'
).join('')
const chapters: [string, string][] = [
  ['pic', page('<div><img src="p.png" alt="cover"/></div>')],
  ['cover', page('<h1>表紙</h1>')],
  ['toc', page('<h1>目次</h1><p>第1話</p><p>第2話</p>')],
  ['ch1', page('<h1>第1話</h1><p>とても短い。</p>')],
  ['ch2', page('<h1>第2話</h1><p>これも短い。</p>')],
  ['long', page('<h1>第3話</h1>' + longText)],
]
await fs.writeFile(
  path.join(media, 'short.epub'),
  zipFixture([
    { name: 'mimetype', bytes: Buffer.from('application/epub+zip'), method: 0 },
    xml(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    ),
    xml(
      'OPS/book.opf',
      '<package><metadata><dc:title>Short Book</dc:title></metadata><manifest>' +
        chapters
          .map(([id]) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`)
          .join('') +
        '<item id="p" href="p.png" media-type="image/png"/></manifest><spine>' +
        chapters.map(([id]) => `<itemref idref="${id}"/>`).join('') +
        '</spine></package>'
    ),
    ...chapters.map(([id, html]) => xml(`OPS/${id}.xhtml`, html)),
    { name: 'OPS/p.png', bytes: tinyPng },
  ])
)
// A real book to check by hand (NOVEL_REAL_EPUB=path): copied here, the original is never opened.
if (process.env.NOVEL_REAL_EPUB)
  await fs.copyFile(process.env.NOVEL_REAL_EPUB, path.join(media, 'real.epub'))
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Short test',
  depth: { mode: 'through', level: 1 },
  scanAll: true,
})
const errors: string[] = []
const { app, page: win } = await launchApp(local, errors, { width: 1200, height: 820 })
const reader = () => win.getByRole('dialog', { name: '小說閱讀器', exact: true })
const info = () =>
  win.evaluate(() => document.querySelector('.novel-info strong')?.textContent ?? '')
const choose = async (name: string) => {
  await reader().getByRole('button', { name: '閱讀設定', exact: true }).click()
  await reader().locator('.novel-settings label').getByText(name, { exact: true }).click()
  await win.keyboard.press('Escape')
  await reader().locator('.novel-settings').waitFor({ state: 'hidden' })
}
const chapterNumber = async () => Number(/第 (\d+) \//.exec(await info())?.[1] ?? 0)
try {
  await win.getByRole('button', { name: '開啟專案 Short test', exact: true }).first().click()
  await win.getByRole('button', { name: /^(開始|繼續)閱讀 short.epub$/ }).click()
  await reader().waitFor()
  await win.waitForFunction(() => !!document.querySelector('.novel-info strong')?.textContent)
  await choose('捲動')
  await win.waitForTimeout(300)
  const frame = (await reader().locator('.novel-page').boundingBox())!
  await win.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2)
  const seen: number[] = []
  // Spin the wheel from the very start: the reading must reach the long chapter, and never come back to an earlier one.
  for (let notch = 0; notch < 60 && (await chapterNumber()) < 6; notch++) {
    await win.mouse.wheel(0, 120)
    await win.waitForTimeout(120)
    seen.push(await chapterNumber())
  }
  await win.screenshot({ path: path.join(base, 'shot', 'r427-short-chapters.png') })
  assert.equal(
    await chapterNumber(),
    6,
    'the wheel reaches the first long chapter: ' + seen.join(',')
  )
  for (let i = 1; i < seen.length; i++)
    assert.ok(
      seen[i] >= seen[i - 1],
      'the chapter never goes back while reading on: ' + seen.join(',')
    )
  // In the long chapter the text moves with the wheel.
  const top = await win.evaluate(() => document.querySelector('.novel-page')!.scrollTop)
  await win.mouse.wheel(0, 400)
  await win.waitForTimeout(600)
  assert.ok(
    (await win.evaluate(() => document.querySelector('.novel-page')!.scrollTop)) > top + 100,
    'the long chapter scrolls'
  )
  if (process.env.NOVEL_REAL_EPUB) {
    await win.keyboard.press('Escape')
    await reader().waitFor({ state: 'detached' })
    await win.getByRole('button', { name: /^(開始|繼續)閱讀 real.epub$/ }).click()
    await reader().waitFor()
    await win.waitForFunction(() => !!document.querySelector('.novel-info strong')?.textContent)
    const real = (await reader().locator('.novel-page').boundingBox())!
    await win.mouse.move(real.x + real.width / 2, real.y + real.height / 2)
    const trail: number[] = []
    for (let notch = 0; notch < 40; notch++) {
      await win.mouse.wheel(0, 120)
      await win.waitForTimeout(120)
      trail.push(await chapterNumber())
    }
    await win.screenshot({ path: path.join(base, 'shot', 'r427-real-epub.png') })
    console.log('real epub chapters while wheeling: ' + trail.join(','))
    assert.ok(trail[trail.length - 1] >= 4, 'the real book reads on past its short opening')
  }
  assert.deepEqual(errors, [])
  console.log('PASS scroll mode reads on through chapters shorter than the window. ' + root)
} catch (error) {
  await reportFailure(win, root)
  throw error
} finally {
  await closeApp(app)
}
