import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Library } from '../electron/library'
import { Explorer, type DesktopOperations } from '../electron/explorer'
import { detectFolderKind, sampleOf } from '../shared/kind'
import { readFolder } from '../electron/files'
import { isGameFolder } from '../shared/media'
import type { FolderRow } from '../shared/model'

const row = (details?: object, boundary?: object) =>
  ({
    boundary,
    record: details ? { details: { schemaVersion: 1, ...details } } : undefined,
  }) as unknown as FolderRow
const files = (images: number, videos = 0, audio = 0, names: string[] = []) =>
  sampleOf([
    ...Array.from({ length: images }, () => ({ kind: 'image' })),
    ...Array.from({ length: videos }, () => ({ kind: 'video' })),
    ...Array.from({ length: audio }, () => ({ kind: 'audio' })),
    // Named files get the kind the folder listing gives them.
    ...names.map((name) => ({
      name,
      kind: /\.(txt|epub)$/.test(name)
        ? 'text'
        : /\.pdf$/.test(name)
          ? 'pdf'
          : /\.(zip|cbz)$/.test(name)
            ? 'archive'
            : 'other',
    })),
    { kind: 'folder' },
    { kind: 'subtitle' },
  ])
const kindOf = (...sample: Parameters<typeof files>) =>
  detectFolderKind(row({}), files(...sample)).kind

test('folder kind: manual choice, detected game, reading mode, then file content; unsure means general', () => {
  assert.deepEqual(detectFolderKind(row({ kind: 'music' }, { engines: ['x'] }), files(20)), {
    kind: 'music',
    source: 'manual',
  })
  assert.deepEqual(detectFolderKind(row(undefined, { engines: ['RPG Maker'], evidence: [] })), {
    kind: 'game',
    source: 'game',
  })
  // A folder the user marked "not a game" is not treated as one, whatever was detected.
  assert.equal(
    detectFolderKind(row({ boundary: { state: 'not-game', engines: [], evidence: [] } }, {})).kind,
    'general'
  )
  // R-411: an old reading mode is kept in the record but no longer decides the type.
  assert.deepEqual(detectFolderKind(row({ reading: { mode: 'manga' } }), files(2)), {
    kind: 'general',
    source: 'default',
  })
  assert.deepEqual(detectFolderKind(row({})), { kind: 'general', source: 'default' })
  assert.equal(kindOf(0), 'general', 'an empty folder is general')
})

test('folder kind by content: video, music, text book, manga, in that order (R-387)', () => {
  // Video: at least one, and no fewer than the pictures.
  assert.equal(kindOf(5, 5), 'video')
  assert.equal(kindOf(0, 1, 9), 'video', 'the video rule comes before music')
  assert.equal(kindOf(6, 5), 'general', 'more pictures than videos is neither video nor manga')
  assert.equal(kindOf(6, 1, 0, ['a.cbz']), 'general', 'a video rules manga out')
  // Music: most files, not counting cover pictures, cue sheets, lyrics and playlists.
  assert.equal(kindOf(0, 0, 4), 'music')
  assert.equal(kindOf(2, 0, 3, ['album.cue', '01.lrc', '02.LRC', 'list.m3u8', 'rip.log']), 'music')
  assert.equal(kindOf(0, 0, 2, ['a.bin', 'b.bin']), 'general', 'half is not most')
  assert.equal(kindOf(0, 0, 2, ['a.bin']), 'music')
  // Pictures count once they outnumber the tracks; music and pictures together cannot be told apart, so general.
  assert.equal(kindOf(30, 0, 3), 'general', 'an album with many scans is undecidable')
  assert.equal(kindOf(20, 0, 12), 'general')
  assert.equal(kindOf(3, 0, 2), 'general', 'a book with drama tracks is undecidable')
  // Text books: any EPUB, or TXT files making up at least half.
  assert.equal(kindOf(8, 0, 0, ['book.epub']), 'book')
  assert.equal(kindOf(0, 0, 0, ['a.txt', 'b.bin']), 'book')
  assert.equal(kindOf(0, 0, 0, ['a.txt', 'b.bin', 'c.bin']), 'general')
  // Manga: three or more pictures that are most of the files, or a comic archive.
  assert.equal(kindOf(30), 'book')
  assert.equal(kindOf(2), 'general', 'two pictures are not a book')
  assert.equal(kindOf(3, 0, 0, ['a.bin', 'b.bin']), 'book')
  assert.equal(kindOf(3, 0, 0, ['a.bin', 'b.bin', 'c.bin']), 'general', 'half is not most')
  for (const name of ['v1.cbz', 'v1.CBR', 'v1.cb7'])
    assert.equal(kindOf(0, 0, 0, [name, 'a.bin', 'b.bin']), 'book')
  // PDF and plain ZIP files never decide.
  assert.equal(kindOf(0, 0, 0, ['a.pdf', 'b.zip']), 'general')
  assert.deepEqual(files(1, 0, 0, ['a.epub', 'b.txt', 'c.cbz', 'd.cue', 'e.pdf']), {
    images: 1,
    videos: 0,
    audio: 0,
    texts: 2,
    epubs: 1,
    comics: 1,
    sidecars: 1,
    total: 6,
  })
})

