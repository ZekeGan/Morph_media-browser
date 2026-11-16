import { currentLocale, t as tr } from '../i18n'
import type { EmbeddedSubtitleInfo } from '../../shared/explorer'

// R-412: Matroska names a track's language with ISO 639-2 codes; the bibliographic ones (chi, fre, ger…) are not
// accepted by Intl, so they are mapped to their terminology codes first.
const terminology: Record<string, string> = {
  chi: 'zho',
  fre: 'fra',
  ger: 'deu',
  dut: 'nld',
  gre: 'ell',
  cze: 'ces',
  slo: 'slk',
  per: 'fas',
  rum: 'ron',
  may: 'msa',
  ice: 'isl',
  arm: 'hye',
  geo: 'kat',
  bur: 'mya',
}
export function languageName(code?: string) {
  if (!code) return ''
  try {
    return (
      new Intl.DisplayNames([currentLocale()], { type: 'language' }).of(
        terminology[code] ?? code
      ) ?? code
    )
  } catch {
    return code
  }
}
// "內嵌：日本語／Signs": the language and the track's own name, whichever the file gives.
export const embeddedLabel = (track: Pick<EmbeddedSubtitleInfo, 'number' | 'language' | 'name'>) =>
  tr(
    '內嵌：{0}',
    [languageName(track.language), track.name].filter(Boolean).join('／') || '#' + track.number
  )
