import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import zlib from 'node:zlib'

import { Library } from '../electron/library'
import { closeApp, launchApp, reportFailure } from './support/app'
import { zipFixture } from './support/archive-fixture'

// R-442: in scroll mode, with several short chapters on the screen at once, the text never jumps back while reading
// on: every chapter on the screen only moves up from one frame to the next.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'novel-steady-'))
const media = path.join(root, 'Novels')
const local = path.join(root, 'local')
await fs.mkdir(media)
const xml = (name: string, value: string) => ({ name, bytes: Buffer.from(value) })
const page = (body: string) =>
  `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`
// A plain grey picture of the given size (an illustration page), so its height is only known once it has loaded.
const png = (width: number, height: number) => {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4)
    head.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body))
    return Buffer.concat([head, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 0, 0, 0, 0], 8)
  const row = Buffer.alloc(width + 1, 0x99)
  row[0] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
// Chapters of a few paragraphs, two or three of them sharing the window, with an illustration page every few chapters.
const chapters: [string, string][] = Array.from({ length: 24 }, (_, i) => [
  `c${i + 1}`,
  i % 4 === 1
    ? page(`<div><img src="p${i}.png" alt="挿絵"/></div>`)
    : page(
        `<h1>第${i + 1}話</h1>` +
          Array.from(
            { length: 2 + (i % 3) },
            (_, k) => `<p>短い章 ${i + 1}-${k + 1}。` + '吾輩は猫である。'.repeat(6) + '</p>'
          ).join('')
      ),
])
const pictures = chapters.flatMap((_, i) =>
  i % 4 === 1 ? [{ name: `OPS/p${i}.png`, bytes: png(300, 420) }] : []
)
await fs.writeFile(
  path.join(media, 'steady.epub'),
  zipFixture([
    { name: 'mimetype', bytes: Buffer.from('application/epub+zip'), method: 0 },
    xml(
      'META-INF/container.xml',
      '<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>'
    ),
    xml(
      'OPS/book.opf',
      '<package><metadata><dc:title>Steady Book</dc:title></metadata><manifest>' +
        chapters
          .map(([id]) => `<item id="${id}" href="${id}.xhtml" media-type="application/xhtml+xml"/>`)
          .join('') +
        pictures
          .map(({ name }) => {
            const id = path.basename(name, '.png')
            return `<item id="${id}" href="${id}.png" media-type="image/png"/>`
          })
          .join('') +
        '</manifest><spine>' +
        chapters.map(([id]) => `<itemref idref="${id}"/>`).join('') +
        '</spine></package>'
    ),
    ...chapters.map(([id, html]) => xml(`OPS/${id}.xhtml`, html)),
    ...pictures,
  ])
)
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Steady test',
  depth: { mode: 'through', level: 1 },
  scanAll: true,
})
const errors: string[] = []
const { app, page: win } = await launchApp(local, errors, { width: 1200, height: 820 })
const reader = () => win.getByRole('dialog', { name: '小說閱讀器', exact: true })
const info = () =>
  win.evaluate(() => document.querySelector('.novel-info strong')?.textContent ?? '')
