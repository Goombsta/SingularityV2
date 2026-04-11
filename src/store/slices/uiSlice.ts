import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import type { FavoriteItem } from '../../types'

interface UiState {
  sidebarCollapsed: boolean
  favorites: FavoriteItem[]
  searchQuery: string
}

interface UiIntents {
  toggleSidebar: () => void
  loadFavorites: () => Promise<void>
  addFavorite: (item: FavoriteItem) => Promise<void>
  removeFavorite: (id: string) => Promise<void>
  isFavorite: (id: string) => boolean
  setSearchQuery: (q: string) => void
}

export const useUiStore = create<UiState & UiIntents>((set, get) => ({
  sidebarCollapsed: false,
  favorites: [],
  searchQuery: '',

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  loadFavorites: async () => {
    const favorites = await invoke<FavoriteItem[]>('get_favorites')
    set({ favorites })
  },

  addFavorite: async (item) => {
    await invoke('add_to_favorites', { item })
    set((s) => ({
      favorites: s.favorites.some((f) => f.id === item.id)
        ? s.favorites
        : [...s.favorites, item],
    }))
  },

  removeFavorite: async (id) => {
    await invoke('remove_from_favorites', { id })
    set((s) => ({ favorites: s.favorites.filter((f) => f.id !== id) }))
  },

  isFavorite: (id) => get().favorites.some((f) => f.id === id),

  setSearchQuery: (q) => set({ searchQuery: q }),
}))
