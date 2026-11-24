import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Library } from '../electron/library'
import { Explorer, type DesktopOperations } from '../electron/explorer'
import { readFolder, saveFolder } from '../electron/files'
import { WorkspaceStore } from '../electron/workspace'
import { bundledSuggestions, engineSave, engineSaveFolder, storeUrl } from '../electron/game-extras'
import { RPYC_LIMIT } from '../electron/renpy-save'
import zlib from 'node:zlib'
import { validateDetails } from '../shared/model'

const base = path.resolve('.test-output')
async function setup(
  t: { after: (fn: () => Promise<void>) => void },
  files: Record<string, string>
) {
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'game-extras-')),
    media = path.join(root, 'Game')
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(media, name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, body)
  }
  const library = new Library(path.join(root, 'local'), undefined, false)
  await library.init()
  const calls = {
    launch: [] as { file: string; args: string[]; timed: boolean }[],
    open: [] as string[],
    external: [] as string[],
    played: [] as { folderId: string; seconds: number }[],
  }
  let picks: (string | undefined)[] = [],
    steam = true,
    leproc: string | undefined
  const desktop: DesktopOperations = {
    choose: async () => picks.shift(),
    open: async (file) => {
      calls.open.push(file)
    },
    launch: async (file, args, onExit) => {
      calls.launch.push({ file, args, timed: !!onExit })
      onExit?.(1000, 3_601_000)
    },
    external: async (url) => {
      calls.external.push(url)
    },
    protocolReady: () => steam,
    localeEmulator: () => leproc,
    setLocaleEmulator: async (file) => {
      leproc = file
    },
    played: (folderId, started, ended) =>
      calls.played.push({ folderId, seconds: Math.round((ended - started) / 1000) }),
    thumbnail: async () => Buffer.alloc(0),
  }
  const explorer = new Explorer(library, library.userData, desktop)
  t.after(async () => {
    explorer.close()
    assert.ok((await fs.realpath(root)).startsWith(base + path.sep))
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  await library.create(media, { name: 'Games', depth: { mode: 'through', level: 1 } })
  const row = () => library.snapshot().rows.find((r) => r.path === media)!
  return {
    root,
    media,
    library,
    explorer,
    calls,
    row,
    pick: (...next: (string | undefined)[]) => (picks = next),
    setSteam: (value: boolean) => (steam = value),
  }
}

test('bundled tools and manuals are suggested, installers are not, and adding one binds a button (R-306)', async (t) => {
  const { explorer, row, calls, library, media } = await setup(t, {
    'Game.exe': 'x',
    'config.exe': 'x',
    '環境設定.exe': 'x',
    'unins000.exe': 'x',
    'vcredist_x64.exe': 'x',
    'manual.pdf': 'x',
    'readme.txt': 'x',
    'notes.txt': 'x',
  })
  assert.deepEqual((await bundledSuggestions(media)).map((s) => s.name).sort(), [
    'config.exe',
    'manual.pdf',
    'readme.txt',
    '環境設定.exe',
  ])
  const extras = (await explorer.request({ action: 'gameExtras', rowId: row().rowId })).extras!
  assert.equal(extras.suggestions.length, 4)
  await explorer.request({
    action: 'addSuggestion',
    rowId: row().rowId,
    revision: row().record!.revision,
    name: 'manual.pdf',
  })
  await explorer.request({
    action: 'addSuggestion',
    rowId: row().rowId,
    revision: row().record!.revision,
    name: 'config.exe',
  })
  await assert.rejects(
    explorer.request({
      action: 'addSuggestion',
      rowId: row().rowId,
      revision: row().record!.revision,
      name: 'unins000.exe',
    }),
    /建議清單/
  )
  const project = library.snapshot().projects[0].project!
  const manual = project.actionTemplates!.find((a) => a.label === '說明書')!,
    config = project.actionTemplates!.find((a) => a.label === '設定程式')!
  assert.equal(manual.kind, 'file')
  assert.equal(config.kind, 'exe')
  const targets = (await readFolder(media)).details!.targets!
  assert.deepEqual(targets[manual.id], {
    kind: 'file',
    path: 'manual.pdf',
    relative: true,
    args: [],
  })
  // Bound files leave the suggestion list; running the manual opens it, never launches it.
  const after = (await explorer.request({ action: 'gameExtras', rowId: row().rowId })).extras!
  assert.deepEqual(after.suggestions.map((s) => s.name).sort(), ['readme.txt', '環境設定.exe'])
  // A document action never opens a program or script: that would run it.
  assert.throws(() =>
    validateDetails({
      schemaVersion: 1,
      targets: { x: { kind: 'file', path: 'Game.exe', relative: true, args: [] } },
    })
  )
  for (const target of [
    { kind: 'file', path: 'help.chm', relative: true, args: [] },
    { kind: 'file', path: 'run.bat', relative: true, args: [] },
  ])
    assert.throws(() => validateDetails({ schemaVersion: 1, targets: { x: target } }))
  // A save folder outside the game must be a local drive path, never a network share.
  assert.throws(() =>
    validateDetails({ schemaVersion: 1, saveFolder: { path: '\\\\host\\share', relative: false } })
  )
  validateDetails({ schemaVersion: 1, saveFolder: { path: 'C:\\Saves', relative: false } })
  await explorer.request({ action: 'runTarget', rowId: row().rowId, templateId: manual.id })
  assert.deepEqual(calls.open, [path.join(media, 'manual.pdf')])
  assert.equal(calls.launch.length, 0)
})

test('Steam launch, store page and save folder come from the game and its record (R-305, R-307, R-310)', async (t) => {
  const { explorer, row, calls, media, setSteam, pick } = await setup(t, {
    'Game.exe': 'x',
    'steam_appid.txt': ' 620 \r\n',
    'www/save/file1.rpgsave': 'SAVE',
    'www/data/System.json': '{}',
    'www/js/rmmz_core.js': '//',
  })
  let extras = (await explorer.request({ action: 'gameExtras', rowId: row().rowId })).extras!
  assert.equal(extras.steamAppId, '620')
  assert.equal(extras.save, 'engine')
  assert.equal(extras.storeUrl, undefined)
  await explorer.request({ action: 'runExtra', rowId: row().rowId, extra: 'steam' })
  assert.deepEqual(calls.external, ['steam://run/620'])
  setSteam(false)
  await assert.rejects(
    explorer.request({ action: 'runExtra', rowId: row().rowId, extra: 'steam' }),
    /沒有安裝 Steam/
  )
  await explorer.request({ action: 'runExtra', rowId: row().rowId, extra: 'save' })
  assert.deepEqual(calls.open, [path.join(media, 'www', 'save')])
  // A store address saved by an import becomes the store button; plain http and other schemes are ignored.
  const record = await readFolder(media)
  record.attributes.push(
    {
      attributeId: 'vndb-source_url',
      key: 'SOURCE_URL',
      type: 'string',
      value: 'http://vndb.org/v17',
      source: 'vndb',
    },
    {
      attributeId: 'steam-store_url',
      key: 'STORE_URL',
      type: 'string',
      value: 'https://store.steampowered.com/app/620/',
      source: 'steam',
    }
  )
  await saveFolder(media, record, record.revision)
  await explorer.request({ action: 'visit', rowId: row().rowId })
  assert.equal(storeUrl(await readFolder(media)), 'https://store.steampowered.com/app/620/')
  // R-316: a catalogue page (VNDB) is not a store, so alone it gives no store button.
  assert.equal(
    storeUrl({ ...(await readFolder(media)), attributes: record.attributes.slice(0, 1) }),
    undefined
  )
  assert.equal(
    (await explorer.request({ action: 'gameExtras', rowId: row().rowId }))?.extras?.storeSite,
    'Steam'
  )
  await explorer.request({ action: 'runExtra', rowId: row().rowId, extra: 'store' })
  assert.equal(calls.external.at(-1), 'https://store.steampowered.com/app/620/')
  // A folder the user picks wins over the engine's guess and can be cleared again.
  const picked = path.join(media, 'www')
  pick(picked)
  await explorer.request({
    action: 'chooseSaveFolder',
    rowId: row().rowId,
    revision: (await readFolder(media)).revision,
  })
  extras = (await explorer.request({ action: 'gameExtras', rowId: row().rowId })).extras!
  assert.equal(extras.save, 'user')
  assert.deepEqual((await readFolder(media)).details!.saveFolder, { path: 'www', relative: true })
  await explorer.request({
    action: 'chooseSaveFolder',
    rowId: row().rowId,
    revision: (await readFolder(media)).revision,
    clear: true,
  })
  assert.equal((await readFolder(media)).details!.saveFolder, undefined)
})

test('Unity and Ren’Py save folders are worked out only from plain names and only when they exist', async (t) => {
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'game-saves-'))
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const home = path.join(root, 'home'),
    unity = path.join(root, 'Unity'),
    renpy = path.join(root, 'RenPy')
  await fs.mkdir(path.join(unity, 'Game_Data'), { recursive: true })
  await fs.writeFile(path.join(unity, 'Game_Data', 'app.info'), 'Studio\nTitle')
  assert.equal(await engineSaveFolder(unity, ['Unity'], home), undefined, 'not created yet')
  await fs.mkdir(path.join(home, 'AppData', 'LocalLow', 'Studio', 'Title'), { recursive: true })
  assert.equal(
    await engineSaveFolder(unity, ['Unity'], home),
    path.join(home, 'AppData', 'LocalLow', 'Studio', 'Title')
  )
  await fs.writeFile(path.join(unity, 'Game_Data', 'app.info'), '..\\..\\Windows\nTitle')
  assert.equal(await engineSaveFolder(unity, ['Unity'], home), undefined, 'no path parts')
  await fs.mkdir(path.join(renpy, 'game'), { recursive: true })
  await fs.writeFile(
    path.join(renpy, 'game', 'options.rpy'),
    'define config.save_directory = "Title-1234"\n'
  )
  await fs.mkdir(path.join(home, 'AppData', 'Roaming', 'RenPy', 'Title-1234'), { recursive: true })
  assert.equal(
    await engineSaveFolder(renpy, ['Ren’Py'], home),
    path.join(home, 'AppData', 'Roaming', 'RenPy', 'Title-1234')
  )
})

