import assert from 'node:assert/strict'
import { test } from 'node:test'

import { parseDate } from '../shared/fields'

import { metadata } from '../electron/metadata'
import { steamLanguage } from '../electron/sources/language'
import { tinyPng } from './support/archive-fixture'

// R-418: VNDB tags, play time, rating, links, engine and screenshots; Steam in the preferred language with screenshots.
// Every request is answered by a fixed reply; nothing touches the network.
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
const value = (item: { preview: { values: { key: string; value: unknown }[] } }, key: string) =>
  item.preview.values.find((v) => v.key === key)?.value

const vnReply = {
  id: 'v17',
  title: 'Ever17',
  length_minutes: 1980,
  rating: 84.54,
  votecount: 8839,
  tags: [
    { name: 'Mystery', rating: 2.7, spoiler: 0, lie: false },
    { name: 'Fear of Death', rating: 2.3, spoiler: 0, lie: false },
    { name: 'Hidden Twist', rating: 3, spoiler: 2, lie: false },
    { name: 'Minor Spoiler', rating: 2.9, spoiler: 1, lie: false },
    { name: 'Not True', rating: 2.8, spoiler: 0, lie: true },
    { name: 'ESP', rating: 2.9, spoiler: 0, lie: false },
  ],
  extlinks: [
    { name: 'steam', url: 'https://store.steampowered.com/app/123/' },
    { name: 'dlsite', url: 'https://www.dlsite.com/pro/work/=/product_id/VJ1.html' },
    { name: 'website', url: 'http://example.com/game' },
    { name: 'steam', url: 'https://evil.test/app/1/' },
    { name: 'wikidata', url: 'https://www.wikidata.org/wiki/Q1' },
  ],
  screenshots: [
    { url: 'https://t.vndb.org/sf/90/190.jpg', sexual: 0, violence: 0 },
    { url: 'https://t.vndb.org/sf/91/191.jpg', sexual: 2, violence: 0 },
    { url: 'https://t.vndb.org/sf/92/192.jpg', sexual: 0, violence: 1 },
    { url: 'https://evil.test/x.jpg', sexual: 0, violence: 0 },
  ],
}

test('R-418: a VNDB work adds visible tags, play time, rating, links, engine and safe screenshot addresses', async () => {
  const asked: { url: string; body: any }[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    asked.push({ url, body })
    if (url === 'https://api.vndb.org/kana/vn') return json({ results: [vnReply] })
    if (url === 'https://api.vndb.org/kana/release') {
      return json({
        results: [
          { engine: 'KID Engine' },
          { engine: null },
          { engine: 'MAGES. Engine' },
          { engine: 'KID Engine' },
        ],
      })
    }
    return new Response('', { status: 404 })
  }) as typeof fetch
  const result = await metadata('https://vndb.org/v17', fetcher)
  assert.deepEqual(
    value(result, 'TAGS'),
    ['ESP', 'Mystery', 'Fear of Death'],
    'no spoiler, no lie; best rated first'
  )
  assert.equal(value(result, 'PLAY_MINUTES'), 1980)
  assert.equal(value(result, 'RATING'), 8.5)
  assert.equal(value(result, 'RATING_COUNT'), 8839)
  assert.equal(value(result, 'STEAM_URL'), 'https://store.steampowered.com/app/123/')
  assert.equal(value(result, 'DLSITE_URL'), 'https://www.dlsite.com/pro/work/=/product_id/VJ1.html')
  assert.equal(value(result, 'OFFICIAL_URL'), 'http://example.com/game')
  assert.equal(value(result, 'ENGINE'), 'KID Engine')
  assert.deepEqual(value(result, 'SCREENSHOTS'), ['https://t.vndb.org/sf/90/190.jpg'])
  assert.match(asked[0].body.fields, /tags\{name,rating,spoiler,lie\}/)
  assert.deepEqual(asked[1].body.filters, ['vn', '=', ['id', '=', 'v17']])
})

test('R-418: a failed release lookup only leaves out the engine; a release address brings its own engine and links', async () => {
  const failing = (async (input: RequestInfo | URL) =>
    String(input).endsWith('/vn')
      ? json({ results: [{ id: 'v17', title: 'Ever17' }] })
      : new Response('', { status: 500 })) as typeof fetch
  const one = await metadata('https://vndb.org/v17', failing)
  assert.equal(one.preview.title, 'Ever17')
  assert.equal(value(one, 'ENGINE'), undefined)
  const fetcher = (async (input: RequestInfo | URL) => {
    if (String(input).endsWith('/release')) {
      return json({
        results: [
          {
            id: 'r5',
            title: 'Rel',
            engine: "Ren'Py",
            extlinks: [{ name: 'steam', url: 'https://store.steampowered.com/app/9/' }],
            vns: [],
          },
        ],
      })
    }
    return new Response('', { status: 404 })
  }) as typeof fetch
  const release = await metadata('https://vndb.org/r5', fetcher)
  assert.equal(value(release, 'ENGINE'), "Ren'Py")
  assert.equal(value(release, 'STEAM_URL'), 'https://store.steampowered.com/app/9/')
})

test('R-418: Steam asks in the first preferred language, keeps the App ID and lists screenshots on Steam hosts only', async () => {
  const app = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/620/'
  const requests: string[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    requests.push(url)
    if (url.includes('/api/appdetails')) {
      return json({
        '620': {
          success: true,
          data: {
            steam_appid: 620,
            name: 'Portal 2',
            type: 'game',
            short_description: '簡介',
            genres: [{ description: '動作' }],
            release_date: { coming_soon: false, date: '2011 年 4 月 18 日' },
            header_image: app + 'header.jpg',
            screenshots: [
              { path_full: app + 'ss_a.1920x1080.jpg?t=1' },
              { path_full: 'https://evil.test/steam/apps/620/ss.jpg' },
              {
                path_full:
                  'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/730/ss.jpg',
              },
              { path_thumbnail: app + 'only-thumb.jpg' },
            ],
          },
        },
      })
    }
    return new Response(tinyPng)
  }) as typeof fetch
  const result = await metadata('620', fetcher, undefined, { languages: ['zh-TW', 'en'] })
  assert.ok(requests[0].endsWith('appids=620&l=tchinese'))
  assert.equal(value(result, 'APP_ID'), 620)
  assert.deepEqual(value(result, 'SCREENSHOTS'), [app + 'ss_a.1920x1080.jpg?t=1'])
  assert.ok(result.cover, 'the header image is the cover')
  assert.deepEqual(parseDate('2011 年 4 月 18 日'), { type: 'date', value: '2011-04-18' })
  await metadata('620', fetcher)
  assert.ok(
    requests
      .filter((url) => url.includes('appdetails'))
      .pop()
      ?.endsWith('l=english')
  )
  assert.deepEqual(['zh-TW', 'zh-CN', 'ja', 'en', 'es', undefined].map(steamLanguage), [
    'tchinese',
    'schinese',
    'japanese',
    'english',
    'spanish',
    'english',
  ])
})
