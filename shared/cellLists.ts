import type { Cell, Project } from './model'

// R-368: the one place that knows where a project keeps lists of layout components. Everything that must reach
// every list (removing a field, field groups, changing a field's type, usage lists, the search index, settling on
// read, validation) goes through here, so a new kind of list is added to `holders` and nowhere else.
//
// Each holder is an array of { id, name, cells }. `refs` are the settings that only mean something next to the
// holder (the chosen preset).
const holders = [
  { where: 'layout', key: 'layoutPresets', refs: ['activeLayoutId'] },
  // R-409: the right-panel layouts.
  { where: 'panel', key: 'panelPresets', refs: ['panelPresetId'] },
] as const satisfies readonly {
  where: string
  key: keyof Project
  refs: readonly (keyof Project)[]
}[]

// 'card' is `cells` itself: the card being shown, or the list open in an editor.
export const cellListKinds = ['card', ...holders.map((holder) => holder.where)] as const
export type CellListKind = (typeof cellListKinds)[number]

export interface CellList {
  where: CellListKind
  // The preset's id; the card has none.
  id?: string
  // The preset's name; the card has none.
  name?: string
  cells: Cell[]
}

const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

// Every cell list of a project, in a stable order: the card, the card layouts, the right-panel layouts. The active
// card layout's saved copy is listed like any other; callers that count things once skip it themselves.
export function cellLists(
  project: Pick<Project, 'cells' | (typeof holders)[number]['key']>
): CellList[] {
  return [
    { where: 'card', cells: project.cells },
    ...holders.flatMap(({ where, key }): CellList[] =>
      (project[key] ?? []).map((preset) => ({
        where,
        id: preset.id,
        name: preset.name,
        cells: preset.cells,
      }))
    ),
  ]
}

// The same change applied to every list of a record that has not been validated yet (read from disk, on its way
// through an upgrade). Holders that are absent stay absent; anything of an unexpected shape is left as it is.
export function mapRawCellLists(
  value: Record<string, unknown>,
  map: (list: unknown) => unknown
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...value, cells: map(value.cells) }
  for (const { key } of holders) {
    const held = value[key]
    if (Array.isArray(held)) {
      next[key] = held.map((preset) =>
        plain(preset) ? { ...preset, cells: map(preset.cells) } : preset
      )
    }
  }
  return next
}

// One change applied to every cell list of a project.
export function mapCellLists(project: Project, map: (cells: Cell[]) => Cell[]): Project {
  return mapRawCellLists(
    project as unknown as Record<string, unknown>,
    map as (list: unknown) => unknown
  ) as unknown as Project
}

// The value with one list as its card and no other list: what validation checks each saved list as, so a list is
// checked once and not again inside every other one. It runs on values still being validated, so it takes the raw
// record, not a Project.
export function withOnlyCells(
  value: Record<string, unknown>,
  cells: unknown
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...value, cells }
  for (const { key, refs } of holders) for (const name of [key, ...refs]) next[name] = undefined
  // The layout rules are checked once with the project, not again with every list of cells (R-413).
  next.layoutRules = undefined
  return next
}