test('Locale Emulator launches go through LEProc.exe and direct launches are timed (R-308, R-309)', async (t) => {
  const { explorer, row, calls, media, pick, root } = await setup(t, { 'Game.exe': 'x' })
  pick(path.join(media, 'Game.exe'))
  await explorer.request({
    action: 'bindTarget',
    rowId: row().rowId,
    revision: row().record!.revision,
    templateId: 'default-launch-game',
    args: ['-w'],
  })
  await explorer.request({
    action: 'runTarget',
    rowId: row().rowId,
    templateId: 'default-launch-game',
  })
  assert.deepEqual(calls.launch.at(-1), {
    file: path.join(media, 'Game.exe'),
    args: ['-w'],
    timed: true,
  })
  assert.deepEqual(calls.played, [{ folderId: row().record!.folderId, seconds: 3600 }])
  await explorer.request({
    action: 'targetLocale',
    rowId: row().rowId,
    revision: (await readFolder(media)).revision,
    templateId: 'default-launch-game',
    value: true,
  })
  await assert.rejects(
    explorer.request({
      action: 'runTarget',
      rowId: row().rowId,
      templateId: 'default-launch-game',
    }),
    /Locale Emulator/
  )
  const leproc = path.join(root, 'LE', 'LEProc.exe'),
    other = path.join(root, 'LE', 'Other.exe')
  await fs.mkdir(path.dirname(leproc), { recursive: true })
  await fs.writeFile(leproc, 'x')
  await fs.writeFile(other, 'x')
  pick(other)
  await assert.rejects(explorer.request({ action: 'chooseLocaleEmulator' }), /LEProc/)
  pick(leproc)
  await explorer.request({ action: 'chooseLocaleEmulator' })
  await explorer.request({
    action: 'runTarget',
    rowId: row().rowId,
    templateId: 'default-launch-game',
  })
  assert.deepEqual(calls.launch.at(-1), {
    file: await fs.realpath(leproc),
    args: ['-run', path.join(media, 'Game.exe'), '-w'],
    timed: false,
  })
  // R-319: the profiles made in Locale Emulator are listed from LEConfig.xml, and a chosen one runs with -runas.
  const guid = 'ec7ff5cc-a45c-4bbb-9e31-9a2d2a9d7f11'
  await fs.writeFile(
    path.join(root, 'LE', 'LEConfig.xml'),
    `<?xml version="1.0"?><LEConfig><Profiles><Profile Name="簡体中文 &amp; GBK" Guid="${guid.toUpperCase()}" MainMenu="false"><Location>zh-CN</Location></Profile><Profile Name="Bad" Guid="not-a-guid"/></Profiles></LEConfig>`
  )
  const listed = await explorer.request({ action: 'gameExtras', rowId: row().rowId })
  assert.deepEqual(listed.extras?.localeProfiles, [{ guid, name: '簡体中文 & GBK' }])
  const revision = (await readFolder(media)).revision
  await explorer.request({
    action: 'targetLocale',
    rowId: row().rowId,
    revision,
    templateId: 'default-launch-game',
    value: guid,
  })
  await explorer.request({
    action: 'runTarget',
    rowId: row().rowId,
    templateId: 'default-launch-game',
  })
  assert.deepEqual(calls.launch.at(-1)?.args, ['-runas', guid, path.join(media, 'Game.exe'), '-w'])
  // Only a GUID or true is ever stored, so nothing else can reach LEProc's arguments.
  const record = await readFolder(media)
  record.details!.targets!['default-launch-game'].localeEmulator = '--evil' as unknown as true
  assert.throws(() => validateDetails(record.details), /不合法/)
  // An older record with false (never written by M:orph, but valid before) still passes.
  record.details!.targets!['default-launch-game'].localeEmulator = false as unknown as true
  validateDetails(record.details)
})

