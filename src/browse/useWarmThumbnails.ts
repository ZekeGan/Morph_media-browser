import { useEffect } from 'react'

const IDLE_MS = 1500
const INPUT = ['pointerdown', 'wheel', 'keydown'] as const

// R-505: once the listed folders have been on screen for a moment with nothing happening, the main process makes
// their pictures' thumbnails in the background. Any click, wheel or key stops it at once; it starts again after the
// next quiet moment (thumbnails already made are skipped).
export function useWarmThumbnails(rowIds: string[]) {
  const key = rowIds.join('\n')
  useEffect(() => {
    if (!rowIds.length) return
    let timer: number | undefined,
      running = false
    const send = (ids: string[]) =>
      void window.explorer.request({ action: 'warmThumbnails', rowIds: ids }).catch(() => {})
    const schedule = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        // A minimized or hidden window does not warm; it starts again after the next input once shown.
        if (document.visibilityState === 'hidden') return
        running = true
        send(rowIds.slice(0, 60))
      }, IDLE_MS)
    }
    const interrupt = () => {
      if (running) {
        running = false
        send([])
      }
      schedule()
    }
    for (const type of INPUT)
      window.addEventListener(type, interrupt, { capture: true, passive: true })
    schedule()
    return () => {
      window.clearTimeout(timer)
      for (const type of INPUT) window.removeEventListener(type, interrupt, { capture: true })
      if (running) send([])
    }
  }, [key])
}
