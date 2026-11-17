import type { MetadataCandidate } from '../../shared/explorer'
import type { MetadataSourceId } from '../../shared/sources'
import { sourceJson, sourceRequest } from '../metadata-common'
import { userAgent } from './config'
import { pickByLanguage, steamLanguage, tmdbLanguage } from './language'

// R-418: search by a folder's name. The five sources below are asked in parallel at fixed hosts (the same hosts as
// their address adapters); every candidate address is built from an ID checked here, and picking one runs the
// ordinary preview. No automatic matching, and sources for adult works only (decision still open) are left out.
export const SEARCH_QUERY_MAX = 200
export const SEARCH_RESULTS_MAX = 10
const TIMEOUT = 15000

type Ask = (url: string, body?: unknown, headers?: Record<string, string>) => Promise<any>
type Searcher = (
  ask: Ask,
  query: string,
  languages: string[],
  keys: Record<string, string>
) => Promise<MetadataCandidate[]>

const text = (value: unknown, max = 200) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
const year = (value: unknown) => /^\d{4}/.exec(text(value, 20))?.[0]
const rows = (value: unknown, max = SEARCH_RESULTS_MAX) =>
  (Array.isArray(value) ? value : []).slice(0, max) as any[]
const detail = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' · ') || undefined

const vndb: Searcher = async (ask, query, languages) => {
  const found = await ask('https://api.vndb.org/kana/vn', {
    filters: ['search', '=', query],
    fields: 'title,released,titles{lang,title}',
    results: SEARCH_RESULTS_MAX,
  })
  return rows(found?.results).flatMap((item) => {
    if (typeof item?.id !== 'string' || !/^v[1-9]\d{0,11}$/.test(item.id)) return []
    const own = pickByLanguage(rows(item.titles, 50), (title) => title?.lang, languages)
    return [
      {
        provider: 'vndb' as const,
        title: text(own?.title) || text(item.title),
        detail: year(item.released),
        url: 'https://vndb.org/' + item.id,
      },
    ]
  })
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/
const musicbrainz: Searcher = async (ask, query) => {
  const found = await ask(
    'https://musicbrainz.org/ws/2/release-group?fmt=json&limit=' +
      SEARCH_RESULTS_MAX +
      '&query=' +
      encodeURIComponent(query)
  )
  return rows(found?.['release-groups']).flatMap((item) => {
    if (typeof item?.id !== 'string' || !UUID.test(item.id)) return []
    return [
      {
        provider: 'musicbrainz' as const,
        title: text(item.title),
        detail: detail(
          year(item['first-release-date']),
          text(rows(item['artist-credit'], 5)[0]?.name, 100)
        ),
        url: 'https://musicbrainz.org/release-group/' + item.id,
      },
    ]
  })
}

const anilist: Searcher = async (ask, query, languages) => {
  const found = await ask('https://graphql.anilist.co', {
    query:
      'query($s:String,$n:Int){Page(perPage:$n){media(search:$s,isAdult:false){id type title{romaji english native} startDate{year}}}}',
    variables: { s: query, n: SEARCH_RESULTS_MAX },
  })
  return rows(found?.data?.Page?.media).flatMap((item) => {
    if (!Number.isSafeInteger(item?.id) || item.id < 1 || !['ANIME', 'MANGA'].includes(item.type))
      return []
    const title = item.title ?? {},
      own = languages
        .map((language) =>
          language === 'en' ? title.english : language === 'ja' ? title.native : undefined
        )
        .find((value) => text(value))
    return [
      {
        provider: 'anilist' as const,
        title: text(own) || text(title.romaji) || text(title.english) || text(title.native),
        detail: detail(item.startDate?.year ? String(item.startDate.year) : undefined),
        url: `https://anilist.co/${item.type === 'ANIME' ? 'anime' : 'manga'}/${item.id}/`,
      },
    ]
  })
}

const bangumi: Searcher = async (ask, query, languages) => {
  const found = await ask('https://api.bgm.tv/v0/search/subjects?limit=' + SEARCH_RESULTS_MAX, {
    keyword: query,
    filter: { nsfw: false },
  })
  return rows(found?.data).flatMap((item) => {
    if (!Number.isSafeInteger(item?.id) || item.id < 1) return []
    const chinese = languages.some((language) => language.startsWith('zh'))
    return [
      {
        provider: 'bangumi' as const,
        title: (chinese ? text(item.name_cn) : '') || text(item.name) || text(item.name_cn),
        detail: year(item.date),
        url: 'https://bgm.tv/subject/' + item.id,
      },
    ]
  })
}

// Steam's store search; the country only changes prices, so it follows the first preferred language.
const countries: Record<string, string> = { 'zh-TW': 'TW', 'zh-CN': 'CN', ja: 'JP', es: 'ES' }
const steam: Searcher = async (ask, query, languages) => {
  const found = await ask(
    'https://store.steampowered.com/api/storesearch/?term=' +
      encodeURIComponent(query) +
      '&l=' +
      steamLanguage(languages[0]) +
      '&cc=' +
      (countries[languages[0] ?? ''] ?? 'US')
  )
  return rows(found?.items).flatMap((item) => {
    if (!Number.isSafeInteger(item?.id) || item.id < 1 || item.id > 4294967295) return []
    return [
      {
        provider: 'steam' as const,
        title: text(item.name),
        url: 'https://store.steampowered.com/app/' + item.id + '/',
      },
    ]
  })
}

// R-419: movies and series, only for a user who has set a TMDB key (the key reaches main only, like the adapters').
const tmdb: Searcher = async (ask, query, languages, keys) => {
  const token = keys.token ?? '',
    bearer = token.startsWith('eyJ'),
    found = await ask(
      'https://api.themoviedb.org/3/search/multi?include_adult=false&language=' +
        tmdbLanguage(languages[0]) +
        '&query=' +
        encodeURIComponent(query) +
        (bearer ? '' : '&api_key=' + encodeURIComponent(token)),
      undefined,
      bearer ? { Authorization: 'Bearer ' + token } : {}
    )
  return rows(found?.results).flatMap((item) => {
    if (!['movie', 'tv'].includes(item?.media_type) || !/^[1-9]\d{0,9}$/.test(String(item.id)))
      return []
    return [
      {
        provider: 'tmdb' as const,
        title: text(item.title ?? item.name),
        detail: detail(
          year(item.release_date ?? item.first_air_date),
          item.media_type === 'tv' ? 'TV' : undefined
        ),
        url: 'https://www.themoviedb.org/' + item.media_type + '/' + item.id,
      },
    ]
  })
}

const searchers: [MetadataSourceId, Searcher, string[]][] = [
  ['vndb', vndb, ['api.vndb.org']],
  ['musicbrainz', musicbrainz, ['musicbrainz.org']],
  ['anilist', anilist, ['graphql.anilist.co']],
  ['bangumi', bangumi, ['api.bgm.tv']],
  ['steam', steam, ['store.steampowered.com']],
  ['tmdb', tmdb, ['api.themoviedb.org']],
]

export async function searchSources(
  rawQuery: unknown,
  fetcher: typeof fetch,
  languages: string[] = [],
  options: { keyFor?: (site: string) => Promise<Record<string, string> | undefined> } = {}
): Promise<{ candidates: MetadataCandidate[]; failedSources: MetadataSourceId[] }> {
  const query = text(rawQuery, SEARCH_QUERY_MAX)
  if (!query) throw new Error('請輸入要搜尋的名稱')
  // A keyed source is left out, with no failure note, when the user has no key for it.
  const tmdbKeys = (await options.keyFor?.('tmdb').catch(() => undefined)) ?? {},
    active = searchers.filter(([id]) => id !== 'tmdb' || Object.keys(tmdbKeys).length > 0),
    keysOf = (id: MetadataSourceId) => (id === 'tmdb' ? tmdbKeys : {})
  const settled = await Promise.allSettled(
    active.map(async ([id, search, hosts]) => {
      const ask: Ask = async (url, body, extra = {}) => {
        const target = new URL(url)
        if (target.protocol !== 'https:' || target.port || !hosts.includes(target.hostname))
          throw new Error('Request host not allowed for this search: ' + target.hostname)
        const bytes = await sourceRequest(fetcher, target, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Accept: 'application/json',
            'User-Agent': userAgent,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...extra,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: AbortSignal.timeout(TIMEOUT),
          redirect: 'error',
        })
        return sourceJson(bytes.toString('utf8'))
      }
      return (await search(ask, query, languages, keysOf(id))).filter((item) => item.title)
    })
  )
  const candidates: MetadataCandidate[] = [],
    failedSources: MetadataSourceId[] = []
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') candidates.push(...result.value.slice(0, SEARCH_RESULTS_MAX))
    else failedSources.push(active[index][0])
  })
  return { candidates, failedSources }
}
