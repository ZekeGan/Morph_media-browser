import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import type { MediaEntry } from '../shared/explorer'
import {
  isGameFolder,
  matchesMedia,
  mediaIdentity,
  mediaQueue,
  sortMedia,
  visibleFile,
} from '../shared/media'
import type { FolderRow } from '../shared/model'
import { defaultWorkspace } from '../shared/workspace'

import { Explorer } from '../electron/explorer'
import { folderFile } from '../electron/files'
import { hiddenFileNames } from '../electron/hidden'
import { Library } from '../electron/library'
import { validateWorkspace } from '../electron/workspace'

const entry = (
  id: string,
  kind: MediaEntry['kind'] = 'image',
  extra: Partial<MediaEntry> = {}
): MediaEntry => ({ id, name: id, kind, url: id, mime: 'test', size: 1, modified: 0, ...extra })
test('identical file IDs from different source folders retain separate identities', () => {
  const first = { ...entry('same'), rowId: 'A' }
  const second = { ...entry('same'), rowId: 'B' }
  assert.notEqual(mediaIdentity(first), mediaIdentity(second))
  assert.equal(mediaIdentity(entry('same')), 'same')
})
test('unsupported file kinds stay browsable but cannot form viewer queues', () => {
  for (const kind of ['other', 'subtitle', 'folder'] as const) {
    const selected = entry('unsupported', kind)
    assert.equal(matchesMedia(selected, 'all'), kind !== 'folder')
    assert.deepEqual(mediaQueue([selected, entry('second', kind)], selected), [])
  }
  for (const kind of ['image', 'video', 'audio', 'pdf', 'archive'] as const) {
    const selected = entry('supported', kind)
    assert.deepEqual(mediaQueue([selected, entry('other', 'other')], selected), [selected])
  }
})
test('queues use the displayed same-kind sequence, retain zero-result filters and distinguish hidden attributes from extensions', () => {
  const entries = [
    entry('2'),
    entry('clip', 'video'),
    entry('1'),
    entry('track', 'audio'),
    entry('settings.ini', 'other'),
    entry('.note', 'other'),
  ]
  assert.deepEqual(
    mediaQueue(entries, entries[0]).map((file) => file.id),
    ['2', '1']
  )
  assert.deepEqual(
    entries.filter((file) => matchesMedia(file, 'audio')).map((file) => file.id),
    ['track']
  )
  assert.deepEqual(
    entries.filter((file) => matchesMedia(file, 'other')).map((file) => file.id),
    ['settings.ini', '.note']
  )
  assert.equal(matchesMedia(entry('folder', 'folder'), 'all'), false)
  assert.equal(visibleFile(entries[4]), true)
  assert.equal(visibleFile(entry('hidden', 'other', { hidden: true })), false)
  // R-485: a name starting with a dot is listed; a preference an older version saved is still accepted and ignored.
  assert.equal(visibleFile(entry('.dot')), true)
  validateWorkspace({
    ...defaultWorkspace(),
    fileVisibility: { hidden: true, dotfiles: false },
  } as never)
})
test('candidate UI qualification does not override an explicit not-game record', () => {
  const row = {
    boundary: { state: 'candidate', engines: [], evidence: [] },
  } as unknown as FolderRow
  assert.equal(isGameFolder(row), true)
  assert.equal(isGameFolder({} as FolderRow), false)
  assert.equal(
    isGameFolder({ ...row, record: { details: { boundary: { state: 'not-game' } } } } as FolderRow),
    false
  )
})
test('new media projects reopen without migration, enumerate audio and hidden flags, and preserve original files', async (t) => {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'mixed-contract-'))
  const media = path.join(root, 'Media')
  const local = path.join(root, 'local')
  await fs.mkdir(media)
  const originals = {
    'song.mp3': 'CONTROLLED MP3 PLACEHOLDER',
    'sound.wav': 'CONTROLLED WAV PLACEHOLDER',
    'normal.ini': 'VISIBLE CONFIG',
    'secret.txt': 'HIDDEN ORIGINAL',
    '.dot': 'DOT ORIGINAL',
  }
  for (const [name, bytes] of Object.entries(originals)) {
    await fs.writeFile(path.join(media, name), bytes)
  }
  if (process.platform === 'win32') {
    await promisify(execFile)('attrib.exe', ['+H', path.join(media, 'secret.txt')], {
      windowsHide: true,
    })
  }
  const library = new Library(local, undefined, false)
  await library.init()
  await library.create(media, {
    name: 'Mixed',
    scanAll: true,
    depth: { mode: 'through', level: 1 },
  })
  const project = library.snapshot().projects[0].project!
  assert.equal(project.list.itemsPerRow, 3)
  assert.deepEqual(project.cardView, { mode: 'single', level: 1 })
  assert.equal(project.scanAll, true)
  const explorer = new Explorer(library, local, {
    choose: async () => undefined,
    open: async () => {},
    launch: async () => {},
    thumbnail: async () => Buffer.alloc(0),
  })
  t.after(() => explorer.close())
  const row = library.snapshot().rows[0]
  const before = await fs.readFile(folderFile(media))
  let cursor: string | undefined
  const entries: MediaEntry[] = []
  do {
    const result = await explorer.content(row.rowId, 2, cursor)
    entries.push(...result.entries)
    cursor = result.nextCursor
  } while (cursor)
  assert.equal(entries.filter((file) => file.kind === 'audio').length, 2)
  const audio = entries.find((file) => file.name === 'sound.wav')!
  const response = await explorer.stream(
    row.rowId,
    audio.id,
    new Request(audio.url, { headers: { Range: 'bytes=0-3' } })
  )
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('Content-Type'), 'audio/wav')
  assert.equal(await response.text(), 'CONT')
  const config = entries.find((file) => file.name === 'normal.ini')!
  assert.equal((await explorer.stream(row.rowId, config.id, new Request(config.url))).status, 415)
  assert.ok(!entries.some((file) => file.name === '.media-viewer'))
  assert.equal(visibleFile(entries.find((file) => file.name === 'normal.ini')!), true)
  if (process.platform === 'win32') {
    assert.equal(entries.find((file) => file.name === 'secret.txt')?.hidden, true)
  }
  const reopened = new Library(local, undefined, false)
  await reopened.init()
  assert.equal((await hiddenFileNames(media)).has('normal.ini'), false)
  assert.deepEqual(await fs.readFile(folderFile(media)), before)
  for (const [name, bytes] of Object.entries(originals)) {
    assert.equal(await fs.readFile(path.join(media, name), 'utf8'), bytes)
  }
})
test('R-486: the file list sorts by one field and a direction, ties by natural name, empty values last', () => {
  const file = (name: string, size = 0, modified = 0, kind: MediaEntry['kind'] = 'image') =>
    ({ id: name, name, kind, size, modified, mime: '', url: '' }) as MediaEntry
  const list = [
    file('10.png', 300, 5),
    file('2.png', 100, 9),
    file('b.mp4', 200, 0, 'video'),
    file('a.png', 100, 7),
  ]
  const names = (sort: Parameters<typeof sortMedia>[1]) => sortMedia(list, sort).map((f) => f.name)
  assert.deepEqual(names({ field: 'name', asc: true }), ['2.png', '10.png', 'a.png', 'b.mp4'])
  assert.deepEqual(names({ field: 'name', asc: false }), ['b.mp4', 'a.png', '10.png', '2.png'])
  // Equal sizes fall back to the name; a larger file goes last when ascending.
  assert.deepEqual(names({ field: 'size', asc: true }), ['2.png', 'a.png', 'b.mp4', '10.png'])
  assert.deepEqual(names({ field: 'size', asc: false }), ['10.png', 'b.mp4', '2.png', 'a.png'])
  // A file with no date is last in both directions.
  assert.deepEqual(names({ field: 'modified', asc: true }), ['10.png', 'a.png', '2.png', 'b.mp4'])
  assert.deepEqual(names({ field: 'modified', asc: false }), ['2.png', 'a.png', '10.png', 'b.mp4'])
  assert.deepEqual(names({ field: 'kind', asc: true }).at(-1), 'b.mp4')
  // The input is left alone.
  assert.deepEqual(
    list.map((f) => f.name),
    ['10.png', '2.png', 'b.mp4', 'a.png']
  )
})
