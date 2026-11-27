import { mapRawCellLists } from './cellLists'
import { fmt } from './message'

// Every stored format carries its own `schemaVersion`. A newer app reads older data by running the steps below in
// order (v1 -> v2 -> ...) right after reading; the upgraded value is written back only when that record is saved for
// another reason. Data written by a newer app is never treated as damaged: it raises NewerFormatError, stays read-only
// and is never restored over, cleaned or rewritten. Rules: docs/architecture/DATA_FORMAT.md#格式升級與相容規則.
export type FormatKind = 'folder' | 'details' | 'project' | 'workspace' | 'settings'

// The version this build writes. Bump one together with a step from the previous version, a fixture of the old
// format and a test (see the checklist in docs/architecture/DATA_FORMAT.md).
export const FORMAT_VERSION: Record<FormatKind, number> = {
  folder: 2,
  details: 1,
  project: 4,
  workspace: 1,
  settings: 1,
}

type Step = (value: Record<string, unknown>) => Record<string, unknown>

// UPGRADE_STEPS[kind][n] turns version n into version n + 1.
export const UPGRADE_STEPS: Record<FormatKind, Partial<Record<number, Step>>> = {
  folder: {
    // 1 -> 2 (R-387): the combined audio/video kind is split into music and video. A folder set to the old kind by
    // hand loses that choice, so what it holds decides; nothing else changes.
    1: (value) => {
      const details = value.details
      if (!plain(details) || details.kind !== 'media') return value
      const { kind: _kind, ...rest } = details
      return { ...value, details: rest }
    },
  },
  details: {},
  project: {
    // 1 -> 2 (R-409): the right-panel layouts. Book templates, content templates and the older layout fields become
    // panel layouts and layout rules; see projectV1 below.
    1: (value) => projectV1(value),
    // 2 -> 3 (R-437): the game cover, album info and video info components are gone; see projectV2 below.
    2: (value) => projectV2(value),
    // 3 -> 4 (R-469): the album facts, video facts and book card components become small components; see projectV3.
    3: (value) => projectV3(value),
  },
  workspace: {},
  settings: {},
}

const NAMES: Record<FormatKind, string> = {
  folder: '資料夾資訊',
  details: '資料夾內容設定',
  project: '專案設定',
  workspace: '應用程式設定',
  settings: '設定包',
}

export class NewerFormatError extends Error {
  constructor(
    readonly format: FormatKind,
    readonly version: number
  ) {
    super(
      fmt(
        '這份{0}來自較新版本的 M:orph（格式 v{1}，這個版本只認得到 v{2}）；請更新程式，在那之前只能查看，不會寫入或覆蓋。',
        NAMES[format],
        version,
        FORMAT_VERSION[format]
      )
    )
  }
}

// Errors cross the IPC boundary as text, so the window recognises the case by its wording.
export const isNewerFormat = (error: unknown) =>
  error instanceof NewerFormatError || /來自較新版本的 M:orph/.test(String(error))

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

// Throws NewerFormatError when the value was written by a newer app; anything else is left to the validators.
export function checkNotNewer(format: FormatKind, value: unknown) {
  const version = plain(value) ? value.schemaVersion : undefined
  if (
    typeof version === 'number' &&
    Number.isInteger(version) &&
    version > FORMAT_VERSION[format]
  ) {
    throw new NewerFormatError(format, version)
  }
}

export function upgradeFormat(format: FormatKind, value: unknown): unknown {
  checkNotNewer(format, value)
  if (!plain(value)) return value
  const from = value.schemaVersion
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) return value
  let out = value
  for (let version = from; version < FORMAT_VERSION[format]; version++) {
    const step = UPGRADE_STEPS[format][version]
    if (!step) {
      throw new Error(
        fmt('缺少{0}格式 v{1} → v{2} 的升級步驟', NAMES[format], version, version + 1)
      )
    }
    out = { ...step(structuredClone(out)), schemaVersion: version + 1 }
  }
  return out
}

