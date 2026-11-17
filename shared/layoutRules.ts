import type { FolderRow, Project } from './model'
import { effectiveKind, type FolderKind } from './kind'

// R-413: which layout a folder shows, for its card and for the right panel, from one set of rules per project.
// A folder's own choice wins; a work (album, video, game, book…) takes the layout of its kind, so the same kind looks
// the same at any depth and a work inside a work keeps its own kind's layout; any other folder takes the layout set
// for its level below the project root; everything else falls back to layout 0 (the project's default layout).
// Rules: docs/LAYOUT_RULES.md.
export interface LayoutRule {
  types?: Partial<Record<FolderKind, string>>
  // levels[0] is the first level below the project root.
  levels?: string[]
  // folderId → layout id.
  folders?: Record<string, string>
}
export interface LayoutRules {
  card?: LayoutRule
  panel?: LayoutRule
}
export type LayoutSource = 'folder' | 'type' | 'level' | 'default'
export interface LayoutChoice {
  id: string
  source: LayoutSource
}

// Level 1 is a folder directly below the project root; the root itself is level 0 (rows count the root as depth 1).
export const layoutLevel = (row: Pick<FolderRow, 'depth'>) => Math.max(0, row.depth - 1)

// `work` says whether the folder counts as a work (shared/browse.ts isWork); `known` tells which ids still exist, so a
// rule pointing at a deleted layout is skipped instead of showing nothing.
export function chooseLayout(
  rule: LayoutRule | undefined,
  row: FolderRow,
  work: boolean,
  fallback: string,
  known: (id: string) => boolean
): LayoutChoice {
  const pick = (id: string | undefined, source: LayoutSource): LayoutChoice | undefined =>
    id && known(id) ? { id, source } : undefined
  const folderId = row.record?.folderId,
    level = layoutLevel(row)
  return (
    pick(folderId ? rule?.folders?.[folderId] : undefined, 'folder') ??
    (work
      ? // What the scan counted is enough to tell the kind of a folder never opened (R-340).
        pick(rule?.types?.[effectiveKind(row, row.contents)], 'type')
      : level > 0
        ? pick(rule?.levels?.[level - 1], 'level')
        : undefined) ?? { id: fallback, source: 'default' }
  )
}

// R-409: the right panel follows the page's kind rather than whether the folder counts as a work, as the book template
// always did: the folder's own choice, its kind's layout, its level's layout, the panel default. Without any of them
// (undefined) the folder shows its kind's built-in panel.
export function choosePanel(
  rule: LayoutRule | undefined,
  row: FolderRow,
  kind: FolderKind,
  fallback: string | undefined,
  known: (id: string) => boolean
): LayoutChoice | undefined {
  const pick = (id: string | undefined, source: LayoutSource): LayoutChoice | undefined =>
    id && known(id) ? { id, source } : undefined
  const folderId = row.record?.folderId,
    level = layoutLevel(row)
  return (
    pick(folderId ? rule?.folders?.[folderId] : undefined, 'folder') ??
    pick(rule?.types?.[kind], 'type') ??
    (level > 0 ? pick(rule?.levels?.[level - 1], 'level') : undefined) ??
    pick(fallback, 'default')
  )
}

// Every change to the rules goes through here: the project's rules are copied, changed and emptied parts dropped.
export function editLayoutRules<P extends Pick<Project, 'layoutRules'>>(
  project: P,
  change: (rules: { card: LayoutRule; panel: LayoutRule }) => void
): P {
  const base = structuredClone(project.layoutRules ?? {}),
    rules = { card: base.card ?? {}, panel: base.panel ?? {} }
  change(rules)
  const tidy = (rule: LayoutRule) => {
    const out: LayoutRule = {}
    if (rule.types && Object.keys(rule.types).length) out.types = rule.types
    const levels = [...(rule.levels ?? [])]
    while (levels.length && !levels[levels.length - 1]) levels.pop()
    if (levels.length) out.levels = levels
    if (rule.folders && Object.keys(rule.folders).length) out.folders = rule.folders
    return Object.keys(out).length ? out : undefined
  }
  const card = tidy(rules.card),
    panel = tidy(rules.panel)
  return {
    ...project,
    layoutRules: { ...(card ? { card } : {}), ...(panel ? { panel } : {}) },
  }
}

// A layout that was deleted is dropped from every rule that pointed at it (its folders then fall back).
export function dropLayout(rule: LayoutRule | undefined, id: string): LayoutRule | undefined {
  if (!rule) return rule
  const types = Object.fromEntries(Object.entries(rule.types ?? {}).filter(([, v]) => v !== id)),
    folders = Object.fromEntries(Object.entries(rule.folders ?? {}).filter(([, v]) => v !== id)),
    levels = rule.levels?.map((v) => (v === id ? '' : v))
  while (levels?.length && !levels[levels.length - 1]) levels.pop()
  return {
    ...(Object.keys(types).length ? { types } : {}),
    ...(levels?.length ? { levels } : {}),
    ...(Object.keys(folders).length ? { folders } : {}),
  }
}
