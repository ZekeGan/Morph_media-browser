import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'

import { Library } from '../electron/library'
import { closeApp, launchApp, openPanel, removeTestRoot, reportFailure } from './support/app'

// R-451: 從上次繼續 plays the podcast episode heard part of the way from where it was left, not from 0:00, and the
// place it was left at is still kept once it has started again.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'podcast-resume-ui-'))
const show = path.join(root, 'Show')
const local = path.join(root, 'local')
await fs.mkdir(show, { recursive: true })
// A silent WAV of the given length (8 kHz, 8-bit mono): long enough for a place well before its last minute.
const silence = (seconds: number) => {
  const samples = 8000 * seconds
  const wav = Buffer.alloc(44 + samples, 128)
  wav.write('RIFF')
  wav.writeUInt32LE(36 + samples, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(8000, 24)
  wav.writeUInt32LE(8000, 28)
  wav.writeUInt16LE(1, 32)
  wav.writeUInt16LE(8, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(samples, 40)
  return wav
}
await fs.writeFile(path.join(show, 'Episode 1.wav'), silence(240))
await fs.writeFile(path.join(show, 'Episode 2.wav'), silence(240))
const library = new Library(local, undefined, false)
await library.init()
await library.create(show, { name: 'Show', scanAll: true, depth: { mode: 'through', level: 1 } })

const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1400, height: 900 })
const audio = () =>
  page.evaluate(() => {
    const node = document.querySelector('audio')
    return node ? { time: node.currentTime, paused: node.paused } : undefined
  })
const episode = (name: string) => page.locator('.podcast-episode').filter({ hasText: name })
let passed = false
try {
  await page.getByRole('button', { name: '開啟專案 Show', exact: true }).first().click()
  await openPanel(page)
  await page.getByRole('switch', { name: '以 Podcast 顯示', exact: true }).click()
  // Episode 1 is heard to 2:00 and paused there.
  await episode('Episode 1').click()
  await page.waitForFunction(() => {
    const node = document.querySelector('audio')
    return (
      !!node &&
      node.readyState >= 1 &&
      !!document
        .querySelector('.podcast-episode[aria-current="true"]')
        ?.textContent?.includes('Episode 1')
    )
  })
  await page.evaluate(() => {
    const node = document.querySelector('audio')!
    node.currentTime = 120
    node.pause()
  })
  await episode('Episode 1').filter({ hasText: '聽到一半' }).waitFor()
  // Something else is played in between.
  await episode('Episode 2').click()
  await page.waitForFunction(
    () =>
      !!document
        .querySelector('.podcast-episode[aria-current="true"]')
        ?.textContent?.includes('Episode 2')
  )
  await page.evaluate(() => document.querySelector('audio')!.pause())
  // 從上次繼續 goes back to Episode 1 at about 2:00.
  await page.getByRole('button', { name: '從上次繼續', exact: true }).click()
  await page.waitForFunction(() => {
    const node = document.querySelector('audio')
    return (
      !!node &&
      node.readyState >= 1 &&
      !!document
        .querySelector('.podcast-episode[aria-current="true"]')
        ?.textContent?.includes('Episode 1')
    )
  })
  await page.waitForTimeout(1500)
  const now = (await audio())!
  assert.ok(now.time >= 115, 'resumes near 2:00, not from the start: ' + now.time.toFixed(1))
  // The place is still Episode 1's, partly heard, after it started again.
  await episode('Episode 1').filter({ hasText: '聽到一半' }).waitFor()
  await page.screenshot({ path: path.join(base, 'shot', 'r451-podcast-resume.png') })
  assert.deepEqual(errors, [])
  passed = true
  console.log('PASS podcast 從上次繼續 resumes where the episode was left. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
