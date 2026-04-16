import { invoke } from '@tauri-apps/api/core'
import { create } from 'zustand'
import type { ResumeEntry } from '../../types'

interface ResumeState {
  entries: ResumeEntry[]
  loaded: boolean
}

interface ResumeIntents {
  loadResumeEntries: () => Promise<void>
  clearEntry: (key: string) => Promise<void>
  getProgress: (resumeKey: string) => number | null
}

export const useResumeStore = create<ResumeState & ResumeIntents>((set, get) => ({
  entries: [],
  loaded: false,

  loadResumeEntries: async () => {
    try {
      const entries = await invoke<ResumeEntry[]>('list_resume_entries')
      entries.sort((a, b) => b.updated_at - a.updated_at)
      set({ entries, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },

  clearEntry: async (key) => {
    await invoke('clear_resume_position', { key })
    set((s) => ({ entries: s.entries.filter((e) => e.key !== key) }))
  },

  getProgress: (resumeKey) => {
    const entry = get().entries.find((e) => e.key === resumeKey)
    if (!entry || entry.duration_sec <= 0) return null
    return Math.min(entry.position_sec / entry.duration_sec, 1)
  },
}))
