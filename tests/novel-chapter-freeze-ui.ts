import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { Library } from '../electron/library'
import { readFolder } from '../electron/files'
import { zipFixture } from './support/archive-fixture'
import { closeApp, launchApp, removeTestRoot, reportFailure, withoutFlush } from './support/app'

// R-448: reading on through long chapters in scroll mode, in a project the size of a real collection, never freezes
// at a chapter crossing: no frame takes much longer than a few frames (it froze about 0.25 s and then jumped).
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'novel-freeze-')),
  media = path.join(root, 'Shelf'),
  local = path.join(root, 'local')
await fs.mkdir(media, { recursive: true })
// Many folders, so the project snapshot is as big as a real one.
for (let i = 0; i < 1500; i++)
  await fs.mkdir(path.join(media, 'Folder ' + String(i).padStart(4, '0')))
const xml = (name: string, value: string) => ({ name, bytes: Buffer.from(value) })
const page = (body: string) =>
  `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`
const chapters: [string, string][] = Array.from({ length: 8 }, (_, i) => [
  `c${i + 1}`,
  page(
    `<h1>第${i + 1}章</h1>` +
      Array.from(
        { length: 60 },
        (_, k) =>
          `<p>長い章 ${i + 1}-${k + 1}。` + '吾輩は猫である。名前はまだ無い。'.repeat(12) + '</p>'
      ).join('')
  ),
])
await fs.writeFile(
  path.join(media, 'long.epub'),
  zipFixture([
    { name: 'mimetype', bytes: Buffer.from('application/epub+zip'), method: 0 },
    xml(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    ),
    xml(
      'OPS/book.opf',
      '<package><metadata><dc:title>Long Book</dc:title></metadata><manifest>' +
        chapters
          .map(([id]) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`)
          .join('') +
        '</manifest><spine>' +
        chapters.map(([id]) => `<itemref idref="${id}"/>`).join('') +
        '</spine></package>'
    ),
    ...chapters.map(([id, html]) => xml(`OPS/${id}.xhtml`, html)),
  ])
)
const library = new Library(local, undefined, false)
await library.init()
await withoutFlush(() =>
  library.create(media, { name: 'Shelf', scanAll: true, depth: { mode: 'through', level: 1 } })
)

const errors: string[] = []
const { app, page: win } = await launchApp(local, errors, { width: 1200, height: 820 })
const reader = () => win.getByRole('dialog', { name: '小說閱讀器', exact: true })
const chapterNumber = async () =>
  Number(
    /第 (\d+) \//.exec(
      await win.evaluate(() => document.querySelector('.novel-info strong')?.textContent ?? '')
    )?.[1] ?? 0
  )
let passed = false
try {
  await win.getByRole('button', { name: '開啟專案 Shelf', exact: true }).first().click()
  await win.getByRole('button', { name: /^(開始|繼續)閱讀 long.epub$/ }).click()
  await reader().waitFor()
  await win.waitForFunction(() => !!document.querySelector('.novel-info strong')?.textContent)
  const choose = async (...names: string[]) => {
    await reader().getByRole('button', { name: '閱讀設定', exact: true }).click()
    for (const name of names)
      await reader().locator('.novel-settings label').getByText(name, { exact: true }).click()
    await win.keyboard.press('Escape')
    await reader().locator('.novel-settings').waitFor({ state: 'hidden' })
  }
  const results: string[] = []
  for (const layout of ['橫排', '直排']) {
    await choose('捲動', layout)
    await win.keyboard.press('Home')
    await win.waitForTimeout(800)
    // Every frame's time, while the wheel turns through several chapters.
    await win.evaluate(() => {
      const state = window as unknown as { __times: number[]; __stop?: () => void }
      state.__stop?.()
      const times: number[] = []
      state.__times = times
      let request = 0
      const tick = (now: number) => {
        times.push(now)
        request = requestAnimationFrame(tick)
      }
      request = requestAnimationFrame(tick)
      state.__stop = () => cancelAnimationFrame(request)
    })
    const frame = (await reader().locator('.novel-page').boundingBox())!
    await win.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2)
    const from = await chapterNumber()
    for (let notch = 0; notch < 120 && (await chapterNumber()) < from + 3; notch++) {
      await win.mouse.wheel(0, 360)
      await win.waitForTimeout(60)
    }
    await win.waitForTimeout(500)
    const reached = await chapterNumber()
    const times = await win.evaluate(() => {
      const state = window as unknown as { __times: number[]; __stop: () => void }
      state.__stop()
      return state.__times
    })
    const gaps = times.slice(1).map((t, i) => t - times[i])
    const worst = Math.max(...gaps)
    const long = gaps.filter((gap) => gap > 100).map((gap) => Math.round(gap))
    results.push(
      `${layout} chapters ${from}→${reached}, worst frame ${Math.round(worst)} ms, long ${long.join(',') || 'none'}`
    )
    assert.ok(reached >= from + 2, `${layout}: the wheel crosses chapters (${from}→${reached})`)
    assert.ok(worst < 150, `${layout}: no frame freezes at a chapter crossing: ${results.at(-1)}`)
    // The chapter is still saved, once scrolling has stopped.
    let saved: number | undefined
    for (let i = 0; i < 60 && saved !== reached - 1; i++) {
      await win.waitForTimeout(100)
      saved = (await readFolder(media)).details?.novels?.['long.epub']?.chapter
    }
    assert.equal(saved, reached - 1, `${layout}: the chapter read to is saved once scrolling stops`)
  }
  await win.screenshot({ path: path.join(base, 'shot', 'r448-novel-freeze.png') })
  assert.deepEqual(errors, [])
  passed = true
  console.log('PASS long chapters read on without freezing: ' + results.join('; ') + ' ' + root)
} catch (error) {
  await reportFailure(win, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
