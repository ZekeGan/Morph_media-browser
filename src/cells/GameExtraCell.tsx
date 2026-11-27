import { Button, Tooltip } from '@mantine/core'
import { useEffect, useRef, useState } from 'react'

import type { GameExtra } from '../../shared/explorer'
import { isGameFolder } from '../../shared/media'
import type { FolderRow } from '../../shared/model'

import { Icon } from '../common/icons'
import { useGameAvailability } from '../game/gameAvailability'
import { t as tr } from '../i18n'
import { describeError } from '../notices/errors'

// R-409 (provisional): a game's extra button as a component: open the save folder, start through Steam, or open the
// store page. Whether it can be used is asked only once the card is on screen; until the answer it is faint and
// cannot be pressed, and when it cannot be used it is grey and says why.
export const gameExtraLabels: Record<GameExtra, string> = {
  save: '開啟存檔資料夾',
  steam: '用 Steam 啟動',
  store: '在商店開啟',
}

const icons: Record<GameExtra, 'folder' | 'play' | 'external'> = {
  save: 'folder',
  steam: 'play',
  store: 'external',
}

export function GameExtraCell({
  extra,
  row,
  preview,
}: {
  extra: GameExtra
  row?: FolderRow
  preview: boolean
}) {
  const box = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [error, setError] = useState('')
  const game = !!row && isGameFolder(row)
  useEffect(() => {
    const node = box.current
    if (!node || preview || !game) return
    const observer = new IntersectionObserver((entries) =>
      setVisible(entries.some((entry) => entry.isIntersecting))
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [preview, game])
  const state = useGameAvailability(game && !preview ? row : undefined, visible)
  const answer = state?.[extra]
  const label =
    extra === 'store' && answer?.site ? tr('在 {0} 開啟', answer.site) : tr(gameExtraLabels[extra])
  const reason = !row
    ? undefined
    : !game
      ? tr('不是遊戲資料夾')
      : state === null
        ? tr('無法讀取這個遊戲資料夾')
        : answer && !answer.ok
          ? tr(answer.reason ?? '')
          : undefined
  return (
    <span
      ref={box}
      className={'cell-launch cell-game-extra' + (state === undefined ? ' pending' : '')}
    >
      <Tooltip label={reason ?? label} withArrow disabled={preview}>
        <Button
          size="compact-sm"
          variant="default"
          leftSection={<Icon name={icons[extra]} size={14} />}
          disabled={!row || preview || !answer?.ok}
          aria-label={reason ? label + '（' + reason + '）' : label}
          onClick={async (e) => {
            e.stopPropagation()
            if (!row) return
            try {
              await window.explorer.request({ action: 'runExtra', rowId: row.rowId, extra })
              setError('')
            } catch (failure) {
              setError(describeError(failure).message)
            }
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {label}
        </Button>
      </Tooltip>
      {error && <small role="alert">{error}</small>}
    </span>
  )
}
