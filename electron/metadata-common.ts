import { fmt } from '../shared/message'

export async function limitedBytes(response: Response, limit: number) {
  if (!response.ok) throw new Error(fmt('來源無法取得（HTTP {0}）', response.status))
  if (Number(response.headers.get('content-length') ?? 0) > limit) throw new Error('來源回應過大')
  const reader = response.body?.getReader()
  if (!reader) throw new Error('來源沒有內容')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('來源回應過大')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  return Buffer.concat(chunks)
}

// Why a website source failed (R-300). Each kind is one fixed sentence so the window can translate it by lookup.
// R-461: "busy" is a site refusing too many requests (429, or 503 as MusicBrainz answers it), "slow" a reply that did
// not come in time; both used to read as "offline".
export type SourceErrorKind = 'offline' | 'busy' | 'slow' | 'notFound' | 'restricted' | 'format'

export const sourceErrorText: Record<SourceErrorKind, string> = {
  offline: '無法連線到來源網站；網站可能暫時無法使用或已更換網址',
  busy: '來源網站暫時拒絕過多的請求；請稍等一下再試',
  slow: '來源網站回應太慢，已逾時；請稍後再試',
  notFound: '來源找不到這個作品；請確認網址或 ID 是否正確',
  restricted: '來源需要金鑰、登入或成人內容權限才能取得這個作品',
  format: '來源資料格式已變更，無法解析；未執行遠端程式',
}

export class SourceError extends Error {
  constructor(readonly kind: SourceErrorKind) {
    super(sourceErrorText[kind])
  }
}

// R-523: a redirect answered to a request made with redirect: 'manual'; the caller checks the new address before
// following it. Any other request treats a redirect as a failure. Never shown: request() turns it into a SourceError.
export class SourceRedirect extends Error {
  constructor(readonly location: URL) {
    super('redirect')
  }
}

export function sourceStatusKind(status: number): SourceErrorKind {
  if (status === 404 || status === 410) return 'notFound'
  // 400 is how token endpoints (Twitch, DMM) answer wrong credentials.
  if (status === 400 || status === 401 || status === 403) return 'restricted'
  if (status === 429 || status === 503) return 'busy'
  return 'offline'
}

// Whether a request failed because it ran out of time (AbortSignal.timeout), not because it could not connect.
const timedOut = (error: unknown, signal?: AbortSignal | null) =>
  (error instanceof Error && error.name === 'TimeoutError') ||
  (signal?.aborted === true && (signal.reason as Error | undefined)?.name === 'TimeoutError')
// R-461: how long a busy site asks to wait (Retry-After in seconds), kept between 1 and 10 seconds.
export const busyWait = { default: 2000, max: 10000 }

function retryAfter(response: Response) {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(busyWait.max, Math.max(1000, seconds * 1000))
    : busyWait.default
}

// Requests a website source: a failed lookup or refused connection is "offline", running out of time is "slow", and
// an HTTP error is classified by its status before the body is read. A busy site is asked once more after the wait it
// gives (R-461).
export async function sourceRequest(
  fetcher: typeof fetch,
  url: string | URL,
  init: RequestInit,
  limit = 2 * 1024 * 1024
) {
  let response: Response | undefined
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      response = await fetcher(url, init)
    } catch (error) {
      throw new SourceError(timedOut(error, init.signal) ? 'slow' : 'offline')
    }
    if (attempt > 0 || sourceStatusKind(response.status) !== 'busy' || response.ok) break
    const wait = retryAfter(response)
    const signal = init.signal
    await response.body?.cancel().catch(() => {})
    // The wait ends early when the request's own time runs out; the site was busy, so it says that, not "slow".
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, wait)
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
    })
    if (signal?.aborted) throw new SourceError('busy')
  }
  if (init.redirect === 'manual' && [301, 302, 303, 307, 308].includes(response!.status)) {
    const location = response!.headers.get('location')
    await response!.body?.cancel().catch(() => {})
    let next: URL | undefined
    try {
      next = location ? new URL(location, url) : undefined
    } catch {}
    if (!next) throw new SourceError('offline')
    throw new SourceRedirect(next)
  }
  if (!response!.ok) throw new SourceError(sourceStatusKind(response!.status))
  try {
    return await limitedBytes(response!, limit)
  } catch (error) {
    // An oversized reply keeps its own message; a dropped connection mid-body is "offline", a timeout "slow".
    if (error instanceof Error && error.message === '來源回應過大') throw error
    throw new SourceError(timedOut(error, init.signal) ? 'slow' : 'offline')
  }
}

// Parses a source's JSON reply; text that is not JSON means the site changed its format.
export function sourceJson(text: string) {
  try {
    return JSON.parse(text)
  } catch {
    throw new SourceError('format')
  }
}

// A cover is kept only when its bytes are a JPEG, PNG or WebP image, whatever the server says it is.
export function imageType(bytes: Buffer): { ext: string; mime: string } | undefined {
  if (bytes[0] === 255 && bytes[1] === 216) return { ext: 'jpg', mime: 'image/jpeg' }
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { ext: 'png', mime: 'image/png' }
  }
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' }
  }
}

export const decode = (value: unknown) =>
  String(value ?? '').replace(/&(amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, (m, key: string) => {
    const common: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' }
    if (key[0] !== '#') return common[key.toLowerCase()] ?? m
    const n = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1))
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m
  })
