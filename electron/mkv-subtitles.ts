import fs from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { assText, type Cue } from '../shared/subtitles'
import { parseVobsubHeader, vobsubTiming, type VobsubHeader } from '../shared/vobsub'

// R-412: the subtitle tracks of a Matroska file (.mkv, .webm), read in plain JavaScript. The file is untrusted, so
// the reader only walks element headers: video and audio blocks are skipped by their size without being read, only
// the Tracks list and the blocks of text subtitle tracks are read. Everything is bounded (see LIMITS); a file that
// breaks a bound or is cut short gives an error or the cues read so far, never an unbounded read.
// R-421: VobSub picture tracks are read too. A picture cue keeps only where its packet is in the file (the packets
// of a film add up to far more than its text), and the packets near the playback time are read when asked for.
export type EmbeddedFormat = 'srt' | 'ass' | 'ssa' | 'vtt'
export interface EmbeddedTrack {
  number: number
  language?: string
  name?: string
  default?: boolean
  forced?: boolean
  // PGS, VobSub and other picture subtitles: nothing to read as text.
  graphic: boolean
  format?: EmbeddedFormat
  cues: Cue[]
  // R-425: the track went past the limits; what is here is only part of it.
  truncated?: boolean
  // R-421: a VobSub track whose pictures can be shown, and its cues.
  picture?: PictureInfo
  pictures?: PictureCue[]
}
export interface PictureInfo extends VobsubHeader {
  // How the track's blocks are stored: zlib, and the leading bytes stripped from each (base64).
  zlib: boolean
  strip?: string
}
// One picture cue: its time and where its (still compressed) packet is in the file.
export interface PictureCue {
  start: number
  end: number
  at: number
  size: number
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
  // R-421: picture cues across all tracks (a real film has about 10 tracks of 1–2 thousand).
  picturesTotal: 200_000,
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
  codecPrivate: 0x63a2,
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
// A track with something to read: text, or pictures that can be shown (R-421).
const readable = (track: EmbeddedTrack) => !track.graphic || !!track.picture
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
      header: string | undefined,
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
      else if (field.id === ID.codecPrivate)
        header = field.data.subarray(0, 64 * 1024).toString('latin1')
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
    const code = bcp47 || language,
      // R-421: a VobSub track can be shown when its header gives the palette.
      vobsub = codec === 'S_VOBSUB' && header ? parseVobsubHeader(header) : undefined
    found.set(number, {
      number,
      ...(code && code !== 'und' ? { language: code } : {}),
      ...(name ? { name } : {}),
      default: isDefault,
      forced,
      graphic,
      ...(format ? { format } : {}),
      cues: [],
      ...(vobsub
        ? {
            picture: { ...vobsub, zlib, ...(strip ? { strip: strip.toString('base64') } : {}) },
            pictures: [],
          }
        : {}),
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
// R-425: a text cue shorter than this is a piece of an effect (karaoke and signs drawn frame by frame: one syllable
// per line), not something to read; fansub files can hold a hundred thousand of them in an opening.
export const SHORT_CUE = 0.1
interface CueIndex {
  entries: IndexEntry[]
  // Tracks the index names at all (short pieces included), so a track whose every entry was skipped is still known
  // to be indexed and the file is not read whole for it.
  covered: Set<number>
  // Where clusters start, by time, from any track's entries: a file whose index has no subtitle places is read from
  // the cluster at the playback time onwards (R-425).
  clusters: { time: number; at: number }[]
}
async function parseCues(
  b: Buffer,
  wanted: Set<number>,
  text: Set<number>,
  scale: number
): Promise<CueIndex> {
  const found: IndexEntry[] = [],
    covered = new Set<number>(),
    clusters = new Map<number, number>()
  let points = 0
  for (const point of children(b)) {
    if (point.id !== ID.cuePoint) continue
    // A large index (millions of entries) is read in parts so the rest of the app keeps answering.
    if (++points % 4096 === 0) await new Promise((resolve) => setImmediate(resolve))
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
        if (cluster !== undefined && clusters.size < 200_000 && !clusters.has(cluster))
          clusters.set(cluster, (time * scale) / 1e9)
        if (wanted.has(track) && cluster !== undefined && relative !== undefined) {
          covered.add(track)
          const seconds = (duration * scale) / 1e9
          if (text.has(track) && seconds > 0 && seconds < SHORT_CUE) continue
          // Checked per entry: one cue point may hold a great many positions.
          if (found.length + places.length >= LIMITS.cuesPerTrack * 4)
            throw new Error('內嵌字幕過大')
          places.push({ track, cluster, relative, duration: seconds })
        }
      }
    for (const place of places) found.push({ time: (time * scale) / 1e9, ...place })
  }
  return {
    entries: found,
    covered,
    clusters: [...clusters]
      .map(([at, time]) => ({ time, at }))
      .sort((a, b) => a.time - b.time || a.at - b.at),
  }
}

export interface ReadOptions {
  onProgress?: (fraction: number) => void
  ms?: number
  // R-417: called once the track list is known, before any cue is read; the cue arrays then fill while reading.
  onTracks?: (tracks: EmbeddedTrack[]) => void
  // R-417: the playback time to read first (seconds), asked again while reading so a jump moves the reading there.
  focus?: () => number
  // R-425: stops the read (another video was opened).
  signal?: AbortSignal
}
export const CANCELLED = '已取消讀取內嵌字幕'

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
      pictureTotal = 0,
      reported = -1
    const tick = () => {
      if (options.signal?.aborted) throw new Error(CANCELLED)
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
      if (!track || !readable(track) || b[length + 2] & 0x06) return undefined
      const payloadSize = size - length - 3
      if (payloadSize <= 0 || payloadSize > LIMITS.blockPayload) return undefined
      return {
        track,
        offset: (b.readInt16BE(length) * scale) / 1e9,
        at: at + length + 3,
        payload: Buffer.from(await source.bytes(at + length + 3, payloadSize)),
      }
    }
    const addCue = (
      track: Track,
      cluster: number,
      block: { offset: number; at: number; payload: Buffer },
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
      if (track.pictures) {
        // R-421: a block that is not a picture packet is left out. A cue with no duration of its own shows for as
        // long as the packet says, or a few seconds (the next cue replaces it earlier).
        const timing = vobsubTiming(body)
        if (!timing || track.truncated) return
        // R-425: a track past the limits stops growing and says so; the other tracks are still read.
        if (track.pictures.length >= LIMITS.cuesPerTrack || pictureTotal >= LIMITS.picturesTotal) {
          track.truncated = true
          return
        }
        pictureTotal++
        const start = (cluster * scale) / 1e9 + block.offset,
          length =
            duration > 0 ? duration : timing.stop !== undefined && timing.stop > 0 ? timing.stop : 8
        track.pictures.push({
          start,
          end: start + length,
          at: block.at,
          size: block.payload.length,
        })
        return
      }
      // R-425: pieces of an effect are left out (see SHORT_CUE).
      if (duration > 0 && duration < SHORT_CUE) return
      const words = cueText(track, body)
      if (!words || track.truncated) return
      if (track.cues.length >= LIMITS.cuesPerTrack || text + words.length > LIMITS.textTotal) {
        track.truncated = true
        return
      }
      text += words.length
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
    const fromIndex = async (index: CueIndex) => {
      const entries = index.entries,
        wantedTracks = [...tracks!.values()].filter(readable)
      if (!wantedTracks.every((track) => index.covered.has(track.number))) return false
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
          if (
            error instanceof Error &&
            (error.message === '讀取內嵌字幕逾時' || error.message === CANCELLED)
          )
            throw error
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
    // R-425: the clusters from `from` up to `to`, as top-level elements (anything else is stepped over).
    const walk = async (from: number, to: number, share: (at: number) => number) => {
      let at = from
      while (at < to) {
        tick()
        const h = await source.header(at)
        if (!h) return
        const next = h.size < 0 ? to : Math.min(to, h.data + h.size)
        if (h.id === ID.cluster) {
          at = await cluster(h.data, next, h.size < 0)
          progress(share(at))
          // Let the window ask for what is read so far between clusters.
          await new Promise((resolve) => setImmediate(resolve))
          continue
        }
        if (h.size < 0) return
        at = next
      }
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
        // Nothing to read in the rest of the file when no track has text or pictures that can be shown.
        if (![...tracks.values()].some(readable)) break
      } else if (h.id === ID.cluster) {
        let start: number | undefined
        if (tracks && cuesAt !== undefined) {
          const readableTracks = [...tracks.values()].filter(readable),
            wanted = new Set(readableTracks.map((track) => track.number)),
            textTracks = new Set(
              readableTracks.filter((track) => !track.pictures).map((track) => track.number)
            )
          // A damaged or oversized index is not used: the file is then read whole.
          let index: CueIndex | undefined
          try {
            const element = await source.header(cuesAt)
            if (element?.id === ID.cues && element.size > 0 && element.size <= LIMITS.cuesElement)
              index = await parseCues(
                Buffer.from(await source.bytes(element.data, element.size)),
                wanted,
                textTracks,
                scale
              )
          } catch (error) {
            if (error instanceof Error && error.message === CANCELLED) throw error
          }
          if (index) {
            if (await fromIndex(index)) break
            // The index could not be trusted: start over from the clusters with nothing kept.
            for (const track of tracks.values()) {
              track.cues.length = 0
              if (track.pictures) track.pictures.length = 0
              track.truncated = undefined
            }
            text = 0
            pictureTotal = 0
            // R-425: with no usable subtitle places, the clusters are read from the one at the playback time
            // onwards, then from the beginning up to it, so the subtitles being watched come first.
            const focus = options.focus?.() ?? 0,
              from = [...index.clusters].reverse().find((item) => item.time <= focus)
            // Only a place that really starts a cluster; anything else would read bytes twice.
            if (from && base + from.at > position) {
              const there = await source.header(base + from.at).catch(() => undefined)
              if (there?.id === ID.cluster) start = base + from.at
            }
          }
          cuesAt = undefined
        }
        if (start !== undefined) {
          const first = position,
            middle = start,
            span = Math.max(1, end - first)
          await walk(middle, end, (at) => (at - middle) / span)
          await walk(first, middle, (at) => (end - middle + at - first) / span)
          break
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
      ...(track.pictures
        ? { pictures: track.pictures.sort((a, b) => a.start - b.start || a.at - b.at) }
        : {}),
    }))
  } finally {
    await handle.close()
  }
}

// R-421: the packets of some picture cues, read from the places noted while the file was read and unpacked the way
// the track says. A place that no longer holds a packet (or lies outside the file) gives undefined for that cue.
export async function readPicturePackets(
  file: string,
  picture: PictureInfo,
  cues: PictureCue[]
): Promise<(Buffer | undefined)[]> {
  const handle = await fs.open(file, 'r')
  try {
    const strip = picture.strip ? Buffer.from(picture.strip, 'base64') : undefined,
      found: (Buffer | undefined)[] = []
    for (const cue of cues) {
      let body: Buffer | undefined
      if (
        Number.isSafeInteger(cue.at) &&
        cue.at >= 0 &&
        Number.isSafeInteger(cue.size) &&
        cue.size > 0 &&
        cue.size <= LIMITS.blockPayload
      )
        try {
          const stored = Buffer.allocUnsafe(cue.size),
            { bytesRead } = await handle.read(stored, 0, cue.size, cue.at)
          if (bytesRead === cue.size) {
            body = strip ? Buffer.concat([strip, stored]) : stored
            if (picture.zlib) body = inflateSync(body, { maxOutputLength: LIMITS.blockPayload })
          }
        } catch {
          body = undefined
        }
      found.push(body && body.length <= LIMITS.blockPayload ? body : undefined)
    }
    return found
  } finally {
    await handle.close()
  }
}
