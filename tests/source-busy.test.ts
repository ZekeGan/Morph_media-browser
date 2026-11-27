import assert from 'node:assert/strict'
import { test } from 'node:test'

import { busyWait, SourceError, sourceRequest } from '../electron/metadata-common'
import { musicBrainzTurn, pace } from '../electron/sources/musicbrainz'
import { searchSources } from '../electron/sources/search'

// R-461: a site that refuses too many requests (429, or 503 as MusicBrainz answers it) is asked once more after the
// wait it gives; a reply that does not come in time is "slow". Both used to read as "cannot connect".
busyWait.default = 20
busyWait.max = 50
const reply = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 200 ? '{"ok":true}' : '', { status, headers })

test('R-461: a busy site is asked once more and its answer used', async () => {
  let calls = 0
  const bytes = await sourceRequest(
    (async () => (++calls === 1 ? reply(503, { 'Retry-After': '0' }) : reply(200))) as typeof fetch,
    'https://musicbrainz.org/ws/2/x',
    {}
  )
  assert.equal(calls, 2)
  assert.equal(bytes.toString(), '{"ok":true}')
})

test('R-461: still busy after the second try, it says so instead of "cannot connect"', async () => {
  let calls = 0
  await assert.rejects(
    sourceRequest(
      (async () => {
        calls++
        return reply(429)
      }) as typeof fetch,
      'https://example.org/',
      {}
    ),
    (error) => error instanceof SourceError && error.kind === 'busy'
  )
  assert.equal(calls, 2, 'asked twice, not more')
  // Other errors are not asked again.
  calls = 0
  await assert.rejects(
    sourceRequest(
      (async () => {
        calls++
        return reply(500)
      }) as typeof fetch,
      'https://example.org/',
      {}
    ),
    (error) => error instanceof SourceError && error.kind === 'offline'
  )
  assert.equal(calls, 1)
})

test('R-461: a busy site whose wait outlasts the time limit is still reported as busy', async () => {
  let calls = 0
  await assert.rejects(
    sourceRequest(
      (async () => {
        calls++
        return reply(503, { 'Retry-After': '5' })
      }) as typeof fetch,
      'https://example.org/',
      { signal: AbortSignal.timeout(20) }
    ),
    (error) => error instanceof SourceError && error.kind === 'busy'
  )
  assert.equal(calls, 1, 'not asked again once the time is up')
})

test('R-461: running out of time is "slow", a refused connection "offline"', async () => {
  await assert.rejects(
    sourceRequest(
      ((_url: unknown, init?: RequestInit) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(init.signal!.reason))
        )) as typeof fetch,
      'https://example.org/',
      { signal: AbortSignal.timeout(30) }
    ),
    (error) => error instanceof SourceError && error.kind === 'slow'
  )
  await assert.rejects(
    sourceRequest(
      (async () => {
        throw new TypeError('fetch failed')
      }) as typeof fetch,
      'https://example.org/',
      {}
    ),
    (error) => error instanceof SourceError && error.kind === 'offline'
  )
})

test('R-461: a MusicBrainz name search and a preview request wait their turn, one a second', async (t) => {
  const before = pace.ms
  pace.ms = 150
  t.after(() => {
    pace.ms = before
  })
  const times: number[] = []
  const fetcher = (async (input: RequestInfo | URL) => {
    times.push(Date.now())
    assert.equal(new URL(String(input)).hostname, 'musicbrainz.org')
    return new Response(JSON.stringify({ 'release-groups': [] }), { status: 200 })
  }) as typeof fetch
  // A preview's request and a search sent at the same moment.
  await Promise.all([
    musicBrainzTurn(async () => {
      times.push(Date.now())
    }),
    searchSources('Album', fetcher, [], { sources: ['musicbrainz'] }),
  ])
  assert.equal(times.length, 2)
  assert.ok(times[1] - times[0] >= 140, 'the second waited for the first: ' + (times[1] - times[0]))
})
