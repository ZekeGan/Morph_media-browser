import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

import { gameActionTemplates, launchGap } from '../shared/explorer'

import { type DesktopOperations, Explorer } from '../electron/explorer'
import { folderFile, readFolder } from '../electron/files'
import { Library } from '../electron/library'

test('implicit launch template does not overwrite explicit templates', () => {
  assert.equal(gameActionTemplates({})[0].id, 'default-launch-game')
  assert.deepEqual(gameActionTemplates({ actionTemplates: [] }), [])
})

test('R-397: the launch hint follows the main launch action, not the default id', () => {
  const exe = { id: 'run', label: '開始', kind: 'exe' as const, color: '#000' }
  const open = { id: 'dir', label: '資料夾', kind: 'folder' as const, color: '#000' }
  // Default project: the default action has no target yet.
  assert.equal(launchGap({}, undefined), 'target')
  assert.equal(launchGap({}, { 'default-launch-game': { kind: 'exe' } }), undefined)
  // The default action was replaced: the hint still shows for the replacement.
  assert.equal(launchGap({ actionTemplates: [exe, open] }, undefined), 'target')
  assert.equal(launchGap({ actionTemplates: [exe, open] }, { dir: { kind: 'folder' } }), 'target')
  assert.equal(launchGap({ actionTemplates: [exe] }, { run: { kind: 'exe' } }), undefined)
  // No launch action at all (empty list, or only folder/web actions).
  assert.equal(launchGap({ actionTemplates: [] }, undefined), 'action')
  assert.equal(launchGap({ actionTemplates: [open] }, undefined), 'action')
})

