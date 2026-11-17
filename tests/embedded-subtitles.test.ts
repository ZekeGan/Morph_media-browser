import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { deflateSync } from 'node:zlib'
import { Library } from '../electron/library'
import { Explorer, type DesktopOperations } from '../electron/explorer'
import { LIMITS, readMkvSubtitles } from '../electron/mkv-subtitles'
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
    LIMITS.cuesPerTrack = 1
    await assert.rejects(readMkvSubtitles(await write('many.mkv', whole)), /過大/)
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
function indexed(options: { lie?: boolean } = {}) {
  const info = el(0x1549a966, el(0x2ad7b1, [0x0f, 0x42, 0x40]))
  const list = tracks(
    entry(1, 1, 'V_MPEG4/ISO/AVC', 'und'),
    entry(2, 0x11, 'S_TEXT/UTF8', 'eng', 'English'),
    // Header stripping (algorithm 3): every block lost the same leading bytes.
    entry(3, 0x11, 'S_TEXT/UTF8', 'jpn', 'Stripped', [
      el(0x6d80, el(0x6240, el(0x5034, Buffer.concat([num(0x4254, 3), el(0x4255, 'Hel')])))),
    ])
  )
  const clusters: { time: number; children: Buffer[]; subs: { track: number; at: number }[] }[] = [
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