const chapterNumber = async () => Number(/第 (\d+) \//.exec(await info())?.[1] ?? 0)
try {
  await win.getByRole('button', { name: '開啟專案 Steady test', exact: true }).first().click()
  await win.getByRole('button', { name: '切換詳情內容', exact: true }).click()
  await win.getByRole('button', { name: /^(開始|繼續)閱讀 steady.epub$/ }).click()
  await reader().waitFor()
  await win.waitForFunction(() => !!document.querySelector('.novel-info strong')?.textContent)
  const choose = async (...names: string[]) => {
    await reader().getByRole('button', { name: '閱讀設定', exact: true }).click()
    for (const name of names) {
      await reader().locator('.novel-settings label').getByText(name, { exact: true }).click()
    }
    await win.keyboard.press('Escape')
    await reader().locator('.novel-settings').waitFor({ state: 'hidden' })
  }
  const results: string[] = []
  for (const layout of ['橫排', '直排']) {
    await choose('捲動', layout)
    await win.keyboard.press('Home')
    await win.waitForTimeout(500)
    // Every frame, where each chapter on the screen starts, measured from the start edge of the window along the
    // reading direction (top for horizontal text, right for vertical): reading on, it only ever gets smaller.
    await win.evaluate(() => {
      const state = window as unknown as { __frames: Record<string, number>[]; __stop?: () => void }
      state.__stop?.()
      const frames: Record<string, number>[] = []
      state.__frames = frames
      // Per frame: time, position along the reading direction, current chapter number.
      const motion: [number, number, number, number][] = []
      ;(window as unknown as { __motion: typeof motion }).__motion = motion
      let request = 0
      const sample = () => {
        const view = document.querySelector('.novel-page')
        if (view) {
          const frame = view.getBoundingClientRect()
          const vertical = view.classList.contains('vertical')
          const starts: Record<string, number> = {}
          // Only what is on the screen: a picture loading further on moves the text after it, out of sight.
          for (const section of view.querySelectorAll<HTMLElement>('[data-chapter]')) {
            const rect = section.getBoundingClientRect()
            const shown = vertical
              ? rect.left < frame.right && rect.right > frame.left
              : rect.bottom > frame.top && rect.top < frame.bottom
            if (shown) {
              starts[section.dataset.chapter!] = vertical
                ? frame.right - rect.right
                : rect.top - frame.top
            }
          }
          frames.push(starts)
          motion.push([
            performance.now(),
            vertical ? Math.abs(view.scrollLeft) : view.scrollTop,
            Number(
              /第 (\d+) \//.exec(
                document.querySelector('.novel-info strong')?.textContent ?? ''
              )?.[1] ?? 0
            ),
            vertical ? view.scrollWidth - view.clientWidth : view.scrollHeight - view.clientHeight,
          ])
        }
        request = requestAnimationFrame(sample)
      }
      request = requestAnimationFrame(sample)
      state.__stop = () => cancelAnimationFrame(request)
    })
    const frame = (await reader().locator('.novel-page').boundingBox())!
    await win.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2)
    for (let notch = 0; notch < 40; notch++) {
      await win.mouse.wheel(0, 120)
      await win.waitForTimeout(90)
    }
    // Stop watching as soon as the glide has come to rest: chapters far from the view are taken away only after that,
    // and that may move the text by a fraction of a pixel while nothing else moves.
    await win.evaluate(
      () =>
        new Promise<void>((resolve) => {
          const element = document.querySelector('.novel-page')!
          const at = () => element.scrollTop - Math.abs(element.scrollLeft)
          let last = NaN
          let still = 0
          const check = () => {
            const now = at()
            still = now === last ? still + 1 : 0
            last = now
            if (still >= 3) {
              ;(window as unknown as { __stop: () => void }).__stop()
              resolve()
            } else requestAnimationFrame(check)
          }
          requestAnimationFrame(check)
        })
    )
    await win.waitForTimeout(800)
    const reached = await chapterNumber()
    const frames = await win.evaluate(
      () => (window as unknown as { __frames: Record<string, number>[] }).__frames
    )
    const motion = await win.evaluate(
      () => (window as unknown as { __motion: [number, number, number, number][] }).__motion
    )
    // The wheel turns faster than a glide settles, so from the first move to the last the text never stands still: a
    // glide that stopped when a chapter was added after the view waited for the next notch (the lag of R-442).
    const moving = motion.map(([, at], i) => i > 0 && at !== motion[i - 1][1])
    const first = moving.indexOf(true)
    const last = moving.lastIndexOf(true)
    const stalls: string[] = []
    for (let i = first, still = 0; i <= last; i++) {
      still = moving[i] ? 0 : still + 1
      if (still === 3) {
        const [, at, chapterShown, max] = motion[i]
        stalls.push(
          `frame ${i} at ${Math.round(at)} of ${Math.round(max)}, chapter ${chapterShown}`
        )
      }
    }
    await win.screenshot({ path: path.join(base, 'shot', `r442-steady-${layout}.png`) })
    const jumps: string[] = []
    for (let i = 1; i < frames.length; i++) {
      for (const [index, start] of Object.entries(frames[i])) {
        const before = frames[i - 1][index]
        if (before !== undefined && start > before + 0.05) {
          jumps.push(
            `frame ${i} chapter ${Number(index) + 1}: ${Math.round(before)} → ${Math.round(start)}`
          )
        }
      }
    }
    assert.ok(
      reached >= 8,
      `${layout}: the wheel reads on through the short chapters: reached ${reached}`
    )
    assert.deepEqual(jumps, [], `${layout}: no chapter on the screen moves back while reading on`)
    assert.deepEqual(stalls, [], `${layout}: the glide does not stop while the wheel turns on`)
    results.push(`${layout} ${frames.length} frames, chapter ${reached}`)
  }
  assert.deepEqual(errors, [])
  console.log(`PASS short chapters scroll without jumping back (${results.join('; ')}). ` + root)
} catch (error) {
  await reportFailure(win, root)
  throw error
} finally {
  await closeApp(app)
}
