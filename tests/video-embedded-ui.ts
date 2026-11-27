import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { Library } from '../electron/library'
import { closeApp, launchApp, removeTestRoot, reportFailure } from './support/app'

// R-412: a video with subtitle tracks inside (text, ASS and picture) lists them in the player's subtitle settings
// next to the files, a text track shows on the video, and a picture track says it cannot be shown.
// R-421: a VobSub picture track is a button like the text tracks and is drawn over the video.
const base = path.resolve('.test-output')
await fs.mkdir(path.join(base, 'shot'), { recursive: true })
const root = await fs.mkdtemp(path.join(base, 'video-embedded-ui-'))
const media = path.join(root, 'Videos')
const local = path.join(root, 'local')
await fs.mkdir(media)
await fs.writeFile(path.join(root, 'eng.srt'), '1\n00:00:00,000 --> 00:00:02,900\nEmbedded words\n')
await fs.writeFile(
  path.join(root, 'jpn.ass'),
  '[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: Default,Arial,20\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:02.90,Default,,0,0,0,,{\\an8}Styled\\Nsigns\n'
)
// R-421: the fourth track becomes a VobSub track below; its header and its one line are long enough to be
// overwritten in place with a VobSub header and a picture packet.
await fs.writeFile(
  path.join(root, 'vob.ass'),
  '[Script Info]\nTitle: VOBMARK\n; ' +
    'p'.repeat(240) +
    '\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: Default,Arial,20\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:02.90,Default,,0,0,0,,' +
    'V'.repeat(120) +
    '\n'
)
try {
  await promisify(execFile)(
    'ffmpeg',
    [
      ...['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=10:duration=3'],
      ...['-i', path.join(root, 'eng.srt'), '-i', path.join(root, 'jpn.ass')],
      ...['-i', path.join(root, 'jpn.ass'), '-i', path.join(root, 'vob.ass')],
      ...['-map', '0', '-map', '1', '-map', '2', '-map', '3', '-map', '4'],
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
        '-c:s:3',
        'ass',
      ],
      ...['-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English'],
      ...['-metadata:s:s:1', 'language=jpn', '-metadata:s:s:1', 'title=Signs'],
      ...['-metadata:s:s:2', 'language=chi', '-metadata:s:s:2', 'title=Pictures'],
      ...['-metadata:s:s:3', 'language=kor', '-metadata:s:s:3', 'title=Shapes'],
      path.join(media, 'movie.mkv'),
    ],
    { windowsHide: true }
  )
  // ffmpeg cannot make picture subtitles from text, so the third track is an ASS track whose codec name is changed
  // to PGS (same length): the reader lists it as a picture track.
  const movie = path.join(media, 'movie.mkv')
  const bytes = await fs.readFile(movie)
  const codec = Buffer.from('S_TEXT/ASS')
  const first = bytes.indexOf(codec)
  const second = bytes.indexOf(codec, first + 1)
  assert.ok(first > 0 && second > first, 'two ASS tracks in the sample')
  Buffer.from('S_HDMV/PGS').copy(bytes, second)
  // R-421: the fourth track becomes VobSub the same way (the name is padded with NUL to the same length). Its
  // header gets the frame size and a palette whose colour 3 is red; its line becomes a packet that fills
  // x 128–191, y 150–165 with colour 3: two fields of eight lines, each line one "to the end of the line" run.
  const third = bytes.indexOf(codec, second + 1)
  const mark = bytes.indexOf(Buffer.from('Title: VOBMARK'))
  const line = bytes.indexOf(Buffer.from('0,0,Default,,0,0,0,,' + 'V'.repeat(120)))
  assert.ok(third > second && mark > 0 && line > 0, 'the VobSub stand-in track is in the sample')
  Buffer.from('S_VOBSUB\0\0').copy(bytes, third)
  Buffer.from(
    'size: 320x180\npalette: 000000, 000000, 000000, ff0000' + ', 000000'.repeat(12) + '\n'
  ).copy(bytes, mark)
  Buffer.from([
    ...[0, 60, 0, 36, ...Array.from({ length: 16 }, () => [0x00, 0x03]).flat()],
    ...[0, 0, 0, 36, 0x03, 0x32, 0x10, 0x04, 0xff, 0xf0],
    ...[0x05, 0x08, 0x00, 0xbf, 0x09, 0x60, 0xa5, 0x06, 0, 4, 0, 20, 0x01, 0xff],
  ]).copy(bytes, line)
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
  const controls = page.locator('.video-controls')
  const panel = page.getByRole('dialog', { name: '更多播放設定', exact: true })
  await controls.getByRole('button', { name: '更多播放設定', exact: true }).click()
  await panel.waitFor()
  await panel.getByRole('button', { name: '字幕設定', exact: true }).click()
  await panel.getByRole('button', { name: '字幕來源', exact: true }).click()
  const embedded = panel.getByRole('group', { name: '內嵌字幕', exact: true })
  await embedded.waitFor()
  const english = embedded.getByRole('button', { name: /^內嵌：.+／English$/ })
  await english.waitFor()
  assert.equal(
    await embedded.getByRole('button').count(),
    3,
    'the two text tracks and the VobSub track are buttons'
  )
  await embedded.getByText(/Pictures.*有圖形字幕，目前無法顯示/).waitFor()
  await embedded.getByRole('button', { name: /^內嵌：.+／Signs$/ }).waitFor()
  await page.screenshot({ path: path.join(base, 'shot', 'r412-embedded-list.png') })
  // R-421: the VobSub track is drawn on a canvas in the track's own frame, stretched over the video.
  const shapes = embedded.getByRole('button', { name: /^內嵌：.+／Shapes$/ })
  await shapes.click()
  await page.locator('canvas.subtitle-picture[data-cue]').waitFor({ state: 'attached' })
  assert.equal(await shapes.getAttribute('aria-pressed'), 'true')
  const drawn = await page.locator('canvas.subtitle-picture').evaluate((node) => {
    const canvas = node as HTMLCanvasElement
    const context = canvas.getContext('2d')!
    const at = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data]
    return {
      size: [canvas.width, canvas.height],
      inside: [at(128, 150), at(191, 165)],
      outside: [at(127, 150), at(192, 165), at(160, 149), at(160, 166)],
    }
  })
  assert.deepEqual(drawn.size, [320, 180])
  assert.deepEqual(drawn.inside, [
    [255, 0, 0, 255],
    [255, 0, 0, 255],
  ])
  assert.ok(drawn.outside.every((pixel) => pixel[3] === 0))
  // The picture lies over the shown video, not over the black bars beside it.
  const shown = await page.evaluate(() => {
    const canvas = document.querySelector('canvas.subtitle-picture')!.getBoundingClientRect()
    const video = document.querySelector('.video-stage')!.getBoundingClientRect()
    return { ratio: canvas.width / canvas.height, inside: canvas.width <= video.width + 1 }
  })
  assert.ok(Math.abs(shown.ratio - 320 / 180) < 0.02 && shown.inside)
  await page.screenshot({ path: path.join(base, 'shot', 'r421-vobsub-shown.png') })
  // Size and colour do not apply to a picture: the appearance section says so instead of offering them.
  await panel.getByRole('button', { name: '字幕外觀', exact: true }).click()
  await panel.getByText('圖形字幕是影片附的圖片，無法調整大小、位置與顏色。').waitFor()
  assert.equal(await panel.getByLabel('字幕大小').isVisible(), false)
  await panel.getByRole('button', { name: '字幕來源', exact: true }).click()
  await english.waitFor()
  await english.click()
  await panel
    .locator('.player-subtitle-source')
    .getByText(/English.*影片內嵌/)
    .waitFor()
  assert.equal(await english.getAttribute('aria-pressed'), 'true')
  await panel.getByRole('button', { name: '關閉播放設定', exact: true }).click()
  await page.locator('.subtitle-overlay').getByText('Embedded words', { exact: true }).waitFor()
  assert.equal(await page.locator('canvas.subtitle-picture').count(), 0, 'a text track replaces it')
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
