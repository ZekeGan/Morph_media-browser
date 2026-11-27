import { Badge, Button, Progress, Rating } from '@mantine/core'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { placeCells, rowsFor } from '../../shared/cardGrid'
import {
  cellField,
  cellVisible,
  copyableValue,
  isFilled,
  numericDisplay,
  ruleText,
} from '../../shared/cells'
import { launchChoice } from '../../shared/explorer'
import { httpUrl } from '../../shared/fields'
import { effectiveKind } from '../../shared/kind'
import { rowCells } from '../../shared/layouts'
import { type Cell, fieldValue, type FolderRow, type Project } from '../../shared/model'
import { latestNovel } from '../../shared/novel'

import { useIsWork } from '../browse/folderKind'
import { useFolderStats } from '../browse/folderStats'
import { yesNo } from '../editor/fieldTypes'
import { formatLastPlayed, formatPlayTime, usePlaytime } from '../game/playtime'
import { currentLocale, t as tr, useLocale } from '../i18n'
import { describeError } from '../notices/errors'
import { cellColors } from './cellStyle'
import { folderCoverAsset, folderCoverPicture } from './folderCover'
import { GameExtraCell } from './GameExtraCell'
import { isMediaInfo, MediaButton, MediaInfo } from './MediaInfoCell'
import { usePanelContent } from './panelContext'
import { TagList } from './TagList'

import './cells.css'

type CellProps = {
  cell: Cell
  row?: FolderRow
  open?: () => void
  preview?: boolean
  project?: Project
  // Cards report how many grid rows a growing component's content needs (R-398); the editor preview does not.
  onRows?: (cellId: string, rows: number, now?: boolean) => void
}

// A component that may grow (R-398) shows its content at natural height and tells its card how many rows that takes.
function GrowBody({
  cellId,
  onRows,
  children,
}: {
  cellId: string
  onRows?: CellProps['onRows']
  children: React.ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = box.current
    const cell = node?.parentElement
    if (!node || !cell || !onRows) return
    const measure = (now?: boolean) => {
      const style = getComputedStyle(cell)
      const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'].reduce(
        (sum, key) => sum + (parseFloat(style[key as 'paddingTop']) || 0),
        0
      )
      onRows(cellId, rowsFor(node.offsetHeight + chrome), now)
    }
    measure(true)
    const observer = new ResizeObserver(() => measure())
    observer.observe(node)
    return () => {
      observer.disconnect()
      onRows(cellId, 0)
    }
  }, [cellId, onRows])
  return (
    <div ref={box} className="cell-grow-body">
      {children}
    </div>
  )
}

