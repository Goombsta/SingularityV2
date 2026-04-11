import React, { useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import PlaylistPicker from '../components/common/PlaylistPicker'
import type { Channel } from '../types'
import './MultiviewScreen.css'

type MultiviewLayout = '2H' | '2V' | '3' | '4'

const LAYOUT_CELL_COUNT: Record<MultiviewLayout, number> = {
  '2H': 2, '2V': 2, '3': 3, '4': 4,
}

function makeCells(count: number, startId = 0): CellState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: startId + i, url: '', title: '', reconnecting: false,
  }))
}

interface CellState {
  id: number
  url: string
  title: string
  reconnecting: boolean
}

function Icon2H() {
  return <svg viewBox="0 0 24 12" width="28" height="14" fill="currentColor"><rect x="0" y="0" width="11" height="12" rx="1"/><rect x="13" y="0" width="11" height="12" rx="1"/></svg>
}
function Icon2V() {
  return <svg viewBox="0 0 24 14" width="24" height="14" fill="currentColor"><rect x="0" y="0" width="24" height="6" rx="1"/><rect x="0" y="8" width="24" height="6" rx="1"/></svg>
}
function Icon3() {
  return <svg viewBox="0 0 24 14" width="24" height="14" fill="currentColor"><rect x="0" y="0" width="24" height="7" rx="1"/><rect x="0" y="9" width="11" height="5" rx="1"/><rect x="13" y="9" width="11" height="5" rx="1"/></svg>
}
function Icon4() {
  return <svg viewBox="0 0 24 14" width="24" height="14" fill="currentColor"><rect x="0" y="0" width="11" height="6" rx="1"/><rect x="13" y="0" width="11" height="6" rx="1"/><rect x="0" y="8" width="11" height="6" rx="1"/><rect x="13" y="8" width="11" height="6" rx="1"/></svg>
}

const LAYOUT_ICONS: Record<MultiviewLayout, React.ReactNode> = {
  '2H': <Icon2H />, '2V': <Icon2V />, '3': <Icon3 />, '4': <Icon4 />,
}
const LAYOUT_LABELS: Record<MultiviewLayout, string> = {
  '2H': 'Side by Side', '2V': 'Stacked', '3': '1 Large + 2 Small', '4': '2 × 2 Grid',
}

const HLS_CONFIG = {
  enableWorker: true,
  lowLatencyMode: false,
  backBufferLength: 60,
  maxBufferLength: 60,
  maxMaxBufferLength: 120,
  maxBufferHole: 0.5,
  startLevel: -1,
  abrEwmaDefaultEstimate: 500000,
  fragLoadingTimeOut: 20000,
  manifestLoadingTimeOut: 10000,
  levelLoadingTimeOut: 10000,
}

const MPEGTS_CONFIG = {
  enableWorker: true,
  enableStashBuffer: true,
  stashInitialSize: 1024 * 1024,
  liveBufferLatencyChasing: false,
  liveBufferLatencyMaxLatency: 45,
  liveBufferLatencyMinRemain: 10,
}

