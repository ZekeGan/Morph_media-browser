import { createContext, useContext } from 'react'

import type { MediaEntry } from '../../shared/explorer'

import type { useAlbum } from '../media/AlbumView'

// R-409: what the right panel's page has read about the folder, for the components that show it (album facts, the
// video count, an EPUB's book card). Cards and the editor have no such page: those components say what they are.
export interface PanelContent {
  entries: MediaEntry[]
  album?: ReturnType<typeof useAlbum>
  // The one EPUB of a folder of text books, shown as a book card.
  epub?: MediaEntry
  // R-438: 繼續閱讀 / 開始閱讀 as the page offers it (what it opens is the page's own), and the place it shows.
  readOn?: { label: string; detail?: string; open: () => void }
  readPlace?: { page: number; total: number }
}

export const PanelContentContext = createContext<PanelContent | undefined>(undefined)
export const usePanelContent = () => useContext(PanelContentContext)