// Covers come tall and wide; 'blur' shows all of the art and fills the rest with a blurred copy instead of bars or a crop.
function CellPicture({
  src,
  alt,
  fit,
  empty,
}: {
  src: string
  alt: string
  fit: 'contain' | 'cover' | 'blur'
  empty?: string
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (failed) return <span className="cell-image-placeholder">{empty ?? tr('沒有圖片')}</span>
  if (fit !== 'blur') {
    return (
      <img
        className="cell-image"
        style={{ objectFit: fit }}
        src={src}
        alt={alt}
        onError={() => setFailed(true)}
      />
    )
  }
  return (
    <span className="cell-image cell-blur">
      <img className="cell-blur-bg" src={src} alt="" aria-hidden="true" />
      <img className="cell-blur-fg" src={src} alt={alt} onError={() => setFailed(true)} />
    </span>
  )
}

// A component showing a field group tells on hover which member the value came from.
function groupSourceTitle(project: Project, cell: Cell, row: FolderRow) {
  if (!cell.groupId) return undefined
  const shown = cellField(cell, row, project).attributeId
  const group = project.fieldGroups?.find((g) => g.groupId === cell.groupId)
  const alias = project.fieldBindings.find((f) => f.attributeId === shown)?.alias
  if (!group || !alias || !isFilled(fieldValue(row, shown!))) return undefined
  const folderId = row.record?.folderId
  return folderId && project.groupSources?.[folderId]?.[group.groupId] === shown
    ? tr('{0}：來自「{1}」（這個資料夾指定）', group.name, alias)
    : tr('{0}：來自「{1}」', group.name, alias)
}

export function CellContent(props: CellProps) {
  useLocale()
  const { cell, row, preview, project } = props
  const [copied, setCopied] = useState<string>()
  const [copyError, setCopyError] = useState('')
  if (!cellVisible(cell, row, project)) {
    return preview ? <span className="cell-condition-hidden">{tr('條件未符合')}</span> : null
  }
  const shown = cellField(cell, row, project)
  const copy = copyableValue(shown.value)
  return (
    <>
      {cell.scroll ? (
        <div className="cell-scroll-body" tabIndex={0} role="group" aria-label={tr('可捲動內容')}>
          <CellValue {...props} />
        </div>
      ) : cell.growMax ? (
        <GrowBody cellId={cell.cellId} onRows={props.onRows}>
          <CellValue {...props} />
        </GrowBody>
      ) : (
        <CellValue {...props} />
      )}
      {cell.copyValue && (
        <span className="cell-copy">
          <button
            type="button"
            title={tr('複製欄位值')}
            aria-label={tr(
              '複製 {0}',
              project?.fieldBindings.find((field) => field.attributeId === shown.attributeId)
                ?.alias ?? tr('欄位')
            )}
            disabled={preview || copy === undefined}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={async (event) => {
              event.stopPropagation()
              if (copy === undefined || !row || !shown.attributeId) return
              try {
                await window.media.request({
                  action: 'copyFieldValue',
                  rowId: row.rowId,
                  attributeId: shown.attributeId,
                })
                setCopied(copy)
                setCopyError('')
              } catch (reason) {
                setCopied(undefined)
                setCopyError(String(reason))
              }
            }}
          >
            {copy !== undefined && copied === copy ? tr('已複製') : tr('複製')}
          </button>
          {copyError && <small role="alert">{copyError}</small>}
        </span>
      )}
    </>
  )
}

// R-308: play time or the last play date of a game started from M:orph; empty until it has been played.
function PlayInfo({ cell, row }: Pick<CellProps, 'cell' | 'row'>) {
  const play = usePlaytime(row?.record?.folderId)
  if (!play) return <span className="muted">{tr('尚未遊玩')}</span>
  return (
    <span title={tr('{0} 次', play.count)}>
      {cell.systemInfo === 'playTime' ? formatPlayTime(play.total) : formatLastPlayed(play.last)}
    </span>
  )
}

function CellValue({ cell, row, open, preview = false, project }: CellProps) {
  useLocale()
  const stats = useFolderStats(row?.rowId)
  const [linkError, setLinkError] = useState('')
  // R-499: in the right panel a picture is drawn large, so it is the original file; cards keep the thumbnail.
  const inPanel = !!usePanelContent()
  if (cell.kind === 'static-text') {
    return <span style={{ whiteSpace: 'pre-wrap' }}>{ruleText(cell, row, project)}</span>
  }
  if (cell.kind === 'spacer') {
    return preview ? <span className="spacer-preview" aria-label={tr('空白間距')} /> : null
  }
  if (cell.kind === 'system-info' && isMediaInfo(cell.systemInfo)) {
    return <MediaInfo cell={cell} row={row} />
  }
  if (cell.kind === 'video-play' || cell.kind === 'book-continue') {
    return <MediaButton cell={cell} row={row} project={project} />
  }
  if (cell.kind === 'system-info' && cell.systemInfo === 'engine') {
    return (
      <span>
        {row?.boundary?.engines.length ? row.boundary.engines.join('／') : tr('未偵測到')}
      </span>
    )
  }
  if (
    cell.kind === 'system-info' &&
    (cell.systemInfo === 'playTime' || cell.systemInfo === 'lastPlayed')
  ) {
    return <PlayInfo cell={cell} row={row} />
  }
  if (
    cell.kind === 'system-info' &&
    (cell.systemInfo === 'readProgress' || cell.systemInfo === 'lastRead')
  ) {
    // R-282: the text book in this folder read most recently.
    const novel = latestNovel(row?.record?.details?.novels)
    if (!novel) return <span className="muted">{tr('尚未閱讀')}</span>
    return (
      <span>
        {cell.systemInfo === 'readProgress'
          ? Math.round(novel.percent * 100) + '%'
          : new Date(novel.updated).toLocaleDateString(currentLocale())}
      </span>
    )
  }
  if (cell.kind === 'system-info') {
    const kinds: Record<string, string> = {
      book: tr('書籍／漫畫'),
      game: tr('遊戲'),
      music: tr('音樂'),
      video: tr('影片'),
      general: tr('一般'),
    }
    return (
      <span
        title={
          stats
            ? new Date(stats.updated).toLocaleString(currentLocale())
            : tr('開啟資料夾內容後更新')
        }
      >
        {cell.systemInfo === 'files'
          ? stats
            ? tr('{0} 個檔案', stats.files)
            : tr('尚未計算')
          : cell.systemInfo === 'size'
            ? stats
              ? `${(stats.size / 1024 / 1024).toLocaleString(currentLocale(), { maximumFractionDigits: 2 })} MB`
              : tr('尚未計算')
            : row
              ? kinds[effectiveKind(row)]
              : ''}
      </span>
    )
  }

  if (cell.kind === 'open-folder') {
    return (
      <Button
        size="compact-sm"
        variant="light"
        style={{ color: 'inherit' }}
        disabled={!row || preview}
        onClick={(e) => {
          e.stopPropagation()
          open?.()
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {tr('開啟資料夾')}
      </Button>
    )
  }
  if (cell.kind === 'game-launch') {
    // The same launch the game page offers: the project's default launch action and the folder's bound target.
    const template = launchChoice(
      project ?? {},
      cell.actionId,
      cell.fallbackActionIds,
      row?.record?.details?.targets
    )
    const target = template ? row?.record?.details?.targets?.[template.id] : undefined
    const ready = !!template && !!target && target.kind === template.kind
    return (
      <span className="cell-launch">
        <Button
          size="compact-sm"
          color={template?.color}
          disabled={!row || preview || !ready}
          title={
            !template
              ? tr('還沒有可用的動作，請先在版面編輯器的「啟動遊戲」新增')
              : ready
                ? target.path
                : tr('尚未設定')
          }
          onClick={async (e) => {
            e.stopPropagation()
            if (!row || !template) return
            if (
              ['exe', 'file-app', 'shortcut'].includes(template.kind) &&
              !window.confirm(tr('啟動「{0}」？', tr(template.label)))
            ) {
              return
            }
            try {
              await window.explorer.request({
                action: 'runTarget',
                rowId: row.rowId,
                templateId: template.id,
              })
              setLinkError('')
            } catch (reason) {
              setLinkError(describeError(reason).message)
            }
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {template && template.id !== 'default-launch-game' ? template.label : tr('啟動遊戲')}
        </Button>
        {linkError && <small role="alert">{linkError}</small>}
      </span>
    )
  }
  if (cell.kind === 'divider') return <hr className="cell-divider" />
  if (cell.kind === 'game-extra') {
    return <GameExtraCell extra={cell.gameExtra ?? 'save'} row={row} preview={preview} />
  }
  if (cell.kind === 'image') {
    const selected = row?.record?.details?.cellImages?.[cell.attributeId ?? cell.cellId]
    const asset = selected
      ? row?.record?.assets.find((a) => a.assetId === selected)
      : cell.attributeId
        ? undefined
        : folderCoverAsset(row)
    // No picture chosen for this folder: the folder cover (R-409; R-511: also for an older component set to an
    // imported banner, logo or icon) or its n-th image file, when it has one.
    const fallback =
      asset || !row
        ? undefined
        : cell.imageCover || cell.imageRole
          ? folderCoverPicture(row, inPanel)
          : cell.imageIndex
            ? {
                src: `media://nth/${row.rowId}/${cell.imageIndex}${inPanel ? '?full=1' : ''}`,
                alt: tr('資料夾內第 {0} 張圖片', cell.imageIndex),
              }
            : undefined
    return asset ? (
      <CellPicture
        src={`media://asset/${row!.rowId}/${asset.assetId}`}
        alt={asset.originalName}
        fit={cell.imageFit ?? 'contain'}
      />
    ) : fallback ? (
      <CellPicture src={fallback.src} alt={fallback.alt} fit={cell.imageFit ?? 'contain'} />
    ) : preview ? (
      <span>{tr('選用圖片 · 可留空')}</span>
    ) : null
  }
  const value =
    cell.kind === 'name'
      ? row?.name
      : cell.kind === 'path'
        ? row?.path
        : cellField(cell, row, project).value
  // Every field component reads the same when its folder has no value; "Hide when empty" leaves it blank (R-237).
  if (
    cell.kind.startsWith('field-') &&
    !isFilled(value) &&
    (value == null || typeof value === 'string' || Array.isArray(value))
  ) {
    return <span className="cell-empty">{tr('沒有值')}</span>
  }
  const label =
    typeof value === 'string' ? value : value == null ? '' : tr('⚠ 格式不符：{0}', String(value))
  if (cell.kind === 'field-tags') {
    return Array.isArray(value) ? (
      <TagList
        tags={value}
        fit={!cell.scroll && !cell.growMax}
        colors={cell.tagColors}
        prefix={cell.tagPrefix !== false}
      />
    ) : (
      <span>{value == null ? '' : tr('⚠ 格式不符')}</span>
    )
  }
  if (cell.kind === 'field-number') {
    const display = numericDisplay(
      value,
      cell.maximum ?? (cell.presentation === 'rating' ? 5 : 100)
    )
    if (!display) return <span>{value == null ? tr('未填') : tr('⚠ 格式不符')}</span>
    const format = (number: number) =>
      number.toLocaleString(
        currentLocale(),
        cell.decimals === undefined
          ? undefined
          : { minimumFractionDigits: cell.decimals, maximumFractionDigits: cell.decimals }
      )
    const label = `${format(display.value)} / ${format(display.maximum)}`
    if (cell.presentation === 'rating') {
      return (
        <span className="cell-rating" title={label}>
          <Rating
            value={display.percent / 20}
            fractions={2}
            readOnly
            aria-label={label}
            size="xs"
          />
          <span>{label}</span>
        </span>
      )
    }
    if (cell.presentation === 'progress') {
      return (
        <span className="cell-progress">
          <Progress value={display.percent} aria-label={label} />
          <span>{label}</span>
        </span>
      )
    }
    return (
      <span>
        {cell.unit && cell.unitPosition === 'prefix' ? cell.unit : ''}
        {format(display.value)}
        {cell.unit && cell.unitPosition !== 'prefix' ? cell.unit : ''}
      </span>
    )
  }
  if (cell.kind === 'field-date') {
    return (
      <span>
        {typeof value === 'string'
          ? value.replace('T', ' ')
          : value == null
            ? ''
            : tr('⚠ 格式不符')}
      </span>
    )
  }
  if (cell.kind === 'field-boolean') {
    const binding = project?.fieldBindings.find(
      (field) => field.attributeId === cellField(cell, row, project).attributeId
    )
    const label =
      typeof value === 'boolean'
        ? yesNo(value, binding)
        : value == null
          ? tr('未填')
          : tr('⚠ 格式不符')
    return cell.presentation === 'badge' && typeof value === 'boolean' ? (
      <Badge color={value ? 'teal' : 'gray'} variant="light">
        {label}
      </Badge>
    ) : (
      <span>{label}</span>
    )
  }
  if (cell.kind === 'field-date-only' || cell.kind === 'field-enum') {
    const label =
      typeof value === 'string'
        ? cell.kind === 'field-date-only' && /^\d{4}-\d{2}-\d{2}T/.test(value)
          ? value.slice(0, 10)
          : value
        : value == null
          ? tr('未填')
          : tr('⚠ 格式不符')
    return cell.presentation === 'badge' && typeof value === 'string' && value.length ? (
      <Badge
        color={
          project?.fieldBindings.find(
            (field) => field.attributeId === cellField(cell, row, project).attributeId
          )?.optionColors?.[value] ?? 'gray'
        }
        variant="light"
        title={label}
      >
        {label}
      </Badge>
    ) : (
      <span>{label}</span>
    )
  }
  if (cell.kind === 'field-url') {
    return httpUrl(value) ? (
      <span>
        <button
          className="cell-link"
          disabled={preview}
          onKeyDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={async (event) => {
            event.stopPropagation()
            try {
              await window.explorer.request({ action: 'openExternal', url: value })
              setLinkError('')
            } catch (reason) {
              setLinkError(String(reason))
            }
          }}
        >
          {cell.text || value}
        </button>
        {linkError && <small role="alert">{linkError}</small>}
      </span>
    ) : (
      <span>{value == null ? tr('未填') : tr('⚠ 格式不符')}</span>
    )
  }
  return (
    <span
      className={[cell.kind === 'name' ? 'cell-name' : '', cell.wrap ? 'cell-wrap' : '']
        .filter(Boolean)
        .join(' ')}
      title={label}
    >
      {label || (preview ? tr('（此筆沒有值）') : '\u00a0')}
    </span>
  )
}

export function Card({
  project,
  row,
  open,
}: {
  project: Project
  row: FolderRow
  open: () => void
}) {
  useLocale()
  // Rows each growing component needs, measured in the browser and applied in batches: one render for a whole card,
  // and the first measurement before the first paint so a card does not visibly jump.
  const work = useIsWork(row)
  const [needed, setNeeded] = useState<Record<string, number>>({})
  const queue = useRef<Record<string, number>>({})
  const frame = useRef(0)
  const flush = useCallback(() => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    const batch = queue.current
    queue.current = {}
    setNeeded((now) => {
      const next = { ...now }
      let changed = false
      for (const [id, rows] of Object.entries(batch)) {
        if ((now[id] ?? 0) === rows) continue
        changed = true
        if (rows) next[id] = rows
        else delete next[id]
      }
      return changed ? next : now
    })
  }, [])
  const onRows = useCallback(
    (cellId: string, rows: number, now?: boolean) => {
      queue.current[cellId] = rows
      if (now) flush()
      else if (!frame.current) frame.current = requestAnimationFrame(flush)
    },
    [flush]
  )
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const placed = placeCells(
    rowCells(project, row, work),
    (cell) => cellVisible(cell, row, project),
    needed
  )
  return (
    <div className="card-grid">
      {placed.map(({ cell, y, h }) => (
        <div
          key={cell.cellId}
          className="card-cell"
          title={groupSourceTitle(project, cell, row)}
          style={{
            gridColumn: `${cell.grid.x + 1} / span ${cell.grid.w}`,
            gridRow: `${y + 1} / span ${h}`,
            ...cellColors(cell),
          }}
        >
          <CellContent cell={cell} row={row} project={project} open={open} onRows={onRows} />
        </div>
      ))}
    </div>
  )
}
