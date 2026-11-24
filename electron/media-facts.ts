import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { openAsBlob } from 'node:fs'
import { parseBlob } from 'music-metadata'
import type { FolderFacts } from '../shared/explorer'
import { safePath } from './files'
import { hiddenFileNames } from './hidden'
import { mediaNames, mediaTypes } from './media-files'

// R-438: what a card can say about an album or video folder without opening it: how many audio and video files,
// the album's name, artist and year (from the tags of the first few tracks) and its total length (filled in
// afterwards in the background). Kept in a local SQLite file that can be deleted and rebuilt; it is never written to
// the folder's own record. An entry stays valid while the folder's modification time and its media files' count and
// total size are the same.
const MAX_FILES = 2000
const TAG_TRACKS = 3
const MAX_TRACKS_FOR_LENGTH = 300
const MAX_FILE = 256 * 1024 * 1024
const text = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 300) : undefined
const agreed = <T>(values: (T | undefined)[]) =>
  values.length && values.every((v) => v !== undefined && v === values[0]) ? values[0] : undefined

interface Stored extends FolderFacts {
  sig: string
}
type Track = { name: string; kind: [string, string] }
// A length stored as -1 is known not to be readable for this signature (not asked again until the folder changes).
const UNKNOWN = -1
const strip = ({ sig: _sig, ...facts }: Stored): FolderFacts => ({
  ...facts,
  duration: facts.duration === UNKNOWN ? undefined : facts.duration,
})

// R-455: the files' total size (part of the signature) is summed again at most this often for a folder whose
// modification time and counts are unchanged; a card asks several times while its length is being read.
const SIZE_FRESH_MS = 60_000
// R-455: lengths waiting to be read; the folders asked about last (the cards on screen) go first, and the oldest
// waiting ones are dropped (asked for again when their card comes back).
const MAX_WAITING = 40
// A pause between length reads; tests set it to make a long album take a while.
export const lengthPause = { ms: 0 }