test('play time is stored locally per folder and validated (R-308)', async (t) => {
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'game-playtime-'))
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }))
  const store = new WorkspaceStore(root)
  await store.init()
  const id = '12345678-1234-1234-1234-123456789abc'
  await store.recordPlay(id, 0, 500)
  await store.recordPlay(id, 0, 90_000)
  await store.recordPlay(id, 100_000, 160_000)
  const prefs = (await store.read([])).prefs
  assert.deepEqual(
    { total: prefs.playtime![id].total, count: prefs.playtime![id].count },
    { total: 150, count: 2 },
    'a session under a second is not counted'
  )
  assert.equal(prefs.playtime![id].last, new Date(160_000).toISOString())
  await store.recordPlay('../evil', 0, 10_000)
  assert.deepEqual(Object.keys((await store.read([])).prefs.playtime!), [id])
})

// R-384: engines that had a detection but no save rule, and "no saves yet" instead of "unknown".
test('Godot, RPG Maker 2000/2003 and packaged NW.js or Electron apps get save folders (R-384)', async (t) => {
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'game-saves-engines-'))
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const home = path.join(root, 'home'),
    put = async (file: string, text = 'x') => {
      await fs.mkdir(path.dirname(file), { recursive: true })
      await fs.writeFile(file, text)
    }
  // Godot: the project name, or a custom user directory, from project.godot.
  const godot = path.join(root, 'Godot')
  await put(path.join(godot, 'project.godot'), '[application]\n\nconfig/name="My Game"\n')
  assert.deepEqual(await engineSave(godot, ['Godot'], home), { state: 'pending' })
  const godotSaves = path.join(home, 'AppData', 'Roaming', 'Godot', 'app_userdata', 'My Game')
  await fs.mkdir(godotSaves, { recursive: true })
  assert.deepEqual(await engineSave(godot, ['Godot'], home), { state: 'found', folder: godotSaves })
  await put(
    path.join(godot, 'project.godot'),
    '[application]\nconfig/name="My Game"\nconfig/use_custom_user_dir=true\nconfig/custom_user_dir_name="Custom"\n'
  )
  assert.deepEqual(await engineSave(godot, ['Godot'], home), { state: 'pending' })
  await put(path.join(godot, 'project.godot'), 'config/name="..\\Evil"\n')
  assert.deepEqual(await engineSave(godot, ['Godot'], home), { state: 'unknown' })
  // An exported Godot game keeps its settings inside the .pck, which is not read.
  const exported = path.join(root, 'GodotExported')
  await put(path.join(exported, 'Game.pck'))
  assert.deepEqual(await engineSave(exported, ['Godot'], home), { state: 'unknown' })
  // RPG Maker 2000/2003: Save01.lsd next to the game, the game folder itself.
  const rm2k = path.join(root, 'RM2k')
  await put(path.join(rm2k, 'RPG_RT.ldb'))
  assert.deepEqual(await engineSave(rm2k, ['RPG Maker 2000/2003'], home), { state: 'pending' })
  await put(path.join(rm2k, 'Save01.lsd'))
  assert.deepEqual(await engineSave(rm2k, ['RPG Maker 2000/2003'], home), {
    state: 'found',
    folder: rm2k,
  })
  // NW.js: AppData\Local\<name>; Electron: AppData\Roaming\<productName or name>. Never a name with path parts.
  const nw = path.join(root, 'Nw')
  await put(path.join(nw, 'nw.pak'))
  await put(path.join(nw, 'package.json'), JSON.stringify({ name: 'tyrano-game' }))
  assert.deepEqual(await engineSave(nw, ['TyranoScript'], home), { state: 'pending' })
  const nwFolder = path.join(home, 'AppData', 'Local', 'tyrano-game')
  await fs.mkdir(nwFolder, { recursive: true })
  assert.deepEqual(await engineSave(nw, ['TyranoScript'], home), {
    state: 'found',
    folder: nwFolder,
  })
  assert.deepEqual(
    await engineSave(nw, ['Unity'], home),
    { state: 'unknown' },
    'only for Tyrano or unknown apps'
  )
  await put(path.join(nw, 'package.json'), JSON.stringify({ name: '../x' }))
  assert.deepEqual(await engineSave(nw, [], home), { state: 'unknown' })
  const electron = path.join(root, 'Electron')
  await put(
    path.join(electron, 'resources', 'app', 'package.json'),
    JSON.stringify({ name: 'plain', productName: 'Pretty Name' })
  )
  const electronFolder = path.join(home, 'AppData', 'Roaming', 'Pretty Name')
  await fs.mkdir(electronFolder, { recursive: true })
  assert.deepEqual(await engineSave(electron, ['TyranoScript'], home), {
    state: 'found',
    folder: electronFolder,
  })
})

