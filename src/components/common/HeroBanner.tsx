import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { extractBaseTitle } from '../../utils/genreMap'
import type { Series, VodItem } from '../../types'
import './HeroBanner.css'

type HeroItem = VodItem | Series

interface TmdbHeroData {
  backdropUrl?: string
  overview?: string
  voteAverage?: number
  tagline?: string
  genres?: string[]
  runtimeMins?: number
  releaseDate?: string
}

interface HeroBannerProps {
  items: HeroItem[]
  onSelect?: (item: HeroItem) => void
}

export default function HeroBanner({ items, onSelect }: HeroBannerProps) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [tmdbData, setTmdbData] = useState<TmdbHeroData | null>(null)
  const fetchingFor = useRef('')
  const navigate = useNavigate()

  // Clamp index when items change
  useEffect(() => {
    setActiveIdx((i) => (items.length > 0 ? Math.min(i, items.length - 1) : 0))
  }, [items.length])

  // Auto-rotate
  useEffect(() => {
    if (items.length < 2) return
    const t = setInterval(() => setActiveIdx((i) => (i + 1) % items.length), 8000)
    return () => clearInterval(t)
  }, [items.length])

  // Fetch TMDB data for active item
  useEffect(() => {
    const idx = Math.min(activeIdx, items.length - 1)
    if (items.length === 0) return
    const item = items[idx]
    const apiKey = localStorage.getItem('tmdb_api_key') || ''
    if (!apiKey) { setTmdbData(null); return }
    const cleanName = extractBaseTitle(item.name) || item.name
    const cacheKey = cleanName + (item.year?.slice(0, 4) ?? '')
    if (fetchingFor.current === cacheKey) return
    fetchingFor.current = cacheKey
    setTmdbData(null)
    const isVod = 'stream_url' in item
    invoke<{
      backdropUrl?: string; overview: string; tagline: string
      voteAverage: number; genres: string[]; runtimeMins?: number; releaseDate: string
    }>('fetch_tmdb', {
      title: cleanName,
      year: item.year ?? null,
      mediaType: isVod ? 'movie' : 'tv',
      apiKey,
    }).then((d) => {
      if (fetchingFor.current === cacheKey) {
        setTmdbData({ backdropUrl: d.backdropUrl, overview: d.overview, tagline: d.tagline, voteAverage: d.voteAverage, genres: d.genres, runtimeMins: d.runtimeMins, releaseDate: d.releaseDate })
      }
    }).catch(() => { if (fetchingFor.current === cacheKey) setTmdbData(null) })
  }, [activeIdx, items])

  if (items.length === 0) return null

  const idx = Math.min(activeIdx, items.length - 1)
  const item = items[idx]
  const isVod = 'stream_url' in item

  // Prefer TMDB data, fall back to playlist data
  const displayPlot = (tmdbData?.overview && tmdbData.overview.length > 10) ? tmdbData.overview : item.plot
  const displayRating = tmdbData?.voteAverage ? tmdbData.voteAverage.toFixed(1) : item.rating
  const displayYear = (tmdbData?.releaseDate ?? item.year ?? '').slice(0, 4)
  const displayGenres = tmdbData?.genres?.slice(0, 2) ?? []
  const cleanTitle = extractBaseTitle(item.name) || item.name

  const handlePlay = () => {
    if (isVod) navigate('/player', { state: { url: (item as VodItem).stream_url, title: cleanTitle } })
  }
  const handleDetails = () => {
    if (onSelect) { onSelect(item); return }
    navigate(isVod ? '/vod' : '/series', { state: { preSelectedId: item.id } })
  }

  return (
    <div className="hero-banner">
      <div className="hero-bg">
        {/* Stack all item backgrounds; CSS crossfade between them */}
        {items.slice(0, 5).map((it, i) => {
          const bg = i === idx
            ? (tmdbData?.backdropUrl ?? it.backdrop ?? it.poster)
            : (it.backdrop ?? it.poster)
          // Landscape (backdrop) images get right-anchored full-height display
          // Portrait (poster-only) images get object-fit:cover
          const isLandscape = i === idx
            ? !!(tmdbData?.backdropUrl || it.backdrop)
            : !!it.backdrop
          return bg ? (
            <img
              key={it.id}
              src={bg}
              alt=""
              className={`hero-bg-img ${isLandscape ? 'backdrop' : 'poster'}${i === idx ? ' active' : ''}`}
            />
          ) : null
        })}
        <div className="hero-gradient" />
      </div>

      <div className="hero-content">
        <h1 className="hero-title">{cleanTitle}</h1>
        {tmdbData?.tagline && <p className="hero-tagline">{tmdbData.tagline}</p>}

        <div className="hero-meta">
          {displayRating && <span className="hero-badge green">★ {parseFloat(displayRating).toFixed(1)}</span>}
          {displayYear && <span className="hero-badge">{displayYear}</span>}
          {displayGenres.map((g) => <span key={g} className="hero-badge">{g}</span>)}
          {tmdbData?.runtimeMins && <span className="hero-badge">{tmdbData.runtimeMins}m</span>}
          {!tmdbData && <span className="hero-badge">{isVod ? 'MOVIE' : 'SERIES'}</span>}
        </div>

        {displayPlot && <p className="hero-plot">{displayPlot.slice(0, 220)}{displayPlot.length > 220 ? '…' : ''}</p>}

        <div className="hero-actions">
          {isVod && <button className="hero-btn primary" onClick={handlePlay}>▶ Play</button>}
          <button className="hero-btn secondary" onClick={handleDetails}>
            <span className="hero-info-icon">i</span> Details
          </button>
        </div>
      </div>

      {items.length > 1 && (
        <div className="hero-dots">
          {items.slice(0, 5).map((_, i) => (
            <button key={i} className={`hero-dot ${i === idx ? 'active' : ''}`} onClick={() => setActiveIdx(i)} />
          ))}
        </div>
      )}
    </div>
  )
}
