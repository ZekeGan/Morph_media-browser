import { bookCover, panelCover, visibleCells } from './layouts'
export { bookCover }
import type { MetadataSourceId, SearchSourceId } from './sources'
import type { StableQuery } from './query'
import type { Notice } from './notifications'
import type { Attribute, AssetRole, Cell, Snapshot } from './model'
export type BrowseMode = 'CARD' | 'TREE' | 'TABLE'
// The file list's own choices in the right panel, kept per project so they survive closing the panel or the project.
export interface MediaPrefs {
  scope?: 'current' | 'descendants'
  filter?: 'all' | 'video' | 'image' | 'audio' | 'other'
  view?: 'masonry' | 'tiles' | 'list'
  grouped?: boolean
}
export interface BrowseState {
  mode: BrowseMode
  location: string
  locations?: Partial<Record<BrowseMode, string>>
  widths: Record<string, number>
  columnOrder?: string[]
  hiddenColumns?: string[]
  treeCollapsed?: string[]
  panelWidth: number
  panelVisible?: boolean
  /** Legacy: settings always dock in the right panel now; kept so older saved preferences stay valid. */
  settingsDock?: boolean
  detailId?: string
  contentMode?: 'folders' | 'files'
  filePresentation?: 'tiles' | 'groups' | 'list'
  fileScope?: 'current' | 'descendants'
  // Game projects: show every folder or only the ones that are game boundaries.
  gameFilter?: 'all' | 'boundaries'
  media?: MediaPrefs
  scroll?: number
  scrolls?: Partial<Record<BrowseMode, number>>
  viewport?: { x: number; y: number; zoom: number }
}
export interface GameBoundary {
  state: 'root' | 'not-game' | 'candidate'
  engines: string[]
  evidence: string[]
  // R-457 (provisional): a confirmed ROOT that is a tool (a program), not a game: protected the same way, not shown
  // as a game.
  role?: 'tool'
}
export interface ReadingPrefs {
  mode?: 'image' | 'manga'
  page?: number
  fit?: 'height' | 'width' | 'original'
  spread?: boolean
  rtl?: boolean
  firstSingle?: boolean
  // R-256: webtoon mode (pages in one continuous column), its width in percent of the window, and whether the
  // "looks like a webtoon" suggestion was already answered for this book.
  webtoon?: boolean
  webtoonWidth?: number
  webtoonAsked?: boolean
}
// R-407 (tentative): the page a comic archive (CBZ, CBR, CB7) in the folder was left on, counted from 0, the number of
// pages it had, and when it was last read.
export interface VolumeProgress {
  page: number
  total: number
  updated: string
}
// R-282: the place in a text book (chapter, and the share of that chapter read), the share of the whole book, when
// it was last read, and the user's bookmarks.
export interface NovelProgress {
  chapter: number
  position: number
  percent: number
  updated: string
  bookmarks?: { chapter: number; position: number; label: string }[]
}
// A text book as the novel reader gets it: plain text chapters (TXT) or chapter XHTML with image addresses (EPUB).
export interface NovelBook {
  format: 'txt' | 'epub'
  // R-399: a .md file (format is still 'txt'): shown typeset, with a switch to the plain text.
  markdown?: boolean
  title: string
  // R-338: from the EPUB package (dc:creator, the cover image); a summary leaves the chapters' text out.
  author?: string
  // R-390: from dc:identifier when it is an ISBN, as digits.
  isbn?: string
  cover?: string
  encoding: string
  chapters: { title: string; text?: string; html?: string; path?: string }[]
  images?: Record<string, string>
}
export interface SubtitlePrefs {
  offset: number
  size: number
  bottom: number
  color: string
  background: string
  encoding: 'utf-8' | 'big5' | 'shift_jis'
}
// R-432: a track is known by its own name and language, since its number differs from video to video.
export interface SubtitleTrackPreference {
  name?: string
  language?: string
}
export const gameExtras = ['steam', 'store', 'save'] as const
export type GameExtra = (typeof gameExtras)[number]
export interface FolderDetails {
  // Set by hand; without it the kind is detected (see shared/kind.ts).
  kind?: import('./kind').FolderKind
  // R-340 (provisional): in "all works", this folder is one work, or a collection to look through, whatever it holds.
  browseAs?: 'work' | 'collection'
  cellImages?: Record<string, string>
  // Game actions whose button is not shown in this folder's action row.
  hiddenActions?: string[]
  // R-315: the game page's own buttons are hidden until the eye in the game settings shows them.
  shownExtras?: GameExtra[]
  schemaVersion: 1
  boundary?: GameBoundary
  bannerAssetId?: string
  reading?: ReadingPrefs
  playback?: Record<
    string,
    { time: number; subtitle?: string; settings?: Record<string, SubtitlePrefs> }
  >
  // R-432 (provisional): the embedded subtitle track last picked in this folder; the other videos open with the track
  // of the same name, else the same language.
  subtitleTrack?: SubtitleTrackPreference
  targets?: Record<
    string,
    {
      kind: ActionKind
      path: string
      relative: boolean
      args: string[]
      application?: { path: string; relative: boolean }
      // EXE actions only (R-309, R-319): start through Locale Emulator's LEProc.exe; true is its
      // default (Japanese) profile, a GUID one of the profiles made in Locale Emulator (Simplified Chinese…).
      localeEmulator?: true | string
    }
  >
  // R-282: where each text book in the folder was left, by file name.
  novels?: Record<string, NovelProgress>
  // R-407 (tentative): where each comic archive in the folder was left, by file name. The reading settings (spread,
  // direction, webtoon…) are shared by the whole folder and stay in `reading`.
  volumes?: Record<string, VolumeProgress>
  // R-305: the save folder the user picked when it could not be worked out from the engine.
  saveFolder?: { path: string; relative: boolean }
  subtitles?: { id: string; name: string; relativePath: string }[]
}
// 'shortcut': a .lnk/.url file inside the game folder, opened through the system so its own arguments and compatibility settings apply.
// 'file': a file inside the game folder (a manual, a readme) opened with the system's default application (R-306).
export type ActionKind = 'exe' | 'folder' | 'file-app' | 'url' | 'shortcut' | 'file'
// A 'file' action opens documents only: opening a program or script this way would run it. CHM help files are left out:
// they can carry scripts and start programs.
export const documentFile = (name: string) => /\.(pdf|html?|txt|md|rtf)$/i.test(name)
export interface ActionTemplate {
  id: string
  label: string
  kind: ActionKind
  color: string
}
// Actions that start the game (as opposed to opening a folder or a web page); the launch cell offers these.
export const launchTemplates = (project: { actionTemplates?: ActionTemplate[] }) =>
  gameActionTemplates(project).filter((t) => ['exe', 'file-app', 'shortcut'].includes(t.kind))
