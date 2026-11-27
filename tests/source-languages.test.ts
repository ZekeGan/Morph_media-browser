import assert from 'node:assert/strict'
import { test } from 'node:test'

import { metadata } from '../electron/metadata'
import { pickByLanguage, pickFromMap, tmdbLanguage } from '../electron/sources/language'
import { VN_FIRST_WORK } from '../electron/sources/vndb'
import { tinyPng } from './support/archive-fixture'

// R-381 / R-393: external sources by preferred language, VNDB releases, MusicBrainz albums and covers. Every request
// is answered by a fixed reply; nothing touches the network.
type Reply = { status?: number; headers?: Record<string, string>; body?: unknown }

function mock(handler: (url: string, body: any) => Reply | undefined, seen: string[] = []) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    seen.push(url)
    assert.equal(new Headers(init?.headers).has('Authorization'), false)
    assert.doesNotMatch(String(new Headers(init?.headers).get('User-Agent')), /@|\\|[A-Z]:\//)
    const reply = handler(url, init?.body ? JSON.parse(String(init.body)) : undefined)
    if (!reply) return new Response('', { status: 404 })
    if (Buffer.isBuffer(reply.body)) {
      return new Response(new Uint8Array(reply.body), {
        status: reply.status ?? 200,
        headers: reply.headers,
      })
    }
    const body = reply.body
    return new Response(typeof body === 'string' ? body : JSON.stringify(body ?? ''), {
      status: reply.status ?? 200,
      headers: reply.headers ?? { 'Content-Type': 'application/json' },
    })
  }) as typeof fetch
}

const value = (item: { preview: { values: { key: string; value: unknown }[] } }, key: string) =>
  item.preview.values.find((v) => v.key === key)?.value

test('language choice: the first preferred language the source has, closest code first', () => {
  const titles = [
    { lang: 'en', title: 'English' },
    { lang: 'zh-Hans', title: '简体' },
    { lang: 'zh-Hant', title: '繁體' },
    { lang: 'ja-ro', title: 'Romaji' },
  ]
  const pick = (languages: string[]) =>
    pickByLanguage(titles, (item) => item.lang, languages)?.title
  assert.equal(pick(['zh-TW', 'en']), '繁體')
  assert.equal(pick(['zh-CN']), '简体')
  assert.equal(pick(['ja', 'en']), 'English', 'ja-ro is Romaji, not Japanese: next language wins')
  assert.equal(pick(['es']), undefined, 'no preferred language: the adapter keeps its default')
  assert.equal(pick([]), undefined)
  assert.equal(pickFromMap({ en: 'A', ja_jp: 'B' }, ['ja'], { ja_jp: 'ja' }), 'B')
  assert.equal(pickFromMap(undefined, ['ja']), undefined)
  assert.equal(tmdbLanguage('zh-TW'), 'zh-TW')
  assert.equal(tmdbLanguage(undefined), 'en-US')
})

test('R-381: a VNDB work takes its title in the preferred language, else VNDB default; R-393: its picture, any rating', async () => {
  const asked: any[] = []
  const fetcher = mock((url, body) => {
    if (url === 'https://api.vndb.org/kana/vn') {
      asked.push(body)
      return {
        body: {
          results: [
            {
              id: 'v17',
              title: 'Default Title',
              titles: [
                { lang: 'ja', title: '日本語題' },
                { lang: 'zh-Hant', title: '繁中題' },
              ],
              image: { url: 'https://t.vndb.org/cv/12/345.jpg' },
            },
          ],
        },
      }
    }
    if (url === 'https://t.vndb.org/cv/12/345.jpg') return { body: tinyPng }
  })
  const zh = await metadata('https://vndb.org/v17', fetcher, undefined, { languages: ['zh-TW'] })
  assert.equal(zh.preview.title, '繁中題')
  assert.ok(zh.cover && zh.preview.image?.startsWith('data:image/png'))
  assert.match(asked[0].fields, /image\.url/)
  assert.doesNotMatch(
    asked[0].fields,
    /image\.(sexual|violence)/,
    'the picture is taken at any rating'
  )
  const es = await metadata('https://vndb.org/v17', fetcher, undefined, { languages: ['es'] })
  assert.equal(es.preview.title, 'Default Title')
})

