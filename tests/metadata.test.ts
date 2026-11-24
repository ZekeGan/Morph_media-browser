import { test } from 'node:test'
import assert from 'node:assert/strict'
import { metadata, steamMetadata } from '../electron/metadata'
test('ExHentai keeps its gallery identity while using the no-key metadata endpoint', async () => {
  const source = 'https://exhentai.org/g/12/abcdef0123/'
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://api.e-hentai.org/api.php')
    assert.deepEqual(JSON.parse(String(init?.body)).gidlist, [[12, 'abcdef0123']])
    assert.equal(new Headers(init?.headers).has('Authorization'), false)
    return new Response(
      JSON.stringify({
        gmetadata: [
          { gid: 12, token: 'abcdef0123', title: 'Example', title_jpn: '原文', tags: ['tag'] },
        ],
      })
    )
  }) as typeof fetch
  const result = await metadata(source, fetcher, 'exh')
  assert.equal(result.preview.provider, 'eh', 'E-Hentai and ExHentai share one provider')
  assert.equal(result.preview.source, source)
  assert.equal(result.preview.values.find((value) => value.key === 'GALLERY_URL')?.value, source)
  await assert.rejects(metadata(source, fetcher, 'eh'), /不符/)
})
test('E-Hentai tags are also split into one field per namespace', async () => {
  const source = 'https://e-hentai.org/g/12/abcdef0123/',
    tags = [
      'language:chinese',
      'language:translated',
      'artist:poriuretan',
      'female:ahegao',
      'female:x-ray',
      'male:condom',
      'other:mosaic censorship',
      'plain',
      'unknown:ignored',
      'female:',
    ]
  const fetcher = (async () =>
    new Response(
      JSON.stringify({ gmetadata: [{ gid: 12, token: 'abcdef0123', title: 'T', tags }] })
    )) as typeof fetch
  const { preview } = await metadata(source, fetcher, 'eh')
  const get = (key: string) => preview.values.find((value) => value.key === key)?.value
  assert.deepEqual(
    get('TAGS'),
    tags.filter((tag) => tag.length > 0),
    'the full list stays as it was'
  )
  assert.deepEqual(get('LANGUAGE'), ['chinese', 'translated'])
  assert.deepEqual(get('ARTIST'), ['poriuretan'])
  assert.deepEqual(get('FEMALE'), ['ahegao', 'x-ray'])
  assert.deepEqual(get('MALE'), ['condom'])
  assert.deepEqual(get('OTHER'), ['mosaic censorship'])
  assert.equal(get('PARODY'), undefined, 'a namespace with no tags gets no field')
  assert.equal(get('UNKNOWN'), undefined)
})
const payload = (overrides: Record<string, unknown> = {}) => ({
  '620': {
    success: true,
    data: {
      steam_appid: 620,
      name: 'Portal &amp; Test',
      type: 'game',
      developers: ['Valve'],
      publishers: ['Valve'],
      genres: [{ description: 'Puzzle' }],
      short_description: '<b>Test</b>',
      release_date: { coming_soon: false, date: '18 Apr, 2011' },
      header_image:
        'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/620/header.jpg',
      ...overrides,
    },
  },
})
test('Steam accepts official URL/App ID, keeps store date semantics and limits image hosts', async () => {
  const requests: string[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    requests.push(url)
    assert.equal(init?.redirect, 'error')
    return url.includes('/api/appdetails')
      ? new Response(JSON.stringify(payload()))
      : new Response(Buffer.from([255, 216, 255, 0]))
  }) as typeof fetch
  const result = await metadata('620', fetcher)
  assert.equal(result.preview.provider, 'steam')
  assert.equal(result.preview.title, 'Portal & Test')
  assert.equal(result.preview.source, 'https://store.steampowered.com/app/620/')
  assert.equal(
    result.preview.values.find((v) => v.key === 'STORE_RELEASE_DATE')?.value,
    '18 Apr, 2011'
  )
  assert.equal(result.preview.values.find((v) => v.key === 'DESCRIPTION')?.value, 'Test')
  assert.ok(result.cover)
  assert.ok(requests[0].includes('appids=620&l=english'))
  await steamMetadata('https://store.steampowered.com/app/620/Portal_2/?l=schinese', fetcher)
  for (const url of [
    'https://store.steampowered.com.evil.test/app/620/',
    'http://store.steampowered.com/app/620/',
    'https://user:pass@store.steampowered.com/app/620/',
    'https://store.steampowered.com:444/app/620/',
    'https://store.steampowered.com/sub/620/',
    '0',
    '4294967296',
  ]) {
    const count = requests.length
    await assert.rejects(steamMetadata(url, fetcher))
    assert.equal(requests.length, count)
  }
})
test('Steam rejects unavailable/mismatched/oversized replies and treats blocked cover as optional', async () => {
  for (const data of [
    { '620': { success: false } },
    payload({ steam_appid: 999 }),
    payload({ name: '' }),
  ])
    await assert.rejects(
      steamMetadata('620', (async () => new Response(JSON.stringify(data))) as typeof fetch)
    )
  await assert.rejects(
    steamMetadata('620', (async () => new Response('{}', { status: 429 })) as typeof fetch),
    // R-461: too many requests is its own message (asked once more first).
    /暫時拒絕過多的請求/
  )
  await assert.rejects(
    steamMetadata(
      '620',
      (async () =>
        new Response('{}', {
          headers: { 'content-length': String(3 * 1024 * 1024) },
        })) as typeof fetch
    ),
    /過大/
  )
  const requested: string[] = []
  const result = await steamMetadata('620', (async (input: RequestInfo | URL) => {
    requested.push(String(input))
    return new Response(
      JSON.stringify(
        payload({
          header_image: 'https://untrusted.test/private.jpg',
          release_date: { coming_soon: true, date: 'Coming soon' },
        })
      )
    )
  }) as typeof fetch)
  assert.equal(requested.length, 1)
  assert.equal(result.cover, undefined)
  assert.equal(result.preview.values.find((v) => v.key === 'RELEASE_STATUS')?.value, '尚未發售')
  assert.ok(result.preview.values.some((v) => v.key === 'COVER_STATUS'))
})
test('R-395: MusicBrainz recording and artist addresses read their own fixed API paths', async () => {
  const rec = 'e65c5269-17e5-4e0f-bb89-e130990de766',
    art = '9aed24f5-4293-4c5b-a7c9-1027c8d9d608',
    asked: string[] = [],
    fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input)
      asked.push(url)
      if (url.includes('/recording/'))
        return new Response(
          JSON.stringify({
            id: rec,
            title: 'Song',
            length: 245000,
            'artist-credit': [{ name: 'Singer' }],
            releases: [{ title: 'Album', date: '2001-02-03' }],
          })
        )
      return new Response(
        JSON.stringify({
          id: art,
          name: 'Singer',
          type: 'Person',
          country: 'JP',
          'life-span': { begin: '1990-01', end: null },
          disambiguation: 'the one',
        })
      )
    }) as typeof fetch,
    value = (r: Awaited<ReturnType<typeof metadata>>, key: string) =>
      r.preview.values.find((v) => v.key === key)?.value
  const song = await metadata('https://musicbrainz.org/recording/' + rec.toUpperCase(), fetcher)
  assert.equal(song.preview.title, 'Song')
  assert.equal(song.preview.source, 'https://musicbrainz.org/recording/' + rec)
  assert.equal(value(song, 'DURATION'), '4:05')
  assert.deepEqual(value(song, 'ARTISTS'), ['Singer'])
  assert.equal(value(song, 'FIRST_RELEASE'), 'Album')
  assert.equal(value(song, 'RELEASE_DATE'), '2001-02-03')
  const person = await metadata('https://musicbrainz.org/artist/' + art, fetcher)
  assert.equal(person.preview.title, 'Singer')
  assert.equal(value(person, 'ARTIST_TYPE'), 'Person')
  assert.equal(value(person, 'COUNTRY'), 'JP')
  assert.equal(value(person, 'BEGIN_DATE'), '1990-01')
  assert.equal(value(person, 'END_DATE'), undefined)
  assert.equal(value(person, 'DISAMBIGUATION'), 'the one')
  assert.deepEqual(asked, [
    `https://musicbrainz.org/ws/2/recording/${rec}?inc=artist-credits+releases+genres+tags&fmt=json`,
    `https://musicbrainz.org/ws/2/artist/${art}?inc=aliases+genres+tags&fmt=json`,
  ])
  // An id that is not a UUID never reaches the network.
  await assert.rejects(
    metadata('https://musicbrainz.org/recording/not-a-uuid', (async () => {
      throw new Error('MUST NOT FETCH')
    }) as typeof fetch),
    (error) => !String(error).includes('MUST NOT FETCH')
  )
  // A reply for a different id is refused.
  await assert.rejects(
    metadata(
      'https://musicbrainz.org/artist/' + art,
      (async () => new Response(JSON.stringify({ id: rec, name: 'X' }))) as typeof fetch
    )
  )
})
