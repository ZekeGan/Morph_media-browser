import '../media/media-workspace.css'
import { t as tr } from '../i18n'
import { Icon } from '../common/icons'
import { iconLabel } from '../common/IconLabel'
import {
  ActionIcon,
  Button,
  Checkbox,
  Menu,
  NumberInput,
  Popover,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { cardDisplay } from '../../shared/browse'
import { type FolderRow, type Project } from '../../shared/model'
import type { BrowseMode, BrowseState } from '../../shared/explorer'
import { SortMenu } from './SortMenu'
type Props = {
  browse: BrowseState
  busy: boolean
  cardSaveError: string
  changedCard: () => void
  columnQuery: string
  currentFolder?: FolderRow
  deepest: number
  density: { itemsPerRow: number | string; pageSize: number | string }
  display: ReturnType<typeof cardDisplay>
  folderMode: boolean
  switchContent: (value: 'folders' | 'files') => void
  openConfig: (id: string, tab?: string) => void
  orderedColumns: { id: string; label: string }[]
  persist: (next: BrowseState) => void
  // R-413: the layout the current folder uses, shown on the button that opens the layout configuration window.
  layoutLabel: string
  openLayouts: () => void
  project: Project
  ready: boolean
  setColumnQuery: (value: string) => void
  setDensity: (value: { itemsPerRow: number | string; pageSize: number | string }) => void
  setDisplay: (value: ReturnType<typeof cardDisplay>) => void
  setOverviewTools: (element: HTMLDivElement | null) => void
  setOverviewScope: (element: HTMLDivElement | null) => void
  setPage: (page: number) => void
  state: { current: BrowseState }
  switchMode: (mode: BrowseMode) => Promise<void>
}

// The folder-mode toolbar (view mode, presets, filters, tools) and the CARD display controls under it.
export function BrowseToolbar(props: Props) {
  const {
    browse,
    busy,
    cardSaveError,
    changedCard,
    columnQuery,
    currentFolder,
    deepest,
    density,
    display,
    folderMode,
    switchContent,
    openConfig,
    orderedColumns,
    persist,
    layoutLabel,
    openLayouts,
    ready,
    setColumnQuery,
    setDensity,
    setDisplay,
    setOverviewTools,
    setOverviewScope,
    setPage,
    state,
    switchMode,
  } = props
  return (
    <>
      <div className={'workspace-toolbar' + (folderMode ? '' : ' file-mode-toolbar')}>
        <div className="toolbar-left">
          <SegmentedControl
            className="content-switch"
            aria-label={tr('展示內容')}
            size="xs"
            value={browse.contentMode ?? 'folders'}
            disabled={busy || !ready}
            data={[
              {
                value: 'folders',
                label: (
                  <span className="content-switch-label">
                    <Icon name="folder" size={15} />
                    {tr('資料夾')}
                  </span>
                ),
              },
              {
                value: 'files',
                label: (
                  <span className="content-switch-label">
                    <Icon name="file" size={15} />
                    {tr('檔案')}
                  </span>
                ),
              },
            ]}
            onChange={(value) => switchContent(value as 'folders' | 'files')}
          />
          {folderMode && (
            <SegmentedControl
              className="center-mode"
              aria-label={tr('瀏覽模式')}
              size="xs"
              value={browse.mode}
              data={(['CARD', 'TABLE', 'TREE'] as const).map((mode) => ({
                value: mode,
                label: iconLabel(
                  mode === 'CARD' ? 'grid' : mode === 'TABLE' ? 'list' : 'tree',
                  mode === 'CARD' ? tr('卡片') : mode === 'TABLE' ? tr('表格') : tr('樹狀圖')
                ),
              }))}
              disabled={busy || !ready}
              onChange={(mode) => void switchMode(mode as BrowseMode)}
            />
          )}
          <div
            ref={setOverviewTools}
            className="workspace-file-tools"
            style={{ display: folderMode ? 'none' : undefined }}
          />
          {folderMode && browse.mode !== 'TABLE' && (
            // R-413: which layout each folder uses is set in the layout configuration window. R-470: one button, with
            // the layout icon every layout entry uses; a narrow toolbar keeps only the icon. R-481: the tree has it
            // too, since its nodes can be the folders' cards.
            <Tooltip label={tr('版面配置') + '：' + layoutLabel} withArrow>
              <Button
                size="xs"
                variant="default"
                className="layout-config-button"
                leftSection={<Icon name="layout" size={15} />}
                aria-label={tr('版面配置') + '：' + layoutLabel}
                disabled={busy}
                onClick={openLayouts}
              >
                <span className="layout-config-label">{layoutLabel}</span>
              </Button>
            </Tooltip>
          )}
          {folderMode && browse.mode === 'TREE' && (
            // R-466: nodes as the folders' cards, sized by the card layout each folder uses.
            <Tooltip label={tr('以卡片顯示節點')} withArrow>
              <ActionIcon
                className="tree-cards-toggle"
                variant={browse.treeCards ? 'light' : 'subtle'}
                aria-label={tr('以卡片顯示節點')}
                aria-pressed={!!browse.treeCards}
                disabled={busy || !ready}
                onClick={() => persist({ ...state.current, treeCards: !state.current.treeCards })}
              >
                <Icon name="grid" />
              </ActionIcon>
            </Tooltip>
          )}
          {folderMode && browse.mode !== 'TREE' && (
            <SortMenu
              columns={orderedColumns}
              keys={browse.sortKeys ?? []}
              foldersFirst={browse.foldersFirst !== false}
              busy={busy || !ready}
              onChange={(sortKeys, foldersFirst) => {
                persist({ ...state.current, sortKeys, foldersFirst })
                setPage(1)
              }}
            />
          )}
        </div>
        <div className="toolbar-right">
          <div
            ref={setOverviewScope}
            className="workspace-file-scope"
            style={{ display: folderMode ? 'none' : undefined }}
          />
          {folderMode && browse.mode === 'CARD' && (
            // R-331: a fade, not the default scale, so the switch inside measures its real size when it opens.
            <Popover
              position="bottom-end"
              withArrow
              shadow="md"
              width={260}
              transitionProps={{ transition: 'fade' }}
            >
              <Popover.Target>
                <Button
                  className="card-display-button scope-button"
                  size="xs"
                  variant="default"
                  aria-label={tr('卡片顯示設定')}
                  leftSection={<Icon name="sliders" size={14} />}
                >
                  <span className="card-display-summary">
                    {display.works
                      ? tr('所有作品') +
                        (display.level === 'all' ? '' : ' · ' + tr('最多 {0} 層', display.level))
                      : tr('逐層瀏覽')}
                  </span>
                </Button>
              </Popover.Target>
              <Popover.Dropdown>
                <div className="card-inline-controls">
                  <div>
                    <Text size="xs" c="dimmed" mb={4}>
                      {tr('層級顯示')}
                    </Text>
                    <SegmentedControl
                      size="xs"
                      fullWidth
                      aria-label={tr('層級顯示')}
                      value={display.works ? 'works' : 'step'}
                      data={[
                        { value: 'step', label: tr('逐層瀏覽') },
                        { value: 'works', label: tr('所有作品') },
                      ]}
                      onChange={(value) => {
                        setDisplay(
                          value === 'works'
                            ? { mode: 'multi', level: 'all', works: true }
                            : { mode: 'single', level: 1, works: false }
                        )
                        changedCard()
                      }}
                    />
                  </div>
                  {display.works && (
                    <details className="card-display-advanced">
                      <summary>{tr('進階')}</summary>
                      <Select
                        size="xs"
                        label={tr('最多往下幾層')}
                        aria-label={tr('最多往下幾層')}
                        value={String(display.level)}
                        allowDeselect={false}
                        data={[
                          { value: 'all', label: tr('不限') },
                          ...Array.from({ length: deepest }, (_, index) => ({
                            value: String(index + 1),
                            label: tr('{0} 層', index + 1),
                          })),
                        ]}
                        onChange={(value) => {
                          if (value) {
                            setDisplay({
                              ...display,
                              level: value === 'all' ? 'all' : Number(value),
                            })
                            changedCard()
                          }
                        }}
                      />
                    </details>
                  )}
                  <NumberInput
                    size="xs"
                    label={tr('每列卡片數')}
                    min={1}
                    max={6}
                    allowDecimal={false}
                    value={density.itemsPerRow}
                    onChange={(value) => {
                      setDensity({ ...density, itemsPerRow: value })
                      changedCard()
                    }}
                  />
                  <NumberInput
                    size="xs"
                    label={tr('每頁筆數')}
                    min={1}
                    max={500}
                    allowDecimal={false}
                    value={density.pageSize}
                    onChange={(value) => {
                      setDensity({ ...density, pageSize: value })
                      changedCard()
                    }}
                  />
                  {cardSaveError && (
                    <Button size="compact-xs" color="red" variant="subtle" onClick={changedCard}>
                      {cardSaveError}
                    </Button>
                  )}
                </div>
              </Popover.Dropdown>
            </Popover>
          )}
          {folderMode && browse.mode === 'TABLE' && (
            <Menu closeOnItemClick={false}>
              <Menu.Target>
                <Button
                  size="xs"
                  variant="default"
                  aria-label={tr('選擇表格欄位')}
                  leftSection={<Icon name="list" size={14} />}
                >
                  {tr('欄位')}
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <TextInput
                  placeholder={tr('搜尋欄位')}
                  aria-label={tr('搜尋欄位')}
                  value={columnQuery}
                  onChange={(event) => setColumnQuery(event.currentTarget.value)}
                />
                <Stack gap="xs" p="xs" style={{ maxHeight: 'min(48vh,320px)', overflowY: 'auto' }}>
                  {orderedColumns
                    .filter((column) =>
                      column.label.toLocaleLowerCase().includes(columnQuery.toLocaleLowerCase())
                    )
                    .map((column) => (
                      <Checkbox
                        key={column.id}
                        label={column.label}
                        disabled={column.id === 'name' || busy}
                        checked={column.id === 'name' || !browse.hiddenColumns?.includes(column.id)}
                        onChange={(event) =>
                          persist({
                            ...state.current,
                            hiddenColumns: event.currentTarget.checked
                              ? (state.current.hiddenColumns ?? []).filter((id) => id !== column.id)
                              : [...new Set([...(state.current.hiddenColumns ?? []), column.id])],
                          })
                        }
                      />
                    ))}
                </Stack>
                <Button
                  variant="subtle"
                  size="xs"
                  onClick={() => persist({ ...state.current, hiddenColumns: [] })}
                >
                  {tr('恢復預設')}
                </Button>
              </Menu.Dropdown>
            </Menu>
          )}
          <Tooltip label={tr('目前資料夾設定')}>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label={tr('目前資料夾設定')}
              disabled={!currentFolder || busy}
              onClick={() => currentFolder && openConfig(currentFolder.rowId)}
            >
              <Icon name="folder-settings" />
            </ActionIcon>
          </Tooltip>
        </div>
      </div>
    </>
  )
}
