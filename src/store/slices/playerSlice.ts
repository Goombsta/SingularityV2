import { create } from 'zustand'
import type { MultiviewLayout, PlayerState } from '../../types'

interface MultiviewCell {
  id: number
  url: string
  title: string
  active: boolean
}

interface PlayerStoreState {
  // Single player
  current: PlayerState | null
  isPlaying: boolean
  position: number
  duration: number
  volume: number
  // Multiview
  multiviewActive: boolean
  multiviewLayout: MultiviewLayout
  multiviewCells: MultiviewCell[]
  activeCellId: number
}

interface PlayerStoreIntents {
  play: (state: PlayerState) => void
  stop: () => void
  setPosition: (pos: number) => void
  setDuration: (dur: number) => void
  setVolume: (vol: number) => void
  setPlaying: (playing: boolean) => void
  // Multiview
  enterMultiview: (layout?: MultiviewLayout) => void
  exitMultiview: () => void
  setMultiviewLayout: (layout: MultiviewLayout) => void
  setMultiviewCell: (cellId: number, url: string, title: string) => void
  setActiveCell: (cellId: number) => void
}

const MAX_CELLS: Record<MultiviewLayout, number> = {
  '2v': 2,
  '2h': 2,
  '3': 3,
  '4': 4,
}

export const usePlayerStore = create<PlayerStoreState & PlayerStoreIntents>((set, get) => ({
  current: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  volume: 100,
  multiviewActive: false,
  multiviewLayout: '2v',
  multiviewCells: [],
  activeCellId: 0,

  play: (state) => set({ current: state, isPlaying: true }),
  stop: () => set({ current: null, isPlaying: false, position: 0, duration: 0 }),
  setPosition: (pos) => set({ position: pos }),
  setDuration: (dur) => set({ duration: dur }),
  setVolume: (vol) => set({ volume: vol }),
  setPlaying: (playing) => set({ isPlaying: playing }),

  enterMultiview: (layout = '2v') => {
    const count = MAX_CELLS[layout]
    const cells: MultiviewCell[] = Array.from({ length: count }, (_, i) => ({
      id: i,
      url: '',
      title: '',
      active: i === 0,
    }))
    set({ multiviewActive: true, multiviewLayout: layout, multiviewCells: cells, activeCellId: 0 })
  },

  exitMultiview: () => set({ multiviewActive: false, multiviewCells: [] }),

  setMultiviewLayout: (layout) => {
    const count = MAX_CELLS[layout]
    const existing = get().multiviewCells
    const cells: MultiviewCell[] = Array.from({ length: count }, (_, i) => ({
      id: i,
      url: existing[i]?.url ?? '',
      title: existing[i]?.title ?? '',
      active: i === get().activeCellId,
    }))
    set({ multiviewLayout: layout, multiviewCells: cells })
  },

  setMultiviewCell: (cellId, url, title) => {
    set((s) => ({
      multiviewCells: s.multiviewCells.map((c) =>
        c.id === cellId ? { ...c, url, title } : c
      ),
    }))
  },

  setActiveCell: (cellId) => {
    set((s) => ({
      activeCellId: cellId,
      multiviewCells: s.multiviewCells.map((c) => ({ ...c, active: c.id === cellId })),
    }))
  },
}))
