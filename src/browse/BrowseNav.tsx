import { ActionIcon, Breadcrumbs, Tooltip } from '@mantine/core'

import type { FolderRow } from '../../shared/model'

import { Icon } from '../common/icons'
import { t as tr } from '../i18n'

// The bar above the folder list: back and forward through visited places, the clickable path, and a count.
export function BrowseNav({
  ready,
  busy,
  history,
  navHistory,
  crumbs,
  title,
  open,
  openConfig,
  summary,
  inline = false,
}: {
  ready: boolean
  busy: boolean
  history: { items: string[]; index: number }
  navHistory: (delta: number) => void
  crumbs: FolderRow[]
  // The full path of the place shown.
  title: string
  open: (id: string) => void
  openConfig: (id: string) => void
  // "N 筆 · …", shown only in the folders view.
  summary?: string
  // R-547: at the project root on a wide center pane, navigation merges into the main toolbar row.
  inline?: boolean
}) {
  return (
    <div className={inline ? 'toolbar-nav' : 'workspace-breadcrumb'}>
      <Tooltip label={tr('返回上一個瀏覽位置')}>
        <ActionIcon
          aria-label={tr('返回')}
          disabled={!ready || !history.index || busy}
          variant="subtle"
          color="gray"
          onClick={() => navHistory(-1)}
        >
          <Icon name="arrow-left" />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={tr('前進至下一個瀏覽位置')}>
        <ActionIcon
          aria-label={tr('前進')}
          disabled={!ready || history.index >= history.items.length - 1 || busy}
          variant="subtle"
          color="gray"
          onClick={() => navHistory(1)}
        >
          <Icon name="arrow-right" />
        </ActionIcon>
      </Tooltip>
      <nav className="breadcrumb-path" aria-label={tr('資料夾路徑')} title={title}>
        <Breadcrumbs separator={String.fromCharCode(92)}>
          {crumbs.map((r, i) =>
            i === crumbs.length - 1 ? (
              <span
                key={r.rowId}
                aria-current="page"
                className="breadcrumb-current"
                title={r.path}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openConfig(r.rowId)
                }}
              >
                {r.name}
              </span>
            ) : (
              <button
                key={r.rowId}
                className="breadcrumb-link"
                title={r.path}
                disabled={busy}
                onClick={() => open(r.rowId)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  openConfig(r.rowId)
                }}
              >
                {r.name}
              </button>
            )
          )}
        </Breadcrumbs>
      </nav>
      {summary !== undefined && (
        <small className="view-count" title={tr('Ctrl／Shift 點選可多選資料夾，再批次指定類型')}>
          {summary}
        </small>
      )}
    </div>
  )
}
