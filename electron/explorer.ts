// Main-process media, search-index, thumbnail, and metadata coordinator. Holds scoped caches and
// delegates listing, streaming, source import, overview, and request routing to sibling modules.
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import {
  type ContentResult,
  type ExplorerRequest,
  type ExplorerResponse,
  type MetadataPreview,
  newDetails,
  type OverviewResult,
} from '../shared/explorer'
import { dateOrText, validFieldValue } from '../shared/fields'
import type { KindSample } from '../shared/kind'
import type { MediaSort } from '../shared/media'
import { fmt } from '../shared/message'
import { type Attribute, type FolderRecord, validateDetails } from '../shared/model'
import { sameData } from '../shared/sameData'
import type { MetadataSourceId } from '../shared/sources'

import type { ArchiveIndex } from './archive'
import { foreignDispose } from './archive-foreign'
import type * as embeddedFns from './embedded-subtitles'
import * as contentFns from './explorer-content'
import { dispatchRequest } from './explorer-dispatch'
import * as overviewFns from './explorer-overview'
import * as sourceFns from './explorer-source'
import type { ThumbnailJob } from './explorer-stream'
import * as streamFns from './explorer-stream'
import { readFolder, relPath, safePath, saveFolder, within } from './files'
import type { ImageUrlOptions, RemoteImage } from './image-url'
import type { KeyStore } from './keys'
import type { Library } from './library'
import { MediaFacts } from './media-facts'
import { key, probeFile } from './media-files'
import type { EmbeddedTrack } from './mkv-subtitles'
import { SearchIndex } from './search-index'
import type { SourceImage } from './source-images'
import { warmThumbnails } from './thumbnail-warm'

export { probeFile }

// R-412: ASS and SSA scripts are read as text like SRT and VTT.
export const SUBTITLE_EXTENSIONS = ['.srt', '.vtt', '.ass', '.ssa']

export interface DesktopOperations {
  external?(url: string): Promise<void>
  choose(
    kind: 'exe' | 'game' | 'folder' | 'file' | 'subtitle',
    initialPath?: string
  ): Promise<string | undefined>
  open(file: string): Promise<void>
  reveal?(file: string): void
  // onExit is told when a started program ends (R-308 play time); it is not called when the program cannot be followed.
  launch(
    file: string,
    args: string[],
    onExit?: (started: number, ended: number) => void
  ): Promise<void>
  // R-307: whether some application handles this URL scheme (e.g. 'steam').
  protocolReady?(scheme: string): boolean
  // R-309: Locale Emulator's LEProc.exe from the app settings, and setting it.
  localeEmulator?(): string | undefined
  setLocaleEmulator?(file: string | undefined): Promise<void>
  // R-320: the program that plays .swf games, from the app settings, and setting it.
  flashPlayer?(): string | undefined
  setFlashPlayer?(file: string | undefined): Promise<void>
  // R-431: the program videos open in from the player's external-player button, and setting it.
  videoPlayer?(): string | undefined
  setVideoPlayer?(file: string | undefined): Promise<void>
  // R-381: the languages external sources are read in, first choice first (app settings).
  sourceLanguages?(): string[]
  // R-412: how far reading a video's subtitle tracks has come.
  subtitleProgress?(progress: { rowId: string; fileId: string; fraction: number }): void
  // R-285: the encrypted website keys (main only).
  keyStore?: KeyStore
  // R-308: a session of a game started from M:orph ended.
  played?(folderId: string, started: number, ended: number): void
  thumbnail(file: string, mime?: string, url?: string): Promise<Buffer>
}

interface CachedArchive {
  file: string
  index: ArchiveIndex
}

interface OverviewPageCache {
  rootId: string
  folderId: string
  scope: string
  folders: string[]
  folder: number
  contentCursor?: string
  sort?: MediaSort
  expires: number
}

interface ScopedFileEntry {
  rowId: string
  name: string
  file: string
  mime: string
  portable?: boolean
}

interface ExternalSubtitleEntry {
  rowId: string
  file: string
}

interface MetadataPreviewCache {
  preview: MetadataPreview
  cover?: { bytes: Buffer; mime: string; ext: string }
  // R-449: the album's own cover (MusicBrainz), when the version's is the main one.
  albumCover?: { bytes: Buffer; mime: string; ext: string }
  // R-422: the source's downloaded pictures; the preview names them by position.
  images?: SourceImage[]
  expires: number
}

