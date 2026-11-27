import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import SevenZip, { type SevenZipModule } from '7z-wasm'

import { identifyImage, imageTypes } from '../shared/images'

import { type ArchiveImage, archiveImage, type ArchiveIndex, archiveIndex, crc32 } from './archive'
import { probeFile } from './media-files'

// R-407: comic archives that are RAR (CBR) or 7z (CB7). They are read by 7-Zip compiled to WebAssembly (7z-wasm), which
// runs in the main process on its own in-memory file system: the archive is copied into that memory, listed, and one
// picture at a time is extracted into memory and handed to the reader. Nothing is written to the media tree or to any
// real disk path, and nothing is executed. Zip files (also CBZ/CBR with a misleading name) keep using archive.ts.
const maxArchive = 512 * 1024 * 1024
const maxEntry = 64 * 1024 * 1024
const maxEntries = 20000
const maxTotal = 2 * 1024 * 1024 * 1024

type Engine = { module: SevenZipModule; log: string[] }

let engine: Promise<Engine> | undefined
const started = () =>
  (engine ??= (async () => {
    const log: string[] = []
    const module = await SevenZip({
      print: (line) => log.push(line),
      printErr: (line) => log.push(line),
    })
    module.FS.mkdir('/arc')
    module.FS.mkdir('/out')
    return { module, log }
  })())

// One 7-Zip command; its console lines come back. A failing command throws or prints an error.
function run(engine: Engine, args: string[]) {
  engine.log.length = 0
  // The runtime sets the process exit code from 7-Zip's exit status; a damaged archive must not change ours.
  const code = process.exitCode
  try {
    engine.module.callMain(args)
  } catch {
    // A non-zero exit is reported as an exception; the console lines say what went wrong.
  } finally {
    process.exitCode = code
  }
  return [...engine.log]
}

const isOk = (lines: string[]) =>
  lines.some((line) => /Everything is Ok/.test(line)) &&
  !lines.some((line) => /^(ERROR|Open ERROR|WARNING)/.test(line))

function removeTree(module: SevenZipModule, dir: string) {
  try {
    for (const name of module.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue
      const child = dir + '/' + name
      if (module.FS.isDir(module.FS.stat(child).mode)) removeTree(module, child)
      else module.FS.unlink(child)
    }
    module.FS.rmdir(dir)
  } catch {}
}

// Same path rules as the ZIP reader: nothing absolute, no drive letters, no parent steps, no control characters.
const safeName = (name: string) =>
  !!name &&
  !name.startsWith('/') &&
  !name.startsWith('\\') &&
  !name.startsWith('-') &&
  !name.startsWith('@') &&
  !name.includes(':') &&
  !/[\x00-\x1f]/.test(name) &&
  !name
    .replace(/\\/g, '/')
    .split('/')
    .some((part) => part === '..' || part === '.')

// Parses `7z l -slt`: an archive header block, a dashed line, then one "Key = Value" block per entry.
export function parseListing(lines: string[]): { type: string; entries: Record<string, string>[] } {
  const dash = lines.findIndex((line) => /^-{5,}$/.test(line))
  if (dash < 0) throw new Error('無法讀取壓縮檔目錄')
  const type = lines
    .slice(0, dash)
    .map((line) => /^Type = (.*)$/.exec(line)?.[1])
    .find(Boolean)
  const entries: Record<string, string>[] = []
  let current: Record<string, string> = {}
  for (const line of lines.slice(dash + 1)) {
    if (!line.trim()) {
      if (current.Path !== undefined) entries.push(current)
      current = {}
      continue
    }
    const match = /^([A-Za-z ]+?) = ?(.*)$/.exec(line)
    if (match) current[match[1]] = match[2]
  }
  if (current.Path !== undefined) entries.push(current)
  return { type: type ?? '', entries }
}

