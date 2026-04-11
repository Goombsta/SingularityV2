import { useMemo, useState } from 'react'
import PosterCard from '../components/common/PosterCard'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import './SearchScreen.css'

export default function SearchScreen() {
  const [query, setQuery] = useState('')
  const { channels, vods, series } = usePlaylistStore()

  const results = useMemo(() => {
    if (query.trim().length < 2) return { channels: [], vods: [], series: [] }
    const q = query.toLowerCase()
    return {
      channels: channels.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 20),
      vods: vods.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 20),
      series: series.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 20),
    }
  }, [query, channels, vods, series])

  const total = results.channels.length + results.vods.length + results.series.length

  return (
    <div className="search-screen">
      <div className="search-bar-wrap">
        <input
          className="search-bar"
          placeholder="Search channels, movies, series…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {query.length < 2 && (
        <div className="search-hint">Type at least 2 characters to search</div>
      )}

      {query.length >= 2 && total === 0 && (
        <div className="search-hint">No results for "{query}"</div>
      )}

      {results.channels.length > 0 && (
        <div className="search-section">
          <h3 className="search-section-title">Live TV</h3>
          <div className="search-results">
            {results.channels.map((c) => (
              <PosterCard key={c.id} item={c} itemType="channel" aspectRatio="wide" />
            ))}
          </div>
        </div>
      )}

      {results.vods.length > 0 && (
        <div className="search-section">
          <h3 className="search-section-title">Movies</h3>
          <div className="search-results">
            {results.vods.map((v) => (
              <PosterCard key={v.id} item={v} itemType="vod" />
            ))}
          </div>
        </div>
      )}

      {results.series.length > 0 && (
        <div className="search-section">
          <h3 className="search-section-title">Series</h3>
          <div className="search-results">
            {results.series.map((s) => (
              <PosterCard key={s.id} item={s} itemType="series" />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
