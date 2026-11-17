import { useEffect, useRef } from 'react'
import { decodeVobsub, type VobsubImage } from '../../shared/vobsub'

// R-421: a picture (VobSub) subtitle over the video. The canvas is the track's own frame (the size its pictures
// are placed in) stretched over the shown video; the cue on screen is decoded when it comes up, and the last few
// decoded cues are kept so stepping back and forth does not decode them again.
const KEPT = 6

export function VideoPictureSubtitle({
  width,
  height,
  palette,
  cue,
  box,
}: {
  width: number
  height: number
  palette: number[]
  cue?: { start: number; data: string }
  box: { left: number; bottom: number; width: number; height: number }
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    decoded = useRef(new Map<string, VobsubImage | null>())
  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    context.clearRect(0, 0, width, height)
    if (!cue) return
    // The whole packet and the colours are the key: two cues may share a time and a length.
    const key = palette.join(',') + '|' + width + 'x' + height + '|' + cue.start + '|' + cue.data
    let image = decoded.current.get(key)
    if (image === undefined) {
      try {
        image = decodeVobsub(
          Uint8Array.from(atob(cue.data), (char) => char.charCodeAt(0)),
          palette
        )
      } catch {
        // Not base64: nothing to draw.
      }
      image ??= null
      decoded.current.set(key, image)
      if (decoded.current.size > KEPT) decoded.current.delete(decoded.current.keys().next().value!)
    }
    if (image) {
      const pixels = context.createImageData(image.width, image.height)
      pixels.data.set(image.rgba)
      context.putImageData(pixels, image.x, image.y)
    }
  }, [cue?.start, cue?.data, width, height])
  return (
    <canvas
      ref={canvas}
      className="subtitle-picture"
      aria-hidden
      data-cue={cue ? cue.start : undefined}
      width={width}
      height={height}
      style={{ left: box.left, bottom: box.bottom, width: box.width, height: box.height }}
    />
  )
}