test('game targets require explicit selection, preserve arguments and leave original files unchanged', async (t) => {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'game-actions-'))
  const media = path.join(root, 'game')
  await fs.mkdir(media)
  const original = {
    'Game.exe': 'controlled fake EXE',
    'notes.txt': 'ORIGINAL FILE',
    'unsafe.cmd': 'ORIGINAL SCRIPT',
  }
  for (const [name, value] of Object.entries(original)) {
    await fs.writeFile(path.join(media, name), value)
  }
  const library = new Library(path.join(root, 'local'), undefined, false)
  await library.init()
  const calls: { file: string; args: string[] }[] = []
  const pickers: { kind: string; initialPath?: string }[] = []
  const urls: string[] = []
  let picks: (string | undefined)[] = []
  const desktop: DesktopOperations = {
    choose: async (kind, initialPath) => {
      pickers.push({ kind, initialPath })
      return picks.shift()
    },
    open: async (file) => {
      calls.push({ file, args: [] })
    },
    launch: async (file, args) => {
      calls.push({ file, args })
    },
    external: async (url) => {
      urls.push(url)
    },
    thumbnail: async () => Buffer.alloc(0),
  }
  const explorer = new Explorer(library, library.userData, desktop)
  t.after(async () => {
    explorer.close()
    const target = await fs.realpath(root)
    assert.ok(target.startsWith(base + path.sep))
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  await library.create(media, {
    name: 'Games',
    depth: { mode: 'through', level: 1 },
  })
  const row = () => library.snapshot().rows[0]
  const before = await fs.readFile(folderFile(media), 'utf8')
  await assert.rejects(
    explorer.request({
      action: 'runTarget',
      rowId: row().rowId,
      templateId: 'default-launch-game',
    }),
    /還沒設定/
  )
  assert.equal(
    (
      await explorer.request({
        action: 'bindTarget',
        rowId: row().rowId,
        revision: row().record!.revision,
        templateId: 'default-launch-game',
        args: [],
      })
    ).cancelled,
    true
  )
  assert.equal(await fs.readFile(folderFile(media), 'utf8'), before)
  assert.equal(pickers[0].initialPath, media)
  const args = ['value with spaces', '"quoted"', '$(literal)', '; keep literal']
  picks = [path.join(media, 'Game.exe')]
  await explorer.request({
    action: 'bindTarget',
    rowId: row().rowId,
    revision: row().record!.revision,
    templateId: 'default-launch-game',
    args,
  })
  assert.equal(calls.length, 0)
  assert.equal(library.snapshot().projects[0].project!.actionTemplates, undefined)
  await explorer.request({
    action: 'runTarget',
    rowId: row().rowId,
    templateId: 'default-launch-game',
  })
  assert.deepEqual(calls[0], { file: path.join(media, 'Game.exe'), args })
  await fs.rename(path.join(media, 'Game.exe'), path.join(media, 'Moved.exe'))
  await assert.rejects(
    explorer.request({
      action: 'runTarget',
      rowId: row().rowId,
      templateId: 'default-launch-game',
    }),
    /ENOENT/
  )
  assert.equal(calls.length, 1)
  await fs.rename(path.join(media, 'Moved.exe'), path.join(media, 'Game.exe'))
  let project = library.snapshot().projects[0].project!
  await library.saveProject({
    ...project,
    actionTemplates: [
      { id: 'file', label: 'Open notes', kind: 'file-app', color: '#123456' },
      { id: 'web', label: 'Website', kind: 'url', color: '#123456' },
    ],
  })
  const bound = await fs.readFile(folderFile(media), 'utf8')
  picks = [path.join(media, 'Game.exe'), undefined]
  assert.equal(
    (
      await explorer.request({
        action: 'bindTarget',
        rowId: row().rowId,
        revision: row().record!.revision,
        templateId: 'file',
        args,
      })
    ).cancelled,
    true
  )
  assert.equal(await fs.readFile(folderFile(media), 'utf8'), bound)
  picks = [path.join(media, 'Game.exe'), path.join(media, 'notes.txt')]
  await explorer.request({
    action: 'bindTarget',
    rowId: row().rowId,
    revision: row().record!.revision,
    templateId: 'file',
    args,
  })
  await explorer.request({ action: 'runTarget', rowId: row().rowId, templateId: 'file' })
  assert.deepEqual(calls[1], {
    file: path.join(media, 'Game.exe'),
    args: [...args, path.join(media, 'notes.txt')],
  })
  for (const url of [
    'file:///C:/Game.exe',
    'javascript:alert(1)',
    'https://user:pass@example.test/',
  ]) {
    await assert.rejects(
      explorer.request({
        action: 'bindTarget',
        rowId: row().rowId,
        revision: row().record!.revision,
        templateId: 'web',
        args: [],
        url,
      }),
      /網址/
    )
  }
  await explorer.request({
    action: 'bindTarget',
    rowId: row().rowId,
    revision: row().record!.revision,
    templateId: 'web',
    args: [],
    url: 'https://example.test/game?a=1',
  })
  assert.equal(urls.length, 0)
  await explorer.request({ action: 'runTarget', rowId: row().rowId, templateId: 'web' })
  assert.deepEqual(urls, ['https://example.test/game?a=1'])
  const saved = await readFolder(media)
  await assert.rejects(
    explorer.request({
      action: 'bindTarget',
      rowId: row().rowId,
      revision: row().record!.revision,
      templateId: 'file',
      args: ['\0'],
    }),
    /參數/
  )
  assert.deepEqual(await readFolder(media), saved)
  picks = ['relative.exe']
  await assert.rejects(
    explorer.request({
      action: 'bindTarget',
      rowId: row().rowId,
      revision: row().record!.revision,
      templateId: 'file',
      args: [],
    }),
    /路徑/
  )
  picks = [path.join(media, 'unsafe.cmd')]
  await assert.rejects(
    explorer.request({
      action: 'bindTarget',
      rowId: row().rowId,
      revision: row().record!.revision,
      templateId: 'file',
      args: [],
    }),
    /類型/
  )
  const outside = path.join(root, 'outside')
  await fs.mkdir(outside)
  await fs.writeFile(path.join(outside, 'tool.exe'), 'EXTERNAL ORIGINAL')
  await fs.symlink(
    outside,
    path.join(media, 'linked'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  picks = [path.join(media, 'linked', 'tool.exe')]
  await assert.rejects(
    explorer.request({
      action: 'bindTarget',
      rowId: row().rowId,
      revision: row().record!.revision,
      templateId: 'file',
      args: [],
    }),
    /連結|junction/
  )
  assert.equal(await fs.readFile(path.join(outside, 'tool.exe'), 'utf8'), 'EXTERNAL ORIGINAL')
  assert.deepEqual(await readFolder(media), saved)
  assert.equal(calls.length, 2)
  for (const [name, value] of Object.entries(original)) {
    assert.equal(await fs.readFile(path.join(media, name), 'utf8'), value)
  }
})

test('R-555: targetArgs updates launch args without re-picking and unbindTarget clears binding and hidden state', async (t) => {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'game-actions-r555-'))
  const media = path.join(root, 'game')
  await fs.mkdir(media)
  await fs.writeFile(path.join(media, 'Game.exe'), 'CONTROLLED FAKE EXE')
  const library = new Library(path.join(root, 'local'), undefined, false)
  await library.init()
  let chooseCount = 0
  const desktop: DesktopOperations = {
    choose: async () => {
      chooseCount++
      return path.join(media, 'Game.exe')
    },
    open: async () => {},
    launch: async () => {},
    external: async () => {},
    thumbnail: async () => Buffer.alloc(0),
  }
  const explorer = new Explorer(library, library.userData, desktop)
  t.after(async () => {
    explorer.close()
    const target = await fs.realpath(root)
    assert.ok(target.startsWith(base + path.sep))
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  await library.create(media, { name: 'Games', depth: { mode: 'through', level: 1 } })
  const row = () => library.snapshot().rows[0]
  // Unbound target rejects targetArgs.
  await assert.rejects(
    explorer.request({
      action: 'targetArgs',
      rowId: row().rowId,
      revision: row().record!.revision,
      templateId: 'default-launch-game',
      args: ['--fullscreen'],
    }),
    /程式操作/
  )
  await explorer.request({
    action: 'bindTarget',
    rowId: row().rowId,
    revision: row().record!.revision,
    templateId: 'default-launch-game',
    args: ['--old'],
  })
  assert.equal(chooseCount, 1)
  // Update args without triggering file picker.
  await explorer.request({
    action: 'targetArgs',
    rowId: row().rowId,
    revision: row().record!.revision,
    templateId: 'default-launch-game',
    args: ['--fullscreen', '含 空白'],
  })
  assert.equal(chooseCount, 1)
  assert.deepEqual((await readFolder(media)).details?.targets?.['default-launch-game']?.args, [
    '--fullscreen',
    '含 空白',
  ])
  // Hide then unbind clears both target and hiddenActions.
  await explorer.request({
    action: 'actionVisible',
    rowId: row().rowId,
    revision: row().record!.revision,
    templateId: 'default-launch-game',
    visible: false,
  })
  await explorer.request({
    action: 'unbindTarget',
    rowId: row().rowId,
    revision: row().record!.revision,
    templateId: 'default-launch-game',
  })
  const after = await readFolder(media)
  assert.equal(after.details?.targets?.['default-launch-game'], undefined)
  assert.equal(after.details?.hiddenActions, undefined)
})