test('a known place that does not exist yet is "no saves yet", not "unknown" (R-384)', async (t) => {
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'game-saves-pending-'))
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const home = path.join(root, 'home'),
    unity = path.join(root, 'Unity')
  await fs.mkdir(path.join(unity, 'Game_Data'), { recursive: true })
  await fs.writeFile(path.join(unity, 'Game_Data', 'app.info'), 'Studio\nTitle')
  assert.deepEqual(await engineSave(unity, ['Unity'], home), { state: 'pending' })
  await fs.writeFile(path.join(unity, 'Game_Data', 'app.info'), '..\nTitle')
  assert.deepEqual(await engineSave(unity, ['Unity'], home), { state: 'unknown' })
  assert.deepEqual(await engineSave(unity, ['RPG Maker MZ'], home), { state: 'pending' })
  assert.deepEqual(await engineSave(unity, ['WOLF RPG'], home), { state: 'pending' })
  assert.deepEqual(await engineSave(unity, ['Cocos'], home), { state: 'unknown' })
  // Nothing was created while looking.
  await assert.rejects(fs.stat(home))
})

// A script as Ren'Py stores it: "RENPY RPC2", a slot table, and the zlib-compressed pickle in slot 1.
const rpyc = (source: string) => {
  const body = zlib.deflateSync(
      Buffer.from('\x80\x02csome.Node\nU\x16config.save_directory' + source, 'latin1')
    ),
    head = Buffer.alloc(10 + 12 * 2)
  head.write('RENPY RPC2', 0, 'latin1')
  head.writeUInt32LE(1, 10)
  head.writeUInt32LE(head.length, 14)
  head.writeUInt32LE(body.length, 18)
  return Buffer.concat([head, body])
}
// An RPA-3.0 archive with one file, indexed by a protocol 2 pickle { name: [(offset, length, '')] }.
const rpa = (name: string, content: Buffer, key = 0x42) => {
  const header = Buffer.alloc(34, ' ')
  const int = (value: number) => {
    const b = Buffer.alloc(5)
    b[0] = 0x4a
    b.writeInt32LE(value, 1)
    return b
  }
  const text = (value: string) => {
    const b = Buffer.alloc(5 + Buffer.byteLength(value))
    b[0] = 0x58
    b.writeUInt32LE(Buffer.byteLength(value), 1)
    b.write(value, 5)
    return b
  }
  const index = zlib.deflateSync(
    Buffer.concat([
      Buffer.from([0x80, 2, 0x7d, 0x28]),
      text(name),
      Buffer.from([0x5d, 0x28]),
      int(34 ^ key),
      int(content.length ^ key),
      text(''),
      Buffer.from([0x87, 0x65, 0x75, 0x2e]),
    ])
  )
  const offset = 34 + content.length
  header.write(
    `RPA-3.0 ${offset.toString(16).padStart(16, '0')} ${key.toString(16).padStart(8, '0')}\n`,
    0,
    'latin1'
  )
  return Buffer.concat([header, content, index])
}

