import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Library } from '../electron/library'
import { Explorer, type DesktopOperations } from '../electron/explorer'
import { readFolder } from '../electron/files'
import { metadata } from '../electron/metadata'
import { downloadSourceImages, MAX_TOTAL_BYTES } from '../electron/source-images'
import { DATA_DIR, validateFolder } from '../shared/model'

// R-422: the picture lists of VNDB, Steam and SteamGridDB are downloaded for the preview and imported by position.
// Every request is answered by a fixed reply; nothing touches the network.
const jpg = (size = 8, fill = 0) =>
  Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(size - 4, fill)])
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'source-images-')),
    media = path.join(root, 'media'),
    local = path.join(root, 'local')
  await fs.mkdir(media)
  const lib = new Library(local, undefined, false)
  await lib.init()
  const desktop: DesktopOperations = {
    choose: async () => undefined,
    open: async () => {},
    launch: async () => {},
    thumbnail: async () => Buffer.from('thumbnail'),
  }
  const explorer = new Explorer(lib, local, desktop)
  t.after(async () => {
    explorer.index.close()
    const target = await fs.realpath(root)
    if (!target.startsWith(base + path.sep)) throw new Error('Unsafe cleanup')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  return { media, lib, explorer }
}

const vndbReply = {
  id: 'v17',
  title: 'Ever17',
  screenshots: [1, 2, 3].map((n) => ({
    url: 'https://t.vndb.org/sf/9' + n + '/19' + n + '.jpg',
    sexual: 0,
    violence: 0,
  })),
}
function vndbFetcher(asked: { url: string; init?: RequestInit }[]) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    asked.push({ url, init })
    if (url === 'https://api.vndb.org/kana/vn') return json({ results: [vndbReply] })
    if (url.startsWith('https://t.vndb.org/')) return new Response(jpg(16, url.length))
    return new Response('', { status: 404 })
  }) as typeof fetch
}

test('R-422: VNDB screenshots are downloaded from the picture host, without redirects, and numbered', async () => {
  const asked: { url: string; init?: RequestInit }[] = []
  const result = await metadata('https://vndb.org/v17', vndbFetcher(asked))
  assert.deepEqual(
    result.images?.map((i) => [i.role, i.n, i.mime]),
    [1, 2, 3].map((n) => ['screenshot', n, 'image/jpeg'])
  )
  const pictures = asked.filter((r) => r.url.startsWith('https://t.vndb.org/'))
  assert.equal(pictures.length, 3)
  assert.ok(pictures.every((r) => r.init?.redirect === 'error'))
})

test('R-422: only the source picture hosts, https, a picture type and the size cap are accepted', async () => {
  const fetched: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    fetched.push(url)
    if (url.endsWith('/big.jpg'))
      return new Response(jpg(16), { headers: { 'content-length': String(11 * 1024 * 1024) } })
    if (url.endsWith('/text.jpg')) return new Response('not a picture')
    return new Response(jpg(16))
  }) as typeof fetch
  const shots = [
    'https://t.vndb.org/sf/1/1.jpg',
    'https://evil.test/sf/2/2.jpg',
    'http://t.vndb.org/sf/3/3.jpg',
    'https://t.vndb.org:8443/sf/4/4.jpg',
    'https://t.vndb.org/sf/5/big.jpg',
    'https://t.vndb.org/sf/6/text.jpg',
    'https://t.vndb.org/sf/7/7.jpg',
  ]
  const images = await downloadSourceImages(
    'vndb',
    [{ key: 'SCREENSHOTS', type: 'tags', value: shots }],
    fetcher,
    []
  )
  assert.deepEqual(
    images.map((i) => i.n),
    [1, 2],
    'the refused host, scheme, port, oversized and non-picture ones are left out'
  )
  assert.ok(!fetched.some((u) => u.includes('evil.test') || u.startsWith('http:')))
  assert.ok(!fetched.some((u) => u.includes(':8443')))
})