interface ThumbnailJobState {
  promise: Promise<Buffer>
  signals: AbortSignal[]
}

interface ContentPageCache {
  rowId: string
  path: string
  folderId?: string
  names: string[]
  hidden: Set<string>
  sample: KindSample
  expires: number
}

interface FolderStatCache {
  folderModified: number
  expires: number
  facts: Map<string, { size: number; modified: number }>
}

export class Explorer {
  readonly index: SearchIndex
  readonly facts: MediaFacts

  // Scoped media, archive, subtitle & external-preview caches (accessed by sibling explorer-*.ts modules)
  archives = new Map<string, CachedArchive>()
  overviewPages = new Map<string, OverviewPageCache>()
  files = new Map<string, ScopedFileEntry>()
  externals = new Map<string, ExternalSubtitleEntry>()
  // R-412: subtitle tracks read from videos (a few kept in memory, the rest in the local cache) and the reads running.
  embeddedSubtitles = new Map<string, EmbeddedTrack[]>()
  embeddedJobs = new Map<string, embeddedFns.EmbeddedJob>()
  imagePreviews = new Map<string, RemoteImage & { expires: number }>()
  imageUrlOptions: ImageUrlOptions = {}
  previews = new Map<string, MetadataPreviewCache>()

  // Thumbnail queue, warm-up & audio-cover serialization
  thumbnailReads = 0
  audioCoverTail: Promise<unknown> = Promise.resolve()
  thumbnailJobs = new Map<string, ThumbnailJobState>()
  // R-441 / R-519: thumbnails waiting to be made (the newest burst first, top to bottom inside it) and how many are
  // being made now.
  thumbnailQueue: ThumbnailJob[] = []
  thumbnailActive = 0
  thumbnailBurst = { id: 0, at: -Infinity }
  thumbnailTrim?: Promise<void>
  thumbnailTrimAt = 0
  // R-505: the background thumbnail work running now, stopped by the next request.
  warming?: AbortController
  // Folders whose first pictures were all warmed in this session (not listed again on a restart).
  warmed = new Set<string>()

  // Paged content & sorted stat caches (R-504)
  contentPages = new Map<string, ContentPageCache>()
  // R-504: the size/date read of the newest sorted first request per caller (right panel, overview); a newer one
  // stops the older between groups of files.
  statReads = new Map<'panel' | 'overview', { stopped: boolean }>()
  // R-504: each folder's sizes and dates for a minute (while the folder's own time is unchanged), so switching back
  // sorts at once. Only the names' sizes and times, a few folders at a time.
  statCache = new Map<string, FolderStatCache>()

  private closed = false

  constructor(
    readonly library: Library,
    readonly root: string,
    readonly desktop: DesktopOperations
  ) {
    this.index = new SearchIndex(path.join(root, 'search.sqlite'))
    this.index.sync(library.snapshot())
    this.facts = new MediaFacts(path.join(root, 'media-facts.sqlite'))
  }

  // At most four opened archives are kept; the oldest goes first, and a RAR/7z one gives its in-memory copy back.
  // Only one RAR/7z copy (up to 512 MiB) stays in the WebAssembly memory at a time, so several never add up.
  remember(token: string, value: CachedArchive) {
    if (value.index.memory) {
      for (const [key, kept] of [...this.archives]) {
        if (kept.index.memory) {
          void foreignDispose(kept.index)
          this.archives.delete(key)
        }
      }
    }
    while (this.archives.size >= 4) {
      const oldest = this.archives.keys().next().value!
      void foreignDispose(this.archives.get(oldest)!.index)
      this.archives.delete(oldest)
    }
    this.archives.set(token, value)
  }

  // Both local indexes, on quit and when a test is done (Windows will not delete an open file).
  close() {
    if (this.closed) return
    this.closed = true
    this.warming?.abort()
    this.index.close()
    this.facts.close()
  }

  async record(rowId: string, revision: number) {
    const row = await this.library.checkedRow(rowId, true)
    const record = await readFolder(row.path)
    if (record.revision !== revision) {
      throw new Error('版本衝突；還沒保存的修改保留，重新載入後比較')
    }
    return { row, record }
  }

