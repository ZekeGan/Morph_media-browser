// R-447: whether the reader is moving around with the keyboard (Tab) or with the mouse. Chromium shows a mouse-given
// focus as keyboard focus (:focus-visible) as soon as any key is pressed, e.g. Space to pause a video; places that
// draw a focus ring on a whole surface, or keep controls shown while they hold keyboard focus, ask this instead.
// Tab (and Shift+Tab) means keyboard; pressing the mouse or a touch means pointer. Other keys change nothing.
// The state is also on <html data-input="keyboard|pointer"> for styles.
let modality: 'keyboard' | 'pointer' = 'pointer'
let started = false

const set = (next: typeof modality) => {
  if (next === modality) return
  modality = next
  document.documentElement.dataset.input = next
}

export function watchInputModality() {
  if (started) return
  started = true
  document.documentElement.dataset.input = modality
  window.addEventListener('keydown', (event) => event.key === 'Tab' && set('keyboard'), true)
  window.addEventListener('pointerdown', () => set('pointer'), true)
}

export const keyboardNavigation = () => modality === 'keyboard'
