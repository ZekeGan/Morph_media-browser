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
  // R-417: the seek list and the cue index read whole.
  seekHead: 64 * 1024,
  cuesElement: 16 * 1024 * 1024,
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
  contentCompSettings: 0x4255,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  seekPosition: 0x53ac,
  cues: 0x1c53bb6b,
  cuePoint: 0xbb,
  cueTime: 0xb3,
  cueTrackPositions: 0xb7,
  cueTrack: 0xf7,
  cueClusterPosition: 0xf1,
  cueRelativePosition: 0xf0,
  cueDuration: 0xb2,
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
  strip?: Buffer
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
      strip: Buffer | undefined,
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
                // Algorithm 0 (the default) is zlib; 3 (mkvmerge's default) strips the same leading bytes from
                // every block, which are put back on reading (R-417). Others are not supported.
                let value = 0,
                  settings: Buffer | undefined
                for (const item of children(part.data))
                  if (item.id === ID.contentCompAlgo) value = uint(item.data)
                  else if (item.id === ID.contentCompSettings) settings = item.data
                if (value === 0) zlib = true
                else if (value === 3 && settings && settings.length <= 256)
                  strip = Buffer.from(settings)
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
      ...(strip ? { strip } : {}),
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

// One entry of the cue index that points at a subtitle block (R-417).
interface IndexEntry {
  time: number
  track: number
  // Both are offsets from the start of the Segment's data, as Matroska writes them.
  cluster: number
  relative: number
  duration: number
}
function parseSeekHead(b: Buffer): number | undefined {
  for (const seek of children(b)) {
    if (seek.id !== ID.seek) continue
    let id = 0,
      position: number | undefined
    for (const item of children(seek.data))
      if (item.id === ID.seekId) id = uint(item.data)
      else if (item.id === ID.seekPosition) position = uint(item.data)
    if (id === ID.cues && position !== undefined) return position
  }
  return undefined
}
function parseCues(b: Buffer, wanted: Set<number>, scale: number): IndexEntry[] {
  const found: IndexEntry[] = []
  for (const point of children(b)) {
    if (point.id !== ID.cuePoint) continue
    let time = 0
    const places: Omit<IndexEntry, 'time'>[] = []
    for (const item of children(point.data))
      if (item.id === ID.cueTime) time = uint(item.data)
      else if (item.id === ID.cueTrackPositions) {
        let track = 0,
          cluster: number | undefined,
          relative: number | undefined,
          duration = 0
        for (const field of children(item.data))
          if (field.id === ID.cueTrack) track = uint(field.data)
          else if (field.id === ID.cueClusterPosition) cluster = uint(field.data)
          else if (field.id === ID.cueRelativePosition) relative = uint(field.data)
          else if (field.id === ID.cueDuration) duration = uint(field.data)
        if (wanted.has(track) && cluster !== undefined && relative !== undefined) {
          // Checked per entry: one cue point may hold a great many positions.
          if (found.length + places.length >= LIMITS.cuesPerTrack * 4)
            throw new Error('內嵌字幕過大')
          places.push({ track, cluster, relative, duration: (duration * scale) / 1e9 })
        }
      }
    for (const place of places) found.push({ time: (time * scale) / 1e9, ...place })
    if (found.length > LIMITS.cuesPerTrack * 4) throw new Error('內嵌字幕過大')
  }
  return found
}

export interface ReadOptions {
  onProgress?: (fraction: number) => void
  ms?: number
  // R-417: called once the track list is known, before any cue is read; the cue arrays then fill while reading.
  onTracks?: (tracks: EmbeddedTrack[]) => void
  // R-417: the playback time to read first (seconds), asked again while reading so a jump moves the reading there.
  focus?: () => number
}

