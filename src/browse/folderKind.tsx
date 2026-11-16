import { createContext, useContext, useSyncExternalStore } from 'react'
import { Tooltip } from '@mantine/core'
import type { FolderRow } from '../../shared/model'
import { parentPath, pathKey } from '../../shared/browse'
import { detectFolderKind, type FolderKind, type KindSample } from '../../shared/kind'
import { t as tr, useLocale } from '../i18n'
import { Icon, type IconName } from '../common/icons'
import { cachedFolderSample, useFolderSample } from './folderStats'

// R-343: what a folder is, shown as its icon in the tree, table and panel title, and as a small badge on its card.
// A folder that has not been opened yet is only known by what was set by hand, a game boundary or its reading mode.
export type KindLook = 'game' | 'novel' | 'manga' | 'music' | 'video' | 'general'
const looks: Record<KindLook, { icon: IconName; label: string }> = {
  game: { icon: 'game', label: '遊戲' },
  novel: { icon: 'book', label: '小說' },
  manga: { icon: 'page-spread', label: '漫畫' },
  music: { icon: 'music', label: '音樂' },
  video: { icon: 'video', label: '影片' },
  general: { icon: 'folder', label: '一般' },
}
// R-404: the rows of the open project by path, so the kind of the folder above can be found (set by BrowseWorkspace).
export const KindRowsContext = createContext<Map<string, FolderRow> | undefined>(undefined)
// R-413: the folders of the open project that count as works (shared/browse.ts isWork), which decides whether a
// folder takes its kind's layout or its level's. A folder not in it (outside a workspace, or not in the structure
// the workspace knows) is taken as a work, as the older kind layouts were applied to every folder.
export const LayoutWorksContext = createContext<Map<string, boolean> | undefined>(undefined)
export const isLayoutWork = (works: Map<string, boolean> | undefined, rowId: string) =>
  works?.get(rowId) ?? true
export function useIsWork(row: FolderRow | undefined) {
  const works = useContext(LayoutWorksContext)
  return !row || isLayoutWork(works, row.rowId)
}
// The kind of the folder directly above, from its own files only (one level, never its parent). Undefined if unknown.
export function useParentKind(row: FolderRow | undefined): FolderKind | undefined {
  const rows = useContext(KindRowsContext)
  const parent = row && rows?.get(pathKey(parentPath(row.path)))
  if (!parent || parent.rowId === row.rowId) return undefined
  return detectFolderKind(parent, cachedFolderSample(parent.rowId) ?? parent.contents).kind
}
export function kindLook(row: FolderRow, sample?: KindSample, parentKind?: FolderKind) {
  const detected = detectFolderKind(row, sample, parentKind)
  const look: KindLook =
    detected.kind === 'game'
      ? 'game'
      : detected.kind === 'book'
        ? (sample?.epubs ?? 0) >= 1 || (sample?.texts ?? 0) > (sample?.images ?? 0)
          ? 'novel'
          : 'manga'
        : detected.kind
  const candidate =
    row.boundary?.state === 'candidate' || row.record?.details?.boundary?.state === 'candidate'
  return { look, manual: detected.source === 'manual', candidate }
}
// What the scan counted (R-340) is enough for folders never opened; an opened folder's content sample is more exact.
export function useKindLook(row: FolderRow) {
  const parentKind = useParentKind(row)
  return kindLook(row, useFolderSample(row.rowId) ?? row.contents, parentKind)
}

// The icon only (tree, table, panel title); a candidate game shows the game icon in its unconfirmed style.
export function KindIcon({ row, size = 16 }: { row: FolderRow; size?: number }) {
  useLocale()
  const { look, candidate } = useKindLook(row)
  const shown = candidate && look === 'general' ? 'game' : look
  return (
    <span
      className={'kind-icon kind-' + shown + (candidate && look !== 'game' ? ' unconfirmed' : '')}
      aria-hidden="true"
    >
      <Icon name={looks[shown].icon} size={size} />
    </span>
  )
}

// The badge on a card (R-344): the kind's icon, a plain folder for general folders or when kind badges are turned
// off. Its tooltip says the kind and whether it was detected or set by hand; a click shows the folder contents.
export function KindBadge({ row, show }: { row: FolderRow; show: () => void }) {
  useLocale()
  const { look, manual, candidate } = useKindLook(row)
  const visible = useKindBadgeVisible()
  const typed = visible && (look !== 'general' || candidate)
  const shown: KindLook = !typed ? 'general' : look === 'general' ? 'game' : look,
    unconfirmed = typed && candidate && look !== 'game',
    kind = !visible
      ? ''
      : unconfirmed
        ? tr('疑似遊戲 · 尚未確認')
        : tr(looks[shown].label) + ' · ' + (manual ? tr('你指定的') : tr('自動判斷')),
    label = kind ? kind + ' — ' + tr('顯示資料夾內容') : tr('顯示資料夾內容')
  return (
    <Tooltip label={label} withArrow>
      <button
        type="button"
        className={'kind-badge kind-' + shown + (unconfirmed ? ' unconfirmed' : '')}
        aria-label={label}
        onClick={(event) => {
          event.stopPropagation()
          show()
        }}
      >
        <Icon name={looks[shown].icon} size={14} />
      </button>
    </Tooltip>
  )
}

// Showing the kind on card badges is this computer's choice (on unless turned off).
const badgeKey = 'morph.kindBadge'
const badgeListeners = new Set<() => void>()
const readBadge = () => {
  try {
    return localStorage.getItem(badgeKey) !== 'off'
  } catch {
    return true
  }
}
export function setKindBadgeVisible(value: boolean) {
  try {
    localStorage.setItem(badgeKey, value ? 'on' : 'off')
  } catch {}
  for (const listener of badgeListeners) listener()
}
export function useKindBadgeVisible() {
  return useSyncExternalStore((callback) => {
    badgeListeners.add(callback)
    return () => badgeListeners.delete(callback)
  }, readBadge)
}
