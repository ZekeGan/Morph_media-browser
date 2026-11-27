import type { MetadataPreview } from '../shared/explorer'
import { KEY_MISSING, KEY_REJECTED } from '../shared/keys'

import { anilist } from './sources/anilist'
import { bangumi } from './sources/bangumi'
import {
  danbooru,
  deezer,
  googlebooks,
  itunes,
  kitsu,
  mangadex,
  mangaupdates,
  narou,
} from './sources/batch1'
import { commons } from './sources/commons'
import { type PublicSourceId, sourceConfig, userAgent } from './sources/config'
import { dlsite } from './sources/dlsite'
import { hitomi } from './sources/hitomi'
import { itch } from './sources/itch'
import { fanza, steamgriddb, tmdb } from './sources/keyed'
import { detectScript, scriptAccepted } from './sources/language'
import { musicbrainz } from './sources/musicbrainz'
import { nhentai } from './sources/nhentai'
import { openlibrary } from './sources/openlibrary'
import { booth, kakuyomu } from './sources/pages'
import { pixiv } from './sources/pixiv'
import { type Adapter, clean, type RequestExtra, type Site, tags } from './sources/site'
import { vndb } from './sources/vndb'
import { wikidata } from './sources/wikidata'
import {
  imageType,
  limitedBytes,
  SourceError,
  sourceJson,
  SourceRedirect,
  sourceRequest,
} from './metadata-common'

// A cover request. Redirects are refused unless the site names the hosts they may go to (the Cover Art Archive
// hands out its images from archive.org); each hop is checked the same way as the first address.
export async function coverResponse(
  fetcher: typeof fetch,
  first: URL,
  allowed: RegExp | undefined,
  headers: Record<string, string>
) {
  let url = first
  for (let hop = 0; ; hop++) {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(15000),
      redirect: allowed ? 'manual' : 'error',
      headers,
    })
    const location = response.headers.get('location')
    if (!allowed || ![301, 302, 303, 307, 308].includes(response.status) || !location) {
      return response
    }
    const next = new URL(location, url)
    if (
      hop >= 3 ||
      next.protocol !== 'https:' ||
      next.port ||
      next.username ||
      next.password ||
      !allowed.test(next.hostname)
    ) {
      throw new Error('封面來源未允許')
    }
    url = next
  }
}

type Result = {
  preview: Omit<MetadataPreview, 'token'>
  cover?: { bytes: Buffer; mime: string; ext: string }
  albumCover?: { bytes: Buffer; mime: string; ext: string }
}

// One adapter per site in electron/sources/; their hosts, headers and cover hosts are in sources/config.ts.
const adapters: Record<PublicSourceId, Adapter> = {
  bangumi,
  anilist,
  vndb,
  musicbrainz,
  openlibrary,
  commons,
  wikidata,
  dlsite,
  pixiv,
  hitomi,
  mangadex,
  kitsu,
  mangaupdates,
  narou,
  itunes,
  deezer,
  danbooru,
  googlebooks,
  booth,
  kakuyomu,
  itch,
  nhentai,
  tmdb,
  steamgriddb,
  fanza,
}

