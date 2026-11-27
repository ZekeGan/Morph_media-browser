export interface Cue {
  start: number
  end: number
  text: string
}

const time = (value: string) => {
  const parts = value.replace(',', '.').split(':').map(Number)
  if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error('字幕時間格式不合法')
  }
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1]
}

// R-412: ASS/SSA dialogue text keeps only the words and the line breaks. Override blocks ({\an8}, {\i1}, {\pos(…)})
// go away, \N and \n become a new line, \h a space, and the vector drawings between {\p1} and {\p0} are dropped.
export function assText(raw: string): string {
  let drawing = false
  let out = ''
  for (const part of raw.split(/(\{[^}]*\})/)) {
    if (part.length > 1 && part.startsWith('{') && part.endsWith('}')) {
      const mode = /\\p(\d+)/.exec(part)
      if (mode) drawing = Number(mode[1]) > 0
    } else if (!drawing) out += part
  }
  return out
    .replace(/\\[Nn]/g, '\n')
    .replace(/\\h/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
}

// An ASS/SSA script: the [Events] section's Dialogue lines, read by its Format line (Start, End, Text).
function parseAss(input: string): Cue[] {
  const cues: Cue[] = []
  let events = false
  let format = [
    'layer',
    'start',
    'end',
    'style',
    'name',
    'marginl',
    'marginr',
    'marginv',
    'effect',
    'text',
  ]
  for (const line of input.replace(/^﻿/, '').replace(/\r/g, '').split('\n')) {
    const text = line.trim()
    if (/^\[.*\]$/.test(text)) {
      events = /^\[events\]$/i.test(text)
      continue
    }
    if (!events) continue
    const key = /^(format|dialogue)\s*:/i.exec(text)
    if (!key) continue
    const rest = text.slice(key[0].length).trim()
    if (key[1].toLowerCase() === 'format') {
      format = rest.split(',').map((name) => name.trim().toLowerCase())
      continue
    }
    // The last field (Text) may hold commas itself.
    const fields: string[] = []
    let remaining = rest
    for (let i = 0; i < format.length - 1; i++) {
      const at = remaining.indexOf(',')
      if (at < 0) break
      fields.push(remaining.slice(0, at))
      remaining = remaining.slice(at + 1)
    }
    fields.push(remaining)
    const startIndex = format.indexOf('start')
    const endIndex = format.indexOf('end')
    const textIndex = format.indexOf('text')
    if (startIndex < 0 || endIndex < 0 || textIndex < 0 || fields.length <= textIndex) continue
    const words = assText(fields[textIndex])
    let start: number
    let end: number
    try {
      start = time(fields[startIndex].trim())
      end = time(fields[endIndex].trim())
    } catch {
      continue
    }
    if (words && end > start) cues.push({ start, end, text: words })
    if (cues.length > 200_000) throw new Error('字幕過大')
  }
  return cues
}

export function parseSubtitles(input: string): Cue[] {
  if (input.length > 5 * 1024 * 1024) throw new Error('字幕過大')
  if (/^\s*\[(?:Script Info|Events|V4\+? Styles)\]/im.test(input)) {
    const cues = parseAss(input)
    if (!cues.length) throw new Error('找不到有效 SRT／VTT／ASS 字幕，原字幕保留')
    return cues.sort((a, b) => a.start - b.start || a.end - b.end)
  }
  const lines = input.replace(/^﻿/, '').replace(/\r/g, '').split('\n')
  const cues: Cue[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = /^\s*([\d:.,]+)\s+-->\s+([\d:.,]+)(?:\s.*)?$/.exec(lines[i])
    if (!match) continue
    const text: string[] = []
    while (i + 1 < lines.length && lines[i + 1].trim()) text.push(lines[++i])
    const start = time(match[1])
    const end = time(match[2])
    if (end <= start) throw new Error('字幕結束時間需晚於開始')
    cues.push({ start, end, text: text.join('\n').replace(/<[^>]*>/g, '') })
  }
  if (!cues.length) throw new Error('找不到有效 SRT／VTT／ASS 字幕，原字幕保留')
  return cues.sort((a, b) => a.start - b.start || a.end - b.end)
}

// R-412: cues as SRT text, so an embedded track goes through the same loading, offset and display as a file. A blank
// line would end a cue early, so empty lines are dropped.
export function cuesToSrt(cues: readonly Cue[]): string {
  const stamp = (seconds: number) => {
    const ms = Math.round(seconds * 1000)
    const part = (value: number, width = 2) => String(value).padStart(width, '0')
    return `${part(Math.floor(ms / 3_600_000))}:${part(Math.floor(ms / 60_000) % 60)}:${part(Math.floor(ms / 1000) % 60)},${part(ms % 1000, 3)}`
  }
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text
          .split('\n')
          .filter((line) => line.trim())
          .join('\n')}\n`
    )
    .join('\n')
}
