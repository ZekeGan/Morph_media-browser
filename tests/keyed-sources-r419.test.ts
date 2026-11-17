import { test } from 'node:test'
import assert from 'node:assert/strict'
import { metadata } from '../electron/metadata'
import { searchSources } from '../electron/sources/search'
import { TMDB_EPISODES_MAX, TMDB_SEASONS_MAX } from '../electron/sources/keyed'

// R-419: TMDB in the name search (only with a key), TMDB series seasons and episodes, SteamGridDB hero/logo/icon.
// Every request is answered by a fixed reply; nothing touches the network.
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const value = (item: { preview: { values: { key: string; value: unknown }[] } }, key: string) =>
  item.preview.values.find((v) => v.key === key)?.value
const keyFor = (keys?: Record<string, string>) => async (site: string) =>
  site === 'tmdb' ? keys : undefined

test('R-419: TMDB joins the name search only with a key, and its failure is noted like another source', async () => {
  const seen: { url: string; auth: string | null }[] = []
  const fetcher = ((fail: boolean) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input),
        host = new URL(url).hostname
      seen.push({ url, auth: new Headers(init?.headers).get('Authorization') })
      if (host !== 'api.themoviedb.org') return json({})
      if (fail) return json({}, 401)
      return json({
        results: [
          { media_type: 'movie', id: 12, title: 'Movie', release_date: '2001-01-01' },
          { media_type: 'tv', id: 34, name: 'Series', first_air_date: '2010-05-05' },
          { media_type: 'person', id: 56, name: 'Somebody' },
          { media_type: 'movie', id: 'x1', title: 'Bad id' },
        ],
      })
    }) as typeof fetch)(false)
  const none = await searchSources('Series', fetcher, ['zh-TW'], { keyFor: keyFor(undefined) })
  assert.ok(!none.candidates.some((c) => c.provider === 'tmdb'))
  assert.deepEqual(none.failedSources, [], 'no key: left out with no note')
  assert.ok(!seen.some((r) => r.url.includes('themoviedb')))
  const plain = await searchSources('Series', fetcher, ['zh-TW'], {
    keyFor: keyFor({ token: 'abc' }),
  })
  assert.deepEqual(
    plain.candidates.filter((c) => c.provider === 'tmdb').map((c) => [c.title, c.detail, c.url]),
    [
      ['Movie', '2001', 'https://www.themoviedb.org/movie/12'],
      ['Series', '2010 · TV', 'https://www.themoviedb.org/tv/34'],
    ]
  )
  const request = seen.find((r) => r.url.includes('themoviedb'))!
  assert.match(
    request.url,
    /search\/multi\?include_adult=false&language=zh-TW&query=Series&api_key=abc$/
  )
  assert.equal(request.auth, null)
  seen.length = 0
  await searchSources('Series', fetcher, [], { keyFor: keyFor({ token: 'eyJabc' }) })
  const bearer = seen.find((r) => r.url.includes('themoviedb'))!
  assert.equal(bearer.auth, 'Bearer eyJabc')
  assert.doesNotMatch(bearer.url, /api_key/)
  const failing = await searchSources(
    'Series',
    (async (input: RequestInfo | URL) =>
      new URL(String(input)).hostname === 'api.themoviedb.org'
        ? json({}, 401)
        : json({})) as typeof fetch,
    [],
    { keyFor: keyFor({ token: 'abc' }) }
  )
  assert.deepEqual(failing.failedSources, ['tmdb'])
})

test('R-419: a TMDB series lists its seasons and episodes; a failed season is skipped and the lists are capped', async () => {
  const asked: string[] = []
  const seasonList = Array.from({ length: 40 }, (_, i) => ({ season_number: i }))
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input)
    asked.push(url)
    assert.equal(new URL(url).hostname, 'api.themoviedb.org')
    const season = /\/season\/(\d+)\?/.exec(url)?.[1]
    if (!season)
      return json({
        id: 7,
        name: 'Show',
        number_of_seasons: 40,
        number_of_episodes: 9,
        seasons: seasonList,
      })
    if (season === '2') return json({}, 500)
    if (season === '1')
      return json({
        episodes: [
          { episode_number: 1, name: 'Pilot' },
          { episode_number: 2, name: '' },
          { episode_number: 'x', name: 'Skipped' },
        ],
      })
    // Every other season is long enough to pass the cap on its own.
    return json({
      episodes: Array.from({ length: 100 }, (_, i) => ({ episode_number: i + 1, name: 'E' + i })),
    })
  }) as typeof fetch
  const result = await metadata('https://www.themoviedb.org/tv/7-show', fetcher, undefined, {
    keyFor: keyFor({ token: 'abc' }),
    languages: ['ja'],
  })
  assert.equal(value(result, 'SEASON_COUNT'), 40)
  const episodes = value(result, 'EPISODES') as string[]
  assert.deepEqual(episodes.slice(0, 2), ['S01E01 Pilot', 'S01E02'])
  assert.equal(
    episodes[2],
    'S03E01 E0',
    'season 2 failed and is skipped; season 0 (specials) is not asked'
  )
  assert.equal(episodes.length, TMDB_EPISODES_MAX)
  const seasonRequests = asked.filter((url) => url.includes('/season/'))
  assert.equal(seasonRequests.length, TMDB_SEASONS_MAX)
  assert.ok(seasonRequests.every((url) => url.includes('language=ja-JP')))
  assert.ok(!asked.some((url) => url.includes('/season/0')))
  // A movie never asks for seasons.
  asked.length = 0
  await metadata(
    'https://www.themoviedb.org/movie/7',
    (async (input: RequestInfo | URL) => {
      asked.push(String(input))
      return json({ id: 7, title: 'Film' })
    }) as typeof fetch,
    undefined,
    { keyFor: keyFor({ token: 'abc' }) }
  )
  assert.equal(asked.length, 1)
})

test('R-419: SteamGridDB hero, logo and icon are optional and kept only on the picture host', async () => {
  const host = 'https://cdn2.steamgriddb.com/'
  const fetcher = ((answers: Record<string, unknown>) =>
    (async (input: RequestInfo | URL) => {
      const url = String(input)
      assert.equal(new URL(url).hostname, 'www.steamgriddb.com')
      if (url.endsWith('/games/id/5')) return json({ success: true, data: { id: 5, name: 'Game' } })
      const kind = /api\/v2\/(\w+)\/game\/5/.exec(url)?.[1] ?? ''
      return kind in answers ? json({ data: [{ url: answers[kind] }] }) : json({}, 404)
    }) as typeof fetch)({
    grids: host + 'grid.png',
    heroes: host + 'hero.png',
    logos: 'https://evil.test/logo.png',
    // icons: no reply at all
  })
  const result = await metadata('https://www.steamgriddb.com/game/5', fetcher, undefined, {
    keyFor: async () => ({ apiKey: 'k' }),
  })
  assert.equal(value(result, 'HERO_URL'), host + 'hero.png')
  assert.equal(
    value(result, 'LOGO_URL'),
    undefined,
    'a picture host that is not SteamGridDB is dropped'
  )
  assert.equal(value(result, 'ICON_URL'), undefined, 'a failed lookup only leaves the field out')
  assert.equal(result.preview.title, 'Game')
})