// The requested URLs are constructed from validated IDs, never from remote JSON links, and must be on the site's
// request hosts. Redirects and oversized responses fail without touching local data.
export async function publicMetadata(
  provider: PublicSourceId,
  source: string,
  fetcher: typeof fetch,
  options: {
    keyFor?: (site: string) => Promise<Record<string, string> | undefined>
    // R-381: the languages to take titles and descriptions in, first choice first (locale ids).
    languages?: string[]
    release?: string | null
    trackCount?: number
  } = {}
): Promise<Result> {
  const config = sourceConfig[provider]
  const values: MetadataPreview['values'] = []
  // R-285: the user's own key for this site, read by main only. A required key that is missing stops here.
  const keys = config.keySite ? ((await options.keyFor?.(config.keySite)) ?? {}) : {}
  if (config.keySite && config.keyNeed === 'required' && !Object.keys(keys).length) {
    throw new Error(KEY_MISSING)
  }
  // R-293: a DMM/FANZA address without the user's key is looked up through VNDB (games only).
  if (provider === 'fanza' && !Object.keys(keys).length) {
    return publicMetadata('vndb', source, fetcher, options)
  }
  const allowed = (target: URL) => {
    if (
      target.protocol !== 'https:' ||
      target.port ||
      target.username ||
      target.password ||
      !(
        config.requestHosts.includes(target.hostname) ||
        config.requestHostPattern?.test(target.hostname)
      )
    ) {
      throw new Error('Request host not allowed for this source: ' + target.hostname)
    }
  }
  const request = async (url: string, body?: unknown, extra: RequestExtra = {}) => {
    let target = new URL(url)
    allowed(target)
    // R-523: a GET that may follow redirects does so at most three times, each new address checked like the first.
    const follow = extra.follow && body === undefined && !extra.raw && !extra.form
    for (let hop = 0; ; hop++) {
      try {
        return await send(target, body, extra, follow ? 'manual' : 'error')
      } catch (error) {
        if (!(error instanceof SourceRedirect)) throw error
        if (!follow || hop >= 2) throw new SourceError('offline')
        target = error.location
        allowed(target)
        extra.follow!(target)
      }
    }
  }
  const send = async (
    target: URL,
    body: unknown,
    extra: RequestExtra,
    redirect: 'manual' | 'error'
  ) => {
    const raw = typeof extra.raw === 'string'
    const form = typeof extra.form === 'string'
    try {
      const bytes = await sourceRequest(fetcher, target, {
        method: body !== undefined || raw || form ? 'POST' : (extra.method ?? 'GET'),
        headers: {
          Accept: config.accept ?? 'application/json',
          'User-Agent': userAgent,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(raw ? { 'Content-Type': 'text/plain' } : {}),
          ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(config.referer ? { Referer: source } : {}),
          ...extra.headers,
        },
        ...(body !== undefined
          ? { body: JSON.stringify(body) }
          : raw
            ? { body: extra.raw }
            : form
              ? { body: extra.form }
              : {}),
        signal: AbortSignal.timeout(15000),
        redirect,
      })
      return bytes.toString('utf8')
    } catch (error) {
      // A refused key says so, instead of the general "needs access".
      if (error instanceof SourceError && error.kind === 'restricted' && Object.keys(keys).length) {
        throw new Error(KEY_REJECTED)
      }
      throw error
    }
  }
  const input = new URL(source)
  const site: Site = {
    input,
    source,
    match(expression) {
      const result = expression.exec(input.pathname)
      if (!result) throw new Error('請輸入此來源的完整作品網址')
      return result
    },
    request,
    json: async (url, body, extra) => sourceJson(await request(url, body, extra)),
    keys,
    languages: options.languages ?? [],
    release: options.release,
    trackCount: options.trackCount,
    text(key, value) {
      const result = clean(value)
      if (result) values.push({ key, type: 'string', value: result })
    },
    list(key, value, max) {
      const result = tags(value, max)
      if (result.length) values.push({ key, type: 'tags', value: result })
    },
    number(key, value) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        values.push({ key, type: 'number', value })
      }
    },
  }
  const { title, canonical, image, albumImage, related, versions, version, versionPick } =
    await adapters[provider](site)
  if (!title.trim()) throw new SourceError('format')
  values.unshift(
    { key: 'TITLE', type: 'string', value: title },
    { key: 'SOURCE_URL', type: 'string', value: canonical }
  )
  // R-420: a title or description that is in none of the preferred languages gets a notice (it never blocks the import).
  // The value is "<preferred ids>|<script>"; the import window words it in the interface language.
  if (site.languages.length) {
    const description = values.find((v) => v.key === 'DESCRIPTION')
    const text = description?.type === 'string' ? String(description.value) : title
    const script = detectScript(text, description !== undefined)
    if (script && !scriptAccepted(script, site.languages)) {
      values.push({
        key: 'LANGUAGE_NOTICE',
        type: 'string',
        value: site.languages.join(',') + '|' + script,
      })
    }
  }
  const result: Result = {
    preview: {
      provider,
      title: title.slice(0, 200),
      source: canonical,
      values,
      related,
      ...(versions ? { versions, version, versionPick } : {}),
    },
  }
  const download = async (address: string) => {
    try {
      const url = new URL(address)
      if (
        url.protocol !== 'https:' ||
        url.port ||
        url.username ||
        url.password ||
        !config.coverHosts.includes(url.hostname)
      ) {
        throw new Error('封面來源未允許')
      }
      const bytes = await limitedBytes(
        await coverResponse(fetcher, url, config.coverRedirectHosts, {
          'User-Agent': userAgent,
          ...(config.referer ? { Referer: canonical } : {}),
        }),
        10 * 1024 * 1024
      )
      const type = imageType(bytes)
      if (!type) throw new Error('封面格式未支援')
      return { bytes, ...type }
    } catch {
      return undefined
    }
  }
  const dataUrl = (cover: { bytes: Buffer; mime: string }) =>
    'data:' + cover.mime + ';base64,' + cover.bytes.toString('base64')
  const cover = typeof image === 'string' ? await download(image) : undefined
  // R-449: a MusicBrainz version's cover and the album's own; either may be missing.
  const album = typeof albumImage === 'string' ? await download(albumImage) : undefined
  if (cover) {
    result.cover = cover
    result.preview.image = dataUrl(cover)
  }
  if (album) {
    result.albumCover = album
    result.preview.albumImage = dataUrl(album)
  }
  if ((typeof image === 'string' || typeof albumImage === 'string') && !cover && !album) {
    values.push({ key: 'COVER_STATUS', type: 'string', value: '封面無法取得；可略過或手動匯入' })
  }
  return result
}
