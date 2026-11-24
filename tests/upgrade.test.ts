import { plainMessage } from '../shared/message'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Library } from '../electron/library'
import { WorkspaceStore } from '../electron/workspace'
import { managedTree } from '../electron/maintenance'
import {
  ensureFolder,
  folderFile,
  readFolder,
  readJson,
  restoreJson,
  saveFolder,
} from '../electron/files'
import { validateFolder, validateProject, type Cell, type Project } from '../shared/model'
import { modelProject } from './support/model-fixtures'
import {
  FORMAT_VERSION,
  NewerFormatError,
  UPGRADE_STEPS,
  isNewerFormat,
  upgradeFormat,
  upgradeStored,
  type FormatKind,
} from '../shared/upgrade'
import { classifyError, errorMessage } from '../shared/notifications'
import { migrateRecord } from '../shared/project-export'
import { detectFolderKind } from '../shared/kind'
import type { FolderRow } from '../shared/model'

// A folder record as version 1 wrote it (R-387): shared values, a project's private values, fields this version does
// not know, and the combined audio/video kind set by hand.
const V1_FOLDER = path.resolve('tests', 'fixtures', 'folder-v1.json')
const v1Folder = async () => JSON.parse(await fs.readFile(V1_FOLDER, 'utf8'))
async function placeV1(dir: string) {
  await fs.mkdir(path.dirname(folderFile(dir)), { recursive: true })
  await fs.copyFile(V1_FOLDER, folderFile(dir))
  return fs.readFile(folderFile(dir), 'utf8')
}

