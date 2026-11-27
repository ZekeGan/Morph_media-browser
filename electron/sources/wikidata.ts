import { SourceError } from '../metadata-common'
import { pickFromMap } from './language'
import { type Adapter, clean, type Site } from './site'

// R-418: a Wikidata item (www.wikidata.org/wiki/Q…) read from its entity data. It gives the label and description in
// the preferred languages, the picture (P18) through Wikimedia Commons, and the item's IDs on other sites as plain
// text (nothing is requested from those sites). Every ID is checked against the shape its site uses.
const ids: { key: string; property: string; pattern: RegExp }[] = [
  {
    key: 'MUSICBRAINZ_ARTIST_ID',
    property: 'P434',
    pattern: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/,
  },
  { key: 'VNDB_ID', property: 'P3180', pattern: /^v?[1-9]\d{0,11}$/ },
  { key: 'STEAM_APP_ID', property: 'P1733', pattern: /^[1-9]\d{0,9}$/ },
  { key: 'ANILIST_ID', property: 'P8729', pattern: /^[1-9]\d{0,11}$/ },
  { key: 'MAL_ID', property: 'P4086', pattern: /^[1-9]\d{0,11}$/ },
  { key: 'MAL_MANGA_ID', property: 'P4087', pattern: /^[1-9]\d{0,11}$/ },
]

type Claim = { mainsnak?: { datavalue?: { value?: unknown } } }

const first = (claims: Record<string, Claim[]> | undefined, property: string) =>
  claims?.[property]?.find((claim) => claim?.mainsnak?.datavalue?.value !== undefined)?.mainsnak
    ?.datavalue?.value
const mapOf = (entries: unknown) =>
  Object.fromEntries(
    Object.entries((entries && typeof entries === 'object' ? entries : {}) as Record<string, any>)
      .filter(([, item]) => typeof item?.value === 'string')
      .map(([code, item]) => [code, item.value as string])
  )

// The Commons file named by P18, as a picture address (400 px wide); a failed lookup leaves the item without one.
async function picture(site: Site, file: unknown) {
  if (typeof file !== 'string' || !file.trim() || file.length > 300) return undefined
  try {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'imageinfo',
      titles: 'File:' + file,
      iiprop: 'url',
      iiurlwidth: '400',
    })
    const url = (await site.json('https://commons.wikimedia.org/w/api.php?' + params)).query
      ?.pages?.[0]?.imageinfo?.[0]?.thumburl
    return typeof url === 'string' ? url : undefined
  } catch {
    return undefined
  }
}

export const wikidata: Adapter = async (site) => {
  const id = /^\/(?:wiki|entity)\/(Q[1-9]\d{0,11})\/?$/.exec(site.input.pathname)?.[1]
  if (!id) throw new Error('請輸入此來源的完整作品網址')
  const data = (await site.json('https://www.wikidata.org/wiki/Special:EntityData/' + id + '.json'))
    .entities?.[id]
  if (!data || data.id !== id) throw new SourceError('notFound')
  const labels = mapOf(data.labels)
  const descriptions = mapOf(data.descriptions)
  const title = pickFromMap(labels, site.languages) ?? labels.en ?? Object.values(labels)[0] ?? id
  site.text('WIKIDATA_ID', id)
  site.text('DESCRIPTION', pickFromMap(descriptions, site.languages) ?? descriptions.en)
  for (const { key, property, pattern } of ids) {
    const value = first(data.claims, property)
    if (typeof value === 'string' && pattern.test(value)) site.text(key, value)
  }
  const official = first(data.claims, 'P856')
  if (typeof official === 'string') {
    try {
      const url = new URL(official)
      if (
        (url.protocol === 'https:' || url.protocol === 'http:') &&
        !url.username &&
        !url.password
      ) {
        site.text('OFFICIAL_URL', url.href.slice(0, 500))
      }
    } catch {}
  }
  return {
    title: clean(title),
    canonical: 'https://www.wikidata.org/wiki/' + id,
    image: await picture(site, first(data.claims, 'P18')),
  }
}
