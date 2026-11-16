import { SourceError } from '../metadata-common'
import { clean, type Adapter, type Site } from './site'

const UUID = '([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})'
type Credit = { name?: unknown }

// R-395: a recording's length in milliseconds is kept as text, "m:ss" (or "h:mm:ss").
export function lengthText(ms: unknown) {
  // A track longer than a day is not a real length.
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0 || ms > 86_400_000) return ''
  const total = Math.round(ms / 1000),
    s = String(total % 60).padStart(2, '0'),
    m = Math.floor(total / 60) % 60,
    h = Math.floor(total / 3600)
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

async function recording(site: Site): Promise<ReturnType<Adapter>> {
  const id = site.match(new RegExp('^/recording/' + UUID + '/?$', 'i'))[1].toLowerCase()
  const data = await site.json(
    'https://musicbrainz.org/ws/2/recording/' + id + '?inc=artist-credits+releases&fmt=json'
  )
  if (data.id !== id) throw new SourceError('notFound')
  site.list(
    'ARTISTS',
    data['artist-credit']?.map((artist: Credit) => artist?.name)
  )
  site.text('DURATION', lengthText(data.length))
  site.text('FIRST_RELEASE', data.releases?.[0]?.title)
  site.text('RELEASE_DATE', data['first-release-date'] || data.releases?.[0]?.date)
  return { title: clean(data.title), canonical: 'https://musicbrainz.org/recording/' + id }
}

async function artist(site: Site): Promise<ReturnType<Adapter>> {
  const id = site.match(new RegExp('^/artist/' + UUID + '/?$', 'i'))[1].toLowerCase()
  const data = await site.json('https://musicbrainz.org/ws/2/artist/' + id + '?fmt=json')
  if (data.id !== id) throw new SourceError('notFound')
  site.text('ARTIST_TYPE', data.type)
  site.text('COUNTRY', data.country)
  site.text('BEGIN_DATE', data['life-span']?.begin)
  site.text('END_DATE', data['life-span']?.end)
  site.text('DISAMBIGUATION', data.disambiguation)
  return { title: clean(data.name), canonical: 'https://musicbrainz.org/artist/' + id }
}

export const musicbrainz: Adapter = async (site) => {
  if (/^\/recording\//i.test(site.input.pathname)) return recording(site)
  if (/^\/artist\//i.test(site.input.pathname)) return artist(site)
  const id = site.match(new RegExp('^/release/' + UUID + '/?$', 'i'))[1].toLowerCase()
  const data = await site.json(
    'https://musicbrainz.org/ws/2/release/' + id + '?inc=artist-credits+recordings&fmt=json'
  )
  if (data.id !== id) throw new SourceError('notFound')
  site.text('RELEASE_DATE', data.date)
  site.text('COUNTRY', data.country)
  site.text('BARCODE', data.barcode)
  site.list(
    'ARTISTS',
    data['artist-credit']?.map((artist: Credit) => artist?.name)
  )
  site.list(
    'TRACKS',
    data.media?.flatMap(
      (medium: { tracks?: { title?: unknown }[] }) =>
        medium.tracks?.map((track) => track.title) ?? []
    )
  )
  return { title: clean(data.title), canonical: 'https://musicbrainz.org/release/' + id }
}
