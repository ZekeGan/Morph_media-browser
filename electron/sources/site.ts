import { decode } from '../metadata-common'

// What a website adapter gets: the pasted address, fixed-host requests and helpers that collect preview values.
export interface Site {
  input: URL
  source: string
  // The address path must match the site's work-page pattern; otherwise the user is asked for a full work address.
  match(expression: RegExp): RegExpExecArray
  request(url: string, body?: unknown, extra?: RequestExtra): Promise<string>
  json(url: string, body?: unknown, extra?: RequestExtra): Promise<any>
  // R-285: the user's key values for this site (empty when none is needed or set).
  keys: Record<string, string>
  // R-381: the preferred languages as locale ids (zh-TW, ja, zh-CN, en, es), first choice first; empty = site default.
  languages: string[]
  // R-449 (MusicBrainz albums): the version asked for (a release ID; null: album data only; absent: pick one) and the
  // folder's music file count the pick compares with.
  release?: string | null
  trackCount?: number
  text(key: string, value: unknown): void
  // max: how many entries a long list may keep (200 by default).
  list(key: string, value: unknown, max?: number): void
  number(key: string, value: unknown): void
}

// Extra request settings: headers (a key or client ID) and a plain-text body (IGDB's query language).
export interface RequestExtra {
  headers?: Record<string, string>
  raw?: string
  // A form-encoded body (OAuth token requests).
  form?: string
  method?: 'GET' | 'POST'
  // R-523: follow redirects (at most three) that stay on this source's request hosts; told each new address.
  follow?: (url: URL) => void
}

export interface SiteResult {
  title: string
  canonical: string
  image?: string
  // R-449: the album's own cover, offered beside the version's (image).
  albumImage?: string
  // R-449: the album's versions, the one merged in and why it was picked.
  versions?: import('../../shared/explorer').MetadataVersion[]
  version?: string
  versionPick?: 'match' | 'fallback' | 'chosen'
  related?: { provider: 'vndb'; url: string; title: string }
}

export type Adapter = (site: Site) => Promise<SiteResult>

export const clean = (value: unknown) =>
  decode(value)
    .replace(/<[^>]*>/g, '')
    .slice(0, 10000)

export const tags = (value: unknown, max = 200) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => clean(item).slice(0, 100))
            .filter(Boolean)
        ),
      ].slice(0, max)
    : []
