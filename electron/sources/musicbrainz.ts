import { SourceError } from '../metadata-common'
import { clean, type Adapter, type Site } from './site'
import { pickByLanguage } from './language'

const UUID = '([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})'
type Credit = { name?: unknown }
type Named = { name?: unknown }
type Alias = { name?: unknown; locale?: unknown; primary?: unknown }

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

// R-393: genres and tags (two lists MusicBrainz keeps apart); the tag counts are not kept.
function genresAndTags(site: Site, data: { genres?: Named[]; tags?: Named[] }) {
  site.list(
    'GENRES',
    data.genres?.map((genre) => genre?.name)
  )
  site.list(
    'TAGS',
    data.tags?.map((tag) => tag?.name)
  )
}
// R-381: a name in a preferred language, from the entry's primary aliases for that language; else the name itself.
function nameIn(site: Site, name: unknown, aliases: unknown) {
  const list = (Array.isArray(aliases) ? (aliases as Alias[]) : []).filter(
      (alias) => alias?.primary === true && typeof alias.name === 'string' && alias.name.trim()
    ),
    found = pickByLanguage(list, (alias) => alias.locale, site.languages)
  return typeof found?.name === 'string' ? found.name : name
}
const mb = (path: string, inc: string) => `https://musicbrainz.org/ws/2/${path}?inc=${inc}&fmt=json`
// The Cover Art Archive's front picture of a release or release-group (it redirects to archive.org; see config.ts).
const cover = (kind: 'release' | 'release-group', id: string) =>
  `https://coverartarchive.org/${kind}/${id}/front-500`

async function recording(site: Site): Promise<ReturnType<Adapter>> {
  const id = site.match(new RegExp('^/recording/' + UUID + '/?$', 'i'))[1].toLowerCase()
  const data = await site.json(mb('recording/' + id, 'artist-credits+releases+genres+tags'))
  if (data.id !== id) throw new SourceError('notFound')
  site.list(
    'ARTISTS',
    data['artist-credit']?.map((artist: Credit) => artist?.name)
  )
  site.text('DURATION', lengthText(data.length))
  site.text('FIRST_RELEASE', data.releases?.[0]?.title)
  site.text('RELEASE_DATE', data['first-release-date'] || data.releases?.[0]?.date)
  genresAndTags(site, data)
  return { title: clean(data.title), canonical: 'https://musicbrainz.org/recording/' + id }
}

async function artist(site: Site): Promise<ReturnType<Adapter>> {
  const id = site.match(new RegExp('^/artist/' + UUID + '/?$', 'i'))[1].toLowerCase()
  const data = await site.json(mb('artist/' + id, 'aliases+genres+tags'))
  if (data.id !== id) throw new SourceError('notFound')
  site.text('ARTIST_TYPE', data.type)
  site.text('COUNTRY', data.country)
  site.text('BEGIN_DATE', data['life-span']?.begin)
  site.text('END_DATE', data['life-span']?.end)
  site.text('DISAMBIGUATION', data.disambiguation)
  genresAndTags(site, data)
  return {
    title: clean(nameIn(site, data.name, data.aliases)),
    canonical: 'https://musicbrainz.org/artist/' + id,
  }
}

// R-393: an album as a work (release-group): its name, artists, type, first release date and genres. Covers come
// from the Cover Art Archive by the release-group.
async function releaseGroup(site: Site): Promise<ReturnType<Adapter>> {
  const id = site.match(new RegExp('^/release-group/' + UUID + '/?$', 'i'))[1].toLowerCase()
  const data = await site.json(mb('release-group/' + id, 'artist-credits+aliases+genres+tags'))
  if (data.id !== id) throw new SourceError('notFound')
  site.list(
    'ARTISTS',
    data['artist-credit']?.map((artist: Credit) => artist?.name)
  )
  site.text(
    'ALBUM_TYPE',
    [data['primary-type'], ...(data['secondary-types'] ?? [])].filter(Boolean).join(' / ')
  )
  site.text('RELEASE_DATE', data['first-release-date'])
  genresAndTags(site, data)
  return {
    title: clean(nameIn(site, data.title, data.aliases)),
    canonical: 'https://musicbrainz.org/release-group/' + id,
    image: cover('release-group', id),
  }
}

type Track = { title?: unknown; length?: unknown; number?: unknown }
type Medium = { format?: unknown; position?: unknown; 'track-count'?: unknown; tracks?: Track[] }
export const musicbrainz: Adapter = async (site) => {
  if (/^\/recording\//i.test(site.input.pathname)) return recording(site)
  if (/^\/artist\//i.test(site.input.pathname)) return artist(site)
  if (/^\/release-group\//i.test(site.input.pathname)) return releaseGroup(site)
  const id = site.match(new RegExp('^/release/' + UUID + '/?$', 'i'))[1].toLowerCase()
  const data = await site.json(
    mb('release/' + id, 'artist-credits+recordings+labels+media+genres+tags')
  )
  if (data.id !== id) throw new SourceError('notFound')
  site.text('RELEASE_DATE', data.date)
  site.text('COUNTRY', data.country)
  site.text('BARCODE', data.barcode)
  site.list(
    'ARTISTS',
    data['artist-credit']?.map((artist: Credit) => artist?.name)
  )
  const media: Medium[] = Array.isArray(data.media) ? data.media.slice(0, 50) : []
  site.list(
    'TRACKS',
    media.flatMap((medium) => medium.tracks?.map((track) => track.title) ?? [])
  )
  // R-393: label and catalogue number, disc count and format, and the track list (disc-number, title, length).
  const labels = Array.isArray(data['label-info']) ? data['label-info'] : []
  site.list(
    'LABEL',
    labels.map((item: { label?: Named }) => item?.label?.name)
  )
  site.list(
    'CATALOG_NUMBER',
    labels.map((item: { 'catalog-number'?: unknown }) => item?.['catalog-number'])
  )
  if (media.length) site.number('DISC_COUNT', media.length)
  site.list(
    'MEDIA_FORMAT',
    media.map((medium) => medium.format)
  )
  const total = media.reduce(
    (sum, medium) => sum + (medium.tracks?.length ?? (Number(medium['track-count']) || 0)),
    0
  )
  if (total) site.number('TRACK_COUNT', total)
  site.list(
    'TRACK_LIST',
    media.flatMap((medium, disc) =>
      (medium.tracks ?? []).map((track, index) => {
        const length = lengthText(track.length),
          number = typeof track.number === 'string' && track.number ? track.number : index + 1
        return `${disc + 1}-${number} ${clean(track.title)}${length ? ` (${length})` : ''}`
      })
    )
  )
  genresAndTags(site, data)
  return {
    title: clean(data.title),
    canonical: 'https://musicbrainz.org/release/' + id,
    image: cover('release', id),
  }
}
