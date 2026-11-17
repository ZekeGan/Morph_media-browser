export interface ImageSize {
  width: number
  height: number
}
// R-374: a page wider than tall is a spread drawn as one picture, so it never shares the screen with another page.
export const isWidePage = (size: ImageSize) => size.width > size.height
// wide: whether a page is known to be wider than tall; pages not measured yet pair as usual.
export function readingGroups(
  count: number,
  spread: boolean,
  firstSingle: boolean,
  wide?: (index: number) => boolean
): number[][] {
  const groups: number[][] = []
  for (let i = 0; i < count;) {
    const pair =
      spread && !(firstSingle && i === 0) && i + 1 < count && !wide?.(i) && !wide?.(i + 1)
    groups.push(pair ? [i, i + 1] : [i])
    i += pair ? 2 : 1
  }
  return groups
}
export function spreadGeometry(
  sizes: ImageSize[],
  fit: 'width' | 'height' | 'original' | 'contain',
  box: ImageSize,
  zoom: number
) {
  const naturalHeight = Math.max(1, ...sizes.map((s) => s.height)),
    ratio = sizes.reduce((sum, s) => sum + s.width / Math.max(1, s.height), 0) || 1
  const height =
    (fit === 'contain'
      ? Math.min(box.height, box.width / ratio)
      : fit === 'height'
        ? box.height
        : fit === 'width'
          ? box.width / ratio
          : naturalHeight) * zoom
  return {
    width: height * ratio,
    height,
    widths: sizes.map((s) => (height * s.width) / Math.max(1, s.height)),
  }
}
export const readerArrowStep = (key: string, rtl: boolean) =>
  key === 'ArrowLeft' ? (rtl ? 1 : -1) : key === 'ArrowRight' ? (rtl ? -1 : 1) : 0

// R-426: a book is finished once its last page was on screen. The reader saves the last page for such a spread, but
// records written before that kept only the left page of the last spread, so in spread mode the second to last counts too.
export const bookFinished = (page: number, count: number, spread?: boolean) =>
  count > 0 && page >= count - (spread ? 2 : 1)

// R-390: what the book page says about where a manga was left: the page (counted from 1) out of the pictures it has.
// `resumes` follows the reader (R-253): it continues from the saved page unless that is the first page or the book
// was finished, which opens from the start. A finished book shows its last page.
export function savedPlace(
  prefs: { page?: number; spread?: boolean } | undefined,
  images: number
): { page: number; total: number; resumes: boolean } | undefined {
  const page = prefs?.page
  if (!page || !Number.isInteger(page) || page <= 0 || images <= 0) return undefined
  const finished = bookFinished(page, images, prefs.spread)
  return {
    page: finished ? images : Math.min(page, images - 1) + 1,
    total: images,
    resumes: !finished,
  }
}

// R-407: books of one folder in file name order, numbers counted as numbers (vol2 before vol10). The book list and
// "the next book" use the same order.
const volumeNames = new Intl.Collator('zh-Hant', { numeric: true })
export const sortVolumes = <T extends { name: string }>(entries: readonly T[]): T[] =>
  [...entries].sort((a, b) => volumeNames.compare(a.name, b.name))
