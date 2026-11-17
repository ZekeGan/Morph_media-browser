// R-423 (tentative): matching the files of a video folder to the episode list imported from TMDB (R-419).
// Pure: no file access. A file name gives an episode number (and maybe a season); the list gives each episode its
// season and title. Anything that is not clear is left unmatched: a wrong episode name is worse than none.

export interface EpisodeEntry {
  season: number
  episode: number
  title?: string
}
// What is saved for one file (FolderDetails.episodes).
export type FileEpisode = { season?: number; episode: number; title?: string }
export const EPISODE_TITLE_MAX = 300

// "S01E02 Title" lines as the TMDB import writes them; a line that is not in this form is ignored.
export function parseEpisodeList(value: unknown): EpisodeEntry[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>(),
    out: EpisodeEntry[] = []
  for (const line of value) {
    const m =
      // Length-capped first: the lazy title with trailing spaces would cost more on a huge line.
      typeof line === 'string' && line.length <= 1000
        ? /^S(\d{1,3})E(\d{1,4})(?:\s+(.+))?$/i.exec(line.trim())
        : null
    if (!m) continue
    const season = Number(m[1]),
      episode = Number(m[2]),
      key = season + ':' + episode
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ season, episode, ...(m[3] ? { title: m[3].slice(0, EPISODE_TITLE_MAX) } : {}) })
  }
  return out
}

export function episodeLabel(e: FileEpisode): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    (e.season !== undefined ? `S${pad(e.season)}` : '') +
    `E${pad(e.episode)}` +
    (e.title ? ' · ' + e.title : '')
  )
}

const KANJI: Record<string, number> = {
  〇: 0,
  零: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}
// 十二 → 12, 二十 → 20, 二十三 → 23, 三 → 3; anything else is not a number.
function kanji(s: string): number | undefined {
  if (/^[〇零一二三四五六七八九]$/.test(s)) return KANJI[s]
  const m = /^([一二三四五六七八九])?十([一二三四五六七八九])?$/.exec(s)
  return m ? (m[1] ? KANJI[m[1]] : 1) * 10 + (m[2] ? KANJI[m[2]] : 0) : undefined
}
function number(s: string): number | undefined {
  return /^\d+$/.test(s) ? Number(s) : kanji(s)
}

// Numbers that are not episodes: resolutions and years.
const NOT_EPISODE = new Set([360, 480, 540, 576, 720, 1080, 1440, 2160, 4320])
const plausible = (n: number, digits: number) =>
  !(digits >= 3 && NOT_EPISODE.has(n)) && !(digits === 4 && n >= 1900 && n <= 2099)

// Resolutions, codecs, channel layouts, hashes and the like, replaced by a space before looking for numbers.
function cleaned(name: string): string {
  return name
    .replace(/\.[A-Za-z0-9]{2,4}$/, '')
    .normalize('NFKC')
    .replace(/[【〔]/g, '[')
    .replace(/[】〕]/g, ']')
    .replace(/[[(][0-9A-Fa-f]{8}[\])]/g, ' ')
    .replace(/\b\d{3,4}\s?[xX×]\s?\d{3,4}\b/g, ' ')
    .replace(/\b\d{3,4}[pPiI]\b/g, ' ')
    .replace(/\b[xXhH]\.?26[45]\b/g, ' ')
    .replace(
      /\b(?:HEVC|AVC|AAC|AC3|E-?AC-?3|DDP?\d?|FLAC|DTS|OPUS|10-?bit|8-?bit|BDRip|WEB-?DL|WEB-?Rip)\b/gi,
      ' '
    )
    .replace(/(?<![\d.])\d\.\d(?![\d.])/g, ' ')
}

// The distinct values of one kind of marker in a name: one value is clear, several are ambiguous.
function distinct(values: (number | undefined)[]): number[] {
  return [...new Set(values.filter((n): n is number => n !== undefined))]
}
function all(re: RegExp, text: string, group: number, check = true): (number | undefined)[] {
  return [...text.matchAll(re)].map((m) => {
    const n = number(m[group])
    return n === undefined || (check && !plausible(n, m[group].length)) ? undefined : n
  })
}

