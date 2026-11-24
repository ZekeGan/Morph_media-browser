import { useMemo } from 'react'
import { Button, Text } from '@mantine/core'
import type { MediaEntry } from '../../shared/explorer'
import type { FolderRow, Project } from '../../shared/model'
import { usePlayback } from './Playback'
import { Icon } from '../common/icons'
import { podcastFolder } from './podcast'
import { clockText, continueTarget, useVideoPlaces } from './videoPlace'
import { t as tr } from '../i18n'

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// R-390, R-437: a video folder's facts (beside its cover, an image component): how many videos it holds, and 播放, which makes the videos (in name
// order) the play queue and opens the first in the big viewer. When a video here was left partway (R-405, kept on this
// computer), it reads 繼續觀看 and opens that video, which goes on from its place.
export function VideoFacts({
  row,
  project,
  entries,
}: {
  row: FolderRow
  project: Project
  entries: MediaEntry[]
}) {
  const playback = usePlayback(),
    places = useVideoPlaces()
  const videos = useMemo(
    () =>
      entries
        .filter((entry) => entry.kind === 'video')
        .sort((a, b) => names.compare(a.name, b.name)),
    [entries]
  )
  if (!videos.length) return null
  const resume = continueTarget(places, podcastFolder(row), videos)
  return (
    <div className="video-header">
      <div className="album-facts">
        <Text fw={700} size="lg" className="album-title">
          {tr('{0} 部影片', videos.length)}
        </Text>
      </div>
      {playback && (
        <Button
          size="xs"
          leftSection={<Icon name="play" size={14} />}
          title={resume?.video.name}
          onClick={() =>
            playback.replace({ row, project, entries }, videos, resume?.index ?? 0, true)
          }
        >
          {resume
            ? tr('繼續觀看：{0}（{1}）', resume.video.name, clockText(resume.place.time))
            : tr('播放影片')}
        </Button>
      )}
    </div>
  )
}
