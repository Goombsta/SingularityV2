import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-shell'
import PlaylistPicker from '../components/common/PlaylistPicker'
import HorizontalRow from '../components/common/HorizontalRow'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import { useUiStore } from '../store/slices/uiSlice'
import { groupByExcelCategories, deduplicateItems, extractBaseTitle, matchesTrendingTitle, mapGenre } from '../utils/genreMap'
import { MOVIE_CATEGORY_ORDER, MOVIE_TITLE_MAP } from '../data/movieCategories'
import type { VersionedItem } from '../utils/genreMap'
import type { FavoriteItem, VodItem } from '../types'
import './VodScreen.css'

interface OmdbMeta {
  title: string; year: string; rated: string; runtime: string
  genre: string; director: string; actors: string; plot: string
  poster: string; imdbRating: string; awards: string; boxOffice: string
}

interface TmdbTrendingItem {
  tmdbId: number; title: string; overview: string
  posterUrl?: string; backdropUrl?: string
  voteAverage: number; releaseDate?: string; mediaType: string
}

interface TmdbCastMember { name: string; character: string; profileUrl?: string }
interface TmdbMeta {
  tmdbId: number; title: string; tagline: string; overview: string
  posterUrl?: string; backdropUrl?: string
  voteAverage: number; voteCount: number
  releaseDate: string; runtimeMins?: number
  genres: string[]; cast: TmdbCastMember[]
  director?: string; trailerKey?: string; mediaType: string
}