// The action a launch cell starts: its chosen one, else the default launch action, else the first one that can launch.
export const launchTemplate = (
  project: { actionTemplates?: ActionTemplate[] },
  actionId?: string
) => {
  const all = launchTemplates(project)
  return (
    all.find((t) => t.id === actionId) ?? all.find((t) => t.id === 'default-launch-game') ?? all[0]
  )
}
// What a launch cell starts for one folder: its action, or the first fallback action that this folder has a target for
// (some games start from an EXE, others from a shortcut). With none bound, the main action is reported so the cell
// shows it as not bound yet.
export const launchChoice = (
  project: { actionTemplates?: ActionTemplate[] },
  actionId: string | undefined,
  fallbackIds: string[] | undefined,
  targets: Record<string, { kind: string }> | undefined
) => {
  // R-409: the cell may name any game action (a folder, a page, a manual), not only one that starts the game.
  const main =
      gameActionTemplates(project).find((t) => t.id === actionId) ??
      launchTemplate(project, actionId),
    all = launchTemplates(project),
    chain = [main, ...(fallbackIds ?? []).map((id) => all.find((t) => t.id === id))].filter(
      (t): t is ActionTemplate => !!t
    )
  return chain.find((t) => targets?.[t.id]?.kind === t.kind) ?? main
}
// R-397: what a game folder still lacks to start: 'action' when the project has no launch action at all, 'target' when
// the main launch action has nothing bound for this folder, else undefined. Does not depend on the default action's id,
// since a project may have replaced or removed it.
export const launchGap = (
  project: { actionTemplates?: ActionTemplate[] },
  targets: Record<string, { kind: string }> | undefined
): 'action' | 'target' | undefined => {
  const main = launchTemplate(project)
  if (!main) return 'action'
  return targets?.[main.id]?.kind === main.kind ? undefined : 'target'
}
export const gameActionTemplates = (project: {
  actionTemplates?: ActionTemplate[]
}): ActionTemplate[] =>
  project.actionTemplates ?? [
    { id: 'default-launch-game', label: '啟動遊戲', kind: 'exe', color: '#168c77' },
  ]
