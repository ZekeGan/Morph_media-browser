import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

import type { EmbeddedSubtitleInfo } from '../shared/explorer'
import { validateDetails } from '../shared/modelValidation'
import { chooseSubtitleTrack, trackPreference } from '../shared/subtitleTrack'
import { externalPlayerArgs, externalPlayerKind } from '../shared/videoPlayer'

import { type DesktopOperations, Explorer } from '../electron/explorer'
import { readFolder } from '../electron/files'
import { isExplorerRequest } from '../electron/ipc-requests'
import { Library } from '../electron/library'

const track = (
  number: number,
  patch: Partial<EmbeddedSubtitleInfo> = {}
): EmbeddedSubtitleInfo => ({
  number,
  graphic: false,
  cues: 10,
  ...patch,
})

// R-431: the launcher's argument array.
test('PotPlayer gets /seek=HH:MM:SS after the file, mpv gets --start=<seconds> before it, others only the file', () => {
  const file = 'D:\\Videos\\Show 01.mkv'
  assert.deepEqual(
    externalPlayerArgs('C:\\Program Files\\DAUM\\PotPlayer\\PotPlayerMini64.exe', file, 3725.9),
    [file, '/seek=01:02:05']
  )
  assert.deepEqual(externalPlayerArgs('C:\\p\\PotPlayerMini.exe', file, 65), [
    file,
    '/seek=00:01:05',
  ])
  assert.deepEqual(externalPlayerArgs('C:\\p\\potplayer.exe', file, 5), [file, '/seek=00:00:05'])
  assert.deepEqual(externalPlayerArgs('C:\\tools\\mpv\\mpv.exe', file, 90.5), [
    '--start=90.5',
    file,
  ])
  assert.deepEqual(externalPlayerArgs('C:\\Program Files\\VLC\\vlc.exe', file, 90), [file])
  assert.deepEqual(externalPlayerArgs('C:\\tools\\mpv\\mpvnet.exe', file, 90), [file])
  assert.equal(externalPlayerKind('D:\\x\\PotPlayerMini64.exe'), 'potplayer')
  assert.equal(externalPlayerKind('D:\\x\\mpv.exe'), 'mpv')
  assert.equal(externalPlayerKind('D:\\x\\mpv.exe.bat'), 'other')
})

test('a position that is not a sane positive number is left out, and nothing is ever joined into a shell string', () => {
  const file = 'D:\\Videos\\a & b "c".mkv'
  for (const time of [undefined, 0, -1, NaN, Infinity, 1e9, '30' as unknown as number]) {
    for (const program of ['C:\\p\\PotPlayerMini64.exe', 'C:\\p\\mpv.exe']) {
      assert.deepEqual(externalPlayerArgs(program, file, time), [file])
    }
  }
  // The file stays one untouched element however odd its name.
  assert.equal(externalPlayerArgs('C:\\p\\mpv.exe', file, 10)[1], file)
})

// R-432: track matching.
test('the track of the same name is chosen first, then the same language, then (nothing remembered) the default', () => {
  const tracks = [
    track(1, { language: 'jpn', name: 'Full', default: true }),
    track(2, { language: 'chi', name: 'Traditional' }),
    track(3, { language: 'chi', name: 'Simplified' }),
    track(4, { language: 'eng', name: 'Signs', forced: true }),
    track(5, { language: 'eng', name: 'Dialogue' }),
    track(6, { language: 'kor', graphic: true }),
  ]
  assert.equal(chooseSubtitleTrack(tracks, { name: ' simplified ', language: 'jpn' })?.number, 3)
  // Name first, even when the language differs.
  assert.equal(chooseSubtitleTrack(tracks, { name: 'Dialogue', language: 'chi' })?.number, 5)
  // No such name: the same language (bibliographic and terminology codes are one language).
  assert.equal(chooseSubtitleTrack(tracks, { name: 'Other', language: 'zho' })?.number, 2)
  assert.equal(chooseSubtitleTrack(tracks, { language: 'eng' })?.number, 5)
  // Nothing remembered: the file's default track.
  assert.equal(chooseSubtitleTrack(tracks)?.number, 1)
  assert.equal(chooseSubtitleTrack(tracks, {})?.number, 1)
  // Something remembered but absent: no guess. A graphic track that cannot be shown is never chosen.
  assert.equal(chooseSubtitleTrack(tracks, { name: 'Gone', language: 'fra' }), undefined)
  assert.equal(chooseSubtitleTrack(tracks, { language: 'kor' }), undefined)
  assert.equal(chooseSubtitleTrack([track(1, { graphic: true, default: true })]), undefined)
  assert.equal(
    chooseSubtitleTrack([track(1, { graphic: true, picture: true, default: true })])?.number,
    1
  )
  assert.equal(chooseSubtitleTrack([]), undefined)
  assert.deepEqual(trackPreference(track(2, { language: 'chi', name: ' Traditional ' })), {
    name: 'Traditional',
    language: 'chi',
  })
  assert.equal(trackPreference(track(2)), undefined)
})

