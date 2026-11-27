import fs from 'node:fs/promises'

import type { MediaEntry } from '../shared/explorer'

// Record and attribute ids are short ASCII words; names sort the way people read numbered files.
export const key = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,100}$/.test(v)
export const mediaNames = new Intl.Collator('zh-Hant', { numeric: true })
// R-498: a picture thumbnail's longer side. Part of the thumbnail cache key and of the thumbnail URL's version, so
// changing it makes every thumbnail again instead of reusing the smaller ones (disk and browser cache).
export const THUMB_EDGE = 640

export const thumbVersion = (stat: { size: number; mtimeMs: number }) =>
  `${stat.size}-${stat.mtimeMs}-${THUMB_EDGE}`

// File types the folder listing knows by extension: kind shown in the UI and the MIME type served.
export const mediaTypes: Record<string, [MediaEntry['kind'], string]> = {
  '.mp3': ['audio', 'audio/mpeg'],
  '.m4a': ['audio', 'audio/mp4'],
  '.aac': ['audio', 'audio/aac'],
  '.wav': ['audio', 'audio/wav'],
  '.flac': ['audio', 'audio/flac'],
  '.ogg': ['audio', 'audio/ogg'],
  '.opus': ['audio', 'audio/ogg'],
  '.weba': ['audio', 'audio/webm'],
  '.pdf': ['pdf', 'application/pdf'],
  '.zip': ['archive', 'application/zip'],
  '.cbz': ['archive', 'application/zip'],
  // R-407: RAR and 7z comic archives, read by archive-foreign.ts.
  '.cbr': ['archive', 'application/vnd.comicbook-rar'],
  '.cb7': ['archive', 'application/x-7z-compressed'],
  // R-282: text books for the novel reader.
  '.txt': ['text', 'text/plain; charset=utf-8'],
  '.epub': ['text', 'application/epub+zip'],
  // R-399: Markdown opens in the same reader, shown typeset (no HTML, no pictures) with a switch back to plain text.
  '.md': ['text', 'text/markdown; charset=utf-8'],
  '.png': ['image', 'image/png'],
  '.jpg': ['image', 'image/jpeg'],
  '.jpeg': ['image', 'image/jpeg'],
  '.gif': ['image', 'image/gif'],
  '.webp': ['image', 'image/webp'],
  '.mp4': ['video', 'video/mp4'],
  '.webm': ['video', 'video/webm'],
  '.mkv': ['video', 'video/x-matroska'],
  '.avi': ['video', 'video/x-msvideo'],
  '.mov': ['video', 'video/quicktime'],
  '.srt': ['subtitle', 'text/plain'],
  '.vtt': ['subtitle', 'text/vtt'],
  // R-412
  '.ass': ['subtitle', 'text/plain'],
  '.ssa': ['subtitle', 'text/plain'],
}

// A file's real type from its first bytes; players report only "cannot decode", which hides disguised files.
export async function probeFile(
  file: string
): Promise<'zip' | 'rar' | '7z' | 'gzip' | 'html' | 'empty' | 'media' | 'unknown'> {
  const handle = await fs.open(file, 'r')
  try {
    const buffer = Buffer.alloc(16)
    const { bytesRead } = await handle.read(buffer, 0, 16, 0)
    if (bytesRead === 0) return 'empty'
    const head = buffer.subarray(0, bytesRead)
    if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'zip'
    if (head.subarray(0, 4).toString('latin1') === 'Rar!') return 'rar'
    if (head.subarray(0, 6).equals(Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) return '7z'
    if (head[0] === 0x1f && head[1] === 0x8b) return 'gzip'
    if (/^\s*<(!doctype|html|\?xml)/i.test(head.toString('latin1'))) return 'html'
    if (
      head.subarray(4, 8).toString('latin1') === 'ftyp' ||
      head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ||
      ['RIFF', 'OggS', 'FLV\x01', 'fLaC', 'ID3\x03', 'ID3\x04'].includes(
        head.subarray(0, 4).toString('latin1')
      )
    ) {
      return 'media'
    }
    return 'unknown'
  } finally {
    await handle.close()
  }
}
