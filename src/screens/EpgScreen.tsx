import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import { useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { useEpgStore } from '../store/slices/epgSlice'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import PlaylistPicker from '../components/common/PlaylistPicker'
import type { Channel, EpgProgram } from '../types'
import './EpgScreen.css'

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

const WINDOW_MINUTES = 180
const CELL_MINUTES = 30
const PIXELS_PER_MINUTE = 4
const CHANNEL_COL_WIDTH = 180
const ROW_HEIGHT = 48
const OVERSCAN = 3

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

function windowStart(): Date {
  const now = new Date()
  const snapped = new Date(now)
  snapped.setMinutes(Math.floor(now.getMinutes() / CELL_MINUTES) * CELL_MINUTES, 0, 0)
  snapped.setMinutes(snapped.getMinutes() - CELL_MINUTES)
  return snapped
}

function toMinutes(date: Date, base: Date): number {
  return (date.getTime() - base.getTime()) / 60000
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatDuration(startIso: string, stopIso: string): string {
  const mins = Math.round((new Date(stopIso).getTime() - new Date(startIso).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60), m = mins % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function progressPercent(startIso: string, stopIso: string): number {
  const now = Date.now()
  const start = new Date(startIso).getTime()
  const stop = new Date(stopIso).getTime()
  if (now < start) return 0
  if (now > stop) return 100
  return Math.round(((now - start) / (stop - start)) * 100)
}

function buildTimeSlots(base: Date, windowMins: number) {
  const slots: { label: string; offsetPx: number }[] = []
  const total = Math.ceil(windowMins / CELL_MINUTES) + 1
  for (let i = 0; i < total; i++) {
    const d = new Date(base.getTime() + i * CELL_MINUTES * 60000)
    slots.push({
      label: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      offsetPx: i * CELL_MINUTES * PIXELS_PER_MINUTE,
    })
  }
  return slots
}

// ── EpgGrid — virtualized, module-level ──────────────────────────────────────
interface EpgGridProps {
  base: Date
  totalWidthPx: number
  timeSlots: { label: string; offsetPx: number }[]
  nowLinePx: number
  filteredChannels: Channel[]
  programs: Record<string, EpgProgram[]>
  selectedProgram: { program: EpgProgram; channel: Channel } | null
  onProgramClick: (prog: EpgProgram, ch: Channel) => void
}

const EpgGrid = React.memo(function EpgGrid({
  base, totalWidthPx, timeSlots, nowLinePx,
  filteredChannels, programs, selectedProgram,
  onProgramClick,
}: EpgGridProps) {
  const rowsScrollRef = useRef<HTMLDivElement>(null)
  const timeHeaderScrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(600)

  useEffect(() => {
    const el = rowsScrollRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setContainerHeight(entry.contentRect.height)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = rowsScrollRef.current
    if (!el || nowLinePx <= 0) return
    el.scrollLeft = Math.max(0, nowLinePx - el.clientWidth / 4)
  }, [nowLinePx])

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    setScrollTop(el.scrollTop)
    if (timeHeaderScrollRef.current) {
      timeHeaderScrollRef.current.scrollLeft = el.scrollLeft
    }
  }, [])

  const totalRows = filteredChannels.length
  const totalHeightPx = totalRows * ROW_HEIGHT
  const visibleStart = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleEnd = Math.min(totalRows - 1, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN)
  const visibleChannels = filteredChannels.slice(visibleStart, visibleEnd + 1)

  return (
    <div className="epg-grid-wrap">
      <div className="epg-corner" style={{ width: CHANNEL_COL_WIDTH }} />

      <div className="epg-time-header-outer" style={{ marginLeft: CHANNEL_COL_WIDTH }}>
        <div className="epg-time-header-scroll" ref={timeHeaderScrollRef}>
          <div className="epg-time-header" style={{ minWidth: totalWidthPx, width: '100%' }}>
            {timeSlots.map((s) => (
              <div
                key={s.offsetPx}
                className="epg-time-slot"
                style={{ left: s.offsetPx, width: CELL_MINUTES * PIXELS_PER_MINUTE }}
              >
                {s.label}
              </div>
            ))}
            {nowLinePx > 0 && nowLinePx < totalWidthPx && (
              <div className="epg-now-line-header" style={{ left: nowLinePx }} />
            )}
          </div>
        </div>
      </div>

      <div className="epg-body">
        <div className="epg-channel-col" style={{ width: CHANNEL_COL_WIDTH }}>
          <div style={{ height: totalHeightPx, position: 'relative', transform: `translateY(-${scrollTop}px)` }}>
            {visibleChannels.map((ch, i) => {
              const absIndex = visibleStart + i
              return (
                <div
                  key={ch.id}
                  className="epg-channel-cell"
                  style={{ position: 'absolute', top: absIndex * ROW_HEIGHT, width: '100%' }}
                >
                  {ch.logo && (
                    <img
                      src={ch.logo}
                      alt=""
                      className="epg-channel-logo"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                  )}
                  <span className="epg-channel-name">{ch.name}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="epg-rows-scroll" ref={rowsScrollRef} onScroll={handleScroll}>
          <div style={{ height: totalHeightPx, minWidth: totalWidthPx, width: '100%', position: 'relative' }}>
            {nowLinePx > 0 && nowLinePx < totalWidthPx && (
              <div className="epg-now-line" style={{ left: nowLinePx }} />
            )}
            {visibleChannels.map((ch, i) => {
              const absIndex = visibleStart + i
              const epgId = ch.epg_channel_id ?? ch.id
              const progs: EpgProgram[] = programs[epgId] ?? []
              return (
                <div
                  key={ch.id}
                  className="epg-row"
                  style={{ position: 'absolute', top: absIndex * ROW_HEIGHT, width: '100%' }}
                >
                  {progs.length === 0 ? (
                    <div className="epg-no-epg">No EPG data</div>
                  ) : (
                    progs.map((prog) => {
                      const startMins = toMinutes(new Date(prog.start), base)
                      const stopMins = toMinutes(new Date(prog.stop), base)
                      if (stopMins < 0 || startMins > WINDOW_MINUTES + CELL_MINUTES * 2) return null
                      const left = Math.max(0, startMins) * PIXELS_PER_MINUTE
                      const width = Math.max(2, (stopMins - Math.max(0, startMins)) * PIXELS_PER_MINUTE - 2)
                      const progress = progressPercent(prog.start, prog.stop)
                      const isNow = progress > 0 && progress < 100
                      const isSelected =
                        selectedProgram?.program.start === prog.start &&
                        selectedProgram?.channel.id === ch.id
                      return (
                        <button
                          key={`${ch.id}-${prog.start}`}
                          className={`epg-program${isNow ? ' now' : ''}${isSelected ? ' selected' : ''}`}
                          style={{ left, width }}
                          onClick={() => onProgramClick(prog, ch)}
                          title={`${prog.title} (${formatTime(prog.start)} – ${formatTime(prog.stop)})`}
                        >
                          {isNow && <div className="epg-program-progress" style={{ width: `${progress}%` }} />}
                          <span className="epg-program-time">{formatTime(prog.start)}</span>
                          <span className="epg-program-title">{prog.title}</span>
                        </button>
                      )
                    })
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
})

// ── EpgPreviewPanel — inline right-side panel with live stream ────────────────
interface PreviewPanelProps {
  selection: { program: EpgProgram; channel: Channel }
  onClose: () => void
  onWatchFullscreen: () => void
}

function EpgPreviewPanel({ selection, onClose, onWatchFullscreen }: PreviewPanelProps) {
  const { program, channel } = selection
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const mpegtsRef = useRef<any>(null)
  const proxyPortRef = useRef<number | null>(null)
  const [isMuted, setIsMuted] = useState(true)

  // Sync mute toggle to DOM (React muted prop is unreliable)
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = isMuted
  }, [isMuted])

  // Fetch proxy port once — same as Live TV / PlayerScreen
  useEffect(() => {
    invoke<number | null>('get_proxy_port')
      .then(p => { proxyPortRef.current = p ?? null })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!videoRef.current || !channel.stream_url) return
    const video = videoRef.current   // narrowed to HTMLVideoElement — safe in closures
    const url = channel.stream_url

    hlsRef.current?.destroy(); hlsRef.current = null
    if (mpegtsRef.current) {
      mpegtsRef.current.unload?.()
      mpegtsRef.current.detachMediaElement?.()
      mpegtsRef.current.destroy()
      mpegtsRef.current = null
    }
    video.src = ''

    const isExplicitHls = /\.m3u8(\?|$)/i.test(url)
    const isExplicitTs  = /\.ts(\?|$)/i.test(url)

    // Start muted so autoplay is always permitted; user unmutes via the toggle button
    function mutedPlay() {
      video.muted = true
      setIsMuted(true)
      Promise.resolve(video.play()).catch(() => {})
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
      mpegtsRef.current = player
      player.attachMediaElement(video)
      player.load()
      mutedPlay()
      player.on(mpegts.Events.ERROR, () => {
        player.unload?.(); player.detachMediaElement?.(); player.destroy()
        mpegtsRef.current = null
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
      hlsRef.current = hls
      hls.loadSource(hlsUrl)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => mutedPlay())
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) { hls.destroy(); hlsRef.current = null; onFail() }
      })
    }

    if (isExplicitHls) {
      tryHls(url, tryNative, true)
    } else if (isExplicitTs) {
      tryHls(url.replace(/\.ts(\?|$)/i, '.m3u8$1'), () => tryMpegts())
    } else {
      tryHls(url, () => tryMpegts())
    }

    return () => {
      hlsRef.current?.destroy(); hlsRef.current = null
      if (mpegtsRef.current) {
        mpegtsRef.current.unload?.()
        mpegtsRef.current.detachMediaElement?.()
        mpegtsRef.current.destroy()
        mpegtsRef.current = null
      }
    }
  }, [channel.stream_url])

  const progress = progressPercent(program.start, program.stop)
  const isNow = progress > 0 && progress < 100

  return (
    <div className="epg-preview-panel">
      {/* Video player */}
      <div className="epg-preview-video-wrap">
        <video
          ref={videoRef}
          className="epg-preview-video"
          autoPlay
          playsInline
          muted
        />
        <button className="epg-preview-panel-close" onClick={onClose} title="Close">✕</button>
        <button
          className="epg-preview-mute-toggle"
          onClick={() => setIsMuted((m) => !m)}
          title={isMuted ? 'Unmute' : 'Mute'}
        >
          {isMuted ? '🔇' : '🔊'}
        </button>
      </div>

      {/* Program info */}
      <div className="epg-preview-panel-info">
        <div className="epg-preview-channel">
          {channel.logo && (
            <img
              src={channel.logo}
              alt=""
              className="epg-preview-ch-logo"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          )}
          <span className="epg-preview-ch-name">{channel.name}</span>
          {isNow && <span className="epg-preview-live-badge">LIVE</span>}
        </div>

        <div className="epg-preview-title">{program.title}</div>

        <div className="epg-preview-meta">
          <span>{formatTime(program.start)} – {formatTime(program.stop)}</span>
          <span className="epg-preview-dot">·</span>
          <span>{formatDuration(program.start, program.stop)}</span>
          {program.category && (
            <><span className="epg-preview-dot">·</span><span>{program.category}</span></>
          )}
        </div>

        {isNow && (
          <div className="epg-preview-progress-bar">
            <div className="epg-preview-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}

        {program.description && (
          <p className="epg-preview-desc">{program.description}</p>
        )}

        <button className="epg-preview-watch" onClick={onWatchFullscreen}>
          ▶ Watch Fullscreen
        </button>
      </div>
    </div>
  )
}

// ── Main screen component ─────────────────────────────────────────────────────
export default function EpgScreen() {
  const navigate = useNavigate()
  const { channels, activePlaylistId, fetchChannels, status } = usePlaylistStore()
  const { programs, fetchEpg, sources, loadSources } = useEpgStore()

  const [base] = useState<Date>(windowStart)
  const [activeGroup, setActiveGroup] = useState<string>('ALL')
  const [search, setSearch] = useState('')
  const [selectedProgram, setSelectedProgram] = useState<{ program: EpgProgram; channel: Channel } | null>(null)
  const [nowLinePx, setNowLinePx] = useState(0)

  const timeSlots = useMemo(() => buildTimeSlots(base, WINDOW_MINUTES + CELL_MINUTES * 2), [base])
  const totalWidthPx = (WINDOW_MINUTES + CELL_MINUTES * 2) * PIXELS_PER_MINUTE

  useEffect(() => {
    if (activePlaylistId) fetchChannels(activePlaylistId)
    loadSources()
  }, [activePlaylistId])

  useEffect(() => {
    for (const src of sources) fetchEpg(src.url)
  }, [sources.length])

  useEffect(() => {
    const update = () => setNowLinePx(Math.round(toMinutes(new Date(), base) * PIXELS_PER_MINUTE))
    update()
    const t = setInterval(update, 30000)
    return () => clearInterval(t)
  }, [base])

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

  const openPreview = useCallback((program: EpgProgram, channel: Channel) => {
    setSelectedProgram({ program, channel })
  }, [])

  const closePreview = useCallback(() => {
    setSelectedProgram(null)
  }, [])

  const watchFullscreen = useCallback(() => {
    if (!selectedProgram) return
    navigate('/player', {
      state: {
        url: selectedProgram.channel.stream_url,
        title: `${selectedProgram.channel.name} — ${selectedProgram.program.title}`,
        live: true,
        channelId: selectedProgram.channel.epg_channel_id ?? selectedProgram.channel.id,
        playlistId: selectedProgram.channel.playlist_id,
        returnTo: '/epg',
      },
    })
  }, [selectedProgram, navigate])

  const gridProps = useMemo<EpgGridProps>(() => ({
    base, totalWidthPx, timeSlots, nowLinePx,
    filteredChannels, programs, selectedProgram,
    onProgramClick: openPreview,
  }), [base, totalWidthPx, timeSlots, nowLinePx, filteredChannels, programs,
      selectedProgram, openPreview])

  return (
    <div className="epg-screen">
      {/* ── Category pill column ── */}
      <aside className="epg-categories">
        <div className="epg-cat-header">
          <span className="epg-cat-title">EPG</span>
          <span className="epg-cat-count">{channels.length}</span>
        </div>

        <div className="epg-playlist-picker">
          <PlaylistPicker />
        </div>

        <div className="epg-cat-search">
          <input
            className="epg-search-input"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="epg-cat-label">FILTER</div>
        <button
          className={`epg-cat-item${activeGroup === 'ALL' ? ' active' : ''}`}
          onClick={() => setActiveGroup('ALL')}
        >
          All Channels
        </button>
        {groups.map((g) => (
          <button
            key={g}
            className={`epg-cat-item${activeGroup === g ? ' active' : ''}`}
            onClick={() => setActiveGroup(g)}
          >
            <span className="cat-dot" />
            {g}
          </button>
        ))}
      </aside>

      {/* ── Main grid area ── */}
      <div className="epg-main">
        <div className="epg-topbar">
          <span className="epg-topbar-title">EPG Guide</span>
          {status === 'loading' && <span className="epg-loading-badge">Loading…</span>}
          {channels.length === 0 && status !== 'loading' && (
            <span className="epg-no-data">No channels — add a playlist first</span>
          )}
        </div>

        <EpgGrid {...gridProps} />
      </div>

      {/* ── Inline preview panel (right side) ── */}
      {selectedProgram && (
        <EpgPreviewPanel
          selection={selectedProgram}
          onClose={closePreview}
          onWatchFullscreen={watchFullscreen}
        />
      )}
    </div>
  )
}
