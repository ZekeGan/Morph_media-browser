// Runtime validation for portable folder records, folder details, and project definitions.
// Rejects malformed or newer-schema records before adoption or disk writes without mutating input.
import { GROW_KINDS, MAX_GROW_ROWS } from './cardGrid'
import { withOnlyCells } from './cellLists'
import { documentFile, type FolderDetails } from './explorer'
import { compatibleFieldTypes, httpUrl, validFieldValue } from './fields'
import { imageTypes } from './images'
import { isFolderKind } from './kind'
import {
  type Attribute,
  cellConditions,
  type FolderRecord,
  MAX_FALLBACKS,
  MAX_GROUP_MEMBERS,
  MAX_MORE_CONDITIONS,
  MAX_TEXT_RULES,
  type Project,
} from './modelTypes'
import { validStableQuery } from './query'
import { checkNotNewer, FORMAT_VERSION } from './upgrade'

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const TARGET_KINDS = ['exe', 'folder', 'file-app', 'url', 'shortcut', 'file']
const CELL_KINDS = [
  'name',
  'path',
  'field-text',
  'field-tags',
  'field-number',
  'field-date',
  'field-boolean',
  'field-enum',
  'field-url',
  'field-date-only',
  'static-text',
  'spacer',
  'system-info',
  'image',
  'divider',
  'open-folder',
  'game-launch',
  'video-play',
  'book-continue',
  'game-extra',
]
const SYSTEM_INFO_KINDS = [
  'category',
  'files',
  'size',
  'playTime',
  'lastPlayed',
  'readProgress',
  'lastRead',
  'engine',
  'albumName',
  'albumArtist',
  'albumYear',
  'trackCount',
  'totalLength',
  'videoCount',
  'bookTitle',
  'bookAuthor',
  'pages',
  'readPage',
]

// The type a field cell shows.
const FIELD_KIND_TYPES: Record<string, string> = {
  'field-text': 'string',
  'field-tags': 'tags',
  'field-number': 'number',
  'field-date': 'datetime',
  'field-boolean': 'boolean',
  'field-enum': 'enum',
  'field-url': 'url',
  'field-date-only': 'date',
}

const isPlainObject = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

// R-319: a Locale Emulator profile GUID (the only form passed to LEProc.exe -runas).
export const localeProfileId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)

const isValidId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9_-]{1,100}$/.test(value) &&
  !['__proto__', 'constructor', 'prototype'].includes(value)

const isIntInRange = (value: unknown, min: number, max: number) =>
  Number.isInteger(value) && Number(value) >= min && Number(value) <= max

const isBoundedText = (value: unknown, max = 10000): value is string =>
  typeof value === 'string' && value.length <= max

const isSafeRelativePath = (value: unknown): value is string =>
  isBoundedText(value) &&
  !value.startsWith('/') &&
  !value.includes('\\') &&
  !value.includes(':') &&
  !value.split('/').includes('..')

const isUnitRatio = (value: unknown): boolean =>
  typeof value === 'number' && value >= 0 && value <= 1

// R-413: { card?, panel? }, each { types?, levels?, folders? } whose values are layout ids; a level left unset is ''.
function isValidLayoutRule(rule: unknown): boolean {
  if (!isPlainObject(rule)) return false
  if (!Object.keys(rule).every((key) => ['types', 'levels', 'folders'].includes(key))) return false
  if (rule.types !== undefined) {
    if (!isPlainObject(rule.types)) return false
    if (
      !Object.entries(rule.types).every(([kind, layout]) => isFolderKind(kind) && isValidId(layout))
    ) {
      return false
    }
  }
  if (rule.levels !== undefined) {
    if (!Array.isArray(rule.levels) || rule.levels.length > 100) return false
    if (!rule.levels.every((layout) => layout === '' || isValidId(layout))) return false
  }
  if (rule.folders !== undefined) {
    if (!isPlainObject(rule.folders) || Object.keys(rule.folders).length > 50000) return false
    if (
      !Object.entries(rule.folders).every(
        ([folder, layout]) => isValidId(folder) && isValidId(layout)
      )
    ) {
      return false
    }
  }
  return true
}

function isValidLayoutRules(value: unknown): boolean {
  if (!isPlainObject(value)) return false
  if (!Object.keys(value).every((key) => key === 'card' || key === 'panel')) return false
  if (value.card !== undefined && !isValidLayoutRule(value.card)) return false
  if (value.panel !== undefined && !isValidLayoutRule(value.panel)) return false
  return true
}