test('R-422: at most 12 screenshots, and the hero, logo and icon of SteamGridDB', async () => {
  const fetched: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    fetched.push(String(input))
    return new Response(jpg(16))
  }) as typeof fetch
  const grid = await downloadSourceImages(
    'steamgriddb',
    [
      { key: 'HERO_URL', type: 'string', value: 'https://cdn2.steamgriddb.com/hero/a.jpg' },
      { key: 'LOGO_URL', type: 'string', value: 'https://cdn2.steamgriddb.com/logo/b.jpg' },
      { key: 'ICON_URL', type: 'string', value: 'https://cdn2.steamgriddb.com/icon/c.jpg' },
      { key: 'SCREENSHOTS', type: 'tags', value: ['https://cdn2.steamgriddb.com/x.jpg'] },
    ],
    fetcher,
    []
  )
  assert.deepEqual(
    grid.map((i) => i.role),
    ['screenshot', 'hero', 'logo', 'icon']
  )
  fetched.length = 0
  const steamHost = 'shared.fastly.steamstatic.com',
    many = Array.from({ length: 20 }, (_, n) => `https://${steamHost}/steam/apps/9/s${n}.jpg`)
  const steam = await downloadSourceImages(
    'steam',
    [{ key: 'SCREENSHOTS', type: 'tags', value: many }],
    fetcher,
    [steamHost]
  )
  assert.equal(steam.length, 12)
  assert.equal(fetched.length, 12)
  // A source without a picture host list is never downloaded from.
  assert.deepEqual(
    await downloadSourceImages(
      'eh',
      [{ key: 'SCREENSHOTS', type: 'tags', value: [`https://${steamHost}/a.jpg`] }],
      fetcher,
      [steamHost]
    ),
    []
  )
})

test('R-422: the pictures of one preview are capped in total', async () => {
  const size = 9 * 1024 * 1024,
    fetcher = (async () => new Response(jpg(size))) as typeof fetch,
    urls = Array.from({ length: 10 }, (_, n) => `https://t.vndb.org/sf/${n}/${n}.jpg`)
  const images = await downloadSourceImages(
    'vndb',
    [{ key: 'SCREENSHOTS', type: 'tags', value: urls }],
    fetcher,
    []
  )
  assert.equal(images.length, Math.floor(MAX_TOTAL_BYTES / size))
  assert.ok(images.reduce((sum, i) => sum + i.bytes.length, 0) <= MAX_TOTAL_BYTES)
})

test('R-422: importing stores only the checked pictures with their roles; forged positions are refused', async (t) => {
  const { media, lib, explorer } = await fixture(t)
  await lib.create(media, { name: 'P', depth: { mode: 'through', level: 1 } })
  const original = globalThis.fetch
  globalThis.fetch = vndbFetcher([])
  try {
    const candidate = await explorer.request({
        action: 'metadataPreview',
        source: 'https://vndb.org/v17',
      }),
      preview = candidate.preview!
    assert.equal(preview.images?.length, 3)
    assert.ok(preview.images!.every((i) => i.image.startsWith('data:image/jpeg;base64,')))
    assert.deepEqual(
      preview.images!.map((i) => i.n),
      [1, 2, 3]
    )
    const row = lib.snapshot().rows[0],
      base = { action: 'metadataApply' as const, rowId: row.rowId, token: preview.token },
      before = await readFolder(media)
    for (const images of [[3], [-1], [1.5], [0, 0], [99]])
      await assert.rejects(
        explorer.request({
          ...base,
          revision: row.record!.revision,
          keys: [],
          image: false,
          images,
        }),
        /匯入圖片不合法/
      )
    assert.deepEqual((await readFolder(media)).assets, before.assets, 'nothing was written')
    await explorer.request({
      ...base,
      revision: row.record!.revision,
      keys: [],
      image: false,
      images: [2, 0],
    })
    const record = await readFolder(media)
    assert.deepEqual(
      record.assets.map((a) => [a.originalName, a.role]).sort(),
      [
        ['vndb-screenshot-1.jpg', 'screenshot'],
        ['vndb-screenshot-3.jpg', 'screenshot'],
      ],
      'only the checked ones, with their roles'
    )
    validateFolder(record)
    for (const asset of record.assets)
      assert.ok(await fs.stat(path.join(media, DATA_DIR, asset.relativePath)))
    assert.equal(
      (await fs.readdir(path.join(media, DATA_DIR, 'assets'))).length,
      2,
      'no other file was written'
    )
    // A second import of the same picture does not add it again.
    const next = lib.snapshot().rows[0],
      again = await explorer.request({
        action: 'metadataPreview',
        source: 'https://vndb.org/v17',
      })
    await explorer.request({
      action: 'metadataApply',
      rowId: next.rowId,
      revision: next.record!.revision,
      token: again.preview!.token,
      keys: [],
      image: false,
      images: [0, 1],
    })
    assert.equal((await readFolder(media)).assets.length, 3)
  } finally {
    globalThis.fetch = original
  }
})

test('R-422: a bad role in a stored asset is refused', () => {
  assert.throws(() =>
    validateFolder({
      kind: 'media-viewer.folder',
      schemaVersion: 2,
      folderId: 'f',
      revision: 1,
      attributes: [],
      projectOverrides: {},
      assets: [
        {
          assetId: 'a',
          relativePath: 'assets/a.jpg',
          originalName: 'x.jpg',
          mediaType: 'image/jpeg',
          role: 'poster',
        },
      ],
    })
  )
})
