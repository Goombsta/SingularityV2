import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import type { EpgProgram, EpgSource } from '../../types'

interface EpgState {
  sources: EpgSource[]
  programs: Record<string, EpgProgram[]> // channelId → programs
  loading: boolean
}

interface EpgIntents {
  loadSources: () => Promise<void>
  addSource: (name: string, url: string) => Promise<void>
  removeSource: (id: string) => Promise<void>
  fetchEpg: (sourceUrl: string) => Promise<void>
  getChannelEpg: (channelId: string) => Promise<EpgProgram[]>
  getNowAndNext: (channelId: string) => { now: EpgProgram | null; next: EpgProgram | null }
}

export const useEpgStore = create<EpgState & EpgIntents>((set, get) => ({
  sources: [],
  programs: {},
  loading: false,

  loadSources: async () => {
    const sources = await invoke<EpgSource[]>('list_epg_sources')
    set({ sources })
  },

  addSource: async (name, url) => {
    const source = await invoke<EpgSource>('add_epg_source', { name, url })
    set((s) => ({ sources: [...s.sources, source] }))
    // Auto-fetch EPG after adding
    await get().fetchEpg(url)
  },

  removeSource: async (id) => {
    await invoke('remove_epg_source', { id })
    set((s) => ({ sources: s.sources.filter((src) => src.id !== id) }))
  },

  fetchEpg: async (sourceUrl) => {
    set({ loading: true })
    try {
      const allPrograms = await invoke<EpgProgram[]>('fetch_epg', { sourceUrl })
      // Group by channel_id
      const grouped: Record<string, EpgProgram[]> = {}
      for (const prog of allPrograms) {
        if (!grouped[prog.channel_id]) grouped[prog.channel_id] = []
        grouped[prog.channel_id].push(prog)
      }
      set((s) => ({ programs: { ...s.programs, ...grouped }, loading: false }))
    } catch {
      set({ loading: false })
    }
  },

  getChannelEpg: async (channelId) => {
    const cached = get().programs[channelId]
    if (cached) return cached
    const progs = await invoke<EpgProgram[]>('get_epg_for_channel', { channelId })
    set((s) => ({ programs: { ...s.programs, [channelId]: progs } }))
    return progs
  },

  getNowAndNext: (channelId) => {
    const progs = get().programs[channelId] ?? []
    const now = new Date().toISOString()
    const current = progs.find((p) => p.start <= now && p.stop > now) ?? null
    const next = current
      ? (progs.find((p) => p.start >= current.stop) ?? null)
      : null
    return { now: current, next }
  },
}))
