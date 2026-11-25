import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { decodeThumbnail, SHARP_TYPES } from '../electron/thumbnail-decode'
import { THUMB_EDGE } from '../electron/media-files'

// R-518: pictures are made into thumbnails with sharp in the main process: the longer side becomes THUMB_EDGE,
// never larger than the picture, turned the way the camera says, and only real picture formats are decoded.
test('sharp thumbnails: size, orientation, formats', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-decode-'))
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  const make = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: '#4a7' } })
  // Importing thumbnail-decode leaves only the file readers on, so results are checked from a file too.
  let n = 0
  const size = async (bytes: Buffer) => {
    const out = path.join(dir, `out-${n++}.jpg`)
    await fs.writeFile(out, bytes)
    const meta = await sharp(out).metadata()
    return [meta.format, meta.width, meta.height]
  }

  const wide = path.join(dir, 'wide.png')
  await make(2000, 1000).png().toFile(wide)
  assert.deepEqual(await size(await decodeThumbnail(wide)), ['jpeg', THUMB_EDGE, THUMB_EDGE / 2])

  const small = path.join(dir, 'small.webp')
  await make(100, 50).webp().toFile(small)
  assert.deepEqual(await size(await decodeThumbnail(small)), ['jpeg', 100, 50], 'never enlarged')

  // A portrait photo stored sideways with EXIF orientation 6 comes out upright.
  const turned = path.join(dir, 'turned.jpg')
  await make(1200, 800).jpeg().withMetadata({ orientation: 6 }).toFile(turned)
  assert.deepEqual(await size(await decodeThumbnail(turned)), ['jpeg', 427, THUMB_EDGE])

  // Animated GIF: the first frame.
  const gif = path.join(dir, 'anim.gif')
  await sharp({ create: { width: 300, height: 200, channels: 4, background: '#a33' } })
    .gif()
    .toFile(gif)
  assert.deepEqual(await size(await decodeThumbnail(gif)), ['jpeg', 300, 200])

  // The header decides, not the name: an SVG named .png is refused before decoding.
  const svg = path.join(dir, 'drawing.png')
  await fs.writeFile(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>'
  )
  await assert.rejects(decodeThumbnail(svg))
  await fs.writeFile(path.join(dir, 'broken.jpg'), 'not a picture')
  await assert.rejects(decodeThumbnail(path.join(dir, 'broken.jpg')))

  // Other libvips readers are switched off for the whole process, so even a direct decode of a TIFF fails.
  const tiff = path.join(dir, 'scan.tif')
  await fs.writeFile(
    tiff,
    Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0, 0, 0, 0])
  )
  await assert.rejects(sharp(tiff).toBuffer(), /blocked|not a known file format|unsupported/i)
  await assert.rejects(decodeThumbnail(tiff))

  // A cut-off JPEG is not turned into a half-grey thumbnail; it goes to the window decoder instead.
  const whole = await make(800, 600).jpeg().toBuffer()
  const cut = path.join(dir, 'cut.jpg')
  await fs.writeFile(cut, whole.subarray(0, Math.floor(whole.length / 2)))
  await assert.rejects(decodeThumbnail(cut))

  // Several at once all finish (at most DECODES_AT_ONCE run together).
  const many = await Promise.all(Array.from({ length: 7 }, () => decodeThumbnail(wide)))
  assert.equal(many.length, 7)

  assert.ok(SHARP_TYPES.has('image/avif') && !SHARP_TYPES.has('image/bmp'))
})