export interface MediaEntry {
  id: string
  name: string
  kind: 'image' | 'video' | 'audio' | 'subtitle' | 'folder' | 'other' | 'archive' | 'pdf' | 'text'
  size: number
  modified: number
  mime: string
  url: string
  thumb?: string
  hidden?: boolean
}
export interface ContentResult {
  entries: MediaEntry[]
  notices: string[]
  nextCursor?: string
  total?: number
}
export interface OverviewEntry extends MediaEntry {
  rowId: string
  folderName: string
  sourcePath: string
}
export interface OverviewResult {
  entries: OverviewEntry[]
  notices: string[]
  nextCursor?: string
  complete: boolean
  foldersVisited: number
  foldersTotal: number
}
export interface SearchHit {
  rowId: string
  projectId: string
  name: string
  path: string
  matched: string[]
}
export interface SearchResult {
  resolvedQuery?: string
  hits: SearchHit[]
  total: number
  fields: { key: string; type: string; projectId: string; attributeId: string }[]
  incomplete: string[]
  parsed: string
  index: string
}
export interface MetadataPreview {
  provider?: MetadataSourceId
  token: string
  title: string
  source: string
  values: { key: string; type: string; value: unknown }[]
  image?: string
  // R-359: the same work on another source, offered for a separate preview (never merged into this one).
  related?: { provider: MetadataSourceId; url: string; title: string }
  // R-422: the source's pictures (screenshots, hero, logo, icon) as data addresses, in the order main keeps them;
  // the import names the ones to keep by position. n is the screenshot's number.
  images?: { role: AssetRole; n?: number; image: string }[]
  // R-449: a MusicBrainz album's versions (releases), the one merged in (absent: album data only), whether it was
  // chosen because its track count matches the folder's music files ('match'), or as the earliest official version
  // when none matched ('fallback'), and the album's own cover beside the version's.
  versions?: MetadataVersion[]
  version?: string
  versionPick?: 'match' | 'fallback' | 'chosen'
  albumImage?: string
}
// R-449: one version of an album as the version menu lists it.
export interface MetadataVersion {
  id: string
  date?: string
  country?: string
  formats?: string
  tracks?: number
  label?: string
  catalog?: string
  official: boolean
  matches?: boolean
}
export type ExplorerRequest =
  | { action: 'archive'; rowId: string; fileId: string }
  | {
      action: 'overview'
      rowId: string
      scope: 'current' | 'descendants'
      limit?: number
      cursor?: string
    }
  | { action: 'openExternal'; url: string }
  // Playback failure help: classify a file by its first bytes, open it with the system default app, or show it in Explorer.
  | { action: 'fileProbe' | 'openFile' | 'revealFile'; rowId: string; fileId: string }
  | {
      action: 'search'
      query: string
      queryAst?: StableQuery
      projectId?: string
      offset?: number
      limit?: number
    }
  | { action: 'content'; rowId: string; limit?: number; cursor?: string }
  | { action: 'visit'; rowId: string }
  | { action: 'attributes'; rowId: string; revision: number; values: Attribute[]; private: boolean }
  | { action: 'removeSource'; rowId: string; revision: number; provider: string }
  | { action: 'browseAs'; rowId: string; revision: number; value: 'work' | 'collection' | null }
  | {
      action: 'batch'
      rows: { rowId: string; revision: number }[]
      attributeId: string
      value: unknown
      mode: 'replace' | 'add' | 'remove'
    }
  | { action: 'reading'; rowId: string; revision: number; prefs: ReadingPrefs }
  | {
      action: 'folderKind'
      rowId: string
      revision: number
      kind: import('./kind').FolderKind | null
    }
  | {
      action: 'folderKinds'
      rows: { rowId: string; revision: number }[]
      kind: import('./kind').FolderKind | null
    }
  | {
      action: 'playback'
      rowId: string
      revision: number
      fileId: string
      time: number
      subtitle?: string
      settings?: SubtitlePrefs
    }
  | {
      action: 'boundary'
      rowId: string
      revision: number
      state: 'root' | 'not-game' | 'candidate'
      traverse?: boolean
      // R-457: with state root, true makes it a tool; any other change leaves the folder a game or not-game.
      tool?: boolean
    }
  | { action: 'banner'; rowId: string; revision: number; assetId: string }
  | { action: 'cellImage'; rowId: string; revision: number; cellId: string; assetId: string | null }
  | { action: 'deleteImage'; rowId: string; revision: number; assetId: string }
  | {
      action: 'bindTarget'
      rowId: string
      revision: number
      templateId: string
      args: string[]
      url?: string
      // File name (not a path) of a shortcut inside the game folder, for 'shortcut' actions.
      shortcut?: string
      // EXE actions: start through Locale Emulator (R-309).
      localeEmulator?: boolean
    }
  | {
      action: 'actionVisible'
      rowId: string
      revision: number
      templateId: string
      visible: boolean
    }
  | { action: 'listShortcuts'; rowId: string }
  | { action: 'runTarget'; rowId: string; templateId: string }
  // R-305–R-310: what the game folder offers beyond its bound actions, worked out by main.
  | { action: 'gameExtras'; rowId: string }
  | { action: 'gameAvailability'; rowIds: string[] }
  | { action: 'runExtra'; rowId: string; extra: 'steam' | 'store' | 'save' }
  | { action: 'chooseSaveFolder'; rowId: string; revision: number; clear?: boolean }
  // R-306: bind a suggested file (by its name in the game folder) as an action.
  | { action: 'addSuggestion'; rowId: string; revision: number; name: string }
  | { action: 'chooseLocaleEmulator'; clear?: boolean }
  | { action: 'chooseFlashPlayer'; clear?: boolean }
  // R-431: the external video player (app settings), and opening a video in it (time = where to start, seconds).
  | { action: 'chooseVideoPlayer'; clear?: boolean }
  | { action: 'openExternalPlayer'; rowId: string; fileId: string; time?: number }
  // R-432: remember the embedded subtitle track picked in this folder (no fields = forget it).
  | {
      action: 'subtitleTrack'
      rowId: string
      revision: number
      name?: string
      language?: string
    }
  | {
      action: 'targetLocale'
      rowId: string
      revision: number
      templateId: string
      value: boolean | string
    }
  // R-282: open a text book, and keep where it was left.
  // R-285: website keys. Values only ever travel from the window to main, never back.
  | { action: 'keyStatus' }
  | { action: 'setKey'; site: string; values: Record<string, string> }
  | { action: 'clearKey'; site: string }
  | { action: 'testKey'; site: string }
  | { action: 'novel'; rowId: string; fileId: string; summary?: boolean }
  // R-390: the tags and length of some audio files of one folder (at most 24 a request), read without their covers.
  | { action: 'audioTags'; rowId: string; fileIds: string[] }
  // R-438: what cards say about album and video folders (file counts, the album's name, artist, year and length),
  // for the folders on screen (at most 60 a request), from a local index. Folders that cannot be read are left out.
  | { action: 'folderFacts'; rowIds: string[] }
  // Only this book's place changes, so main writes it against the record's current revision.
  | { action: 'novelProgress'; rowId: string; fileId: string; progress: NovelProgress }
  // R-407: the place in a comic archive, and (when the reader changed them) the folder's shared reading settings.
  | {
      action: 'volumeProgress'
      rowId: string
      fileId: string
      page: number
      total: number
      prefs?: ReadingPrefs
    }
  | {
      action: 'subtitle'
      rowId: string
      fileId?: string
      externalToken?: string
      import?: boolean
      encoding?: string
    }
  | { action: 'chooseSubtitle'; rowId: string }
  // R-412: the subtitle tracks inside an MKV/WebM video, and one of them as subtitle text.
  // R-417: early answers as soon as the track list is known (reading goes on in the background) and gives a track's
  // cues read so far; time is the playback position to read first.
  | { action: 'embeddedSubtitles'; rowId: string; fileId: string; early?: boolean }
  | {
      action: 'embeddedSubtitle'
      rowId: string
      fileId: string
      track: number
      early?: boolean
      time?: number
    }
  // R-421: the picture cues of a VobSub track around a playback time.
  | {
      action: 'embeddedPictures'
      rowId: string
      fileId: string
      track: number
      early?: boolean
      time?: number
    }
  | { action: 'imageUrlPreview'; url: string }
  | { action: 'imageUrlApply'; rowId: string; revision: number; token: string; cover: boolean }
  | {
      action: 'metadataPreview'
      source: string
      provider?: MetadataSourceId
      // R-449 (MusicBrainz albums): the version to merge in (a release ID), null for album data only, absent to pick
      // one; trackCount is the folder's music file count the pick compares with.
      release?: string | null
      trackCount?: number
    }
  | { action: 'metadataSearch'; query: string; sources?: SearchSourceId[] }
  | {
      action: 'metadataApply'
      rowId: string
      revision: number
      token: string
      keys: string[]
      image: boolean
      mode?: 'fill' | 'replace'
      // R-422: positions in the preview's images to keep.
      images?: number[]
      // R-449: also keep the album's own cover (MusicBrainz), beside or instead of the version's.
      albumImage?: boolean
    }
  | { action: 'rebuildIndex' }
