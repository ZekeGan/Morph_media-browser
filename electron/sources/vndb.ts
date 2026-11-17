import { SourceError } from '../metadata-common'
import { clean, type Adapter, type Site } from './site'
import { pickByLanguage } from './language'

// R-293: a store page address (Getchu, ErogameScape, Melonbooks, Toranoana, DMM/FANZA) names the game by the link
// VNDB keeps for each release, so the work is found through VNDB's API instead of reading the store's own pages
// (no age check, no region block, no page layout to break). The link is rebuilt from validated IDs only.
export const VNDB_STORE_MISSING = 'VNDB 沒有這個商店網址的作品；可以改貼 VNDB 或 DLsite 的作品網址'
export function storeLink(input: URL): [string, string | number] | undefined {
  const host = input.hostname,
    query = input.searchParams,
    number = (value: string | null | undefined, digits = 10) =>
      value && new RegExp(`^[1-9]\\d{0,${digits - 1}}$`).test(value) ? Number(value) : undefined
  if (host === 'www.getchu.com' || host === 'getchu.com') {
    const id = input.pathname === '/soft.phtml' ? number(query.get('id')) : undefined
    return id ? ['getchu', id] : undefined
  }
  if (host === 'dl.getchu.com') {
    const id = number(/^\/i\/item(\d+)\/?$/.exec(input.pathname)?.[1])
    return id ? ['getchudl', id] : undefined
  }
  if (host === 'erogamescape.dyndns.org' || host === 'erogamescape.org') {
    const id = /\/toukei_kaiseki\/game\.php$/.test(input.pathname)
      ? number(query.get('game'))
      : undefined
    return id ? ['egs', id] : undefined
  }
  if (host === 'www.melonbooks.co.jp') {
    const id = input.pathname === '/detail/detail.php' ? number(query.get('product_id')) : undefined
    return id ? ['melonjp', id] : undefined
  }
  if (host === 'ec.toranoana.shop' || host === 'ec.toranoana.jp') {
    const id = number(/^\/(?:tora|joshi)\/ec\/item\/0*(\d{1,12})\/?$/.exec(input.pathname)?.[1], 12)
    return id ? ['toranoana', id] : undefined
  }
  // VNDB keeps DMM links as host + path (with the trailing slash).
  if (
    /^(www|dlsoft|book)\.dmm\.(co\.jp|com)$/.test(host) &&
    /^\/[\w\-/=.%]{1,300}$/.test(input.pathname)
  )
    return ['dmm', host + input.pathname.replace(/\/?$/, '/')]
  return undefined
}

// R-418: what VNDB knows beyond the description. Tags hide spoilers (level 1 and 2) and "lie" tags; the links are
// kept only as text for the preview (never requested), and the engine comes from the work's releases.
type Link = { name?: unknown; url?: unknown }
const TAG_LIMIT = 30,
  SCREENSHOT_LIMIT = 12
export const VN_EXTRA_FIELDS =
  'length_minutes,rating,votecount,tags{name,rating,spoiler,lie},extlinks{name,url},screenshots{url,sexual,violence}'
const webUrl = (value: unknown, host?: RegExp) => {
  try {
    const url = new URL(String(value))
    return (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password &&
      (!host || host.test(url.hostname))
      ? url.href.slice(0, 500)
      : undefined
  } catch {
    return undefined
  }
}
function links(site: Site, list: unknown) {
  const items = (Array.isArray(list) ? list : []) as Link[],
    pick = (name: string, host?: RegExp) =>
      items.map((item) => (item?.name === name ? webUrl(item.url, host) : undefined)).find(Boolean)
  site.text('STEAM_URL', pick('steam', /^store\.steampowered\.com$/))
  site.text('DLSITE_URL', pick('dlsite', /^www\.dlsite\.com$/))
  site.text('OFFICIAL_URL', pick('website'))
}
// The most used engine among the releases (a release names its own).
function engineOf(engines: unknown[]) {
  const count = new Map<string, number>()
  for (const engine of engines)
    if (typeof engine === 'string' && engine.trim())
      count.set(engine.trim(), (count.get(engine.trim()) ?? 0) + 1)
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0]
}
function extras(site: Site, vn: any) {
  site.number('PLAY_MINUTES', vn.length_minutes)
  // VNDB rates 10–100; shown on a 10-point scale with one decimal.
  if (typeof vn.rating === 'number') site.number('RATING', Math.round(vn.rating) / 10)
  site.number('RATING_COUNT', vn.votecount)
  site.list(
    'TAGS',
    (Array.isArray(vn.tags) ? vn.tags : [])
      .filter(
        (tag: { name?: unknown; spoiler?: unknown; lie?: unknown }) =>
          typeof tag?.name === 'string' && tag.spoiler === 0 && tag.lie !== true
      )
      .sort((a: { rating?: number }, b: { rating?: number }) => (b.rating ?? 0) - (a.rating ?? 0))
      .slice(0, TAG_LIMIT)
      .map((tag: { name: string }) => tag.name)
  )
  links(site, vn.extlinks)
  // Screenshots are listed as addresses only; only the unrated ones (no sexual or violence level).
  site.list(
    'SCREENSHOTS',
    (Array.isArray(vn.screenshots) ? vn.screenshots : [])
      .filter(
        (shot: { url?: unknown; sexual?: unknown; violence?: unknown }) =>
          shot?.sexual === 0 &&
          shot.violence === 0 &&
          /^https:\/\/t\.vndb\.org\//.test(String(shot.url))
      )
      .slice(0, SCREENSHOT_LIMIT)
      .map((shot: { url: string }) => shot.url)
  )
}

