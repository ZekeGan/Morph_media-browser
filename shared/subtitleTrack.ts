// R-432: which embedded subtitle track a video opens with. The folder remembers the name and language of the track
// the user picked in another episode; the file's own default track is used only when nothing is remembered.
import type { EmbeddedSubtitleInfo, SubtitleTrackPreference } from './explorer'

// Matroska languages are ISO 639-2 codes; bibliographic and terminology forms of one language are the same language.
const same: Record<string, string> = { chi: 'zho', fre: 'fra', ger: 'deu', dut: 'nld' }
const languageKey = (value?: string) => {
  const code = (value ?? '').trim().toLowerCase().split('-')[0]
  return same[code] ?? code
}
const nameKey = (value?: string) => (value ?? '').trim().toLowerCase()

export const trackPreference = (
  track: Pick<EmbeddedSubtitleInfo, 'name' | 'language'>
): SubtitleTrackPreference | undefined => {
  const name = track.name?.trim().slice(0, 200)
  const language = track.language?.trim().slice(0, 35)
  return name || language
    ? { ...(name ? { name } : {}), ...(language ? { language } : {}) }
    : undefined
}

// Only tracks that can be shown (text, or a picture track that is drawn) are chosen.
export function chooseSubtitleTrack(
  tracks: EmbeddedSubtitleInfo[],
  preference?: SubtitleTrackPreference
): EmbeddedSubtitleInfo | undefined {
  const shown = tracks.filter((track) => !track.graphic || track.picture)
  if (!preference || (!preference.name && !preference.language)) return shown.find((t) => t.default)
  const name = nameKey(preference.name)
  const language = languageKey(preference.language)
  const sameName = (t: EmbeddedSubtitleInfo) => !!name && nameKey(t.name) === name
  const sameLanguage = (t: EmbeddedSubtitleInfo) =>
    !!language && languageKey(t.language) === language
  // The same name wins; with the language also given, a track matching both is the best of those.
  const named = shown.filter(sameName)
  if (named.length) return named.find(sameLanguage) ?? named[0]
  const spoken = shown.filter(sameLanguage)
  // A forced track holds only foreign-language lines; prefer a full one.
  return spoken.find((t) => !t.forced) ?? spoken[0]
}
