import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { queueThumbnail, thumbnail, THUMBNAIL_WORKERS } from '../electron/explorer-stream'
import type { Explorer } from '../electron/explorer'

// R-441: thumbnails are made a few at a time (never more than THUMBNAIL_WORKERS), the newest request first, and a
// request the window gave up on is skipped without decoding anything.
const jpeg = Buffer.from([255, 216, 1, 2, 3, 255, 217])

test('thumbnails are made a few at a time, newest first, skipping cancelled ones', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-queue-'))
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }))
  let active = 0,
    most = 0
  const started: string[] = []
  const ex = {
    root,
    thumbnailJobs: new Map(),
    thumbnailQueue: [],
    thumbnailActive: 0,
    thumbnailBurst: { id: 0, at: -Infinity },
    desktop: {
      thumbnail: async (source: string) => {
        started.push(source)
        active++
        most = Math.max(most, active)
        await new Promise((resolve) => setTimeout(resolve, 30))
        active--
        return jpeg
      },
    },
  } as unknown as Explorer
  const ask = (name: string, signal = new AbortController().signal) =>
    thumbnail(
      ex,
      path.join(root, name + '.jpg'),
      name,
      'image/png',
      10,
      signal,
      'media://file/x/' + name
    )
  const cancelled = new AbortController()
  const names = Array.from({ length: THUMBNAIL_WORKERS + 4 }, (_, i) => 'image-' + i)
  const results = names.map((name, i) =>
    i === THUMBNAIL_WORKERS + 1 ? ask(name, cancelled.signal).catch((e: Error) => e) : ask(name)
  )
  cancelled.abort()
  const settled = await Promise.all(results)
  assert.equal(most, THUMBNAIL_WORKERS, 'several at once, never more than the workers')
  assert.ok(THUMBNAIL_WORKERS >= 2)
  // The cancelled one was never decoded and says so; every other one was made once.
  assert.ok(!started.includes(names[THUMBNAIL_WORKERS + 1]))
  assert.ok(settled[THUMBNAIL_WORKERS + 1] instanceof Error)
  assert.equal(started.length, names.length - 1)
  // Made thumbnails are cached: asking again decodes nothing.
  await ask(names[0])
  assert.equal(started.length, names.length - 1)
})

// R-519: a screen of pictures asked at once is made top to bottom (small files first), and a later burst (the
// window scrolled) goes before what is still waiting from the earlier one.
test('a burst is made in order with small files first, the newest burst first', async () => {
  const ex = {
    thumbnailQueue: [],
    thumbnailActive: 0,
    thumbnailBurst: { id: 0, at: -Infinity },
  } as unknown as Explorer
  const order: string[] = []
  const ask = (name: string, size: number) =>
    queueThumbnail(
      ex,
      async () => {
        order.push(name)
        await new Promise((resolve) => setTimeout(resolve, 40))
        return jpeg
      },
      size
    )
  const big = 5 * 1024 * 1024,
    small = 200 * 1024
  // Three rounds of work: the second burst arrives while the second round runs.
  const count = THUMBNAIL_WORKERS * 3
  const first = Array.from({ length: count }, (_, i) =>
    ask('a' + i, i === THUMBNAIL_WORKERS + 2 ? small : big)
  )
  await new Promise((resolve) => setTimeout(resolve, 70))
  const second = [ask('b0', big), ask('b1', big)]
  await Promise.all([...first, ...second])
  const started = Array.from({ length: THUMBNAIL_WORKERS }, (_, i) => 'a' + i)
  assert.deepEqual(order.slice(0, THUMBNAIL_WORKERS), started, 'the top ones start at once')
  // While those run: the small file, then the rest top to bottom, until the second burst arrives.
  assert.equal(order[THUMBNAIL_WORKERS], 'a' + (THUMBNAIL_WORKERS + 2))
  const b0 = order.indexOf('b0')
  assert.equal(order[b0 + 1], 'b1')
  const waiting = Array.from({ length: count }, (_, i) => 'a' + i).filter(
    (name, i) => i >= THUMBNAIL_WORKERS && i !== THUMBNAIL_WORKERS + 2
  )
  assert.deepEqual(
    order.filter((name) => waiting.includes(name)),
    waiting,
    'the first burst keeps its order'
  )
  assert.ok(
    order.indexOf('a' + (count - 1)) > b0,
    'the newer burst goes before what is still waiting'
  )
})
