import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'

// Proxy loader for HLS.js — rewrites fragment URLs through the local Rust proxy
// so CDNs never see browser Origin/Referer headers. Only used for explicit .m3u8 URLs.
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
import { useEpgStore } from '../store/slices/epgSlice'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import PlaylistPicker from '../components/common/PlaylistPicker'
import type { Channel } from '../types'
import './LiveTvScreen.css'

export default function LiveTvScreen() {
  const { activePlaylistId, channels, fetchChannels, status, error } = usePlaylistStore()
  const { getNowAndNext } = useEpgStore()

  const [activeGroup, setActiveGroup] = useState<string>('ALL')
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null)
  const [search, setSearch] = useState('')

  // Panel collapse state
  const [panelsCollapsed, setPanelsCollapsed] = useState(false)
  const [panelsOverlay, setPanelsOverlay] = useState(false)
  const overlayHideRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Player state
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const mpegtsRef = useRef<mpegts.Player | null>(null)
  const proxyPortRef = useRef<number | null>(null)
  const [paused, setPaused] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [showVol, setShowVol] = useState(false)
  const [showTechStats, setShowTechStats] = useState(false)
  const [techStats, setTechStats] = useState({
    resolution: '—', codec: '—', fps: '—', bitrate: '—',
    buffer: '—', droppedFrames: '—',
    audioCodec: '—', audioChannels: '—',
  })

  // Poll tech stats when panel is open
  useEffect(() => {
    if (!showTechStats || !videoRef.current) return
    let cancelled = false
    function pollStats() {
      const v = videoRef.current
      if (!v || cancelled) return
      const vq = (v as unknown as { getVideoPlaybackQuality?: () => { droppedVideoFrames: number } }).getVideoPlaybackQuality?.()
      const dropped = vq ? vq.droppedVideoFrames : 0
      const w = v.videoWidth, h = v.videoHeight
      setTechStats(prev => ({
        ...prev,
        resolution: w > 0 ? `${w}×${h}` : '—',
        buffer: v.buffered.length > 0 ? `${(v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(1)}s` : '—',
        droppedFrames: String(dropped),
      }))
    }
    pollStats()
    const id = setInterval(pollStats, 1500)
    return () => { cancelled = true; clearInterval(id) }
  }, [showTechStats, activeChannel])

  // Fetch proxy port once on mount
  useEffect(() => {
    invoke<number | null>('get_proxy_port')
      .then(p => { proxyPortRef.current = p ?? null })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (activePlaylistId) fetchChannels(activePlaylistId)
  }, [activePlaylistId, fetchChannels])

  const groups = useMemo(() => {
    const gs = Array.from(new Set(channels.map((c) => c.group_title ?? 'Other')))
    return gs.sort()
  }, [channels])

  const filtered = useMemo(() => {
    return channels.filter((c) => {
      const matchGroup = activeGroup === 'ALL' || c.group_title === activeGroup
      const matchSearch = c.name.toLowerCase().includes(search.toLowerCase())
      return matchGroup && matchSearch
    })
  }, [channels, activeGroup, search])

  // Pre-compute EPG for visible channels once — avoids calling getNowAndNext
  // inside the render loop for every channel card (expensive with large EPG data)
  const epgMap = useMemo(() => {
    const map = new Map<string, string>()
    filtered.forEach((c) => {
      const { now } = getNowAndNext(c.epg_channel_id ?? c.id)
      if (now) map.set(c.id, now.title)
    })
    return map
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered])

  const playChannel = (ch: Channel) => {
    setActiveChannel(ch)
    setPosition(0)
    setDuration(0)
    setPaused(false)
    // Collapse panels so player expands to full width
    if (!panelsCollapsed) {
      setPanelsCollapsed(true)
      setPanelsOverlay(false)
      // Push a history entry so Android back button can re-expand panels
      history.pushState({ liveTvPanels: 'collapsed' }, '')
    }
  }

  const closeChannel = () => {
    setActiveChannel(null)
    setPanelsCollapsed(false)
    setPanelsOverlay(false)
  }

  // Android hardware back button — fires popstate when it pops the state we pushed
  useEffect(() => {
    const onPopState = () => {
      if (panelsCollapsed) {
        setPanelsCollapsed(false)
        setPanelsOverlay(false)
      }
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [panelsCollapsed])

  // Desktop: hover trigger zone and panels overlay handlers
  const handleTriggerEnter = () => {
    if (overlayHideRef.current) { clearTimeout(overlayHideRef.current); overlayHideRef.current = null }
    setPanelsOverlay(true)
  }
  const handlePanelsEnter = () => {
    if (overlayHideRef.current) { clearTimeout(overlayHideRef.current); overlayHideRef.current = null }
  }
  const handlePanelsLeave = () => {
    overlayHideRef.current = setTimeout(() => setPanelsOverlay(false), 400)
  }

  // ── Live stream player setup ───────────────────────────────────────────────
  useEffect(() => {
    if (!activeChannel || !videoRef.current) return
    const video = videoRef.current
    const url = activeChannel.stream_url

    hlsRef.current?.destroy(); hlsRef.current = null
    if (mpegtsRef.current) {
      mpegtsRef.current.unload()
      mpegtsRef.current.detachMediaElement()
      mpegtsRef.current.destroy()
      mpegtsRef.current = null
    }
    video.src = ''

    const isExplicitHls = /\.m3u8(\?|$)/i.test(url)
    const isExplicitTs  = /\.ts(\?|$)/i.test(url)

    // Start muted to satisfy Android WebView autoplay policy, unmute once playing
    function mutedPlay() {
      video.muted = true
      Promise.resolve(video.play()).catch(() => {})
      video.addEventListener('playing', () => { video.muted = false }, { once: true })
    }

    function tryNative() {
      video.src = url
      mutedPlay()
    }

    function tryMpegts() {
      if (!mpegts.isSupported()) { tryNative(); return }
      const player = mpegts.createPlayer(
        { type: 'mpegts', url, isLive: true, hasAudio: true, hasVideo: true },
        {
          enableWorker: true,
          enableStashBuffer: true,
          stashInitialSize: 1024 * 1024,
          liveBufferLatencyChasing: false,
          liveBufferLatencyMaxLatency: 45,
          liveBufferLatencyMinRemain: 10,
        }
      )
      mpegtsRef.current = player
      player.attachMediaElement(video)
      player.load()
      video.muted = true
      player.play()
      video.addEventListener('playing', () => { video.muted = false }, { once: true })
      player.on(mpegts.Events.ERROR, () => {
        player.unload(); player.detachMediaElement(); player.destroy()
        mpegtsRef.current = null
        tryNative()
      })
    }

    function tryHls(hlsUrl: string, onFail: () => void, useProxy?: boolean) {
      if (!Hls.isSupported()) { onFail(); return }
      const proxyPort = useProxy ? proxyPortRef.current : null
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 60,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        maxBufferHole: 0.5,
        startLevel: -1,
        abrEwmaDefaultEstimate: 500000,
        fragLoadingTimeOut: 10000,
        manifestLoadingTimeOut: 5000,
        levelLoadingTimeOut: 5000,
        ...(proxyPort != null ? { fLoader: makeProxyLoader(proxyPort) } : {}),
      })
      hlsRef.current = hls
      hls.loadSource(hlsUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => mutedPlay())
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          hls.destroy(); hlsRef.current = null
          onFail()
        }
      })
    }

    if (isExplicitHls) {
      // Explicit .m3u8 — HLS.js with proxy to bypass CDN origin checks, fall back to native
      tryHls(url, () => tryNative(), true)
    } else if (isExplicitTs) {
      // Explicit .ts — try HLS first with .m3u8 variant (works on Android WebView + Desktop),
      // fall back to mpegts.js, then native
      const hlsVariant = url.replace(/\.ts(\?|$)/i, '.m3u8$1')
      tryHls(hlsVariant, () => tryMpegts())
    } else {
      // Extensionless Xtream live URL — try HLS.js first, then mpegts, then native
      tryHls(url, () => tryMpegts())
    }

    return () => {
      hlsRef.current?.destroy(); hlsRef.current = null
      if (mpegtsRef.current) {
        mpegtsRef.current.unload()
        mpegtsRef.current.detachMediaElement()
        mpegtsRef.current.destroy()
        mpegtsRef.current = null
      }
    }
  }, [activeChannel])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) { v.play().catch(() => {}); setPaused(false) }
    else { v.pause(); setPaused(true) }
  }

  const seek = (delta: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, v.currentTime + delta)
  }

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return '0:00'
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  const epgNow = activeChannel
    ? getNowAndNext(activeChannel.epg_channel_id ?? activeChannel.id).now
    : null

  const progress = duration > 0 ? (position / duration) * 100 : 0

  return (
    <div className={`livetv-root${activeChannel ? ' has-active' : ''}${panelsCollapsed ? ' panels-collapsed' : ''}${panelsCollapsed && panelsOverlay ? ' panels-overlay' : ''}`}>
      {/* Hover trigger zone — thin strip on left edge, visible when panels are collapsed */}
      {panelsCollapsed && (
        <div className="livetv-panels-trigger" onMouseEnter={handleTriggerEnter} />
      )}

      {/* ── Left panels (category + channel grid) ── */}
      <div
        className="livetv-left-panels"
        onMouseEnter={handlePanelsEnter}
        onMouseLeave={handlePanelsLeave}
      >
      {/* ── Left: Category sidebar ── */}
      <aside className="livetv-categories">
        <div className="livetv-cat-header">
          <span className="livetv-cat-title">Channels</span>
          <span className="livetv-cat-count">{channels.length}</span>
        </div>
        <div className="livetv-playlist-picker">
          <PlaylistPicker />
        </div>

        <div className="livetv-cat-search">
          <input
            className="livetv-search-input"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="livetv-cat-favorites">
          <span className="heart-icon">♥</span> Favorites
        </div>

        <div className="livetv-cat-label">ALL</div>
        <button
          className={`livetv-cat-item ${activeGroup === 'ALL' ? 'active' : ''}`}
          onClick={() => setActiveGroup('ALL')}
        >
          All Channels
        </button>

        {groups.map((g) => (
          <button
            key={g}
            className={`livetv-cat-item ${activeGroup === g ? 'active' : ''}`}
            onClick={() => setActiveGroup(g)}
          >
            <span className="cat-dot" />
            {g}
          </button>
        ))}
      </aside>

      {/* ── Middle: Channel grid ── */}
      <section className="livetv-grid-panel">
        {status === 'loading' ? (
          <div className="livetv-loading">Loading channels…</div>
        ) : status === 'error' ? (
          <div className="livetv-empty">
            <p className="livetv-empty-title">Failed to load channels</p>
            <p className="livetv-empty-detail">{error}</p>
            <button className="livetv-retry-btn" onClick={() => activePlaylistId && fetchChannels(activePlaylistId, true)}>Retry</button>
          </div>
        ) : channels.length === 0 ? (
          <div className="livetv-empty">
            <p className="livetv-empty-title">No channels found</p>
            <p className="livetv-empty-detail">The playlist loaded but contained no live channels.</p>
          </div>
        ) : (
          <div className="livetv-channel-grid">
            {filtered.map((ch) => {
              const epgTitle = epgMap.get(ch.id)
              const isActive = activeChannel?.id === ch.id
              return (
                <div
                  key={ch.id}
                  className={`livetv-ch-card ${isActive ? 'active' : ''}`}
                  onClick={() => playChannel(ch)}
                >
                  <div className="livetv-ch-logo-wrap">
                    {ch.logo ? (
                      <img src={ch.logo} alt={ch.name} className="livetv-ch-logo" loading="lazy" />
                    ) : (
                      <div className="livetv-ch-logo-placeholder">
                        {ch.name.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <p className="livetv-ch-name truncate">{ch.name}</p>
                  {epgTitle && <p className="livetv-ch-epg truncate">{epgTitle}</p>}
                </div>
              )
            })}
          </div>
        )}
      </section>
      </div>{/* end livetv-left-panels */}

      {/* ── Right: Player panel ── */}
      <section className="livetv-player-panel">
        {activeChannel ? (
          <>
            {/* Channel title bar */}
            <div className="livetv-player-topbar">
              <span className="lock-icon">🔒</span>
              <span className="livetv-player-ch-name">{activeChannel.name}</span>
              <button className="livetv-player-close" onClick={closeChannel}>✕</button>
            </div>

            {/* Video */}
            <div className="livetv-video-wrap">
              <video
                ref={videoRef}
                className="livetv-video"
                onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
                onDurationChange={(e) => setDuration(e.currentTarget.duration)}
                onPlay={() => setPaused(false)}
                onPause={() => setPaused(true)}
              />
            </div>

            {/* Tech Stats overlay */}
            {showTechStats && (
              <div className="livetv-tech-stats-panel">
                <div className="livetv-ts-header">
                  <span className="livetv-ts-title">Tech Stats</span>
                  <button className="livetv-ts-close" onClick={() => setShowTechStats(false)}>✕</button>
                </div>
                <div className="livetv-ts-section">VIDEO</div>
                <div className="livetv-ts-row"><span>RESOLUTION</span><span className="ts-val ts-orange">{techStats.resolution}</span></div>
                <div className="livetv-ts-row"><span>CODEC</span><span className="ts-val">{techStats.codec}</span></div>
                <div className="livetv-ts-row"><span>FPS</span><span className="ts-val">{techStats.fps}</span></div>
                <div className="livetv-ts-row"><span>BITRATE</span><span className="ts-val">{techStats.bitrate}</span></div>
                <div className="livetv-ts-section">AUDIO</div>
                <div className="livetv-ts-row"><span>CODEC</span><span className="ts-val">{techStats.audioCodec}</span></div>
                <div className="livetv-ts-row"><span>CHANNELS</span><span className="ts-val">{techStats.audioChannels}</span></div>
                <div className="livetv-ts-section">NETWORK</div>
                <div className="livetv-ts-row"><span>BUFFER</span><span className={`ts-val ${parseFloat(techStats.buffer) < 2 ? 'ts-red' : 'ts-orange'}`}>{techStats.buffer}</span></div>
                <div className="livetv-ts-row"><span>DROPPED FRAMES</span><span className={`ts-val ${techStats.droppedFrames !== '0' ? 'ts-red' : 'ts-green'}`}>{techStats.droppedFrames}</span></div>
              </div>
            )}

            {/* Controls + EPG — transparent gradient overlay at bottom */}
            <div className="livetv-controls">
              {/* EPG now-playing */}
              {epgNow && (
                <div className="livetv-epg-bar">
                  <span className="livetv-epg-title">{epgNow.title}</span>
                </div>
              )}

              {/* Seek bar — hidden for pure live streams (Infinity duration) */}
              {isFinite(duration) && duration > 0 && (
              <div className="livetv-seek-wrap">
                <div className="livetv-seek-track" onClick={(e) => {
                  if (!videoRef.current || !duration) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const pct = (e.clientX - rect.left) / rect.width
                  videoRef.current.currentTime = pct * duration
                }}>
                  <div className="livetv-seek-fill" style={{ width: `${progress}%` }} />
                  <div className="livetv-seek-thumb" style={{ left: `${progress}%` }} />
                </div>
              </div>
              )}

              <div className="livetv-ctrl-row">
                <div className="livetv-ctrl-left">
                  <button className="livetv-ctrl-btn" onClick={() => seek(-10)} title="Back 10s">
                    <SkipBackIcon />
                  </button>
                  <button className="livetv-ctrl-btn play-pause" onClick={togglePlay}>
                    {paused ? <PlayIcon /> : <PauseIcon />}
                  </button>
                  <button className="livetv-ctrl-btn" onClick={() => seek(10)} title="Forward 10s">
                    <SkipFwdIcon />
                  </button>

                  {/* Volume */}
                  <div className="livetv-vol-wrap" onMouseEnter={() => setShowVol(true)} onMouseLeave={() => setShowVol(false)}>
                    <button className="livetv-ctrl-btn" onClick={() => {
                      if (videoRef.current) videoRef.current.muted = !videoRef.current.muted
                    }}>
                      <VolumeIcon />
                    </button>
                    {showVol && (
                      <input
                        type="range" className="livetv-vol-slider"
                        min={0} max={1} step={0.05} value={volume}
                        onChange={(e) => {
                          const v = Number(e.target.value)
                          setVolume(v)
                          if (videoRef.current) videoRef.current.volume = v
                        }}
                      />
                    )}
                  </div>

                  {isFinite(duration) && duration > 0 ? (
                    <span className="livetv-time">{formatTime(position)} / {formatTime(duration)}</span>
                  ) : (
                    <span className="livetv-live-badge">LIVE</span>
                  )}
                </div>

                <div className="livetv-ctrl-right">
                  <button
                    className={`livetv-ctrl-btn livetv-tech-stats-btn ${showTechStats ? 'active' : ''}`}
                    onClick={() => setShowTechStats(v => !v)}
                    title="Tech Stats"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                    </svg>
                  </button>
                  <span className="livetv-quality-badge">TV Channels</span>
                  <button className="livetv-ctrl-btn" title="Fullscreen" onClick={() => {
                    const el = document.querySelector('.livetv-root') as HTMLElement
                    if (document.fullscreenElement) { document.exitFullscreen() }
                    else { el?.requestFullscreen?.() }
                  }}>
                    <FullscreenIcon />
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="livetv-player-empty">
            <TvEmptyIcon />
            <p>Select a channel to watch</p>
          </div>
        )}
      </section>
    </div>
  )
}

// Icons
function PlayIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>
}
function PauseIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
}
function SkipBackIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>
}
function SkipFwdIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M12.01 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/></svg>
}
function VolumeIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>
}
function FullscreenIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
}
function TvEmptyIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="48" height="48"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>
}
