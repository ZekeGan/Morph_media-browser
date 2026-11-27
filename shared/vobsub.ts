// R-421: VobSub (DVD) picture subtitles, decoded in plain JavaScript. One cue is one SPU packet: a 2-bit picture
// stored as two interlaced run-length fields, then control sequences that say when it shows, which four of the
// track's 16 palette colours it uses and where it sits. The data comes from a video file, so it is untrusted:
// every read is checked against the packet, sizes are capped, every loop is bounded, and anything that does not
// add up gives undefined instead of a picture.
export const VOBSUB_LIMITS = {
  width: 1920,
  height: 1088,
  // An SPU packet states its size in 16 bits.
  packet: 64 * 1024,
  sequences: 64,
}

export interface VobsubHeader {
  width: number
  height: number
  // 16 colours as 0xRRGGBB.
  palette: number[]
}

// The track's header (the text of a .idx file, kept in the Matroska CodecPrivate): the frame size the pictures are
// placed in and the palette. Without a palette there are no colours to draw with.
export function parseVobsubHeader(text: string): VobsubHeader | undefined {
  const size = /^[ \t]*size:[ \t]*(\d{1,5})[ \t]*x[ \t]*(\d{1,5})/im.exec(text)
  const colours = /^[ \t]*palette:[ \t]*([0-9a-f, \t]{1,400})/im
    .exec(text)?.[1]
    .split(',')
    .map((colour) => colour.trim())
    .slice(0, 16)
  if (colours?.length !== 16 || !colours.every((colour) => /^[0-9a-f]{6}$/i.test(colour))) {
    return undefined
  }
  const width = size ? Number(size[1]) : 720
  const height = size ? Number(size[2]) : 480
  if (width < 1 || height < 1 || width > VOBSUB_LIMITS.width || height > VOBSUB_LIMITS.height) {
    return undefined
  }
  return { width, height, palette: colours.map((colour) => parseInt(colour, 16)) }
}

interface Controls {
  // Seconds after the cue's own time.
  start: number
  stop?: number
  forced: boolean
  // Palette index and opacity (0–15) of the picture's four colours, by pixel value.
  colours?: number[]
  alpha?: number[]
  area?: { x1: number; x2: number; y1: number; y2: number }
  top?: number
  bottom?: number
  // Where the picture data ends (the first control sequence).
  end: number
}

function controls(data: Uint8Array): Controls | undefined {
  const length = data.length
  if (length < 8 || length > VOBSUB_LIMITS.packet) return undefined
  const u16 = (at: number) => (data[at] << 8) | data[at + 1]
  // A stated size of 0 marks the 32-bit layout of HD-DVD subtitles, which is not read.
  if (u16(0) === 0) return undefined
  const first = u16(2)
  if (first < 4 || first + 4 > length) return undefined
  const found: Controls = { start: 0, forced: false, end: first }
  const four = (at: number) => [data[at + 1] & 15, data[at + 1] >> 4, data[at] & 15, data[at] >> 4]
  let at = first
  let started = false
  for (let sequence = 0; sequence < VOBSUB_LIMITS.sequences; sequence++) {
    const delay = (u16(at) * 1024) / 90000
    const next = u16(at + 2)
    let p = at + 4
    commands: while (p < length) {
      const command = data[p++]
      // The bytes a command needs must be inside the packet.
      const needs = [0, 0, 0, 2, 2, 6, 4, 2][command] ?? 0
      if (p + needs > length) return undefined
      switch (command) {
        // 0 is a forced cue; it starts like any other.
        case 0x00:
        case 0x01:
          if (command === 0) found.forced = true
          if (!started) found.start = delay
          started = true
          break
        case 0x02:
          found.stop ??= delay
          break
        case 0x03:
          found.colours ??= four(p)
          break
        case 0x04: {
          // A cue that fades in starts fully transparent: the first opacity that shows anything is used.
          const alpha = four(p)
          if (!found.alpha || !found.alpha.some(Boolean)) found.alpha = alpha
          break
        }
        case 0x05:
          found.area ??= {
            x1: (data[p] << 4) | (data[p + 1] >> 4),
            x2: ((data[p + 1] & 15) << 8) | data[p + 2],
            y1: (data[p + 3] << 4) | (data[p + 4] >> 4),
            y2: ((data[p + 4] & 15) << 8) | data[p + 5],
          }
          break
        case 0x06:
          if (found.top === undefined) {
            found.top = u16(p)
            found.bottom = u16(p + 2)
          }
          break
        case 0x07: {
          // Colour changes inside the picture: skipped by their stated size.
          const size = u16(p)
          if (size < 2) return undefined
          p += size - needs
          break
        }
        default:
          // 0xff ends the sequence; an unknown command ends the reading of this sequence too.
          break commands
      }
      p += needs
    }
    // The last sequence points at itself; one that points backwards would never end.
    if (next <= at || next + 4 > length) break
    at = next
  }
  return found
}

