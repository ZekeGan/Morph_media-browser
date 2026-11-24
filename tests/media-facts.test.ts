import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { MediaFacts } from '../electron/media-facts'

// A silent mono WAV of the given length in seconds (44.1 kHz, 16 bit).
function wav(seconds: number) {
  const data = Buffer.alloc(44100 * 2 * seconds),
    head = Buffer.alloc(44)
  head.write('RIFF')
  head.writeUInt32LE(36 + data.length, 4)
  head.write('WAVEfmt ', 8)
  head.writeUInt32LE(16, 16)
  head.writeUInt16LE(1, 20)
  head.writeUInt16LE(1, 22)
  head.writeUInt32LE(44100, 24)
  head.writeUInt32LE(88200, 28)
  head.writeUInt16LE(2, 32)
  head.writeUInt16LE(16, 34)
  head.write('data', 36)
  head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}
const open: MediaFacts[] = []
const opened = (path: string) => {
  const facts = new MediaFacts(path)
  open.push(facts)
  return facts
}
async function sandbox(t: { after: (fn: () => Promise<void>) => void }) {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'media-facts-'))
  t.after(async () => {
    // The index file is closed before its folder goes (Windows will not delete an open file).
    while (open.length) open.pop()!.close()
    const target = await fs.realpath(root)
    if (!target.startsWith(base + path.sep)) throw new Error('Unsafe test cleanup')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  return root
}
const until = async (check: () => Promise<boolean>) => {
  for (let n = 0; n < 50; n++) {
    if (await check()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

test('R-438: a folder card gets counts at once and the total length once every track has been read', async (t) => {
  const root = await sandbox(t),
    album = path.join(root, 'Album'),
    local = path.join(root, 'local')
  await fs.mkdir(album)
  await fs.writeFile(path.join(album, '01.wav'), wav(1))
  await fs.writeFile(path.join(album, '02.wav'), wav(2))
  await fs.writeFile(path.join(album, 'clip.mp4'), 'NOT A REAL VIDEO')
  await fs.writeFile(path.join(album, 'notes.txt'), 'ignored')
  const facts = opened(path.join(local, 'media-facts.sqlite'))
  const first = await facts.read(album)
  assert.equal(first.audio, 2)
  assert.equal(first.video, 1)
  assert.equal(first.duration, undefined, 'the length is not known until it has been read')
  assert.ok(await until(async () => (await facts.read(album)).duration !== undefined))
  assert.ok(Math.abs((await facts.read(album)).duration! - 3) < 0.05)
  // The folder's own files are only read: nothing was added to it.
  assert.deepEqual((await fs.readdir(album)).sort(), ['01.wav', '02.wav', 'clip.mp4', 'notes.txt'])
})

test('R-438: the index is dropped for a folder whose files changed, and unreadable audio gives no length', async (t) => {
  const root = await sandbox(t),
    album = path.join(root, 'Album')
  await fs.mkdir(album)
  await fs.writeFile(path.join(album, '01.wav'), wav(1))
  const facts = opened(path.join(root, 'local', 'media-facts.sqlite'))
  await facts.read(album)
  assert.ok(await until(async () => (await facts.read(album)).duration !== undefined))
  await fs.writeFile(path.join(album, '02.wav'), wav(1))
  const again = await facts.read(album)
  assert.equal(again.audio, 2)
  assert.equal(again.duration, undefined, 'a changed folder is read again')
  // A track that cannot be read leaves the length out instead of showing a partial sum.
  const broken = path.join(root, 'Broken')
  await fs.mkdir(broken)
  await fs.writeFile(path.join(broken, '01.wav'), wav(1))
  await fs.writeFile(path.join(broken, '02.wav'), 'BROKEN')
  await facts.read(broken)
  await new Promise((resolve) => setTimeout(resolve, 600))
  const after = await facts.read(broken)
  assert.equal(after.audio, 2)
  assert.equal(after.duration, undefined)
})
