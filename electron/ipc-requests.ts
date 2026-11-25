// Shape checks for requests arriving over IPC. TypeScript types do not exist at runtime, so every channel
// checks here that the action is known and each field has the expected primitive type before any work starts.
// Nested objects (a project, attributes, reading or playback settings, browse state) are only checked to be
// objects or arrays here; their contents are validated by the code that writes them (validateProject,
// validateDetails, WorkspaceStore).
import { localeProfileId, type Request } from '../shared/model'
import type { ExplorerRequest } from '../shared/explorer'
import type { WorkspaceCommand } from '../shared/workspace'
import { folderKinds } from '../shared/kind'
import { mediaSortFields } from '../shared/media'
import { isSearchSource, searchableSources } from '../shared/sources'

type Check = (v: unknown) => boolean
type Shape = Record<string, Check>

const plain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(v))
// Identifiers and tokens: a non-empty string of reasonable length.
export const ref = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 1000 && !v.includes('\0')
// Free text (names, search queries, URLs); may be empty.
const text: Check = (v) => typeof v === 'string' && v.length <= 100_000 && !v.includes('\0')
const num: Check = (v) => typeof v === 'number' && Number.isFinite(v)
const int: Check = (v) => Number.isSafeInteger(v)
// R-449: a MusicBrainz ID.
const uuid: Check = (v) =>
  typeof v === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v)
const bool: Check = (v) => typeof v === 'boolean'
const object: Check = plain
const any: Check = () => true
const opt =
  (check: Check): Check =>
  (v) =>
    v === undefined || check(v)
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v)
const oneOf =
  (...values: unknown[]): Check =>
  (v) =>
    values.includes(v)
const list =
  (check: Check, max = 10_000): Check =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(check)
const record =
  (check: Check, max = 10_000): Check =>
  (v) =>
    plain(v) && Object.keys(v).length <= max && Object.values(v).every(check)
const shape =
  (fields: Shape): Check =>
  (v) =>
    plain(v) && Object.entries(fields).every(([key, check]) => check(v[key]))

// R-492: the file list's sort, one known field and a direction.
const mediaSort = shape({ field: oneOf(...mediaSortFields), asc: bool })
const revisionRow = { rowId: ref, revision: int }
const rows = list(shape(revisionRow), 1000)

const library: Record<Request['action'], Shape> = {
  snapshot: {},
  scan: {},
  cancelScan: {},
  chooseRoot: {},
  link: { rootToken: opt(ref) },
  create: {
    input: shape({
      name: text,
      depth: shape({ mode: oneOf('through', 'exact'), level: int }),
      scanAll: opt(bool),
    }),
    rootToken: opt(ref),
  },
  saveProject: { project: object },
  unlink: { projectId: ref },
  removeProjectPreview: { projectId: ref },
  removeProject: { token: ref },
  fullRemovalPreview: { projectId: ref },
  fullRemoval: { token: ref },
  deleteFieldPreview: { projectId: ref, attributeId: ref },
  deleteField: { token: ref },
  unifyFieldPreview: { projectId: ref, attributeId: ref },
  unifyField: { token: ref },
  copyFieldValue: { rowId: ref, attributeId: ref },
  copyPath: { rowId: ref },
  restoreProject: { projectId: ref },
  saveFolder: { ...revisionRow, values: record(text) },
  image: { ...revisionRow, cellId: opt(ref) },
  open: { rowId: ref },
  restore: { rowId: ref },
  copyIdentity: { rowId: ref },
  resume: { rowId: ref },
  cleanupPreview: { rowId: ref, scope: oneOf('folder', 'private', 'tree') },
  cleanup: { token: ref, restart: bool },
  createBackup: {},
  listBackups: {},
  deleteBackup: { id: ref },
  exportBackup: { id: ref },
  previewBackup: { id: opt(ref) },
  locateBackup: { token: ref, projectId: ref },
  restoreBackup: { token: ref, settings: bool, projects: list(ref) },
}

