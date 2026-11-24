import { test } from 'node:test'
import assert from 'node:assert/strict'
import { metadata } from '../electron/metadata'
import { pace, pickVersion } from '../electron/sources/musicbrainz'
import type { MetadataVersion } from '../shared/explorer'
import { tinyPng } from './support/archive-fixture'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Library } from '../electron/library'
import { Explorer } from '../electron/explorer'
import { readFolder } from '../electron/files'
import { validateFolder } from '../shared/model'

// R-449: a MusicBrainz album (release-group) lists its versions (releases), picks the one whose track count matches
// the folder's music files, and merges it in: work data from the album, version data from the release.
pace.ms = 0
const group = '11111111-2222-3333-4444-000000000001',
  cd = '11111111-2222-3333-4444-00000000000a',
  digital = '11111111-2222-3333-4444-00000000000b',
  bootleg = '11111111-2222-3333-4444-00000000000c'
const version = (id: string, date: string, status: string, tracks: number[], format = 'CD') => ({
  id,
  date,
  status,
  country: 'JP',
  media: tracks.map((n) => ({ format, 'track-count': n })),
  'label-info': [
    { label: { name: 'Label ' + id.slice(-1) }, 'catalog-number': 'CAT-' + id.slice(-1) },
  ],
})
const releases = [
  version(cd, '2004-03-04', 'Official', [10]),
  version(digital, '2010-01-01', 'Official', [12], 'Digital Media'),
  version(bootleg, '2003-01-01', 'Bootleg', [10, 2]),
]
function sourceFetch(seen: string[]) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    seen.push(url)
    const json = (body: unknown) => new Response(JSON.stringify(body))
    if (url.startsWith('https://musicbrainz.org/ws/2/release-group/' + group))
      return json({
        id: group,
        title: 'Album',
        'primary-type': 'Album',
        'first-release-date': '2003-01-01',
        'artist-credit': [{ name: 'Band' }],
        genres: [{ name: 'rock' }],
      })
    if (
      url ===
      `https://musicbrainz.org/ws/2/release?release-group=${group}&inc=media+labels&limit=100&fmt=json`
    )
      return json({ releases })
    const release = /\/ws\/2\/release\/([0-9a-f-]{36})\?/.exec(url)?.[1]
    if (release) {
      const raw = releases.find((r) => r.id === release)!
      return json({
        ...raw,
        title: 'Version title',
        'artist-credit': [{ name: 'Someone else' }],
        barcode: '4988',
        'release-group': { id: group },
        media: raw.media.map((m) => ({
          ...m,
          tracks: Array.from({ length: m['track-count'] }, (_, i) => ({ title: 'T' + (i + 1) })),
        })),
      })
    }
    if (url.startsWith('https://coverartarchive.org/')) return new Response(new Uint8Array(tinyPng))
    return new Response('', { status: 404 })
  }) as typeof fetch
}
const value = (item: { preview: { values: { key: string; value: unknown }[] } }, key: string) =>
  item.preview.values.find((v) => v.key === key)?.value

test('the version whose track count matches is picked: official, earliest, then CD or digital', () => {
  const v = (id: string, patch: Partial<MetadataVersion>): MetadataVersion => ({
    id,
    official: true,
    ...patch,
  })
  const list = [
    v('late', { date: '2010', tracks: 10, formats: 'CD' }),
    v('vinyl', { date: '2001', tracks: 10, formats: '12" Vinyl' }),
    v('same-day-cd', { date: '2001', tracks: 10, formats: '2×CD' }),
    v('bootleg', { date: '1999', tracks: 10, official: false }),
    v('other', { date: '1998', tracks: 12 }),
  ]
  assert.deepEqual(pickVersion(list, 10), { id: 'same-day-cd', pick: 'match' })
  assert.deepEqual(pickVersion(list, 12), { id: 'other', pick: 'match' })
  // None matches (or no count): the earliest official version, and the window says no count matched.
  assert.deepEqual(pickVersion(list, 7), { id: 'other', pick: 'fallback' })
  assert.deepEqual(pickVersion(list), { id: 'other', pick: 'fallback' })
  assert.equal(pickVersion([], 10), undefined)
})