test('the IPC shapes of the external player and the track preference refuse bad fields', () => {
  assert.ok(isExplorerRequest({ action: 'chooseVideoPlayer' }))
  assert.ok(isExplorerRequest({ action: 'chooseVideoPlayer', clear: true }))
  assert.ok(isExplorerRequest({ action: 'openExternalPlayer', rowId: 'r', fileId: 'f' }))
  assert.ok(
    isExplorerRequest({ action: 'openExternalPlayer', rowId: 'r', fileId: 'f', time: 12.5 })
  )
  assert.ok(isExplorerRequest({ action: 'subtitleTrack', rowId: 'r', revision: 1 }))
  assert.ok(
    isExplorerRequest({
      action: 'subtitleTrack',
      rowId: 'r',
      revision: 1,
      name: 'x',
      language: 'jpn',
    })
  )
  for (const bad of [
    { action: 'chooseVideoPlayer', clear: 'yes' },
    { action: 'openExternalPlayer', rowId: 'r' },
    { action: 'openExternalPlayer', fileId: 'f' },
    { action: 'openExternalPlayer', rowId: 'r', fileId: 'f', time: NaN },
    { action: 'openExternalPlayer', rowId: 'r', fileId: 'f', time: Infinity },
    { action: 'openExternalPlayer', rowId: 'r', fileId: 'f', time: '5' },
    // The window never sends a program or file path of its own: unknown fields are not a way in, and ids are checked.
    { action: 'openExternalPlayer', rowId: '', fileId: 'f' },
    { action: 'openExternalPlayer', rowId: 'r', fileId: 'a\0b' },
    { action: 'subtitleTrack', rowId: 'r' },
    { action: 'subtitleTrack', rowId: 'r', revision: '1' },
    { action: 'subtitleTrack', rowId: 'r', revision: 1, name: 5 },
    { action: 'subtitleTrack', rowId: 'r', revision: 1, language: {} },
    { action: 'subtitleTrack', rowId: 'r', revision: 1, name: 'a\0b' },
  ]) {
    assert.equal(isExplorerRequest(bad), false, JSON.stringify(bad))
  }
})

test('the remembered subtitle track is validated with size caps', () => {
  const ok = (value: unknown) =>
    assert.doesNotThrow(() => validateDetails({ schemaVersion: 1, subtitleTrack: value }))
  const bad = (value: unknown) =>
    assert.throws(
      () => validateDetails({ schemaVersion: 1, subtitleTrack: value }),
      /字幕軌偏好不合法/
    )
  assert.doesNotThrow(() => validateDetails({ schemaVersion: 1 }))
  ok({ name: 'Traditional' })
  ok({ language: 'jpn' })
  ok({ name: 'n'.repeat(200), language: 'l'.repeat(35) })
  bad(null)
  bad([])
  bad('jpn')
  bad({})
  bad({ name: '' })
  bad({ language: '' })
  bad({ name: 'n'.repeat(201) })
  bad({ language: 'l'.repeat(36) })
  bad({ name: 5 })
  bad({ language: ['jpn'] })
  bad({ name: 'x', extra: 'field' })
})

