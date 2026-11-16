import { useMemo } from 'react'
import { Button, Text } from '@mantine/core'
import type { MediaEntry } from '../../shared/explorer'
import type { FolderRow, Project } from '../../shared/model'
import { usePlayback } from './Playback'
import { Icon } from '../common/icons'
import { t as tr } from '../i18n'

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// R-390: a video folder's header: its name and how many videos it holds, and 播放, which makes the videos (in name
// order) the play queue and opens the first in the big viewer. Video places are not kept, so it always starts at
// the first video.
export function VideoHeader({
  row,
  project,
  entries,
}: {
  row: FolderRow
  project: Project
  entries: MediaEntry[]
}) {
  const playback = usePlayback()
  const videos = useMemo(
    () =>
      entries
        .filter((entry) => entry.kind === 'video')
        .sort((a, b) => names.compare(a.name, b.name)),
    [entries]
  )
  if (!videos.length) return null
  return (
    <div className="video-header">
      <div className="album-facts">
        <Text fw={700} size="lg" className="album-title">
          {row.name}
        </Text>
        <Text size="sm" c="dimmed">
          {tr('{0} 部影片', videos.length)}
        </Text>
      </div>
      {playback && (
        <Button
          size="xs"
          leftSection={<Icon name="play" size={14} />}
          onClick={() => playback.replace({ row, project, entries }, videos, 0, true)}
        >
          {tr('播放影片')}
        </Button>
      )}
    </div>
  )
}