async function sandbox(t: { after: (fn: () => Promise<void>) => void }, name: string) {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, `${name}-`))
  t.after(async () => {
    const target = await fs.realpath(root)
    if (!target.startsWith(base + path.sep)) throw new Error('Unsafe test cleanup')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  return root
}
// Pretends this build writes the next version of one format, with a step from the current one, for the length of a
// test.
function pretendNext(
  t: { after: (fn: () => void) => void },
  format: FormatKind,
  step: (value: Record<string, unknown>) => Record<string, unknown>
) {
  const current = FORMAT_VERSION[format]
  FORMAT_VERSION[format] = current + 1
  UPGRADE_STEPS[format][current] = step
  t.after(() => {
    FORMAT_VERSION[format] = current
    delete UPGRADE_STEPS[format][current]
  })
}
const raw = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'))

test('upgrade steps run in order, and a missing step or newer data is refused', (t) => {
  assert.deepEqual(upgradeFormat('details', { schemaVersion: 1, a: 1 }), {
    schemaVersion: 1,
    a: 1,
  })
  assert.deepEqual(upgradeFormat('folder', { schemaVersion: 1, a: 1 }), {
    schemaVersion: 2,
    a: 1,
  })
  assert.throws(() => upgradeFormat('folder', { schemaVersion: 3 }), NewerFormatError)
  FORMAT_VERSION.project = 5
  t.after(() => {
    FORMAT_VERSION.project = 3
    delete UPGRADE_STEPS.project[3]
    delete UPGRADE_STEPS.project[4]
  })
  UPGRADE_STEPS.project[3] = (v) => ({ ...v, trail: ['3→4'] })
  assert.throws(
    () => upgradeFormat('project', { schemaVersion: 3 }),
    (error) => /v4 → v5/.test(plainMessage(String(error)))
  )
  UPGRADE_STEPS.project[4] = (v) => ({ ...v, trail: [...(v.trail as string[]), '4→5'] })
  const input = { schemaVersion: 3 }
  assert.deepEqual(upgradeFormat('project', input), { schemaVersion: 5, trail: ['3→4', '4→5'] })
  assert.deepEqual(input, { schemaVersion: 3 }, 'the value read is never changed in place')
})

test('an older folder record is upgraded on read and written in the new format only on save', async (t) => {
  const dir = await sandbox(t, 'upgrade-folder')
  const before = await placeV1(dir)
  await fs.writeFile(path.join(dir, 'clip.mp4'), 'ORIGINAL')
  const record = await readFolder(dir)
  assert.equal(record.schemaVersion, 2)
  assert.equal(record.details?.kind, undefined)
  assert.equal(record.details?.browseAs, 'work')
  assert.equal(await fs.readFile(folderFile(dir), 'utf8'), before, 'reading never writes')
  // A save that is refused leaves the v1 file as it was, with no backup made.
  await assert.rejects(saveFolder(dir, record, record.revision + 1))
  assert.equal(await fs.readFile(folderFile(dir), 'utf8'), before)
  await assert.rejects(fs.stat(folderFile(dir) + '.bak'), { code: 'ENOENT' })
  await saveFolder(dir, record, record.revision)
  const saved = await raw(folderFile(dir))
  assert.equal(saved.schemaVersion, 2)
  assert.equal('kind' in saved.details, false)
  assert.deepEqual(saved.futureNote, { kept: true })
  assert.equal(
    await fs.readFile(folderFile(dir) + '.bak', 'utf8'),
    before,
    'the v1 file stays as the backup'
  )
  // Every reader of the v1 backup sees the current format.
  assert.equal(
    ((await readJson(folderFile(dir) + '.bak')) as { schemaVersion: number }).schemaVersion,
    2
  )
  // The v1 backup is still usable after the upgrade.
  await fs.writeFile(folderFile(dir), '{broken')
  await restoreJson(dir, folderFile(dir), validateFolder, (v) => v.folderId === record.folderId)
  assert.equal((await readFolder(dir)).schemaVersion, 2)
  assert.equal((await readFolder(dir)).details?.kind, undefined)
  assert.equal(await fs.readFile(path.join(dir, 'clip.mp4'), 'utf8'), 'ORIGINAL')
})

test('folder records v1 -> v2: the combined audio/video kind set by hand is dropped, the rest is kept (R-387)', async () => {
  const old = await v1Folder(),
    before = structuredClone(old)
  const next = upgradeStored(old) as Record<string, any>
  assert.deepEqual(old, before, 'the value read is never changed in place')
  const { kind: _kind, ...details } = before.details
  assert.deepEqual(next, { ...before, schemaVersion: 2, details })
  assert.deepEqual(next.futureNote, { kept: true }, 'unknown fields stay')
  assert.deepEqual(next.details.futureDetail, [1, 2, 3])
  assert.equal(next.projectOverrides['fixture-project'][0].value, 'Private title')
  validateFolder(next)
  assert.deepEqual(upgradeStored(next), next, 'upgrading again changes nothing')
  // With the manual choice gone, what the folder holds decides.
  const row = { record: next } as unknown as FolderRow,
    sample = { images: 0, videos: 0, audio: 0, total: 0 }
  assert.equal(detectFolderKind(row, { ...sample, videos: 2, total: 2 }).kind, 'video')
  assert.equal(detectFolderKind(row, { ...sample, audio: 9, total: 9 }).kind, 'music')
  assert.equal(detectFolderKind(row, { ...sample, total: 4 }).kind, 'general')
  // Every other manual kind, and a record without details, only gets the new version number.
  for (const kind of ['game', 'book', 'general']) {
    const record = { ...before, details: { ...before.details, kind } }
    assert.deepEqual(upgradeStored(record), { ...record, schemaVersion: 2 })
  }
  const { details: _details, ...bare } = before
  assert.deepEqual(upgradeStored(bare), { ...bare, schemaVersion: 2 })
  // A v2 record cannot carry the old kind, and an export holding v1 records imports as v2.
  assert.throws(() => validateFolder({ ...next, details: { ...next.details, kind: 'media' } }))
  assert.deepEqual(upgradeStored(migrateRecord(2, structuredClone(before), 'folder')), next)
})

test('a scan reads a v1 folder record in the new format without rewriting it', async (t) => {
  const root = await sandbox(t, 'upgrade-scan-v1'),
    media = path.join(root, 'media'),
    album = path.join(media, 'Album')
  await fs.mkdir(album, { recursive: true })
  for (const name of ['01.mp3', '02.mp3', 'cover.jpg'])
    await fs.writeFile(path.join(album, name), 'x')
  const before = await placeV1(album)
  const lib = new Library(path.join(root, 'local'), undefined, false)
  await lib.init()
  await lib.create(media, { name: 'P', scanAll: true, depth: { mode: 'through', level: 2 } })
  const row = lib.snapshot().rows.find((r) => r.path === album)!
  assert.equal(row.error, undefined)
  assert.equal(row.record?.schemaVersion, 2)
  assert.deepEqual(detectFolderKind(row, row.contents), { kind: 'music', source: 'content' })
  assert.equal(await fs.readFile(folderFile(album), 'utf8'), before)
  assert.equal(await fs.readFile(path.join(album, '01.mp3'), 'utf8'), 'x')
})

test('a folder record from a newer version is read-only: not recreated, restored over or cleaned', async (t) => {
  const dir = await sandbox(t, 'upgrade-newer'),
    inner = path.join(dir, 'Inner')
  await ensureFolder(dir, false)
  await fs.mkdir(inner)
  await ensureFolder(inner, false)
  const record = await readFolder(dir)
  await saveFolder(dir, record, record.revision)
  const newer = JSON.stringify({ ...(await raw(folderFile(dir))), schemaVersion: 3, future: 1 })
  await fs.writeFile(folderFile(dir), newer)
  await assert.rejects(readFolder(dir), NewerFormatError)
  await assert.rejects(ensureFolder(dir, false), NewerFormatError)
  await assert.rejects(saveFolder(dir, record, record.revision + 1), NewerFormatError)
  await assert.rejects(
    restoreJson(dir, folderFile(dir), validateFolder, () => true),
    NewerFormatError
  )
  const tree = await managedTree(dir)
  assert.deepEqual(tree.files, [], 'nothing of a newer folder or below it is offered for clean-up')
  assert.ok(tree.skipped.some((line) => line.includes('含較新版本的資料')))
  assert.equal(await fs.readFile(folderFile(dir), 'utf8'), newer)
})

test('a scan shows a newer folder as needing an update and leaves it as it is', async (t) => {
  const root = await sandbox(t, 'upgrade-scan'),
    media = path.join(root, 'media')
  await fs.mkdir(path.join(media, 'A', 'Inner'), { recursive: true })
  const lib = new Library(path.join(root, 'local'), undefined, false)
  await lib.init()
  await lib.create(media, { name: 'P', scanAll: true, depth: { mode: 'through', level: 3 } })
  const child = path.join(media, 'A'),
    newer = JSON.stringify({ ...(await raw(folderFile(child))), schemaVersion: 7 })
  await fs.writeFile(folderFile(child), newer)
  await fs.rm(path.join(media, 'A', 'Inner', '.media-viewer'), { recursive: true, force: true })
  await lib.scan()
  const row = lib.snapshot().rows.find((r) => r.path === child)
  assert.ok(row && isNewerFormat(row.error))
  assert.ok(lib.snapshot().problems.some((p) => p.includes('含較新版本的資料，唯讀且不深入')))
  assert.equal(await fs.readFile(folderFile(child), 'utf8'), newer)
  await assert.rejects(fs.stat(path.join(media, 'A', 'Inner', '.media-viewer')), {
    code: 'ENOENT',
  })
})

test('app settings are upgraded once at start-up after the old file is kept; newer settings stop saving', async (t) => {
  const root = await sandbox(t, 'upgrade-workspace')
  const first = new WorkspaceStore(root)
  await first.init()
  await first.update({ action: 'createGroup', name: 'G' }, [])
  const file = path.join(root, 'workspace-ui.json'),
    v1 = await fs.readFile(file, 'utf8')
  pretendNext(t, 'workspace', (v) => ({ ...v, extra: true }))
  const upgraded = new WorkspaceStore(root)
  await upgraded.init()
  assert.equal((await raw(file)).schemaVersion, 2)
  assert.equal((await raw(file)).extra, true)
  const kept = (await fs.readdir(path.join(root, 'workspace-backups'))).filter((n) =>
    n.startsWith('before-upgrade-')
  )
  assert.equal(kept.length, 1)
  assert.equal(await fs.readFile(path.join(root, 'workspace-backups', kept[0]), 'utf8'), v1)

  const newer = JSON.stringify({ ...(await raw(file)), schemaVersion: 9 })
  await fs.writeFile(file, newer)
  const blocked = new WorkspaceStore(root)
  await blocked.init()
  assert.ok(isNewerFormat((await blocked.read([])).error))
  await assert.rejects(blocked.update({ action: 'createGroup', name: 'H' }, []))
  assert.equal(await fs.readFile(file, 'utf8'), newer)
})

test('newer-version errors survive the IPC prefix and are classified for the window', () => {
  const text = errorMessage(
    `Error: Error invoking remote method 'library:request': Error: ${new NewerFormatError('project', 3).message}`
  )
  assert.equal(classifyError(text), 'newer')
  assert.equal(isNewerFormat(text), true)
  assert.equal(classifyError('記錄損壞、版本不支援或不屬於本程式；原檔保留'), 'unknown')
})

test('a project record from a newer version is not replaced by its backup', async (t) => {
  const root = await sandbox(t, 'upgrade-project'),
    media = path.join(root, 'media')
  await fs.mkdir(media, { recursive: true })
  const lib = new Library(path.join(root, 'local'), undefined, false)
  await lib.init()
  await lib.create(media, { name: 'P', scanAll: true, depth: { mode: 'through', level: 1 } })
  const project = lib.snapshot().projects[0].project!
  await lib.saveProject({ ...project, name: 'P2' })
  const file = path.join(media, '.media-viewer', 'projects', `${project.projectId}.json`)
  const newer = JSON.stringify({ ...((await readJson(file)) as object), schemaVersion: 4 })
  await fs.writeFile(file, newer)
  const again = new Library(path.join(root, 'local'), undefined, false)
  await again.init()
  const linked = again.snapshot().projects[0]
  assert.ok(isNewerFormat(linked.error))
  assert.equal(await fs.readFile(file, 'utf8'), newer)
})

// R-409: a project as version 1 wrote it: two book templates (one a folder's own), an older edited game template, an
// empty general template (it showed nothing), kind and folder card layouts, no layout rules yet.
test('projects v1 -> v2: book and content templates become panel layouts, older layout fields become rules (R-409)', async () => {
  const v1 = JSON.parse(
    await fs.readFile(path.resolve('tests/fixtures/project-v1.json'), 'utf8')
  ) as Record<string, unknown>
  const next = upgradeStored(v1) as Project
  validateProject(next)
  assert.equal(next.schemaVersion, 3)
  for (const key of [
    'contentCells',
    'contentCover',
    'bookPresets',
    'bookPresetId',
    'folderBookPresets',
    'kindLayouts',
    'folderLayouts',
  ])
    assert.ok(!(key in next), key + ' is gone')
  assert.deepEqual(
    next.panelPresets!.map((p) => [p.id, p.name, p.cells.map((c) => c.cellId)]),
    [
      ['default', '預設版面', ['book-cover', 'title']],
      ['own', 'Folder A', ['book-cover']],
      ['panel-game', '遊戲 預設', ['game-name']],
    ]
  )
  assert.deepEqual(next.layoutRules, {
    card: {
      types: { game: 'card-game', music: 'card-media', video: 'card-media' },
      folders: { 'folder-b': 'card-main' },
    },
    panel: { folders: { 'folder-a': 'own' }, types: { book: 'default', game: 'panel-game' } },
  })
  // Everything else is kept as it was, unknown fields too, and upgrading again changes nothing.
  assert.deepEqual(next.cells, v1.cells)
  assert.deepEqual(next.layoutPresets, v1.layoutPresets)
  assert.deepEqual((next as unknown as Record<string, unknown>).futureNote, { kept: true })
  assert.deepEqual(upgradeStored(next), next)
})

// R-437: a project as version 2 wrote it: game covers (one with its own fit) on the card, in a card layout and, album and
// video info in a right-panel layout (one too narrow for a cover, one whose cover id is already taken), and a banner image.
test('projects v2 -> v3: game cover, album info and video info become cover images and facts (R-437)', () => {
  const v2 = JSON.parse(
    readFileSync(path.resolve('tests/fixtures/project-v2.json'), 'utf8')
  ) as Record<string, unknown>
  const before = structuredClone(v2)
  const next = upgradeStored(v2) as Project
  assert.deepEqual(v2, before, 'the value read is never changed in place')
  validateProject(next)
  assert.equal(next.schemaVersion, 3)
  const shape = (cells: Cell[]) =>
    cells.map((c) => [c.cellId, c.kind, c.grid.x, c.grid.w, c.imageCover, c.imageFit])
  assert.deepEqual(shape(next.cells).slice(1), [
    ['gc', 'image', 0, 12, true, 'blur'],
    ['gc2', 'image', 0, 6, true, 'cover'],
  ])
  assert.deepEqual(shape(next.layoutPresets!.find((p) => p.id === 'card-game')!.cells), [
    ['gc', 'image', 0, 6, true, 'blur'],
  ])
  const album = next.panelPresets!.find((p) => p.id === 'album')!.cells
  assert.deepEqual(shape(album), [
    ['album-info-cover-2', 'image', 0, 4, true, undefined],
    ['album-info', 'album-facts', 4, 8, undefined, undefined],
    ['album-info-cover', 'name', 0, 12, undefined, undefined],
    ['narrow', 'video-facts', 0, 1, undefined, undefined],
    ['vi-cover', 'image', 0, 4, true, undefined],
    ['vi', 'video-facts', 4, 8, undefined, undefined],
    ['hero', 'image', 0, 12, undefined, undefined],
  ])
  // R-435's banner choice is untouched, and the rest of the project is kept as it was.
  assert.equal(album.at(-1)!.imageRole, 'hero')
  assert.deepEqual(next.panelPresets!.slice(0, -1), (v2.panelPresets as unknown[]).slice(0, -1))
  assert.deepEqual(upgradeStored(next), next, 'upgrading again changes nothing')
  // A v1 project goes the whole way in one read.
  const whole = upgradeStored(
    JSON.parse(readFileSync(path.resolve('tests/fixtures/project-v1.json'), 'utf8'))
  ) as Project
  assert.equal(whole.schemaVersion, 3)
  validateProject(whole)
})

test('a v2 project is upgraded on read and written as v3 only on save; the v2 file stays as the backup (R-437)', async (t) => {
  const root = await sandbox(t, 'upgrade-project-v2'),
    media = path.join(root, 'media')
  await fs.mkdir(media, { recursive: true })
  await fs.writeFile(path.join(media, 'clip.mp4'), 'ORIGINAL')
  const lib = new Library(path.join(root, 'local'), undefined, false)
  await lib.init()
  await lib.create(media, { name: 'P', scanAll: true, depth: { mode: 'through', level: 1 } })
  const created = lib.snapshot().projects[0].project!
  await lib.saveProject({ ...created, name: 'P2' })
  const file = path.join(media, '.media-viewer', 'projects', `${created.projectId}.json`)
  const current = (await readJson(file)) as Record<string, unknown>
  const before = JSON.stringify({
    ...JSON.parse(await fs.readFile(path.resolve('tests/fixtures/project-v2.json'), 'utf8')),
    projectId: current.projectId,
    rootFolderId: current.rootFolderId,
    revision: current.revision,
  })
  await fs.writeFile(file, before)
  const again = new Library(path.join(root, 'local'), undefined, false)
  await again.init()
  const project = again.snapshot().projects[0].project!
  assert.equal(project.schemaVersion, 3)
  assert.equal(
    project.cells.some((c) => (c.kind as string) === 'game-cover'),
    false
  )
  assert.equal(await fs.readFile(file, 'utf8'), before, 'reading never writes')
  await again.saveProject({ ...project, name: 'Saved' })
  const saved = (await readJson(file)) as { schemaVersion: number; cells: { kind: string }[] }
  assert.equal(saved.schemaVersion, 3)
  assert.equal(
    saved.cells.some((c) => c.kind === 'game-cover'),
    false
  )
  assert.equal(await fs.readFile(file + '.bak', 'utf8'), before)
  assert.equal(await fs.readFile(path.join(media, 'clip.mp4'), 'utf8'), 'ORIGINAL')
})

test('an older project record is upgraded on read and written in the new format only on save (R-409)', async (t) => {
  const root = await sandbox(t, 'upgrade-project-v1'),
    media = path.join(root, 'media')
  await fs.mkdir(media, { recursive: true })
  await fs.writeFile(path.join(media, 'clip.mp4'), 'ORIGINAL')
  const lib = new Library(path.join(root, 'local'), undefined, false)
  await lib.init()
  await lib.create(media, { name: 'P', scanAll: true, depth: { mode: 'through', level: 1 } })
  const created = lib.snapshot().projects[0].project!
  await lib.saveProject({ ...created, name: 'P2' })
  const file = path.join(media, '.media-viewer', 'projects', `${created.projectId}.json`)
  const fixture = JSON.parse(
    await fs.readFile(path.resolve('tests/fixtures/project-v1.json'), 'utf8')
  ) as Record<string, unknown>
  const current = (await readJson(file)) as Record<string, unknown>
  const before = JSON.stringify({
    ...fixture,
    projectId: current.projectId,
    rootFolderId: current.rootFolderId,
    revision: current.revision,
  })
  await fs.writeFile(file, before)
  const again = new Library(path.join(root, 'local'), undefined, false)
  await again.init()
  const project = again.snapshot().projects[0].project!
  assert.equal(project.schemaVersion, 3)
  assert.equal(project.panelPresets?.length, 3)
  assert.equal(await fs.readFile(file, 'utf8'), before, 'reading never writes')
  await again.saveProject({ ...project, name: 'Saved' })
  const saved = (await readJson(file)) as Record<string, unknown>
  assert.equal(saved.schemaVersion, 3)
  assert.equal('bookPresets' in saved, false)
  assert.equal(await fs.readFile(file + '.bak', 'utf8'), before, 'the v1 file stays as the backup')
  assert.equal(await fs.readFile(path.join(media, 'clip.mp4'), 'utf8'), 'ORIGINAL')
})

test('projects v1 -> v2: an edited book template from before R-362 gets the cover component; rules already set win', () => {
  const style = { textColor: '#e4e6e8', backgroundColor: 'transparent' }
  const cell = (cellId: string, grid: Cell['grid']) =>
    ({ cellId, kind: 'field-text', attributeId: 'title', grid, style }) as Cell
  const base = {
    ...modelProject(),
    schemaVersion: 1,
    panelPresets: undefined,
    contentCells: {
      book: [
        cell('a', { x: 0, y: 0, w: 3, h: 1 }),
        cell('b', { x: 3, y: 0, w: 3, h: 1 }),
        cell('c', { x: 0, y: 2, w: 12, h: 2 }),
      ],
      media: [cell('m', { x: 0, y: 0, w: 12, h: 1 })],
    },
    layoutRules: { panel: { types: { music: 'kept' } } },
    folderLayouts: { ignored: 'x' },
  }
  const next = upgradeStored(base) as Project
  const book = next.panelPresets!.find((p) => p.id === 'panel-book')!
  assert.equal(book.name, '書籍 預設')
  assert.deepEqual(
    book.cells.map((c) => [c.cellId, c.grid.x, c.grid.y, c.grid.w, c.grid.h]),
    [
      ['book-cover', 0, 0, 4, 4],
      ['a', 4, 0, 2, 1],
      ['b', 6, 0, 2, 1],
      ['c', 4, 2, 8, 2],
    ]
  )
  assert.equal(book.cells[0].imageCover, true)
  // Existing rules are kept (the older card fields were already replaced by them) and not overwritten.
  assert.deepEqual(next.layoutRules, {
    panel: { types: { music: 'kept', book: 'panel-book', video: 'panel-media' } },
  })
  assert.equal(next.panelPresets!.find((p) => p.id === 'panel-media')!.name, '音樂／影片 預設')
  // Grids outside the canvas (left to validation) and a component already named book-cover get no cover.
  for (const odd of [
    cell('a', { x: 0, y: -1e308, w: 1, h: 1.7e308 }),
    { ...cell('book-cover', { x: 0, y: 0, w: 12, h: 1 }), kind: 'name' },
  ]) {
    const kept = upgradeStored({ ...base, contentCells: { book: [odd] } }) as Project
    assert.deepEqual(kept.panelPresets![0].cells, [odd])
  }
  // A book rule naming a template that is gone takes the project's default again.
  const stale = upgradeStored({
    ...base,
    contentCells: undefined,
    bookPresets: [{ id: 'bk', name: 'B', cells: [] }],
    bookPresetId: 'bk',
    layoutRules: { panel: { types: { book: 'gone' } } },
  }) as Project
  assert.deepEqual(stale.layoutRules, { panel: { types: { book: 'bk' } } })
  // A cover template already holding its cover (contentCover) is kept as it is.
  const covered = upgradeStored({ ...base, contentCover: true }) as Project
  assert.deepEqual(
    covered.panelPresets![0].cells.map((c) => c.cellId),
    ['a', 'b', 'c']
  )
})