export interface FileRef {
  season?: number
  episode: number
}
// The season and episode a file name says, or undefined when it says none or says it in two ways.
export function parseEpisodeName(fileName: string): FileRef | undefined {
  const name = cleaned(fileName.slice(0, 300))
  // S01E02 (also S01.E02, S1 E2). Two episodes in one name (S01E01E02, S01E01-E02) are not one episode.
  const both = [
    ...name.matchAll(
      /(?<![A-Za-z])S(\d{1,2})[\s._-]*E(\d{1,4})(?<more>[\s._-]*(?:-|~|E|&)[\s._-]*E?\d{1,4})?(?![A-Za-z\d])/gi
    ),
  ]
  if (both.length) {
    const refs = new Set(both.map((m) => `${Number(m[1])}:${Number(m[2])}`))
    if (refs.size !== 1 || both.some((m) => m.groups?.more)) return undefined
    const [season, episode] = [...refs][0].split(':').map(Number)
    return { season, episode }
  }
  // Season elsewhere in the name: Season 2, S2, 第2季, 2nd Season.
  const seasons = distinct([
    ...all(/(?<![A-Za-z])Season[\s._-]*(\d{1,2})(?!\d)/gi, name, 1, false),
    ...all(/(?<![A-Za-z\d])S(\d{1,2})(?![A-Za-z\d])/g, name, 1, false),
    ...all(/第\s*([\d〇零一二三四五六七八九十]{1,3})\s*季/g, name, 1, false),
    ...all(/(?<!\d)(\d{1,2})(?:st|nd|rd|th)\s+Season/gi, name, 1, false),
  ])
  if (seasons.length > 1) return undefined
  const season = seasons[0]
  const found = (values: (number | undefined)[]): FileRef | undefined | null => {
    const numbers = distinct(values)
    return numbers.length === 0
      ? null
      : numbers.length === 1
        ? { season, episode: numbers[0] }
        : undefined
  }
  // The markers from the most to the least telling; the first kind that is present decides (ambiguous: none).
  const kinds: (number | undefined)[][] = [
    // 第02話 / 第2集 / 第 2 话 / 第二話
    all(/第\s*([\d〇零一二三四五六七八九十]{1,4})\s*[話话集回]/g, name, 1),
    // 02話
    all(/(?<![\d第])(\d{1,4})\s*[話话]/g, name, 1),
    // EP02 / E02 / Ep.02 / Episode 02
    all(/(?<![A-Za-z])(?:Episode|EP|E)[\s._-]?(\d{1,4})(?:v\d)?(?![A-Za-z\d])/gi, name, 1),
    // 1x02
    all(/(?<![\d.])\d{1,2}x(\d{2,3})(?![\dA-Za-z])/g, name, 1),
    // [02] / 【02】 / [02v2]
    all(/\[(\d{1,4})(?:v\d)?\]/g, name, 1),
    // #02
    all(/#(\d{1,4})(?!\d)/g, name, 1),
    // " - 02 " / " - 02v2" / "_-_02_"
    all(/(?:^|[\s._])-[\s._]*(\d{1,4})(?:v\d)?(?=$|[\s._[(])/g, name, 1),
  ]
  for (const values of kinds) {
    const result = found(values)
    if (result !== null) return result
  }
  // The whole name is the number ("02"), or starts with it before a dash or dot ("02 - Title", "02.Title").
  const lone = /^\s*(\d{1,3})\s*$/.exec(name) ?? /^\s*(\d{1,3})(?:\s*-\s+|[._]\s*)(?=\D)/.exec(name)
  return lone ? { season, episode: Number(lone[1]) } : undefined
}

export type EpisodeSkip = 'none' | 'season' | 'missing' | 'duplicate'
export interface EpisodeMatch {
  id: string
  name: string
  season: number
  episode: number
  title?: string
}
export interface EpisodeMatches {
  matches: EpisodeMatch[]
  // Files left unmatched and why: no number in the name, no season to put it in, no such episode in the list, or
  // two files claim the same episode.
  skipped: { id: string; name: string; reason: EpisodeSkip }[]
}

export function matchEpisodes(
  files: { id: string; name: string }[],
  list: EpisodeEntry[]
): EpisodeMatches {
  const byKey = new Map(list.map((e) => [e.season + ':' + e.episode, e])),
    seasons = new Set(list.map((e) => e.season)),
    only = seasons.size === 1 ? [...seasons][0] : undefined
  const found: EpisodeMatch[] = [],
    skipped: EpisodeMatches['skipped'] = []
  for (const file of files) {
    const ref = parseEpisodeName(file.name)
    if (!ref) {
      skipped.push({ id: file.id, name: file.name, reason: 'none' })
      continue
    }
    const season = ref.season ?? only
    if (season === undefined) {
      skipped.push({ id: file.id, name: file.name, reason: 'season' })
      continue
    }
    const entry = byKey.get(season + ':' + ref.episode)
    if (!entry) skipped.push({ id: file.id, name: file.name, reason: 'missing' })
    else
      found.push({
        id: file.id,
        name: file.name,
        season,
        episode: ref.episode,
        ...(entry.title ? { title: entry.title } : {}),
      })
  }
  const count = new Map<string, number>()
  for (const m of found) {
    const key = m.season + ':' + m.episode
    count.set(key, (count.get(key) ?? 0) + 1)
  }
  const matches: EpisodeMatch[] = []
  for (const m of found)
    if (count.get(m.season + ':' + m.episode) === 1) matches.push(m)
    else skipped.push({ id: m.id, name: m.name, reason: 'duplicate' })
  return { matches, skipped }
}
