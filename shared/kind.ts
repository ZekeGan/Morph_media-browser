import type { FolderRow } from './model'
import { isGameFolder } from './media'

// What a folder is decides how it is shown and what it offers; the project only arranges folders.
// "general" is the safe default: anything we are not sure about is browsed as plain files.
export type FolderKind = 'game' | 'book' | 'music' | 'video' | 'general'
export const folderKinds: FolderKind[] = ['game', 'book', 'music', 'video', 'general']
export const isFolderKind = (value: unknown): value is FolderKind =>
  typeof value === 'string' && (folderKinds as string[]).includes(value)

// What a project keeps per kind (content templates, kind layouts) is keyed by template kind: music and video share
// `media`, so the project format did not change when the folder kinds were split (R-387).
export type TemplateKind = 'game' | 'book' | 'media' | 'general'
export const templateKinds: TemplateKind[] = ['game', 'book', 'media', 'general']
export const templateKind = (kind: FolderKind): TemplateKind =>
  kind === 'music' || kind === 'video' ? 'media' : kind

// A small look at what a folder contains: counts of the files directly inside, by extension only.
export interface KindSample {
  images: number
  videos: number
  audio: number
  // Text books (TXT, EPUB), R-282.
  texts?: number
  // EPUB alone (also counted in texts), comic archives (CBZ, CBR, CB7) and files that only accompany music
  // (cue sheets, lyrics, playlists, rip logs), R-387.
  epubs?: number
  comics?: number
  sidecars?: number
  // R-479: the pictures whose file names are page numbers, when they make up a whole book (see pageNumbered); 0
  // otherwise. Counted while scanning or listing, never saved.
  pages?: number
  total: number
}
const comicTypes = ['.cbz', '.cbr', '.cb7'],
  sidecarTypes = ['.cue', '.lrc', '.m3u', '.m3u8', '.log']
export const emptySample = (): Required<KindSample> => ({
  images: 0,
  videos: 0,
  audio: 0,
  texts: 0,
  epubs: 0,
  comics: 0,
  sidecars: 0,
  pages: 0,
  total: 0,
})
// One file added to a sample. `kind` is what the listing calls the file; the name only gives the extension, so the
// scan and an opened folder count the same way and nothing is opened.
export function countFile(sample: Required<KindSample>, kind: string, name = '') {
  const dot = name.lastIndexOf('.'),
    ext = dot > 0 ? name.slice(dot).toLowerCase() : ''
  sample.total++
  if (kind === 'image') sample.images++
  else if (kind === 'video') sample.videos++
  else if (kind === 'audio') sample.audio++
  // R-399: Markdown notes are not text books; they do not make a folder a book.
  else if (kind === 'text' && ext !== '.md') sample.texts++
  if (ext === '.epub') sample.epubs++
  else if (comicTypes.includes(ext)) sample.comics++
  else if (sidecarTypes.includes(ext)) sample.sidecars++
  return sample
}
export const sampleOf = (entries: { kind: string; name?: string }[]): KindSample => {
  const sample = emptySample(),
    pictures: string[] = []
  for (const entry of entries)
    if (entry.kind !== 'folder' && entry.kind !== 'subtitle') {
      countFile(sample, entry.kind, entry.name)
      if (entry.kind === 'image' && entry.name) pictures.push(entry.name)
    }
  sample.pages = pageNumbered(pictures)
  return sample
}

// R-479: do the pictures' file names read as the pages of one book? Returns how many do, or 0 when they are not
// a book. Page names are plain numbers (any zero padding), p／page before the number, or one shared prefix with a
// number counting up (Pixiv's id_p0, id_p1). Cover, credit and info files are left out of the count; gallery-site
// and camera names (danbooru_…, IMG_0001, a date) are not pages. At least 80% of the pictures must follow the same
// pattern, the smallest page is 0 or 1, and the numbers run mostly without gaps.
const attachmentName =
    /^(cover|covers|credits?|info|colophon|end|ending|back|front|toc|thumbs?|thumbnail|folder|omake|bonus|extra)$/i,
  notPagePrefix =
    /^(danbooru|yande[._ ]?re|konachan|gelbooru|sankaku|safebooru|zerochan|img|dsc[nf]?|pxl|mvimg|image|photo|pict|screenshot|screen[ _-]?shot|wp|snap|capture|(19|20)\d{2}[-_.]?\d{2}[-_.]?\d{2})/i,
  pageName = /^(.*?)(\d+)([a-z])?(?:-(\d+))?$/i
