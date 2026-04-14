import React, { useEffect, useMemo, useRef, useState } from 'react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { invoke } from '@tauri-apps/api/core'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import PlaylistPicker from '../components/common/PlaylistPicker'
import type { Channel } from '../types'
import './MultiviewScreen.css'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeProxyLoader(proxyPort: number): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Base: any = Hls.DefaultConfig.loader
  return class extends Base {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    load(context: any, config: any, callbacks: any) {
      if (context.url && !/^http:\/\/127\.0\.0\.1/.test(context.url)) {
        context = { ...context, url: `http://127.0.0.1:${proxyPort}/proxy?url=${encodeURIComponent(context.url)}` }
      }
      super.load(context, config, callbacks)
    }
  }
}

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

  // Sidebar collapse / hover-overlay — mirrors LiveTvScreen pattern
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [sidebarOverlay, setSidebarOverlay] = useState(false)
  const overlayHideRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inactivityRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const videoRefs = useRef<(HTMLVideoElement | null)[]>([null, null, null, null])
  const hlsInstances = useRef<(Hls | null)[]>([null, null, null, null])
  const mpegtsInstances = useRef<(any | null)[]>([null, null, null, null])
  const reconnectTimers = useRef<(ReturnType<typeof setTimeout> | null)[]>([null, null, null, null])
  const stallTimers = useRef<(ReturnType<typeof setTimeout> | null)[]>([null, null, null, null])
  const loadedUrls = useRef<string[]>(['', '', '', ''])
  // Track activeCell in a ref so event callbacks always see the current value
  const activeCellRef = useRef(activeCell)
  const proxyPortRef = useRef<number | null>(null)

  // Progress watchdog: if a playing cell makes no timeupdate progress for 20s, reconnect.
  // This catches HLS.js streams that freeze without surfacing HTML5 video events.
  const cellsRef = useRef(cells)
  const lastProgressTime = useRef<number[]>([Date.now(), Date.now(), Date.now(), Date.now()])
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { cellsRef.current = cells }, [cells])
  useEffect(() => { activeCellRef.current = activeCell }, [activeCell])

  // Imperatively sync muted state when active cell changes.
  // React's muted prop is broken (React #6544) — it doesn't reflect to the DOM attribute,
  // so we must set video.muted directly.
  useEffect(() => {
    videoRefs.current.forEach((video, id) => {
      if (video) video.muted = id !== activeCell
    })
  }, [activeCell])

  useEffect(() => {
    invoke<number | null>('get_proxy_port')
      .then(p => { proxyPortRef.current = p ?? null })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (activePlaylistId) fetchChannels(activePlaylistId)
  }, [activePlaylistId])

  // Stable watchdog interval — uses refs so closure staleness is not an issue
  useEffect(() => {
    watchdogRef.current = setInterval(() => {
      cellsRef.current.forEach((cell) => {
        if (!cell.url || cell.reconnecting) return
        const video = videoRefs.current[cell.id]
        if (!video || video.paused || video.ended) return
        if (Date.now() - lastProgressTime.current[cell.id] > 20000) {
          lastProgressTime.current[cell.id] = Date.now() // prevent repeated triggers
          triggerReconnect(cell.id)
        }
      })
    }, 10000)
    return () => { if (watchdogRef.current) clearInterval(watchdogRef.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── loadStream: mirrors Live TV's tryHls → tryMpegts → tryNative chain ─────
  function loadStream(cellId: number, url: string, videoEl: HTMLVideoElement | null) {
    if (!videoEl || !url) return
    const video = videoEl   // narrowed to HTMLVideoElement — safe in closures

    lastProgressTime.current[cellId] = Date.now()

    hlsInstances.current[cellId]?.destroy()
    hlsInstances.current[cellId] = null
    if (mpegtsInstances.current[cellId]) {
      mpegtsInstances.current[cellId].unload?.()
      mpegtsInstances.current[cellId].detachMediaElement?.()
      mpegtsInstances.current[cellId].destroy()
      mpegtsInstances.current[cellId] = null
    }
    video.src = ''

    const isExplicitHls = /\.m3u8(\?|$)/i.test(url)
    const isExplicitTs  = /\.ts(\?|$)/i.test(url)

    // Start muted → play → unmute active cell once 'playing' fires (same as Live TV)
    function mutedPlay() {
      video.muted = true
      Promise.resolve(video.play()).catch(() => {})
      video.addEventListener('playing', () => {
        video.muted = cellId !== activeCellRef.current
      }, { once: true })
    }

    function tryNative() {
      video.src = url
      mutedPlay()
    }

    function tryMpegts() {
      if (!mpegts.isSupported()) { tryNative(); return }
      const player = mpegts.createPlayer(
        { type: 'mpegts', url, isLive: true, hasAudio: true, hasVideo: true },
        MPEGTS_CONFIG
      )
      mpegtsInstances.current[cellId] = player
      player.attachMediaElement(video)
      player.load()
      mutedPlay()
      player.on(mpegts.Events.ERROR, () => {
        player.unload?.(); player.detachMediaElement?.(); player.destroy()
        mpegtsInstances.current[cellId] = null
        tryNative()
      })
    }

    async function tryHls(hlsUrl: string, onFail: () => void, useProxy?: boolean) {
      if (!Hls.isSupported()) { onFail(); return }
      let proxyPort = useProxy ? proxyPortRef.current : null
      if (useProxy && proxyPort == null) {
        try { proxyPort = await invoke<number | null>('get_proxy_port') ?? null
              proxyPortRef.current = proxyPort }
        catch { proxyPort = null }
      }
      const ProxyCls = proxyPort != null ? makeProxyLoader(proxyPort) : null
      const hls = new Hls({
        ...HLS_CONFIG,
        ...(ProxyCls ? { loader: ProxyCls, fLoader: ProxyCls, pLoader: ProxyCls } : {}),
      })
      hlsInstances.current[cellId] = hls
      hls.loadSource(hlsUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => mutedPlay())
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) { hls.destroy(); hlsInstances.current[cellId] = null; onFail() }
      })
    }

    if (isExplicitHls) {
      tryHls(url, () => triggerReconnect(cellId), true)
    } else if (isExplicitTs) {
      tryHls(url.replace(/\.ts(\?|$)/i, '.m3u8$1'), () => tryMpegts())
    } else {
      tryHls(url, () => tryMpegts())
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
      lastProgressTime.current[cellId] = Date.now()
      loadedUrls.current[cellId] = ''  // force effect to re-load
      setCells((prev) => prev.map((c) => c.id === cellId ? { ...c, reconnecting: false } : c))
      // Call loadStream directly since effect checks loadedUrls which we just cleared
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
  const handleTimeUpdate = (id: number) => {
    clearStallTimer(id)
    lastProgressTime.current[id] = Date.now()
  }
  const handlePlaying = (id: number) => {
    clearStallTimer(id)
    lastProgressTime.current[id] = Date.now()
    setCells((prev) => prev.map((c) => c.id === id ? { ...c, reconnecting: false } : c))
  }

  useEffect(() => () => {
    if (overlayHideRef.current) clearTimeout(overlayHideRef.current)
    if (inactivityRef.current) clearTimeout(inactivityRef.current)
    if (watchdogRef.current) clearInterval(watchdogRef.current)
    stallTimers.current.forEach((t) => t && clearTimeout(t))
    reconnectTimers.current.forEach((t) => t && clearTimeout(t))
    hlsInstances.current.forEach((h) => h?.destroy())
    mpegtsInstances.current.forEach((p) => p?.destroy())
  }, [])

  // ── Inactivity collapse: after 5s of no mouse activity on the panels, collapse ──
  const resetInactivityTimer = () => {
    if (inactivityRef.current) clearTimeout(inactivityRef.current)
    inactivityRef.current = setTimeout(() => {
      inactivityRef.current = null
      setSidebarCollapsed(true)
      setSidebarOverlay(false)
    }, 5000)
  }

  // Start/restart the inactivity timer whenever the sidebar becomes visible
  useEffect(() => {
    if (sidebarCollapsed && !sidebarOverlay) {
      if (inactivityRef.current) { clearTimeout(inactivityRef.current); inactivityRef.current = null }
      return
    }
    resetInactivityTimer()
    return () => { if (inactivityRef.current) { clearTimeout(inactivityRef.current); inactivityRef.current = null } }
  }, [sidebarCollapsed, sidebarOverlay]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Sidebar overlay handlers (hover-reveal on desktop) ────────────────────
  const handleTriggerEnter = () => {
    if (overlayHideRef.current) { clearTimeout(overlayHideRef.current); overlayHideRef.current = null }
    setSidebarOverlay(true)
    resetInactivityTimer()
  }
  const handlePanelsMouseEnter = () => {
    if (overlayHideRef.current) { clearTimeout(overlayHideRef.current); overlayHideRef.current = null }
    resetInactivityTimer()
  }
  const handlePanelsMouseLeave = () => {
    overlayHideRef.current = setTimeout(() => setSidebarOverlay(false), 400)
  }

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
    loadedUrls.current[cellId] = ''
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
    <div className={`mv-screen${sidebarCollapsed ? ' mv-sidebar-collapsed' : ''}${sidebarCollapsed && sidebarOverlay ? ' mv-sidebar-overlay' : ''}`}>

      {/* Thin hover-trigger strip on left edge — visible when sidebar is collapsed */}
      {sidebarCollapsed && (
        <div className="mv-panels-trigger" onMouseEnter={handleTriggerEnter} />
      )}

      {/* ── Left panels wrapper (category column + channel panel) ── */}
      <div
        className="mv-left-panels"
        onMouseEnter={handlePanelsMouseEnter}
        onMouseMove={resetInactivityTimer}
        onMouseLeave={handlePanelsMouseLeave}
      >

        {/* ── Category pill column ── */}
        <aside className="mv-categories">
          <div className="mv-cat-header">
            <span className="mv-cat-title">Multiview</span>
            <div className="mv-cat-header-actions">
              <span className="mv-cat-count">{channels.length}</span>
              <button
                className="mv-cat-collapse-btn"
                onClick={() => {
                  setSidebarCollapsed((v) => !v)
                  setSidebarOverlay(false)
                }}
                title={sidebarCollapsed ? 'Pin sidebar' : 'Hide sidebar'}
              >
                {sidebarCollapsed && sidebarOverlay ? '›' : '‹'}
              </button>
            </div>
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
      </div>{/* end mv-left-panels */}

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
                    muted
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