export interface ExplorerResponse {
  overview?: OverviewResult
  snapshot?: Snapshot
  content?: ContentResult
  search?: SearchResult
  // R-417: partial = an embedded track still being read; what is here so far.
  subtitle?: { token: string; name: string; text: string; portable: boolean; partial?: boolean }
  // R-417: reading = the tracks' cues are still being read (early answer).
  embedded?: { fileId: string; tracks: EmbeddedSubtitleInfo[]; reading?: boolean }
  pictures?: EmbeddedPictures
  shortcuts?: string[]
  extras?: GameExtras
  availability?: Record<string, GameAvailability>
  novel?: NovelBook
  // By file id; a file that cannot be read has an empty entry.
  audioTags?: Record<string, import('./album').AudioTags>
  folderFacts?: Record<string, FolderFacts>
  keys?: Record<string, import('./keys').KeyStatus>
  localeEmulator?: string
  flashPlayer?: string
  videoPlayer?: string
  probe?: { kind: 'zip' | 'rar' | '7z' | 'gzip' | 'html' | 'empty' | 'media' | 'unknown' }
  preview?: MetadataPreview
  // R-418: candidates from a name search, and the sources that could not answer.
  candidates?: MetadataCandidate[]
  failedSources?: MetadataSourceId[]
  imagePreview?: { token: string; image: string; name: string; size: number }
  cancelled?: boolean
  notice?: Notice
}
// R-418: one search result; picking it previews its address like a pasted one.
export interface MetadataCandidate {
  provider: MetadataSourceId
  title: string
  // Year, artist or type: whatever helps tell candidates apart.
  detail?: string
  url: string
  // C-143: the source says the work is adult.
  adult?: boolean
}
// Game page extras (R-305–R-310). Paths stay in main; the window only learns what can be offered.
// R-409: whether each extra button of a game can be used now; `reason` (a sentence to translate) says why not.
export type GameAvailability = Record<GameExtra, { ok: boolean; reason?: string; site?: string }>
export interface GameExtras {
  // Steam App ID from steam_appid.txt or the folder's Steam source; steamReady is false when no Steam is installed.
  steamAppId?: string
  steamReady: boolean
  storeUrl?: string
  // R-316: the store's name for the button ("Open in Steam").
  storeSite?: string
  // Where the save folder comes from: worked out from the engine, picked by the user, worked out but not created yet
  // (no saves so far, R-384), or not known.
  save: 'engine' | 'user' | 'pending' | 'none'
  saveEngine?: string
  // Bundled tools and manuals at the top of the game folder, not yet bound as actions.
  suggestions: { name: string; role: 'config' | 'manual' }[]
  localeEmulator: boolean
  // R-319: the profiles made in Locale Emulator (LEConfig.xml next to LEProc.exe), by GUID.
  localeProfiles?: { guid: string; name: string }[]
  // R-320: whether a Flash player is set, so an .swf action can start.
  flashPlayer?: boolean
}
// R-412: one subtitle track of a video. A graphic track (PGS, VobSub) is listed but has nothing to show as text.
export interface EmbeddedSubtitleInfo {
  number: number
  language?: string
  name?: string
  format?: 'srt' | 'ass' | 'ssa' | 'vtt'
  default?: boolean
  forced?: boolean
  graphic: boolean
  // R-421: a graphic track whose pictures can be shown (VobSub).
  picture?: boolean
  // R-425: the track went past the limits and only part of it was read.
  truncated?: boolean
  cues: number
}
// R-421: a stretch of a picture track. Cues are placed in a frame of width × height and drawn with the palette
// (0xRRGGBB); data is one VobSub packet in base64, decoded by the window. The stretch covers from–until seconds
// (no until: to the end of the track); partial = the track is still being read.
export interface EmbeddedPictures {
  token: string
  name: string
  width: number
  height: number
  palette: number[]
  from: number
  until?: number
  cues: { start: number; end: number; data: string }[]
  partial?: boolean
}
export interface SubtitleProgress {
  rowId: string
  fileId: string
  fraction: number
}
export interface ExplorerApi {
  request(request: ExplorerRequest): Promise<ExplorerResponse>
  // R-412: how far the reading of a video's subtitle tracks has come (0 to 1).
  onSubtitleProgress(callback: (progress: SubtitleProgress) => void): () => void
  dropSubtitle(rowId: string, file: File): Promise<ExplorerResponse>
}
// R-438: see electron/media-facts.ts. `duration` is missing until every track's length has been read.
export interface FolderFacts {
  audio: number
  video: number
  album?: string
  artist?: string
  year?: number
  duration?: number
}
export const newDetails = (): FolderDetails => ({ schemaVersion: 1 })
export const defaultSubtitle = (): SubtitlePrefs => ({
  offset: 0,
  size: 24,
  bottom: 8,
  color: '#ffffff',
  background: '#000000',
  encoding: 'utf-8',
})
export const isFieldKind = (kind: string) => kind.startsWith('field-')
export const cellType = (kind: string) =>
  ({
    'field-text': 'string',
    'field-tags': 'tags',
    'field-number': 'number',
    'field-date': 'datetime',
    'field-boolean': 'boolean',
    'field-enum': 'enum',
    'field-url': 'url',
    'field-date-only': 'date',
  })[kind] ?? 'string'
