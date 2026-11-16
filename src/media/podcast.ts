import { useSyncExternalStore } from 'react'
import type { FolderRow } from '../../shared/model'

// R-390, C-138: podcasts are music folders shown as episodes. Which folders are podcasts and how far each episode was
// heard are kept only on this computer (browser storage of the app window), never in the portable folder record.
// The store is bounded so it cannot grow without limit.
const storageKey = 'morph.podcasts'
export const PODCAST_FOLDERS = 500,
  PODCAST_EPISODES = 2000
export interface EpisodePlace {
  time: number
  duration: number
  // When it was last heard (ms), to keep the most recent ones and to find "continue".
  at: number
}
export interface PodcastStore {
  folders: string[]
  episodes: Record<string, EpisodePlace>
}
export type ListenState = 'new' | 'partial' | 'done'

// Finished once less than a minute is left; started after five seconds.
export function listenState(place: EpisodePlace | undefined): ListenState {
  if (!place) return 'new'
  if (place.duration > 0 && place.duration - place.time < 60) return 'done'
  return place.time >= 5 ? 'partial' : 'new'
}
// Keeps the newest folders and the most recently heard episodes.
export function trimStore(store: PodcastStore): PodcastStore {
  const episodes = Object.entries(store.episodes)
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, PODCAST_EPISODES)
  return {
    folders: store.folders.slice(-PODCAST_FOLDERS),
    episodes: Object.fromEntries(episodes),
  }
}

const empty = (): PodcastStore => ({ folders: [], episodes: {} })
let cache: PodcastStore | undefined
const listeners = new Set<() => void>()
function read(): PodcastStore {
  if (cache) return cache
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    cache =
      value && Array.isArray(value.folders) && value.episodes && typeof value.episodes === 'object'
        ? {
            folders: value.folders.filter((f: unknown) => typeof f === 'string'),
            episodes: value.episodes,
          }
        : empty()
  } catch {
    cache = empty()
  }
  return cache
}
function write(next: PodcastStore) {
  cache = trimStore(next)
  try {
    localStorage.setItem(storageKey, JSON.stringify(cache))
  } catch {}
  for (const listener of listeners) listener()
}

// A folder's identity on this computer: its record's id when it has one, so a moved folder keeps its state.
export const podcastFolder = (row: Pick<FolderRow, 'rowId' | 'record'>) =>
  row.record?.folderId ?? row.rowId
const episodeKey = (folder: string, fileId: string) => folder + '/' + fileId

export const isPodcast = (folder: string) => read().folders.includes(folder)
export function setPodcast(folder: string, on: boolean) {
  const store = read(),
    folders = store.folders.filter((value) => value !== folder)
  write({ ...store, folders: on ? [...folders, folder] : folders })
}
export const episodePlace = (folder: string, fileId: string) =>
  read().episodes[episodeKey(folder, fileId)]
export function saveEpisodePlace(folder: string, fileId: string, time: number, duration: number) {
  if (!Number.isFinite(time) || time < 0) return
  const store = read()
  write({
    ...store,
    episodes: {
      ...store.episodes,
      [episodeKey(folder, fileId)]: {
        time,
        duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
        at: Date.now(),
      },
    },
  })
}

// Rerenders when the podcast list or a place changes.
export function usePodcasts() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, read)
}
