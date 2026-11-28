import { Menu } from '@mantine/core'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import { type FolderKind, folderKinds } from '../../shared/kind'
import type { FolderRow } from '../../shared/model'

import { Icon } from '../common/icons'
import { t as tr, useLocale } from '../i18n'

export interface FolderMenuAt {
  rowId: string
  x: number
  y: number
}

// R-535: the short menu a right click (or the context-menu key) on a card, table row or tree node opens: the
// folder's settings, opening it in File Explorer, changing its type and choosing its layout.
export function FolderMenu({
  row,
  x,
  y,
  busy,
  close,
  openConfig,
  openInExplorer,
  setKind,
  chooseLayout,
}: {
  row: FolderRow
  x: number
  y: number
  busy: boolean
  close: () => void
  openConfig: () => void
  openInExplorer: () => void
  setKind: (kind: FolderKind | null) => void
  chooseLayout: () => void
}) {
  useLocale()
  // Focus goes back where it was when the menu closes (Mantine would return it to the invisible anchor).
  const opener = useRef(document.activeElement as HTMLElement | null)
  const onClose = useRef(close)
  onClose.current = close
  useEffect(() => {
    const previous = opener.current
    // Capture phase: React Flow stops pointer/mouse events on its canvas from bubbling, so Mantine's bubble-phase
    // outside-click handler would never hear left clicks on the tree area.
    const away = (event: Event) => {
      if (!(event.target as HTMLElement | null)?.closest?.('.mantine-Menu-dropdown')) {
        onClose.current()
      }
    }
    const blur = () => onClose.current()
    document.addEventListener('pointerdown', away, true)
    window.addEventListener('blur', blur)
    return () => {
      document.removeEventListener('pointerdown', away, true)
      window.removeEventListener('blur', blur)
      if (previous?.isConnected && !document.activeElement?.closest('.mantine-Menu-dropdown')) {
        previous.focus({ preventScroll: true })
      }
    }
  }, [])
  const writable = !!row.record && !row.readonly && !row.stopped && !row.error
  const kind = row.record?.details?.kind ?? 'auto'
  const labels: Record<FolderKind, string> = {
    game: tr('遊戲'),
    book: tr('書籍／漫畫'),
    music: tr('音樂'),
    video: tr('影片'),
    general: tr('一般'),
  }
  const kindItem = (value: FolderKind | 'auto', label: string) => (
    <Menu.Item
      key={value}
      disabled={busy}
      leftSection={
        kind === value ? <Icon name="check" size={14} /> : <span className="folder-menu-blank" />
      }
      onClick={() => kind !== value && setKind(value === 'auto' ? null : value)}
    >
      {label}
    </Menu.Item>
  )
  return createPortal(
    <Menu opened onClose={close} position="bottom-start" offset={2} width={210} shadow="md">
      <Menu.Target>
        <div className="folder-menu-anchor" style={{ left: x, top: y }} />
      </Menu.Target>
      <Menu.Dropdown aria-label={tr('資料夾「{0}」的選單', row.name)}>
        <Menu.Item leftSection={<Icon name="folder-settings" size={14} />} onClick={openConfig}>
          {tr('資料夾設定')}
        </Menu.Item>
        <Menu.Item
          leftSection={<Icon name="folder-go" size={14} />}
          disabled={busy}
          onClick={openInExplorer}
        >
          {tr('在檔案總管開啟')}
        </Menu.Item>
        {writable && (
          <Menu.Sub>
            <Menu.Sub.Target>
              <Menu.Sub.Item leftSection={<Icon name="flag" size={14} />} disabled={busy}>
                {tr('變更類型')}
              </Menu.Sub.Item>
            </Menu.Sub.Target>
            <Menu.Sub.Dropdown>
              {kindItem('auto', tr('自動偵測'))}
              {folderKinds.map((value) => kindItem(value, labels[value]))}
            </Menu.Sub.Dropdown>
          </Menu.Sub>
        )}
        {!!row.record && (
          <Menu.Item
            leftSection={<Icon name="layout" size={14} />}
            disabled={busy}
            onClick={chooseLayout}
          >
            {tr('指定版面…')}
          </Menu.Item>
        )}
      </Menu.Dropdown>
    </Menu>,
    document.body
  )
}