  async details(
    rowId: string,
    revision: number,
    mutate: (details: NonNullable<FolderRecord['details']>, record: FolderRecord) => void
  ) {
    const { row, record } = await this.record(rowId, revision)
    const before = structuredClone(record)
    record.details ??= newDetails()
    mutate(record.details, record)
    validateDetails(record.details)
    // R-474: a change that changes nothing (the reader saving the place it opened at) does not rewrite the
    // folder's record or raise its revision.
    if (!sameData(before, record)) await saveFolder(row.path, record, revision)
    return this.library.refreshRecord(rowId)
  }

  async targetPath(root: string, file: string, kind: 'exe' | 'game' | 'folder' | 'file') {
    if (!path.isAbsolute(file) || file.includes('\0')) throw new Error('目標路徑不合法')
    await safePath(path.parse(file).root, file)
    const target = await fs.realpath(file)
    const stat = await fs.stat(target)
    if (
      kind === 'folder'
        ? !stat.isDirectory()
        : !stat.isFile() ||
          (kind === 'exe' && path.extname(target).toLowerCase() !== '.exe') ||
          (kind === 'game' && !['.exe', '.swf'].includes(path.extname(target).toLowerCase()))
    ) {
      throw new Error('目標類型不符')
    }
    return {
      path: within(root, target) ? relPath(root, target) : target,
      relative: within(root, target),
    }
  }

  async resolvedTarget(
    root: string,
    target: { path: string; relative: boolean },
    kind: 'exe' | 'game' | 'folder' | 'file'
  ) {
    const file = target.relative ? path.join(root, target.path) : target.path
    if (target.relative) await safePath(root, file)
    await this.targetPath(root, file, kind)
    return file
  }

  async content(
    rowId: string,
    limit?: number,
    cursor?: string,
    sort?: MediaSort,
    caller: 'panel' | 'overview' = 'panel'
  ): Promise<ContentResult> {
    return contentFns.content(this, rowId, limit, cursor, sort, caller)
  }

  async file(rowId: string, id: string) {
    return contentFns.file(this, rowId, id)
  }

  async nthImage(
    rowId: string,
    index: number,
    request: globalThis.Request
  ): Promise<globalThis.Response> {
    return contentFns.nthImage(this, rowId, index, request)
  }

  async folderCover(rowId: string, request: globalThis.Request): Promise<globalThis.Response> {
    return contentFns.folderCover(this, rowId, request)
  }

  async audioCover(rowId: string, id: string, signal?: AbortSignal): Promise<globalThis.Response> {
    return streamFns.audioCover(this, rowId, id, signal)
  }

  async readAudioCover(rowId: string, id: string): Promise<globalThis.Response> {
    return streamFns.readAudioCover(this, rowId, id)
  }

  async stream(
    rowId: string,
    id: string,
    request: globalThis.Request,
    thumbnail = false
  ): Promise<globalThis.Response> {
    return streamFns.stream(this, rowId, id, request, thumbnail)
  }

  async archiveStream(
    rowId: string,
    fileId: string,
    token: string,
    number: string
  ): Promise<globalThis.Response> {
    return streamFns.archiveStream(this, rowId, fileId, token, number)
  }

  async thumbnail(
    cache: string,
    source: string,
    mime: string,
    size: number,
    signal: AbortSignal,
    url: string
  ) {
    return streamFns.thumbnail(this, cache, source, mime, size, signal, url)
  }

  async trimThumbnails() {
    return streamFns.trimThumbnails(this)
  }

  warmThumbnails(rowIds: string[]) {
    warmThumbnails(this, rowIds)
  }

  checkValue(a: Attribute, record: FolderRecord) {
    if (!key(a.attributeId) || typeof a.key !== 'string' || a.key.length > 100) {
      throw new Error('欄位身分不合法')
    }
    const valid = validFieldValue(a.type, a.value)
    if (!valid) throw new Error(fmt('欄位 {0} 的值與格式 {1} 不符', a.key, a.type))
    const old = record.attributes.find((v) => v.attributeId === a.attributeId)
    if (old && old.type !== a.type && !dateOrText(old.type, a.type)) {
      throw new Error('不能改變既有欄位的格式')
    }
  }

