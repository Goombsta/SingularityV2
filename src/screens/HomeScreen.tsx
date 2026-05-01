import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate } from 'react-router-dom'
import HeroBanner from '../components/common/HeroBanner'
import HorizontalRow from '../components/common/HorizontalRow'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import { useResumeStore } from '../store/slices/resumeSlice'
import { useUiStore } from '../store/slices/uiSlice'
import { groupByExcelCategories, deduplicateItems, extractBaseTitle, matchesTrendingTitle } from '../utils/genreMap'
import { MOVIE_CATEGORY_ORDER, MOVIE_TITLE_MAP } from '../data/movieCategories'
import { SERIES_CATEGORY_ORDER, SERIES_TITLE_MAP } from '../data/seriesCategories'
import type { ResumeEntry, Series, VodItem } from '../types'
import './HomeScreen.css'

type HomeTab = 'favorites' | 'movies' | 'series'

interface TmdbTrendingItem {
  tmdbId: number; title: string; overview: string
  posterUrl?: string; backdropUrl?: string
  voteAverage: number; releaseDate: string; mediaType: string
}

/** Small card used in carousel rows */
function RowCard({
  poster, name, rating, versions, onClick, progress,
}: { poster?: string; name: string; rating?: string; versions?: number; onClick: () => void; progress?: number | null }) {
  const cleanName = extractBaseTitle(name) || name
  return (
    <div className="home-row-card" onClick={onClick}>
      <div className="home-row-img-wrap">
        {poster
          ? <img src={poster} alt={cleanName} className="home-row-poster" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          : <div className="home-row-placeholder">{cleanName.charAt(0)}</div>
        }
        <div className="home-row-hover">▶</div>
        {rating && <span className="home-row-rating">★ {parseFloat(rating).toFixed(1)}</span>}
        {versions && versions > 1 && <span className="vod-row-versions">{versions} ver.</span>}
        <p className="home-row-name">{cleanName}</p>
        {progress != null && progress > 0 && (
          <div className="continue-progress-bar">
            <div className="continue-progress-fill" style={{ width: `${Math.min(progress, 1) * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

/** Resolve poster for a resume entry from the in-memory VOD/Series catalog (fallback for old entries with null poster_url) */
function resolveEntryPoster(key: string, vods: VodItem[], seriesList: Series[]): string | undefined {
  const vodMatch = key.match(/^playlist:[^:]+:vod:(.+)$/)
  if (vodMatch) return vods.find((v) => v.id === vodMatch[1])?.poster
  const seriesMatch = key.match(/^playlist:[^:]+:series:([^:]+):/)
  if (seriesMatch) return seriesList.find((s) => s.id === seriesMatch[1])?.poster
  return undefined
}

/** Card for the Continue Watching row */
function ContinueWatchingCard({ entry, posterUrl, onClick, onDismiss }: {
  entry: ResumeEntry
  posterUrl?: string
  onClick: () => void
  onDismiss: (e: React.MouseEvent) => void
}) {
  const progress = entry.duration_sec > 0 ? entry.position_sec / entry.duration_sec : 0
  const remaining = entry.duration_sec - entry.position_sec
  const remainLabel = remaining > 3600
    ? `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m left`
    : `${Math.ceil(remaining / 60)}m left`

  return (
    <div className="home-row-card" onClick={onClick}>
      <div className="home-row-img-wrap">
        {posterUrl
          ? <img src={posterUrl} alt={entry.title} className="home-row-poster" loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          : <div className="home-row-placeholder">{entry.title.charAt(0)}</div>
        }
        <div className="home-row-hover">▶</div>
        <button className="cw-dismiss-btn" onClick={onDismiss} title="Dismiss" aria-label="Remove from Continue Watching">✕</button>
        <p className="home-row-name" style={{ opacity: 1 }}>{entry.title}</p>
        <div className="continue-progress-bar">
          <div className="continue-progress-fill" style={{ width: `${progress * 100}%` }} />
        </div>
        <span className="continue-remaining">{remainLabel}</span>
      </div>
    </div>
  )
}

export default function HomeScreen() {
  const { activePlaylistId, vods, series, status, fetchVod, fetchSeries } = usePlaylistStore()
  const { entries: resumeEntries, loadResumeEntries, clearEntry } = useResumeStore()
  const { favorites } = useUiStore()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<HomeTab>('movies')
  const [imdbMovies, setImdbMovies] = useState<string[]>([])
  const [imdbTv, setImdbTv] = useState<string[]>([])
  const [tmdbTrendingMovies, setTmdbTrendingMovies] = useState<TmdbTrendingItem[]>([])
  const [tmdbTrendingTv, setTmdbTrendingTv] = useState<TmdbTrendingItem[]>([])

  useEffect(() => {
    if (!activePlaylistId) return
    fetchVod(activePlaylistId)
    fetchSeries(activePlaylistId)
  }, [activePlaylistId, fetchVod, fetchSeries])

  // Load resume entries and refresh when returning from player
  useEffect(() => {
    loadResumeEntries()
    const onVisibility = () => { if (document.visibilityState === 'visible') loadResumeEntries() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [loadResumeEntries])

  // Fetch trending from TMDB
  useEffect(() => {
    invoke<TmdbTrendingItem[]>('fetch_tmdb_trending', { mediaType: 'movie' })
      .then(setTmdbTrendingMovies).catch(() => {})
    invoke<TmdbTrendingItem[]>('fetch_tmdb_trending', { mediaType: 'tv' })
      .then(setTmdbTrendingTv).catch(() => {})
  }, [])

  // Enrich Continue Watching entries with TMDB poster art
  const [cwTmdbPosters, setCwTmdbPosters] = useState<Record<string, string>>({})
  const cwFetchedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    for (const entry of resumeEntries.slice(0, 20)) {
      if (cwFetchedRef.current.has(entry.key)) continue
      const catalogPoster = resolveEntryPoster(entry.key, vods, series)
      if (catalogPoster) continue
      cwFetchedRef.current.add(entry.key)
      const cleanTitle = extractBaseTitle(entry.title) || entry.title
      const isTV = entry.key.includes(':series:')
      invoke<{ posterUrl?: string }>('fetch_tmdb', {
        title: cleanTitle, year: null, mediaType: isTV ? 'tv' : 'movie',
      }).then((meta) => {
        if (meta.posterUrl) setCwTmdbPosters((prev) => ({ ...prev, [entry.key]: meta.posterUrl! }))
      }).catch(() => {})
    }
  }, [resumeEntries, vods, series])

  // Trending: prefer TMDB weekly trending, fall back to IMDb RSS match.
  // When TMDB data is available, enrich matched items with TMDB poster/backdrop
  // so both the hero banner and carousel show consistent TMDB artwork.
  const trendingMovies = useMemo(() => {
    if (tmdbTrendingMovies.length > 0) {
      const used = new Set<string>()
      const result: VodItem[] = []
      for (const tmdb of tmdbTrendingMovies) {
        const t = (extractBaseTitle(tmdb.title) || tmdb.title).toLowerCase()
        const tYear = tmdb.releaseDate?.slice(0, 4)
        const match = vods.find((v) => {
          if (used.has(v.id)) return false
          const n = (extractBaseTitle(v.name) || v.name).toLowerCase()
          if (!matchesTrendingTitle(n, t)) return false
          if (tYear && v.year) {
            if (Math.abs(parseInt(v.year) - parseInt(tYear)) > 1) return false
          }
          return true
        })
        if (match) {
          used.add(match.id)
          result.push({
            ...match,
            poster: tmdb.posterUrl || match.poster,
            backdrop: tmdb.backdropUrl || match.backdrop,
            rating: tmdb.voteAverage ? String(tmdb.voteAverage) : match.rating,
          })
        } else {
          // Show TMDB trending item even without a local catalog match
          result.push({
            id: `tmdb-movie-${tmdb.tmdbId}`,
            name: tmdb.title,
            stream_url: '',
            poster: tmdb.posterUrl,
            backdrop: tmdb.backdropUrl,
            plot: tmdb.overview,
            rating: tmdb.voteAverage ? String(tmdb.voteAverage) : undefined,
            year: tmdb.releaseDate?.slice(0, 4),
            playlist_id: '',
            stream_id: undefined,
          } as VodItem)
        }
      }
      return result
    }
    // IMDb RSS fallback
    if (imdbMovies.length > 0) {
      const used = new Set<string>()
      const result: VodItem[] = []
      for (const trendTitle of imdbMovies) {
        const t = (extractBaseTitle(trendTitle) || trendTitle).toLowerCase()
        const match = vods.find((v) => {
          if (used.has(v.id)) return false
          const n = (extractBaseTitle(v.name) || v.name).toLowerCase()
          return matchesTrendingTitle(n, t)
        })
        if (match) { used.add(match.id); result.push(match) }
      }
      return result
    }
    return [...vods].sort((a, b) => parseFloat(b.rating || '0') - parseFloat(a.rating || '0')).slice(0, 30)
  }, [vods, tmdbTrendingMovies, imdbMovies])

  const trendingSeries = useMemo(() => {
    if (tmdbTrendingTv.length > 0) {
      const used = new Set<string>()
      const result: Series[] = []
      for (const tmdb of tmdbTrendingTv) {
        const t = (extractBaseTitle(tmdb.title) || tmdb.title).toLowerCase()
        const tYear = tmdb.releaseDate?.slice(0, 4)
        const match = series.find((s) => {
          if (used.has(s.id)) return false
          const n = (extractBaseTitle(s.name) || s.name).toLowerCase()
          if (!matchesTrendingTitle(n, t)) return false
          if (tYear && s.year) {
            if (Math.abs(parseInt(s.year) - parseInt(tYear)) > 1) return false
          }
          return true
        })
        if (match) {
          used.add(match.id)
          result.push({
            ...match,
            poster: tmdb.posterUrl || match.poster,
            backdrop: tmdb.backdropUrl || match.backdrop,
            rating: tmdb.voteAverage ? String(tmdb.voteAverage) : match.rating,
          })
        } else {
          result.push({
            id: `tmdb-tv-${tmdb.tmdbId}`,
            name: tmdb.title,
            poster: tmdb.posterUrl,
            backdrop: tmdb.backdropUrl,
            plot: tmdb.overview,
            rating: tmdb.voteAverage ? String(tmdb.voteAverage) : undefined,
            year: tmdb.releaseDate?.slice(0, 4),
            playlist_id: '',
          } as Series)
        }
      }
      return result
    }
    if (imdbTv.length > 0) {
      const used = new Set<string>()
      const result: Series[] = []
      for (const trendTitle of imdbTv) {
        const t = (extractBaseTitle(trendTitle) || trendTitle).toLowerCase()
        const match = series.find((s) => {
          if (used.has(s.id)) return false
          const n = (extractBaseTitle(s.name) || s.name).toLowerCase()
          return matchesTrendingTitle(n, t)
        })
        if (match) { used.add(match.id); result.push(match) }
      }
      return result
    }
    return [...series].sort((a, b) => parseFloat(b.rating || '0') - parseFloat(a.rating || '0')).slice(0, 30)
  }, [series, tmdbTrendingTv, imdbTv])

  // Hero items: first 5 from Trending Now — TMDB will supply HD backdrops for each
  const heroItems = useMemo(() => {
    const source = activeTab === 'series' ? trendingSeries : trendingMovies
    return source.slice(0, 5) as (VodItem | Series)[]
  }, [activeTab, trendingMovies, trendingSeries])

  const dedupedVods = useMemo(() => deduplicateItems(vods), [vods])
  const dedupedSeries = useMemo(() => deduplicateItems(series), [series])

  const movieCategories = useMemo(() =>
    groupByExcelCategories(dedupedVods, MOVIE_CATEGORY_ORDER, MOVIE_TITLE_MAP, ['Trending Now', trendingMovies])
  , [dedupedVods, trendingMovies])

  const seriesCategories = useMemo(() =>
    groupByExcelCategories(dedupedSeries, SERIES_CATEGORY_ORDER, SERIES_TITLE_MAP, ['Trending Now', trendingSeries])
  , [dedupedSeries, trendingSeries])

  if (!activePlaylistId) {
    return (
      <div className="home-empty">
        <div className="home-empty-inner">
          <div className="home-empty-icon">📡</div>
          <h2>No playlist added yet</h2>
          <p>Add an Xtream, M3U, or Stalker playlist to get started</p>
          <button className="go-settings-btn" onClick={() => navigate('/settings')}>
            Go to Settings
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="home-screen">
      {heroItems.length > 0 && (
        <HeroBanner
          items={heroItems}
          onSelect={(item) => navigate('stream_url' in item ? '/vod' : '/series', { state: { preSelectedItem: item } })}
        />
      )}

      {/* ── Tab pills ── */}
      <div className="home-tabs">
        {(['favorites', 'movies', 'series'] as HomeTab[]).map((tab) => (
          <button
            key={tab}
            className={`home-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'favorites' ? 'Favorites' : tab === 'movies' ? 'Movies' : 'Series'}
          </button>
        ))}
      </div>

      {/* ── Continue Watching ── */}
      {resumeEntries.length > 0 && (
        <div className="home-rows" style={{ paddingTop: 0 }}>
          <HorizontalRow title="Continue Watching">
            {resumeEntries.slice(0, 20).map((entry) => (
              <ContinueWatchingCard
                key={entry.key}
                entry={entry}
                posterUrl={resolveEntryPoster(entry.key, vods, series) ?? cwTmdbPosters[entry.key] ?? entry.poster_url}
                onClick={() => navigate('/player', {
                  state: {
                    url: entry.stream_url,
                    title: entry.title,
                    live: false,
                    resumeKey: entry.key,
                    posterUrl: resolveEntryPoster(entry.key, vods, series) ?? cwTmdbPosters[entry.key] ?? entry.poster_url,
                  },
                })}
                onDismiss={(e) => { e.stopPropagation(); clearEntry(entry.key) }}
              />
            ))}
          </HorizontalRow>
        </div>
      )}

      {/* ── Favorites tab ── */}
      {activeTab === 'favorites' && (
        <div className="home-rows">
          {favorites.length === 0 ? (
            <div className="home-empty-tab">
              <p>Nothing in your list yet. Browse Movies or Series and add items.</p>
            </div>
          ) : (
            <HorizontalRow title="My List" onSeeAll={() => navigate('/mylist')}>
              {favorites.map((fav) => (
                <RowCard
                  key={fav.id}
                  poster={fav.poster}
                  name={fav.name}
                  onClick={() => navigate(fav.type === 'series' ? '/series' : '/vod', { state: { preSelectedId: fav.id } })}
                />
              ))}
            </HorizontalRow>
          )}
        </div>
      )}

      {/* ── Movies tab ── */}
      {activeTab === 'movies' && (
        <div className="home-rows">
          {status === 'loading' && vods.length === 0 ? (
            <div className="home-empty-tab"><p>Loading movies…</p></div>
          ) : movieCategories.length === 0 ? (
            <div className="home-empty-tab"><p>No movies loaded. Add a playlist in Settings.</p></div>
          ) : (
            movieCategories.map(([genre, items]) => (
              <HorizontalRow key={genre} title={genre} onSeeAll={() => navigate('/vod', { state: { category: genre } })}>
                {items.slice(0, 10).map((v) => (
                  <RowCard
                    key={v.id}
                    poster={v.poster}
                    name={v.name}
                    rating={v.rating}
                    versions={'_versions' in v ? (v as { _versions: unknown[] })._versions.length : 1}
                    onClick={() => navigate('/vod', { state: { preSelectedItem: v } })}
                  />
                ))}
              </HorizontalRow>
            ))
          )}
        </div>
      )}

      {/* ── Series tab ── */}
      {activeTab === 'series' && (
        <div className="home-rows">
          {status === 'loading' && series.length === 0 ? (
            <div className="home-empty-tab"><p>Loading series…</p></div>
          ) : seriesCategories.length === 0 ? (
            <div className="home-empty-tab"><p>No series loaded. Add a playlist in Settings.</p></div>
          ) : (
            seriesCategories.map(([genre, items]) => (
              <HorizontalRow key={genre} title={genre} onSeeAll={() => navigate('/series', { state: { category: genre } })}>
                {items.slice(0, 10).map((s) => (
                  <RowCard
                    key={s.id}
                    poster={s.poster}
                    name={s.name}
                    rating={s.rating}
                    versions={'_versions' in s ? (s as { _versions: unknown[] })._versions.length : 1}
                    onClick={() => navigate('/series', { state: { preSelectedItem: s } })}
                  />
                ))}
              </HorizontalRow>
            ))
          )}
        </div>
      )}
    </div>
  )
}
