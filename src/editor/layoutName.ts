import { t as tr } from '../i18n'

// A layout's name as shown. The names M:orph gives (the default card layout, and since R-409 each kind's "<kind> 預設"
// right-panel layout) are stored in Traditional Chinese and translated where they are shown; names a user typed are
// shown as they are.
const given = new Set([
  '預設版面',
  '書籍 預設',
  '遊戲 預設',
  '音樂 預設',
  '影片 預設',
  '一般 預設',
  '音樂／影片 預設',
])

export const layoutName = (preset: { id: string; name: string }) =>
  given.has(preset.name) && (preset.id === 'default' || preset.id.startsWith('panel-'))
    ? tr(preset.name)
    : preset.name
