import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import PlaylistPicker from '../components/common/PlaylistPicker'
import HorizontalRow from '../components/common/HorizontalRow'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import { useUiStore } from '../store/slices/uiSlice'
import { groupByExcelCategories, deduplicateItems, extractBaseTitle } from '../utils/genreMap'
import { SERIES_CATEGORY_ORDER, SERIES_TITLE_MAP } from '../data/seriesCategories'
import type { VersionedItem } from '../utils/genreMap'
import type { Episode, FavoriteItem, Series, SeriesInfo } from '../types'
import './SeriesScreen.css'

export default function SeriesScreen() {
  const { activePlaylistId, series, fetchSeries, fetchSeriesInfo, status } = usePlaylistStore()
  const { addFavorite, removeFavorite, isFavorite } = useUiStore()
  const [search, setSearch] = useState('')
  const [imdbTv, setImdbTv] = useState<string[]>([])
  const [tmdbTrendingTv, setTmdbTrendingTv] = useState<{ title: string }[]>([])
  const [selected, setSelected] = useState<SeriesInfo | null>(null)
  const [selectedVersions, setSelectedVersions] = useState<Array<Series & { _region: string }>>([])
  const [selectedRegion, setSelectedRegion] = useState<string>('Default')
  const [selectedSeason, setSelectedSeason] = useState<string>('1')
  const [loadingInfo, setLoadingInfo] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const routeState = location.state as { preSelectedId?: string } | null

  useEffect(() => {
    if (activePlaylistId) fetchSeries(activePlaylistId)
  }, [activePlaylistId, fetchSeries])

  useEffect(() => {
    const tmdbKey = localStorage.getItem('tmdb_api_key') || ''
    if (tmdbKey) {
      invoke<{ title: string }[]>('fetch_tmdb_trending', { mediaType: 'tv', apiKey: tmdbKey })
        .then(setTmdbTrendingTv).catch(() => {})
    } else {
      invoke<string[]>('fetch_imdb_trending', { mediaType: 'tv' })
        .then(setImdbTv).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (routeState?.preSelectedId && series.length > 0) {
      const found = series.find((s) => s.id === routeState.preSelectedId)
      if (found) handleSelectSeries(found)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState, series])

  const filtered = useMemo(() => {
    if (!search) return series
    return series.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
  }, [series, search])

  const deduped = useMemo(() => deduplicateItems(filtered), [filtered])
  const byGenre = useMemo(() => {
    const trending = [...deduped]
      .filter((i) => i.rating && parseFloat(i.rating) > 0)
      .sort((a, b) => parseFloat(b.rating || '0') - parseFloat(a.rating || '0'))
      .slice(0, 30)
    return groupByExcelCategories(deduped, SERIES_CATEGORY_ORDER, SERIES_TITLE_MAP, ['Trending Now', trending])
  }, [deduped])

  const byGenreWithTrending = useMemo(() => {
    const titleList = tmdbTrendingTv.length > 0
      ? tmdbTrendingTv.map((t) => t.title)
      : imdbTv
    if (titleList.length === 0) return byGenre
    const used = new Set<string>()
    const trending: typeof series = []
    for (const trendTitle of titleList) {
      const t = (extractBaseTitle(trendTitle) || trendTitle).toLowerCase()
      const match = series.find((s) => {
        if (used.has(s.id)) return false
        const n = (extractBaseTitle(s.name) || s.name).toLowerCase()
        return n === t || n.includes(t) || t.includes(n)
      })
      if (match) { used.add(match.id); trending.push(match) }
    }
    return byGenre.map(([cat, items]) =>
      cat === 'Trending Now' ? [cat, trending] as [typeof cat, typeof items] : [cat, items] as [typeof cat, typeof items]
    )
  }, [byGenre, series, tmdbTrendingTv, imdbTv])

  const similar = useMemo(() => {
    if (!selected || !selected.series.genre) return []
    return series
      .filter((s) => s.id !== selected.series.id && s.genre === selected.series.genre)
      .sort((a, b) => parseInt(b.year || '0') - parseInt(a.year || '0'))
      .slice(0, 20)
  }, [selected, series])

  const handleSelectSeries = async (s: Series | VersionedItem<Series>, keepVersions?: boolean) => {
    if (!activePlaylistId || !s.series_id) return
    setLoadingInfo(true)
    try {
      const info = await fetchSeriesInfo(activePlaylistId, s.series_id)
      setSelected(info)
      if (!keepVersions) {
        const versions = '_versions' in s
          ? (s as VersionedItem<Series>)._versions
          : [{ ...s, _region: 'Default' }]
        setSelectedVersions(versions)
        setSelectedRegion('_region' in s ? (s as Series & { _region: string })._region : 'Default')
      }
      const firstSeason = Object.keys(info.seasons).sort((a, b) => Number(a) - Number(b))[0] ?? '1'
      setSelectedSeason(firstSeason)
      window.scrollTo(0, 0)
    } finally {
      setLoadingInfo(false)
    }
  }

  const playEpisode = (ep: Episode) => {
    navigate('/player', {
      state: { url: ep.stream_url, title: `${selected?.series.name} S${ep.season}E${ep.episode_num}`, live: false },
    })
  }

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selected) {
    const { series: s, seasons } = selected
    const backdrop = s.backdrop || s.poster
    const seasonNums = Object.keys(seasons).sort((a, b) => Number(a) - Number(b))
    const episodes = (seasons[selectedSeason] ?? []).sort((a, b) => a.episode_num - b.episode_num)
    const fav = isFavorite(s.id)

    const toggleFav = () => {
      const item: FavoriteItem = { id: s.id, name: s.name, type: 'series', poster: s.poster, playlist_id: s.playlist_id }
      fav ? removeFavorite(s.id) : addFavorite(item)
    }

    return (
      <div className="detail-screen">
        {backdrop && (
          <div className="detail-backdrop-full">
            <img src={backdrop} alt="" className="detail-backdrop-img" />
            <div className="detail-backdrop-overlay" />
          </div>
        )}

        <div className="detail-body">
          <button className="detail-back" onClick={() => setSelected(null)}>← Back</button>

          <div className="detail-hero">
            {s.poster && <img src={s.poster} alt={s.name} className="detail-poster" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />}
            <div className="detail-meta">
              <h1 className="detail-title">{extractBaseTitle(s.name) || s.name}</h1>

              {selectedVersions.length > 1 && (
                <div className="detail-version-row">
                  <span className="detail-version-label">Version:</span>
                  <select
                    className="detail-version-select"
                    value={selectedRegion}
                    onChange={(e) => {
                      const v = selectedVersions.find((x) => x._region === e.target.value)
                      if (v) { setSelectedRegion(e.target.value); handleSelectSeries(v, true) }
                    }}
                  >
                    {selectedVersions.map((v) => (
                      <option key={v._region + v.id} value={v._region}>{v._region}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="detail-badges">
                {s.year && <span className="detail-badge">{s.year.slice(0, 4)}</span>}
                {s.rating && <span className="detail-badge">★ {parseFloat(s.rating).toFixed(1)}</span>}
                {s.genre && <span className="detail-badge">{s.genre}</span>}
                <span className="detail-badge">Series</span>
              </div>
              {s.plot && <p className="detail-plot">{s.plot}</p>}
              <div className="detail-actions">
                <select
                  className="season-select-pill"
                  value={selectedSeason}
                  onChange={(e) => setSelectedSeason(e.target.value)}
                >
                  {seasonNums.map((n) => (
                    <option key={n} value={n}>Season {n}</option>
                  ))}
                </select>
                <button className={`detail-pill-btn ${fav ? 'fav-active' : ''}`} onClick={toggleFav}>
                  {fav ? '★ In Favorites' : '☆ Add to Favorites'}
                </button>
              </div>
            </div>
          </div>

          <div className="detail-episodes-section">
            <h3 className="detail-section-title">Episodes — Season {selectedSeason}</h3>
            <div className="episode-list">
              {episodes.map((ep) => (
                <div key={ep.id} className="episode-item" onClick={() => playEpisode(ep)}>
                  {ep.poster
                    ? <img src={ep.poster} alt="" className="ep-thumb" />
                    : <div className="ep-thumb-placeholder">E{ep.episode_num}</div>
                  }
                  <div className="ep-info">
                    <span className="ep-num">E{ep.episode_num}</span>
                    <div>
                      <p className="ep-title">{ep.title}</p>
                      {ep.plot && <p className="ep-plot">{ep.plot.slice(0, 120)}…</p>}
                    </div>
                  </div>
                  <button className="ep-play">▶</button>
                </div>
              ))}
            </div>
          </div>

          {similar.length > 0 && (
            <div className="detail-similar">
              <HorizontalRow title="Similar Series">
                {similar.map((sim) => (
                  <div key={sim.id} className="sim-card" onClick={() => handleSelectSeries(sim)}>
                    {sim.poster
                      ? <img src={sim.poster} alt={sim.name} className="sim-poster" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      : <div className="sim-placeholder">{sim.name.charAt(0)}</div>
                    }
                    <p className="sim-name truncate">{sim.name}</p>
                  </div>
                ))}
              </HorizontalRow>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Carousel view ──────────────────────────────────────────────────────────
  return (
    <div className="series-screen">
      <div className="series-header">
        <div className="series-header-left">
          <h1 className="screen-title">Series</h1>
          <PlaylistPicker />
        </div>
        <input
          className="search-input"
          placeholder="Search series…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {status === 'loading' || loadingInfo ? (
        <div className="screen-loading">Loading…</div>
      ) : (
        <div className="series-rows">
          {byGenreWithTrending.map(([genre, items]) => (
            <HorizontalRow key={genre} title={genre}>
              {items.slice(0, 30).map((s) => {
                const title = extractBaseTitle(s.name) || s.name
                const versionCount = '_versions' in s ? (s as VersionedItem<typeof s>)._versions.length : 1
                return (
                  <div key={s.id} className="series-row-card" onClick={() => handleSelectSeries(s)}>
                    <div className="series-row-img-wrap">
                      {s.poster
                        ? <img src={s.poster} alt={title} className="series-row-poster" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        : <div className="series-row-placeholder">{title.charAt(0)}</div>
                      }
                      <div className="series-row-hover">▶</div>
                      {s.rating && <span className="series-row-rating">★ {parseFloat(s.rating).toFixed(1)}</span>}
                      {versionCount > 1 && <span className="vod-row-versions">{versionCount} ver.</span>}
                    </div>
                    <p className="series-row-name truncate">{title}</p>
                  </div>
                )
              })}
            </HorizontalRow>
          ))}
        </div>
      )}
    </div>
  )
}