const explorer: Record<ExplorerRequest['action'], Shape> = {
  archive: { rowId: ref, fileId: ref },
  overview: {
    rowId: ref,
    scope: oneOf('current', 'descendants'),
    limit: opt(int),
    cursor: opt(ref),
    sort: opt(mediaSort),
  },
  openExternal: { url: text },
  fileProbe: { rowId: ref, fileId: ref },
  openFile: { rowId: ref, fileId: ref },
  revealFile: { rowId: ref, fileId: ref },
  search: {
    query: text,
    queryAst: opt(object),
    projectId: opt(text),
    offset: opt(int),
    limit: opt(int),
  },
  content: { rowId: ref, limit: opt(int), cursor: opt(ref), sort: opt(mediaSort) },
  visit: { rowId: ref },
  warmThumbnails: { rowIds: list(ref, 100) },
  attributes: { ...revisionRow, values: list(object, 10_000), private: bool },
  batch: { rows, attributeId: ref, value: any, mode: oneOf('replace', 'add', 'remove') },
  reading: { ...revisionRow, prefs: object },
  folderKind: { ...revisionRow, kind: nullable(ref) },
  folderKinds: { rows, kind: nullable(ref) },
  playback: {
    ...revisionRow,
    fileId: ref,
    time: num,
    subtitle: opt(text),
    settings: opt(object),
  },
  boundary: {
    ...revisionRow,
    state: oneOf('root', 'not-game', 'candidate'),
    traverse: opt(bool),
    tool: opt(bool),
  },
  banner: { ...revisionRow, assetId: ref },
  cellImage: { ...revisionRow, cellId: ref, assetId: nullable(ref) },
  deleteImage: { ...revisionRow, assetId: ref },
  bindTarget: {
    ...revisionRow,
    templateId: ref,
    args: list(text, 100),
    url: opt(text),
    shortcut: opt(ref),
    localeEmulator: opt(bool),
  },
  actionVisible: { ...revisionRow, templateId: ref, visible: bool },
  listShortcuts: { rowId: ref },
  runTarget: { rowId: ref, templateId: ref },
  gameExtras: { rowId: ref },
  gameAvailability: { rowIds: list(ref, 60) },
  runExtra: { rowId: ref, extra: oneOf('steam', 'store', 'save') },
  chooseSaveFolder: { ...revisionRow, clear: opt(bool) },
  addSuggestion: { ...revisionRow, name: text },
  chooseLocaleEmulator: { clear: opt(bool) },
  chooseFlashPlayer: { clear: opt(bool) },
  chooseVideoPlayer: { clear: opt(bool) },
  openExternalPlayer: { rowId: ref, fileId: ref, time: opt(num) },
  subtitleTrack: { ...revisionRow, name: opt(text), language: opt(text) },
  removeSource: { ...revisionRow, provider: ref },
  targetLocale: {
    ...revisionRow,
    templateId: ref,
    value: (v) => typeof v === 'boolean' || localeProfileId(v),
  },
  novel: { rowId: ref, fileId: ref, summary: opt(bool) },
  audioTags: { rowId: ref, fileIds: list(ref, 24) },
  folderFacts: { rowIds: list(ref, 60) },
  keyStatus: {},
  setKey: { site: ref, values: record(text) },
  clearKey: { site: ref },
  testKey: { site: ref },
  novelProgress: { rowId: ref, fileId: ref, progress: object },
  volumeProgress: { rowId: ref, fileId: ref, page: int, total: int, prefs: opt(object) },
  subtitle: {
    rowId: ref,
    fileId: opt(ref),
    externalToken: opt(ref),
    import: opt(bool),
    encoding: opt(text),
  },
  chooseSubtitle: { rowId: ref },
  embeddedSubtitles: { rowId: ref, fileId: ref, early: opt(bool) },
  embeddedSubtitle: { rowId: ref, fileId: ref, track: int, early: opt(bool), time: opt(num) },
  embeddedPictures: { rowId: ref, fileId: ref, track: int, early: opt(bool), time: opt(num) },
  imageUrlPreview: { url: text },
  imageUrlApply: { ...revisionRow, token: ref, cover: bool },
  metadataPreview: {
    source: text,
    provider: opt(ref),
    release: opt(nullable(uuid)),
    trackCount: opt((v) => int(v) && (v as number) >= 0 && (v as number) <= 100_000),
  },
  metadataSearch: { query: text, sources: opt(list(isSearchSource, searchableSources.length)) },
  metadataApply: {
    ...revisionRow,
    token: ref,
    keys: list(ref),
    image: bool,
    mode: opt(oneOf('fill', 'replace')),
    images: opt(list(int, 15)),
    albumImage: opt(bool),
  },
  rebuildIndex: {},
}

const workspace: Record<WorkspaceCommand['action'], Shape> = {
  exportPackage: {},
  previewPackage: { value: any },
  applyPackage: { token: ref, mode: oneOf('merge', 'replace') },
  restorePackage: { backupId: ref },
  listBackups: {},
  videoAudio: { value: object },
  playOrder: { value: oneOf('stop', 'next', 'all', 'one') },
  appearance: { theme: ref, locale: ref },
  sourceLanguages: { value: list(ref, 10) },
  searchSources: {
    kind: oneOf(...folderKinds),
    value: list(isSearchSource, searchableSources.length),
  },
  createGroup: { name: text },
  renameGroup: { id: ref, name: text },
  removeGroup: { id: ref },
  collapseGroup: { id: ref, value: bool },
  moveProject: { projectId: ref, groupId: nullable(ref), beforeId: opt(ref) },
  reorderSections: { ids: list(ref) },
  reorderProject: { projectId: ref, sectionId: ref, beforeId: opt(ref) },
  favorite: { projectId: ref, value: bool },
  collapseSection: { section: oneOf('favorites', 'unclassified'), value: bool },
  layout: { sidebarWidth: opt(num), sidebarHidden: opt(bool) },
  browse: { projectId: ref, value: object },
}

function checker<T>(shapes: Record<string, Shape>) {
  return (v: unknown): v is T => {
    if (!plain(v) || typeof v.action !== 'string' || !Object.hasOwn(shapes, v.action)) return false
    return Object.entries(shapes[v.action]).every(([key, check]) => check(v[key]))
  }
}

export const isLibraryRequest = checker<Request>(library)
export const isExplorerRequest = checker<ExplorerRequest>(explorer)
export const isWorkspaceCommand = checker<WorkspaceCommand>(workspace)
