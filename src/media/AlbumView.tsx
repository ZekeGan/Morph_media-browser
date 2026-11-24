import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Group, Switch, Text } from '@mantine/core'
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
import { usePlayback } from './Playback'
import { listenState, podcastFolder, setPodcast, usePodcasts } from './podcast'
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
  // Podcast episodes: newest first by the file's date (R-390).
  const newest = useMemo(() => [...files].sort((a, b) => b.modified - a.modified), [files])
  return { files, tracks, tags, discs, summary, ordered, newest }
}
// Whether this folder is shown as a podcast on this computer.
export function usePodcast(row: FolderRow) {
  const store = usePodcasts(),
    folder = podcastFolder(row)
  return { folder, podcast: store.folders.includes(folder), places: store.episodes }
}
type Album = ReturnType<typeof useAlbum>

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
  const { folder, podcast, places } = usePodcast(row)
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
  // The episode heard most recently and not finished: 從上次繼續 plays it from where it was left.
  const resume = album.newest
    .map((file) => ({ file, place: places[folder + '/' + file.id] }))
    .filter(({ place }) => listenState(place) === 'partial')
    .sort((a, b) => b.place!.at - a.place!.at)[0]?.file
  return (
    <div className="album-actions">
      <Group gap="xs">
        {podcast ? (
          <>
            <Button
              size="xs"
              leftSection={<Icon name="play" size={14} />}
              disabled={!resume}
              onClick={() => resume && start([resume])}
            >
              {tr('從上次繼續')}
            </Button>
            <Button
              size="xs"
              variant="default"
              leftSection={<Icon name="play" size={14} />}
              onClick={() => start([album.newest[0]])}
            >
              {tr('播放最新一集')}
            </Button>
          </>
        ) : (
          <>
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
          </>
        )}
        <Switch
          size="xs"
          ml="auto"
          label={tr('以 Podcast 顯示')}
          checked={podcast}
          onChange={(event) => setPodcast(folder, event.currentTarget.checked)}
        />
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
  const { folder, podcast, places } = usePodcast(row)
  const several = album.discs.length > 1
  const play = (fileId: string) => {
    const at = album.ordered.findIndex((file) => file.id === fileId)
    playback?.replace({ row, project, entries }, album.ordered, at)
  }
  const isPlaying = (fileId: string) =>
    playback?.playing?.rowId === row.rowId && playback.playing.fileId === fileId
  // A podcast lists its episodes newest first, each with its date, length and how far it was heard; a click plays
  // only that episode, from where it was left.
  if (podcast)
    return (
      <div className="album-tracks podcast-episodes">
        <ol>
          {album.newest.map((file) => {
            const key = trackKey(row.rowId, file.id),
              tag = album.tags[key],
              place = places[folder + '/' + file.id],
              state = listenState(place),
              playing = isPlaying(file.id)
            return (
              <li key={key}>
                <button
                  type="button"
                  className="album-track podcast-episode"
                  aria-current={playing ? 'true' : undefined}
                  data-state={state}
                  title={file.name}
                  onClick={() => playback?.replace({ row, project, entries }, [file], 0)}
                >
                  <span className="album-track-no">
                    {playing ? (
                      <Icon name="volume" size={14} />
                    ) : state === 'done' ? (
                      <Icon name="check" size={14} />
                    ) : null}
                  </span>
                  <span className="album-track-title">
                    {tag?.title ?? trackTitle(file.name)}
                    <small className="muted">
                      {' · '}
                      {new Date(file.modified).toLocaleDateString()}
                      {' · '}
                      {state === 'done'
                        ? tr('已聽完')
                        : state === 'partial'
                          ? tr('聽到一半')
                          : tr('未聽')}
                    </small>
                  </span>
                  <span className="album-track-time">
                    {trackClock(tag?.duration ?? (place?.duration || undefined))}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </div>
    )
  return (
    <div className="album-tracks">
      {album.discs.map((disc) => (
        <section key={disc.disc} aria-label={several ? tr('第 {0} 片', disc.disc) : undefined}>
          {several && <Text className="album-disc">{tr('第 {0} 片', disc.disc)}</Text>}
          <ol>
            {disc.tracks.map((track, index) => {
              const tag = album.tags[track.key],
                title = tag?.title ?? trackTitle(track.name),
                playing = isPlaying(track.fileId)
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
