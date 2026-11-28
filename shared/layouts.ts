import { cellLists } from './cellLists'
import { settleCells } from './fieldGroups'
import type { FolderKind } from './kind'
import { chooseLayout, choosePanel, dropLayout } from './layoutRules'
import { type Attribute, type Cell, fieldValue, type FolderRow, type Project } from './model'

// R-362: a book's cover is a component of its template (the folder's cover picture, else its first image), so it can
// be moved, resized or left out like any other.
export const bookCover = (grid: Cell['grid'] = { x: 0, y: 0, w: 4, h: 4 }): Cell => ({
  cellId: 'book-cover',
  kind: 'image',
  imageCover: true,
  grid,
  style: { textColor: '#e4e6e8', backgroundColor: 'transparent' },
})

// R-437: the folder cover as a component of a built-in right panel (the same rule as a card's: shared by every kind).
export const panelCover = (cellId: string, grid: Cell['grid']): Cell => ({
  cellId,
  kind: 'image',
  imageCover: true,
  grid,
  style: { textColor: '#e4e6e8', backgroundColor: 'transparent' },
})

export function projectImageCells(project: Project): Cell[] {
  return [
    ...new Map(
      [
        ...cellLists(project).flatMap((list) => list.cells),
        // Without a book layout the built-in one shows the default cover, which can be given a picture of its own.
        ...(project.layoutRules?.panel?.types?.book ? [] : [bookCover()]),
      ]
        .filter((c) => c.kind === 'image')
        .map((c) => [c.cellId, c])
    ).values(),
  ]
}

export interface EditorField {
  attributeId: string
  key: string
  type: string
  shared: boolean
  private: boolean
  conflict: boolean
  hasData: boolean
}

export function editorFields(rows: FolderRow[], projectId: string): EditorField[] {
  const fields = new Map<string, EditorField>()
  for (const row of rows.filter((r) => r.projectId === projectId)) {
    for (const [scope, attributes] of [
      ['shared', row.record?.attributes ?? []],
      ['private', row.record?.projectOverrides[projectId] ?? []],
    ] as const) {
      for (const attribute of attributes) {
        if (
          !['string', 'tags', 'number', 'datetime', 'boolean', 'enum', 'url', 'date'].includes(
            attribute.type
          )
        ) {
          continue
        }
        const previous = fields.get(attribute.attributeId)
        const hasData =
          attribute.value != null &&
          (typeof attribute.value === 'string'
            ? attribute.value.trim().length > 0
            : Array.isArray(attribute.value)
              ? attribute.value.length > 0
              : true)
        if (previous) {
          previous[scope] = true
          previous.conflict ||= previous.type !== attribute.type
          previous.hasData ||= hasData
        } else {
          fields.set(attribute.attributeId, {
            attributeId: attribute.attributeId,
            key: attribute.key,
            type: attribute.type,
            shared: scope === 'shared',
            private: scope === 'private',
            conflict: false,
            hasData,
          })
        }
      }
    }
  }
  return [...fields.values()]
}

export const legacyDefault = (cells: Cell[]) =>
  cells.length === 4 &&
  cells.every(
    (c, i) =>
      c.kind === ['name', 'path', 'field-text', 'open-folder'][i] &&
      c.grid.x === 0 &&
      c.grid.y === i &&
      c.grid.w === 12 &&
      c.grid.h === 1 &&
      c.style.textColor === '#243247' &&
      c.style.backgroundColor === '#ffffff'
  )

export function visibleCells(project: Pick<Project, 'cells' | 'layoutPresets'>): Cell[] {
  return !project.layoutPresets && legacyDefault(project.cells)
    ? project.cells.map((c) => ({
        ...c,
        style: { textColor: '#e4e6e8', backgroundColor: 'transparent' },
      }))
    : project.cells
}

export function cardPresets(project: Project) {
  return (
    project.layoutPresets ?? [{ id: 'default', name: '預設版面', cells: visibleCells(project) }]
  )
}