type Titled = { lang?: unknown; title?: unknown }
const VN_ID = /^v[1-9]\d{0,11}$/,
  RELEASE_ID = /^r[1-9]\d{0,11}$/
// R-381: the title written in the first preferred language that the work or release has (VNDB lists each language's
// own title); otherwise the title VNDB shows by default.
function titleIn(site: Site, titles: unknown) {
  const list = Array.isArray(titles) ? (titles as Titled[]) : [],
    found = pickByLanguage(
      list.filter((item) => typeof item?.title === 'string' && item.title.trim()),
      (item) => item.lang,
      site.languages
    )
  return typeof found?.title === 'string' ? found.title : undefined
}

// R-393: a release address (/r…). The release gives its own title, date, platforms and languages; the work it belongs
// to gives the description, cover and developers. A release of several works takes the first and says so.
export const VN_FIRST_WORK = '這個版本屬於多部作品；簡介、封面與開發商取自第一部作品'
async function release(site: Site, id: string) {
  const data = (
    await site.json('https://api.vndb.org/kana/release', {
      filters: ['id', '=', id],
      fields:
        'title,alttitle,released,platforms,engine,extlinks{name,url},languages{lang,title,latin,main},vns{id,title}',
      results: 1,
    })
  ).results?.[0]
  if (!data || data.id !== id) throw new SourceError('notFound')
  site.text('TITLE_ORIGINAL', data.alttitle)
  site.text('RELEASE_DATE', data.released)
  site.list('PLATFORMS', data.platforms)
  site.text('ENGINE', data.engine)
  links(site, data.extlinks)
  site.list(
    'LANGUAGES',
    Array.isArray(data.languages) ? data.languages.map((language: Titled) => language?.lang) : []
  )
  const works = (Array.isArray(data.vns) ? data.vns : []).filter(
      (vn: { id?: unknown }) => typeof vn?.id === 'string' && VN_ID.test(vn.id)
    ),
    first = works[0] as { id: string; title?: unknown } | undefined
  let image: string | undefined
  if (first) {
    if (works.length > 1) {
      site.text('WORK_NOTE', VN_FIRST_WORK)
      site.text('FIRST_WORK', first.title)
    }
    // The work only adds to the release; a failed lookup keeps the release's own data.
    try {
      const vn = (
        await site.json('https://api.vndb.org/kana/vn', {
          filters: ['id', '=', first.id],
          fields: 'description,image.url,developers.name,' + VN_EXTRA_FIELDS,
          results: 1,
        })
      ).results?.[0]
      if (vn?.id === first.id) {
        site.text('DESCRIPTION', vn.description)
        site.list(
          'DEVELOPERS',
          vn.developers?.map((developer: { name?: unknown }) => developer?.name)
        )
        if (typeof vn.image?.url === 'string') image = vn.image.url
        extras(site, vn)
      }
    } catch {}
  }
  return {
    title: clean(titleIn(site, data.languages) ?? data.title),
    canonical: 'https://vndb.org/' + id,
    image,
  }
}

export const vndb: Adapter = async (site) => {
  // A store host only ever gives a store link; a "/v97" path there is not taken as a VNDB ID.
  const isVndb = site.input.hostname === 'vndb.org',
    store = isVndb ? undefined : storeLink(site.input)
  if (!isVndb && !store) throw new Error(VNDB_STORE_MISSING)
  const releaseId = isVndb ? /^\/(r[1-9]\d{0,11})\/?$/.exec(site.input.pathname)?.[1] : undefined
  if (releaseId && RELEASE_ID.test(releaseId)) return release(site, releaseId)
  const id = store ? undefined : site.match(/^\/(v[1-9]\d{0,11})\/?$/)[1]
  const data = (
    await site.json('https://api.vndb.org/kana/vn', {
      filters: store ? ['release', '=', ['extlink', '=', store]] : ['id', '=', id],
      fields:
        'title,alttitle,description,released,languages,platforms,developers.name,image.url,titles{lang,title},' +
        VN_EXTRA_FIELDS,
      results: 1,
    })
  ).results?.[0]
  if (!data || typeof data.id !== 'string' || !VN_ID.test(data.id) || (id && data.id !== id))
    throw store ? new Error(VNDB_STORE_MISSING) : new SourceError('notFound')
  site.text('TITLE_ORIGINAL', data.alttitle)
  site.text('DESCRIPTION', data.description)
  site.text('RELEASE_DATE', data.released)
  site.list('LANGUAGES', data.languages)
  site.list('PLATFORMS', data.platforms)
  site.list(
    'DEVELOPERS',
    data.developers?.map((developer: { name?: unknown }) => developer?.name)
  )
  extras(site, data)
  // A failed lookup of the releases only leaves out the engine.
  try {
    const releases = (
      await site.json('https://api.vndb.org/kana/release', {
        filters: ['vn', '=', ['id', '=', data.id]],
        fields: 'engine',
        results: 100,
      })
    ).results
    site.text(
      'ENGINE',
      engineOf(Array.isArray(releases) ? releases.map((r: { engine?: unknown }) => r?.engine) : [])
    )
  } catch {}
  return {
    title: clean(titleIn(site, data.titles) ?? data.title),
    canonical: 'https://vndb.org/' + data.id,
    // R-393: the work's picture is taken whatever its sexual or violence rating (the rating is not asked for).
    image: typeof data.image?.url === 'string' ? data.image.url : undefined,
  }
}
