import { useSyncExternalStore } from 'react'

// R-405, C-139: where each video was left is kept only on this computer (browser storage of the app window), never in
// the portable folder record. Short videos are not remembered; the store is bounded so it cannot grow without limit.
const storageKey = 'morph.videoPlaces'
export const VIDEO_PLACES = 2000,
  // A video shorter than five minutes is not remembered.
  VIDEO_MIN_SECONDS = 300
export interface VideoPlace {
  time: number
  duration: number
  // When it was last watched (ms), to keep the most recent ones and to find "continue".
  at: number
}
export type VideoPlaces = Record<string, VideoPlace>
export type WatchState = 'new' | 'partial' | 'done'

export const remembers = (duration: number) =>
  Number.isFinite(duration) && duration >= VIDEO_MIN_SECONDS
// Finished once under five percent or under two minutes are left; started after five seconds.
export function watchState(place: VideoPlace | undefined): WatchState {
  if (!place) return 'new'
  const left = place.duration - place.time
  if (place.duration > 0 && (left < 120 || left < place.duration * 0.05)) return 'done'
  return place.time >= 5 ? 'partial' : 'new'
}
// Where to start: the saved second while it is in progress, the beginning when new or finished.
export const resumeAt = (place: VideoPlace | undefined) =>
  place && watchState(place) === 'partial' ? place.time : 0
// 0..1 for the thin line on a thumbnail; nothing for a video not started.
export function placeProgress(place: VideoPlace | undefined) {
  const state = watchState(place)
  return !place || state === 'new' ? undefined : state === 'done' ? 1 : place.time / place.duration
}
export const placeKey = (folder: string, fileId: string) => folder + '/' + fileId
// Keeps the most recently watched places.
export function trimPlaces(places: VideoPlaces): VideoPlaces {
  return Object.fromEntries(
    Object.entries(places)
      .sort(([, a], [, b]) => b.at - a.at)
      .slice(0, VIDEO_PLACES)
  )
}
// The store after a place is saved; unchanged when the video is too short or the time makes no sense.
export function withPlace(
  places: VideoPlaces,
  key: string,
  time: number,
  duration: number,
  at: number
): VideoPlaces {
  if (!remembers(duration) || !Number.isFinite(time) || time < 0) return places
  return trimPlaces({ ...places, [key]: { time: Math.min(time, duration), duration, at } })
}
// The video to "continue watching": the most recently watched one still in progress.
export function continueTarget<T extends { id: string }>(
  places: VideoPlaces,
  folder: string,
  videos: T[]
): { video: T; index: number; place: VideoPlace } | undefined {
  let best: { video: T; index: number; place: VideoPlace } | undefined
  videos.forEach((video, index) => {
    const place = places[placeKey(folder, video.id)]
    if (watchState(place) === 'partial' && (!best || place.at > best.place.at))
      best = { video, index, place }
  })
  return best
}
export function clockText(seconds: number) {
  const total = Math.max(0, Math.floor(seconds)),
    s = String(total % 60).padStart(2, '0'),
    m = Math.floor(total / 60) % 60,
    h = Math.floor(total / 3600)
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

let cache: VideoPlaces | undefined
const listeners = new Set<() => void>()
function read(): VideoPlaces {
  if (cache) return cache
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? 'null')
    cache = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    cache = {}
  }
  return cache!
}
export const videoPlace = (folder: string, fileId: string) => read()[placeKey(folder, fileId)]
export function saveVideoPlace(folder: string, fileId: string, time: number, duration: number) {
  const next = withPlace(read(), placeKey(folder, fileId), time, duration, Date.now())
  if (next === read()) return
  cache = next
  try {
    localStorage.setItem(storageKey, JSON.stringify(cache))
  } catch {}
  for (const listener of listeners) listener()
}
// Rerenders when a place changes.
export function useVideoPlaces() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, read)
}
