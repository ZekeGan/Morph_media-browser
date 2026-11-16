// R-381: choosing a title or description by the user's preferred languages. A source writes its languages as ISO
// codes ("ja", "zh-Hant", "zh-hk", "ja-ro", "pt_br"); the preference is a list of the app's locale ids.
// Only the language itself is matched, never a guess: a source that has none of the preferred languages gives
// nothing here and the adapter keeps the site's own default.
const tags: Record<string, string[]> = {
  'zh-TW': ['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo', 'zh'],
  'zh-CN': ['zh-hans', 'zh-cn', 'zh-sg', 'zh'],
  ja: ['ja'],
  en: ['en'],
  es: ['es'],
}
export const normalizeTag = (value: unknown) =>
  typeof value === 'string' ? value.toLowerCase().replaceAll('_', '-') : ''
// The codes that count as this locale, best match first.
export const languageTags = (locale: string) => tags[locale] ?? [normalizeTag(locale)]

// The first value written in a preferred language: languages in the user's order, and inside one language the
// closest code first (Traditional before the bare "zh"). An entry whose code is not a plain language is skipped
// ("ja-ro" is Romaji, not Japanese).
export function pickByLanguage<T>(
  items: readonly T[],
  codeOf: (item: T) => unknown,
  languages: readonly string[]
): T | undefined {
  for (const locale of languages)
    for (const tag of languageTags(locale)) {
      const found = items.find((item) => normalizeTag(codeOf(item)) === tag)
      if (found !== undefined) return found
    }
  return undefined
}

// A map of code → text (MangaDex titles, Kitsu titles).
export function pickFromMap(
  map: unknown,
  languages: readonly string[],
  alias: Record<string, string> = {}
): string | undefined {
  if (!map || typeof map !== 'object') return undefined
  const entries = Object.entries(map as Record<string, unknown>)
    .map(([code, value]) => ({ code: alias[code] ?? code, value }))
    .filter((entry): entry is { code: string; value: string } => typeof entry.value === 'string')
  return pickByLanguage(entries, (entry) => entry.code, languages)?.value
}

// TMDB wants one language-region code.
export const tmdbLanguage = (locale: string | undefined) =>
  ({ 'zh-TW': 'zh-TW', 'zh-CN': 'zh-CN', ja: 'ja-JP', en: 'en-US', es: 'es-ES' })[locale ?? ''] ??
  'en-US'