test('R-393: a VNDB release address uses the release for title, date, platforms and languages, the work for the rest', async () => {
  const seen: string[] = []
  const reply = (works: { id: string; title: string }[]) =>
    mock((url, body) => {
      if (url === 'https://api.vndb.org/kana/release') {
        assert.deepEqual(body.filters, ['id', '=', 'r456'])
        return {
          body: {
            results: [
              {
                id: 'r456',
                title: 'Release Title',
                released: '2005-06-07',
                platforms: ['win'],
                languages: [
                  { lang: 'en', title: 'English Release' },
                  { lang: 'ja', title: '日本版' },
                ],
                vns: works,
              },
            ],
          },
        }
      }
      if (url === 'https://api.vndb.org/kana/vn') {
        assert.deepEqual(body.filters, ['id', '=', works[0].id])
        return {
          body: {
            results: [
              {
                id: works[0].id,
                description: 'About the work',
                developers: [{ name: 'Maker' }],
                image: { url: 'https://t.vndb.org/cv/99/9.jpg' },
              },
            ],
          },
        }
      }
      if (url === 'https://t.vndb.org/cv/99/9.jpg') return { body: tinyPng }
    }, seen)
  const one = await metadata(
    'https://vndb.org/r456',
    reply([{ id: 'v9', title: 'The Work' }]),
    undefined,
    { languages: ['ja'] }
  )
  assert.equal(one.preview.title, '日本版')
  assert.equal(one.preview.source, 'https://vndb.org/r456')
  assert.equal(value(one, 'RELEASE_DATE'), '2005-06-07')
  assert.deepEqual(value(one, 'PLATFORMS'), ['win'])
  assert.deepEqual(value(one, 'LANGUAGES'), ['en', 'ja'])
  assert.equal(value(one, 'DESCRIPTION'), 'About the work')
  assert.deepEqual(value(one, 'DEVELOPERS'), ['Maker'])
  assert.ok(one.cover)
  assert.equal(value(one, 'WORK_NOTE'), undefined)
  const many = await metadata(
    'https://vndb.org/r456',
    reply([
      { id: 'v9', title: 'The Work' },
      { id: 'v10', title: 'Another' },
    ]),
    undefined,
    { languages: ['es'] }
  )
  assert.equal(many.preview.title, 'Release Title'.replace('Release Title', 'Release Title'))
  assert.equal(value(many, 'WORK_NOTE'), VN_FIRST_WORK)
  assert.equal(value(many, 'FIRST_WORK'), 'The Work')
  assert.ok(seen.every((url) => /^https:\/\/(api|t)\.vndb\.org\//.test(url)))
  await assert.rejects(
    metadata(
      'https://vndb.org/r456',
      mock(() => ({ body: { results: [] } }))
    ),
    /找不到/
  )
})

test('R-393: MusicBrainz release-group (type, first release, genres) with the Cover Art Archive cover through archive.org', async () => {
  const id = '11111111-2222-3333-4444-555555555555'
  const seen: string[] = []
  const fetcher = mock((url) => {
    if (url.startsWith('https://musicbrainz.org/ws/2/release-group/' + id)) {
      assert.match(url, /inc=artist-credits\+aliases\+genres\+tags/)
      return {
        body: {
          id,
          title: 'Album',
          'primary-type': 'Album',
          'secondary-types': ['Soundtrack'],
          'first-release-date': '2004-03-04',
          'artist-credit': [{ name: 'Band' }],
          genres: [{ name: 'rock' }],
          tags: [{ name: 'indie' }],
          aliases: [
            { name: 'アルバム', locale: 'ja', primary: true },
            { name: 'ignored', locale: 'en', primary: false },
          ],
        },
      }
    }
    if (url === `https://coverartarchive.org/release-group/${id}/front-500`) {
      return { status: 307, headers: { location: 'https://archive.org/download/x/y.png' } }
    }
    if (url === 'https://archive.org/download/x/y.png') {
      return { status: 302, headers: { location: 'https://ia800000.us.archive.org/1/y.png' } }
    }
    if (url === 'https://ia800000.us.archive.org/1/y.png') return { body: tinyPng }
  }, seen)
  const ja = await metadata('https://musicbrainz.org/release-group/' + id, fetcher, undefined, {
    languages: ['ja'],
  })
  assert.equal(ja.preview.title, 'アルバム')
  assert.equal(value(ja, 'ALBUM_TYPE'), 'Album / Soundtrack')
  assert.equal(value(ja, 'RELEASE_DATE'), '2004-03-04')
  assert.deepEqual(value(ja, 'ARTISTS'), ['Band'])
  assert.deepEqual(value(ja, 'GENRES'), ['rock'])
  assert.deepEqual(value(ja, 'TAGS'), ['indie'])
  assert.ok(ja.cover, 'the cover was downloaded through the two redirects')
  const en = await metadata('https://musicbrainz.org/release-group/' + id, fetcher, undefined, {
    languages: ['en'],
  })
  assert.equal(en.preview.title, 'Album', 'only a primary alias is used')
})

test('R-393: a Cover Art Archive redirect to any other host, or a missing cover, only drops the cover', async () => {
  const id = '11111111-2222-3333-4444-555555555555'
  const data = { id, title: 'Album' }
  const to = (location: string) =>
    mock((url) => {
      if (url.startsWith('https://musicbrainz.org/ws/2/release-group/')) return { body: data }
      if (url.startsWith('https://coverartarchive.org/')) {
        return { status: 307, headers: { location } }
      }
      assert.fail('the redirect target must not be requested: ' + url)
    })
  for (const location of [
    'https://evil.example/y.png',
    'http://archive.org/y.png',
    'https://archive.org.evil.example/y.png',
    'https://archive.org:8443/y.png',
  ]) {
    const result = await metadata('https://musicbrainz.org/release-group/' + id, to(location))
    assert.equal(result.cover, undefined, location)
    assert.ok(value(result, 'COVER_STATUS'))
  }
  const none = await metadata(
    'https://musicbrainz.org/release-group/' + id,
    mock((url) =>
      url.startsWith('https://musicbrainz.org/') ? { body: data } : { status: 404, body: '' }
    )
  )
  assert.equal(none.cover, undefined)
  assert.equal(none.preview.title, 'Album')
})

test('R-393: a MusicBrainz release adds label, catalogue number, discs, format, genres and the track list', async () => {
  const id = '66666666-7777-8888-9999-000000000000'
  const fetcher = mock((url) => {
    if (url.startsWith('https://musicbrainz.org/ws/2/release/' + id)) {
      assert.match(url, /inc=artist-credits\+recordings\+labels\+media\+genres\+tags/)
      return {
        body: {
          id,
          title: 'Album',
          barcode: '4900000000000',
          'label-info': [{ 'catalog-number': 'ABC-123', label: { name: 'Records' } }],
          genres: [{ name: 'pop' }],
          media: [
            {
              format: 'CD',
              tracks: [
                { number: '1', title: 'One', length: 61000 },
                { number: '2', title: 'Two', length: null },
              ],
            },
            { format: 'CD', tracks: [{ number: '1', title: 'Three', length: 3_725_000 }] },
          ],
        },
      }
    }
    if (url === `https://coverartarchive.org/release/${id}/front-500`) return { body: tinyPng }
  })
  const result = await metadata('https://musicbrainz.org/release/' + id, fetcher)
  assert.deepEqual(value(result, 'LABEL'), ['Records'])
  assert.deepEqual(value(result, 'CATALOG_NUMBER'), ['ABC-123'])
  assert.equal(value(result, 'DISC_COUNT'), 2)
  assert.deepEqual(value(result, 'MEDIA_FORMAT'), ['CD'])
  assert.equal(value(result, 'TRACK_COUNT'), 3)
  assert.deepEqual(value(result, 'TRACKS'), ['One', 'Two', 'Three'])
  assert.deepEqual(value(result, 'TRACK_LIST'), [
    '1-1 One (1:01)',
    '1-2 Two',
    '2-1 Three (1:02:05)',
  ])
  assert.deepEqual(value(result, 'GENRES'), ['pop'])
  assert.ok(result.cover)
})

test('R-381: Bangumi, AniList and MangaDex follow the preferred language and keep their default otherwise', async () => {
  const bangumi = mock((url) =>
    url === 'https://api.bgm.tv/v0/subjects/5'
      ? { body: { id: 5, name: '原題', name_cn: '中文題' } }
      : undefined
  )
  const title = async (languages: string[]) =>
    (await metadata('https://bgm.tv/subject/5', bangumi, undefined, { languages })).preview.title
  assert.equal(await title(['ja', 'zh-TW']), '原題')
  assert.equal(await title(['zh-CN']), '中文題')
  assert.equal(await title([]), '中文題', 'the site default')
  const anilist = mock((url) =>
    url === 'https://graphql.anilist.co/'
      ? {
          body: {
            data: {
              Media: { id: 7, title: { native: 'ネイティブ', english: 'English', romaji: 'Roma' } },
            },
          },
        }
      : undefined
  )
  const ani = async (languages: string[]) =>
    (await metadata('https://anilist.co/anime/7', anilist, undefined, { languages })).preview.title
  assert.equal(await ani(['en']), 'English')
  assert.equal(await ani(['es', 'ja']), 'ネイティブ')
  assert.equal(await ani([]), 'ネイティブ')
  const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const dex = mock((url) =>
    url.startsWith('https://api.mangadex.org/manga/' + uuid)
      ? {
          body: {
            data: {
              id: uuid,
              attributes: {
                title: { en: 'English Title' },
                altTitles: [{ ja: '日本語題' }, { 'zh-hk': '港題' }],
                description: { en: 'EN', ja: 'JA' },
              },
            },
          },
        }
      : undefined
  )
  const read = (languages: string[]) =>
    metadata('https://mangadex.org/title/' + uuid, dex, undefined, { languages })
  const ja = await read(['ja'])
  assert.equal(ja.preview.title, '日本語題')
  assert.equal(value(ja, 'DESCRIPTION'), 'JA')
  assert.equal((await read(['zh-TW'])).preview.title, '港題')
  assert.equal((await read([])).preview.title, 'English Title')
})

test('R-420: DLsite and iTunes follow the first preferred language; a text in none of them gets a notice', async () => {
  const seen: string[] = []
  const dl = mock((url) => {
    if (url.includes('product.json')) {
      return { body: [{ workno: 'RJ173356', work_name: 'タイトル', intro_s: 'これは説明です' }] }
    }
    return { body: {} }
  }, seen)
  const address = 'https://www.dlsite.com/maniax/work/=/product_id/RJ173356.html'
  const noticeOf = (result: Awaited<ReturnType<typeof metadata>>) =>
    value(result, 'LANGUAGE_NOTICE')
  const en = await metadata(address, dl, undefined, { languages: ['zh-TW', 'en'] })
  assert.ok(seen.length >= 2 && seen.every((url) => url.includes('&locale=zh_TW')), seen.join())
  assert.equal(noticeOf(en), 'zh-TW,en|ja', 'Japanese text, none of the preferred languages')
  assert.equal(value(en, 'DESCRIPTION'), 'これは説明です')
  const ja = await metadata(address, dl, undefined, { languages: ['zh-TW', 'ja'] })
  assert.equal(noticeOf(ja), undefined)
  seen.length = 0
  const none = await metadata(address, dl)
  assert.ok(seen.length >= 1 && seen.every((url) => !url.includes('locale')), seen.join())
  assert.equal(noticeOf(none), undefined, 'no preference: no notice')

  const apple = mock((url) => {
    if (url.startsWith('https://itunes.apple.com/lookup')) {
      return {
        body: {
          results: [{ wrapperType: 'collection', collectionId: 5, collectionName: 'Album' }],
        },
      }
    }
  }, seen)
  seen.length = 0
  await metadata('https://music.apple.com/jp/album/x/id5', apple, undefined, { languages: ['ja'] })
  assert.match(seen[0], /country=jp&lang=ja_jp$/)
  seen.length = 0
  await metadata('https://music.apple.com/jp/album/x/id5', apple)
  assert.doesNotMatch(seen[0], /lang=/)
})