// R-409, R-437: the right panel a kind shows until a layout is chosen for it: a book its template (cover and the
// card's fields), music the cover with the album's facts, video the cover with the video count and 播放, a game the
// cover (its page draws it); the others nothing, since the panel header already names the folder. The editor starts an
// empty one with the name and path.
const panelPart = (kind: Cell['kind'], grid: Cell['grid'] = { x: 0, y: 0, w: 12, h: 4 }): Cell => ({
  cellId: kind,
  kind,
  grid,
  style: { textColor: '#e4e6e8', backgroundColor: 'transparent' },
})
const coverAndFacts = (cover: string, facts: Cell['kind']): Cell[] => [
  panelCover(cover, { x: 0, y: 0, w: 4, h: 4 }),
  panelPart(facts, { x: 4, y: 0, w: 8, h: 4 }),
]
export const builtinPanel = (project: { cells: Cell[] }, kind: string): Cell[] =>
  kind === 'book'
    ? bookTemplate(project)
    : kind === 'music'
      ? coverAndFacts('album-cover', 'album-facts')
      : kind === 'video'
        ? coverAndFacts('video-cover', 'video-facts')
        : []
// The built-in panel of a page that has listed the folder: another folder holding audio (not a video one, whose panel
// has the cover already) also shows its cover (R-294), found by the one cover rule.
export const builtinPanelFor = (
  project: { cells: Cell[] },
  kind: string,
  hasAudio: boolean
): Cell[] => {
  const cells = builtinPanel(project, kind)
  if (!hasAudio || kind === 'music' || kind === 'book' || kind === 'video') return cells
  return [
    panelCover('album-cover', { x: 0, y: 0, w: 4, h: 4 }),
    ...cells.map((cell) => ({ ...cell, grid: { ...cell.grid, y: cell.grid.y + 4 } })),
  ]
}
export const panelEditorStart = (project: { cells: Cell[] }, kind: string): Cell[] => {
  const cells = builtinPanel(project, kind)
  return cells.length
    ? cells
    : visibleCells(project).filter((c) => ['name', 'path'].includes(c.kind))
}
// A folder of text books with one EPUB (and no pictures) shows its book card above the book template.
export const withBookCard = (cells: Cell[]): Cell[] => [
  panelPart('book-card'),
  ...cells.map((cell) => ({ ...cell, grid: { ...cell.grid, y: cell.grid.y + 4 } })),
]

// The template a book starts with: the cover on the left and, on the right, the fields the project's cards show.
export function bookTemplate(project: { cells: Cell[] }): Cell[] {
  let y = 0
  const fields: Cell[] = []
  for (const cell of visibleCells(project).filter((cell) => cell.kind.startsWith('field-'))) {
    if (y + cell.grid.h > 100 || fields.length >= 49) break
    fields.push({ ...cell, grid: { x: 4, y, w: 8, h: cell.grid.h } })
    y += cell.grid.h
  }
  return [bookCover({ x: 0, y: 0, w: 4, h: Math.min(8, Math.max(4, y)) }), ...fields]
}
