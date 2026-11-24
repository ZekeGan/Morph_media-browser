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

test('the newest waiting thumbnail is made first', async () => {
  const ex = { thumbnailQueue: [], thumbnailActive: 0 } as unknown as Explorer
  const order: number[] = []
  const jobs = Array.from({ length: THUMBNAIL_WORKERS + 3 }, (_, i) =>
    queueThumbnail(ex, async () => {
      order.push(i)
      await new Promise((resolve) => setTimeout(resolve, 10))
      return jpeg
    })
  )
  await Promise.all(jobs)
  const first = Array.from({ length: THUMBNAIL_WORKERS }, (_, i) => i),
    rest = [THUMBNAIL_WORKERS + 2, THUMBNAIL_WORKERS + 1, THUMBNAIL_WORKERS]
  assert.deepEqual(order, [...first, ...rest])
})
