import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import zlib from 'node:zlib'

import { safePath } from './files'

// R-384: a Ren'Py game shipped without options.rpy still carries config.save_directory in its compiled script
// (game/options.rpyc), either loose or inside an .rpa archive. Everything here only reads: the .rpa index and one small
// script are read with fixed size limits, nothing is unpacked to disk, and anything unexpected gives undefined.
const inflate = promisify(zlib.inflate)
export const RPYC_LIMIT = 1024 * 1024
export const RPA_INDEX_LIMIT = 8 * 1024 * 1024
const INFLATED_LIMIT = 16 * 1024 * 1024
const MAX_ARCHIVES = 20

// A compiled script holds the setting as a source string: `config.save_directory = "Name-123"` (a Python block), or the
// name of a `define` followed by its quoted value a little further on.
export function saveDirectoryIn(text: string): string | undefined {
  const direct = /config\.save_directory\s*=\s*(["'])([^"'\\\r\n\0]{1,200})\1/.exec(text)
  if (direct) return direct[2]
  const at = text.indexOf('config.save_directory')
  if (at < 0) return undefined
  return /(["'])([^"'\\\x00-\x1f]{1,200})\1/.exec(text.slice(at + 21, at + 21 + 300))?.[2]
}

// The pickled script of a .rpyc: "RENPY RPC2" with a slot table (slot 1 is the script), or a bare zlib stream.
export async function rpycText(buffer: Buffer): Promise<string | undefined> {
  try {
    let data = buffer
    if (buffer.subarray(0, 10).toString('latin1') === 'RENPY RPC2') {
      let found: Buffer | undefined
      for (let pos = 10; pos + 12 <= buffer.length && pos < 10 + 12 * 16; pos += 12) {
        const slot = buffer.readUInt32LE(pos)
        const start = buffer.readUInt32LE(pos + 4)
        const length = buffer.readUInt32LE(pos + 8)
        if (slot === 0) break
        if (slot === 1 && start + length <= buffer.length) {
          found = buffer.subarray(start, start + length)
        }
      }
      if (!found) return undefined
      data = found
    }
    return (await inflate(data, { maxOutputLength: INFLATED_LIMIT })).toString('latin1')
  } catch {
    return undefined
  }
}

type Pickled = unknown

// Just enough of the pickle format (protocols 0–3 opcodes Ren'Py writes) to read an archive index of
// { name: [(offset, length, prefix)] }. Anything else, or any malformed input, stops with undefined.
export function readIndex(buffer: Buffer): Map<string, [number, number][]> | undefined {
  const stack: Pickled[] = []
  const marks: number[] = []
  const memo = new Map<number, Pickled>()
  let pos = 0
  const need = (count: number) => {
    if (pos + count > buffer.length) throw new Error('short')
  }
  const take = (count: number) => {
    need(count)
    pos += count
    return buffer.subarray(pos - count, pos)
  }
  const fromMark = () => stack.splice(marks.pop() ?? stack.length)
  const long = (bytes: Buffer) => {
    // Offsets and lengths fit in 8 bytes; a longer number is not an index (and would cost quadratic time to build).
    if (bytes.length > 8) throw new Error('long')
    let value = 0n
    for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i])
    if (bytes.length && bytes[bytes.length - 1] & 0x80) value -= 1n << BigInt(8 * bytes.length)
    return Number(value)
  }
  try {
    for (let steps = 0; steps < 4_000_000; steps++) {
      const op = String.fromCharCode(take(1)[0])
      switch (op) {
        case '\x80':
          take(1)
          break
        case '}':
          stack.push(new Map())
          break
        case ']':
          stack.push([])
          break
        case ')':
          stack.push([])
          break
        case '(':
          marks.push(stack.length)
          break
        case 'q':
          memo.set(take(1)[0], stack[stack.length - 1])
          break
        case 'r':
          memo.set(take(4).readUInt32LE(0), stack[stack.length - 1])
          break
        case 'h':
          stack.push(memo.get(take(1)[0]))
          break
        case 'j':
          stack.push(memo.get(take(4).readUInt32LE(0)))
          break
        case 'X':
          stack.push(take(take(4).readUInt32LE(0)).toString('utf8'))
          break
        case 'U':
          stack.push(take(take(1)[0]).toString('latin1'))
          break
        case 'T':
          stack.push(take(take(4).readUInt32LE(0)).toString('latin1'))
          break
        case 'C':
        case 'B':
          take(op === 'C' ? take(1)[0] : take(4).readUInt32LE(0))
          stack.push('')
          break
        case 'K':
          stack.push(take(1)[0])
          break
        case 'M':
          stack.push(take(2).readUInt16LE(0))
          break
        case 'J':
          stack.push(take(4).readInt32LE(0))
          break
        case '\x8a':
          stack.push(long(take(take(1)[0])))
          break
        case '\x8b':
          stack.push(long(take(take(4).readUInt32LE(0))))
          break
        case 'c': {
          // A global (the empty bytes prefix is written as _codecs.encode): the call that follows yields an empty value.
          for (let lines = 0; lines < 2;) if (take(1)[0] === 10) lines++
          stack.push('')
          break
        }
        case 'R':
          stack.pop()
          stack.pop()
          stack.push('')
          break
        case '\x85':
          stack.push(stack.splice(-1))
          break
        case '\x86':
          stack.push(stack.splice(-2))
          break
        case '\x87':
          stack.push(stack.splice(-3))
          break
        case 't':
        case 'l':
          stack.push(fromMark())
          break
        case 'a': {
          const item = stack.pop()
          ;(stack[stack.length - 1] as Pickled[]).push(item)
          break
        }
        case 'e': {
          const items = fromMark()
          ;(stack[stack.length - 1] as Pickled[]).push(...items)
          break
        }
        case 's': {
          const value = stack.pop()
          const key = stack.pop()
          ;(stack[stack.length - 1] as Map<Pickled, Pickled>).set(key, value)
          break
        }
        case 'u': {
          const items = fromMark()
          const map = stack[stack.length - 1] as Map<Pickled, Pickled>
          for (let i = 0; i + 1 < items.length; i += 2) map.set(items[i], items[i + 1])
          break
        }
        case '0':
          stack.pop()
          break
        case 'N':
          stack.push(null)
          break
        case '.': {
          const top = stack.pop()
          if (!(top instanceof Map)) return undefined
          const result = new Map<string, [number, number][]>()
          for (const [name, entries] of top) {
            if (typeof name !== 'string' || !Array.isArray(entries)) continue
            result.set(
              name,
              entries.flatMap((entry) =>
                Array.isArray(entry) && typeof entry[0] === 'number' && typeof entry[1] === 'number'
                  ? [[entry[0], entry[1]] as [number, number]]
                  : []
              )
            )
          }
          return result
        }
        default:
          return undefined
      }
    }
  } catch {
    return undefined
  }
  return undefined
}

// config.save_directory out of options.rpyc, loose in game/ or inside one of its .rpa archives.
export async function renpySaveDirectory(root: string): Promise<string | undefined> {
  const game = path.join(root, 'game')
  try {
    const loose = path.join(game, 'options.rpyc')
    await safePath(root, loose)
    const stat = await fs.stat(loose).catch(() => undefined)
    if (stat?.isFile() && stat.size <= RPYC_LIMIT) {
      const text = await rpycText(await fs.readFile(loose))
      const name = text && saveDirectoryIn(text)
      if (name) return name
    }
    const archives = (await fs.readdir(game, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /\.rpa$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .slice(0, MAX_ARCHIVES)
    for (const name of archives) {
      const found = await fromArchive(root, path.join(game, name))
      if (found) return found
    }
  } catch {}
  return undefined
}

async function fromArchive(root: string, file: string): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined
  try {
    await safePath(root, file)
    handle = await fs.open(file, 'r')
    const size = (await handle.stat()).size
    const head = Buffer.alloc(64)
    const read = (await handle.read(head, 0, 64, 0)).bytesRead
    const parts = head.subarray(0, read).toString('latin1').split('\n')[0].split(' ')
    // RPA-3.0 <index offset in hex> <key in hex>; RPA-2.0 has the offset only and no key.
    const version = parts[0] === 'RPA-3.0' ? 3 : parts[0] === 'RPA-2.0' ? 2 : 0
    const offset = parseInt(parts[1] ?? '', 16)
    const key = version === 3 ? parseInt(parts[2] ?? '', 16) : 0
    if (!version || !Number.isSafeInteger(offset) || offset <= 0 || offset >= size) return undefined
    if (size - offset > RPA_INDEX_LIMIT || !Number.isSafeInteger(key)) return undefined
    const packed = Buffer.alloc(size - offset)
    if ((await handle.read(packed, 0, packed.length, offset)).bytesRead !== packed.length) {
      return undefined
    }
    const index = readIndex(await inflate(packed, { maxOutputLength: INFLATED_LIMIT }))
    const name = [...(index?.keys() ?? [])].find((n) => /(^|[\\/])options\.rpyc$/i.test(n))
    const entry = name ? index!.get(name)![0] : undefined
    if (!entry) return undefined
    // Offsets and lengths are stored XOR the key (as signed 32-bit numbers, then unsigned) in version 3.
    const start = (entry[0] ^ key) >>> 0
    const length = (entry[1] ^ key) >>> 0
    if (length > RPYC_LIMIT || start + length > size) return undefined
    const script = Buffer.alloc(length)
    if ((await handle.read(script, 0, length, start)).bytesRead !== length) return undefined
    const text = await rpycText(script)
    return text ? saveDirectoryIn(text) : undefined
  } catch {
    return undefined
  } finally {
    await handle?.close().catch(() => {})
  }
}
