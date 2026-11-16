import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Group, Text } from '@mantine/core'
import type { MediaEntry } from '../../shared/explorer'
import type { FolderRow, Project } from '../../shared/model'
import {
  albumDiscs,
  albumSummary,
  shuffled,
  trackClock,
  trackKey,
  trackTitle,
  type AlbumTrack,
  type AudioTags,
} from '../../shared/album'
import { FolderAlbumCover } from './FolderAlbumCover'
import { usePlayback } from './Playback'
import { Icon } from '../common/icons'
import { t as tr } from '../i18n'

// R-390: a music folder shown as an album. Tags (title, artist, album, numbers, length) are read in main 24 files at a
// time; the list shows file names at once and fills in as they arrive, keeping its order until all are read.
export function useAlbum(row: FolderRow, entries: MediaEntry[]) {
  const files = useMemo(() => entries.filter((entry) => entry.kind === 'audio'), [entries])
  const tracks = useMemo<AlbumTrack[]>(
    () =>
      files.map((file) => ({
        key: trackKey(row.rowId, file.id),
        rowId: row.rowId,
        fileId: file.id,
        name: file.name,
      })),
    [files, row.rowId]
  )
  const [tags, setTags] = useState<Record<string, AudioTags>>({}),
    [complete, setComplete] = useState(false)
  const ids = files.map((file) => file.id).join('|')
  useEffect(() => {
    let active = true
    setTags({})
    setComplete(false)
    void (async () => {
      for (let at = 0; at < files.length && active; at += 24) {
        const part = files.slice(at, at + 24)
        const response = await window.explorer
          .request({ action: 'audioTags', rowId: row.rowId, fileIds: part.map((f) => f.id) })
          .catch(() => undefined)
        if (!active) return
        const read = response?.audioTags ?? {}
        setTags((previous) => {
          const next = { ...previous }
          for (const file of part) next[trackKey(row.rowId, file.id)] = read[file.id] ?? {}
          return next
        })
      }
      if (active) setComplete(true)
    })()
    return () => {
      active = false
    }
  }, [row.rowId, ids])
  const discs = useMemo(() => albumDiscs(tracks, tags, complete), [tracks, tags, complete])
  const summary = useMemo(() => albumSummary(tracks, tags), [tracks, tags])
  // The album order, as the queue gets it.
  const ordered = useMemo(() => {
    const byKey = new Map(tracks.map((track, index) => [track.key, files[index]]))
    return discs.flatMap((disc) => disc.tracks.map((track) => byKey.get(track.key)!))
  }, [discs, tracks, files])
  return { files, tracks, tags, discs, summary, ordered }
}
type Album = ReturnType<typeof useAlbum>

export function AlbumHeader({
  row,
  entries,
  album,
}: {
  row: FolderRow
  entries: MediaEntry[]
  album: Album
}) {
  const { summary } = album
  const facts = [
    summary.artist,
    summary.year ? String(summary.year) : undefined,
    tr('{0} 首', summary.count),
    summary.duration !== undefined ? trackClock(summary.duration) : undefined,
  ].filter(Boolean)
  return (
    <div className="album-header">
      <FolderAlbumCover row={row} files={entries} />
      <div className="album-facts">
        <Text fw={700} size="lg" className="album-title">
          {summary.album ?? row.name}
        </Text>
        <Text size="sm" c="dimmed">
          {facts.join(' · ')}
        </Text>
      </div>
    </div>
  )
}

// 全部播放 and 隨機播放 replace the play queue with the album; a line offers to put the previous queue back.
export function AlbumActions({
  row,
  project,
  entries,
  album,
}: {
  row: FolderRow
  project: Project
  entries: MediaEntry[]
  album: Album
}) {
  const playback = usePlayback()
  const [undo, setUndo] = useState<{ restore: () => void; count: number }>()
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!playback || !album.ordered.length) return null
  const start = (list: MediaEntry[]) => {
    const count = playback.count,
      restore = playback.replace({ row, project, entries }, list, 0)
    clearTimeout(timer.current)
    if (!restore || !count) return setUndo(undefined)
    setUndo({ restore, count })
    timer.current = setTimeout(() => setUndo(undefined), 8000)
  }
  return (
    <div className="album-actions">
      <Group gap="xs">
        <Button
          size="xs"
          leftSection={<Icon name="play" size={14} />}
          onClick={() => start(album.ordered)}
        >
          {tr('全部播放')}
        </Button>
        <Button
          size="xs"
          variant="default"
          leftSection={<Icon name="shuffle" size={14} />}
          onClick={() => start(shuffled(album.ordered))}
        >
          {tr('隨機播放')}
        </Button>
      </Group>
      {undo && (
        <Text size="xs" c="dimmed" role="status" className="album-undo">
          {tr('已用這張專輯取代播放佇列（原本 {0} 項）', undo.count)}
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => {
              undo.restore()
              clearTimeout(timer.current)
              setUndo(undefined)
            }}
          >
            {tr('復原')}
          </Button>
        </Text>
      )}
    </div>
  )
}

// The tracks by disc. A click plays the album from that track; the track playing now is marked.
export function AlbumTracks({
  row,
  project,
  entries,
  album,
}: {
  row: FolderRow
  project: Project
  entries: MediaEntry[]
  album: Album
}) {
  const playback = usePlayback()
  const several = album.discs.length > 1
  const play = (fileId: string) => {
    const at = album.ordered.findIndex((file) => file.id === fileId)
    playback?.replace({ row, project, entries }, album.ordered, at)
  }
  return (
    <div className="album-tracks">
      {album.discs.map((disc) => (
        <section key={disc.disc} aria-label={several ? tr('第 {0} 片', disc.disc) : undefined}>
          {several && <Text className="album-disc">{tr('第 {0} 片', disc.disc)}</Text>}
          <ol>
            {disc.tracks.map((track, index) => {
              const tag = album.tags[track.key],
                title = tag?.title ?? trackTitle(track.name),
                playing =
                  playback?.playing?.rowId === track.rowId &&
                  playback.playing.fileId === track.fileId
              return (
                <li key={track.key}>
                  <button
                    type="button"
                    className="album-track"
                    aria-current={playing ? 'true' : undefined}
                    title={track.name}
                    onClick={() => play(track.fileId)}
                  >
                    <span className="album-track-no">
                      {playing ? <Icon name="volume" size={14} /> : (tag?.track ?? index + 1)}
                    </span>
                    <span className="album-track-title">
                      {title}
                      {album.summary.various && tag?.artist && (
                        <small className="muted"> · {tag.artist}</small>
                      )}
                    </span>
                    <span className="album-track-time">{trackClock(tag?.duration)}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </section>
      ))}
    </div>
  )
}
