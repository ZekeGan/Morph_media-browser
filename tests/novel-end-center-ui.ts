import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Library } from '../electron/library'
import { tinyPng, zipFixture } from './support/archive-fixture'
import { closeApp, launchApp, reportFailure } from './support/app'

// R-428: the button that goes on at the end of a chapter sits in the middle of the page: the end card of paged
// reading and the next-book button of scroll reading, in horizontal and vertical text, wide and narrow windows.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'novel-center-')),
  media = path.join(root, 'Novels'),
  local = path.join(root, 'local')
await fs.mkdir(media)
const xml = (name: string, value: string) => ({ name, bytes: Buffer.from(value) })
const page = (body: string) =>
  `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`
const text = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `<p>本文 ${i + 1}。` + '吾輩は猫である。名前はまだ無い。'.repeat(4) + '</p>'
  ).join('')
const epub = (title: string) =>
  zipFixture([
    { name: 'mimetype', bytes: Buffer.from('application/epub+zip'), method: 0 },
    xml(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    ),
    xml(
      'OPS/book.opf',
      `<package><metadata><dc:title>${title}</dc:title></metadata><manifest>` +
        ['c1', 'c2', 'c3']
          .map((id) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`)
          .join('') +
        '</manifest><spine><itemref idref="c1"/><itemref idref="c2"/><itemref idref="c3"/></spine></package>'
    ),
    xml('OPS/c1.xhtml', page('<h1>第1話</h1>' + text(3))),
    xml('OPS/c2.xhtml', page('<h1>第2話</h1>' + text(30))),
    xml('OPS/c3.xhtml', page('<h1>第3話</h1>' + text(3))),
    { name: 'OPS/p.png', bytes: tinyPng },
  ])
await fs.writeFile(path.join(media, 'a.epub'), epub('A Book'))
await fs.writeFile(path.join(media, 'b.epub'), epub('B Book'))
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Center test',
  depth: { mode: 'through', level: 1 },
  scanAll: true,
})
const errors: string[] = []
const { app, page: win } = await launchApp(local, errors, { width: 1200, height: 820 })
const reader = () => win.getByRole('dialog', { name: '小說閱讀器', exact: true })
const choose = async (name: string) => {
  await reader().getByRole('button', { name: '閱讀設定', exact: true }).click()
  await reader().locator('.novel-settings label').getByText(name, { exact: true }).click()
  await win.keyboard.press('Escape')
  await reader().locator('.novel-settings').waitFor({ state: 'hidden' })
}
// How far the middle of the thing is from the middle of the reading area, in px (horizontal, vertical).
const offCentre = (selector: string) =>
  win.evaluate((query) => {
    const frame = document.querySelector('.novel-page')!.getBoundingClientRect(),
      box = document.querySelector(query)!.getBoundingClientRect()
    return {
      x: Math.round(box.left + box.width / 2 - (frame.left + frame.width / 2)),
      y: Math.round(box.top + box.height / 2 - (frame.top + frame.height / 2)),
    }
  }, selector)
const results: string[] = [],
  problems: string[] = []
try {
  await win.getByRole('button', { name: '開啟專案 Center test', exact: true }).first().click()
  await win.getByRole('button', { name: /^(開始|繼續)閱讀 a.epub$/ }).click()
  await reader().waitFor()
  await win.waitForFunction(() => !!document.querySelector('.novel-info strong')?.textContent)
  const modes: [string, string][] = [
    ['horizontal', '橫排'],
    ['vertical', '直排'],
  ]
  for (const width of [1200, 900]) {
    await app.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0].setSize(size, 820)
    }, width)
    await win.waitForTimeout(400)
    for (const [label, name] of modes) {
      await choose(name)
      // Paged: the end card of the first chapter.
      await choose('分頁')
      await win.locator('.novel-page').focus()
      await win.keyboard.press('Home')
      await win.waitForTimeout(300)
      await win.keyboard.press('Space')
      await win.waitForTimeout(500)
      await reader().locator('button.novel-end-card').waitFor()
      const card = await offCentre('button.novel-end-card')
      results.push(`paged ${label} ${width}: ${JSON.stringify(card)}`)
      await win.screenshot({ path: path.join(base, 'shot', `r428-paged-${label}-${width}.png`) })
      if (Math.abs(card.x) > 3 || Math.abs(card.y) > 3)
        problems.push(`paged ${label} ${width}: ${JSON.stringify(card)}`)
      // Scroll: the next-book button at the end of the last chapters.
      await choose('捲動')
      await win.locator('.novel-page').focus()
      await win.keyboard.press('End')
      await win.waitForTimeout(500)
      await win.keyboard.press('End')
      await win.waitForTimeout(500)
      const end = await win.locator('.novel-chapter-end button').count()
      if (end) {
        await win.locator('.novel-chapter-end button').scrollIntoViewIfNeeded()
        const button = await offCentre('.novel-chapter-end button')
        results.push(`scroll ${label} ${width}: ${JSON.stringify(button)}`)
        await win.screenshot({ path: path.join(base, 'shot', `r428-scroll-${label}-${width}.png`) })
        // Scroll mode lays the button out in the text flow (the cross axis is the one that must be centred).
        const cross = label === 'vertical' ? button.y : button.x
        if (Math.abs(cross) > 3)
          problems.push(`scroll ${label} ${width}: ${JSON.stringify(button)}`)
      } else results.push(`scroll ${label} ${width}: no next book button reached`)
    }
  }
  console.log(results.join('\n'))
  assert.deepEqual(problems, [])
  assert.deepEqual(errors, [])
  console.log('PASS chapter end buttons are centred. ' + root)
} catch (error) {
  console.log(results.join('\n'))
  await reportFailure(win, root)
  throw error
} finally {
  await closeApp(app)
}