function isValidAttribute(item: unknown): item is Attribute {
  if (!isPlainObject(item)) return false
  if (!isValidId(item.attributeId)) return false
  if (!isBoundedText(item.key, 100)) return false
  if (!isBoundedText(item.type, 40)) return false
  if (!isBoundedText(item.source, 100)) return false
  if (!('value' in item)) return false
  if (
    ['boolean', 'enum', 'url', 'date'].includes(item.type) &&
    !validFieldValue(item.type, item.value)
  ) {
    return false
  }
  if (item.sourceRecord !== undefined) {
    const source = item.sourceRecord
    if (!isPlainObject(source)) return false
    if (!isValidId(source.provider)) return false
    if (!isBoundedText(source.url, 2048) || !/^https:\/\//.test(source.url)) return false
    if (!isBoundedText(source.fetchedAt, 40) || !Number.isFinite(Date.parse(source.fetchedAt))) {
      return false
    }
  }
  return true
}

function isValidAsset(asset: unknown): boolean {
  if (!isPlainObject(asset)) return false
  if (!isValidId(asset.assetId)) return false
  if (!isSafeRelativePath(asset.relativePath)) return false
  if (!/^assets\/[a-zA-Z0-9_-]+\.(png|jpg|webp|gif|bmp|avif|ico)$/.test(asset.relativePath)) {
    return false
  }
  if (!isBoundedText(asset.originalName, 255)) return false
  if (!Object.values(imageTypes).includes(asset.mediaType)) return false
  if (asset.role !== undefined && !['screenshot', 'hero', 'logo', 'icon'].includes(asset.role)) {
    return false
  }
  return true
}

function isValidConditionShape(condition: unknown): boolean {
  if (!isPlainObject(condition)) return false
  if (!isValidId(condition.attributeId)) return false
  if (
    !['set', 'unset', 'equals', 'not-equals', 'gt', 'lt', 'within', 'older'].includes(
      condition.operator
    )
  ) {
    return false
  }
  if (['set', 'unset'].includes(condition.operator)) return condition.value === undefined
  if (['within', 'older'].includes(condition.operator)) {
    return isIntInRange(condition.value, 1, 36500)
  }
  return (
    typeof condition.value === 'boolean' ||
    (typeof condition.value === 'number' && Number.isFinite(condition.value)) ||
    isBoundedText(condition.value, 10000)
  )
}

function isValidFieldBinding(binding: unknown): boolean {
  if (!isPlainObject(binding)) return false
  if (!isBoundedText(binding.alias, 100)) return false
  if (!isValidId(binding.attributeId)) return false
  if (!isBoundedText(binding.type, 40)) return false
  if (binding.type === 'enum') {
    if (!Array.isArray(binding.options)) return false
    if (binding.options.length === 0 || binding.options.length > 100) return false
    if (new Set(binding.options).size !== binding.options.length) return false
    if (
      !binding.options.every(
        (option: unknown) => isBoundedText(option, 100) && option.trim().length > 0
      )
    ) {
      return false
    }
  }
  if (binding.trueLabel !== undefined) {
    if (
      binding.type !== 'boolean' ||
      !isBoundedText(binding.trueLabel, 20) ||
      binding.trueLabel.trim().length === 0
    ) {
      return false
    }
  }
  if (binding.falseLabel !== undefined) {
    if (
      binding.type !== 'boolean' ||
      !isBoundedText(binding.falseLabel, 20) ||
      binding.falseLabel.trim().length === 0
    ) {
      return false
    }
  }
  // Yes and no must read differently, or neither the card nor search could tell them apart.
  if (
    binding.trueLabel !== undefined &&
    binding.falseLabel !== undefined &&
    binding.trueLabel.trim().toLocaleLowerCase() === binding.falseLabel.trim().toLocaleLowerCase()
  ) {
    return false
  }
  if (binding.optionColors !== undefined) {
    if (binding.type !== 'enum' || !isPlainObject(binding.optionColors)) return false
    if (
      !Object.entries(binding.optionColors).every(
        ([option, color]) =>
          (binding.options as string[]).includes(option) &&
          typeof color === 'string' &&
          HEX_COLOR.test(color)
      )
    ) {
      return false
    }
  }
  return true
}

function isValidCell(cell: unknown): boolean {
  if (!isPlainObject(cell)) return false
  if (!isValidId(cell.cellId)) return false
  if (!CELL_KINDS.includes(cell.kind)) return false

  if (cell.text !== undefined && !isBoundedText(cell.text, 10000)) return false
  if (cell.systemInfo !== undefined && !SYSTEM_INFO_KINDS.includes(cell.systemInfo)) return false
  if (cell.presentation !== undefined) {
    const validBadge =
      cell.presentation === 'badge' && ['field-enum', 'field-boolean'].includes(cell.kind)
    const validNumeric =
      ['rating', 'progress'].includes(cell.presentation) && cell.kind === 'field-number'
    if (!validBadge && !validNumeric) return false
  }

  if (
    cell.imageFit !== undefined &&
    (!['contain', 'cover', 'blur'].includes(cell.imageFit) || cell.kind !== 'image')
  ) {
    return false
  }
  if (cell.fallbackIds !== undefined) {
    if (
      !cell.kind.startsWith('field-') ||
      !Array.isArray(cell.fallbackIds) ||
      cell.fallbackIds.length < 1 ||
      cell.fallbackIds.length > MAX_FALLBACKS ||
      !cell.fallbackIds.every(isValidId) ||
      new Set([cell.attributeId, ...cell.fallbackIds]).size !== cell.fallbackIds.length + 1
    ) {
      return false
    }
  }
  if (
    cell.groupId !== undefined &&
    (!cell.kind.startsWith('field-') || !isValidId(cell.groupId) || cell.fallbackIds !== undefined)
  ) {
    return false
  }
  if (cell.actionId !== undefined && (cell.kind !== 'game-launch' || !isValidId(cell.actionId))) {
    return false
  }
  if (
    cell.gameExtra !== undefined &&
    (cell.kind !== 'game-extra' || !['save', 'steam', 'store'].includes(cell.gameExtra))
  ) {
    return false
  }
  if (
    cell.imageIndex !== undefined &&
    (cell.kind !== 'image' || !isIntInRange(cell.imageIndex, 1, 999))
  ) {
    return false
  }
  if (
    cell.imageCover !== undefined &&
    (cell.kind !== 'image' || cell.imageCover !== true || cell.imageIndex !== undefined)
  ) {
    return false
  }
  if (
    cell.imageRole !== undefined &&
    (cell.kind !== 'image' ||
      !['hero', 'logo', 'icon'].includes(cell.imageRole) ||
      cell.imageIndex !== undefined ||
      cell.imageCover !== undefined)
  ) {
    return false
  }
  if (cell.fallbackActionIds !== undefined) {
    if (
      cell.kind !== 'game-launch' ||
      !Array.isArray(cell.fallbackActionIds) ||
      cell.fallbackActionIds.length < 1 ||
      cell.fallbackActionIds.length > MAX_FALLBACKS ||
      !cell.fallbackActionIds.every(isValidId) ||
      new Set([cell.actionId, ...cell.fallbackActionIds]).size !== cell.fallbackActionIds.length + 1
    ) {
      return false
    }
  }

  if (
    cell.scroll !== undefined &&
    (typeof cell.scroll !== 'boolean' ||
      !['field-text', 'field-tags', 'static-text'].includes(cell.kind))
  ) {
    return false
  }
  if (
    cell.growMax !== undefined &&
    (!isIntInRange(cell.growMax, 1, MAX_GROW_ROWS) ||
      !GROW_KINDS.includes(cell.kind) ||
      cell.scroll)
  ) {
    return false
  }
  if (
    cell.wrap !== undefined &&
    (typeof cell.wrap !== 'boolean' || !['field-text', 'name', 'path'].includes(cell.kind))
  ) {
    return false
  }
  if (cell.unit !== undefined && (cell.kind !== 'field-number' || !isBoundedText(cell.unit, 20))) {
    return false
  }
  if (
    cell.unitPosition !== undefined &&
    (cell.kind !== 'field-number' || !['prefix', 'suffix'].includes(cell.unitPosition))
  ) {
    return false
  }
  if (
    cell.decimals !== undefined &&
    (cell.kind !== 'field-number' || !isIntInRange(cell.decimals, 0, 6))
  ) {
    return false
  }
  if (
    cell.maximum !== undefined &&
    (cell.kind !== 'field-number' ||
      typeof cell.maximum !== 'number' ||
      !Number.isFinite(cell.maximum) ||
      cell.maximum <= 0 ||
      cell.maximum > 1e9)
  ) {
    return false
  }
  if (
    cell.copyValue !== undefined &&
    (!cell.kind.startsWith('field-') || typeof cell.copyValue !== 'boolean')
  ) {
    return false
  }

  if (cell.condition !== undefined && !isValidConditionShape(cell.condition)) return false
  if (cell.moreConditions !== undefined) {
    if (
      cell.condition === undefined ||
      !Array.isArray(cell.moreConditions) ||
      cell.moreConditions.length < 1 ||
      cell.moreConditions.length > MAX_MORE_CONDITIONS ||
      !cell.moreConditions.every(isValidConditionShape)
    ) {
      return false
    }
  }
  if (
    cell.conditionMode !== undefined &&
    (cell.conditionMode !== 'any' || cell.moreConditions === undefined)
  ) {
    return false
  }
  if (cell.textRules !== undefined) {
    if (
      cell.kind !== 'static-text' ||
      !Array.isArray(cell.textRules) ||
      cell.textRules.length < 1 ||
      cell.textRules.length > MAX_TEXT_RULES ||
      !cell.textRules.every(
        (rule: unknown) =>
          isPlainObject(rule) && isValidConditionShape(rule.when) && isBoundedText(rule.text, 1000)
      )
    ) {
      return false
    }
  }

  if (cell.kind.startsWith('field-') && !isValidId(cell.attributeId)) return false
  if (cell.kind === 'image' && cell.attributeId !== undefined && !isValidId(cell.attributeId)) {
    return false
  }
  if (!isPlainObject(cell.grid)) return false
  if (
    !isIntInRange(cell.grid.x, 0, 11) ||
    !isIntInRange(cell.grid.y, 0, 99) ||
    !isIntInRange(cell.grid.w, 1, 12) ||
    !isIntInRange(cell.grid.h, 1, 100) ||
    cell.grid.x + cell.grid.w > 12 ||
    cell.grid.y + cell.grid.h > 100
  ) {
    return false
  }
  if (!isValidStyle(cell.style)) return false
  if (
    cell.tagColors !== undefined &&
    (cell.tagColors !== 'namespace' || cell.kind !== 'field-tags')
  ) {
    return false
  }
  if (
    cell.tagPrefix !== undefined &&
    (typeof cell.tagPrefix !== 'boolean' || cell.kind !== 'field-tags')
  ) {
    return false
  }
  return true
}

// A component style: shared by cells and the project's saved styles.
function isValidStyle(style: unknown): boolean {
  if (!isPlainObject(style)) return false
  if (!HEX_COLOR.test(style.textColor)) return false
  if (style.backgroundColor !== 'transparent' && !HEX_COLOR.test(style.backgroundColor)) {
    return false
  }
  if (
    style.fontSize !== undefined &&
    !['xsmall', 'small', 'medium', 'large', 'xlarge'].includes(style.fontSize)
  ) {
    return false
  }
  if (style.align !== undefined && !['left', 'center', 'right'].includes(style.align)) return false
  if (style.valign !== undefined && !['top', 'center', 'bottom'].includes(style.valign)) {
    return false
  }
  if (style.weight !== undefined && !['light', 'normal', 'bold'].includes(style.weight)) {
    return false
  }
  if (
    !['italic', 'underline', 'strike'].every(
      (flag) => style[flag] === undefined || typeof style[flag] === 'boolean'
    )
  ) {
    return false
  }
  if (style.lineHeight !== undefined && !['tight', 'loose'].includes(style.lineHeight)) {
    return false
  }
  if (style.letterSpacing !== undefined && style.letterSpacing !== 'wide') return false
  if (style.padding !== undefined && !['compact', 'roomy'].includes(style.padding)) return false
  if (style.radius !== undefined && !['small', 'large'].includes(style.radius)) return false
  if (style.borderColor !== undefined && !HEX_COLOR.test(style.borderColor)) return false
  if (style.borderWidth !== undefined && !['thin', 'thick'].includes(style.borderWidth)) {
    return false
  }
  if (style.opacity !== undefined && !['soft', 'faint'].includes(style.opacity)) return false
  return true
}

function isValidTargetEntry([actionId, target]: [string, unknown]): boolean {
  if (!isValidId(actionId) || !isPlainObject(target)) return false
  if (!TARGET_KINDS.includes(target.kind)) return false
  if (!isBoundedText(target.path, 10000)) return false
  if (typeof target.relative !== 'boolean') return false
  if (target.relative && !isSafeRelativePath(target.path)) return false
  if (!Array.isArray(target.args) || target.args.length > 100) return false
  if (
    !target.args.every((arg: unknown) => isBoundedText(arg, 10000) && !String(arg).includes('\0'))
  ) {
    return false
  }
  if (target.kind === 'url') {
    if (target.args.length !== 0 || !httpUrl(target.path) || target.relative !== false) return false
  }
  // A shortcut carries its own arguments and lives inside the game folder, so the record only keeps its relative name.
  if (target.kind === 'shortcut') {
    if (
      target.args.length !== 0 ||
      target.relative !== true ||
      !/^[^\\/]+\.(lnk|url)$/i.test(target.path)
    ) {
      return false
    }
  }
  // A bundled file (manual, readme) opens with its default application from inside the game folder (R-306).
  if (target.kind === 'file') {
    if (target.args.length !== 0 || target.relative !== true || !documentFile(target.path)) {
      return false
    }
  }
  if (target.localeEmulator !== undefined) {
    if (
      target.kind !== 'exe' ||
      (typeof target.localeEmulator !== 'boolean' && !localeProfileId(target.localeEmulator))
    ) {
      return false
    }
  }
  if (target.kind === 'file-app') {
    if (
      !isPlainObject(target.application) ||
      !isBoundedText(target.application.path, 10000) ||
      !/\.exe$/i.test(target.application.path) ||
      typeof target.application.relative !== 'boolean' ||
      (target.application.relative && !isSafeRelativePath(target.application.path))
    ) {
      return false
    }
  } else if (target.application !== undefined) {
    return false
  }
  return true
}

// R-407: a comic archive's page, kept under its file name inside the folder.
function isValidVolumeEntry(name: string, entry: unknown): boolean {
  if (!isBoundedText(name, 255) || /[\\/\0]/.test(name)) return false
  if (!isPlainObject(entry)) return false
  if (!Object.keys(entry).every((key) => ['page', 'total', 'updated'].includes(key))) return false
  if (!isIntInRange(entry.total, 1, 1000000)) return false
  if (!isIntInRange(entry.page, 0, 1000000)) return false
  if (entry.page >= (entry.total as number)) return false
  if (typeof entry.updated !== 'string' || Number.isNaN(Date.parse(entry.updated))) return false
  return true
}

// R-282: a text book's place, kept under its file name inside the folder.
function isValidNovelEntry(name: string, entry: unknown): boolean {
  if (!isBoundedText(name, 255) || /[\\/\0]/.test(name)) return false
  if (!isPlainObject(entry)) return false
  if (
    !Object.keys(entry).every((key) =>
      ['chapter', 'position', 'percent', 'updated', 'bookmarks'].includes(key)
    )
  ) {
    return false
  }
  if (!isIntInRange(entry.chapter, 0, 100000)) return false
  if (!isUnitRatio(entry.position) || !isUnitRatio(entry.percent)) return false
  if (typeof entry.updated !== 'string' || Number.isNaN(Date.parse(entry.updated))) return false
  if (entry.bookmarks !== undefined) {
    if (!Array.isArray(entry.bookmarks) || entry.bookmarks.length > 500) return false
    const allBookmarksValid = entry.bookmarks.every(
      (bookmark: unknown) =>
        isPlainObject(bookmark) &&
        Object.keys(bookmark).length === 3 &&
        isIntInRange(bookmark.chapter, 0, 100000) &&
        isUnitRatio(bookmark.position) &&
        isBoundedText(bookmark.label, 200)
    )
    if (!allBookmarksValid) return false
  }
  return true
}

function isValidSubtitleSettings(settings: unknown): boolean {
  if (!isPlainObject(settings)) return false
  if (
    typeof settings.offset !== 'number' ||
    !Number.isFinite(settings.offset) ||
    Math.abs(settings.offset) > 86400
  ) {
    return false
  }
  if (!isIntInRange(settings.size, 10, 80)) return false
  if (
    typeof settings.bottom !== 'number' ||
    !Number.isFinite(settings.bottom) ||
    settings.bottom < 0 ||
    settings.bottom > 80
  ) {
    return false
  }
  if (!HEX_COLOR.test(settings.color) || !HEX_COLOR.test(settings.background)) return false
  if (!['utf-8', 'big5', 'shift_jis'].includes(settings.encoding)) return false
  return true
}

function isValidPlaybackEntry([fileId, entry]: [string, unknown]): boolean {
  if (!isValidId(fileId) || !isPlainObject(entry)) return false
  if (
    typeof entry.time !== 'number' ||
    !Number.isFinite(entry.time) ||
    entry.time < 0 ||
    entry.time >= 1e9
  ) {
    return false
  }
  if (entry.subtitle && !isBoundedText(entry.subtitle, 200)) return false
  if (entry.settings) {
    if (
      !isPlainObject(entry.settings) ||
      !Object.values(entry.settings).every(isValidSubtitleSettings)
    ) {
      return false
    }
  }
  return true
}

export function validateFolder(record: unknown): asserts record is FolderRecord {
  checkNotNewer('folder', record)
  if (
    !isPlainObject(record) ||
    record.kind !== 'media-viewer.folder' ||
    record.schemaVersion !== FORMAT_VERSION.folder ||
    !isValidId(record.folderId) ||
    !isIntInRange(record.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(record.attributes) ||
    !record.attributes.every(isValidAttribute) ||
    new Set(record.attributes.map((item) => item.attributeId)).size !== record.attributes.length ||
    !isPlainObject(record.projectOverrides) ||
    !Object.entries(record.projectOverrides).every(
      ([projectId, attrs]) =>
        isValidId(projectId) && Array.isArray(attrs) && attrs.every(isValidAttribute)
    ) ||
    !Array.isArray(record.assets) ||
    !record.assets.every(isValidAsset)
  ) {
    throw new Error('記錄損壞、版本不支援或不屬於本程式；原檔保留')
  }
  if (record.details !== undefined) validateDetails(record.details)
}

export function validateDetails(details: unknown): asserts details is FolderDetails {
  checkNotNewer('details', details)
  if (
    !isPlainObject(details) ||
    details.schemaVersion !== FORMAT_VERSION.details ||
    JSON.stringify(details).length > 2000000
  ) {
    throw new Error('內容設定不合法')
  }
  // Sections with truthy guards retain compatibility with existing null values.
  if (
    details.boundary &&
    (!isPlainObject(details.boundary) ||
      !['root', 'not-game', 'candidate'].includes(details.boundary.state) ||
      !Array.isArray(details.boundary.engines) ||
      !details.boundary.engines.every((engine: unknown) => isBoundedText(engine, 100)) ||
      !Array.isArray(details.boundary.evidence) ||
      !details.boundary.evidence.every((item: unknown) => isBoundedText(item, 500)) ||
      (details.boundary.role !== undefined &&
        (details.boundary.role !== 'tool' || details.boundary.state !== 'root')))
  ) {
    throw new Error('遊戲保護設定不正確')
  }
  if (
    details.hiddenActions !== undefined &&
    (!Array.isArray(details.hiddenActions) ||
      details.hiddenActions.length > 100 ||
      !details.hiddenActions.every(isValidId) ||
      new Set(details.hiddenActions).size !== details.hiddenActions.length)
  ) {
    throw new Error('遊戲操作顯示設定不合法')
  }
  if (
    details.shownExtras !== undefined &&
    (!Array.isArray(details.shownExtras) ||
      !details.shownExtras.every((extra: unknown) =>
        ['steam', 'store', 'save'].includes(extra as string)
      ) ||
      new Set(details.shownExtras).size !== details.shownExtras.length)
  ) {
    throw new Error('遊戲操作顯示設定不合法')
  }
  if (details.kind !== undefined && !isFolderKind(details.kind)) {
    throw new Error('資料夾類型不合法')
  }
  if (details.browseAs !== undefined && !['work', 'collection'].includes(details.browseAs)) {
    throw new Error('瀏覽方式不合法')
  }
  if (details.bannerAssetId !== undefined && !isValidId(details.bannerAssetId)) {
    throw new Error('封面身分不合法')
  }
  if (
    details.cellImages !== undefined &&
    (!isPlainObject(details.cellImages) ||
      Object.keys(details.cellImages).length > 1000 ||
      !Object.entries(details.cellImages).every(
        ([slot, assetId]) => isValidId(slot) && isValidId(assetId)
      ))
  ) {
    throw new Error('圖片組件設定不合法')
  }
  if (
    details.reading &&
    (!isPlainObject(details.reading) ||
      (details.reading.mode !== undefined && !['image', 'manga'].includes(details.reading.mode)) ||
      (details.reading.page !== undefined && !isIntInRange(details.reading.page, 0, 1000000)) ||
      (details.reading.fit !== undefined &&
        !['width', 'height', 'original'].includes(details.reading.fit)) ||
      (details.reading.webtoonWidth !== undefined &&
        !isIntInRange(details.reading.webtoonWidth, 10, 100)) ||
      ['spread', 'rtl', 'firstSingle', 'webtoon', 'webtoonAsked'].some(
        (flag) => details.reading[flag] !== undefined && typeof details.reading[flag] !== 'boolean'
      ))
  ) {
    throw new Error('閱讀設定不合法')
  }
  if (
    details.targets &&
    (!isPlainObject(details.targets) || !Object.entries(details.targets).every(isValidTargetEntry))
  ) {
    throw new Error('任務設定不合法')
  }
  if (
    details.novels !== undefined &&
    (!isPlainObject(details.novels) ||
      Object.keys(details.novels).length > 10000 ||
      !Object.entries(details.novels).every(([name, entry]) => isValidNovelEntry(name, entry)))
  ) {
    throw new Error('小說閱讀紀錄不合法')
  }
  if (
    details.volumes !== undefined &&
    (!isPlainObject(details.volumes) ||
      Object.keys(details.volumes).length > 10000 ||
      !Object.entries(details.volumes).every(([name, entry]) => isValidVolumeEntry(name, entry)))
  ) {
    throw new Error('漫畫壓縮檔閱讀紀錄不合法')
  }
  if (
    details.saveFolder !== undefined &&
    (!isPlainObject(details.saveFolder) ||
      !isBoundedText(details.saveFolder.path, 10000) ||
      typeof details.saveFolder.relative !== 'boolean' ||
      (details.saveFolder.relative && !isSafeRelativePath(details.saveFolder.path)) ||
      // Outside the game it must be a local drive path; a network share would be contacted when opened.
      (!details.saveFolder.relative && !/^[A-Za-z]:[\\/]/.test(details.saveFolder.path)))
  ) {
    throw new Error('存檔資料夾設定不合法')
  }
  if (
    details.subtitles &&
    (!Array.isArray(details.subtitles) ||
      !details.subtitles.every(
        (subtitle) =>
          isPlainObject(subtitle) &&
          isValidId(subtitle.id) &&
          isBoundedText(subtitle.name, 255) &&
          isSafeRelativePath(subtitle.relativePath) &&
          /^subtitles\/[\w-]+\.(srt|vtt)$/.test(subtitle.relativePath)
      ))
  ) {
    throw new Error('字幕記錄不合法')
  }
  if (
    details.playback &&
    (!isPlainObject(details.playback) ||
      Object.keys(details.playback).length > 10000 ||
      !Object.entries(details.playback).every(isValidPlaybackEntry))
  ) {
    throw new Error('播放設定不合法')
  }
  // R-432: the remembered embedded subtitle track: a name and/or a language, as short text.
  if (
    details.subtitleTrack !== undefined &&
    (!isPlainObject(details.subtitleTrack) ||
      Object.keys(details.subtitleTrack).some((key) => !['name', 'language'].includes(key)) ||
      (details.subtitleTrack.name === undefined && details.subtitleTrack.language === undefined) ||
      (details.subtitleTrack.name !== undefined &&
        (!isBoundedText(details.subtitleTrack.name, 200) || !details.subtitleTrack.name)) ||
      (details.subtitleTrack.language !== undefined &&
        (!isBoundedText(details.subtitleTrack.language, 35) || !details.subtitleTrack.language)))
  ) {
    throw new Error('字幕軌偏好不合法')
  }
}

export function validateProject(project: unknown): asserts project is Project {
  checkNotNewer('project', project)
  if (
    isPlainObject(project) &&
    ((project.scanAll !== undefined && typeof project.scanAll !== 'boolean') ||
      (project.cardView !== undefined &&
        (!isPlainObject(project.cardView) ||
          !['multi', 'single'].includes(project.cardView.mode) ||
          (project.cardView.works !== undefined && typeof project.cardView.works !== 'boolean') ||
          !(
            isIntInRange(project.cardView.level, 1, Number.MAX_SAFE_INTEGER) ||
            (project.cardView.mode === 'multi' && project.cardView.level === 'all')
          ))))
  ) {
    throw new Error('CARD 顯示範圍不合法')
  }
  if (
    !isPlainObject(project) ||
    project.kind !== 'media-viewer.project' ||
    project.schemaVersion !== FORMAT_VERSION.project ||
    !isValidId(project.projectId) ||
    !isValidId(project.rootFolderId) ||
    !isIntInRange(project.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !isBoundedText(project.name, 100) ||
    !project.name.trim() ||
    !isPlainObject(project.depth) ||
    !['through', 'exact'].includes(project.depth.mode) ||
    !isIntInRange(project.depth.level, 1, 50) ||
    !isPlainObject(project.list) ||
    !isIntInRange(project.list.itemsPerRow, 1, 6) ||
    !isIntInRange(project.list.pageSize, 1, 500) ||
    !Array.isArray(project.excludedRelativePaths) ||
    !project.excludedRelativePaths.every(isSafeRelativePath) ||
    !Array.isArray(project.fieldBindings) ||
    !project.fieldBindings.every(isValidFieldBinding) ||
    !Array.isArray(project.cells) ||
    project.cells.length > 50 ||
    !project.cells.every(isValidCell)
  ) {
    throw new Error('專案設定不合法或版本不支援')
  }
  if (
    new Set(project.cells.map((cell) => cell.cellId)).size !== project.cells.length ||
    new Set(project.fieldBindings.map((binding) => binding.alias.toLowerCase())).size !==
      project.fieldBindings.length
  ) {
    throw new Error('組件 ID 或欄位別名重複')
  }
  for (const cell of project.cells) {
    if (cell.fallbackIds) {
      const type = project.fieldBindings.find(
        (binding) => binding.attributeId === cell.attributeId
      )?.type
      const display =
        cell.kind === 'field-text' ? 'string' : cell.kind === 'field-tags' ? 'tags' : type
      if (
        !compatibleFieldTypes(display, type) ||
        cell.fallbackIds.some(
          (fallback: string) =>
            !compatibleFieldTypes(
              display,
              project.fieldBindings.find(
                (binding: { attributeId: string }) => binding.attributeId === fallback
              )?.type
            )
        )
      ) {
        throw new Error('備用欄位不存在，或格式不合')
      }
    }
  }
  validateFieldGroups(project as Project)
  for (const cell of project.cells) {
    for (const condition of cellConditions(cell)) {
      const field = project.fieldBindings.find(
        (binding) => binding.attributeId === condition.attributeId
      )
      if (
        !field ||
        (['within', 'older'].includes(condition.operator) &&
          !['date', 'datetime'].includes(field.type)) ||
        (['gt', 'lt'].includes(condition.operator) &&
          (!['number', 'date', 'datetime'].includes(field.type) ||
            !validFieldValue(field.type, condition.value))) ||
        (['equals', 'not-equals'].includes(condition.operator) &&
          (!['string', 'enum', 'url', 'date', 'datetime', 'number', 'boolean'].includes(
            field.type
          ) ||
            !validFieldValue(
              field.type,
              condition.value,
              field.type === 'enum' ? undefined : field.options
            )))
      ) {
        throw new Error('組件顯示條件不合法')
      }
    }
  }
  if (project.layoutRules !== undefined && !isValidLayoutRules(project.layoutRules)) {
    throw new Error('版面配置規則不合法')
  }
  if (
    project.stylePresets !== undefined &&
    (!Array.isArray(project.stylePresets) ||
      project.stylePresets.length > 20 ||
      new Set(project.stylePresets.map((preset) => preset?.id)).size !==
        project.stylePresets.length ||
      new Set(
        project.stylePresets.map((preset) =>
          typeof preset?.name === 'string' ? preset.name.trim().toLocaleLowerCase() : preset
        )
      ).size !== project.stylePresets.length ||
      !project.stylePresets.every(
        (preset) =>
          isPlainObject(preset) &&
          isValidId(preset.id) &&
          isBoundedText(preset.name, 40) &&
          preset.name.trim() &&
          isValidStyle(preset.style)
      ))
  ) {
    throw new Error('自訂樣式不合法或名稱重複')
  }
  if (project.layoutPresets !== undefined) {
    if (
      !Array.isArray(project.layoutPresets) ||
      !project.layoutPresets.length ||
      project.layoutPresets.length > 30 ||
      new Set(project.layoutPresets.map((preset) => preset.id)).size !==
        project.layoutPresets.length ||
      new Set(
        project.layoutPresets.map((preset) =>
          typeof preset.name === 'string' ? preset.name.toLocaleLowerCase() : preset.name
        )
      ).size !== project.layoutPresets.length ||
      !project.layoutPresets.every(
        (preset) =>
          isPlainObject(preset) &&
          isValidId(preset.id) &&
          isBoundedText(preset.name, 100) &&
          preset.name.trim()
      )
    ) {
      throw new Error('卡片外觀不正確或名稱重複')
    }
    if (
      !isValidId(project.activeLayoutId) ||
      !project.layoutPresets.some((preset) => preset.id === project.activeLayoutId)
    ) {
      throw new Error('使用中的外觀不存在')
    }
    for (const preset of project.layoutPresets) {
      validateProject(withOnlyCells(project, preset.cells))
    }
  } else if (project.activeLayoutId !== undefined) {
    throw new Error('外觀清單不存在')
  }
  // R-409: the right-panel layouts (up to 40: the 30 book templates of a v1 project and the other kinds' templates).
  if (project.panelPresets !== undefined) {
    if (
      !Array.isArray(project.panelPresets) ||
      !project.panelPresets.length ||
      project.panelPresets.length > 40 ||
      new Set(project.panelPresets.map((preset) => preset?.id)).size !==
        project.panelPresets.length ||
      new Set(
        project.panelPresets.map((preset) =>
          typeof preset?.name === 'string' ? preset.name.toLocaleLowerCase() : preset
        )
      ).size !== project.panelPresets.length ||
      !project.panelPresets.every(
        (preset) =>
          isPlainObject(preset) &&
          isValidId(preset.id) &&
          isBoundedText(preset.name, 100) &&
          preset.name.trim()
      )
    ) {
      throw new Error('詳情版面不合法或名稱重複')
    }
    if (
      project.panelPresetId !== undefined &&
      !project.panelPresets.some((preset) => preset.id === project.panelPresetId)
    ) {
      throw new Error('詳情預設版面不存在')
    }
    for (const preset of project.panelPresets) {
      validateProject(withOnlyCells(project, preset.cells))
    }
  } else if (project.panelPresetId !== undefined) {
    throw new Error('詳情版面清單不存在')
  }
  if (
    project.traversal !== undefined &&
    (!isPlainObject(project.traversal) ||
      !Object.entries(project.traversal).every(
        ([key, flag]) => isValidId(key) && typeof flag === 'boolean'
      ))
  ) {
    throw new Error('遍歷偏好不合法')
  }
  if (
    project.actionTemplates !== undefined &&
    (!Array.isArray(project.actionTemplates) ||
      project.actionTemplates.length > 30 ||
      new Set(project.actionTemplates.map((template) => template.id)).size !==
        project.actionTemplates.length ||
      !project.actionTemplates.every(
        (template) =>
          isPlainObject(template) &&
          isValidId(template.id) &&
          isBoundedText(template.label, 100) &&
          TARGET_KINDS.includes(template.kind) &&
          HEX_COLOR.test(template.color)
      ))
  ) {
    throw new Error('任務版型不合法')
  }
  if (
    project.savedSearches !== undefined &&
    (!Array.isArray(project.savedSearches) ||
      project.savedSearches.length > 100 ||
      !project.savedSearches.every(
        (saved) =>
          isPlainObject(saved) &&
          isValidId(saved.id) &&
          isBoundedText(saved.name, 100) &&
          (saved.queryAst === undefined || validStableQuery(saved.queryAst)) &&
          isBoundedText(saved.query, 2000)
      ))
  ) {
    throw new Error('常用搜尋不合法')
  }
  for (let i = 0; i < project.cells.length; i++) {
    for (let j = i + 1; j < project.cells.length; j++) {
      const first = project.cells[i].grid
      const second = project.cells[j].grid
      if (
        first.x < second.x + second.w &&
        first.x + first.w > second.x &&
        first.y < second.y + second.h &&
        first.y + first.h > second.y
      ) {
        throw new Error('組件不能重疊')
      }
    }
  }
}

function validateFieldGroups(project: Project): void {
  const groups = project.fieldGroups
  if (groups === undefined) {
    if (project.cells.some((cell) => cell.groupId) || project.groupSources !== undefined) {
      throw new Error('欄位群組不存在')
    }
    return
  }
  const typeOf = (attributeId: string) =>
    project.fieldBindings.find((field) => field.attributeId === attributeId)?.type
  const aliases = new Set(
    project.fieldBindings.map((field) => field.alias.trim().toLocaleLowerCase())
  )
  if (
    !Array.isArray(groups) ||
    groups.length > 100 ||
    !groups.every(
      (group) =>
        isPlainObject(group) &&
        isValidId(group.groupId) &&
        isBoundedText(group.name, 100) &&
        group.name.trim().length > 0 &&
        !aliases.has(group.name.trim().toLocaleLowerCase()) &&
        Array.isArray(group.memberIds) &&
        group.memberIds.length >= 1 &&
        group.memberIds.length <= MAX_GROUP_MEMBERS &&
        group.memberIds.every((member) => isValidId(member) && typeOf(member) !== undefined) &&
        group.memberIds.every((member) =>
          compatibleFieldTypes(typeOf(group.memberIds[0]), typeOf(member))
        )
    ) ||
    new Set(groups.map((group) => group.groupId)).size !== groups.length ||
    new Set(groups.map((group) => group.name.trim().toLocaleLowerCase())).size !== groups.length ||
    new Set(groups.flatMap((group) => group.memberIds)).size !==
      groups.reduce((sum, group) => sum + group.memberIds.length, 0)
  ) {
    throw new Error('欄位群組不正確：成員要存在、格式相容、只屬於一個群組，名稱不能重複')
  }
  for (const cell of project.cells) {
    if (cell.groupId) {
      const group = groups.find((item) => item.groupId === cell.groupId)
      if (
        !group ||
        !cell.attributeId ||
        !group.memberIds.includes(cell.attributeId) ||
        !compatibleFieldTypes(FIELD_KIND_TYPES[cell.kind], typeOf(group.memberIds[0]))
      ) {
        throw new Error('組件顯示的欄位群組不存在或格式不相容')
      }
    }
  }
  const sources = project.groupSources
  if (
    sources !== undefined &&
    (!isPlainObject(sources) ||
      Object.keys(sources).length > 50000 ||
      !Object.entries(sources).every(
        ([folder, chosen]) =>
          isValidId(folder) &&
          isPlainObject(chosen) &&
          Object.entries(chosen).every(
            ([groupId, member]) =>
              isValidId(groupId) &&
              groups.some(
                (group) => group.groupId === groupId && group.memberIds.includes(member as string)
              )
          )
      ))
  ) {
    throw new Error('資料夾指定的群組來源不合法')
  }
}

// Group cells were removed; a project saved while they existed loads without them (children go with the group).
export function withoutGroupCells<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !(isPlainObject(item) && item.kind === 'group'))
      .map((item) => withoutGroupCells(item)) as T
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withoutGroupCells(item)])
    ) as T
  }
  return value
}