// A folder record carries its details as a nested format of their own.
export function upgradeFolderRecord(value: unknown): unknown {
  const folder = upgradeFormat('folder', value)
  if (plain(folder) && folder.details !== undefined) {
    return { ...folder, details: upgradeFormat('details', folder.details) }
  }
  return folder
}

// Stored records name their kind; this picks the format for a raw value read from a .json or .json.bak file.
export function upgradeStored(value: unknown): unknown {
  if (plain(value) && value.kind === 'media-viewer.folder') return upgradeFolderRecord(value)
  if (plain(value) && value.kind === 'media-viewer.project') {
    return settleFieldGroups(upgradeFormat('project', value))
  }
  return value
}

// Field groups (R-226, optional keys) are ignored by older app versions, which may then delete or rename a member
// field. Instead of refusing the whole project, what no longer fits is settled on reading: missing, repeated or
// incompatible members leave their group, empty groups go, a name now taken by a field gets a number, folder choices
// and components follow. Anything else is left for validation as before.
export function settleFieldGroups(value: unknown): unknown {
  if (!plain(value) || !Array.isArray(value.fieldGroups)) return value
  const types = new Map<string, unknown>(
    (Array.isArray(value.fieldBindings) ? value.fieldBindings : [])
      .filter(plain)
      .map((field) => [field.attributeId as string, field.type])
  )
  const textual = (type: unknown) => type === 'string' || type === 'tags'
  const fits = (a: unknown, b: unknown) => a === b || (textual(a) && textual(b))
  const taken = new Set(
    (Array.isArray(value.fieldBindings) ? value.fieldBindings : []).filter(plain).map((field) =>
      String(field.alias ?? '')
        .trim()
        .toLocaleLowerCase()
    )
  )
  const used = new Set<string>()
  const groups = value.fieldGroups.filter(plain).flatMap((group) => {
    if (!Array.isArray(group.memberIds) || typeof group.name !== 'string') return [group]
    const members: string[] = []
    for (const id of group.memberIds) {
      if (
        typeof id === 'string' &&
        types.has(id) &&
        !used.has(id) &&
        (!members.length || fits(types.get(members[0]), types.get(id)))
      ) {
        members.push(id)
      }
    }
    if (!members.length) return []
    members.forEach((id) => used.add(id))
    let name = group.name.trim().slice(0, 95) || 'Group'
    for (let n = 2; taken.has(name.toLocaleLowerCase()); n++) {
      name = `${group.name.trim().slice(0, 95) || 'Group'} ${n}`
    }
    taken.add(name.toLocaleLowerCase())
    return [{ ...group, name, memberIds: members }]
  })
  const next: Record<string, unknown> = { ...value }
  if (groups.length) next.fieldGroups = groups
  else delete next.fieldGroups
  const find = (id: unknown) => groups.find((group) => group.groupId === id)
  if (plain(value.groupSources)) {
    const sources = Object.fromEntries(
      Object.entries(value.groupSources).flatMap(([folder, chosen]) => {
        if (!plain(chosen)) return []
        const kept = Object.entries(chosen).filter(([groupId, member]) =>
          (find(groupId)?.memberIds as string[] | undefined)?.includes(member as string)
        )
        return kept.length ? [[folder, Object.fromEntries(kept)]] : []
      })
    )
    if (Object.keys(sources).length) next.groupSources = sources
    else delete next.groupSources
  }
  const cell = (item: unknown) => {
    if (!plain(item) || item.groupId === undefined) return item
    const group = find(item.groupId)
    if (!group) {
      const { groupId: _drop, ...rest } = item
      return rest
    }
    const members = group.memberIds as string[]
    return members.includes(item.attributeId as string)
      ? item
      : { ...item, attributeId: members[0] }
  }
  const cells = (list: unknown) => (Array.isArray(list) ? list.map(cell) : list)
  return mapRawCellLists(next, cells)
}