  async attributes(rowId: string, revision: number, values: Attribute[], privateValues: boolean) {
    if (
      !Array.isArray(values) ||
      values.length > 200 ||
      typeof privateValues !== 'boolean' ||
      new Set(values.map((v) => v.attributeId)).size !== values.length
    ) {
      throw new Error('欄位更新不合法')
    }
    const { row, record } = await this.record(rowId, revision)
    const project = this.library
      .snapshot()
      .projects.find((p) => p.projectId === row.projectId)!.project!
    const allowed = new Map([
      ...project.fieldBindings.map((f) => [f.attributeId, { key: f.alias, type: f.type }] as const),
      ...record.attributes.map((a) => [a.attributeId, a] as const),
    ])
    const target = privateValues
      ? (record.projectOverrides[row.projectId] ?? [])
      : record.attributes
    for (const value of values) {
      this.checkValue(value, record)
      const binding = allowed.get(value.attributeId)
      const defined = project.fieldBindings.find((f) => f.attributeId === value.attributeId)
      // A value is saved with the type it already has, or with the project's type for the field: a field switched
      // between text and date saves new values with its current type (R-240).
      if (!binding || (binding.type !== value.type && defined?.type !== value.type)) {
        throw new Error('欄位不存在或格式不符')
      }
      if (
        value.type === 'enum' &&
        !validFieldValue(
          value.type,
          value.value,
          project.fieldBindings.find((field) => field.attributeId === value.attributeId)?.options
        )
      ) {
        throw new Error('單選值不在選項內')
      }
      const old = target.find((a) => a.attributeId === value.attributeId)
      if (old && old.type !== value.type && !dateOrText(old.type, value.type)) {
        throw new Error('只在這個專案的值格式不符')
      }
      const a = {
        ...value,
        key: binding.key ?? ('alias' in binding ? binding.alias : ''),
        source: 'manual',
      }
      delete a.sourceRecord
      const i = target.findIndex((a) => a.attributeId === value.attributeId)
      if (i < 0) target.push(a)
      else target[i] = a
    }
    if (privateValues) record.projectOverrides[row.projectId] = target
    else record.attributes = target
    await saveFolder(row.path, record, revision)
  }

  async droppedSubtitle(rowId: string, filePath: string) {
    return this.chooseSubtitle(rowId, filePath)
  }

  async chooseSubtitle(rowId: string, filePath?: string): Promise<ExplorerResponse> {
    await this.library.checkedRow(rowId)
    const file = filePath ?? (await this.desktop.choose('subtitle'))
    if (!file) return { cancelled: true }
    if (!path.isAbsolute(file) || !SUBTITLE_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
      throw new Error('僅支援 SRT／VTT／ASS／SSA')
    }
    const real = await fs.realpath(file)
    const stat = await fs.stat(real)
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('字幕需為 5MB 以內的文字檔')
    const bytes = await fs.readFile(real)
    const token = 'ext-' + createHash('sha256').update(bytes).digest('hex')
    this.externals.set(`${rowId}/${token}`, { rowId, file: real })
    return {
      subtitle: {
        token,
        name: path.basename(real),
        text: new TextDecoder('utf-8').decode(bytes),
        portable: false,
      },
    }
  }

  async request(req: ExplorerRequest): Promise<ExplorerResponse> {
    return dispatchRequest(this, req)
  }

  async overview(
    request: Extract<ExplorerRequest, { action: 'overview' }>
  ): Promise<OverviewResult> {
    return overviewFns.overview(this, request)
  }

  after(snapshot: ReturnType<Library['snapshot']>): ExplorerResponse {
    this.index.sync(snapshot)
    return { snapshot }
  }

  async metadataPreview(
    source: string,
    provider?: MetadataSourceId,
    version?: { release?: string | null; trackCount?: number }
  ): Promise<MetadataPreview> {
    return sourceFns.metadataPreview(this, source, provider, version)
  }

  async imageUrlPreview(url: string) {
    return sourceFns.imageUrlPreview(this, url)
  }

  async applyImageUrl(req: Extract<ExplorerRequest, { action: 'imageUrlApply' }>) {
    return sourceFns.applyImageUrl(this, req)
  }

  async applyMetadata(req: Extract<ExplorerRequest, { action: 'metadataApply' }>) {
    return sourceFns.applyMetadata(this, req)
  }
}
