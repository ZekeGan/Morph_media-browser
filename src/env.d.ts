import type { ExplorerApi } from '../shared/explorer'
import type { MediaApi } from '../shared/model'
import type { DesktopApi } from '../shared/workspace'

declare global {
  interface Window {
    media: MediaApi
    desktop: DesktopApi
    explorer: ExplorerApi
  }

  // The application version, taken from package.json when the interface is built.
  const __APP_VERSION__: string
}
