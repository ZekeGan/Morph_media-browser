import sharp from 'sharp'
import { THUMB_EDGE } from './media-files'

// R-518: picture thumbnails were decoded in the app window, where four at once shared one process with the
// interface and each took about twice as long as alone. sharp (libvips) decodes them here instead, off the main
// thread, straight from the file the explorer already checked. Each picture may use two threads: with the default
// (every processor) four large PNGs at once slowed each other down more than the window did.
sharp.concurrency(2)
// Nothing is decoded twice on purpose; libvips' own cache would only hold originals in memory.
sharp.cache(false)
// Only these file readers exist for this process: the header check below opens the file once and decoding opens it
// again, so a file swapped in between still cannot reach SVG, PDF, TIFF or any other libvips reader.
sharp.block({ operation: ['VipsForeignLoad'] })
sharp.unblock({
  operation: [
    'VipsForeignLoadJpegFile',
    'VipsForeignLoadPngFile',
    'VipsForeignLoadNsgifFile',
    'VipsForeignLoadWebpFile',
    'VipsForeignLoadHeifFile',
  ],
})

// What sharp decodes here; the rest (BMP, ICO) and anything sharp cannot read go to the window as before.
export const SHARP_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
])
// The format read from the file's own header, whatever its name says (AVIF is reported as heif). Anything else,
// SVG included, is refused before decoding.
const FORMATS = new Set(['jpeg', 'png', 'gif', 'webp', 'heif'])
// The same limit the window decoder uses.
export const MAX_PIXELS = 100_000_000
// Each decode holds one of Node's four file-work threads until it ends; at most three at once, so reading the
// thumbnail cache, listing folders and other file work always has one left.
export const DECODES_AT_ONCE = 3
let running = 0
const waiting: (() => void)[] = []

export async function decodeThumbnail(file: string): Promise<Buffer> {
  if (running >= DECODES_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    // A damaged file fails here (sharp's default strictness) and goes to the window decoder, as before.
    const image = sharp(file, { limitInputPixels: MAX_PIXELS, animated: false })
    const { format } = await image.metadata()
    // i18n-ignore: never shown; the caller falls back to the window decoder
    if (!format || !FORMATS.has(format)) throw new Error('不支援的圖片格式')
    return await image
      .rotate()
      .resize(THUMB_EDGE, THUMB_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
  } finally {
    running--
    waiting.shift()?.()
  }
}