export default function MultiviewScreen() {
  const { channels, activePlaylistId, fetchChannels } = usePlaylistStore()

  const [layout, setLayout] = useState<MultiviewLayout>('2H')
  const [cells, setCells] = useState<CellState[]>(makeCells(2))
  const [activeCell, setActiveCell] = useState(0)
  const [activeGroup, setActiveGroup] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [targetCell, setTargetCell] = useState<number | null>(null)
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [urlInput, setUrlInput] = useState('')

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([null, null, null, null])
  const hlsInstances = useRef<(Hls | null)[]>([null, null, null, null])
  const mpegtsInstances = useRef<(any | null)[]>([null, null, null, null])
  const reconnectTimers = useRef<(ReturnType<typeof setTimeout> | null)[]>([null, null, null, null])
  const stallTimers = useRef<(ReturnType<typeof setTimeout> | null)[]>([null, null, null, null])
  // Track which URL is currently loaded in each cell to detect changes
  const loadedUrls = useRef<string[]>(['', '', '', ''])

  useEffect(() => {
    if (activePlaylistId) fetchChannels(activePlaylistId)
  }, [activePlaylistId])

  // ── loadStream: imperatively loads a stream into a video element ──────────
  function loadStream(cellId: number, url: string, video: HTMLVideoElement | null) {
    if (!video || !url) return

    // Destroy previous instances
    hlsInstances.current[cellId]?.destroy()
    hlsInstances.current[cellId] = null
    mpegtsInstances.current[cellId]?.destroy()
    mpegtsInstances.current[cellId] = null
    video.src = ''

    const isHls = /\.m3u8(\?|$)/i.test(url)
    const isTs = /\.ts(\?|$)/i.test(url)

    if (isHls && Hls.isSupported()) {
      const hls = new Hls(HLS_CONFIG)
      hls.loadSource(url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}))
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad()
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError()
          } else {
            // Unrecoverable — schedule reconnect
            triggerReconnect(cellId)
          }
        }
      })
      hlsInstances.current[cellId] = hls
    } else if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url
      video.play().catch(() => {})
    } else if (isTs && mpegts.isSupported()) {
      const player = mpegts.createPlayer(
        { type: 'mpegts', url, isLive: true, hasAudio: true, hasVideo: true },
        MPEGTS_CONFIG
      )
      player.attachMediaElement(video)
      player.load()
      player.play()
      mpegtsInstances.current[cellId] = player
    } else {
      video.src = url
      video.play().catch(() => {})
    }
  }

  // ── Effect: fires after React commits DOM — loads any newly assigned URLs ──
  useEffect(() => {
    cells.forEach((cell) => {
      if (!cell.url || cell.reconnecting) return
      const video = videoRefs.current[cell.id]
      if (!video) return
      if (loadedUrls.current[cell.id] === cell.url) return
      loadedUrls.current[cell.id] = cell.url
      loadStream(cell.id, cell.url, video)
    })
    // Clear videos for empty cells
    cells.forEach((cell) => {
      if (!cell.url) {
        const video = videoRefs.current[cell.id]
        if (video && loadedUrls.current[cell.id]) {
          hlsInstances.current[cell.id]?.destroy(); hlsInstances.current[cell.id] = null
          mpegtsInstances.current[cell.id]?.destroy(); mpegtsInstances.current[cell.id] = null
          video.src = ''
          loadedUrls.current[cell.id] = ''
        }
      }
    })
  }, [cells])

  // ── Reconnect logic ────────────────────────────────────────────────────────
  function triggerReconnect(cellId: number) {
    const url = loadedUrls.current[cellId]
    if (!url) return

    if (reconnectTimers.current[cellId]) {
      clearTimeout(reconnectTimers.current[cellId]!)
    }

    setCells((prev) => prev.map((c) => c.id === cellId ? { ...c, reconnecting: true } : c))

    reconnectTimers.current[cellId] = setTimeout(() => {
      reconnectTimers.current[cellId] = null
      loadedUrls.current[cellId] = ''  // force effect to re-load
      setCells((prev) => prev.map((c) => c.id === cellId ? { ...c, reconnecting: false } : c))
      // loadStream directly since effect checks loadedUrls which we just cleared
      loadStream(cellId, url, videoRefs.current[cellId])
      loadedUrls.current[cellId] = url
    }, 3000)
  }

  const clearStallTimer = (cellId: number) => {
    if (stallTimers.current[cellId]) {
      clearTimeout(stallTimers.current[cellId]!)
      stallTimers.current[cellId] = null
    }
  }

  const handleEnded = (id: number) => triggerReconnect(id)
  const handleStalled = (id: number) => {
    clearStallTimer(id)
    stallTimers.current[id] = setTimeout(() => {
      stallTimers.current[id] = null
      triggerReconnect(id)
    }, 10000)
  }
  const handleWaiting = (id: number) => {
    if (stallTimers.current[id]) return
    stallTimers.current[id] = setTimeout(() => {
      stallTimers.current[id] = null
      triggerReconnect(id)
    }, 10000)
  }
  const handleTimeUpdate = (id: number) => clearStallTimer(id)
  const handlePlaying = (id: number) => {
    clearStallTimer(id)
    setCells((prev) => prev.map((c) => c.id === id ? { ...c, reconnecting: false } : c))
  }

  useEffect(() => () => {
    stallTimers.current.forEach((t) => t && clearTimeout(t))
    reconnectTimers.current.forEach((t) => t && clearTimeout(t))
    hlsInstances.current.forEach((h) => h?.destroy())
    mpegtsInstances.current.forEach((p) => p?.destroy())
  }, [])

  // ── Layout change ──────────────────────────────────────────────────────────
  const changeLayout = (next: MultiviewLayout) => {
    const nextCount = LAYOUT_CELL_COUNT[next]
    setCells((prev) => {
      if (nextCount >= prev.length) return [...prev, ...makeCells(nextCount - prev.length, prev.length)]
      return prev.slice(0, nextCount)
    })
    if (activeCell >= nextCount) setActiveCell(0)
    setLayout(next)
  }

  // ── Channel assignment ─────────────────────────────────────────────────────
  const assignChannel = (ch: Channel) => {
    if (targetCell === null) return
    const cellId = targetCell
    loadedUrls.current[cellId] = ''  // reset so effect re-loads
    setCells((prev) => prev.map((c) =>
      c.id === cellId ? { ...c, url: ch.stream_url, title: ch.name, reconnecting: false } : c
    ))
  }

  const assignUrl = () => {
    const url = urlInput.trim()
    if (!url || targetCell === null) return
    const cellId = targetCell
    loadedUrls.current[cellId] = ''
    setCells((prev) => prev.map((c) =>
      c.id === cellId ? { ...c, url, title: url, reconnecting: false } : c
    ))
    setUrlInput('')
    setShowUrlInput(false)
  }

  const openPanel = (cellId: number) => {
    setTargetCell(cellId)
    setActiveGroup('ALL')
    setSearch('')
    setShowUrlInput(false)
  }

  // ── Derived data ───────────────────────────────────────────────────────────
  const groups = useMemo(
    () => Array.from(new Set(channels.map((c) => c.group_title ?? 'Other'))).sort(),
    [channels]
  )

  const filteredChannels = useMemo(() => {
    return channels.filter((c) => {
      const matchGroup = activeGroup === 'ALL' || c.group_title === activeGroup
      const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase())
      return matchGroup && matchSearch
    })
  }, [channels, activeGroup, search])

  const cellCount = LAYOUT_CELL_COUNT[layout]

  return (
    <div className="mv-screen">

      {/* ── Category pill column ── */}
      <aside className="mv-categories">
        <div className="mv-cat-header">
          <span className="mv-cat-title">Multiview</span>
          <span className="mv-cat-count">{channels.length}</span>
        </div>

        <div className="mv-playlist-picker">
          <PlaylistPicker />
        </div>

        <div className="mv-cat-label">LAYOUT</div>
        <div className="mv-cat-layouts">
          {(['2H', '2V', '3', '4'] as MultiviewLayout[]).map((l) => (
            <button
              key={l}
              className={`mv-cat-layout-btn${l === layout ? ' active' : ''}`}
              onClick={() => changeLayout(l)}
              title={LAYOUT_LABELS[l]}
            >
              {LAYOUT_ICONS[l]}
            </button>
          ))}
        </div>

        <div className="mv-cat-label">PANELS</div>
        {cells.slice(0, cellCount).map((cell) => (
          <button
            key={cell.id}
            className={`mv-cat-item mv-cat-panel${targetCell === cell.id ? ' active' : ''}`}
            onClick={() => openPanel(cell.id)}
          >
            <span className="cat-dot" />
            {cell.title ? (
              <span className="mv-cat-panel-name">{cell.title}</span>
            ) : (
              <span className="mv-cat-panel-empty">Panel {cell.id + 1} — empty</span>
            )}
          </button>
        ))}

        <div className="mv-cat-sep" />

        <div className="mv-cat-label">FILTER</div>
        <button
          className={`mv-cat-item${activeGroup === 'ALL' ? ' active' : ''}`}
          onClick={() => setActiveGroup('ALL')}
        >
          All Channels
        </button>
        {groups.map((g) => (
          <button
            key={g}
            className={`mv-cat-item${activeGroup === g ? ' active' : ''}`}
            onClick={() => setActiveGroup(g)}
          >
            <span className="cat-dot" />
            {g}
          </button>
        ))}
      </aside>

      {/* ── Channel list panel ── */}
      {targetCell !== null && (
        <aside className="mv-channel-panel">
          <div className="mv-ch-panel-header">
            <span>Assign to Panel {targetCell + 1}</span>
            <button className="mv-ch-panel-close" onClick={() => setTargetCell(null)}>✕</button>
          </div>

          <div className="mv-ch-panel-search">
            <input
              className="mv-search-input"
              placeholder="Search channels…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="mv-ch-list">
            {filteredChannels.length === 0 ? (
              <div className="mv-ch-empty">No channels found</div>
            ) : (
              filteredChannels.slice(0, 300).map((ch) => {
                const isAssigned = cells[targetCell]?.url === ch.stream_url
                return (
                  <button
                    key={ch.id}
                    className={`mv-ch-item${isAssigned ? ' assigned' : ''}`}
                    onClick={() => assignChannel(ch)}
                  >
                    {ch.logo && (
                      <img
                        src={ch.logo}
                        alt=""
                        className="mv-ch-logo"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    )}
                    <span className="mv-ch-name">{ch.name}</span>
                    {isAssigned && <span className="mv-ch-check">✓</span>}
                  </button>
                )
              })
            )}
          </div>

          {!showUrlInput ? (
            <button className="mv-url-fallback-btn" onClick={() => setShowUrlInput(true)}>
              Enter URL manually
            </button>
          ) : (
            <div className="mv-url-form">
              <input
                className="mv-url-input"
                placeholder="Paste stream URL…"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && assignUrl()}
                autoFocus
              />
              <div className="mv-url-form-actions">
                <button className="mv-url-back-btn" onClick={() => setShowUrlInput(false)}>← Back</button>
                <button className="mv-url-ok" onClick={assignUrl}>Play</button>
              </div>
            </div>
          )}
        </aside>
      )}

      {/* ── Video grid ── */}
      <div className="mv-main">
        <div className={`mv-grid mv-layout-${layout}`}>
          {cells.slice(0, cellCount).map((cell) => (
            <div
              key={cell.id}
              className={`mv-cell${cell.id === activeCell ? ' active' : ''}${targetCell === cell.id ? ' targeted' : ''}`}
              onClick={() => setActiveCell(cell.id)}
            >
              {cell.url ? (
                <>
                  {/* No src prop — loading is handled imperatively via loadStream/useEffect */}
                  <video
                    ref={(el) => { videoRefs.current[cell.id] = el }}
                    className="mv-video"
                    autoPlay
                    playsInline
                    muted={cell.id !== activeCell}
                    onEnded={() => handleEnded(cell.id)}
                    onStalled={() => handleStalled(cell.id)}
                    onWaiting={() => handleWaiting(cell.id)}
                    onTimeUpdate={() => handleTimeUpdate(cell.id)}
                    onPlaying={() => handlePlaying(cell.id)}
                    onError={() => handleStalled(cell.id)}
                  />
                  {cell.title && <div className="mv-cell-label">{cell.title}</div>}
                  {cell.reconnecting && (
                    <div className="mv-reconnect-badge">
                      <span className="mv-reconnect-spinner" />
                      Reconnecting…
                    </div>
                  )}
                  <button
                    className="mv-cell-edit"
                    onClick={(e) => { e.stopPropagation(); openPanel(cell.id) }}
                    title="Change channel"
                  >✎</button>
                </>
              ) : (
                <div className="mv-empty" onClick={(e) => { e.stopPropagation(); openPanel(cell.id) }}>
                  <span className="mv-empty-icon">+</span>
                  <span>Panel {cell.id + 1}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