async function fixture(t: { after: (fn: () => Promise<void>) => void }, player?: string) {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'video-external-'))
  const media = path.join(root, 'media')
  const local = path.join(root, 'local')
  await fs.mkdir(media)
  const lib = new Library(local, undefined, false)
  await lib.init()
  let chosen: string | undefined
  let configured = player
  const opened: string[] = []
  const launched: { file: string; args: string[] }[] = []
  const desktop: DesktopOperations = {
    choose: async () => chosen,
    open: async (file) => {
      opened.push(file)
    },
    launch: async (file, args) => {
      launched.push({ file, args })
    },
    videoPlayer: () => configured,
    setVideoPlayer: async (file) => {
      configured = file
    },
    thumbnail: async () => Buffer.from('thumbnail'),
  }
  const explorer = new Explorer(lib, local, desktop)
  t.after(async () => {
    explorer.close()
    const target = await fs.realpath(root)
    if (!target.startsWith(base + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  return {
    root,
    media,
    lib,
    explorer,
    opened,
    launched,
    choose: (file: string | undefined) => {
      chosen = file
    },
    player: () => configured,
  }
}

test('the explorer writes the track preference with the revision check and keeps it across saves', async (t) => {
  const { media, lib, explorer } = await fixture(t)
  await fs.writeFile(path.join(media, 'clip.mp4'), 'x')
  await lib.create(media, { name: 'P', depth: { mode: 'through', level: 1 } })
  const row = lib.snapshot().rows[0]
  const revision = row.record!.revision
  await explorer.request({
    action: 'subtitleTrack',
    rowId: row.rowId,
    revision,
    name: '  Traditional  ',
    language: 'chi',
  })
  const saved = await readFolder(row.path)
  assert.deepEqual(saved.details!.subtitleTrack, { name: 'Traditional', language: 'chi' })
  assert.equal(saved.revision, revision + 1)
  // A stale revision is refused and leaves the record as it was.
  await assert.rejects(
    explorer.request({ action: 'subtitleTrack', rowId: row.rowId, revision, name: 'Other' })
  )
  assert.deepEqual((await readFolder(row.path)).details!.subtitleTrack, {
    name: 'Traditional',
    language: 'chi',
  })
  // Over-long text is cut to the caps; no fields forgets the preference.
  const current = lib.snapshot().rows[0].record!.revision
  await explorer.request({
    action: 'subtitleTrack',
    rowId: row.rowId,
    revision: current,
    language: 'l'.repeat(80),
  })
  assert.equal((await readFolder(row.path)).details!.subtitleTrack!.language!.length, 35)
  await explorer.request({
    action: 'subtitleTrack',
    rowId: row.rowId,
    revision: lib.snapshot().rows[0].record!.revision,
  })
  assert.equal((await readFolder(row.path)).details!.subtitleTrack, undefined)
})

test('openExternalPlayer starts the configured program with an argument array, else the system default', async (t) => {
  const program = 'PotPlayerMini64.exe'
  const { root, media, lib, explorer, opened, launched, choose, player } = await fixture(t)
  await fs.writeFile(path.join(media, 'clip.mp4'), 'x')
  await fs.writeFile(path.join(media, 'note.txt'), 'x')
  await lib.create(media, { name: 'P', depth: { mode: 'through', level: 1 } })
  const row = lib.snapshot().rows[0]
  const entries = (await explorer.content(row.rowId)).entries
  const video = entries.find((e) => e.name === 'clip.mp4')!
  const note = entries.find((e) => e.name === 'note.txt')!
  // Nothing set: the system default opens the file as before.
  await explorer.request({
    action: 'openExternalPlayer',
    rowId: row.rowId,
    fileId: video.id,
    time: 30,
  })
  assert.deepEqual(opened, [path.join(media, 'clip.mp4')])
  assert.equal(launched.length, 0)
  // Setting a program: it must be an existing .exe file (a dialog result; the window never sends a path).
  choose(path.join(root, 'missing.exe'))
  await assert.rejects(explorer.request({ action: 'chooseVideoPlayer' }))
  choose(path.join(media, 'note.txt'))
  await assert.rejects(explorer.request({ action: 'chooseVideoPlayer' }))
  choose('relative.exe')
  await assert.rejects(explorer.request({ action: 'chooseVideoPlayer' }))
  assert.equal(player(), undefined)
  const exe = path.join(root, program)
  await fs.writeFile(exe, 'controlled fake, never executed')
  choose(exe)
  const chosen = await explorer.request({ action: 'chooseVideoPlayer' })
  assert.equal(chosen.videoPlayer, await fs.realpath(exe))
  choose(undefined)
  assert.equal((await explorer.request({ action: 'chooseVideoPlayer' })).cancelled, true)
  // Now the program starts with the file and the position as separate arguments.
  await explorer.request({
    action: 'openExternalPlayer',
    rowId: row.rowId,
    fileId: video.id,
    time: 3725,
  })
  assert.equal(launched.length, 1)
  assert.equal(launched[0].file, await fs.realpath(exe))
  assert.deepEqual(launched[0].args, [path.join(media, 'clip.mp4'), '/seek=01:02:05'])
  await explorer.request({ action: 'openExternalPlayer', rowId: row.rowId, fileId: video.id })
  assert.deepEqual(launched[1].args, [path.join(media, 'clip.mp4')])
  // Only audio and video files; an unknown file id is refused.
  await assert.rejects(
    explorer.request({ action: 'openExternalPlayer', rowId: row.rowId, fileId: note.id })
  )
  await assert.rejects(
    explorer.request({ action: 'openExternalPlayer', rowId: row.rowId, fileId: '../x' })
  )
  // A program that has since gone is reported, not silently replaced by the default.
  await fs.rm(exe)
  await assert.rejects(
    explorer.request({ action: 'openExternalPlayer', rowId: row.rowId, fileId: video.id })
  )
  assert.equal(launched.length, 2)
  // Clearing goes back to the system default.
  await explorer.request({ action: 'chooseVideoPlayer', clear: true })
  assert.equal(player(), undefined)
})
