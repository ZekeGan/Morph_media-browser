import { SourceError } from '../metadata-common'
import { clean, tags, type Adapter, type Site } from './site'
import type { MetadataVersion } from '../../shared/explorer'
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

// R-449: MusicBrainz asks clients for at most one request a second; one preview's requests are spaced that far apart.
// The spacing is kept across previews, so switching versions quickly does not go faster either.
// R-461: every MusicBrainz request (name search too) takes its turn in one queue, so two at once wait for each other.
export const pace = { ms: 1000 }
let last = 0,
  queue: Promise<unknown> = Promise.resolve()
export function musicBrainzTurn<T>(job: () => Promise<T>): Promise<T> {
  const turn = queue.then(async () => {
    const wait = last + pace.ms - Date.now()
    if (last && wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    try {
      return await job()
    } finally {
      last = Date.now()
    }
  })
  queue = turn.catch(() => {})
  return turn
}
function paced(site: Site) {
  return (url: string) => musicBrainzTurn(() => site.json(url))
}
type Ask = ReturnType<typeof paced>

type Track = { title?: unknown; length?: unknown; number?: unknown }
type Medium = { format?: unknown; position?: unknown; 'track-count'?: unknown; tracks?: Track[] }
type Label = { label?: Named; 'catalog-number'?: unknown }
const RELEASE_INC = 'artist-credits+recordings+labels+media+genres+tags+release-groups'
const uuid = new RegExp('^' + UUID + '$', 'i')

// R-393: a version's own data: label and catalogue number, disc count and format, and the track list (disc-number,
// title, length). R-449: its date is the version's (EDITION_DATE) when the album's first release date is kept apart.
function editionValues(site: Site, data: any, dateKey: 'RELEASE_DATE' | 'EDITION_DATE') {
  site.text(dateKey, data.date)
  site.text('COUNTRY', data.country)
  site.text('BARCODE', data.barcode)
  const media: Medium[] = Array.isArray(data.media) ? data.media.slice(0, 50) : []
  site.list(
    'TRACKS',
    media.flatMap((medium) => medium.tracks?.map((track) => track.title) ?? [])
  )
  const labels: Label[] = Array.isArray(data['label-info']) ? data['label-info'] : []
  site.list(
    'LABEL',
    labels.map((item) => item?.label?.name)
  )
  site.list(
    'CATALOG_NUMBER',
    labels.map((item) => item?.['catalog-number'])
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
}

// R-449: a version as the menu lists it: date, country, formats ("2×CD", "CD + DVD"), track count, label, catalogue
// number, and whether it is an official release.
function versionOf(raw: any): MetadataVersion | undefined {
  if (typeof raw?.id !== 'string' || !uuid.test(raw.id)) return undefined
  const media: Medium[] = Array.isArray(raw.media) ? raw.media.slice(0, 50) : [],
    labels: Label[] = Array.isArray(raw['label-info']) ? raw['label-info'] : [],
    counts = new Map<string, number>()
  for (const medium of media) {
    const format = clean(medium?.format).slice(0, 40) || '?'
    counts.set(format, (counts.get(format) ?? 0) + 1)
  }
  const tracks = media.reduce((sum, medium) => sum + (Number(medium?.['track-count']) || 0), 0),
    text = (value: unknown, max = 100) => clean(value).slice(0, max) || undefined
  return {
    id: raw.id.toLowerCase(),
    date: text(raw.date, 10),
    country: text(raw.country, 10),
    formats: text(
      [...counts].map(([format, n]) => (n > 1 ? n + '×' + format : format)).join(' + ')
    ),
    tracks: tracks || undefined,
    label: text(tags(labels.map((item) => item?.label?.name)).join(' / ')),
    catalog: text(tags(labels.map((item) => item?.['catalog-number'])).join(' / ')),
    official: raw.status === 'Official',
  }
}

// R-449: the version picked for the folder: one whose track count matches its music files first; among those (or
// among all, when none matches) an official release, then the earliest, then a CD or digital one.
export function pickVersion(list: MetadataVersion[], trackCount?: number) {
  const matching = trackCount ? list.filter((version) => version.tracks === trackCount) : [],
    pool = matching.length ? matching : list,
    rank = (version: MetadataVersion) => [
      version.official ? 0 : 1,
      version.date || '9999',
      /^(?:\d+×)?(?:CD|Digital Media)\b/.test(version.formats ?? '') ? 0 : 1,
    ]
  const best = [...pool].sort((a, b) => {
    const x = rank(a),
      y = rank(b)
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1
    return 0
  })[0]
  return best && { id: best.id, pick: matching.length ? ('match' as const) : ('fallback' as const) }
}

// R-449: switching versions asks again for the same album; its data and version list are kept a short while so only
// the new version is fetched.
const albums = new Map<string, { group: any; list: MetadataVersion[]; expires: number }>()
async function albumData(ask: Ask, id: string, reuse: boolean) {
  const kept = albums.get(id)
  if (reuse && kept && kept.expires > Date.now()) return kept
  const group = await ask(mb('release-group/' + id, 'artist-credits+aliases+genres+tags'))
  if (group.id !== id) throw new SourceError('notFound')
  let list: MetadataVersion[] = []
  try {
    const found = await ask(
      `https://musicbrainz.org/ws/2/release?release-group=${id}&inc=media+labels&limit=100&fmt=json`
    )
    list = (Array.isArray(found?.releases) ? found.releases : [])
      .map(versionOf)
      .filter((version: MetadataVersion | undefined): version is MetadataVersion => !!version)
  } catch {
    // Without the list the album still previews, as album data only.
  }
  for (const [key, value] of albums) if (value.expires < Date.now()) albums.delete(key)
  if (albums.size >= 10) albums.delete(albums.keys().next().value!)
  const entry = { group, list, expires: Date.now() + 15 * 60 * 1000 }
  albums.set(id, entry)
  return entry
}

// R-393: an album as a work (release-group): its name, artists, type, first release date and genres.
// R-449: merged with one of its versions (release): the track list, label, catalogue number, barcode, discs, formats
// and the version's date and cover come from it; the source address is the version's. `given` is a version already
// fetched (a pasted /release/ address).
async function album(site: Site, ask: Ask, id: string, given?: any): Promise<ReturnType<Adapter>> {
  const { group, list } = await albumData(ask, id, site.release !== undefined)
  // A pasted version the list does not hold (an album with more than 100) is still offered.
  const own =
    given && !list.some((version) => version.id === given.id) ? versionOf(given) : undefined
  const versions = [...list, ...(own ? [own] : [])].map((version) => ({
    ...version,
    ...(site.trackCount ? { matches: version.tracks === site.trackCount } : {}),
  }))
  let chosen: string | undefined, versionPick: 'match' | 'fallback' | 'chosen' | undefined
  if (typeof site.release === 'string') {
    chosen = site.release.toLowerCase()
    if (!uuid.test(chosen) || (list.length && !list.some((version) => version.id === chosen)))
      throw new SourceError('notFound')
    versionPick = 'chosen'
  } else if (site.release === undefined) {
    const picked = given
      ? { id: String(given.id), pick: 'chosen' as const }
      : pickVersion(versions, site.trackCount)
    chosen = picked?.id
    versionPick = picked?.pick
  }
  site.list(
    'ARTISTS',
    group['artist-credit']?.map((artist: Credit) => artist?.name)
  )
  site.text(
    'ALBUM_TYPE',
    [group['primary-type'], ...(group['secondary-types'] ?? [])].filter(Boolean).join(' / ')
  )
  site.text('RELEASE_DATE', group['first-release-date'])
  genresAndTags(site, group)
  const albumUrl = 'https://musicbrainz.org/release-group/' + id,
    title = clean(nameIn(site, group.title, group.aliases)),
    listed = { versions, version: chosen, versionPick }
  if (!chosen)
    return {
      title,
      canonical: albumUrl,
      image: cover('release-group', id),
      ...(versions.length ? listed : {}),
    }
  const data = given?.id === chosen ? given : await ask(mb('release/' + chosen, RELEASE_INC))
  // The version must belong to this album (also when the list could not be read).
  if (data.id !== chosen || data['release-group']?.id !== id) throw new SourceError('notFound')
  editionValues(site, data, 'EDITION_DATE')
  site.text('RELEASE_GROUP_URL', albumUrl)
  return {
    title,
    canonical: 'https://musicbrainz.org/release/' + chosen,
    image: cover('release', chosen),
    albumImage: cover('release-group', id),
    ...listed,
  }
}

export const musicbrainz: Adapter = async (site) => {
  if (/^\/recording\//i.test(site.input.pathname)) return recording(site)
  if (/^\/artist\//i.test(site.input.pathname)) return artist(site)
  const ask = paced(site)
  if (/^\/release-group\//i.test(site.input.pathname)) {
    const id = site.match(new RegExp('^/release-group/' + UUID + '/?$', 'i'))[1].toLowerCase()
    return album(site, ask, id)
  }
  const id = site.match(new RegExp('^/release/' + UUID + '/?$', 'i'))[1].toLowerCase()
  const data = await ask(mb('release/' + id, RELEASE_INC))
  if (data.id !== id) throw new SourceError('notFound')
  // R-449: a version of a known album is shown with the album's version menu, this version picked.
  const group = data['release-group']?.id
  if (typeof group === 'string' && uuid.test(group))
    return album(site, ask, group.toLowerCase(), data)
  site.list(
    'ARTISTS',
    data['artist-credit']?.map((artist: Credit) => artist?.name)
  )
  editionValues(site, data, 'RELEASE_DATE')
  genresAndTags(site, data)
  return {
    title: clean(data.title),
    canonical: 'https://musicbrainz.org/release/' + id,
    image: cover('release', id),
  }
}
