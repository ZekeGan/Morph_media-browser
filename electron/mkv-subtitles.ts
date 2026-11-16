import fs from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { assText, type Cue } from '../shared/subtitles'

// R-412: the subtitle tracks of a Matroska file (.mkv, .webm), read in plain JavaScript. The file is untrusted, so
// the reader only walks element headers: video and audio blocks are skipped by their size without being read, only
// the Tracks list and the blocks of text subtitle tracks are read. Everything is bounded (see LIMITS); a file that
// breaks a bound or is cut short gives an error or the cues read so far, never an unbounded read.
export type EmbeddedFormat = 'srt' | 'ass' | 'ssa' | 'vtt'
export interface EmbeddedTrack {
  number: number
  language?: string
  name?: string
  default?: boolean
  forced?: boolean
  // PGS, VobSub and other picture subtitles: listed, but there is nothing to read as text.
  graphic: boolean
  format?: EmbeddedFormat
  cues: Cue[]
}
export const LIMITS = {
  // Longest read of one file, in milliseconds.
  ms: 120_000,
  // Element headers visited; a hostile file of empty elements cannot keep the reader busy longer.
  elements: 8_000_000,
  tracksElement: 2 * 1024 * 1024,
  blockPayload: 64 * 1024,
  cuesPerTrack: 100_000,
  textTotal: 16 * 1024 * 1024,
  tracks: 64,
}
const WINDOW = 8192
const ID = {
  ebml: 0x1a45dfa3,
  segment: 0x18538067,
  info: 0x1549a966,
  timecodeScale: 0x2ad7b1,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackNumber: 0xd7,
  trackType: 0x83,
  codecId: 0x86,
  language: 0x22b59c,
  languageBcp47: 0x22b59d,
  name: 0x536e,
  flagDefault: 0x88,
  flagForced: 0x55aa,
  contentEncodings: 0x6d80,
  contentEncoding: 0x6240,
  contentCompression: 0x5034,
  contentCompAlgo: 0x4254,
  contentEncryption: 0x5035,
  cluster: 0x1f43b675,
  timecode: 0xe7,
  simpleBlock: 0xa3,
  blockGroup: 0xa0,
  block: 0xa1,
  blockDuration: 0x9b,
}
// An element with one of these ids ends an unknown-size cluster.
const topLevel = new Set([
  ID.cluster,
  ID.info,
  ID.tracks,
  0x114d9b74, // SeekHead
  0x1c53bb6b, // Cues
  0x1941a469, // Attachments
  0x1043a770, // Chapters
  0x1254c367, // Tags
])
const textFormats: Record<string, EmbeddedFormat> = {
  'S_TEXT/UTF8': 'srt',
  'S_TEXT/ASCII': 'srt',
  'S_TEXT/ASS': 'ass',
  'S_TEXT/SSA': 'ssa',
  S_ASS: 'ass',
  S_SSA: 'ssa',
  'S_TEXT/WEBVTT': 'vtt',
}
const graphicCodecs = new Set([
  'S_HDMV/PGS',
  'S_HDMV/TEXTST',
  'S_VOBSUB',
  'S_DVBSUB',
  'S_IMAGE/BMP',
])

interface Header {
  id: number
  // Offset of the element's data from where the header was read, and its size (-1: unknown).
  data: number
  size: number
}
// One element header in a buffer; undefined when the buffer ends inside it.
function header(b: Buffer, at: number): Header | undefined {
  if (at >= b.length) return undefined
  const first = b[at],
    idLength = first >= 0x80 ? 1 : first >= 0x40 ? 2 : first >= 0x20 ? 3 : first >= 0x10 ? 4 : 0
  if (!idLength) throw new Error('字幕軌資料損毀')
  if (at + idLength >= b.length) return undefined
  let id = 0
  for (let i = 0; i < idLength; i++) id = id * 256 + b[at + i]
  const lead = b[at + idLength]
  if (!lead) throw new Error('字幕軌資料損毀')
  let sizeLength = 1
  while (!(lead & (0x80 >> (sizeLength - 1)))) sizeLength++
  if (at + idLength + sizeLength > b.length) return undefined
  const mask = 0xff >> sizeLength
  let size = lead & mask,
    unknown = size === mask
  for (let i = 1; i < sizeLength; i++) {
    const byte = b[at + idLength + i]
    size = size * 256 + byte
    unknown &&= byte === 0xff
  }
  if (!unknown && !Number.isSafeInteger(size)) throw new Error('字幕軌資料損毀')
  return { id, data: idLength + sizeLength, size: unknown ? -1 : size }
}
const uint = (b: Buffer) => {
  let value = 0
  for (const byte of b.subarray(0, 8)) value = value * 256 + byte
  return value
}
// The elements inside an element read whole into memory (Tracks).
function* children(b: Buffer) {
  let at = 0
  while (at < b.length) {
    const h = header(b, at)
    if (!h || h.size < 0) return
    const start = at + h.data,
      end = Math.min(b.length, start + h.size)
    yield { id: h.id, data: b.subarray(start, end) }
    at = end
  }
}