// When a cue shows and stops, from its control sequences alone (main uses this for cues with no duration).
export function vobsubTiming(data: Uint8Array): { start: number; stop?: number } | undefined {
  const found = controls(data)
  if (!found?.area || found.top === undefined) return undefined
  return { start: found.start, ...(found.stop !== undefined ? { stop: found.stop } : {}) }
}

export interface VobsubImage {
  // Where the picture sits in the track's frame (VobsubHeader width × height).
  x: number
  y: number
  width: number
  height: number
  rgba: Uint8ClampedArray
  start: number
  stop?: number
  forced: boolean
}

export function decodeVobsub(
  data: Uint8Array,
  palette: readonly number[]
): VobsubImage | undefined {
  const found = controls(data)
  if (!found?.area || found.top === undefined || found.bottom === undefined) return undefined
  if (palette.length < 16) return undefined
  const { x1, x2, y1, y2 } = found.area
  const width = x2 - x1 + 1
  const height = y2 - y1 + 1
  const end = found.end
  if (width < 1 || height < 1 || width > VOBSUB_LIMITS.width || height > VOBSUB_LIMITS.height) {
    return undefined
  }
  if (found.top < 4 || found.top >= end || found.bottom < 4 || found.bottom >= end) return undefined
  const indexes = found.colours ?? [0, 1, 2, 3]
  const alpha = found.alpha ?? [0, 15, 15, 15]
  const colour = indexes.map((index, value) => {
    const rgb = palette[index] ?? 0
    return [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, alpha[value] * 17]
  })
  const rgba = new Uint8ClampedArray(width * height * 4)
  // One field: every second line from firstLine. Each line is a row of runs (a count and a 2-bit pixel value in 1–4
  // nibbles) and ends on a whole byte. Data that runs out leaves the rest of the picture transparent. The work is
  // bounded by the picture: every run moves at least one pixel along its line.
  const field = (offset: number, firstLine: number) => {
    let nibble = offset * 2
    const limit = end * 2
    for (let line = firstLine; line < height; line += 2) {
      let x = 0
      while (x < width) {
        let value = 0
        let digits = 0
        // 1 nibble: 1–3 pixels; 2: 4–15; 3: 16–63; 4: 64–255, or 0 = to the end of the line.
        do {
          if (nibble >= limit) return
          const byte = data[nibble >> 1]
          value = (value << 4) | (nibble & 1 ? byte & 15 : byte >> 4)
          nibble++
          digits++
        } while (digits < 4 && value < [0, 4, 16, 64][digits])
        let run = value >> 2
        if (run === 0 || run > width - x) run = width - x
        const [r, g, b, a] = colour[value & 3]
        if (a) {
          let at = (line * width + x) * 4
          for (let i = 0; i < run; i++) {
            rgba[at++] = r
            rgba[at++] = g
            rgba[at++] = b
            rgba[at++] = a
          }
        }
        x += run
      }
      nibble = (nibble + 1) & ~1
    }
  }
  field(found.top, 0)
  field(found.bottom, 1)
  return {
    x: x1,
    y: y1,
    width,
    height,
    rgba,
    start: found.start,
    ...(found.stop !== undefined ? { stop: found.stop } : {}),
    forced: found.forced,
  }
}
