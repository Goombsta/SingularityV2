import { useEffect, useState } from 'react'
import { Outlet } from 'react-router-dom'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { usePlaylistStore } from '../../store/slices/playlistSlice'
import { useUiStore } from '../../store/slices/uiSlice'
import { useEpgStore } from '../../store/slices/epgSlice'
import { exportCategoriesToCsv } from '../../utils/exportCsv'
import Sidebar from './Sidebar'
import './MainLayout.css'

const win = getCurrentWindow()

export default function MainLayout() {
  const loadPlaylists = usePlaylistStore((s) => s.loadPlaylists)
  const playlistsLoaded = usePlaylistStore((s) => s.playlistsLoaded)
  const vods = usePlaylistStore((s) => s.vods)
  const series = usePlaylistStore((s) => s.series)
  const loadFavorites = useUiStore((s) => s.loadFavorites)
  const loadSources = useEpgStore((s) => s.loadSources)
  const [splashFading, setSplashFading] = useState(false)
  const [splashGone, setSplashGone] = useState(false)
  const mountTime = useState(() => Date.now())[0]

  useEffect(() => {
    loadPlaylists()
    loadFavorites()
    loadSources()
  }, [loadPlaylists, loadFavorites, loadSources])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyE') {
        e.preventDefault()
        exportCategoriesToCsv(vods, series)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [vods, series])

  useEffect(() => {
    if (!playlistsLoaded) return
    const MIN_SPLASH_MS = 12000
    const elapsed = Date.now() - mountTime
    const remaining = Math.max(0, MIN_SPLASH_MS - elapsed)
    const fadeTimer = setTimeout(() => {
      setSplashFading(true)
      setTimeout(() => setSplashGone(true), 420)
    }, remaining)
    return () => clearTimeout(fadeTimer)
  }, [playlistsLoaded, mountTime])

  return (
    <div className="app-shell">
      {!splashGone && (
        <div className={`splash-overlay${splashFading ? ' fading' : ''}`}>
          <div className="splash-logo-wrap">
            <span className="splash-eyebrow">Now Entering the</span>
            <div className="splash-logo">SINGULARITY</div>
          </div>
          <div className="splash-spinner" />
        </div>
      )}
      {/* Windows-style title bar */}
      <div className="titlebar drag-region">
        <span className="titlebar-title no-drag">Singularity</span>
        <div className="no-drag titlebar-controls">
          <button className="titlebar-btn minimize" onClick={() => win.minimize()} title="Minimize">
            <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
          </button>
          <button className="titlebar-btn maximize" onClick={() => win.toggleMaximize()} title="Maximize">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor"/></svg>
          </button>
          <button className="titlebar-btn close" onClick={() => win.close()} title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5"/></svg>
          </button>
        </div>
      </div>
      <div className="app-body">
        <Sidebar />
        <div className="content-area">
          <Outlet />
        </div>
      </div>
    </div>
  )
}