interface Track extends EmbeddedTrack {
  zlib: boolean
}
function parseTracks(b: Buffer): Map<number, Track> {
  const found = new Map<number, Track>()
  for (const entry of children(b)) {
    if (entry.id !== ID.trackEntry || found.size >= LIMITS.tracks) continue
    let number = 0,
      type = 0,
      codec = '',
      language: string | undefined,
      bcp47: string | undefined,
      name: string | undefined,
      isDefault = true,
      forced = false,
      zlib = false,
      unusable = false
    for (const field of children(entry.data)) {
      const text = () => field.data.toString('utf8').replace(/\0.*$/s, '').slice(0, 200)
      if (field.id === ID.trackNumber) number = uint(field.data)
      else if (field.id === ID.trackType) type = uint(field.data)
      else if (field.id === ID.codecId) codec = text()
      else if (field.id === ID.language) language = text()
      else if (field.id === ID.languageBcp47) bcp47 = text()
      else if (field.id === ID.name) name = text()
      else if (field.id === ID.flagDefault) isDefault = uint(field.data) !== 0
      else if (field.id === ID.flagForced) forced = uint(field.data) !== 0
      else if (field.id === ID.contentEncodings)
        for (const encoding of children(field.data))
          if (encoding.id === ID.contentEncoding)
            for (const part of children(encoding.data)) {
              if (part.id === ID.contentEncryption) unusable = true
              if (part.id === ID.contentCompression) {
                // Algorithm 0 (the default) is zlib; 3 strips a header, which is not supported.
                const algorithm = children(part.data)
                let value = 0
                for (const item of algorithm)
                  if (item.id === ID.contentCompAlgo) value = uint(item.data)
                if (value === 0) zlib = true
                else unusable = true
              }
            }
    }
    if (type !== 0x11 || !number || unusable) continue
    const format = textFormats[codec],
      graphic = graphicCodecs.has(codec)
    if (!format && !graphic) continue
    const code = bcp47 || language
    found.set(number, {
      number,
      ...(code && code !== 'und' ? { language: code } : {}),
      ...(name ? { name } : {}),
      default: isDefault,
      forced,
      graphic,
      ...(format ? { format } : {}),
      cues: [],
      zlib,
    })
  }
  return found
}

// The file read through a small window: a skip over a video block costs no read of that block.
class Source {
  private buffer = Buffer.alloc(0)
  private start = 0
  constructor(
    private handle: fs.FileHandle,
    readonly size: number
  ) {}
  async bytes(position: number, length: number): Promise<Buffer> {
    if (position >= this.size || length <= 0) return Buffer.alloc(0)
    const have =
      position >= this.start &&
      (position + length <= this.start + this.buffer.length ||
        this.start + this.buffer.length >= this.size)
    if (!have) {
      const size = Math.min(Math.max(length, WINDOW), this.size - position),
        buffer = Buffer.allocUnsafe(size),
        { bytesRead } = await this.handle.read(buffer, 0, size, position)
      this.buffer = buffer.subarray(0, bytesRead)
      this.start = position
    }
    const from = position - this.start
    return this.buffer.subarray(from, from + length)
  }
  async header(position: number) {
    const b = await this.bytes(position, 16),
      h = header(b, 0)
    return h && { id: h.id, data: position + h.data, size: h.size }
  }
}