export function pageNumbered(names: string[]): number {
  const stems = names
    .map((name) => (name.lastIndexOf('.') > 0 ? name.slice(0, name.lastIndexOf('.')) : name).trim())
    .filter((stem) => !attachmentName.test(stem))
  if (stems.length < 3) return 0
  const groups = new Map<string, number[][]>()
  for (const stem of stems) {
    const m = pageName.exec(stem)
    if (!m || m[2].length > 4 || notPagePrefix.test(m[1])) continue
    const prefix = m[1].toLowerCase().replace(/[\s_-]+$/, ''),
      key = /^(p|pg|page)$/.test(prefix) ? 'p' : prefix,
      from = Number(m[2]),
      to = m[4] === undefined ? from : Number(m[4])
    groups.set(key, [...(groups.get(key) ?? []), [from, Math.max(from, to)]])
  }
  const best = [...groups.values()].sort((a, b) => b.length - a.length)[0]
  if (!best || best.length * 5 < stems.length * 4) return 0
  const covered = new Set<number>()
  for (const [from, to] of best)
    for (let n = from; n <= Math.min(to, from + 9999); n++) covered.add(n)
  const first = Math.min(...covered),
    last = Math.max(...covered)
  return first <= 1 && covered.size * 5 >= (last - first + 1) * 4 ? best.length : 0
}

// R-479: signs that a folder of pictures is a manga whatever its file names say: it was filled from a manga site
// or has been read in manga mode.
const mangaSites = ['eh', 'exh', 'hitomi', 'nhentai', 'mangadex', 'mangaupdates']
const readAsManga = (row: FolderRow) =>
  row.record?.details?.reading?.mode === 'manga' ||
  !!row.record?.attributes.some(
    (a) => a.sourceRecord && mangaSites.includes(a.sourceRecord.provider)
  )

export type KindSource = 'manual' | 'game' | 'content' | 'default'
export interface DetectedKind {
  kind: FolderKind
  source: KindSource
}
// Order: what you set by hand, then a detected game (its boundary protection applies in any project), then what the files look like: video, music, text book, manga. Unsure means general.
// PDF and plain ZIP files never decide a kind. Rules: docs/UI_RULES.md (資料夾類型).
// R-404: folders that only hold an album's or release's extras. The whole name (a number may follow) decides.
const extrasName = /^(scans?|booklet|artworks?|covers?|bk|ジャケット|特典|スキャン)[\s_]*\d*$/i
export const isExtrasFolderName = (name: string | undefined) =>
  !!name && extrasName.test(name.trim())

export function detectFolderKind(
  row: FolderRow,
  sample?: KindSample,
  // The kind of the folder directly above (from its own files, one level only); music or video there means pictures
  // in this folder are extras, not manga. Left out where the parent is not known.
  parentKind?: FolderKind
): DetectedKind {
  const manual = row.record?.details?.kind
  if (manual) return { kind: manual, source: 'manual' }
  if (isGameFolder(row)) return { kind: 'game', source: 'game' }
  if (sample && sample.total > 0) {
    const { images, videos, audio, total } = sample,
      texts = sample.texts ?? 0,
      epubs = sample.epubs ?? 0
    if (videos >= 1 && videos >= images) return { kind: 'video', source: 'content' }
    // Music: more than half of the files, not counting what comes with an album (cue sheets, lyrics, playlists)
    // and its cover pictures. Pictures count once there are more of them than tracks.
    const beside = (sample.sidecars ?? 0) + (images <= audio ? images : 0)
    if (audio >= 1 && audio * 2 > total - beside) return { kind: 'music', source: 'content' }
    // Text books: any EPUB, or TXT files making up at least half.
    if (epubs >= 1 || (texts - epubs >= 1 && (texts - epubs) * 2 >= total))
      return { kind: 'book', source: 'content' }
    // Manga: mostly pictures, or a comic archive. Videos or music among them make it undecidable (an album with
    // many scans, a book with drama tracks), and an undecidable folder is general. Pictures alone do not decide it
    // inside a music or video folder, or in a folder named like album extras (R-404).
    const extras = parentKind === 'music' || parentKind === 'video' || isExtrasFolderName(row.name)
    // R-479: pictures alone make a manga only when their names are page numbers (or it was read or imported as one).
    const pictures =
      images >= 3 && images * 2 > total && !extras && ((sample.pages ?? 0) > 0 || readAsManga(row))
    if (videos === 0 && audio === 0 && (pictures || (sample.comics ?? 0) >= 1))
      return { kind: 'book', source: 'content' }
  }
  return { kind: 'general', source: 'default' }
}

// The kind the interface follows for a folder: what you set, what it is detected as, else general.
export const effectiveKind = (
  row: FolderRow,
  sample?: KindSample,
  parentKind?: FolderKind
): FolderKind => detectFolderKind(row, sample, parentKind).kind
