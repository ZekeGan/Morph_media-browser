// R-555: Steam-style single-line launch arguments (space-separated, double quotes for spaces; Windows backslashes
// stay literal unless escaping a quote). Legacy JSON string arrays are still accepted for pasted configs.
function parseJsonArgs(raw: string): string[] | undefined {
  const doubled = (value: string) =>
    value.replace(/\\\\|\\/g, (match) => (match.length === 2 ? match : '\\\\'))
  const attempts = /[A-Za-z]:\\(?!\\)/.test(raw) ? [doubled(raw), raw] : [raw, doubled(raw)]
  for (const attempt of attempts) {
    try {
      const parsed: unknown = JSON.parse(attempt)
      if (Array.isArray(parsed) && parsed.every((value) => typeof value === 'string')) return parsed
    } catch {
      // try the next form
    }
  }
  return undefined
}

export function parseLaunchArgs(text: string): string[] | undefined {
  const raw = text.trim()
  if (!raw) return []
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const json = parseJsonArgs(raw)
    if (json) return json
  }
  const args: string[] = []
  let current = ''
  let inToken = false
  let inQuote = false
  let i = 0
  while (i < raw.length) {
    const ch = raw[i]
    if (!inQuote && /\s/.test(ch)) {
      if (inToken) {
        args.push(current)
        current = ''
        inToken = false
      }
      i++
      continue
    }
    if (ch === '\\') {
      let count = 0
      while (i + count < raw.length && raw[i + count] === '\\') count++
      if (i + count < raw.length && raw[i + count] === '"') {
        // Windows argv rule: 2n backslashes + " => n literal backslashes + quote toggle; 2n+1 => n + literal ".
        current += '\\'.repeat(Math.floor(count / 2))
        inToken = true
        if (count % 2 === 1) {
          current += '"'
        } else {
          inQuote = !inQuote
        }
        i += count + 1
        continue
      }
      current += '\\'.repeat(count)
      inToken = true
      i += count
      continue
    }
    if (ch === '"') {
      inQuote = !inQuote
      inToken = true
      i++
      continue
    }
    current += ch
    inToken = true
    i++
  }
  if (inQuote) return undefined
  if (inToken) args.push(current)
  return args
}

export function formatLaunchArgs(args: string[]): string {
  return args
    .map((arg) => {
      if (arg === '') return '""'
      if (!/[\s"]/.test(arg) && !(arg.startsWith('[') && arg.endsWith(']'))) return arg
      // Double backslashes immediately preceding a quote or the closing quote so parseLaunchArgs round-trips.
      const escaped = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')
      return `"${escaped}"`
    })
    .join(' ')
}
