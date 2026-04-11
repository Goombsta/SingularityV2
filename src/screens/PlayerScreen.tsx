import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import Hls from 'hls.js'
import mpegts from 'mpegts.js'
import type { PlayerState } from '../types'
import './PlayerScreen.css'

// 'pending' = still determining which player to use (MPV initialising on Windows)
// 'mpv'     = native MPV HWND is active
// 'html5'   = HTML5 <video> fallback (Android, or MPV failed)
type PlayerMode = 'pending' | 'mpv' | 'html5'

interface TrackInfo {
  id: number
  track_type: string
  title?: string
  lang?: string
  selected: boolean
}

async function isWindows(): Promise<boolean> {
  try {
    return (await platform()) === 'windows'
  } catch {
    return false
  }
}

export default function PlayerScreen() {
  const location = useLocation()
  const navigate = useNavigate()
  const state = location.state as PlayerState | null

  // Stores the player ID for the current session so handlers outside the effect
  // can send commands to the right player instance.
  const playerIdRef = useRef('')

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const mpegtsRef = useRef<mpegts.Player | null>(null)
  const controlsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const mpvActiveRef = useRef(false)
  const tracksLoadedRef = useRef(false)

  const [playerMode, setPlayerMode] = useState<PlayerMode>('pending')
  const [videoReady, setVideoReady] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [paused, setPaused] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(100)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [fading, setFading] = useState(false)
  const [mpvError, setMpvError] = useState<string | null>(null)
  const [streamError, setStreamError] = useState(false)

  // Tracks
  const [subtitleTracks, setSubtitleTracks] = useState<TrackInfo[]>([])
  const [audioTracks, setAudioTracks] = useState<TrackInfo[]>([])
  const [selectedSubId, setSelectedSubId] = useState(0)
  const [selectedAudioId, setSelectedAudioId] = useState(0)
  const [showTracksPanel, setShowTracksPanel] = useState(false)
  const [subtitleSize, setSubtitleSize] = useState(1) // 0=Small 1=Normal 2=Large 3=Huge
  const [showTechStats, setShowTechStats] = useState(false)

  // Tech stats — polled from HTML5 video element or mpv
  const [techStats, setTechStats] = useState({
    resolution: '—',
    codec: '—',
    fps: '—',
    bitrate: '—',
    pixelFormat: '—',
    hwDecode: '—',
    audioCodec: '—',
    audioBitrate: '—',
    audioChannels: '—',
    buffer: '—',
    droppedFrames: '—',
  })

  // Poll tech stats when panel is open
  useEffect(() => {
    if (!showTechStats) return
    let cancelled = false

    async function pollStats() {
      if (playerMode === 'mpv') {
        try {
          const s = await invoke<{
            width: number; height: number; video_codec: string; fps: number;
            video_bitrate: number; pixel_format: string; hwdec_active: string;
            audio_codec: string; audio_bitrate: number; audio_channels: number;
            demuxer_cache_duration: number; dropped_frames: number;
          }>('player_get_tech_stats', { playerId: playerIdRef.current })
          if (!cancelled) setTechStats({
            resolution: s.width > 0 ? `${s.width}×${s.height}` : '—',
            codec: s.video_codec || '—',
            fps: s.fps > 0 ? String(Math.round(s.fps)) : '—',
            bitrate: s.video_bitrate > 0 ? `${Math.round(s.video_bitrate / 1000)} Kbps` : 'N/A',
            pixelFormat: s.pixel_format || '—',
            hwDecode: s.hwdec_active || 'none',
            audioCodec: s.audio_codec || '—',
            audioBitrate: s.audio_bitrate > 0 ? `${Math.round(s.audio_bitrate / 1000)} Kbps` : '—',
            audioChannels: s.audio_channels === 2 ? 'Stereo' : s.audio_channels === 1 ? 'Mono' : s.audio_channels > 0 ? `${s.audio_channels}ch` : '—',
            buffer: s.demuxer_cache_duration > 0 ? `${s.demuxer_cache_duration.toFixed(1)}s` : '—',
            droppedFrames: String(s.dropped_frames ?? 0),
          })
        } catch { /* ignore */ }
      } else if (videoRef.current) {
        const v = videoRef.current
        const vq = (v as unknown as { getVideoPlaybackQuality?: () => { droppedVideoFrames: number } }).getVideoPlaybackQuality?.()
        const dropped = vq ? vq.droppedVideoFrames : 0
        const w = v.videoWidth, h = v.videoHeight
        if (!cancelled) setTechStats(prev => ({
          ...prev,
          resolution: w > 0 ? `${w}×${h}` : '—',
          fps: '—',
          bitrate: 'N/A',
          pixelFormat: '—',
          hwDecode: '—',
          buffer: v.buffered.length > 0 ? `${(v.buffered.end(v.buffered.length - 1) - v.currentTime).toFixed(1)}s` : '—',
          droppedFrames: String(dropped),
        }))
      }
    }

    pollStats()
    const id = setInterval(pollStats, 1500)
    return () => { cancelled = true; clearInterval(id) }
  }, [showTechStats, playerMode])

  // ── Redirect if no stream state ────────────────────────────────────────────
  useEffect(() => {
    if (!state?.url) navigate('/')
  }, [state, navigate])

  // ── Player mode detection + MPV setup ─────────────────────────────────────
  useEffect(() => {
    if (!state?.url) return

    // Generate a fresh ID for this exact effect invocation and store it in the ref
    // so handlers outside the effect can reach the same player. Generating here
    // (not on mount) means React Strict Mode's cleanup→remount cycle gets two
    // distinct IDs — the cleanup destroys its own player, the new invocation
    // creates a different one, eliminating the race condition.
    const playerId = `player-${Math.random().toString(36).slice(2, 9)}`
    playerIdRef.current = playerId
    setMpvError(null)
    let cancelled = false

    async function start() {
      const win = await isWindows()

      if (!win) {
        if (!cancelled) setPlayerMode('html5')
        return
      }

      const w = window.innerWidth
      const h = window.innerHeight

      try {
        await invoke('mpv_create', { playerId, x: 0, y: 0, width: w, height: h, live: state?.live !== false })

        if (cancelled) {
          invoke('mpv_destroy', { playerId }).catch(() => {})
          return
        }

        mpvActiveRef.current = true
        setVideoReady(false)
        setPlayerMode('mpv')

        await invoke('mpv_load_url', { playerId, url: state!.url })
        setPaused(false)
        setStreamError(false)
        tracksLoadedRef.current = false
        setSubtitleTracks([])
        setAudioTracks([])
        setSelectedSubId(0)
        setSelectedAudioId(0)

        // 1-second property poll
        let pollCount = 0
        let idleCount = 0
        pollRef.current = setInterval(async () => {
          try {
            const props = await invoke<{ duration: number; position: number; paused: boolean; volume: number; idle: boolean }>(
              'player_get_properties', { playerId }
            )
            pollCount++
            setPosition(props.position)
            if (props.duration > 0) setDuration(props.duration)
            setPaused(props.paused)
            // Only go transparent once video is actually rendering (avoids desktop bleed-through)
            if (!videoReady && (props.position > 0 || (props.duration > 0 && !props.idle))) {
              setVideoReady(true)
              document.documentElement.style.background = 'transparent'
              document.body.style.background = 'transparent'
              const root = document.getElementById('root')
              if (root) root.style.background = 'transparent'
            }
            // 5-second grace period, then require 10 consecutive idle polls before flagging error
            if (pollCount > 5 && props.idle && props.duration === 0) {
              idleCount++
              if (idleCount >= 10) setStreamError(true)
            } else {
              idleCount = 0
              if (props.duration > 0 || props.position > 0) setStreamError(false)
            }
          } catch { /* ignore */ }
        }, 1000)

        // Fetch tracks 3s after load — no mpvActiveRef guard so tracks are always
        // fetched even if playerMode was incorrectly flipped to html5 by a prior error.
        setTimeout(async () => {
          if (tracksLoadedRef.current) return
          tracksLoadedRef.current = true
          try {
            const tracks = await invoke<TrackInfo[]>('mpv_get_tracks', { playerId })
            setSubtitleTracks(tracks.filter((t) => t.track_type === 'sub'))
            const audio = tracks.filter((t) => t.track_type === 'audio')
            setAudioTracks(audio)
            const activeAudio = audio.find((t) => t.selected)
            if (activeAudio) setSelectedAudioId(activeAudio.id)
          } catch { /* ignore */ }
        }, 3000)

      } catch (e) {
        if (!cancelled) {
          setMpvError(String(e))
          mpvActiveRef.current = false
          setPlayerMode('html5')
        }
      }
    }

    start()

    return () => {
      cancelled = true
      setStreamError(false)
      setVideoReady(false)
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      document.documentElement.style.background = ''
      document.body.style.background = ''
      const root = document.getElementById('root')
      if (root) root.style.background = ''
      if (mpvActiveRef.current) {
        mpvActiveRef.current = false
        // Use closure-captured playerId, not playerIdRef.current — by cleanup time
        // a new effect may have already written a new ID to the ref.
        invoke('mpv_destroy', { playerId }).catch(() => {})
      }
    }
  }, [state?.url])

  // ── Resize MPV child window ────────────────────────────────────────────────
  useEffect(() => {
    if (playerMode !== 'mpv') return
    const onResize = () => {
      invoke('mpv_resize', {
        playerId: playerIdRef.current, x: 0, y: 0,
        width: window.innerWidth, height: window.innerHeight,
      }).catch(() => {})
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [playerMode])

  // ── HTML5 stream setup ─────────────────────────────────────────────────────
  useEffect(() => {
    if (playerMode !== 'html5' || !state?.url || !videoRef.current) return
    const video = videoRef.current
    const url = state.url

    hlsRef.current?.destroy(); hlsRef.current = null
    if (mpegtsRef.current) {
      mpegtsRef.current.unload()
      mpegtsRef.current.detachMediaElement()
      mpegtsRef.current.destroy()
      mpegtsRef.current = null
    }
    video.src = ''

    const isLive = state.live !== false
    const urlPath = url.split('?')[0].toLowerCase()
    const isHls = /\.m3u8$/.test(urlPath)
    const isNativeFormat = /\.(mp4|mkv|avi|webm|mov|m4v|flv|wmv)$/.test(urlPath)
    const isMpegTs = /\.ts$/.test(urlPath) || (isLive && !isHls && !isNativeFormat)

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,                   // IPTV isn't true LL-HLS; thin buffer causes unnecessary rebuffers
        backBufferLength: isLive ? 30 : 90,
        maxBufferLength: isLive ? 30 : 60,       // 30 s forward buffer for live
        maxMaxBufferLength: isLive ? 60 : 120,
      })
      hlsRef.current = hls
      hls.loadSource(url)
      hls.attachMedia(video)
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}))
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) { hls.destroy(); hlsRef.current = null }
      })
    } else if (isNativeFormat) {
      video.src = url
      video.play().catch(() => {})
    } else if (isMpegTs || (!isHls && !isNativeFormat)) {
      if (!mpegts.isSupported()) { video.src = url; video.play().catch(() => {}); return }
      const player = mpegts.createPlayer(
        { type: 'mpegts', url, isLive, hasAudio: true, hasVideo: true },
        {
          enableWorker: true,
          enableStashBuffer: true,                          // IO cushion; helps both live and VOD
          stashInitialSize: isLive ? 512 * 1024 : undefined,
          liveBufferLatencyChasing: false,                  // don't force-seek on drift; IPTV isn't low-latency
          liveBufferLatencyMaxLatency: isLive ? 30 : undefined,
          liveBufferLatencyMinRemain: isLive ? 8 : undefined,
        }
      )
      mpegtsRef.current = player
      player.attachMediaElement(video)
      player.load()
      void player.play()
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
  }, [state?.url, state?.live, playerMode])

  // ── Controls auto-hide ─────────────────────────────────────────────────────
  const resetControlsTimer = useCallback(() => {
    setShowControls(true)
    if (controlsTimer.current) clearTimeout(controlsTimer.current)
    controlsTimer.current = setTimeout(() => setShowControls(false), 3000)
  }, [])

  useEffect(() => {
    resetControlsTimer()
    return () => { if (controlsTimer.current) clearTimeout(controlsTimer.current) }
  }, [resetControlsTimer])

  // ── Control actions ────────────────────────────────────────────────────────
  const togglePlay = () => {
    if (playerMode === 'mpv') {
      if (paused) {
        invoke('mpv_resume', { playerId: playerIdRef.current }).catch(() => {})
        setPaused(false)
      } else {
        invoke('mpv_pause', { playerId: playerIdRef.current }).catch(() => {})
        setPaused(true)
      }
    } else {
      const v = videoRef.current
      if (!v) return
      if (v.paused) { v.play().catch(() => {}); setPaused(false) }
      else { v.pause(); setPaused(true) }
    }
    resetControlsTimer()
  }

  const skip = (secs: number) => {
    const next = Math.max(0, Math.min(duration || Infinity, position + secs))
    setPosition(next)
    if (playerMode === 'mpv') {
      invoke('mpv_seek', { playerId: playerIdRef.current, position: next }).catch(() => {})
    } else if (videoRef.current) {
      videoRef.current.currentTime = next
    }
    resetControlsTimer()
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const pos = Number(e.target.value)
    setPosition(pos)
    if (playerMode === 'mpv') {
      invoke('mpv_seek', { playerId: playerIdRef.current, position: pos }).catch(() => {})
    } else if (videoRef.current) {
      videoRef.current.currentTime = pos
    }
    resetControlsTimer()
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = Number(e.target.value)
    setVolume(vol)
    if (playerMode === 'mpv') {
      invoke('mpv_set_volume', { playerId: playerIdRef.current, volume: muted ? 0 : vol }).catch(() => {})
    } else if (videoRef.current) {
      videoRef.current.volume = vol / 100
    }
    resetControlsTimer()
  }

  const toggleMute = () => {
    const next = !muted
    setMuted(next)
    if (playerMode === 'mpv') {
      invoke('mpv_set_volume', { playerId: playerIdRef.current, volume: next ? 0 : volume }).catch(() => {})
    } else if (videoRef.current) {
      videoRef.current.muted = next
    }
    resetControlsTimer()
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setFullscreen(true)
    } else {
      document.exitFullscreen()
      setFullscreen(false)
    }
    resetControlsTimer()
  }

  const selectSubTrack = (id: number) => {
    setSelectedSubId(id)
    invoke('mpv_set_sub_track', { playerId: playerIdRef.current, trackId: id }).catch(() => {})
    resetControlsTimer()
  }

  const selectAudioTrack = (id: number) => {
    setSelectedAudioId(id)
    invoke('mpv_set_audio_track', { playerId: playerIdRef.current, trackId: id }).catch(() => {})
    resetControlsTimer()
  }

  const SUB_SCALES = [0.7, 1.0, 1.5, 2.0]
  const handleSubtitleSize = (v: number) => {
    setSubtitleSize(v)
    invoke('mpv_set_sub_scale', { playerId: playerIdRef.current, scale: SUB_SCALES[v] }).catch(() => {})
  }

  const formatTime = (s: number) => {
    if (!s || isNaN(s)) return '0:00'
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  const trackLabel = (t: TrackInfo) => t.title ?? t.lang ?? `Track ${t.id}`

  const handleBack = () => {
    if (fading) return
    setFading(true)
    setTimeout(() => {
      if (state?.returnTo) navigate(state.returnTo)
      else navigate(-1)
    }, 280)
  }

  if (!state) return null

  return (
    <div
      className={`player-screen ${showControls ? 'show-controls' : ''} ${playerMode === 'mpv' && videoReady ? 'mpv-mode' : ''} ${fading ? 'fading' : ''}`}
      onMouseMove={resetControlsTimer}
      onClick={() => setShowTracksPanel(false)}
    >
      {playerMode === 'mpv' ? (
        <div className="player-video" />
      ) : (
        <video
          ref={videoRef}
          className="player-video"
          autoPlay
          playsInline
          disablePictureInPicture
          onContextMenu={(e) => e.preventDefault()}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
          onDurationChange={(e) => setDuration(e.currentTarget.duration)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onError={() => setStreamError(true)}
        />
      )}

      {mpvError && (
        <div className="player-error-badge">MPV: {mpvError}</div>
      )}

      {streamError && playerMode === 'mpv' && (
        <div className="player-stream-error">
          <span className="player-stream-error-icon">⚠</span>
          <span className="player-stream-error-title">Stream unavailable</span>
          <span className="player-stream-error-sub">The stream could not be loaded. It may be offline or geo-restricted.</span>
          <button
            className="player-stream-error-retry"
            onClick={(e) => {
              e.stopPropagation()
              setStreamError(false)
              invoke('mpv_load_url', { playerId: playerIdRef.current, url: state!.url }).catch(() => {})
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Invisible click-to-play overlay */}
      <div className="player-click-overlay" onClick={(e) => { e.stopPropagation(); togglePlay() }} />

      {/* Tech Stats overlay */}
      {showTechStats && (
        <div className="tech-stats-panel" onClick={(e) => e.stopPropagation()}>
          <div className="tech-stats-header">
            <span className="tech-stats-title">Tech Stats</span>
            <button className="tech-stats-close" onClick={() => setShowTechStats(false)}>✕</button>
          </div>
          <div className="tech-stats-section-label">VIDEO</div>
          <div className="tech-stats-row"><span>RESOLUTION</span><span className="ts-val ts-orange">{techStats.resolution}</span></div>
          <div className="tech-stats-row"><span>CODEC</span><span className="ts-val">{techStats.codec}</span></div>
          <div className="tech-stats-row"><span>FPS</span><span className="ts-val">{techStats.fps}</span></div>
          <div className="tech-stats-row"><span>BITRATE</span><span className="ts-val">{techStats.bitrate}</span></div>
          <div className="tech-stats-row"><span>PIXEL FORMAT</span><span className="ts-val">{techStats.pixelFormat}</span></div>
          <div className="tech-stats-row"><span>HW DECODE</span><span className="ts-val ts-green">{techStats.hwDecode}</span></div>
          <div className="tech-stats-section-label">AUDIO</div>
          <div className="tech-stats-row"><span>CODEC</span><span className="ts-val">{techStats.audioCodec}</span></div>
          <div className="tech-stats-row"><span>BITRATE</span><span className="ts-val ts-orange">{techStats.audioBitrate}</span></div>
          <div className="tech-stats-row"><span>CHANNELS</span><span className="ts-val">{techStats.audioChannels}</span></div>
          <div className="tech-stats-section-label">NETWORK</div>
          <div className="tech-stats-row"><span>BUFFER</span><span className={`ts-val ${parseFloat(techStats.buffer) < 2 ? 'ts-red' : 'ts-orange'}`}>{techStats.buffer}</span></div>
          <div className="tech-stats-row"><span>DROPPED FRAMES</span><span className={`ts-val ${techStats.droppedFrames !== '0' ? 'ts-red' : 'ts-green'}`}>{techStats.droppedFrames}</span></div>
        </div>
      )}

      {/* Top bar */}
      <div className="player-top-bar">
        <button className="player-back" onClick={handleBack}>←</button>
        <span className="player-title">{state.title}</span>
      </div>

      {/* Bottom controls */}
      <div className="player-controls" onClick={(e) => e.stopPropagation()}>
        {/* Seek bar */}
        <div className="seek-bar-wrap">
          <span className="time-label">{formatTime(position)}</span>
          <input
            type="range"
            className="seek-bar"
            min={0}
            max={duration || 100}
            value={position}
            onChange={handleSeek}
            step={0.5}
          />
          <span className="time-label">{formatTime(duration)}</span>
        </div>

        {/* Controls row — 3 columns: vol-left | playback-center | tracks-right */}
        <div className="controls-row">

          {/* Left: mute + volume */}
          <div className="controls-left">
            <button className="ctrl-btn" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
              {muted ? '🔇' : '🔊'}
            </button>
            <input
              type="range"
              className="volume-bar"
              min={0}
              max={100}
              step={1}
              value={muted ? 0 : volume}
              onChange={handleVolumeChange}
            />
          </div>

          {/* Center: skip-back | play | skip-fwd */}
          <div className="controls-center">
            <button className="ctrl-btn skip-btn skip-back" onClick={() => skip(-10)} title="Back 10s">
              <span className="skip-icon">⟲</span>
            </button>
            <button className="ctrl-btn" onClick={togglePlay} title={paused ? 'Play' : 'Pause'}>
              {paused ? '▶' : '⏸'}
            </button>
            <button className="ctrl-btn skip-btn skip-fwd" onClick={() => skip(10)} title="Forward 10s">
              <span className="skip-icon">⟲</span>
            </button>
          </div>

          {/* Right: tech stats + tracks panel + fullscreen */}
          <div className="controls-right">
            {/* Tech Stats toggle */}
            <button
              className={`ctrl-btn tech-stats-btn ${showTechStats ? 'active' : ''}`}
              onClick={(e) => { e.stopPropagation(); setShowTechStats(v => !v); resetControlsTimer() }}
              title="Tech Stats"
            >
              <svg className="tech-stats-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
            </button>

            <div className="track-menu-wrap" onClick={(e) => e.stopPropagation()}>
              <button
                className={`ctrl-btn track-btn ${showTracksPanel ? 'active' : ''}`}
                onClick={() => setShowTracksPanel((v) => !v)}
                title="Audio & Subtitles"
              >
                <svg className="tracks-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  <line x1="9" y1="10" x2="15" y2="10"/>
                  <line x1="9" y1="14" x2="13" y2="14"/>
                </svg>
              </button>

              {showTracksPanel && (
                <div className="tracks-panel">
                  <div className="tracks-panel-columns">
                    {/* Audio column */}
                    <div className="tracks-column">
                      <div className="tracks-column-header">AUDIO ({audioTracks.length})</div>
                      <div className="tracks-column-list">
                        {audioTracks.length === 0 ? (
                          <span className="tracks-empty">No audio tracks</span>
                        ) : audioTracks.map((t) => (
                          <button
                            key={t.id}
                            className={`track-menu-item ${selectedAudioId === t.id ? 'active' : ''}`}
                            onClick={() => selectAudioTrack(t.id)}
                          >
                            {selectedAudioId === t.id && <span className="track-check">✓</span>}
                            {trackLabel(t)}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="tracks-panel-divider" />

                    {/* Subtitles column */}
                    <div className="tracks-column">
                      <div className="tracks-column-header">SUBTITLES ({subtitleTracks.length})</div>
                      <div className="tracks-column-list">
                        <button
                          className={`track-menu-item ${selectedSubId === 0 ? 'active' : ''}`}
                          onClick={() => selectSubTrack(0)}
                        >
                          {selectedSubId === 0 && <span className="track-check">✓</span>}
                          Disabled
                        </button>
                        {subtitleTracks.map((t) => (
                          <button
                            key={t.id}
                            className={`track-menu-item ${selectedSubId === t.id ? 'active' : ''}`}
                            onClick={() => selectSubTrack(t.id)}
                          >
                            {selectedSubId === t.id && <span className="track-check">✓</span>}
                            {trackLabel(t)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Text size slider */}
                  <div className="tracks-panel-footer">
                    <span className="tracks-size-label-text">Text Size</span>
                    <input
                      type="range"
                      className="tracks-size-slider"
                      min={0}
                      max={3}
                      step={1}
                      value={subtitleSize}
                      onChange={(e) => handleSubtitleSize(Number(e.target.value))}
                    />
                    <div className="tracks-size-labels">
                      <span>Small</span><span>Normal</span><span>Large</span><span>Huge</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button className="ctrl-btn" onClick={toggleFullscreen} title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
              ⛶
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