test('Ren’Py save names come from options.rpyc, loose or inside an .rpa, with size limits (R-384)', async (t) => {
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'game-saves-renpy-'))
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  const home = path.join(root, 'home'),
    loose = path.join(root, 'Loose'),
    packed = path.join(root, 'Packed'),
    saves = (name: string) => path.join(home, 'AppData', 'Roaming', 'RenPy', name)
  await fs.mkdir(path.join(loose, 'game'), { recursive: true })
  await fs.writeFile(path.join(loose, 'game', 'options.rpyc'), rpyc('"Loose-111"'))
  assert.deepEqual(await engineSave(loose, ['Ren’Py'], home), { state: 'pending' })
  await fs.mkdir(saves('Loose-111'), { recursive: true })
  assert.deepEqual(await engineSave(loose, ['Ren’Py'], home), {
    state: 'found',
    folder: saves('Loose-111'),
  })
  await fs.mkdir(path.join(packed, 'game'), { recursive: true })
  await fs.writeFile(
    path.join(packed, 'game', 'scripts.rpa'),
    rpa('game/options.rpyc', rpyc("'Packed-222'"))
  )
  assert.deepEqual(await engineSave(packed, ['Ren’Py'], home), { state: 'pending' })
  await fs.mkdir(saves('Packed-222'), { recursive: true })
  assert.deepEqual(await engineSave(packed, ['Ren’Py'], home), {
    state: 'found',
    folder: saves('Packed-222'),
  })
  // A name with path parts, damaged data or an oversized script is ignored.
  await fs.writeFile(path.join(loose, 'game', 'options.rpyc'), rpyc('"..\\Evil"'))
  assert.deepEqual(await engineSave(loose, ['Ren’Py'], home), { state: 'unknown' })
  await fs.writeFile(path.join(loose, 'game', 'options.rpyc'), Buffer.from('RENPY RPC2 broken'))
  assert.deepEqual(await engineSave(loose, ['Ren’Py'], home), { state: 'unknown' })
  await fs.writeFile(path.join(loose, 'game', 'options.rpyc'), Buffer.alloc(RPYC_LIMIT + 1))
  assert.deepEqual(await engineSave(loose, ['Ren’Py'], home), { state: 'unknown' })
  await fs.writeFile(
    path.join(packed, 'game', 'scripts.rpa'),
    Buffer.from('RPA-3.0 0000000000000099 00000042\n')
  )
  assert.deepEqual(await engineSave(packed, ['Ren’Py'], home), { state: 'unknown' })
})