export default function VodScreen() {
  const { activePlaylistId, vods, fetchVod, status, enrichVodMetadata } = usePlaylistStore()
  const { addFavorite, removeFavorite, isFavorite } = useUiStore()
  const navigate = useNavigate()
  const location = useLocation()
  const routeState = location.state as { preSelectedId?: string; preSelectedItem?: VodItem; category?: string } | null
  const scrollRef = useRef<HTMLDivElement>(null)
  const savedScroll = useRef(0)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string | null>(routeState?.category ?? null)
  const [selected, setSelected] = useState<VersionedItem<VodItem> | null>(null)
  const [tmdb, setTmdb] = useState<TmdbMeta | null>(null)
  const [omdb, setOmdb] = useState<OmdbMeta | null>(null)
  const [similarTmdb, setSimilarTmdb] = useState<TmdbTrendingItem[]>([])
  const [tmdbTrendingMovies, setTmdbTrendingMovies] = useState<TmdbTrendingItem[]>([])

  useEffect(() => {
    if (activePlaylistId) fetchVod(activePlaylistId)
  }, [activePlaylistId, fetchVod])

  useEffect(() => {
    invoke<TmdbTrendingItem[]>('fetch_tmdb_trending', { mediaType: 'movie' })
      .then(setTmdbTrendingMovies).catch(() => {})
  }, [])

  // Direct item passed via navigation state (TMDB-only or catalog item) — no catalog lookup needed
  useEffect(() => {
    if (routeState?.preSelectedItem) selectVod(routeState.preSelectedItem)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState])

  // Catalog id passed via navigation (e.g. favorites) — wait for vods to load
  useEffect(() => {
    if (routeState?.preSelectedItem) return // handled above
    if (routeState?.preSelectedId && vods.length > 0) {
      const found = vods.find((v) => v.id === routeState.preSelectedId)
      if (found) selectVod(found)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeState, vods])

  const fetchMeta = async (name: string, year?: string, vodId?: string) => {
    setTmdb(null)
    setOmdb(null)
    setSimilarTmdb([])
    try {
      const meta = await invoke<TmdbMeta>('fetch_tmdb', {
        title: name, year: year ?? null, mediaType: 'movie',
      })
      setTmdb(meta)
      if (vodId) enrichVodMetadata(vodId, { poster: meta.posterUrl, backdrop: meta.backdropUrl })
      invoke<TmdbTrendingItem[]>('fetch_tmdb_similar', {
        tmdbId: meta.tmdbId, mediaType: 'movie',
      }).then(setSimilarTmdb).catch(() => {})
      return
    } catch { /* fall through to OMDb */ }
    const omdbKey = await invoke<string | null>('get_credential', { key: 'omdb_api_key' }).catch(() => null) || localStorage.getItem('omdb_api_key') || ''
    if (omdbKey) {
      try {
        const meta = await invoke<OmdbMeta>('fetch_omdb', { title: name, year: year ?? null, apiKey: omdbKey })
        setOmdb(meta)
      } catch { /* skip */ }
    }
  }

  const selectVod = async (v: VodItem | VersionedItem<VodItem>) => {
    savedScroll.current = scrollRef.current?.scrollTop ?? 0
    const versioned = '_versions' in v
      ? (v as VersionedItem<VodItem>)
      : { ...v, _region: 'Default', _versions: [{ ...v, _region: 'Default' }] }
    setSelected(versioned)
    const cleanName = extractBaseTitle(v.name) || v.name
    await fetchMeta(cleanName, v.year, v.id)
  }

  const filtered = useMemo(() => {
    if (!search) return vods
    return vods.filter((v) => v.name.toLowerCase().includes(search.toLowerCase()))
  }, [vods, search])

  const deduped = useMemo(() => deduplicateItems(filtered), [filtered])
  const byGenre = useMemo(() => {
    const trending = [...deduped]
      .filter((i) => i.rating && parseFloat(i.rating) > 0)
      .sort((a, b) => parseFloat(b.rating || '0') - parseFloat(a.rating || '0'))
      .slice(0, 30)
    return groupByExcelCategories(deduped, MOVIE_CATEGORY_ORDER, MOVIE_TITLE_MAP, ['Trending Now', trending])
  }, [deduped])

  const byGenreWithTrending = useMemo(() => {
    if (tmdbTrendingMovies.length > 0) {
      const used = new Set<string>()
      const trending: VodItem[] = []
      for (const tmdb of tmdbTrendingMovies) {
        const t = (extractBaseTitle(tmdb.title) || tmdb.title).toLowerCase()
        const tYear = tmdb.releaseDate?.slice(0, 4)
        const match = vods.find((v) => {
          if (used.has(v.id)) return false
          const n = (extractBaseTitle(v.name) || v.name).toLowerCase()
          if (!matchesTrendingTitle(n, t)) return false
          // Year guard: accept if either side has no year, or within ±1
          if (tYear && v.year) {
            if (Math.abs(parseInt(v.year) - parseInt(tYear)) > 1) return false
          }
          return true
        })
        if (match) {
          used.add(match.id)
          trending.push({
            ...match,
            poster: tmdb.posterUrl || match.poster,
            backdrop: tmdb.backdropUrl || match.backdrop,
            rating: tmdb.voteAverage ? String(tmdb.voteAverage) : match.rating,
          })
        } else {
          trending.push({
            id: `tmdb-movie-${tmdb.tmdbId}`,
            name: tmdb.title,
            stream_url: '',
            poster: tmdb.posterUrl,
            backdrop: tmdb.backdropUrl,
            plot: tmdb.overview,
            rating: tmdb.voteAverage ? String(tmdb.voteAverage) : undefined,
            year: tYear,
            playlist_id: '',
            stream_id: undefined,
          } as VodItem)
        }
      }
      return byGenre.map(([cat, items]) =>
        cat === 'Trending Now' ? [cat, trending] as [typeof cat, typeof items] : [cat, items] as [typeof cat, typeof items]
      )
    }
    return byGenre
  }, [byGenre, vods, tmdbTrendingMovies])

  // ── Category grid (See All) — must be before any early return ─────────────
  const categoryItems = useMemo(() => {
    if (!categoryFilter) return []
    const row = byGenreWithTrending.find(([cat]) => cat === categoryFilter)
    return row ? row[1] : []
  }, [categoryFilter, byGenreWithTrending])

  const similar = useMemo(() => {
    if (!selected) return []

    // ── Tier 1: TMDB curated similar/recommendations ─────────────────────────
    if (similarTmdb.length > 0) {
      const used = new Set<string>()
      const rows: VodItem[] = []
      for (const s of similarTmdb) {
        const t = (extractBaseTitle(s.title) || s.title).toLowerCase()
        const tYear = s.releaseDate?.slice(0, 4)
        const match = vods.find((v) => {
          if (used.has(v.id) || v.id === selected.id) return false
          const n = (extractBaseTitle(v.name) || v.name).toLowerCase()
          if (!matchesTrendingTitle(n, t)) return false
          // Year guard: accept if either side has no year, or years are within ±1
          if (tYear && v.year) {
            if (Math.abs(parseInt(v.year) - parseInt(tYear)) > 1) return false
          }
          return true
        })
        if (match) {
          used.add(match.id)
          rows.push({
            ...match,
            poster: s.posterUrl || match.poster,
            backdrop: s.backdropUrl || match.backdrop,
            rating: s.voteAverage ? String(s.voteAverage) : match.rating,
          })
        } else {
          // TMDB-only similar card (no local stream)
          rows.push({
            id: `tmdb-movie-${s.tmdbId}`,
            name: s.title,
            stream_url: '',
            poster: s.posterUrl,
            backdrop: s.backdropUrl,
            plot: s.overview,
            rating: s.voteAverage ? String(s.voteAverage) : undefined,
            year: s.releaseDate?.slice(0, 4),
            playlist_id: '',
            stream_id: undefined,
          } as VodItem)
        }
        if (rows.length >= 20) break
      }
      return rows
    }

    // ── Tier 2: mapGenre category fallback ───────────────────────────────────
    const selCat = mapGenre(selected.genre) ?? mapGenre(selected.name)
    if (selCat) {
      return vods
        .filter((v) => v.id !== selected.id && (mapGenre(v.genre) ?? mapGenre(v.name)) === selCat)
        .sort((a, b) => parseInt(b.year || '0') - parseInt(a.year || '0'))
        .slice(0, 20)
    }

    return []
  }, [selected, similarTmdb, vods])

  // Switch to a different region version without losing the _versions list
  const switchVersion = async (regionItem: VodItem & { _region: string }) => {
    const versioned: VersionedItem<VodItem> = { ...regionItem, _versions: selected!._versions }
    setSelected(versioned)
    await fetchMeta(regionItem.name, regionItem.year)
  }

  // ── Detail view ──────────────────────────────────────────────────────────────
  if (selected) {
    const fav = isFavorite(selected.id)
    const cleanTitle = extractBaseTitle(selected.name) || selected.name
    const hasVersions = selected._versions.length > 1

    // Prefer TMDB data, fall back to OMDb, then raw playlist data
    const displayPoster  = tmdb?.posterUrl   ?? (omdb?.poster   !== 'N/A' ? omdb?.poster   : undefined) ?? selected.poster
    const displayBackdrop= tmdb?.backdropUrl ?? selected.backdrop ?? selected.poster
    const displayPlot    = (tmdb?.overview && tmdb.overview.length > 0) ? tmdb.overview
                         : (omdb?.plot && omdb.plot !== 'N/A') ? omdb.plot : selected.plot
    const displayRating  = tmdb?.voteAverage
                         ? tmdb.voteAverage.toFixed(1)
                         : (omdb?.imdbRating && omdb.imdbRating !== 'N/A') ? omdb.imdbRating : selected.rating
    const displayGenres  = tmdb?.genres.length ? tmdb.genres
                         : (omdb?.genre && omdb.genre !== 'N/A') ? omdb.genre.split(', ') : selected.genre ? [selected.genre] : []
    const displayDirector= tmdb?.director ?? (omdb?.director !== 'N/A' ? omdb?.director : undefined)
    const displayRuntime = tmdb?.runtimeMins ? `${tmdb.runtimeMins}m`
                         : (omdb?.runtime && omdb.runtime !== 'N/A') ? omdb.runtime
                         : selected.duration ? `${Math.floor(selected.duration / 60)}m` : null
    const year = (tmdb?.releaseDate ?? selected.year ?? '').slice(0, 4)

    const toggleFav = () => {
      const item: FavoriteItem = { id: selected.id, name: selected.name, type: 'vod', poster: selected.poster, playlist_id: selected.playlist_id }
      fav ? removeFavorite(selected.id) : addFavorite(item)
    }

    return (
      <div className="detail-screen">
        {displayBackdrop && (
          <div className="detail-backdrop-full">
            <img src={displayBackdrop} alt="" className="detail-backdrop-img" />
            <div className="detail-backdrop-overlay" />
          </div>
        )}
        <div className="detail-body">
          <button className="detail-back" onClick={() => {
            if (routeState?.preSelectedItem || routeState?.preSelectedId) {
              navigate(-1)
            } else {
              setSelected(null); setTmdb(null); setOmdb(null)
              requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = savedScroll.current })
            }
          }}>← Back</button>
          <div className="detail-hero">
            {displayPoster && (
              <img src={displayPoster} alt={cleanTitle} className="detail-poster" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            )}
            <div className="detail-meta">
              <h1 className="detail-title">{cleanTitle}</h1>
              {tmdb?.tagline && <p className="detail-tagline">{tmdb.tagline}</p>}

              {hasVersions && (
                <div className="detail-version-row">
                  <span className="detail-version-label">Version:</span>
                  <select className="detail-version-select" value={selected._region}
                    onChange={(e) => { const v = selected._versions.find((x) => x._region === e.target.value); if (v) switchVersion(v) }}>
                    {selected._versions.map((v) => (
                      <option key={v._region + v.id} value={v._region}>{v._region}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="detail-badges">
                {year && <span className="detail-badge">{year}</span>}
                {displayRating && <span className="detail-badge">★ {parseFloat(displayRating).toFixed(1)}{tmdb?.voteCount ? ` (${tmdb.voteCount.toLocaleString()})` : ''}</span>}
                {displayRuntime && <span className="detail-badge">{displayRuntime}</span>}
                {displayGenres.slice(0, 3).map((g) => <span key={g} className="detail-badge">{g}</span>)}
              </div>

              {displayDirector && (
                <p className="detail-crew"><span>Director:</span> {displayDirector}</p>
              )}
              {omdb?.actors && omdb.actors !== 'N/A' && !tmdb?.cast.length && (
                <p className="detail-crew"><span>Cast:</span> {omdb.actors}</p>
              )}
              {displayPlot && <p className="detail-plot">{displayPlot}</p>}
              {omdb?.awards && omdb.awards !== 'N/A' && omdb.awards !== 'N/A.' && (
                <p className="detail-awards">🏆 {omdb.awards}</p>
              )}

              <div className="detail-actions">
                {selected.stream_url ? (
                  <button className="detail-pill-btn primary"
                    onClick={() => navigate('/player', { state: { url: selected.stream_url, title: cleanTitle, live: false, resumeKey: `playlist:${selected.playlist_id}:vod:${selected.id}`, posterUrl: displayPoster } })}>
                    ▶ Play
                  </button>
                ) : (
                  <button className="detail-pill-btn primary" disabled title="No local source — not in your playlist">
                    ▶ Not Available
                  </button>
                )}
                {tmdb?.trailerKey && (
                  <button className="detail-pill-btn trailer"
                    onClick={() => open(`https://www.youtube.com/watch?v=${tmdb.trailerKey}`).catch(() => {})}>
                    ▶ Trailer
                  </button>
                )}
                <button className={`detail-fav-btn ${fav ? 'fav-active' : ''}`} onClick={toggleFav}
                  title={fav ? 'Remove from Favorites' : 'Add to Favorites'}>
                  {fav ? '★' : '+'}
                </button>
              </div>
            </div>
          </div>

          {/* Cast row — only shown when TMDB provides cast data */}
          {tmdb && tmdb.cast.length > 0 && (
            <div className="detail-cast">
              <h3 className="detail-cast-heading">Cast</h3>
              <div className="detail-cast-row">
                {tmdb.cast.map((member) => (
                  <div key={member.name + member.character} className="detail-cast-card">
                    {member.profileUrl
                      ? <img src={member.profileUrl} alt={member.name} className="detail-cast-photo" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      : <div className="detail-cast-photo detail-cast-placeholder">{member.name.charAt(0)}</div>
                    }
                    <p className="detail-cast-name">{member.name}</p>
                    {member.character && <p className="detail-cast-char">{member.character}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {similar.length > 0 && (
            <div className="detail-similar">
              <HorizontalRow title="Similar Movies">
                {similar.map((v) => (
                  <div key={v.id} className="sim-card" onClick={() => { selectVod(v); window.scrollTo(0, 0) }}>
                    {v.poster
                      ? <img src={v.poster} alt={v.name} className="sim-poster" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      : <div className="sim-placeholder">{v.name.charAt(0)}</div>
                    }
                    {v.rating && <span className="sim-rating">★ {parseFloat(v.rating).toFixed(1)}</span>}
                    <p className="sim-name">{extractBaseTitle(v.name) || v.name}</p>
                  </div>
                ))}
              </HorizontalRow>
            </div>
          )}
        </div>
      </div>
    )
  }


  if (categoryFilter) {
    return (
      <div className="vod-screen">
        <div className="vod-header">
          <div className="vod-header-left">
            <button className="detail-back" onClick={() => setCategoryFilter(null)}>← Movies</button>
            <h1 className="screen-title">{categoryFilter}</h1>
          </div>
          <input
            className="search-input"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="vod-category-grid">
          {categoryItems.map((v) => {
            const title = extractBaseTitle(v.name) || v.name
            const versionCount = '_versions' in v ? (v as VersionedItem<typeof v>)._versions.length : 1
            return (
              <div key={v.id} className="vod-row-card" onClick={() => selectVod(v)}>
                <div className="vod-row-img-wrap">
                  {v.poster
                    ? <img src={v.poster} alt={title} className="vod-row-poster" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    : <div className="vod-row-placeholder">{title.charAt(0)}</div>
                  }
                  <div className="vod-row-hover">▶</div>
                  {v.rating && <span className="vod-row-rating">★ {parseFloat(v.rating).toFixed(1)}</span>}
                  {versionCount > 1 && <span className="vod-row-versions">{versionCount} ver.</span>}
                  <p className="vod-row-name">{title}</p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  // ── Carousel view ──────────────────────────────────────────────────────────
  return (
    <div className="vod-screen" ref={scrollRef}>
      <div className="vod-header">
        <div className="vod-header-left">
          <h1 className="screen-title">Movies</h1>
          <PlaylistPicker />
        </div>
        <input
          className="search-input"
          placeholder="Search movies…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {status === 'loading' ? (
        <div className="screen-loading">Loading movies…</div>
      ) : (
        <div className="vod-rows">
          {byGenreWithTrending.map(([genre, items]) => (
            <HorizontalRow key={genre} title={genre} onSeeAll={() => setCategoryFilter(genre)}>
              {items.slice(0, 30).map((v) => {
                const title = extractBaseTitle(v.name) || v.name
                const versionCount = '_versions' in v ? (v as VersionedItem<typeof v>)._versions.length : 1
                return (
                  <div key={v.id} className="vod-row-card" onClick={() => selectVod(v)}>
                    <div className="vod-row-img-wrap">
                      {v.poster
                        ? <img src={v.poster} alt={title} className="vod-row-poster" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        : <div className="vod-row-placeholder">{title.charAt(0)}</div>
                      }
                      <div className="vod-row-hover">▶</div>
                      {v.rating && <span className="vod-row-rating">★ {parseFloat(v.rating).toFixed(1)}</span>}
                      {versionCount > 1 && <span className="vod-row-versions">{versionCount} ver.</span>}
                      {!v.stream_url && <span className="vod-row-tmdb-badge">TMDB</span>}
                    </div>
                    <p className="vod-row-name truncate">{title}</p>
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
