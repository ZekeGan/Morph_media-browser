import type { MetadataCandidate } from '../../shared/explorer'
import type { MetadataSourceId } from '../../shared/sources'
import { sourceJson, sourceRequest } from '../metadata-common'
import { userAgent } from './config'
import { pickByLanguage, steamLanguage, tmdbLanguage } from './language'

// R-418: search by a folder's name. The five sources below are asked in parallel at fixed hosts (the same hosts as
// their address adapters); every candidate address is built from an ID checked here, and picking one runs the
// ordinary preview. No automatic matching. Adult sources are included (C-143); a candidate known to be adult says so.
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
      'query($s:String,$n:Int){Page(perPage:$n){media(search:$s){id type isAdult title{romaji english native} startDate{year}}}}',
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
        ...(item.isAdult === true ? { adult: true } : {}),
      },
    ]
  })
}

// With the user's token NSFW subjects are included (and marked); without it they are filtered out, as the site does.
const bangumi: Searcher = async (ask, query, languages, keys) => {
  const token = keys.token ?? '',
    found = await ask(
      'https://api.bgm.tv/v0/search/subjects?limit=' + SEARCH_RESULTS_MAX,
      token ? { keyword: query } : { keyword: query, filter: { nsfw: false } },
      token ? { Authorization: 'Bearer ' + token } : {}
    )
  return rows(found?.data).flatMap((item) => {
    if (!Number.isSafeInteger(item?.id) || item.id < 1) return []
    const chinese = languages.some((language) => language.startsWith('zh'))
    return [
      {
        provider: 'bangumi' as const,
        title: (chinese ? text(item.name_cn) : '') || text(item.name) || text(item.name_cn),
        detail: year(item.date),
        url: 'https://bgm.tv/subject/' + item.id,
        ...(item.nsfw === true ? { adult: true } : {}),
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

// C-143 adult sources. DLsite has no documented search; its product.json answers a keyword with work records (JSON,
// not ranked: roughly the newest 50 that match), so titles holding the query come first. The shop comes from the
// record and must be one the DLsite adapter accepts.
const DLSITE_SHOPS =
  /^(?:maniax|home|girls|girls-drama|bl|bl-drama|comic|books|ai|soft|app|appx|pro)$/
const dlsite: Searcher = async (ask, query) => {
  const found = await ask(
      'https://www.dlsite.com/maniax/api/=/product.json?keyword=' + encodeURIComponent(query)
    ),
    lower = query.toLowerCase(),
    list = rows(found, 50).flatMap((item) => {
      const shop = item?.site_id === 'aix' ? 'ai' : item?.site_id
      if (typeof item?.workno !== 'string' || !/^[A-Z]{2}\d{5,8}$/.test(item.workno)) return []
      if (typeof shop !== 'string' || !DLSITE_SHOPS.test(shop)) return []
      const title = text(item.work_name)
      return [
        {
          hit: title.toLowerCase().includes(lower),
          candidate: {
            provider: 'dlsite' as const,
            title,
            detail: detail(year(item.regist_date), text(item.maker_name, 100)),
            url: `https://www.dlsite.com/${shop}/work/=/product_id/${item.workno}.html`,
            ...(Number(item.age_category) === 3 ? { adult: true } : {}),
          } as MetadataCandidate,
        },
      ]
    })
  return [...list.filter((entry) => entry.hit), ...list.filter((entry) => !entry.hit)].map(
    (entry) => entry.candidate
  )
}

// FANZA / DMM: the ItemList web service, only with the user's own API ID and affiliate ID.
const fanza: Searcher = async (ask, query, _languages, keys) => {
  const found = await ask(
    'https://api.dmm.com/affiliate/v3/ItemList?output=json&site=FANZA&hits=' +
      SEARCH_RESULTS_MAX +
      '&keyword=' +
      encodeURIComponent(query) +
      '&api_id=' +
      encodeURIComponent(keys.apiId ?? '') +
      '&affiliate_id=' +
      encodeURIComponent(keys.affiliateId ?? '')
  )
  if (found?.result?.status !== undefined && Number(found.result.status) !== 200)
    throw new Error('FANZA refused the request')
  return rows(found?.result?.items).flatMap((item) => {
    const cid = String(item?.content_id ?? '')
    if (!/^[a-z0-9_]{3,40}$/i.test(cid)) return []
    return [
      {
        provider: 'fanza' as const,
        title: text(item.title),
        detail: detail(year(item.date)),
        url: 'https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=' + cid.toLowerCase() + '/',
        adult: true,
      },
    ]
  })
}

// nhentai's v2 search (the old /api/galleries/search answers 403); gallery IDs are plain numbers.
const nhentai: Searcher = async (ask, query, languages) => {
  const found = await ask('https://nhentai.net/api/v2/search?query=' + encodeURIComponent(query))
  return rows(found?.result).flatMap((item) => {
    if (!Number.isSafeInteger(item?.id) || item.id < 1 || item.id > 9999999999) return []
    const english = text(item.english_title),
      japanese = text(item.japanese_title)
    return [
      {
        provider: 'nhentai' as const,
        title: languages[0] === 'ja' ? japanese || english : english || japanese,
        detail: Number.isSafeInteger(item.num_pages) ? item.num_pages + ' p' : undefined,
        url: 'https://nhentai.net/g/' + item.id + '/',
        adult: true,
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
  ['dlsite', dlsite, ['www.dlsite.com']],
  ['fanza', fanza, ['api.dmm.com']],
  ['nhentai', nhentai, ['nhentai.net']],
]

export async function searchSources(
  rawQuery: unknown,
  fetcher: typeof fetch,
  languages: string[] = [],
  options: {
    keyFor?: (site: string) => Promise<Record<string, string> | undefined>
    // R-424: ask only these sources (a key-less TMDB or FANZA is still skipped); missing = all of them.
    sources?: readonly MetadataSourceId[]
  } = {}
): Promise<{ candidates: MetadataCandidate[]; failedSources: MetadataSourceId[] }> {
  const query = text(rawQuery, SEARCH_QUERY_MAX)
  if (!query) throw new Error('請輸入要搜尋的名稱')
  // An empty choice is rejected rather than read as "all": asking nothing is almost certainly a mistake in the caller.
  if (options.sources && !options.sources.length) throw new Error('請至少選一個要搜尋的來源')
  const chosen = options.sources && new Set<string>(options.sources)
  // A keyed source is left out, with no failure note, when the user has no key for it (Bangumi's token is optional).
  const keyed = ['tmdb', 'fanza', 'bangumi'] as const,
    keys: Record<string, Record<string, string>> = {}
  await Promise.all(
    keyed.map(async (id) => {
      keys[id] =
        (await Promise.resolve()
          .then(() => options.keyFor?.(id))
          .catch(() => undefined)) ?? {}
    })
  )
  const active = searchers.filter(
      // FANZA needs both its API ID and affiliate ID; half a key is no key.
      ([id]) =>
        (!chosen || chosen.has(id)) &&
        (id === 'fanza'
          ? !!keys.fanza.apiId && !!keys.fanza.affiliateId
          : id !== 'tmdb' || Object.keys(keys[id]).length > 0)
    ),
    keysOf = (id: MetadataSourceId) => keys[id] ?? {}
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