export async function foreignIndex(file: string, format: 'rar' | '7z'): Promise<ArchiveIndex> {
  const stat = await fs.stat(file)
  if (stat.size > maxArchive) throw new Error('RAR／7z 壓縮檔超過大小上限（512 MiB）')
  const engine = await started()
  const id = randomUUID()
  const memory = `/arc/${id}`
  const data = await fs.readFile(file)
  if (data.length !== stat.size) throw new Error('壓縮檔已變更，請重新開啟')
  engine.module.FS.writeFile(memory, data)
  try {
    const lines = run(engine, ['l', '-slt', '-bd', memory])
    const { type, entries } = parseListing(lines)
    if (!(format === 'rar' ? /^Rar5?$/ : /^7z$/).test(type)) throw new Error('壓縮檔格式不符')
    const images: ArchiveImage[] = []
    const names = new Set<string>()
    let total = 0
    if (entries.length > maxEntries) throw new Error('壓縮檔目錄超出限制')
    for (const entry of entries) {
      const name = entry.Path
      if (!safeName(name)) throw new Error('壓縮檔包含不安全路徑')
      if (names.has(name)) throw new Error('壓縮檔包含重複路徑')
      names.add(name)
      const attributes = entry.Attributes ?? ''
      if (entry.Folder === '+' || /^D/.test(attributes) || name.endsWith('/')) continue
      if (/(^|\s)l[rwx-]{9}/.test(attributes)) continue
      const mime = imageTypes[path.extname(name).slice(1).toLowerCase()]
      if (!mime) continue
      if (entry.Encrypted === '+') throw new Error('壓縮檔已加密，無法開啟')
      const size = Number(entry.Size)
      if (!Number.isInteger(size) || size <= 0 || size > maxEntry || (total += size) > maxTotal) {
        throw new Error('壓縮圖片大小超出限制')
      }
      const crc = entry.CRC ? Number.parseInt(entry.CRC, 16) : undefined
      images.push({
        name,
        rawName: Buffer.from(name),
        offset: 0,
        packed: 0,
        size,
        crc: crc !== undefined && Number.isFinite(crc) ? crc : -1,
        method: 0,
        flags: 0,
        mime,
      })
    }
    images.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    return {
      size: stat.size,
      modified: stat.mtimeMs,
      central: 0,
      images,
      format,
      memory,
    }
  } catch (error) {
    try {
      engine.module.FS.unlink(memory)
    } catch {}
    throw error
  }
}

// Frees the in-memory copy of an archive that is no longer listed.
export async function foreignDispose(index: ArchiveIndex) {
  if (!index.memory) return
  const { module } = await started()
  try {
    module.FS.unlink(index.memory)
  } catch {}
}

export async function foreignImage(file: string, index: ArchiveIndex, entry: ArchiveImage) {
  const stat = await fs.stat(file)
  if (!index.memory || stat.size !== index.size || stat.mtimeMs !== index.modified) {
    throw new Error('壓縮檔已變更，請重新開啟')
  }
  const engine = await started()
  const out = `/out/${randomUUID()}`
  engine.module.FS.mkdir(out)
  try {
    // -spd: names are taken literally (no wildcards); -o is the in-memory folder; nothing reaches a real disk.
    const lines = run(engine, ['x', '-y', '-spd', '-bd', `-o${out}`, index.memory, entry.name])
    if (!isOk(lines)) throw new Error('壓縮圖片無法解壓')
    const bytes = Buffer.from(engine.module.FS.readFile(`${out}/${entry.name}`))
    if (
      bytes.length !== entry.size ||
      (entry.crc >= 0 && crc32(bytes) !== entry.crc) ||
      identifyImage(bytes)?.mime !== entry.mime
    ) {
      throw new Error('壓縮圖片內容或校驗不符')
    }
    return bytes
  } finally {
    removeTree(engine.module, out)
  }
}

// The reader's single entry points: the real content decides the format, not the extension.
export async function openArchive(file: string): Promise<ArchiveIndex> {
  const kind = await probeFile(file)
  if (kind === 'zip') return archiveIndex(file)
  if (kind === 'rar' || kind === '7z') return foreignIndex(file, kind)
  throw new Error('不是支援的漫畫壓縮檔（ZIP／CBZ、RAR／CBR、7z／CB7）')
}

export function readArchiveImage(file: string, index: ArchiveIndex, entry: ArchiveImage) {
  return index.memory ? foreignImage(file, index, entry) : archiveImage(file, index, entry)
}