// Project 3 -> 4 (R-469). The album facts, video facts and book card become the small components that show the same
// things, one line each inside the box the old component had (as many lines as it was tall, at most three), two side by
// side where the box is at least two columns wide:
// - album-facts: the album name; artist and year; track count and total length;
// - video-facts: the video count; the 播放影片 button;
// - book-card: the book's title; its author.
// The first keeps the old component's id and style; the others get new unique ids and the same style. Everything else
// is kept as it was.
const factLines: Record<string, string[][]> = {
  'album-facts': [['albumName'], ['albumArtist', 'albumYear'], ['trackCount', 'totalLength']],
  'video-facts': [['videoCount'], ['@video-play']],
  'book-card': [['bookTitle'], ['bookAuthor']],
}
// A list holds at most 50 components (see validateProject): when the split ones would not fit, each old component
// becomes only its first small component, over its whole box. New ids stay within the 100 characters an id may have.
const MAX_LIST_CELLS = 50

function projectV3(value: Record<string, unknown>): Record<string, unknown> {
  const convert = (list: unknown) => {
    if (!Array.isArray(list)) return list
    const ids = new Set(list.map((cell) => (plain(cell) ? String(cell.cellId) : '')))
    const unique = (id: string) => {
      let next = id
      for (let n = 2; ids.has(next); n++) next = id + '-' + n
      ids.add(next)
      return next
    }
    const old = (cell: unknown): cell is Record<string, unknown> =>
      plain(cell) && plain(cell.grid) && typeof cell.kind === 'string' && !!factLines[cell.kind]
    const linesOf = (cell: Record<string, unknown>, whole: boolean) => {
      const { w, h } = cell.grid as { w: number; h: number }
      const lines = factLines[cell.kind as string].slice(0, whole ? 1 : Math.max(1, Math.min(h, 3)))
      return lines.map((line) => (w >= 2 ? line : line.slice(0, 1)))
    }
    const grown = list.reduce(
      (count: number, cell) => count + (old(cell) ? linesOf(cell, false).flat().length - 1 : 0),
      list.length
    )
    const whole = grown > MAX_LIST_CELLS
    return list.flatMap((cell): unknown[] => {
      if (!old(cell)) return [cell]
      const { x, y, w, h } = cell.grid as { x: number; y: number; w: number; h: number }
      const { kind: _kind, cellId, ...rest } = cell
      const lines = linesOf(cell, whole)
      const out: unknown[] = []
      lines.forEach((parts, i) => {
        const left = Math.ceil(w / parts.length)
        parts.forEach((part, j) => {
          const box = {
            x: x + j * left,
            y: y + i,
            w: j ? w - left : parts.length > 1 ? left : w,
            // The last line takes what is left of the old height.
            h: i === lines.length - 1 ? Math.max(1, h - i) : 1,
          }
          const name = part.replace('@', '')
          out.push({
            // Each new component gets its own copy of the old one's style and other settings.
            ...structuredClone(rest),
            cellId: out.length
              ? unique(String(cellId).slice(0, 100 - name.length - 5) + '-' + name)
              : cellId,
            ...(part.startsWith('@')
              ? { kind: part.slice(1) }
              : { kind: 'system-info', systemInfo: part }),
            grid: box,
          })
        })
      })
      return out
    })
  }
  return mapRawCellLists(value, convert)
}