test('an album preview merges the matching version and lists every version', async () => {
  const seen: string[] = []
  const item = await metadata(
    'https://musicbrainz.org/release-group/' + group,
    sourceFetch(seen),
    undefined,
    {
      trackCount: 10,
    }
  )
  const preview = item.preview
  assert.equal(preview.version, cd, 'the official 10-track version, not the earlier bootleg')
  assert.equal(preview.versionPick, 'match')
  assert.deepEqual(
    preview.versions?.map((v) => [v.id, v.formats, v.tracks, v.official, v.matches]),
    [
      [cd, 'CD', 10, true, true],
      [digital, 'Digital Media', 12, true, false],
      [bootleg, '2×CD', 12, false, false],
    ]
  )
  assert.equal(preview.versions?.[0].label, 'Label a')
  assert.equal(preview.versions?.[0].catalog, 'CAT-a')
  // Work data from the album, version data from the release; the source address is the version's.
  assert.equal(preview.title, 'Album')
  assert.deepEqual(value(item, 'ARTISTS'), ['Band'])
  assert.equal(value(item, 'RELEASE_DATE'), '2003-01-01')
  assert.equal(value(item, 'EDITION_DATE'), '2004-03-04')
  assert.equal(value(item, 'BARCODE'), '4988')
  assert.equal(value(item, 'TRACK_COUNT'), 10)
  assert.deepEqual(value(item, 'CATALOG_NUMBER'), ['CAT-a'])
  assert.equal(value(item, 'SOURCE_URL'), 'https://musicbrainz.org/release/' + cd)
  assert.equal(value(item, 'RELEASE_GROUP_URL'), 'https://musicbrainz.org/release-group/' + group)
  // Both covers: the version's and the album's.
  assert.ok(item.cover && item.albumCover && preview.image && preview.albumImage)
  assert.ok(seen.includes(`https://coverartarchive.org/release/${cd}/front-500`))
  assert.ok(seen.includes(`https://coverartarchive.org/release-group/${group}/front-500`))
  assert.ok(seen.every((url) => /^https:\/\/(musicbrainz|coverartarchive)\.org\//.test(url)))

  // Switching versions fetches only that version (the album and its list are kept).
  seen.length = 0
  const other = await metadata(
    'https://musicbrainz.org/release-group/' + group,
    sourceFetch(seen),
    undefined,
    {
      release: digital,
      trackCount: 10,
    }
  )
  assert.equal(other.preview.version, digital)
  assert.equal(other.preview.versionPick, 'chosen')
  assert.equal(value(other, 'TRACK_COUNT'), 12)
  assert.deepEqual(
    seen.filter((url) => url.startsWith('https://musicbrainz.org/')),
    [
      `https://musicbrainz.org/ws/2/release/${digital}?inc=artist-credits+recordings+labels+media+genres+tags+release-groups&fmt=json`,
    ]
  )
  // Album data only: no version values, the album's address and cover.
  const plain = await metadata(
    'https://musicbrainz.org/release-group/' + group,
    sourceFetch([]),
    undefined,
    {
      release: null,
    }
  )
  assert.equal(plain.preview.version, undefined)
  assert.equal(plain.preview.versions?.length, 3)
  assert.equal(value(plain, 'SOURCE_URL'), 'https://musicbrainz.org/release-group/' + group)
  assert.equal(value(plain, 'EDITION_DATE'), undefined)
  assert.equal(value(plain, 'TRACK_LIST'), undefined)
  assert.equal(plain.albumCover, undefined)
  // A version that is not one of the album's is refused.
  await assert.rejects(
    metadata('https://musicbrainz.org/release-group/' + group, sourceFetch([]), undefined, {
      release: '99999999-2222-3333-4444-00000000000a',
    })
  )
})

test('no version matches: the earliest official one, marked as a fallback; a pasted version is picked', async () => {
  const none = await metadata(
    'https://musicbrainz.org/release-group/' + group,
    sourceFetch([]),
    undefined,
    {
      trackCount: 3,
    }
  )
  assert.equal(none.preview.version, cd)
  assert.equal(none.preview.versionPick, 'fallback')
  const seen: string[] = []
  const pasted = await metadata(
    'https://musicbrainz.org/release/' + digital,
    sourceFetch(seen),
    undefined,
    {
      trackCount: 10,
    }
  )
  assert.equal(pasted.preview.version, digital, 'the pasted version, even though another matches')
  assert.equal(pasted.preview.versionPick, 'chosen')
  assert.equal(pasted.preview.title, 'Album')
  assert.equal(pasted.preview.versions?.length, 3)
  assert.equal(
    seen.filter((url) => url.includes('/ws/2/release/')).length,
    1,
    'the pasted version is fetched once'
  )
})

test('importing keeps the version cover, the album cover or both, as ticked', async (t) => {
  const base = path.resolve('.test-output')
  await fs.mkdir(base, { recursive: true })
  const root = await fs.mkdtemp(path.join(base, 'mb-versions-')),
    media = path.join(root, 'media'),
    local = path.join(root, 'local')
  await fs.mkdir(media)
  const lib = new Library(local, undefined, false)
  await lib.init()
  const explorer = new Explorer(lib, local, {
    choose: async () => undefined,
    open: async () => {},
    launch: async () => {},
    thumbnail: async () => Buffer.from('thumbnail'),
  })
  const original = globalThis.fetch
  t.after(async () => {
    globalThis.fetch = original
    explorer.close()
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  await lib.create(media, { name: 'M', depth: { mode: 'through', level: 1 } })
  globalThis.fetch = sourceFetch([])
  const apply = async (image: boolean, albumImage: boolean) => {
    const preview = (
        await explorer.request({
          action: 'metadataPreview',
          source: 'https://musicbrainz.org/release-group/' + group,
          trackCount: 10,
        })
      ).preview!,
      row = lib.snapshot().rows[0]
    await explorer.request({
      action: 'metadataApply',
      rowId: row.rowId,
      revision: row.record!.revision,
      token: preview.token,
      keys: ['EDITION_DATE', 'RELEASE_GROUP_URL'],
      image,
      albumImage,
      mode: 'replace',
    })
    return readFolder(media)
  }
  let record = await apply(false, true)
  assert.deepEqual(
    record.assets.map((a) => a.originalName),
    ['musicbrainz-album-cover.png']
  )
  record = await apply(true, false)
  assert.deepEqual(record.assets.map((a) => a.originalName).sort(), [
    'musicbrainz-album-cover.png',
    'musicbrainz-cover.png',
  ])
  validateFolder(record)
  const date = record.attributes.find((a) => a.attributeId === 'musicbrainz-edition_date')
  assert.equal(date?.type, 'date', 'the version date is stored as a date')
  assert.equal(date?.value, '2004-03-04')
  assert.equal(
    record.attributes.find((a) => a.attributeId === 'musicbrainz-source_url'),
    undefined,
    'not ticked, not imported'
  )
})
