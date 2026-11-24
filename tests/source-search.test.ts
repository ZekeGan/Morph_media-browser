import { test } from 'node:test'
import assert from 'node:assert/strict'
import { metadata } from '../electron/metadata'
import { searchSources, SEARCH_QUERY_MAX, SEARCH_RESULTS_MAX } from '../electron/sources/search'
import { defaultSearchSources, searchableSources, sourceForUrl } from '../shared/sources'
import { isExplorerRequest } from '../electron/ipc-requests'
import { tinyPng } from './support/archive-fixture'

// R-418: search by folder name across five sources, and Wikidata items. Every request is answered by a fixed reply.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const uuid = '5454ba7e-ea2a-3b36-a1fa-0d0dae13f03e'

function searchFetcher(
  seen: { url: string; body: any; headers?: Headers }[],
  fail: string[] = [],
  bangumiNsfw = false
) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input),
      host = new URL(url).hostname,
      body = init?.body ? JSON.parse(String(init.body)) : undefined
    seen.push({ url, body, headers: new Headers(init?.headers) })
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
              { id: 7, type: 'MANGA', isAdult: true, title: { romaji: 'Adult' } },
              { id: 6, type: 'OTHER', title: { romaji: 'Skipped' } },
            ],
          },
        },
      })
    if (host === 'api.bgm.tv')
      return json({
        data: [
          { id: 9, name: '原名', name_cn: '中文名', date: '2011-04-18' },
          ...(bangumiNsfw ? [{ id: 10, name: 'R18', nsfw: true }] : []),
        ],
      })
    if (host === 'www.dlsite.com')
      return json([
        { workno: 'RJ01000001', site_id: 'maniax', work_name: 'Other', age_category: 1 },
        {
          workno: 'RJ01000002',
          site_id: 'aix',
          work_name: 'Ever17 Adult',
          maker_name: 'Circle',
          regist_date: '2024-05-01 00:00:00',
          age_category: 3,
        },
        { workno: 'RJ01000003', site_id: 'evil', work_name: 'Bad shop', age_category: 3 },
        { workno: 'xx1', site_id: 'maniax', work_name: 'Bad id' },
      ])
    if (host === 'nhentai.net')
      return json({
        result: [
          { id: 177013, english_title: 'English', japanese_title: '日本語', num_pages: 29 },
          { id: 0, english_title: 'Zero' },
        ],
      })
    if (host === 'api.dmm.com')
      return json({
        result: {
          status: 200,
          items: [
            { content_id: 'd_000001', title: 'FANZA work', date: '2020-01-02 10:00:00' },
            { content_id: 'bad id!', title: 'Bad' },
          ],
        },
      })
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
      ['anilist', 'Adult', undefined, 'https://anilist.co/manga/7/'],
      ['bangumi', '中文名', '2011', 'https://bgm.tv/subject/9'],
      ['steam', 'Portal 2', undefined, 'https://store.steampowered.com/app/620/'],
      [
        'dlsite',
        'Ever17 Adult',
        '2024 · Circle',
        'https://www.dlsite.com/ai/work/=/product_id/RJ01000002.html',
      ],
      [
        'dlsite',
        'Other',
        undefined,
        'https://www.dlsite.com/maniax/work/=/product_id/RJ01000001.html',
      ],
      ['nhentai', '日本語', '29 p', 'https://nhentai.net/g/177013/'],
    ]
  )
  assert.equal(seen.length, 7, 'one request per source; keyed sources without a key are not asked')
  // Found by site: a MusicBrainz search waits its turn (R-461), so the order sent is not fixed.
  const sent = (host: string) => seen.find((s) => new URL(s.url).hostname === host)!
  assert.deepEqual(sent('api.vndb.org').body.filters, ['search', '=', 'Ever17'])
  assert.match(sent('store.steampowered.com').url, /storesearch\/\?term=Ever17&l=japanese&cc=JP$/)
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
    ['vndb', 'anilist', 'anilist', 'bangumi', 'steam', 'dlsite', 'dlsite', 'nhentai']
  )
  assert.equal(seen[0].body.filters[2].length, SEARCH_QUERY_MAX)
  const many = (async (input: RequestInfo | URL) =>
    new URL(String(input)).hostname === 'store.steampowered.com'
      ? json({ items: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, name: 'Game ' + i })) })
      : json({}, 500)) as typeof fetch
  const capped = await searchSources('game', many)
  assert.equal(capped.candidates.length, SEARCH_RESULTS_MAX)
  assert.equal(capped.failedSources.length, 6)
  await assert.rejects(searchSources('   ', many))
})

const adultOf = (list: { adult?: boolean; url: string }[]) =>
  list.filter((c) => c.adult).map((c) => c.url)

