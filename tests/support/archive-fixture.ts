import { deflateRawSync } from 'node:zlib'

import { crc32 } from '../../electron/archive'

export const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
  'base64'
)

export function zipFixture(
  entries: {
    name: string
    bytes: Buffer
    method?: number
    flags?: number
    size?: number
    crc?: number
  }[]
) {
  const files: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const method = entry.method ?? 8
    const bytes = method === 0 ? entry.bytes : deflateRawSync(entry.bytes)
    const flags = entry.flags ?? 2048
    const crc = entry.crc ?? crc32(entry.bytes)
    const size = entry.size ?? entry.bytes.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(bytes.length, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(flags, 8)
    header.writeUInt16LE(method, 10)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(bytes.length, 20)
    header.writeUInt32LE(size, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)
    files.push(local, name, bytes)
    central.push(header, name)
    offset += local.length + name.length + bytes.length
  }
  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...files, directory, end])
}

// R-407: a RAR 4 archive with stored (uncompressed) files, written by hand: the marker, main header, one file header
// with its data per entry and the end block. Enough for the reader's RAR support without a RAR compressor.
export function rarFixture(entries: { name: string; bytes: Buffer; crc?: number }[]) {
  const withCrc = (body: Buffer) => {
    const crc = Buffer.alloc(2)
    crc.writeUInt16LE(crc32(body) & 0xffff)
    return Buffer.concat([crc, body])
  }
  const main = Buffer.alloc(11)
  main.writeUInt8(0x73, 0)
  main.writeUInt16LE(13, 3)
  const parts: Buffer[] = [Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]), withCrc(main)]
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const body = Buffer.alloc(30 + name.length)
    body.writeUInt8(0x74, 0)
    body.writeUInt16LE(0x8000, 1)
    body.writeUInt16LE(32 + name.length, 3)
    body.writeUInt32LE(entry.bytes.length, 5)
    body.writeUInt32LE(entry.bytes.length, 9)
    body.writeUInt8(2, 13)
    body.writeUInt32LE(entry.crc ?? crc32(entry.bytes), 14)
    body.writeUInt32LE(0x5a21_0000, 18)
    body.writeUInt8(20, 22)
    body.writeUInt8(0x30, 23)
    body.writeUInt16LE(name.length, 24)
    body.writeUInt32LE(0x20, 26)
    name.copy(body, 30)
    parts.push(withCrc(body), entry.bytes)
  }
  parts.push(Buffer.from([0xc4, 0x3d, 0x7b, 0x00, 0x40, 0x07, 0x00]))
  return Buffer.concat(parts)
}

// A 7z archive made by the same 7-Zip build the reader uses, in its own in-memory file system.
export async function sevenZipFixture(entries: { name: string; bytes: Buffer }[]) {
  const { default: SevenZip } = await import('7z-wasm')
  const module = await SevenZip({ print: () => {}, printErr: () => {} })
  module.FS.mkdir('/w')
  module.FS.chdir('/w')
  for (const entry of entries) {
    const parts = entry.name.split('/')
    for (let i = 1; i < parts.length; i++) {
      try {
        module.FS.mkdir(parts.slice(0, i).join('/'))
      } catch {}
    }
    module.FS.writeFile(entry.name, entry.bytes)
  }
  module.callMain(['a', '-bd', 'book.7z', ...entries.map((entry) => entry.name.split('/')[0])])
  return Buffer.from(module.FS.readFile('book.7z'))
}
