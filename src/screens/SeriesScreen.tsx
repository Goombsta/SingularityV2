import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import PlaylistPicker from '../components/common/PlaylistPicker'
import HorizontalRow from '../components/common/HorizontalRow'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import { useUiStore } from '../store/slices/uiSlice'
import { groupByExcelCategories, deduplicateItems, extractBaseTitle, matchesTrendingTitle, mapGenre } from '../utils/genreMap'
import { SERIES_CATEGORY_ORDER, SERIES_TITLE_MAP } from '../data/seriesCategories'
import type { VersionedItem } from '../utils/genreMap'
import type { Episode, FavoriteItem, Series, SeriesInfo } from '../types'
import './SeriesScreen.css'

export default function SeriesScreen() {
  const { activePlaylistId, series, fetchSeries, fetchSeriesInfo, status } = usePlaylistStore()
  const { addFavorite, removeFavorite, isFavorite } = useUiStore()
  const [search, setSearch] = useState('')
  const [tmdbTrendingTv, setTmdbTrendingTv] = useState<{ title: string; tmdbId?: number; releaseDate?: string }[]>([])
  const [similarTmdb, setSimilarTmdb] = useState<{ tmdbId: number; title: string; overview: string; posterUrl?: string; backdropUrl?: string; voteAverage: number; releaseDate: string }[]>([])
  const [tmdbEpisodes, setTmdbEpisodes] = useState<Map<number, { name: string; overview: string; stillUrl?: string; runtime?: number }>>(new Map())
  const [seriesTmdbId, setSeriesTmdbId] = useState<number | null>(null)
  const [selected, setSelected] = useState<SeriesInfo | null>(null)
  const [selectedVersions, setSelectedVersions] = useState<Array<Series & { _region: string }>>([])
  const [selectedRegion, setSelectedRegion] = useState<string>('Default')
  const [selectedSeason, setSelectedSeason] = useState<string>('1')
  const [loadingInfo, setLoadingInfo] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const routeState = location.state as { preSelectedId?: string; preSelectedItem?: Series } | null

  useEffect(() => {
    if (activePlaylistId) fetchSeries(activePlaylistId)
  }, [activePlaylistId, fetchSeries])

  useEffect(() => {
    invoke<{ title: string }[]>('fetch_tmdb_trending', { mediaType: 'tv' })
      .then(setTmdbTrendingTv).catch(() => {})
  }, [])

  // Re-fetch TMDB episodes when season changes
  useEffect(() => {
    if (!seriesTmdbId || !selectedSeason) return
    setTmdbEpisodes(new Map())
    invoke<{ episodeNumber: number; name: string; overview: string; stillUrl?: string; runtime?: number }[]>(
      'fetch_tmdb_season', { tmdbId: seriesTmdbId, seasonNumber: Number(selectedSeason) }
    ).then((eps) => {
      const map = new Map<number, { name: string; overview: string; stillUrl?: string; runtime?: number }>()
      for (const e of eps) map.set(e.episodeNumber, e)
      setTmdbEpisodes(map)
    }).catch(() => {})
  }, [seriesTmdbId, selectedSeason])

  // Direct item passed via navigation state — no catalog lookup needed
  useEffect(() => {
    if (routeState?.preSelectedItem) handleSelectSeries(routeState.preSelectedItem)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState])

  // Catalog id passed via navigation (e.g. favorites) — wait for series to load
  useEffect(() => {
    if (routeState?.preSelectedItem) return // handled above
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
    if (tmdbTrendingTv.length > 0) {
      const used = new Set<string>()
      const trending: typeof series = []
      for (const tmdbItem of tmdbTrendingTv) {
        const t = (extractBaseTitle(tmdbItem.title) || tmdbItem.title).toLowerCase()
        const tYear = tmdbItem.releaseDate?.slice(0, 4)
        const match = series.find((s) => {
          if (used.has(s.id)) return false
          const n = (extractBaseTitle(s.name) || s.name).toLowerCase()
          if (!matchesTrendingTitle(n, t)) return false
          if (tYear && s.year) {
            if (Math.abs(parseInt(s.year) - parseInt(tYear)) > 1) return false
          }
          return true
        })
        if (match) { used.add(match.id); trending.push(match) }
      }
      return byGenre.map(([cat, items]) =>
        cat === 'Trending Now' ? [cat, trending] as [typeof cat, typeof items] : [cat, items] as [typeof cat, typeof items]
      )
    }
    return byGenre
  }, [byGenre, series, tmdbTrendingTv])

  const similar = useMemo(() => {
    if (!selected) return []

    // Tier 1: TMDB curated recommendations
    if (similarTmdb.length > 0) {
      const used = new Set<string>()
      const rows: Series[] = []
      for (const s of similarTmdb) {
        const t = (extractBaseTitle(s.title) || s.title).toLowerCase()
        const tYear = s.releaseDate?.slice(0, 4)
        const match = series.find((v) => {
          if (used.has(v.id) || v.id === selected.series.id) return false
          const n = (extractBaseTitle(v.name) || v.name).toLowerCase()
          if (!matchesTrendingTitle(n, t)) return false
          if (tYear && v.year) {
            if (Math.abs(parseInt(v.year) - parseInt(tYear)) > 1) return false
          }
          return true
        })
        if (match) {
          used.add(match.id)
          rows.push({ ...match, poster: s.posterUrl || match.poster, rating: s.voteAverage ? String(s.voteAverage) : match.rating })
        }
        if (rows.length >= 20) break
      }
      if (rows.length > 0) return rows
    }

    // Tier 2: mapGenre category fallback
    const selCat = mapGenre(selected.series.genre) ?? mapGenre(selected.series.name)
    if (selCat) {
      return series
        .filter((s) => s.id !== selected.series.id && (mapGenre(s.genre) ?? mapGenre(s.name)) === selCat)
        .sort((a, b) => parseInt(b.year || '0') - parseInt(a.year || '0'))
        .slice(0, 20)
    }
    return []
  }, [selected, similarTmdb, series])

  const handleSelectSeries = async (s: Series | VersionedItem<Series>, keepVersions?: boolean) => {
    if (!activePlaylistId || !s.series_id) return
    setLoadingInfo(true)
    setSimilarTmdb([])
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

      // Fetch TMDB metadata + similar + season episodes in background
      ;(async () => {
        try {
          const cleanName = extractBaseTitle(info.series.name) || info.series.name
          const meta = await invoke<{ tmdbId: number }>('fetch_tmdb', {
            title: cleanName, year: info.series.year ?? null, mediaType: 'tv',
          })
          setSeriesTmdbId(meta.tmdbId)
          invoke<typeof similarTmdb>('fetch_tmdb_similar', {
            tmdbId: meta.tmdbId, mediaType: 'tv',
          }).then(setSimilarTmdb).catch(() => {})
          invoke<{ episodeNumber: number; name: string; overview: string; stillUrl?: string; runtime?: number }[]>(
            'fetch_tmdb_season', { tmdbId: meta.tmdbId, seasonNumber: Number(firstSeason) }
          ).then((eps) => {
            const map = new Map<number, { name: string; overview: string; stillUrl?: string; runtime?: number }>()
            for (const e of eps) map.set(e.episodeNumber, e)
            setTmdbEpisodes(map)
          }).catch(() => {})
        } catch { /* title not found */ }
      })()
    } finally {
      setLoadingInfo(false)
    }
  }

  const playEpisode = (ep: Episode) => {
    navigate('/player', {
      state: {
        url: ep.stream_url,
        title: `${selected?.series.name} S${ep.season}E${ep.episode_num}`,
        live: false,
        resumeKey: `playlist:${selected?.series.playlist_id}:series:${selected?.series.id}:episode:${ep.id}`,
        posterUrl: selected?.series.poster ?? ep.poster,
        seriesSeasons: selected?.seasons,
        currentEpisodeId: ep.id,
        seriesName: selected?.series.name,
        seriesId: selected?.series.id,
        seriesPlaylistId: selected?.series.playlist_id,
        seriesPoster: selected?.series.poster,
      },
    })
  }

  // ── Episode carousel drag-to-scroll ────────────────────────────────────────
  const epListRef = useRef<HTMLDivElement>(null)
  const dragState = useRef({ down: false, startX: 0, scrollLeft: 0, moved: false })

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    const el = epListRef.current
    if (!el) return
    dragState.current = { down: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft, moved: false }
    el.style.cursor = 'grabbing'
  }, [])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.current.down) return
    e.preventDefault()
    const el = epListRef.current
    if (!el) return
    const x = e.pageX - el.offsetLeft
    const walk = x - dragState.current.startX
    if (Math.abs(walk) > 3) dragState.current.moved = true
    el.scrollLeft = dragState.current.scrollLeft - walk
  }, [])

  const onMouseUp = useCallback(() => {
    dragState.current.down = false
    const el = epListRef.current
    if (el) el.style.cursor = 'grab'
  }, [])

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
          <button className="detail-back" onClick={() => {
            if (routeState?.preSelectedItem || routeState?.preSelectedId) {
              navigate(-1)
            } else {
              setSelected(null)
              setSeriesTmdbId(null)
              setTmdbEpisodes(new Map())
              setSimilarTmdb([])
            }
          }}>← Back</button>

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
            <div
              className="episode-list"
              ref={epListRef}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
            >
              {episodes.map((ep) => {
                const tmdbEp = tmdbEpisodes.get(ep.episode_num)
                const thumb = tmdbEp?.stillUrl || ep.poster
                const title = tmdbEp?.name || ep.title
                const overview = tmdbEp?.overview || ep.plot
                const runtime = tmdbEp?.runtime ?? (ep.duration ? Math.round(ep.duration / 60) : undefined)
                return (
                  <div key={ep.id} className="episode-card" onClick={() => { if (!dragState.current.moved) playEpisode(ep) }}>
                    <div className="ep-card-thumb-wrap">
                      {thumb
                        ? <img src={thumb} alt="" className="ep-card-thumb" />
                        : <div className="ep-card-thumb-placeholder">E{ep.episode_num}</div>
                      }
                      <span className="ep-card-badge">E{ep.episode_num}</span>
                      <div className="ep-card-play">▶ Play</div>
                    </div>
                    <div className="ep-card-body">
                      <p className="ep-card-title">{title}</p>
                      {overview && <p className="ep-card-overview">{overview}</p>}
                      {runtime && <span className="ep-card-runtime">{runtime} min</span>}
                    </div>
                  </div>
                )
              })}
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