export async function readMkvSubtitles(
  file: string,
  options: ReadOptions = {}
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
    const base = segment.data
    position = base
    let tracks: Map<number, Track> | undefined,
      cuesAt: number | undefined,
      scale = 1_000_000,
      elements = 0,
      text = 0,
      reported = -1
    const tick = () => {
      if (++elements > LIMITS.elements || Date.now() > deadline) throw new Error('讀取內嵌字幕逾時')
    }
    const progress = (fraction: number) => {
      const percent = Math.floor(fraction * 100)
      if (percent !== reported) {
        reported = percent
        options.onProgress?.(Math.min(1, fraction))
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
      let body = track.strip ? Buffer.concat([track.strip, block.payload]) : block.payload
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
    // A BlockGroup: its Block and BlockDuration. Undefined when the block is not on a text subtitle track.
    const readGroup = async (from: number, to: number) => {
      let inner = from,
        block: Awaited<ReturnType<typeof readBlock>>,
        duration = 0
      while (inner < to) {
        tick()
        const child = await source.header(inner)
        if (!child) break
        const stop = child.size < 0 ? to : Math.min(to, child.data + child.size)
        if (child.id === ID.block) {
          block = await readBlock(child.data, stop - child.data)
          // Not a text subtitle track: the rest of the group is not needed.
          if (!block) return undefined
        } else if (child.id === ID.blockDuration)
          duration = (uint(await source.bytes(child.data, Math.min(8, child.size))) * scale) / 1e9
        inner = stop
      }
      return block && { block, duration }
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
          const group = await readGroup(h.data, next)
          if (group) addCue(group.block.track, time, group.block, group.duration)
        }
        at = next
        progress(at / source.size)
      }
      return to
    }
    // R-417: the cluster's own time, read from its first children (Timecode comes first in practice).
    const clusterTimes = new Map<number, number | undefined>()
    const clusterTime = async (at: number) => {
      if (clusterTimes.has(at)) return clusterTimes.get(at)
      let time: number | undefined
      const h = await source.header(at)
      if (h?.id === ID.cluster) {
        let inner = h.data
        for (let i = 0; i < 4; i++) {
          tick()
          const child = await source.header(inner)
          if (!child || child.size < 0) break
          if (child.id === ID.timecode) {
            time = uint(await source.bytes(child.data, Math.min(8, child.size)))
            break
          }
          inner = child.data + child.size
        }
      }
      if (clusterTimes.size < 1_000_000) clusterTimes.set(at, time)
      return time
    }
    // R-417: read only the blocks the cue index points at, nearest the playback time first. False when the index
    // does not cover every text track or points at blocks that are not there; the whole file is read instead.
    const fromIndex = async (entries: IndexEntry[]) => {
      const textTracks = [...tracks!.values()].filter((track) => !track.graphic)
      if (!textTracks.every((track) => entries.some((entry) => entry.track === track.number)))
        return false
      const seen = new Set<number>()
      let left = entries.slice(),
        done = 0,
        missed = 0,
        focused = Number.NaN
      while (left.length) {
        tick()
        const focus = options.focus?.() ?? 0
        if (focus !== focused) {
          focused = focus
          left.sort((a, b) => Math.abs(b.time - focus) - Math.abs(a.time - focus))
        }
        const entry = left.pop()!
        done++
        // The block the entry points at; a place that is not a block of that track (or not an element at all)
        // counts as a miss, not as a damaged file.
        let found:
            | {
                time: number
                block: NonNullable<Awaited<ReturnType<typeof readBlock>>>
                duration: number
              }
            | undefined,
          repeated = false
        try {
          const clusterAt = base + entry.cluster,
            time = await clusterTime(clusterAt),
            h = await source.header(clusterAt),
            at = h && h.id === ID.cluster ? h.data + entry.relative : -1
          if (time !== undefined && at >= 0 && at < end) {
            repeated = seen.has(at)
            seen.add(at)
            const block = repeated ? undefined : await source.header(at),
              limit = block && block.size >= 0 ? block.data + block.size : -1
            if (block?.id === ID.simpleBlock && limit > 0) {
              const read = await readBlock(block.data, limit - block.data)
              if (read) found = { time, block: read, duration: entry.duration }
            } else if (block?.id === ID.blockGroup && limit > 0) {
              const group = await readGroup(block.data, limit)
              if (group)
                found = { time, block: group.block, duration: group.duration || entry.duration }
            }
          }
        } catch (error) {
          if (error instanceof Error && error.message === '讀取內嵌字幕逾時') throw error
        }
        // Let the window ask for what is read so far between blocks.
        if (done % 64 === 0) await new Promise((resolve) => setImmediate(resolve))
        if (repeated) continue
        if (found && found.block.track.number === entry.track)
          addCue(found.block.track, found.time, found.block, found.duration)
        else if (++missed > 2 && missed > done / 50) return false
        progress(done / entries.length)
      }
      return true
    }
    while (position < end) {
      tick()
      const h = await source.header(position)
      if (!h) break
      const next = h.size < 0 ? end : Math.min(end, h.data + h.size)
      if (h.id === ID.seekHead && h.size > 0 && h.size <= LIMITS.seekHead) {
        // A damaged seek list only means no index: the file is then read whole.
        try {
          const at = parseSeekHead(Buffer.from(await source.bytes(h.data, h.size)))
          if (at !== undefined && cuesAt === undefined) cuesAt = base + at
        } catch {}
      } else if (h.id === ID.cues && cuesAt === undefined) cuesAt = position
      else if (h.id === ID.info && h.size > 0 && h.size <= 65536) {
        for (const item of children(await source.bytes(h.data, h.size)))
          if (item.id === ID.timecodeScale && item.data.length <= 8)
            scale = uint(item.data) || scale
      } else if (h.id === ID.tracks) {
        if (h.size < 0 || h.size > LIMITS.tracksElement) throw new Error('字幕軌資料過大')
        tracks = parseTracks(Buffer.from(await source.bytes(h.data, h.size)))
        options.onTracks?.([...tracks.values()])
        // Nothing to read in the rest of the file when no track has text.
        if (![...tracks.values()].some((track) => !track.graphic)) break
      } else if (h.id === ID.cluster) {
        if (tracks && cuesAt !== undefined) {
          const wanted = new Set(
            [...tracks.values()].filter((track) => !track.graphic).map((track) => track.number)
          )
          // A damaged or oversized index is not used: the file is then read whole.
          let entries: IndexEntry[] | undefined
          try {
            const index = await source.header(cuesAt)
            if (index?.id === ID.cues && index.size > 0 && index.size <= LIMITS.cuesElement)
              entries = parseCues(
                Buffer.from(await source.bytes(index.data, index.size)),
                wanted,
                scale
              )
          } catch {}
          if (entries) {
            if (await fromIndex(entries)) break
            // The index could not be trusted: start over from the clusters with nothing kept.
            for (const track of tracks.values()) track.cues.length = 0
            text = 0
          }
          cuesAt = undefined
        }
        position = await cluster(h.data, next, h.size < 0)
        progress(position / source.size)
        continue
      } else if (h.size < 0) break
      position = next
    }
    if (!tracks) throw new Error('影片檔沒有軌道資訊')
    options.onProgress?.(1)
    return [...tracks.values()].map(({ zlib: _zlib, strip: _strip, ...track }) => ({
      ...track,
      cues: track.cues.sort((a, b) => a.start - b.start || a.end - b.end),
    }))
  } finally {
    await handle.close()
  }
}