// Project 2 -> 3 (R-437). What a component showed stays what it shows, as components that exist now:
// - game-cover becomes an image component set to the folder cover, keeping its place and fit (blur unless set);
// - album-info and video-info become that cover on the left third (at least one column, the rest of their width
//   goes to the new album-facts / video-facts) - a component one column wide keeps only the facts.
// Everything else, in every list (card, card layouts, right-panel layouts), is kept as it was.
function projectV2(value: Record<string, unknown>): Record<string, unknown> {
  const convert = (list: unknown) => {
    if (!Array.isArray(list)) return list
    const ids = new Set(list.map((cell) => (plain(cell) ? String(cell.cellId) : '')))
    const unique = (id: string) => {
      let next = id
      for (let n = 2; ids.has(next); n++) next = id + '-' + n
      ids.add(next)
      return next
    }
    return list.flatMap((cell): unknown[] => {
      if (!plain(cell) || !plain(cell.grid)) return [cell]
      if (cell.kind === 'game-cover') {
        return [{ ...cell, kind: 'image', imageCover: true, imageFit: cell.imageFit ?? 'blur' }]
      }
      if (cell.kind !== 'album-info' && cell.kind !== 'video-info') return [cell]
      const { x, w } = cell.grid as { x: number; w: number }
      const facts = { ...cell, kind: cell.kind === 'album-info' ? 'album-facts' : 'video-facts' }
      if (!(w >= 2)) return [facts]
      const side = Math.max(1, Math.round(w / 3))
      return [
        {
          cellId: unique(String(cell.cellId) + '-cover'),
          kind: 'image',
          imageCover: true,
          ...(cell.style === undefined ? {} : { style: cell.style }),
          grid: { ...cell.grid, w: side },
        },
        { ...facts, grid: { ...cell.grid, x: x + side, w: w - side } },
      ]
    })
  }
  return mapRawCellLists(value, convert)
}

// Project 1 -> 2 (R-409). What a folder showed stays what it shows:
// - book templates (bookPresets) become panel layouts with their ids and names; the project's chosen one
//   (bookPresetId) becomes the book kind's layout; without them an edited book template (contentCells.book) becomes
//   "書籍 預設", given the cover component an edited template from before R-362 had drawn beside it;
// - the other edited content templates (game, media, general; an empty one showed nothing) become "<kind> 預設" for
//   their kinds, music and video sharing the media one;
// - kindLayouts, folderLayouts and folderBookPresets become layout rules, unless the project already has rules (R-413),
//   which then replaced them already. Rules already set are never overwritten.
const panelKinds: [string, string[], string][] = [
  ['game', ['game'], '遊戲'],
  ['media', ['music', 'video'], '音樂／影片'],
  ['general', ['general'], '一般'],
]
const cardKinds = ['game', 'book', 'music', 'video', 'general']

