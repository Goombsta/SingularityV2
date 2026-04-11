import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import type { Channel, Playlist, Series, SeriesInfo, VodItem } from '../../types'

interface PlaylistState {
  playlists: Playlist[]
  activePlaylistId: string | null
  channels: Channel[]
  vods: VodItem[]
  series: Series[]
  status: 'idle' | 'loading' | 'error'
  error: string | null
  playlistsLoaded: boolean
  // Track which playlist ID each dataset was loaded for — skip re-fetch if unchanged
  channelsLoadedFor: string | null
  vodsLoadedFor: string | null
  seriesLoadedFor: string | null
}

interface PlaylistIntents {
  loadPlaylists: () => Promise<void>
  addXtream: (name: string, url: string, username: string, password: string) => Promise<void>
  addM3u: (name: string, url: string) => Promise<void>
  addStalker: (name: string, url: string, mac: string) => Promise<void>
  removePlaylist: (id: string) => Promise<void>
  setActivePlaylist: (id: string) => void
  fetchChannels: (playlistId: string) => Promise<void>
  fetchVod: (playlistId: string) => Promise<void>
  fetchSeries: (playlistId: string) => Promise<void>
  fetchSeriesInfo: (playlistId: string, seriesId: number) => Promise<SeriesInfo>
}

export const usePlaylistStore = create<PlaylistState & PlaylistIntents>((set, get) => ({
  playlists: [],
  activePlaylistId: null,
  channels: [],
  vods: [],
  series: [],
  status: 'idle',
  error: null,
  playlistsLoaded: false,
  channelsLoadedFor: null,
  vodsLoadedFor: null,
  seriesLoadedFor: null,

  loadPlaylists: async () => {
    const playlists = await invoke<Playlist[]>('list_playlists')
    set({ playlists, playlistsLoaded: true })
    if (playlists.length > 0 && !get().activePlaylistId) {
      set({ activePlaylistId: playlists[0].id })
    }
  },

  addXtream: async (name, url, username, password) => {
    set({ status: 'loading', error: null })
    try {
      const playlist = await invoke<Playlist>('add_xtream_playlist', {
        name, url, username, password,
      })
      set((s) => ({ playlists: [...s.playlists, playlist], status: 'idle' }))
      if (!get().activePlaylistId) set({ activePlaylistId: playlist.id })
    } catch (e) {
      set({ status: 'error', error: String(e) })
      throw e
    }
  },

  addM3u: async (name, url) => {
    set({ status: 'loading', error: null })
    try {
      const playlist = await invoke<Playlist>('add_m3u_playlist', { name, url })
      set((s) => ({ playlists: [...s.playlists, playlist], status: 'idle' }))
      if (!get().activePlaylistId) set({ activePlaylistId: playlist.id })
    } catch (e) {
      set({ status: 'error', error: String(e) })
      throw e
    }
  },

  addStalker: async (name, url, mac) => {
    set({ status: 'loading', error: null })
    try {
      const playlist = await invoke<Playlist>('add_stalker_playlist', { name, url, mac })
      set((s) => ({ playlists: [...s.playlists, playlist], status: 'idle' }))
      if (!get().activePlaylistId) set({ activePlaylistId: playlist.id })
    } catch (e) {
      set({ status: 'error', error: String(e) })
      throw e
    }
  },

  removePlaylist: async (id) => {
    await invoke('remove_playlist', { id })
    set((s) => ({
      playlists: s.playlists.filter((p) => p.id !== id),
      activePlaylistId: s.activePlaylistId === id ? null : s.activePlaylistId,
      channelsLoadedFor: s.channelsLoadedFor === id ? null : s.channelsLoadedFor,
      vodsLoadedFor: s.vodsLoadedFor === id ? null : s.vodsLoadedFor,
      seriesLoadedFor: s.seriesLoadedFor === id ? null : s.seriesLoadedFor,
    }))
  },

  setActivePlaylist: (id) => set({ activePlaylistId: id }),

  fetchChannels: async (playlistId) => {
    if (get().channelsLoadedFor === playlistId) return
    set({ status: 'loading', error: null })
    try {
      const channels = await invoke<Channel[]>('fetch_live_channels', { playlistId })
      set({ channels, status: 'idle', channelsLoadedFor: playlistId })
    } catch (e) {
      set({ status: 'error', error: String(e) })
    }
  },

  fetchVod: async (playlistId) => {
    if (get().vodsLoadedFor === playlistId) return
    set({ status: 'loading', error: null })
    try {
      const vods = await invoke<VodItem[]>('fetch_vod', { playlistId })
      set({ vods, status: 'idle', vodsLoadedFor: playlistId })
    } catch (e) {
      set({ status: 'error', error: String(e) })
    }
  },

  fetchSeries: async (playlistId) => {
    if (get().seriesLoadedFor === playlistId) return
    set({ status: 'loading', error: null })
    try {
      const series = await invoke<Series[]>('fetch_series', { playlistId })
      set({ series, status: 'idle', seriesLoadedFor: playlistId })
    } catch (e) {
      set({ status: 'error', error: String(e) })
    }
  },

  fetchSeriesInfo: async (playlistId, seriesId) => {
    return invoke<SeriesInfo>('fetch_series_info', { playlistId, seriesId })
  },
}))
