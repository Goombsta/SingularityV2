import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useNavigate } from 'react-router-dom'
import HeroBanner from '../components/common/HeroBanner'
import HorizontalRow from '../components/common/HorizontalRow'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import { useUiStore } from '../store/slices/uiSlice'
import { groupByExcelCategories, deduplicateItems, extractBaseTitle } from '../utils/genreMap'
import { MOVIE_CATEGORY_ORDER, MOVIE_TITLE_MAP } from '../data/movieCategories'
import { SERIES_CATEGORY_ORDER, SERIES_TITLE_MAP } from '../data/seriesCategories'
import type { Series, VodItem } from '../types'
import './HomeScreen.css'

type HomeTab = 'favorites' | 'movies' | 'series'

interface TmdbTrendingItem {
  tmdbId: number; title: string; overview: string
  posterUrl?: string; backdropUrl?: string
  voteAverage: number; releaseDate: string; mediaType: string
}

/** Small card used in carousel rows */
function RowCard({
  poster, name, rating, versions, onClick,
}: { poster?: string; name: string; rating?: string; versions?: number; onClick: () => void }) {
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
      </div>
    </div>
  )
}

export default function HomeScreen() {
  const { activePlaylistId, vods, series, status, fetchVod, fetchSeries } = usePlaylistStore()
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

  // Fetch trending: TMDB if key present, else IMDb RSS fallback
  useEffect(() => {
    const tmdbKey = localStorage.getItem('tmdb_api_key') || ''
    if (tmdbKey) {
      invoke<TmdbTrendingItem[]>('fetch_tmdb_trending', { mediaType: 'movie', apiKey: tmdbKey })
        .then(setTmdbTrendingMovies).catch(() => {})
      invoke<TmdbTrendingItem[]>('fetch_tmdb_trending', { mediaType: 'tv', apiKey: tmdbKey })
        .then(setTmdbTrendingTv).catch(() => {})
    } else {
      invoke<string[]>('fetch_imdb_trending', { mediaType: 'movie' })
        .then(setImdbMovies).catch(() => {})
      invoke<string[]>('fetch_imdb_trending', { mediaType: 'tv' })
        .then(setImdbTv).catch(() => {})
    }
  }, [])

  // Trending: prefer TMDB weekly trending, fall back to IMDb RSS match
  const trendingMovies = useMemo(() => {
    const titleList = tmdbTrendingMovies.length > 0
      ? tmdbTrendingMovies.map((t) => t.title)
      : imdbMovies
    if (titleList.length === 0)
      return [...vods].sort((a, b) => parseFloat(b.rating || '0') - parseFloat(a.rating || '0')).slice(0, 30)
    const used = new Set<string>()
    const result: typeof vods = []
    for (const trendTitle of titleList) {
      const t = (extractBaseTitle(trendTitle) || trendTitle).toLowerCase()
      const match = vods.find((v) => {
        if (used.has(v.id)) return false
        const n = (extractBaseTitle(v.name) || v.name).toLowerCase()
        return n === t || n.includes(t) || t.includes(n)
      })
      if (match) { used.add(match.id); result.push(match) }
    }
    return result
  }, [vods, tmdbTrendingMovies, imdbMovies])

  const trendingSeries = useMemo(() => {
    const titleList = tmdbTrendingTv.length > 0
      ? tmdbTrendingTv.map((t) => t.title)
      : imdbTv
    if (titleList.length === 0)
      return [...series].sort((a, b) => parseFloat(b.rating || '0') - parseFloat(a.rating || '0')).slice(0, 30)
    const used = new Set<string>()
    const result: typeof series = []
    for (const trendTitle of titleList) {
      const t = (extractBaseTitle(trendTitle) || trendTitle).toLowerCase()
      const match = series.find((s) => {
        if (used.has(s.id)) return false
        const n = (extractBaseTitle(s.name) || s.name).toLowerCase()
        return n === t || n.includes(t) || t.includes(n)
      })
      if (match) { used.add(match.id); result.push(match) }
    }
    return result
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
          onSelect={(item) => navigate('stream_url' in item ? '/vod' : '/series', { state: { preSelectedId: item.id } })}
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
                {items.slice(0, 30).map((v) => (
                  <RowCard
                    key={v.id}
                    poster={v.poster}
                    name={v.name}
                    rating={v.rating}
                    versions={'_versions' in v ? (v as { _versions: unknown[] })._versions.length : 1}
                    onClick={() => navigate('/vod', { state: { preSelectedId: v.id } })}
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
                {items.slice(0, 30).map((s) => (
                  <RowCard
                    key={s.id}
                    poster={s.poster}
                    name={s.name}
                    rating={s.rating}
                    versions={'_versions' in s ? (s as { _versions: unknown[] })._versions.length : 1}
                    onClick={() => navigate('/series', { state: { preSelectedId: s.id } })}
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