test('C-143: AniList, Bangumi, DLsite, nhentai and FANZA candidates are marked adult; Bangumi NSFW needs a token', async () => {
  const plain: { url: string; body: any; headers?: Headers }[] = []
  const without = await searchSources('Ever17', searchFetcher(plain, [], true), ['ja'])
  const anilist = plain.find((r) => r.url.includes('anilist'))!
  assert.doesNotMatch(anilist.body.query, /isAdult:false/)
  assert.match(anilist.body.query, /isAdult/)
  const bangumiAsk = plain.find((r) => r.url.includes('bgm.tv'))!
  assert.deepEqual(bangumiAsk.body.filter, { nsfw: false })
  assert.equal(bangumiAsk.headers?.get('Authorization'), null)
  assert.deepEqual(adultOf(without.candidates), [
    'https://anilist.co/manga/7/',
    'https://bgm.tv/subject/10',
    'https://www.dlsite.com/ai/work/=/product_id/RJ01000002.html',
    'https://nhentai.net/g/177013/',
  ])
  assert.equal(
    plain.some((r) => r.url.includes('api.dmm.com')),
    false,
    'FANZA is only asked with a key'
  )

  const seen: { url: string; body: any; headers?: Headers }[] = []
  const keyed = await searchSources('Ever17', searchFetcher(seen, [], true), ['ja'], {
    keyFor: async (site): Promise<Record<string, string> | undefined> =>
      site === 'bangumi'
        ? { token: 'bgm-token' }
        : site === 'fanza'
          ? { apiId: 'id 1', affiliateId: 'aff-990' }
          : undefined,
  })
  const withToken = seen.find((r) => r.url.includes('bgm.tv'))!
  assert.deepEqual(withToken.body, { keyword: 'Ever17' })
  assert.equal(withToken.headers?.get('Authorization'), 'Bearer bgm-token')
  const fanza = seen.find((r) => r.url.includes('api.dmm.com'))!
  assert.match(fanza.url, /&keyword=Ever17&api_id=id%201&affiliate_id=aff-990$/)
  assert.ok(
    adultOf(keyed.candidates).includes('https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=d_000001/')
  )
  assert.equal(keyed.candidates.filter((c) => c.provider === 'fanza').length, 1)
  assert.deepEqual(keyed.failedSources, [])
  for (const candidate of keyed.candidates)
    assert.equal(sourceForUrl(candidate.url), candidate.provider)
})

test('C-143: every search request stays on its own fixed host', async () => {
  const hosts = new Map<string, Set<string>>()
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    hosts.set(url.hostname, new Set())
    return json({})
  }) as typeof fetch
  await searchSources('x', fetcher, [], {
    keyFor: async () => ({ token: 't', apiId: 'a', affiliateId: 'b' }),
  })
  assert.deepEqual(
    [...hosts.keys()].sort(),
    [
      'api.bgm.tv',
      'api.dmm.com',
      'api.themoviedb.org',
      'api.vndb.org',
      'graphql.anilist.co',
      'musicbrainz.org',
      'nhentai.net',
      'store.steampowered.com',
      'www.dlsite.com',
    ].sort()
  )
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

test('R-424: only the chosen sources are asked; an empty choice is rejected; a key-less TMDB or FANZA is still skipped', async () => {
  const hosts = (seen: { url: string }[]) => seen.map((r) => new URL(r.url).hostname).sort()
  const seen: { url: string; body: any }[] = []
  const some = await searchSources('Ever17', searchFetcher(seen), ['ja'], {
    sources: ['vndb', 'steam'],
  })
  assert.deepEqual(hosts(seen), ['api.vndb.org', 'store.steampowered.com'])
  assert.deepEqual([...new Set(some.candidates.map((c) => c.provider))].sort(), ['steam', 'vndb'])
  const keyless: { url: string; body: any }[] = []
  await searchSources('Ever17', searchFetcher(keyless), ['ja'], {
    sources: ['vndb', 'tmdb', 'fanza'],
    keyFor: async () => undefined,
  })
  assert.deepEqual(hosts(keyless), ['api.vndb.org'])
  const keyed: { url: string; body: any }[] = []
  await searchSources('Ever17', searchFetcher(keyed), ['ja'], {
    sources: ['tmdb', 'fanza'],
    keyFor: async () => ({ token: 't', apiId: 'a', affiliateId: 'b' }),
  })
  assert.deepEqual(hosts(keyed), ['api.dmm.com', 'api.themoviedb.org'])
  const none: { url: string; body: any }[] = []
  await assert.rejects(searchSources('Ever17', searchFetcher(none), ['ja'], { sources: [] }))
  assert.equal(none.length, 0)
})

test('R-424: the search request accepts only known source ids', () => {
  const base = { action: 'metadataSearch', query: 'Ever17' }
  assert.equal(isExplorerRequest({ ...base, sources: ['vndb', 'dlsite'] }), true)
  assert.equal(isExplorerRequest({ ...base, sources: [] }), true)
  assert.equal(isExplorerRequest({ ...base, sources: ['vndb', 'nope'] }), false)
  assert.equal(isExplorerRequest({ ...base, sources: ['eh'] }), false)
  assert.equal(isExplorerRequest({ ...base, sources: 'vndb' }), false)
  assert.equal(isExplorerRequest({ ...base, sources: new Array(10).fill('vndb') }), false)
})

test('R-424: the default ticks follow the folder kind', () => {
  assert.deepEqual(defaultSearchSources('game'), ['vndb', 'steam', 'dlsite'])
  assert.deepEqual(defaultSearchSources('video'), ['tmdb', 'anilist'])
  assert.deepEqual(defaultSearchSources('music'), ['musicbrainz'])
  assert.deepEqual(defaultSearchSources('book'), ['anilist', 'bangumi', 'nhentai', 'dlsite'])
  assert.deepEqual(defaultSearchSources('general'), [...searchableSources])
})
