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
  Switch,
  TextInput,
  Tooltip,
} from '@mantine/core'
import type { ReactNode } from 'react'

import { cardDisplay } from '../../shared/browse'
import type { BrowseMode, BrowseState } from '../../shared/explorer'
import { cardPresets } from '../../shared/layouts'
import { type FolderRow, type Project } from '../../shared/model'

import { iconLabel } from '../common/IconLabel'
import { Icon } from '../common/icons'
import { layoutName } from '../editor/layoutName'
import { t as tr } from '../i18n'
import { SortMenu } from './SortMenu'

import '../media/media-workspace.css'

export type ViewAxis = 'step' | 'works' | 'files'

type Props = {
  nav?: ReactNode
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
  viewAxis: ViewAxis
  switchView: (value: ViewAxis) => void
  openConfig: (id: string, tab?: string) => void
  orderedColumns: { id: string; label: string }[]
  persist: (next: BrowseState) => void
  // R-544: the layout the current folder uses; main button edits it, arrow opens layout menu & configuration.
  layoutLabel: string
  editCurrentLayout: () => void
  setDefaultLayout: (id: string) => void
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

// R-547, R-536, R-544: single-row main toolbar (with inline root nav on wide panes), unified view switcher,
// split layout button, and one View Options popover for density/depth/tree-cards/table-columns.
export function BrowseToolbar(props: Props) {
  const {
    nav,
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
    viewAxis,
    switchView,
    openConfig,
    orderedColumns,
    persist,
    layoutLabel,
    editCurrentLayout,
    setDefaultLayout,
    openLayouts,
    project,
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
  const presets = cardPresets(project)
  const defaultLayoutId = project.activeLayoutId ?? presets[0].id
  return (
    <div
      className={
        'workspace-toolbar' +
        (folderMode ? '' : ' file-mode-toolbar') +
        (nav ? ' has-inline-nav' : '')
      }
    >
      {nav}
      <div className="toolbar-left">
        <SegmentedControl
          className="content-switch"
          aria-label={tr('展示內容')}
          size="xs"
          value={viewAxis}
          disabled={busy || !ready}
          data={[
            {
              value: 'step',
              label: (
                <span className="content-switch-label">
                  <Icon name="folder" size={14} />
                  {tr('逐層瀏覽')}
                </span>
              ),
            },
            {
              value: 'works',
              label: (
                <span className="content-switch-label">
                  <Icon name="layers" size={14} />
                  {tr('所有作品')}
                </span>
              ),
            },
            {
              value: 'files',
              label: (
                <span className="content-switch-label">
                  <Icon name="file" size={14} />
                  {tr('檔案總覽')}
                </span>
              ),
            },
          ]}
          onChange={(value) => switchView(value as ViewAxis)}
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
        {folderMode && browse.mode !== 'TABLE' && (
          // R-544: main button opens the editor on the current layout directly; split arrow switches default or opens LayoutConfig.
          <Button.Group className="layout-split-button">
            <Tooltip label={tr('編輯目前版面：{0}', layoutLabel)} withArrow>
              <Button
                size="xs"
                variant="default"
                className="layout-config-button"
                leftSection={<Icon name="layout" size={15} />}
                aria-label={tr('編輯目前版面：{0}', layoutLabel)}
                disabled={busy}
                onClick={editCurrentLayout}
              >
                <span className="layout-config-label">{layoutLabel}</span>
              </Button>
            </Tooltip>
            <Menu position="bottom-end" shadow="md" width={210}>
              <Menu.Target>
                <Tooltip label={tr('版面選單')} withArrow>
                  <Button
                    size="xs"
                    variant="default"
                    className="layout-split-arrow"
                    aria-label={tr('版面選單')}
                    disabled={busy}
                  >
                    <Icon name="chevron-down" size={14} />
                  </Button>
                </Tooltip>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>{tr('預設卡片版面')}</Menu.Label>
                {presets.map((preset) => (
                  <Menu.Item
                    key={preset.id}
                    disabled={busy}
                    leftSection={
                      preset.id === defaultLayoutId ? (
                        <Icon name="check" size={14} />
                      ) : (
                        <span className="folder-menu-blank" />
                      )
                    }
                    onClick={() => preset.id !== defaultLayoutId && setDefaultLayout(preset.id)}
                  >
                    {layoutName(preset)}
                  </Menu.Item>
                ))}
                <Menu.Divider />
                <Menu.Item leftSection={<Icon name="sliders" size={14} />} onClick={openLayouts}>
                  {tr('版面配置…')}
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          </Button.Group>
        )}
      </div>
      <div className="toolbar-right">
        <div
          ref={setOverviewScope}
          className="workspace-file-scope"
          style={{ display: folderMode ? 'none' : undefined }}
        />
        {folderMode && (
          // R-547: density, max depth, tree card-nodes switch, and table columns all live in one View Options popover.
          <Popover
            position="bottom-end"
            withArrow
            shadow="md"
            width={browse.mode === 'TABLE' ? 240 : 250}
            transitionProps={{ transition: 'fade' }}
          >
            <Popover.Target>
              <Tooltip label={tr('檢視選項')} withArrow>
                <ActionIcon
                  className="card-display-button scope-button"
                  variant="default"
                  aria-label={tr('檢視選項')}
                  disabled={busy || !ready}
                >
                  <Icon name="sliders" size={15} />
                </ActionIcon>
              </Tooltip>
            </Popover.Target>
            <Popover.Dropdown>
              {browse.mode === 'CARD' ? (
                <div className="card-inline-controls">
                  {display.works && (
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
              ) : browse.mode === 'TREE' ? (
                <div className="card-inline-controls">
                  <Switch
                    size="xs"
                    label={tr('以卡片顯示節點')}
                    aria-label={tr('以卡片顯示節點')}
                    checked={!!browse.treeCards}
                    disabled={busy || !ready}
                    onChange={(event) =>
                      persist({ ...state.current, treeCards: event.currentTarget.checked })
                    }
                  />
                </div>
              ) : (
                <Stack gap="xs">
                  <TextInput
                    size="xs"
                    placeholder={tr('搜尋欄位')}
                    aria-label={tr('搜尋欄位')}
                    value={columnQuery}
                    onChange={(event) => setColumnQuery(event.currentTarget.value)}
                  />
                  <Stack gap="xs" style={{ maxHeight: 'min(48vh,320px)', overflowY: 'auto' }}>
                    {orderedColumns
                      .filter((column) =>
                        column.label.toLocaleLowerCase().includes(columnQuery.toLocaleLowerCase())
                      )
                      .map((column) => (
                        <Checkbox
                          key={column.id}
                          size="xs"
                          label={column.label}
                          disabled={column.id === 'name' || busy}
                          checked={
                            column.id === 'name' || !browse.hiddenColumns?.includes(column.id)
                          }
                          onChange={(event) =>
                            persist({
                              ...state.current,
                              hiddenColumns: event.currentTarget.checked
                                ? (state.current.hiddenColumns ?? []).filter(
                                    (id) => id !== column.id
                                  )
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
                </Stack>
              )}
            </Popover.Dropdown>
          </Popover>
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
  )
}