test('the scan counts what a folder holds the way an opened folder does', async (t) => {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'folder-kind-scan-')),
    media = path.join(root, 'media')
  t.after(async () => {
    const target = await fs.realpath(root)
    if (!target.startsWith(base + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  const folders: Record<string, string[]> = {
    Album: ['01.mp3', '02.flac', 'cover.bmp', 'album.cue', '01.lrc'],
    Comic: ['v1.cbr', 'notes.bin'],
    Clips: ['a.mp4', 'a.jpg'],
    Papers: ['a.pdf', 'b.zip'],
  }
  for (const [name, list] of Object.entries(folders)) {
    await fs.mkdir(path.join(media, name), { recursive: true })
    for (const file of list) await fs.writeFile(path.join(media, name, file), 'x')
  }
  const lib = new Library(path.join(root, 'local'), undefined, false)
  await lib.init()
  await lib.create(media, { name: 'Kinds', scanAll: true, depth: { mode: 'through', level: 2 } })
  const rowOf = (name: string) => lib.snapshot().rows.find((r) => r.name === name)!
  assert.deepEqual(rowOf('Album').contents, {
    images: 1,
    videos: 0,
    audio: 2,
    texts: 0,
    epubs: 0,
    comics: 0,
    sidecars: 2,
    total: 5,
  })
  const detected = (name: string) => detectFolderKind(rowOf(name), rowOf(name).contents).kind
  assert.deepEqual(Object.keys(folders).map(detected), ['music', 'book', 'video', 'general'])
})

test('the folderKind request stores or clears the manual kind and rejects unknown kinds', async (t) => {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'folder-kind-')),
    media = path.join(root, 'media'),
    local = path.join(root, 'local')
  await fs.mkdir(path.join(media, 'A'), { recursive: true })
  const lib = new Library(local, undefined, false)
  await lib.init()
  const desktop: DesktopOperations = {
    choose: async () => undefined,
    open: async () => {},
    launch: async () => {},
    thumbnail: async () => Buffer.from('x'),
  }
  const explorer = new Explorer(lib, local, desktop)
  t.after(async () => {
    explorer.index.close()
    const target = await fs.realpath(root)
    if (!target.startsWith(base + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  await lib.create(media, {
    name: 'Kinds',
    depth: { mode: 'through', level: 2 },
  })
  const rowA = () => lib.snapshot().rows.find((r) => r.name === 'A')!
  await explorer.request({
    action: 'folderKind',
    rowId: rowA().rowId,
    revision: rowA().record!.revision,
    kind: 'book',
  })
  assert.equal((await readFolder(rowA().path)).details?.kind, 'book')
  assert.equal(detectFolderKind(rowA()).kind, 'book')
  await assert.rejects(
    explorer.request({
      action: 'folderKind',
      rowId: rowA().rowId,
      revision: rowA().record!.revision,
      kind: 'spaceship' as never,
    }),
    /類型不合法/
  )
  await explorer.request({
    action: 'folderKind',
    rowId: rowA().rowId,
    revision: rowA().record!.revision,
    kind: null,
  })
  assert.equal((await readFolder(rowA().path)).details?.kind, undefined)
  assert.equal((await readFolder(rowA().path)).details?.boundary, undefined, 'a book is no game')
  // R-380: choosing "game" also marks the folder as a game main folder, so the game page shows in one step.
  assert.equal(isGameFolder(rowA()), false)
  const made = await explorer.request({
    action: 'folderKind',
    rowId: rowA().rowId,
    revision: rowA().record!.revision,
    kind: 'game',
  })
  // The answer comes from a new scan, so the row already carries the boundary the panel and lists read.
  assert.equal(
    made.snapshot!.rows.find((r) => r.name === 'A')!.boundary?.state,
    'root',
    'the returned row is the rescanned one'
  )
  assert.deepEqual((await readFolder(rowA().path)).details?.boundary, {
    state: 'root',
    engines: [],
    evidence: ['使用者指定'],
  })
  assert.equal(isGameFolder(rowA()), true)
  assert.deepEqual(detectFolderKind(rowA()), { kind: 'game', source: 'manual' })
  // A folder the user had said is not a game becomes one when they choose the game type after all.
  await explorer.request({
    action: 'boundary',
    rowId: rowA().rowId,
    revision: rowA().record!.revision,
    state: 'not-game',
  })
  assert.equal(isGameFolder(rowA()), false)
  await explorer.request({
    action: 'folderKind',
    rowId: rowA().rowId,
    revision: rowA().record!.revision,
    kind: 'game',
  })
  assert.equal((await readFolder(rowA().path)).details?.boundary?.state, 'root')
  // Another type afterwards leaves the mark: "this is not a game folder" is what removes it.
  await explorer.request({
    action: 'folderKind',
    rowId: rowA().rowId,
    revision: rowA().record!.revision,
    kind: 'video',
  })
  assert.equal((await readFolder(rowA().path)).details?.boundary?.state, 'root')
})

test('folderKinds sets the kind of several folders and reports the ones that fail', async (t) => {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'folder-kinds-')),
    media = path.join(root, 'media'),
    local = path.join(root, 'local')
  for (const name of ['A', 'B']) await fs.mkdir(path.join(media, name), { recursive: true })
  const lib = new Library(local, undefined, false)
  await lib.init()
  const desktop: DesktopOperations = {
    choose: async () => undefined,
    open: async () => {},
    launch: async () => {},
    thumbnail: async () => Buffer.from('x'),
  }
  const explorer = new Explorer(lib, local, desktop)
  t.after(async () => {
    explorer.index.close()
    const target = await fs.realpath(root)
    if (!target.startsWith(base + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  await lib.create(media, { name: 'Kinds', depth: { mode: 'through', level: 2 } })
  const rowOf = (name: string) => lib.snapshot().rows.find((r) => r.name === name)!
  const a = rowOf('A'),
    b = rowOf('B')
  const result = await explorer.request({
    action: 'folderKinds',
    rows: [
      { rowId: a.rowId, revision: a.record!.revision },
      { rowId: b.rowId, revision: b.record!.revision + 5 },
    ],
    kind: 'music',
  })
  assert.equal((await readFolder(rowOf('A').path)).details?.kind, 'music')
  assert.equal(
    (await readFolder(rowOf('B').path)).details?.kind,
    undefined,
    'a stale revision is not written'
  )
  assert.match(result.notice?.message ?? JSON.stringify(result.notice), /失敗|b/i)
  await assert.rejects(
    explorer.request({ action: 'folderKinds', rows: [], kind: 'video' }),
    /批次範圍不合法/
  )
  await assert.rejects(
    explorer.request({
      action: 'folderKinds',
      rows: [{ rowId: a.rowId, revision: 1 }],
      kind: 'x' as never,
    }),
    /類型不合法/
  )
  await explorer.request({
    action: 'folderKinds',
    rows: [{ rowId: a.rowId, revision: rowOf('A').record!.revision }],
    kind: null,
  })
  assert.equal((await readFolder(rowOf('A').path)).details?.kind, undefined)
  // R-380: the batch only sets the type. It does not make main folders, whose insides are protected, of a selection.
  await explorer.request({
    action: 'folderKinds',
    rows: [{ rowId: a.rowId, revision: rowOf('A').record!.revision }],
    kind: 'game',
  })
  const batched = (await readFolder(rowOf('A').path)).details
  assert.equal(batched?.kind, 'game')
  assert.equal(batched?.boundary, undefined)
})

test('R-404: pictures alone are not manga inside a music or video folder, or in a folder named like extras', () => {
  const named = (name: string) => ({ ...row({}), name }) as FolderRow,
    seven = files(7)
  assert.equal(detectFolderKind(row({}), seven).kind, 'book')
  assert.equal(detectFolderKind(row({}), seven, 'music').kind, 'general')
  assert.equal(detectFolderKind(row({}), seven, 'video').kind, 'general')
  assert.equal(detectFolderKind(row({}), seven, 'general').kind, 'book')
  assert.equal(detectFolderKind(row({}), seven, 'book').kind, 'book')
  for (const name of [
    'scans',
    'Scans 1',
    'SCAN_2',
    'Booklet',
    'artworks',
    'Covers',
    'BK',
    'ジャケット',
    '特典',
    'スキャン',
  ])
    assert.equal(detectFolderKind(named(name), seven).kind, 'general', name)
  for (const name of ['scansion', 'My scans', 'Vol 1', 'covers of x'])
    assert.equal(detectFolderKind(named(name), seven).kind, 'book', name)
  // A manual kind and comic archives still win.
  assert.equal(detectFolderKind(row({ kind: 'book' }), seven, 'music').kind, 'book')
  assert.equal(detectFolderKind(named('scans'), files(0, 0, 0, ['a.cbz'])).kind, 'book')
})