export class MediaFacts {
  private db: DatabaseSync
  // Tag reads go one at a time, behind each other; lengths have their own queue (R-455) so that a folder's name and
  // artist never wait for another folder's tracks to be read through.
  private tail: Promise<unknown> = Promise.resolve()
  private waiting: { folder: string; audio: Track[]; sig: string }[] = []
  private filling = new Set<string>()
  private running = false
  private sizes = new Map<string, { key: string; size: number; at: number }>()
  // `hiddenNames` reads a folder's hidden files; tests pass their own instead of hiding real files.
  constructor(
    file: string,
    private hiddenNames: (folder: string) => Promise<Set<string>> = hiddenFileNames
  ) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    let db: DatabaseSync | undefined
    try {
      db = new DatabaseSync(file)
      const check = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined
      if (Object.values(check ?? {})[0] !== 'ok') throw new Error('damaged')
    } catch {
      // The index can be rebuilt: a damaged one is set aside and a new one started.
      try {
        db?.close()
      } catch {
        // Not open.
      }
      try {
        // Only the last damaged copy is kept.
        if (fs.existsSync(file)) fs.renameSync(file, file + '.damaged')
        db = new DatabaseSync(file)
      } catch {
        // The file cannot be moved (another program holds it): this run keeps its index in memory.
        db = new DatabaseSync(':memory:')
      }
    }
    this.db = db
    this.db.exec(`CREATE TABLE IF NOT EXISTS facts(
      folder TEXT PRIMARY KEY, sig TEXT NOT NULL, audio INTEGER NOT NULL, video INTEGER NOT NULL,
      album TEXT, artist TEXT, year INTEGER, duration REAL);`)
  }
  private closed = false
  close() {
    if (this.closed) return
    this.closed = true
    this.waiting = []
    this.db.close()
  }
  private get(folder: string): Stored | undefined {
    const row = this.db.prepare('SELECT * FROM facts WHERE folder=?').get(folder) as
      Record<string, unknown> | undefined
    if (!row) return undefined
    return {
      sig: String(row.sig),
      audio: Number(row.audio),
      video: Number(row.video),
      album: (row.album as string | null) ?? undefined,
      artist: (row.artist as string | null) ?? undefined,
      year: (row.year as number | null) ?? undefined,
      duration: (row.duration as number | null) ?? undefined,
    }
  }
  private put(folder: string, value: Stored) {
    this.db
      .prepare('INSERT OR REPLACE INTO facts VALUES(?,?,?,?,?,?,?,?)')
      .run(
        folder,
        value.sig,
        value.audio,
        value.video,
        value.album ?? null,
        value.artist ?? null,
        value.year ?? null,
        value.duration ?? null
      )
  }
  private later<T>(job: () => Promise<T>): Promise<T> {
    const task = this.tail.then(job)
    this.tail = task.catch(() => {})
    return task
  }
  private async header(folder: string, name: string, mime: string, duration: boolean) {
    const file = path.join(folder, name)
    await safePath(folder, file)
    const stat = await fsp.stat(file)
    if (!stat.isFile() || stat.size > MAX_FILE) return undefined
    return parseBlob(await openAsBlob(file, { type: mime }), {
      duration: false,
      skipCovers: true,
      skipPostHeaders: !duration,
    })
  }
  // The facts of one folder: from the index when it is still valid, else read again.
  async read(folder: string): Promise<FolderFacts> {
    // Hidden files are left out, as the folder's own listing does (R-455).
    let hidden = new Set<string>()
    try {
      hidden = await this.hiddenNames(folder)
    } catch {
      // Without the attribute check, hidden files are simply counted.
    }
    const names = (await fsp.readdir(folder, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && !hidden.has(entry.name))
      .flatMap((entry): Track[] => {
        const kind = mediaTypes[path.extname(entry.name).toLowerCase()]
        return kind && (kind[0] === 'audio' || kind[0] === 'video')
          ? [{ name: entry.name, kind: kind as [string, string] }]
          : []
      })
      .slice(0, MAX_FILES)
    const audio = names
        .filter((entry) => entry.kind[0] === 'audio')
        .sort((a, b) => mediaNames.compare(a.name, b.name)),
      video = names.filter((entry) => entry.kind[0] === 'video')
    const mtime = (await fsp.stat(folder)).mtimeMs,
      key = `${mtime}:${audio.length}:${video.length}`,
      recent = this.sizes.get(folder)
    let size = 0
    if (recent?.key === key && Date.now() - recent.at < SIZE_FRESH_MS) size = recent.size
    else {
      for (const entry of names)
        size += (await fsp.stat(path.join(folder, entry.name)).catch(() => ({ size: 0 }))).size
      this.sizes.delete(folder)
      this.sizes.set(folder, { key, size, at: Date.now() })
      if (this.sizes.size > 2000) this.sizes.delete(this.sizes.keys().next().value!)
    }
    const sig = `${key}:${size}`
    const known = this.get(folder)
    if (known?.sig === sig) {
      if (known.duration === undefined && audio.length) this.fill(folder, audio, sig)
      return strip(known)
    }
    const fresh: Stored = { sig, audio: audio.length, video: video.length }
    if (audio.length) {
      const tags = await this.later(async () => {
        const read = []
        for (const entry of audio.slice(0, TAG_TRACKS))
          read.push(
            (await this.header(folder, entry.name, entry.kind[1], false).catch(() => undefined))
              ?.common
          )
        return read
      })
      fresh.album = agreed(tags.map((tag) => text(tag?.album)))
      fresh.artist =
        agreed(tags.map((tag) => text(tag?.albumartist))) ??
        agreed(tags.map((tag) => text(tag?.artist)))
      const year = agreed(tags.map((tag) => tag?.year))
      fresh.year = typeof year === 'number' && year >= 1 && year <= 9999 ? year : undefined
    }
    if (audio.length > MAX_TRACKS_FOR_LENGTH) fresh.duration = UNKNOWN
    this.put(folder, fresh)
    if (audio.length) this.fill(folder, audio, sig)
    return strip(fresh)
  }
  // The total length, one track at a time in the background. Nothing is stored until every track is known, so a
  // partial sum is never shown; a folder with too many tracks stays without one.
  private fill(folder: string, audio: Track[], sig: string) {
    if (this.filling.has(folder) || audio.length > MAX_TRACKS_FOR_LENGTH) return
    // Asked again: it moves to the front of the queue.
    this.waiting = this.waiting.filter((job) => job.folder !== folder)
    this.waiting.push({ folder, audio, sig })
    if (this.waiting.length > MAX_WAITING) this.waiting.shift()
    void this.drain()
  }
  private async drain() {
    if (this.running) return
    this.running = true
    try {
      for (let job; (job = this.waiting.pop());) await this.length(job.folder, job.audio, job.sig)
    } finally {
      this.running = false
    }
  }
  private async length(folder: string, audio: Track[], sig: string) {
    this.filling.add(folder)
    try {
      let total = 0
      let readable = true
      for (const entry of audio) {
        if (this.closed) return
        if (lengthPause.ms) await new Promise((resolve) => setTimeout(resolve, lengthPause.ms))
        const seconds = (await this.header(folder, entry.name, entry.kind[1], true))?.format
          .duration
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) {
          readable = false
          break
        }
        total += seconds
      }
      if (this.closed) return
      // Only for the folder as it was when the job started; a folder that changed meanwhile is read again.
      const stored = this.get(folder)
      if (stored?.sig === sig) this.put(folder, { ...stored, duration: readable ? total : UNKNOWN })
    } catch {
      // A length that cannot be read stays as a dash and is tried again when the folder changes.
    } finally {
      this.filling.delete(folder)
    }
  }
}
