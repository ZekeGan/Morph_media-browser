// R-390: a music folder shown as an album. Pure rules only: which subfolders are discs, the order of the tracks,
// what the album header says, and the shuffled order. Tags are read in the main process (audioTags request).

// What is read from one audio file's tags; every field is optional because files often carry none.
export interface AudioTags {
  title?: string
  artist?: string
  albumArtist?: string
  album?: string
  year?: number
  track?: number
  disc?: number
  // Seconds, when the file's header gives it without reading the whole file.
  duration?: number
}

// One track of the album: the folder it is in, the file, and what its tags say (filled in as they are read).
export interface AlbumTrack {
  key: string
  rowId: string
  fileId: string
  name: string
  // The disc its folder is (a "Disc 2" subfolder), when it is in one.
  folderDisc?: number
}
export const trackKey = (rowId: string, fileId: string) => rowId + '/' + fileId

// "Disc 1", "CD2", "disk-03", "Disc 1 - Live": a subfolder that is one disc of the album.
export function discNumber(folderName: string): number | undefined {
  const match = /^\s*(?:disc|disk|cd)\s*[-_.#]?\s*(\d{1,2})(?!\d)/i.exec(folderName)
  if (!match) return undefined
  const value = Number(match[1])
  return value >= 1 ? value : undefined
}

const names = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
// The file name without its extension, for a track that has no title tag.
export const trackTitle = (name: string) => name.replace(/\.[^.]+$/, '')

export interface AlbumDisc {
  disc: number
  tracks: AlbumTrack[]
}
// Tracks grouped by disc (the tag, else the disc folder, else 1). Inside a disc the tag track numbers give the order
// when every track of that disc has one; otherwise the file names do. Until all tags are read (`complete`), only
// folders and names are used, so the list does not jump around while tags arrive.
export function albumDiscs(
  tracks: AlbumTrack[],
  tags: Record<string, AudioTags | undefined>,
  complete: boolean
): AlbumDisc[] {
  const discOf = (track: AlbumTrack) =>
    (complete ? tags[track.key]?.disc : undefined) ?? track.folderDisc ?? 1
  const groups = new Map<number, AlbumTrack[]>()
  for (const track of tracks) {
    const disc = discOf(track)
    groups.set(disc, [...(groups.get(disc) ?? []), track])
  }
  return [...groups]
    .sort(([a], [b]) => a - b)
    .map(([disc, list]) => {
      const numbered = complete && list.every((track) => tags[track.key]?.track !== undefined)
      return {
        disc,
        tracks: [...list].sort(
          (a, b) =>
            (numbered ? tags[a.key]!.track! - tags[b.key]!.track! : 0) ||
            names.compare(a.name, b.name) ||
            (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
        ),
      }
    })
}

// The value more than half of the tracks share (ignoring case and outer spaces), in the spelling seen first.
function agreed<T extends string | number>(values: (T | undefined)[]): T | undefined {
  const counts = new Map<string, { value: T; count: number }>()
  for (const value of values) {
    if (value === undefined || value === '') continue
    const key = String(value).trim().toLocaleLowerCase(),
      seen = counts.get(key)
    if (seen) seen.count++
    else counts.set(key, { value, count: 1 })
  }
  for (const { value, count } of counts.values()) if (count * 2 > values.length) return value
  return undefined
}
export interface AlbumSummary {
  album?: string
  artist?: string
  year?: number
  // No artist most tracks share: the list names the artist of each track instead.
  various: boolean
  count: number
  // The total length in seconds, once the length of every track is known.
  duration?: number
}
export function albumSummary(
  tracks: AlbumTrack[],
  tags: Record<string, AudioTags | undefined>
): AlbumSummary {
  const read = tracks.map((track) => tags[track.key]),
    artist = agreed(read.map((tag) => tag?.albumArtist)) ?? agreed(read.map((tag) => tag?.artist)),
    durations = read.map((tag) => tag?.duration)
  return {
    album: agreed(read.map((tag) => tag?.album)),
    artist,
    year: agreed(read.map((tag) => tag?.year)),
    various: !artist && read.some((tag) => tag?.artist),
    count: tracks.length,
    duration:
      tracks.length && durations.every((value) => value !== undefined)
        ? durations.reduce<number>((sum, value) => sum + value!, 0)
        : undefined,
  }
}

// A shuffled copy (Fisher–Yates); `random` is replaceable so tests can fix the order.
export function shuffled<T>(list: T[], random: () => number = Math.random): T[] {
  const copy = [...list]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// 3:07, 1:02:45.
export function trackClock(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.round(seconds),
    hours = Math.floor(total / 3600),
    minutes = Math.floor((total % 3600) / 60),
    rest = String(total % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`
}

// Whether the queue is exactly this list of tracks, in this order (so a click only moves within it).
export const sameQueue = (queue: string[], wanted: string[]) =>
  queue.length === wanted.length && queue.every((key, index) => key === wanted[index])
