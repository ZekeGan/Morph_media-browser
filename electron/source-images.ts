import type { MetadataPreview } from '../shared/explorer'

import { type PublicSourceId, sourceConfig, userAgent } from './sources/config'
import { imageType, limitedBytes } from './metadata-common'
import { coverResponse } from './metadata-public'

// R-422: the screenshots a source gives are downloaded when the preview is built, so the window can show them and the
// user can pick. Only addresses the preview itself holds are fetched, and only from the source's picture hosts.
// R-511: SteamGridDB's hero, logo and icon are no longer asked for; older records may still hold such pictures.
export type SourceImageRole = 'screenshot' | 'hero' | 'logo' | 'icon'

export interface SourceImage {
  role: SourceImageRole
  // The number among the screenshots (1-based).
  n?: number
  bytes: Buffer
  mime: string
  ext: string
}

export const MAX_SCREENSHOTS = 12
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_TOTAL_BYTES = 30 * 1024 * 1024

export async function downloadSourceImages(
  provider: string | undefined,
  values: MetadataPreview['values'],
  fetcher: typeof fetch,
  steamHosts: string[]
): Promise<SourceImage[]> {
  const config = provider ? sourceConfig[provider as PublicSourceId] : undefined
  const hosts = provider === 'steam' ? steamHosts : (config?.coverHosts ?? [])
  if (!hosts.length || !['vndb', 'steam'].includes(provider ?? '')) return []
  const wanted: { role: SourceImageRole; url: unknown }[] = []
  const shots = values.find((v) => v.key === 'SCREENSHOTS')?.value
  if (Array.isArray(shots)) {
    for (const url of shots.slice(0, MAX_SCREENSHOTS)) wanted.push({ role: 'screenshot', url })
  }
  const images: SourceImage[] = []
  let total = 0
  let shot = 0
  for (const { role, url: raw } of wanted) {
    // Stop asking once another full-size image could not fit, instead of downloading it to throw it away.
    if (total + MAX_IMAGE_BYTES > MAX_TOTAL_BYTES) break
    try {
      const url = new URL(String(raw))
      if (
        url.protocol !== 'https:' ||
        url.port ||
        url.username ||
        url.password ||
        !hosts.includes(url.hostname)
      ) {
        continue
      }
      const bytes = await limitedBytes(
        await coverResponse(fetcher, url, config?.coverRedirectHosts, { 'User-Agent': userAgent }),
        MAX_IMAGE_BYTES
      )
      const type = imageType(bytes)
      if (!type || total + bytes.length > MAX_TOTAL_BYTES) continue
      total += bytes.length
      images.push({ role, ...(role === 'screenshot' ? { n: ++shot } : {}), bytes, ...type })
    } catch {
      // One picture that cannot be had is left out; the rest are still offered.
    }
  }
  return images
}

// The file name an imported picture is saved under, e.g. "vndb-screenshot-2.jpg" or "steamgriddb-hero.png".
export const sourceImageName = (provider: string, image: SourceImage) =>
  `${provider}-${image.role}${image.n ? '-' + image.n : ''}.${image.ext}`