function cueText(track: Track, payload: Buffer): string {
  let text = payload.toString('utf8').replace(/\0/g, '')
  if (track.format === 'ass' || track.format === 'ssa') {
    // "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text"; the text may hold commas.
    let at = -1
    for (let i = 0; i < 8; i++) {
      at = text.indexOf(',', at + 1)
      if (at < 0) return ''
    }
    return assText(text.slice(at + 1))
  }
  if (track.format === 'vtt')
    // Cue settings line, cue identifier line, then the text.
    text = text.split(/\r?\n/).slice(2).join('\n')
  return text
    .replace(/\r/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

export async function readMkvSubtitles(
  file: string,
  options: { onProgress?: (fraction: number) => void; ms?: number } = {}
): Promise<EmbeddedTrack[]> {
  const handle = await fs.open(file, 'r')
  try {
    const source = new Source(handle, (await handle.stat()).size),
      deadline = Date.now() + (options.ms ?? LIMITS.ms),
      first = await source.header(0)
    if (!first || first.id !== ID.ebml || first.size < 0 || first.size > 4096)
      throw new Error('不是 Matroska 影片檔')
    let position = first.data + first.size,
      segment = await source.header(position)
    if (!segment || segment.id !== ID.segment) throw new Error('不是 Matroska 影片檔')
    const end = segment.size < 0 ? source.size : Math.min(source.size, segment.data + segment.size)
    position = segment.data
    let tracks: Map<number, Track> | undefined,
      scale = 1_000_000,
      elements = 0,
      text = 0,
      reported = -1
    const tick = () => {
      if (++elements > LIMITS.elements || Date.now() > deadline) throw new Error('讀取內嵌字幕逾時')
    }
    const progress = (at: number) => {
      const percent = Math.floor((at / source.size) * 100)
      if (percent !== reported) {
        reported = percent
        options.onProgress?.(Math.min(1, at / source.size))
      }
    }
    // One block (SimpleBlock, or the Block of a BlockGroup): the track, the time inside the cluster, the payload.
    const readBlock = async (at: number, size: number) => {
      const b = await source.bytes(at, 12),
        lead = b[0]
      if (!tracks || !lead) return undefined
      let length = 1
      while (!(lead & (0x80 >> (length - 1)))) length++
      if (length > 4 || b.length < length + 3) return undefined
      let number = lead & (0xff >> length)
      for (let i = 1; i < length; i++) number = number * 256 + b[i]
      const track = tracks.get(number)
      // No lacing: a subtitle block is one cue.
      if (!track || track.graphic || b[length + 2] & 0x06) return undefined
      const payloadSize = size - length - 3
      if (payloadSize <= 0 || payloadSize > LIMITS.blockPayload) return undefined
      return {
        track,
        offset: (b.readInt16BE(length) * scale) / 1e9,
        payload: Buffer.from(await source.bytes(at + length + 3, payloadSize)),
      }
    }
    const addCue = (
      track: Track,
      cluster: number,
      block: { offset: number; payload: Buffer },
      duration: number
    ) => {
      let body = block.payload
      if (track.zlib)
        try {
          body = inflateSync(body, { maxOutputLength: LIMITS.blockPayload })
        } catch {
          // A damaged or oversized block is left out; the other cues stay.
          return
        }
      const words = cueText(track, body)
      if (!words) return
      if (track.cues.length >= LIMITS.cuesPerTrack || (text += words.length) > LIMITS.textTotal)
        throw new Error('內嵌字幕過大')
      const start = (cluster * scale) / 1e9 + block.offset
      track.cues.push({ start, end: start + (duration > 0 ? duration : 3), text: words })
    }
    // A cluster: its children up to its end (or, with no size, up to the next top-level element). Returns where it ends.
    const cluster = async (from: number, to: number, unknown: boolean) => {
      let at = from,
        time = 0
      while (at < to) {
        tick()
        const h = await source.header(at)
        if (!h) return to
        if (unknown && topLevel.has(h.id)) return at
        const next = h.size < 0 ? to : Math.min(to, h.data + h.size)
        if (h.id === ID.timecode) time = uint(await source.bytes(h.data, Math.min(8, h.size)))
        else if (h.id === ID.simpleBlock) {
          const block = await readBlock(h.data, next - h.data)
          if (block) addCue(block.track, time, block, 0)
        } else if (h.id === ID.blockGroup) {
          let inner = h.data,
            block: Awaited<ReturnType<typeof readBlock>>,
            duration = 0
          while (inner < next) {
            tick()
            const child = await source.header(inner)
            if (!child) break
            const stop = child.size < 0 ? next : Math.min(next, child.data + child.size)
            if (child.id === ID.block) {
              block = await readBlock(child.data, stop - child.data)
              // Not a text subtitle track: the rest of the group is not needed.
              if (!block) break
            } else if (child.id === ID.blockDuration)
              duration =
                (uint(await source.bytes(child.data, Math.min(8, child.size))) * scale) / 1e9
            inner = stop
          }
          if (block) addCue(block.track, time, block, duration)
        }
        at = next
        progress(at)
      }
      return to
    }
    while (position < end) {
      tick()
      const h = await source.header(position)
      if (!h) break
      const next = h.size < 0 ? end : Math.min(end, h.data + h.size)
      if (h.id === ID.info && h.size > 0 && h.size <= 65536) {
        for (const item of children(await source.bytes(h.data, h.size)))
          if (item.id === ID.timecodeScale && item.data.length <= 8)
            scale = uint(item.data) || scale
      } else if (h.id === ID.tracks) {
        if (h.size < 0 || h.size > LIMITS.tracksElement) throw new Error('字幕軌資料過大')
        tracks = parseTracks(Buffer.from(await source.bytes(h.data, h.size)))
        // Nothing to read in the rest of the file when no track has text.
        if (![...tracks.values()].some((track) => !track.graphic)) break
      } else if (h.id === ID.cluster) {
        position = await cluster(h.data, next, h.size < 0)
        progress(position)
        continue
      } else if (h.size < 0) break
      position = next
    }
    if (!tracks) throw new Error('影片檔沒有軌道資訊')
    options.onProgress?.(1)
    return [...tracks.values()].map(({ zlib: _zlib, ...track }) => ({
      ...track,
      cues: track.cues.sort((a, b) => a.start - b.start || a.end - b.end),
    }))
  } finally {
    await handle.close()
  }
}
