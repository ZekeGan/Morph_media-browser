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
      fields: 'title,alttitle,released,platforms,languages{lang,title,latin,main},vns{id,title}',
      results: 1,
    })
  ).results?.[0]
  if (!data || data.id !== id) throw new SourceError('notFound')
  site.text('TITLE_ORIGINAL', data.alttitle)
  site.text('RELEASE_DATE', data.released)
  site.list('PLATFORMS', data.platforms)
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
          fields: 'description,image.url,developers.name',
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
        'title,alttitle,description,released,languages,platforms,developers.name,image.url,titles{lang,title}',
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
  return {
    title: clean(titleIn(site, data.titles) ?? data.title),
    canonical: 'https://vndb.org/' + data.id,
    // R-393: the work's picture is taken whatever its sexual or violence rating (the rating is not asked for).
    image: typeof data.image?.url === 'string' ? data.image.url : undefined,
  }
}
