import { test } from 'node:test'
import assert from 'node:assert/strict'
import { metadata } from '../electron/metadata'
import { searchSources, SEARCH_QUERY_MAX, SEARCH_RESULTS_MAX } from '../electron/sources/search'
import { sourceForUrl } from '../shared/sources'
import { isExplorerRequest } from '../electron/ipc-requests'
import { tinyPng } from './support/archive-fixture'

// R-418: search by folder name across five sources, and Wikidata items. Every request is answered by a fixed reply.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const uuid = '5454ba7e-ea2a-3b36-a1fa-0d0dae13f03e'

function searchFetcher(seen: { url: string; body: any }[], fail: string[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input),
      host = new URL(url).hostname,
      body = init?.body ? JSON.parse(String(init.body)) : undefined
    seen.push({ url, body })
    assert.equal(init?.redirect, 'error')
    assert.match(String(new Headers(init?.headers).get('User-Agent')), /^Morph\//)
    if (fail.includes(host)) return json({}, 500)
    if (host === 'api.vndb.org')
      return json({
        results: [
          {
            id: 'v17',
            title: 'Ever17',
            released: '2002-08-29',
            titles: [{ lang: 'ja', title: 'エバー17' }],
          },
          { id: 'x17', title: 'Bad id' },
        ],
      })
    if (host === 'musicbrainz.org')
      return json({
        'release-groups': [
          {
            id: uuid,
            title: 'Portal',
            'first-release-date': '2008-01-01',
            'artist-credit': [{ name: 'Alexander Tucker' }],
          },
          { id: 'not-a-uuid', title: 'Broken' },
        ],
      })
    if (host === 'graphql.anilist.co')
      return json({
        data: {
          Page: {
            media: [
              {
                id: 5,
                type: 'ANIME',
                title: { romaji: 'Romaji', native: '日本語' },
                startDate: { year: 2010 },
              },
              { id: 6, type: 'OTHER', title: { romaji: 'Skipped' } },
            ],
          },
        },
      })
    if (host === 'api.bgm.tv')
      return json({ data: [{ id: 9, name: '原名', name_cn: '中文名', date: '2011-04-18' }] })
    if (host === 'store.steampowered.com')
      return json({
        items: [
          { id: 620, name: 'Portal 2' },
          { id: 0, name: 'Zero' },
        ],
      })
    return new Response('', { status: 404 })
  }) as typeof fetch
}

test('R-418: a name search merges the five sources, in the preferred languages, with addresses built from checked IDs', async () => {
  const seen: { url: string; body: any }[] = []
  const result = await searchSources('  Ever17  ', searchFetcher(seen), ['ja', 'zh-TW'])
  assert.deepEqual(result.failedSources, [])
  assert.deepEqual(
    result.candidates.map((c) => [c.provider, c.title, c.detail, c.url]),
    [
      ['vndb', 'エバー17', '2002', 'https://vndb.org/v17'],
      [
        'musicbrainz',
        'Portal',
        '2008 · Alexander Tucker',
        'https://musicbrainz.org/release-group/' + uuid,
      ],
      ['anilist', '日本語', '2010', 'https://anilist.co/anime/5/'],
      ['bangumi', '中文名', '2011', 'https://bgm.tv/subject/9'],
      ['steam', 'Portal 2', undefined, 'https://store.steampowered.com/app/620/'],
    ]
  )
  assert.equal(seen.length, 5, 'one request per source')
  assert.deepEqual(seen[0].body.filters, ['search', '=', 'Ever17'])
  assert.match(seen[4].url, /storesearch\/\?term=Ever17&l=japanese&cc=JP$/)
  for (const candidate of result.candidates)
    assert.equal(
      sourceForUrl(candidate.url),
      candidate.provider,
      'picking runs the ordinary preview'
    )
})