export function saveCardPreset(
  project: Project,
  options: { name: string; asNew: boolean },
  makeId: () => string,
  base: Project = project
): Project {
  const presets = cardPresets(base)
  const name = options.name.trim()
  const id = options.asNew ? makeId() : (project.activeLayoutId ?? presets[0].id)
  if (
    !name ||
    name.length > 100 ||
    presets.some((p) => p.id !== id && p.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  ) {
    throw new Error('外觀名稱需為 1～100 字，且不可重複')
  }
  const preset = { id, name, cells: structuredClone(project.cells) }
  return {
    ...project,
    layoutPresets: options.asNew
      ? [...presets, preset]
      : presets.map((p) => (p.id === id ? preset : p)),
    activeLayoutId: id,
  }
}

// R-413: the card rules of the project (or those its older fields imply) pick the layout; layout 0 is the project's
// active layout. `work` says whether the folder counts as a work (where unknown, it is taken as one, which matches
// the older rule that applied kind layouts to every folder).
export const cardRule = (project: Project) => project.layoutRules?.card

export function cardChoice(project: Project, row: FolderRow, work = true) {
  const presets = cardPresets(project)
  return chooseLayout(cardRule(project), row, work, project.activeLayoutId ?? presets[0].id, (id) =>
    presets.some((preset) => preset.id === id)
  )
}

export function rowCells(project: Project, row: FolderRow, work = true): Cell[] {
  const { id } = cardChoice(project, row, work)
  return cardPresets(project).find((preset) => preset.id === id)?.cells ?? visibleCells(project)
}

export function presetDraft(project: Project): Project {
  const presets = structuredClone(cardPresets(project))
  const active = project.activeLayoutId ?? presets[0].id
  return {
    ...structuredClone(project),
    layoutPresets: presets,
    activeLayoutId: active,
    cells: structuredClone(project.cells),
  }
}

export function syncPresetDraft(project: Project): Project {
  return {
    ...project,
    layoutPresets: project.layoutPresets?.map((preset) =>
      preset.id === project.activeLayoutId
        ? { ...preset, cells: structuredClone(project.cells) }
        : preset
    ),
  }
}

export function selectPreset(project: Project, id: string): Project {
  const next = syncPresetDraft(project)
  const preset = next.layoutPresets?.find((item) => item.id === id)
  if (!preset) throw new Error('卡片外觀不存在')
  return { ...next, activeLayoutId: id, cells: structuredClone(preset.cells) }
}

export function addPreset(project: Project, name: string, id: string, copy: boolean): Project {
  const next = syncPresetDraft(project)
  const presets = next.layoutPresets ?? []
  name = name.trim()
  if (
    !name ||
    name.length > 100 ||
    presets.length >= 30 ||
    presets.some((preset) => preset.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  ) {
    throw new Error('外觀名稱需為 1～100 字，且不可重複')
  }
  const cells = copy ? structuredClone(project.cells) : []
  return { ...next, layoutPresets: [...presets, { id, name, cells }], activeLayoutId: id, cells }
}

export function renamePreset(project: Project, name: string): Project {
  name = name.trim()
  if (
    !name ||
    name.length > 100 ||
    project.layoutPresets?.some(
      (preset) =>
        preset.id !== project.activeLayoutId &&
        preset.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )
  ) {
    throw new Error('外觀名稱需為 1～100 字，且不可重複')
  }
  return {
    ...project,
    layoutPresets: project.layoutPresets?.map((preset) =>
      preset.id === project.activeLayoutId ? { ...preset, name } : preset
    ),
  }
}

export function removePreset(project: Project): Project {
  if (!project.layoutPresets || project.layoutPresets.length < 2) {
    throw new Error('至少保留一個外觀')
  }
  const presets = project.layoutPresets.filter((preset) => preset.id !== project.activeLayoutId)
  const first = presets[0]
  return {
    ...project,
    layoutPresets: presets,
    activeLayoutId: first.id,
    cells: structuredClone(first.cells),
    ...(project.layoutRules
      ? {
          layoutRules: {
            ...project.layoutRules,
            card: dropLayout(project.layoutRules.card, project.activeLayoutId!),
          },
        }
      : {}),
  }
}

export interface CommonFieldNames {
  rating: string
  tags: string
  status: string
  statuses: string[]
  note: string
}

// A starting set of fields (rating, tags, status, note) added to the project and placed under the card's existing
// components, so a new project is usable without opening the layout editor. Fields whose name is already taken, and
// components that no longer fit, are skipped.
export function addCommonFields(project: Project, names: CommonFieldNames): Project {
  const wanted = [
    { alias: names.rating, type: 'number', kind: 'field-number' },
    { alias: names.tags, type: 'tags', kind: 'field-tags' },
    { alias: names.status, type: 'enum', kind: 'field-enum', options: names.statuses },
    { alias: names.note, type: 'string', kind: 'field-text' },
  ] as const
  const bindings = [...project.fieldBindings]
  const cells = [...project.cells]
  let y = Math.max(0, ...cells.map((c) => c.grid.y + c.grid.h))
  for (const item of wanted) {
    const alias = item.alias.trim()
    if (
      !alias ||
      bindings.some((f) => f.alias.toLowerCase() === alias.toLowerCase()) ||
      project.fieldGroups?.some((g) => g.name.trim().toLowerCase() === alias.toLowerCase())
    ) {
      continue
    }
    if (cells.length >= 50 || y + 1 > 100) break
    const attributeId = crypto.randomUUID()
    bindings.push({
      alias,
      attributeId,
      type: item.type,
      ...('options' in item ? { options: [...item.options] } : {}),
    })
    cells.push({
      cellId: crypto.randomUUID(),
      kind: item.kind,
      attributeId,
      grid: { x: 0, y, w: 12, h: 1 },
      style: { textColor: '#e4e6e8', backgroundColor: 'transparent' },
    })
    y += 1
  }
  return { ...project, fieldBindings: bindings, cells }
}

// Editor preview with the longest (or shortest non-empty) value of every field across the folders, plus the longest
// or shortest name and path, so a layout can be checked against its worst case instead of one chosen folder.
export type PreviewExtreme = 'longest' | 'shortest'
const sizeOf = (value: unknown) =>
  Array.isArray(value)
    ? value.map(String).join('、').length
    : value == null || value === ''
      ? 0
      : String(value).length

export function extremePreviewRow(
  rows: FolderRow[],
  fields: Project['fieldBindings'],
  mode: PreviewExtreme
): FolderRow | undefined {
  const base = rows.find((row) => row.record)
  if (!base?.record) return undefined
  const better = (a: number, b: number) => (mode === 'longest' ? a > b : a < b)
  const pick = <T>(items: T[], size: (item: T) => number) =>
    items
      .filter((item) => size(item) > 0)
      .reduce<T | undefined>(
        (best, item) => (!best || better(size(item), size(best)) ? item : best),
        undefined
      )
  const attributes: Attribute[] = fields.flatMap((field) => {
    const value = pick(
      rows.map((row) => fieldValue(row, field.attributeId)),
      sizeOf
    )
    return value === undefined
      ? []
      : [
          {
            attributeId: field.attributeId,
            key: field.alias,
            type: field.type,
            value,
            source: 'manual',
          },
        ]
  })
  return {
    ...base,
    name: pick(rows, (row) => row.name.length)?.name ?? base.name,
    path: pick(rows, (row) => row.path.length)?.path ?? base.path,
    record: { ...base.record, attributes, projectOverrides: {} },
  }
}

// Editor preview for fields without data (R-230): every field takes a real value from any folder that has one, and a
// sample of its type otherwise, so a new field shows how it will look before any folder holds a value. Never saved.
export type PreviewSamples = Record<string, unknown>

// A group shows its first member with a value, so within a group only the first member gets a sample, and none does
// when any member has real data (a sample would hide it).
export function samplePreviewRow(
  rows: FolderRow[],
  fields: Project['fieldBindings'],
  samples: PreviewSamples,
  groups: Project['fieldGroups'] = []
): FolderRow | undefined {
  const base = rows.find((row) => row.record)
  if (!base?.record) return undefined
  const filled = (value: unknown) => sizeOf(value) > 0
  const real = new Map(
    fields.map((field) => [
      field.attributeId,
      rows.map((row) => fieldValue(row, field.attributeId)).find(filled),
    ])
  )
  const sampled = (attributeId: string) => {
    const group = groups.find((g) => g.memberIds.includes(attributeId))
    return (
      !group ||
      (group.memberIds[0] === attributeId &&
        group.memberIds.every((id) => real.get(id) === undefined))
    )
  }
  const attributes: Attribute[] = fields.flatMap((field) => {
    const own = real.get(field.attributeId)
    const value =
      own !== undefined
        ? own
        : !sampled(field.attributeId)
          ? undefined
          : field.type === 'enum'
            ? field.options?.[0]
            : samples[field.type]
    return value === undefined
      ? []
      : [
          {
            attributeId: field.attributeId,
            key: field.alias,
            type: field.type,
            value,
            source: 'manual',
          },
        ]
  })
  return { ...base, record: { ...base.record, attributes, projectOverrides: {} } }
}

// R-409: the right-panel layouts. Each kind has a built-in panel (shared/explorer.ts builtinPanel) shown until a
// layout is chosen for it; a layout made from it is named "<kind> 預設" (translated where it is shown).
export const panelKindNames: Record<FolderKind, string> = {
  book: '書籍',
  game: '遊戲',
  music: '音樂',
  video: '影片',
  general: '一般',
}

export const panelDefaultName = (kind: string) => kind + ' 預設'

export function panelChoice(project: Project, row: FolderRow, kind: FolderKind) {
  const presets = project.panelPresets ?? []
  return choosePanel(project.layoutRules?.panel, row, kind, project.panelPresetId, (id) =>
    presets.some((preset) => preset.id === id)
  )
}

// The cells a folder's right panel shows: its chosen layout, else the built-in one of its kind.
export function panelCells(
  project: Project,
  row: FolderRow,
  kind: FolderKind,
  builtin: (kind: FolderKind) => Cell[]
): Cell[] {
  const choice = panelChoice(project, row, kind)
  return (
    (choice && project.panelPresets?.find((preset) => preset.id === choice.id)?.cells) ??
    builtin(kind)
  )
}

// The layout the panel editor opens for a kind: the one asked for, the kind's layout, the panel default; without
// any, a new "<kind> 預設" made from the built-in panel. In the editor the panel layouts stand where the card layouts
// are, so its layout tools serve them.
export function panelEditorProject(
  project: Project,
  kind: FolderKind,
  builtin: Cell[],
  start?: string,
  makeId: () => string = () => crypto.randomUUID()
): Project {
  let presets = structuredClone(project.panelPresets ?? [])
  const has = (id?: string) => !!id && presets.some((preset) => preset.id === id)
  let active = [start, project.layoutRules?.panel?.types?.[kind], project.panelPresetId].find(has)
  if (!active) {
    const name = panelDefaultName(panelKindNames[kind])
    const taken = new Set(presets.map((preset) => preset.name.toLocaleLowerCase()))
    let unique = name
    for (let n = 2; taken.has(unique.toLocaleLowerCase()); n++) unique = name + ' (' + n + ')'
    active = has('panel-' + kind) ? makeId() : 'panel-' + kind
    presets = [...presets, { id: active, name: unique, cells: structuredClone(builtin) }]
  }
  return {
    ...project,
    cells: structuredClone(presets.find((preset) => preset.id === active)!.cells),
    layoutPresets: presets,
    activeLayoutId: active,
    layoutRules: undefined,
    // The editor's layout list is the panel layouts; fromPanelEditor puts them back.
    panelPresets: undefined,
    panelPresetId: undefined,
  }
}

// Back from the panel editor: the card layouts stay as they were. The layout chosen when saving becomes the kind's
// layout, unless the editor was opened for one folder's layout (keepDefault). Rules pointing at a deleted layout drop it.
export function fromPanelEditor(
  original: Project,
  edited: Project,
  kind: FolderKind,
  keepDefault: boolean
): Project {
  const synced = syncPresetDraft(edited)
  const presets = synced.layoutPresets!
  const kept = new Set(presets.map((preset) => preset.id))
  let panel = original.layoutRules?.panel
  for (const preset of original.panelPresets ?? []) {
    if (!kept.has(preset.id)) panel = dropLayout(panel, preset.id)
  }
  if (!keepDefault) panel = { ...panel, types: { ...panel?.types, [kind]: synced.activeLayoutId! } }
  const rules = { ...original.layoutRules, panel }
  if (!Object.keys(panel ?? {}).length) delete rules.panel
  // Field groups changed in this editor were settled in its draft; the card layouts restored here are settled
  // against them the same way.
  return settleCells(
    {
      ...synced,
      cells: original.cells,
      layoutPresets: original.layoutPresets,
      activeLayoutId: original.activeLayoutId,
      layoutRules: rules,
      panelPresets: presets,
      panelPresetId:
        original.panelPresetId && kept.has(original.panelPresetId)
          ? original.panelPresetId
          : undefined,
    },
    original.fieldGroups ?? []
  )
}

// R-546: 3 starter card templates selectable from the editor layout dropdown (undoable like any edit).
export type StarterCardTemplate = 'cover' | 'detailed' | 'compact'

const baseCellStyle = (): Cell['style'] => ({
  textColor: '#e4e6e8',
  backgroundColor: 'transparent',
})

export function starterCardCells(
  template: StarterCardTemplate,
  project: Pick<Project, 'fieldBindings'>,
  makeId: () => string = () => crypto.randomUUID()
): Cell[] {
  const fieldKindOf = (type: string): Cell['kind'] | undefined =>
    ({
      string: 'field-text',
      tags: 'field-tags',
      number: 'field-number',
      date: 'field-date',
      datetime: 'field-date',
      boolean: 'field-boolean',
      enum: 'field-enum',
      url: 'field-url',
    })[type] as Cell['kind'] | undefined

  if (template === 'cover') {
    return [
      {
        cellId: makeId(),
        kind: 'image',
        imageCover: true,
        imageFit: 'cover',
        grid: { x: 0, y: 0, w: 12, h: 4 },
        style: baseCellStyle(),
      },
      {
        cellId: makeId(),
        kind: 'name',
        grid: { x: 0, y: 4, w: 12, h: 1 },
        style: { ...baseCellStyle(), weight: 'bold' },
      },
    ]
  }
  if (template === 'compact') {
    return [
      {
        cellId: makeId(),
        kind: 'image',
        imageCover: true,
        imageFit: 'cover',
        grid: { x: 0, y: 0, w: 3, h: 2 },
        style: baseCellStyle(),
      },
      {
        cellId: makeId(),
        kind: 'name',
        grid: { x: 3, y: 0, w: 9, h: 1 },
        style: { ...baseCellStyle(), weight: 'bold' },
      },
      {
        cellId: makeId(),
        kind: 'system-info',
        systemInfo: 'category',
        grid: { x: 3, y: 1, w: 6, h: 1 },
        style: baseCellStyle(),
      },
      {
        cellId: makeId(),
        kind: 'open-folder',
        grid: { x: 9, y: 1, w: 3, h: 1 },
        style: baseCellStyle(),
      },
    ]
  }
  // 'detailed': cover + name + category + path + up to 2 bound project fields.
  const cells: Cell[] = [
    {
      cellId: makeId(),
      kind: 'image',
      imageCover: true,
      imageFit: 'cover',
      grid: { x: 0, y: 0, w: 12, h: 3 },
      style: baseCellStyle(),
    },
    {
      cellId: makeId(),
      kind: 'name',
      grid: { x: 0, y: 3, w: 12, h: 1 },
      style: { ...baseCellStyle(), weight: 'bold' },
    },
    {
      cellId: makeId(),
      kind: 'system-info',
      systemInfo: 'category',
      grid: { x: 0, y: 4, w: 6, h: 1 },
      style: baseCellStyle(),
    },
    {
      cellId: makeId(),
      kind: 'path',
      grid: { x: 6, y: 4, w: 6, h: 1 },
      style: baseCellStyle(),
    },
  ]
  let y = 5
  for (const field of project.fieldBindings.slice(0, 2)) {
    const kind = fieldKindOf(field.type)
    if (!kind) continue
    cells.push({
      cellId: makeId(),
      kind,
      attributeId: field.attributeId,
      grid: { x: 0, y, w: 12, h: 1 },
      style: baseCellStyle(),
    })
    y++
  }
  return cells
}
