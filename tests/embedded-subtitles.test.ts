import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { deflateSync } from 'node:zlib'
import { Library } from '../electron/library'
import { Explorer, type DesktopOperations } from '../electron/explorer'
import { LIMITS, readMkvSubtitles, readPicturePackets } from '../electron/mkv-subtitles'
import { isExplorerRequest } from '../electron/ipc-requests'
import { decodeVobsub, parseVobsubHeader, vobsubTiming } from '../shared/vobsub'
import { assText, cuesToSrt, parseSubtitles } from '../shared/subtitles'

// R-412: subtitle tracks inside MKV files. The files here are built byte by byte (and, when ffmpeg is installed, by
// ffmpeg), so the reader is checked against real structure and against damaged and hostile input.
const idBytes = (id: number) => {
  const out: number[] = []
  for (let value = id; value > 0; value = Math.floor(value / 256)) out.unshift(value & 255)
  return Buffer.from(out)
}
const sizeBytes = (n: number) =>
  Buffer.from([0x10 | ((n >>> 24) & 0x0f), (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
const el = (id: number, body: Buffer | number[] | string = []) => {
  const data = typeof body === 'string' ? Buffer.from(body) : Buffer.from(body)
  return Buffer.concat([idBytes(id), sizeBytes(data.length), data])
}
const num = (id: number, value: number) => el(id, value > 255 ? [value >> 8, value & 255] : [value])
const entry = (
  number: number,
  type: number,
  codec: string,
  language: string,
  name = '',
  extra: Buffer[] = []
) =>
  el(
    0xae,
    Buffer.concat([
      num(0xd7, number),
      num(0x83, type),
      el(0x86, codec),
      el(0x22b59c, language),
      ...(name ? [el(0x536e, name)] : []),
      ...extra,
    ])
  )
const block = (track: number, relative: number, payload: Buffer | string, flags = 0) =>
  Buffer.concat([
    Buffer.from([0x80 | track, relative >> 8, relative & 255, flags]),
    typeof payload === 'string' ? Buffer.from(payload) : payload,
  ])
const subtitle = (track: number, relative: number, payload: Buffer | string, duration = 2000) =>
  el(0xa0, Buffer.concat([el(0xa1, block(track, relative, payload)), num(0x9b, duration)]))
const video = (relative: number) => el(0xa3, block(1, relative, Buffer.alloc(3000, 7)))
const cluster = (time: number, ...children: Buffer[]) =>
  el(0x1f43b675, Buffer.concat([num(0xe7, time), ...children]))
const matroska = (...parts: Buffer[]) =>
  Buffer.concat([
    el(0x1a45dfa3, el(0x4282, 'matroska')),
    el(0x18538067, Buffer.concat([el(0x1549a966, el(0x2ad7b1, [0x0f, 0x42, 0x40])), ...parts])),
  ])
const tracks = (...entries: Buffer[]) => el(0x1654ae6b, Buffer.concat(entries))
const sample = () =>
  matroska(
    tracks(
      entry(1, 1, 'V_MPEG4/ISO/AVC', 'und'),
      entry(2, 0x11, 'S_TEXT/UTF8', 'eng', 'English'),
      entry(3, 0x11, 'S_TEXT/ASS', 'jpn', 'Japanese'),
      entry(4, 0x11, 'S_HDMV/PGS', 'chi', 'Pictures'),
      entry(5, 0x11, 'S_TEXT/UTF8', 'fre', 'Zipped', [
        el(0x6d80, el(0x6240, el(0x5034, num(0x4254, 0)))),
      ])
    ),
    cluster(
      1000,
      video(0),
      subtitle(2, 500, '<i>Hello</i>\n{\\an8}there'),
      subtitle(3, 500, '0,0,Default,,0,0,0,,{\\an8}Hi, {\\i1}world{\\i0}\\Nsecond line'),
      subtitle(3, 600, '1,0,Default,,0,0,0,,{\\p1}m 0 0 l 10 10{\\p0}'),
      subtitle(4, 500, Buffer.from([1, 2, 3])),
      subtitle(5, 700, deflateSync(Buffer.from('zipped text')))
    ),
    // A cluster with no size ends at the next cluster.
    Buffer.concat([
      idBytes(0x1f43b675),
      Buffer.from([0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      num(0xe7, 5000),
      video(0),
      subtitle(2, 0, 'later', 0),
    ]),
    cluster(9000, subtitle(2, 0, 'last'))
  )

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'embedded-subtitles-'))
  const closers: (() => void)[] = []
  t.after(async () => {
    for (const close of closers) close()
    const target = await fs.realpath(root)
    if (!target.startsWith(base + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  const write = async (name: string, bytes: Buffer | string) => {
    const file = path.join(root, name)
    await fs.writeFile(file, bytes)
    return file
  }
  return { root, write, closers }
}

test('text and picture tracks are listed with their cues, the rest of the file is skipped', async (t) => {
  const { write } = await fixture(t)
  const found = await readMkvSubtitles(await write('a.mkv', sample()))
  assert.deepEqual(
    found.map((track) => [track.number, track.language, track.name, track.format, track.graphic]),
    [
      [2, 'eng', 'English', 'srt', false],
      [3, 'jpn', 'Japanese', 'ass', false],
      [4, 'chi', 'Pictures', undefined, true],
      [5, 'fre', 'Zipped', 'srt', false],
    ]
  )
  const [english, japanese, pictures, zipped] = found
  assert.deepEqual(
    english.cues.map((cue) => [cue.start, cue.end, cue.text]),
    [
      [1.5, 3.5, '<i>Hello</i>\nthere'],
      [5, 8, 'later'],
      [9, 11, 'last'],
    ]
  )
  assert.deepEqual(japanese.cues, [{ start: 1.5, end: 3.5, text: 'Hi, world\nsecond line' }])
  assert.deepEqual(pictures.cues, [], 'a picture track has nothing to show as text')
  assert.equal(zipped.cues[0].text, 'zipped text')
})

test('ASS text keeps the words and line breaks only; external ASS and SSA files are read too', () => {
  assert.equal(
    assText('{\\an8\\pos(10,20)}One\\Ntwo\\nthree\\hfour{\\b1}!'),
    'One\ntwo\nthree four!'
  )
  assert.equal(assText('{\\p1}m 0 0 l 5 5{\\p0}Visible'), 'Visible')
  const script = `[Script Info]\nTitle: x\n\n[V4+ Styles]\nFormat: Name\nStyle: Default\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Hello, there{\\i0}\\Nfriend\nComment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,not shown\nDialogue: 0,0:01:00.00,0:01:01.25,Default,,0,0,0,,Late\n`
  const cues = parseSubtitles(script)
  assert.deepEqual(cues, [
    { start: 1.5, end: 3, text: 'Hello, there\nfriend' },
    { start: 60, end: 61.25, text: 'Late' },
  ])
  assert.equal(parseSubtitles(script.replace('[V4+ Styles]', '[V4 Styles]')).length, 2)
  assert.throws(() => parseSubtitles('[Script Info]\nTitle: only a header\n'), /找不到有效/)
  // Cues go to the player as SRT text, one block per cue and no blank line inside one.
  assert.equal(
    cuesToSrt([{ start: 3661.5, end: 3662, text: 'a\n\nb' }]),
    '1\n01:01:01,500 --> 01:01:02,000\na\nb\n'
  )
  assert.equal(parseSubtitles(cuesToSrt(cues))[1].text, 'Late')
})

test('a damaged or hostile file ends with an error or the cues so far, inside the limits', async (t) => {
  const { write } = await fixture(t)
  const whole = sample()
  // Cut off in the middle of the last cluster: what was read stays.
  const cut = await readMkvSubtitles(await write('cut.mkv', whole.subarray(0, whole.length - 8)))
  assert.ok(cut[0].cues.length >= 2)
  await assert.rejects(readMkvSubtitles(await write('text.mkv', 'just words')), /不是 Matroska/)
  const broken = Buffer.from(whole)
  broken.fill(0, 120, 140)
  await assert.rejects(readMkvSubtitles(await write('broken.mkv', broken)), /損毀|沒有軌道|逾時/)
  await assert.rejects(readMkvSubtitles(await write('late.mkv', whole), { ms: -1 }), /逾時/)
  const saved = { ...LIMITS }
  try {
    // R-425: a track past the limits stops at what was read and says so; the other tracks are still read whole.
    LIMITS.cuesPerTrack = 1
    const many = await readMkvSubtitles(await write('many.mkv', whole))
    assert.deepEqual(
      many.map((track) => [track.number, track.cues.length, !!track.truncated]),
      [
        [2, 1, true],
        [3, 1, false],
        [4, 0, false],
        [5, 1, false],
      ]
    )
    Object.assign(LIMITS, saved, { textTotal: 12 })
    const wordy = await readMkvSubtitles(await write('wordy.mkv', whole))
    assert.ok(wordy.some((track) => track.truncated))
    Object.assign(LIMITS, saved, { tracksElement: 10 })
    await assert.rejects(readMkvSubtitles(await write('tracks.mkv', whole)), /過大/)
    // A block bigger than a subtitle can be is skipped, not read.
    Object.assign(LIMITS, saved, { blockPayload: 3 })
    const small = await readMkvSubtitles(await write('payload.mkv', whole))
    assert.equal(small[0].cues.length, 0)
  } finally {
    Object.assign(LIMITS, saved)
  }
  // Laced blocks are not subtitles; an element claiming more than the file holds ends at the file.
  const laced = matroska(
    tracks(entry(2, 0x11, 'S_TEXT/UTF8', 'eng')),
    cluster(0, el(0xa3, block(2, 0, 'x', 0x02)), subtitle(2, 0, 'fine'))
  )
  assert.deepEqual(
    (await readMkvSubtitles(await write('laced.mkv', laced)))[0].cues.map((cue) => cue.text),
    ['fine']
  )
  const lying = Buffer.concat([
    whole,
    idBytes(0x1f43b675),
    Buffer.from([0x01, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff]),
  ])
  assert.ok((await readMkvSubtitles(await write('lying.mkv', lying)))[0].cues.length >= 3)
})

test('a video made by ffmpeg: its text and ASS tracks are read, the video track is not touched', async (t) => {
  const { root, write } = await fixture(t)
  await write(
    'a.srt',
    '1\n00:00:00,500 --> 00:00:01,500\nFirst line\n\n2\n00:00:02,000 --> 00:00:02,800\nSecond\n'
  )
  await write(
    'b.ass',
    '[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize\nStyle: Default,Arial,20\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.50,0:00:01.50,Default,,0,0,0,,{\\an8}Styled\\Nwords\n'
  )
  const out = path.join(root, 'made.mkv')
  try {
    await promisify(execFile)(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=64x64:d=3:r=5',
        '-i',
        path.join(root, 'a.srt'),
        '-i',
        path.join(root, 'b.ass'),
        '-map',
        '0',
        '-map',
        '1',
        '-map',
        '2',
        '-c:v',
        'mpeg4',
        '-c:s:0',
        'srt',
        '-c:s:1',
        'ass',
        '-metadata:s:s:0',
        'language=eng',
        '-metadata:s:s:1',
        'language=jpn',
        '-metadata:s:s:1',
        'title=Signs',
        out,
      ],
      { windowsHide: true }
    )
  } catch {
    t.skip('ffmpeg is not installed')
    return
  }
  const found = await readMkvSubtitles(out)
  assert.deepEqual(
    found.map((track) => [track.language, track.format, track.cues.map((cue) => cue.text)]),
    [
      ['eng', 'srt', ['First line', 'Second']],
      ['jpn', 'ass', ['Styled\nwords']],
    ]
  )
  assert.equal(found[1].name, 'Signs')
  assert.ok(
    Math.abs(found[0].cues[0].start - 0.5) < 0.01 && Math.abs(found[0].cues[0].end - 1.5) < 0.01
  )
})

test('the explorer lists and returns embedded tracks through a cache that follows the file', async (t) => {
  const { root, closers } = await fixture(t)
  const media = path.join(root, 'media'),
    local = path.join(root, 'local')
  await fs.mkdir(media)
  await fs.writeFile(path.join(media, 'film.mkv'), sample())
  await fs.writeFile(path.join(media, 'clip.mp4'), 'not matroska')
  const library = new Library(local, undefined, false)
  await library.init()
  const progress: number[] = []
  const desktop: DesktopOperations = {
    choose: async () => undefined,
    open: async () => {},
    launch: async () => {},
    thumbnail: async () => Buffer.from('x'),
    subtitleProgress: (value) => progress.push(value.fraction),
  }
  const explorer = new Explorer(library, local, desktop)
  closers.push(() => explorer.index.close())
  const snapshot = await library.create(media, { name: 'P', depth: { mode: 'through', level: 1 } }),
    row = snapshot.rows[0],
    content = await explorer.content(row.rowId),
    film = content.entries.find((entry) => entry.name === 'film.mkv')!,
    clip = content.entries.find((entry) => entry.name === 'clip.mp4')!
  const list = await explorer.request({
    action: 'embeddedSubtitles',
    rowId: row.rowId,
    fileId: film.id,
  })
  assert.deepEqual(
    list.embedded?.tracks.map((track) => [track.number, track.graphic, track.cues]),
    [
      [2, false, 3],
      [3, false, 1],
      [4, true, 0],
      [5, false, 1],
    ]
  )
  assert.ok(progress.length > 0 && progress.at(-1) === 1)
  const chosen = await explorer.request({
    action: 'embeddedSubtitle',
    rowId: row.rowId,
    fileId: film.id,
    track: 3,
  })
  assert.equal(chosen.subtitle?.token, 'emb-3')
  assert.equal(chosen.subtitle?.portable, false)
  assert.equal(parseSubtitles(chosen.subtitle!.text)[0].text, 'Hi, world\nsecond line')
  await assert.rejects(
    explorer.request({ action: 'embeddedSubtitle', rowId: row.rowId, fileId: film.id, track: 4 }),
    /圖形字幕/
  )
  await assert.rejects(
    explorer.request({ action: 'embeddedSubtitle', rowId: row.rowId, fileId: film.id, track: 99 }),
    /找不到/
  )
  await assert.rejects(
    explorer.request({ action: 'embeddedSubtitles', rowId: row.rowId, fileId: clip.id }),
    /Matroska/
  )
  await assert.rejects(
    explorer.request({ action: 'embeddedSubtitles', rowId: row.rowId, fileId: '../film.mkv' })
  )
  // The cache: a second window session reads nothing; a changed file is read again.
  const cacheFiles = await fs.readdir(path.join(local, 'subtitle-cache'))
  assert.equal(cacheFiles.filter((name) => name.endsWith('.json')).length, 1)
  explorer.embeddedSubtitles.clear()
  progress.length = 0
  await explorer.request({ action: 'embeddedSubtitles', rowId: row.rowId, fileId: film.id })
  assert.deepEqual(progress, [], 'served from the cache file')
  const later = new Date(Date.now() + 60_000)
  await fs.utimes(path.join(media, 'film.mkv'), later, later)
  explorer.embeddedSubtitles.clear()
  const again = await explorer.content(row.rowId)
  await explorer.request({
    action: 'embeddedSubtitles',
    rowId: row.rowId,
    fileId: again.entries.find((entry) => entry.name === 'film.mkv')!.id,
  })
  assert.ok(progress.length > 0, 'the file changed, so it was read again')
})

// R-417: a file with a cue index (SeekHead → Cues at the end), as mkvmerge writes it. Positions are offsets from the
// Segment's data; every element here has a 4-byte size, so they are known before the bytes are joined.
const u32 = (n: number) =>
  Buffer.from([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255])
interface IndexedCluster {
  time: number
  children: Buffer[]
  // duration: the CueDuration written in the index (ms), as mkvmerge writes for subtitle blocks.
  subs: { track: number; at: number; duration?: number }[]
}
function indexed(options: { lie?: boolean; list?: Buffer; clusters?: IndexedCluster[] } = {}) {
  const info = el(0x1549a966, el(0x2ad7b1, [0x0f, 0x42, 0x40]))
  const list =
    options.list ??
    tracks(
      entry(1, 1, 'V_MPEG4/ISO/AVC', 'und'),
      entry(2, 0x11, 'S_TEXT/UTF8', 'eng', 'English'),
      // Header stripping (algorithm 3): every block lost the same leading bytes.
      entry(3, 0x11, 'S_TEXT/UTF8', 'jpn', 'Stripped', [
        el(0x6d80, el(0x6240, el(0x5034, Buffer.concat([num(0x4254, 3), el(0x4255, 'Hel')])))),
      ])
    )
  const clusters: IndexedCluster[] = options.clusters ?? [
    { time: 0, children: [video(0), subtitle(2, 100, 'first')], subs: [{ track: 2, at: 1 }] },
    {
      time: 30000,
      children: [video(0), subtitle(2, 0, 'second'), subtitle(3, 0, 'lo there')],
      subs: [
        { track: 2, at: 1 },
        { track: 3, at: 2 },
      ],
    },
    { time: 65000, children: [video(0), subtitle(2, 0, 'third')], subs: [{ track: 2, at: 1 }] },
  ]
  const seekHead = (cues: number) =>
    el(
      0x114d9b74,
      el(0x4dbb, Buffer.concat([el(0x53ab, idBytes(0x1c53bb6b)), el(0x53ac, u32(cues))]))
    )
  let position = seekHead(0).length + info.length + list.length
  const built: Buffer[] = [],
    points: Buffer[] = []
  for (const item of clusters) {
    const time = num(0xe7, item.time),
      body = [time, ...item.children]
    for (const sub of item.subs) {
      const relative = body.slice(0, sub.at + 1).reduce((sum, part) => sum + part.length, 0)
      points.push(
        el(
          0xbb,
          Buffer.concat([
            el(0xb3, u32(item.time)),
            el(
              0xb7,
              Buffer.concat([
                num(0xf7, sub.track),
                el(0xf1, u32(position)),
                el(0xf0, u32(options.lie ? relative + 3 : relative)),
                ...(sub.duration !== undefined ? [el(0xb2, u32(sub.duration))] : []),
              ])
            ),
          ])
        )
      )
    }
    const whole = cluster(item.time, ...item.children)
    built.push(whole)
    position += whole.length
  }
  return Buffer.concat([
    el(0x1a45dfa3, el(0x4282, 'matroska')),
    el(
      0x18538067,
      Buffer.concat([
        seekHead(position),
        info,
        list,
        ...built,
        el(0x1c53bb6b, Buffer.concat(points)),
      ])
    ),
  ])
}

test('a file with a cue index: only the indexed blocks are read, nearest the playback time first', async (t) => {
  const { write } = await fixture(t)
  const file = await write('indexed.mkv', indexed())
  const whole = await readMkvSubtitles(file)
  assert.deepEqual(
    whole.map((track) => track.cues.map((cue) => [cue.start, cue.text])),
    [
      [
        [0.1, 'first'],
        [30, 'second'],
        [65, 'third'],
      ],
      [[30, 'Hello there']],
    ],
    'stripped header bytes are put back'
  )
  // Reading from 65 s: the first cue read is the one at 65 s, and the track list was known before any cue.
  let live: { cues: { text: string }[] }[] = [],
    firstRead: string | undefined,
    cuesWhenListed = -1
  await readMkvSubtitles(file, {
    focus: () => 65,
    onTracks: (found) => {
      live = found
      cuesWhenListed = found.reduce((sum, track) => sum + track.cues.length, 0)
    },
    onProgress: () => {
      firstRead ??= live.flatMap((track) => track.cues)[0]?.text
    },
  })
  assert.equal(cuesWhenListed, 0)
  assert.equal(firstRead, 'third')
  // An index that points at the wrong places is not trusted: the whole file is read and nothing is lost.
  const lying = await readMkvSubtitles(await write('lying-index.mkv', indexed({ lie: true })))
  assert.deepEqual(
    lying[0].cues.map((cue) => cue.text),
    ['first', 'second', 'third']
  )
  assert.deepEqual(
    lying[1].cues.map((cue) => cue.text),
    ['Hello there']
  )
})

test('the explorer answers early with the track list and the cues read so far', async (t) => {
  const { root, closers } = await fixture(t)
  const media = path.join(root, 'media'),
    local = path.join(root, 'local')
  await fs.mkdir(media)
  await fs.writeFile(path.join(media, 'film.mkv'), indexed())
  const library = new Library(local, undefined, false)
  await library.init()
  const desktop: DesktopOperations = {
    choose: async () => undefined,
    open: async () => {},
    launch: async () => {},
    thumbnail: async () => Buffer.from('x'),
  }
  const explorer = new Explorer(library, local, desktop)
  closers.push(() => explorer.index.close())
  const snapshot = await library.create(media, { name: 'P', depth: { mode: 'through', level: 1 } }),
    row = snapshot.rows[0],
    film = (await explorer.content(row.rowId)).entries.find((entry) => entry.name === 'film.mkv')!
  const early = await explorer.request({
    action: 'embeddedSubtitles',
    rowId: row.rowId,
    fileId: film.id,
    early: true,
  })
  assert.deepEqual(
    early.embedded?.tracks.map((track) => track.number),
    [2, 3]
  )
  const partial = await explorer.request({
    action: 'embeddedSubtitle',
    rowId: row.rowId,
    fileId: film.id,
    track: 2,
    early: true,
    time: 30,
  })
  assert.equal(partial.subtitle?.token, 'emb-2')
  // Waiting for the whole read gives the final counts; afterwards an early request is complete, not partial.
  const done = await explorer.request({
    action: 'embeddedSubtitles',
    rowId: row.rowId,
    fileId: film.id,
  })
  assert.deepEqual(
    done.embedded?.tracks.map((track) => track.cues),
    [3, 1]
  )
  assert.equal(done.embedded?.reading, undefined)
  const full = await explorer.request({
    action: 'embeddedSubtitle',
    rowId: row.rowId,
    fileId: film.id,
    track: 2,
    early: true,
  })
  assert.equal(full.subtitle?.partial, undefined)
  assert.deepEqual(
    parseSubtitles(full.subtitle!.text).map((cue) => cue.text),
    ['first', 'second', 'third']
  )
})

// R-421: VobSub picture subtitles. A packet is built here from rows of 2-bit pixel values: two interlaced fields of
// run-length codes, then the control sequences (colours, opacity, area, field offsets, start and stop).
const palette16 = Array.from({ length: 16 }, (_, index) => index * 0x101010 + (15 - index))
function spu(
  rows: number[][],
  options: { x?: number; y?: number; colours?: number[]; alpha?: number[]; stop?: number } = {}
) {
  const width = rows[0].length,
    { x = 0, y = 0, colours = [0, 1, 2, 3], alpha = [0, 15, 15, 15] } = options
  const encode = (lines: number[][]) => {
    const nibbles: number[] = []
    for (const line of lines) {
      let at = 0
      while (at < width) {
        let run = 1
        while (at + run < width && line[at + run] === line[at]) run++
        // A long run that reaches the end of the line is written as "to the end" (count 0, four nibbles).
        const toEnd = at + run === width && run > 3
        if (!toEnd) run = Math.min(run, 255)
        const code = toEnd ? line[at] : (run << 2) | line[at],
          digits = toEnd ? 4 : run < 4 ? 1 : run < 16 ? 2 : run < 64 ? 3 : 4
        for (let digit = digits - 1; digit >= 0; digit--) nibbles.push((code >> (4 * digit)) & 15)
        at += run
      }
      if (nibbles.length & 1) nibbles.push(0)
    }
    const bytes: number[] = []
    for (let i = 0; i < nibbles.length; i += 2) bytes.push((nibbles[i] << 4) | nibbles[i + 1])
    return bytes
  }
  const top = encode(rows.filter((_, index) => index % 2 === 0)),
    bottom = encode(rows.filter((_, index) => index % 2 === 1)),
    control = 4 + top.length + bottom.length,
    x2 = x + width - 1,
    y2 = y + rows.length - 1,
    two = (value: number) => [value >> 8, value & 255],
    four = (values: number[]) => [(values[3] << 4) | values[2], (values[1] << 4) | values[0]]
  const commands = [
    ...[0x03, ...four(colours), 0x04, ...four(alpha)],
    ...[0x05, x >> 4, ((x & 15) << 4) | (x2 >> 8), x2 & 255],
    ...[y >> 4, ((y & 15) << 4) | (y2 >> 8), y2 & 255],
    ...[0x06, ...two(4), ...two(4 + top.length), 0x01, 0xff],
  ]
  const second = control + 4 + commands.length,
    sequences = [
      ...[0, 0, ...two(options.stop === undefined ? control : second), ...commands],
      ...(options.stop === undefined ? [] : [...two(options.stop), ...two(second), 0x02, 0xff]),
    ],
    size = control + sequences.length
  return Buffer.from([...two(size), ...two(control), ...top, ...bottom, ...sequences])
}
const pictureRows = () => {
  const rows: number[][] = []
  for (let line = 0; line < 9; line++) {
    const row = new Array<number>(150).fill(0)
    // Runs of every code length: 1–3, 4–15, 16–63 and 64 or more pixels, and one that ends the line.
    row.fill(1, 2, 3 + (line % 3))
    row.fill(2, 10, 15 + line)
    row.fill(3, 30, 50 + line * 4)
    if (line % 2) row.fill(1, 70, 150)
    else row.fill(2, 149, 150)
    rows.push(row)
  }
  return rows
}

test('a VobSub packet decodes to its exact pixels, place and timing', () => {
  const rows = pictureRows(),
    colours = [4, 9, 2, 15],
    alpha = [0, 15, 8, 3],
    packet = spu(rows, { x: 300, y: 400, colours, alpha, stop: 176 }),
    image = decodeVobsub(packet, palette16)
  assert.ok(image)
  assert.deepEqual(
    [image.x, image.y, image.width, image.height, image.forced, image.start],
    [300, 400, 150, 9, false, 0]
  )
  assert.equal(image.stop, (176 * 1024) / 90000)
  const expected = new Uint8ClampedArray(150 * 9 * 4)
  rows.forEach((row, line) =>
    row.forEach((value, column) => {
      if (!alpha[value]) return
      const rgb = palette16[colours[value]]
      expected.set(
        [(rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255, alpha[value] * 17],
        (line * 150 + column) * 4
      )
    })
  )
  assert.deepEqual(image.rgba, expected)
  assert.deepEqual(vobsubTiming(packet), { start: 0, stop: (176 * 1024) / 90000 })
  // No stop command: the cue has no end of its own.
  assert.equal(decodeVobsub(spu(rows), palette16)?.stop, undefined)
  // The track header: frame size and 16 colours; no palette means nothing can be drawn.
  const header = parseVobsubHeader(
    '# VobSub index file, v7\r\nsize: 1920x1080\r\npalette: ' +
      palette16.map((colour) => colour.toString(16).padStart(6, '0')).join(', ') +
      '\r\nlangidx: 0\r\n'
  )
  assert.deepEqual(header, { width: 1920, height: 1080, palette: palette16 })
  assert.equal(parseVobsubHeader('size: 720x480\n'), undefined)
  assert.equal(parseVobsubHeader('size: 99999x480\npalette: ' + '000000,'.repeat(16)), undefined)
})

test('hostile VobSub packets give undefined quickly, never a read outside the packet', () => {
  const good = spu(pictureRows(), { stop: 100 }),
    control = good.readUInt16BE(2),
    changed = (edit: (copy: Buffer) => void) => {
      const copy = Buffer.from(good)
      edit(copy)
      return decodeVobsub(copy, palette16)
    }
  const began = Date.now()
  assert.equal(decodeVobsub(Buffer.alloc(0), palette16), undefined)
  assert.equal(decodeVobsub(Buffer.from([0, 4, 0, 4]), palette16), undefined)
  assert.equal(decodeVobsub(Buffer.alloc(70_000, 1), palette16), undefined, 'over 64 KiB')
  assert.equal(decodeVobsub(good, palette16.slice(0, 4)), undefined, 'a palette of 16 is needed')
  // The control offset points outside the packet, or before the picture data.
  assert.equal(
    changed((copy) => copy.writeUInt16BE(0xfff0, 2)),
    undefined
  )
  assert.equal(
    changed((copy) => copy.writeUInt16BE(1, 2)),
    undefined
  )
  // The 32-bit layout (stated size 0) is not read.
  assert.equal(
    changed((copy) => copy.writeUInt16BE(0, 0)),
    undefined
  )
  // An area far larger than a frame: nothing is allocated for it.
  assert.equal(
    changed((copy) => copy.set([0x00, 0x0f, 0xff, 0x00, 0x0f, 0xff], control + 11)),
    undefined
  )
  // An area whose end is before its start.
  assert.equal(
    changed((copy) => copy.set([0x10, 0x00, 0x05, 0x10, 0x00, 0x05], control + 11)),
    undefined
  )
  // Field offsets outside the picture data.
  assert.equal(
    changed((copy) => copy.writeUInt16BE(0xffff, control + 18)),
    undefined
  )
  assert.equal(
    changed((copy) => copy.writeUInt16BE(2, control + 20)),
    undefined
  )
  // A command cut off by the end of the packet.
  assert.equal(decodeVobsub(good.subarray(0, control + 13), palette16), undefined)
  // Control sequences that point at each other for ever: reading stops at the first step backwards.
  const loop = Buffer.from([
    ...[0, 20, 0, 4],
    ...[0, 0, 0, 12, 0xff, 0, 0, 0],
    ...[0, 0, 0, 4, 0xff, 0, 0, 0],
  ])
  assert.equal(decodeVobsub(loop, palette16), undefined)
  // A colour-change command with an impossible size, and one that runs past the packet.
  assert.equal(
    decodeVobsub(Buffer.from([0, 12, 0, 4, 0, 0, 0, 4, 7, 0, 0, 0xff]), palette16),
    undefined
  )
  assert.equal(
    decodeVobsub(Buffer.from([0, 12, 0, 4, 0, 0, 0, 4, 7, 0xff, 0xff, 0xff]), palette16),
    undefined
  )
  // The largest area with almost no data: the picture is empty, and it does not take long.
  const empty = spu([
    [1, 1, 1, 1],
    [1, 1, 1, 1],
  ])
  empty.set([0x00, 0x07, 0x7f, 0x00, 0x04, 0x3f], empty.readUInt16BE(2) + 11)
  const large = decodeVobsub(empty, palette16)
  assert.deepEqual([large?.width, large?.height], [1920, 1088])
  // Random bytes, and a good packet with random damage: no throw, and any picture stays inside the limits.
  let seed = 12345
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  for (let round = 0; round < 3000; round++) {
    const packet =
      round % 2
        ? Buffer.from(Array.from({ length: 8 + Math.floor(random() * 300) }, () => random() * 256))
        : Buffer.from(good)
    if (round % 2 === 0)
      for (let i = 0; i < 4; i++) packet[Math.floor(random() * packet.length)] = random() * 256
    const image = decodeVobsub(packet, palette16)
    if (image) {
      assert.ok(
        image.width >= 1 && image.width <= 1920 && image.height >= 1 && image.height <= 1088
      )
      assert.equal(image.rgba.length, image.width * image.height * 4)
    }
    vobsubTiming(packet)
  }
  assert.ok(Date.now() - began < 5000, 'bounded work')
})

const pictureHeader =
  '# VobSub index file, v7 (do not modify this line!)\nsize: 720x480\npalette: ' +
  palette16.map((colour) => colour.toString(16).padStart(6, '0')).join(', ') +
  '\n'
const zipped = el(0x6d80, el(0x6240, el(0x5034, num(0x4254, 0))))
const pictureTracks = () =>
  tracks(
    entry(1, 1, 'V_MPEG4/ISO/AVC', 'und'),
    entry(2, 0x11, 'S_TEXT/UTF8', 'eng', 'English'),
    entry(4, 0x11, 'S_VOBSUB', 'chi', 'Pictures', [el(0x63a2, pictureHeader), zipped]),
    // No palette in its header: listed, but it cannot be drawn.
    entry(5, 0x11, 'S_VOBSUB', 'jpn', 'No palette', [el(0x63a2, 'size: 720x480\n')]),
    entry(6, 0x11, 'S_HDMV/PGS', 'kor', 'PGS')
  )
const firstPicture = () => spu(pictureRows(), { x: 100, y: 380, stop: 176 }),
  secondPicture = () => spu(pictureRows().reverse(), { x: 120, y: 400 })
const pictureClusters = (): IndexedCluster[] => [
  {
    time: 0,
    // No duration of its own: the packet's stop time is used.
    children: [
      video(0),
      subtitle(2, 100, 'first'),
      subtitle(4, 200, deflateSync(firstPicture()), 0),
      subtitle(5, 200, firstPicture()),
    ],
    subs: [
      { track: 2, at: 1 },
      { track: 4, at: 2 },
    ],
  },
  {
    time: 30000,
    children: [
      video(0),
      subtitle(4, 0, deflateSync(secondPicture()), 1500),
      // Not a picture packet, and not zlib at all: both are left out.
      subtitle(4, 500, deflateSync(Buffer.from('not a packet'))),
      subtitle(4, 700, 'not zlib'),
    ],
    subs: [
      { track: 4, at: 1 },
      { track: 4, at: 2 },
      { track: 4, at: 3 },
    ],
  },
]

test('a VobSub track is read with and without the index; its packets are read from their place in the file', async (t) => {
  const { write } = await fixture(t)
  const withIndex = await write(
      'pictures.mkv',
      indexed({ list: pictureTracks(), clusters: pictureClusters() })
    ),
    walked = await write(
      'walked.mkv',
      matroska(
        pictureTracks(),
        ...pictureClusters().map((item) => cluster(item.time, ...item.children))
      )
    )
  for (const file of [withIndex, walked]) {
    const found = await readMkvSubtitles(file)
    assert.deepEqual(
      found.map((track) => [track.number, track.graphic, !!track.picture, track.cues.length]),
      [
        [2, false, false, 1],
        [4, true, true, 0],
        [5, true, false, 0],
        [6, true, false, 0],
      ]
    )
    const pictures = found[1]
    assert.deepEqual(
      [pictures.picture?.width, pictures.picture?.height, pictures.picture?.zlib],
      [720, 480, true]
    )
    assert.deepEqual(pictures.picture?.palette, palette16)
    assert.deepEqual(
      pictures.pictures?.map((cue) => [cue.start, cue.end]),
      [
        [0.2, 0.2 + (176 * 1024) / 90000],
        [30, 31.5],
      ]
    )
    assert.equal(found[2].pictures, undefined)
    const packets = await readPicturePackets(file, pictures.picture!, pictures.pictures!)
    assert.deepEqual(packets, [firstPicture(), secondPicture()])
    assert.equal(decodeVobsub(packets[0]!, pictures.picture!.palette)?.x, 100)
    // A place outside the file, or one that holds something else, gives no packet instead of an error.
    assert.deepEqual(
      await readPicturePackets(file, pictures.picture!, [
        { start: 0, end: 1, at: 1e12, size: 100 },
        { start: 0, end: 1, at: 0, size: 40 },
        { start: 0, end: 1, at: 0, size: 1e9 },
      ]),
      [undefined, undefined, undefined]
    )
  }
  // Reading from 30 s with the index: the picture there is read before the one at the start.
  let live: { pictures?: { start: number }[] }[] = [],
    firstRead: number | undefined
  await readMkvSubtitles(withIndex, {
    focus: () => 30,
    onTracks: (found) => (live = found),
    onProgress: () => {
      firstRead ??= live[1]?.pictures?.[0]?.start
    },
  })
  assert.equal(firstRead, 30)
})

test('the explorer answers with the picture cues around a time, from a cache that holds no packets', async (t) => {
  const { root, closers } = await fixture(t)
  const media = path.join(root, 'media'),
    local = path.join(root, 'local')
  await fs.mkdir(media)
  await fs.writeFile(
    path.join(media, 'film.mkv'),
    indexed({ list: pictureTracks(), clusters: pictureClusters() })
  )
  // 100 cues, 0.3 s apart, each 0.2 s long.
  const packet = deflateSync(firstPicture())
  await fs.writeFile(
    path.join(media, 'many.mkv'),
    matroska(
      pictureTracks(),
      cluster(
        0,
        ...Array.from({ length: 100 }, (_, index) => subtitle(4, index * 300, packet, 200))
      )
    )
  )
  const library = new Library(local, undefined, false)
  await library.init()
  const progress: number[] = []
  const desktop: DesktopOperations = {
    choose: async () => undefined,
    open: async () => {},
    launch: async () => {},
    thumbnail: async () => Buffer.from('x'),
    subtitleProgress: (value) => progress.push(value.fraction),
  }
  const explorer = new Explorer(library, local, desktop)
  closers.push(() => explorer.index.close())
  const snapshot = await library.create(media, { name: 'P', depth: { mode: 'through', level: 1 } }),
    row = snapshot.rows[0],
    entries = (await explorer.content(row.rowId)).entries,
    film = entries.find((entry) => entry.name === 'film.mkv')!,
    many = entries.find((entry) => entry.name === 'many.mkv')!
  const ask = (fileId: string, track: number, time?: number) =>
    explorer.request({ action: 'embeddedPictures', rowId: row.rowId, fileId, track, time })
  const check = async () => {
    const list = await explorer.request({
      action: 'embeddedSubtitles',
      rowId: row.rowId,
      fileId: film.id,
    })
    assert.deepEqual(
      list.embedded?.tracks.map((track) => [
        track.number,
        track.graphic,
        !!track.picture,
        track.cues,
      ]),
      [
        [2, false, false, 1],
        [4, true, true, 2],
        [5, true, false, 0],
        [6, true, false, 0],
      ]
    )
    const { pictures } = await ask(film.id, 4, 0)
    assert.deepEqual(
      [pictures?.token, pictures?.width, pictures?.height, pictures?.from, pictures?.until],
      ['emb-4', 720, 480, 0, undefined]
    )
    assert.deepEqual(pictures?.palette, palette16)
    assert.deepEqual(
      pictures?.cues.map((cue) => [cue.start, cue.end, Buffer.from(cue.data, 'base64')]),
      [
        [0.2, 0.2 + (176 * 1024) / 90000, firstPicture()],
        [30, 31.5, secondPicture()],
      ]
    )
  }
  await check()
  // Later in the film only the cues that have not ended yet; past the last one, none.
  assert.deepEqual(
    (await ask(film.id, 4, 35)).pictures?.cues.map((cue) => cue.start),
    [30]
  )
  assert.deepEqual((await ask(film.id, 4, 100)).pictures?.cues, [])
  await assert.rejects(ask(film.id, 5), /圖形字幕，目前無法顯示/)
  await assert.rejects(ask(film.id, 6), /圖形字幕，目前無法顯示/)
  await assert.rejects(ask(film.id, 2), /不是圖形字幕/)
  await assert.rejects(ask(film.id, 99), /找不到/)
  await assert.rejects(
    explorer.request({ action: 'embeddedSubtitle', rowId: row.rowId, fileId: film.id, track: 4 }),
    /圖形字幕/
  )
  // A long track is answered a stretch at a time: 80 cues, and where the stretch stops.
  const start = await ask(many.id, 4, 0)
  assert.equal(start.pictures?.cues.length, 80)
  assert.equal(start.pictures?.until, 24)
  const later = await ask(many.id, 4, 25)
  assert.deepEqual(
    [later.pictures?.from, later.pictures?.cues[0].start, later.pictures?.cues.length],
    [15, 15, 50]
  )
  assert.equal(later.pictures?.until, undefined)
  // The cache file holds times and places only, and a later session answers from it without reading the tracks.
  const cacheDir = path.join(local, 'subtitle-cache'),
    cacheFiles = (await fs.readdir(cacheDir)).filter((name) => name.endsWith('.json'))
  assert.equal(cacheFiles.length, 2)
  for (const name of cacheFiles) {
    const text = await fs.readFile(path.join(cacheDir, name), 'utf8')
    assert.ok(text.length < 20_000 && !text.includes('"data"'))
  }
  explorer.embeddedSubtitles.clear()
  progress.length = 0
  await check()
  assert.deepEqual(progress, [], 'served from the cache file')
  // The request's fields are checked before any work.
  const request = { action: 'embeddedPictures', rowId: row.rowId, fileId: film.id, track: 4 }
  assert.ok(isExplorerRequest(request))
  assert.ok(!isExplorerRequest({ ...request, track: '4' }))
  assert.ok(!isExplorerRequest({ ...request, fileId: '' }))
  assert.ok(!isExplorerRequest({ ...request, time: 'now' }))
})

// R-425: fansub karaoke and signs are drawn one frame per line; those pieces are left out, read or indexed.
test('pieces of effects are left out, from the index without reading them and from the clusters', async (t) => {
  const { write } = await fixture(t)
  const piece = (relative: number, text: string) => subtitle(2, relative, text, 40)
  // Read from the clusters: a 40 ms line is a piece, a 2 s line is said.
  const walked = await readMkvSubtitles(
    await write(
      'walked.mkv',
      matroska(
        tracks(entry(2, 0x11, 'S_TEXT/UTF8', 'jpn')),
        cluster(0, piece(0, 'に'), piece(40, 'な'), subtitle(2, 500, 'line'))
      )
    )
  )
  assert.deepEqual(
    walked[0].cues.map((cue) => cue.text),
    ['line']
  )
  // From the index: the entries say 40 ms, so those blocks are never read; the track still counts as indexed.
  const file = await write(
    'pieces.mkv',
    indexed({
      clusters: [
        {
          time: 0,
          children: [video(0), piece(0, 'に'), piece(40, 'な'), subtitle(2, 500, 'first')],
          subs: [
            { track: 2, at: 1, duration: 40 },
            { track: 2, at: 2, duration: 40 },
            { track: 2, at: 3, duration: 2000 },
          ],
        },
        {
          time: 30000,
          children: [video(0), subtitle(3, 0, 'lo there')],
          subs: [{ track: 3, at: 1, duration: 2000 }],
        },
      ],
    })
  )
  const fromIndex = await readMkvSubtitles(file)
  assert.deepEqual(
    fromIndex.map((track) => track.cues.map((cue) => cue.text)),
    [['first'], ['Hello there']]
  )
})

test('with no subtitle places in the index the clusters are read from the playback time first', async (t) => {
  const { write } = await fixture(t)
  // Only the video is indexed (as many tools write it): its entries still tell where each cluster starts.
  const file = await write(
    'video-index.mkv',
    indexed({
      clusters: [
        { time: 0, children: [video(0), subtitle(2, 100, 'first')], subs: [{ track: 1, at: 0 }] },
        {
          time: 30000,
          children: [video(0), subtitle(2, 0, 'second')],
          subs: [{ track: 1, at: 0 }],
        },
        { time: 65000, children: [video(0), subtitle(2, 0, 'third')], subs: [{ track: 1, at: 0 }] },
      ],
    })
  )
  let live: { cues: { text: string }[] }[] = [],
    firstRead: string | undefined
  const found = await readMkvSubtitles(file, {
    focus: () => 40,
    onTracks: (list) => (live = list),
    onProgress: () => {
      firstRead ??= live.flatMap((track) => track.cues)[0]?.text
    },
  })
  assert.equal(firstRead, 'second', 'the cluster at 30 s (the one playing at 40 s) is read first')
  assert.deepEqual(
    found[0].cues.map((cue) => cue.text),
    ['first', 'second', 'third']
  )
})

test('a read can be stopped, and opening another video stops the one before', async (t) => {
  const { write, root, closers } = await fixture(t)
  const stopped = new AbortController()
  stopped.abort()
  await assert.rejects(
    readMkvSubtitles(await write('stop.mkv', sample()), { signal: stopped.signal }),
    /取消/
  )
  // A file that cannot be read keeps failing from the cache, without reading it again.
  const media = path.join(root, 'media'),
    local = path.join(root, 'local')
  await fs.mkdir(media)
  await fs.writeFile(path.join(media, 'bad.mkv'), Buffer.from('not a video at all'))
  const library = new Library(local, undefined, false)
  await library.init()
  const progress: number[] = []
  const explorer = new Explorer(library, local, {
    choose: async () => undefined,
    open: async () => {},
    launch: async () => {},
    thumbnail: async () => Buffer.from('x'),
    subtitleProgress: (value) => progress.push(value.fraction),
  })
  closers.push(() => explorer.index.close())
  const snapshot = await library.create(media, { name: 'P', depth: { mode: 'through', level: 1 } }),
    row = snapshot.rows[0],
    bad = (await explorer.content(row.rowId)).entries.find((entry) => entry.name === 'bad.mkv')!
  await assert.rejects(
    explorer.request({ action: 'embeddedSubtitles', rowId: row.rowId, fileId: bad.id }),
    /不是 Matroska/
  )
  const cacheFiles = await fs.readdir(path.join(local, 'subtitle-cache'))
  assert.equal(cacheFiles.filter((name) => name.endsWith('.json')).length, 1, 'the failure is kept')
  await assert.rejects(
    explorer.request({ action: 'embeddedSubtitles', rowId: row.rowId, fileId: bad.id }),
    /不是 Matroska/
  )
})