test('R-409: the extra buttons of several games are checked in one request, read-only, with a reason when not usable', async (t) => {
  const { explorer, row, media, setSteam, library } = await setup(t, {
    'Game.exe': 'x',
    'steam_appid.txt': '620',
    'www/save/file1.rpgsave': 'SAVE',
    'www/data/System.json': '{}',
    'www/js/rmmz_core.js': '//',
  })
  const before = await readFolder(media)
  const ask = async (rowIds: string[]) =>
    (await explorer.request({ action: 'gameAvailability', rowIds })).availability!
  let answer = await ask([row().rowId, row().rowId, 'missing-row'])
  assert.deepEqual(Object.keys(answer), [row().rowId])
  assert.deepEqual(answer[row().rowId], {
    steam: { ok: true },
    store: { ok: false, reason: '沒有商店網址' },
    save: { ok: true },
  })
  setSteam(false)
  answer = await ask([row().rowId])
  assert.deepEqual(answer[row().rowId].steam, { ok: false, reason: '這台電腦沒有安裝 Steam' })
  // Asking writes nothing, and a folder that is not a game is left out.
  assert.deepEqual(await readFolder(media), before)
  const other = library.snapshot().rows.find((r) => r.path !== media)
  if (other) assert.deepEqual(Object.keys(await ask([other.rowId])), [])
})