test('R-418: one failing source is reported and the rest still answer; the query and result counts are capped', async () => {
  const seen: { url: string; body: any }[] = []
  const result = await searchSources('x'.repeat(500), searchFetcher(seen, ['musicbrainz.org']), [])
  assert.deepEqual(result.failedSources, ['musicbrainz'])
  assert.deepEqual(
    result.candidates.map((c) => c.provider),
    ['vndb', 'anilist', 'bangumi', 'steam']
  )
  assert.equal(seen[0].body.filters[2].length, SEARCH_QUERY_MAX)
  const many = (async (input: RequestInfo | URL) =>
    new URL(String(input)).hostname === 'store.steampowered.com'
      ? json({ items: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: 'Game ' + i })) })
      : json({}, 500)) as typeof fetch
  const capped = await searchSources('game', many)
  assert.equal(capped.candidates.length, SEARCH_RESULTS_MAX)
  assert.equal(capped.failedSources.length, 4)
  await assert.rejects(searchSources('   ', many))
})

test('R-418: the search request is checked like the other requests', () => {
  assert.equal(isExplorerRequest({ action: 'metadataSearch', query: 'Ever17' }), true)
  assert.equal(isExplorerRequest({ action: 'metadataSearch', query: 7 }), false)
  assert.equal(isExplorerRequest({ action: 'metadataSearch' }), false)
})

const entity = {
  entities: {
    Q1299: {
      id: 'Q1299',
      labels: { en: { value: 'The Beatles' }, 'zh-hant': { value: '披頭四' } },
      descriptions: { en: { value: 'English band' }, 'zh-hant': { value: '英國樂團' } },
      claims: {
        P434: [{ mainsnak: { datavalue: { value: 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d' } } }],
        P3180: [{ mainsnak: { datavalue: { value: 'not an id' } } }],
        P1733: [{ mainsnak: { datavalue: { value: '2392500' } } }],
        P856: [{ mainsnak: { datavalue: { value: 'https://thebeatles.com' } } }],
        P18: [{ mainsnak: { datavalue: { value: 'Beatles Trenter 1963.jpg' } } }],
      },
    },
  },
}

test('R-418: a Wikidata item gives label and description in the preferred language, its picture and checked IDs', async () => {
  const seen: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    seen.push(url)
    if (url === 'https://www.wikidata.org/wiki/Special:EntityData/Q1299.json') return json(entity)
    if (url.startsWith('https://commons.wikimedia.org/w/api.php?')) {
      assert.match(url, /titles=File%3ABeatles\+Trenter\+1963\.jpg/)
      return json({
        query: {
          pages: [{ imageinfo: [{ thumburl: 'https://upload.wikimedia.org/x/400px-B.png' }] }],
        },
      })
    }
    if (url === 'https://upload.wikimedia.org/x/400px-B.png') return new Response(tinyPng)
    return new Response('', { status: 404 })
  }) as typeof fetch
  assert.equal(sourceForUrl('https://www.wikidata.org/wiki/Q1299'), 'wikidata')
  const result = await metadata('https://www.wikidata.org/wiki/Q1299', fetcher, 'wikidata', {
    languages: ['zh-TW'],
  })
  const value = (key: string) => result.preview.values.find((v) => v.key === key)?.value
  assert.equal(result.preview.title, '披頭四')
  assert.equal(result.preview.source, 'https://www.wikidata.org/wiki/Q1299')
  assert.equal(value('DESCRIPTION'), '英國樂團')
  assert.equal(value('MUSICBRAINZ_ARTIST_ID'), 'b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d')
  assert.equal(value('STEAM_APP_ID'), '2392500')
  assert.equal(value('VNDB_ID'), undefined, 'an ID of the wrong shape is dropped')
  assert.equal(value('OFFICIAL_URL'), 'https://thebeatles.com/')
  assert.ok(result.cover, 'the P18 picture comes through Commons and upload.wikimedia.org')
  const english = await metadata('https://www.wikidata.org/wiki/Q1299', fetcher, 'wikidata')
  assert.equal(english.preview.title, 'The Beatles')
  await assert.rejects(metadata('https://www.wikidata.org/wiki/Property:P1', fetcher))
  await assert.rejects(
    metadata('https://www.wikidata.org/wiki/Q9', (async () =>
      json({ entities: {} })) as typeof fetch)
  )
})
