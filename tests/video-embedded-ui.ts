import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'

// R-412: a video with subtitle tracks inside (text, ASS and picture) lists them in the player's subtitle settings
// next to the files, a text track shows on the video, and a picture track says it cannot be shown.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'video-embedded-ui-')),
  media = path.join(root, 'Videos'),
  local = path.join(root, 'local')
await fs.mkdir(media)
await fs.writeFile(path.join(root, 'eng.srt'), '1\n00:00:00,000 --> 00:00:02,900\nEmbedded words\n')
await fs.writeFile(
  path.join(root, 'jpn.ass'),
  '[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: Default,Arial,20\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:02.90,Default,,0,0,0,,{\\an8}Styled\\Nsigns\n'
)
try {
  await promisify(execFile)(
    'ffmpeg',
    [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=3'],
      ...['-i', path.join(root, 'eng.srt'), '-i', path.join(root, 'jpn.ass')],
      ...['-i', path.join(root, 'jpn.ass'), '-map', '0', '-map', '1', '-map', '2', '-map', '3'],
      ...[
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:s:0',
        'srt',
        '-c:s:1',
        'ass',
        '-c:s:2',
        'ass',
      ],
      ...['-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English'],
      ...['-metadata:s:s:1', 'language=jpn', '-metadata:s:s:1', 'title=Signs'],
      ...['-metadata:s:s:2', 'language=chi', '-metadata:s:s:2', 'title=Pictures'],
      path.join(media, 'movie.mkv'),
    ],
    { windowsHide: true }
  )
  // ffmpeg cannot make picture subtitles from text, so the third track is an ASS track whose codec name is changed
  // to PGS (same length): the reader lists it as a picture track.
  const movie = path.join(media, 'movie.mkv'),
    bytes = await fs.readFile(movie),
    codec = Buffer.from('S_TEXT/ASS')
  const first = bytes.indexOf(codec),
    second = bytes.indexOf(codec, first + 1)
  assert.ok(first > 0 && second > first, 'two ASS tracks in the sample')
  Buffer.from('S_HDMV/PGS').copy(bytes, second)
  await fs.writeFile(movie, bytes)
} catch (error) {
  console.log('SKIP video-embedded-ui: ffmpeg could not make the sample (' + String(error) + ')')
  await removeTestRoot(root)
  process.exit(0)
}
const library = new Library(local, undefined, false)
await library.init()
await library.create(media, {
  name: 'Embedded QA',
  scanAll: true,
  depth: { mode: 'through', level: 1 },
})
const errors: string[] = []
const { app, page } = await launchApp(local, errors, { width: 1300, height: 860 })
let passed = false
try {
  await page.getByRole('button', { name: '開啟專案 Embedded QA', exact: true }).first().click()
  await page.locator('.mixed-media-browser').waitFor()
  await page.locator('.media-thumbnail').filter({ hasText: 'movie.mkv' }).click()
  await page.waitForFunction(() => {
    const video = document.querySelector('video')
    return video && video.readyState >= 1
  })
  const controls = page.locator('.video-controls'),
    panel = page.getByRole('dialog', { name: '更多播放設定', exact: true })
  await controls.getByRole('button', { name: '更多播放設定', exact: true }).click()
  await panel.waitFor()
  await panel.getByRole('button', { name: '字幕設定', exact: true }).click()
  await panel.getByRole('button', { name: '字幕來源', exact: true }).click()
  const embedded = panel.getByRole('group', { name: '內嵌字幕', exact: true })
  await embedded.waitFor()
  const english = embedded.getByRole('button', { name: /^內嵌：.+／English$/ })
  await english.waitFor()
  assert.equal(await embedded.getByRole('button').count(), 2, 'the two text tracks are buttons')
  await embedded.getByText(/Pictures.*有圖形字幕，目前無法顯示/).waitFor()
  await embedded.getByRole('button', { name: /^內嵌：.+／Signs$/ }).waitFor()
  await page.screenshot({ path: path.join(base, 'shot', 'r412-embedded-list.png') })
  await english.click()
  await panel
    .locator('.player-subtitle-source')
    .getByText(/影片內嵌/)
    .waitFor()
  assert.equal(await english.getAttribute('aria-pressed'), 'true')
  await panel.getByRole('button', { name: '關閉播放設定', exact: true }).click()
  await page.locator('.subtitle-overlay').getByText('Embedded words', { exact: true }).waitFor()
  assert.deepEqual(errors, [])
  passed = true
  console.log('PASS embedded subtitle tracks listed, loaded and shown. ' + root)
} catch (error) {
  await reportFailure(page, root)
  throw error
} finally {
  await closeApp(app)
  if (passed) await removeTestRoot(root)
}