function projectV1(value: Record<string, unknown>): Record<string, unknown> {
  const {
    contentCells,
    contentCover,
    bookPresets,
    bookPresetId,
    folderBookPresets,
    kindLayouts,
    folderLayouts,
    ...rest
  } = value
  const rules: Record<string, unknown> = plain(rest.layoutRules)
    ? structuredClone(rest.layoutRules)
    : {}
  if (!plain(rest.layoutRules)) {
    const types: Record<string, unknown> = {}
    if (plain(kindLayouts)) {
      for (const kind of cardKinds) {
        const id = kindLayouts[kind === 'music' || kind === 'video' ? 'media' : kind]
        if (id !== undefined) types[kind] = id
      }
    }
    const card: Record<string, unknown> = {
      ...(Object.keys(types).length ? { types } : {}),
      ...(plain(folderLayouts) && Object.keys(folderLayouts).length
        ? { folders: { ...folderLayouts } }
        : {}),
    }
    if (Object.keys(card).length) rules.card = card
    if (plain(folderBookPresets) && Object.keys(folderBookPresets).length) {
      rules.panel = { folders: { ...folderBookPresets } }
    }
  }
  const panel: Record<string, unknown> = plain(rules.panel) ? { ...rules.panel } : {}
  const types: Record<string, unknown> = plain(panel.types) ? { ...panel.types } : {}
  const presets: unknown[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  const keep = (preset: unknown) => {
    presets.push(preset)
    if (plain(preset)) {
      ids.add(String(preset.id))
      names.add(String(preset.name).toLocaleLowerCase())
    }
  }
  const add = (id: string, name: string, cells: unknown) => {
    let unique = id
    for (let n = 2; ids.has(unique); n++) unique = id + '-' + n
    let label = name
    for (let n = 2; names.has(label.toLocaleLowerCase()); n++) label = name + ' (' + n + ')'
    keep({ id: unique, name: label, cells })
    return unique
  }
  const templates = plain(contentCells) ? contentCells : {}
  // A book rule pointing at a template that no longer exists fell back to the project's default before; it is
  // filled again below instead of being kept.
  const bookIds = Array.isArray(bookPresets) ? bookPresets.filter(plain).map((p) => p.id) : []
  if (types.book !== undefined && !bookIds.includes(types.book)) delete types.book
  if (Array.isArray(bookPresets) && bookPresets.length) {
    bookPresets.forEach(keep)
    if (bookPresetId !== undefined && types.book === undefined) types.book = bookPresetId
  } else if (Array.isArray(templates.book)) {
    const id = add(
      'panel-book',
      '書籍 預設',
      contentCover === true ? templates.book : withCover(templates.book)
    )
    if (types.book === undefined) types.book = id
  }
  for (const [key, kinds, name] of panelKinds) {
    const cells = templates[key]
    if (!Array.isArray(cells) || !cells.length) continue
    const id = add('panel-' + key, name + ' 預設', cells)
    for (const kind of kinds) if (types[kind] === undefined) types[kind] = id
  }
  if (Object.keys(types).length) panel.types = types
  if (Object.keys(panel).length) rules.panel = panel
  return {
    ...rest,
    ...(Object.keys(rules).length ? { layoutRules: rules } : { layoutRules: undefined }),
    ...(presets.length ? { panelPresets: presets } : {}),
  }
}

// A book template from before R-362 had the cover drawn beside it: the cover becomes a component on the left and the
// rest moves into the remaining two thirds, components that would meet moving down. When that does not fit the
// 100 rows (or the list is not as expected), the template is kept as it was, without the cover.
function withCover(cells: unknown[]): unknown[] {
  const inside = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 100
  if (
    cells.length >= 50 ||
    !cells.every(
      (cell) =>
        plain(cell) &&
        plain(cell.grid) &&
        ['x', 'y', 'w', 'h'].every((k) => inside((cell.grid as Record<string, unknown>)[k]))
    )
  ) {
    return cells
  }
  const list = cells as {
    kind?: unknown
    cellId?: unknown
    grid: { x: number; y: number; w: number; h: number }
  }[]
  if (list.some((cell) => cell.kind === 'image' || cell.cellId === 'book-cover')) return cells
  const moved = list.map((cell) => {
    const x = Math.min(11, 4 + Math.round((cell.grid.x * 8) / 12))
    const end = 4 + Math.round(((cell.grid.x + cell.grid.w) * 8) / 12)
    return { ...cell, grid: { ...cell.grid, x, w: Math.max(1, Math.min(12, end) - x) } }
  })
  const bottom = Math.max(4, ...list.map((cell) => cell.grid.y + cell.grid.h))
  // The same component as shared/layouts.ts bookCover (not imported: the format code stays free of layout code).
  const cover = {
    cellId: 'book-cover',
    kind: 'image',
    imageCover: true,
    grid: { x: 0, y: 0, w: 4, h: Math.min(8, bottom) },
    style: { textColor: '#e4e6e8', backgroundColor: 'transparent' },
  }
  const placed: { x: number; y: number; w: number; h: number }[] = [cover.grid]
  const meets = (a: (typeof placed)[number], b: (typeof placed)[number]) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  for (const cell of [...moved].sort((a, b) => a.grid.y - b.grid.y || a.grid.x - b.grid.x)) {
    while (placed.some((other) => meets(cell.grid, other))) cell.grid.y++
    if (cell.grid.y + cell.grid.h > 100) return cells
    placed.push(cell.grid)
  }
  return [cover, ...moved]
}
