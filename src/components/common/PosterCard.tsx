import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUiStore } from '../../store/slices/uiSlice'
import type { Channel, FavoriteItem, Series, VodItem } from '../../types'
import './PosterCard.css'

type CardItem = Channel | VodItem | Series

interface PosterCardProps {
  item: CardItem
  itemType: 'channel' | 'vod' | 'series'
  epgTitle?: string
  onPlay?: () => void
  onSelect?: (item: CardItem) => void
  aspectRatio?: 'poster' | 'wide'
}

export default function PosterCard({
  item,
  itemType,
  epgTitle,
  onPlay,
  onSelect,
  aspectRatio = 'poster',
}: PosterCardProps) {
  const [imgError, setImgError] = useState(false)
  const navigate = useNavigate()
  const { addFavorite, removeFavorite, isFavorite } = useUiStore()
  const fav = isFavorite(item.id)

  const poster = 'poster' in item ? item.poster : 'logo' in item ? item.logo : undefined
  const rating = 'rating' in item ? item.rating : undefined

  const handleCardClick = () => {
    if (onSelect) {
      onSelect(item)
      return
    }
    if (onPlay) {
      onPlay()
      return
    }
    // Channels play immediately; VOD/series should use onSelect from parent
    const url = 'stream_url' in item ? item.stream_url : ''
    navigate('/player', { state: { url, title: item.name, playlistId: item.playlist_id } })
  }

  const handlePlayClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onPlay) { onPlay(); return }
    const url = 'stream_url' in item ? item.stream_url : ''
    navigate('/player', { state: { url, title: item.name, playlistId: item.playlist_id } })
  }

  const toggleFav = (e: React.MouseEvent) => {
    e.stopPropagation()
    const favItem: FavoriteItem = {
      id: item.id,
      name: item.name,
      type: itemType,
      poster,
      playlist_id: item.playlist_id,
    }
    fav ? removeFavorite(item.id) : addFavorite(favItem)
  }

  return (
    <div className={`poster-card ${aspectRatio}`} onClick={handleCardClick}>
      <div className="poster-img-wrap">
        {poster && !imgError ? (
          <img src={poster} alt={item.name} onError={() => setImgError(true)} loading="lazy" />
        ) : (
          <div className="poster-placeholder">
            <span>{item.name.charAt(0)}</span>
          </div>
        )}
        <div className="poster-overlay">
          <button className="play-btn" onClick={handlePlayClick}>▶</button>
        </div>
        {rating && <div className="rating-badge">★ {parseFloat(rating).toFixed(1)}</div>}
        <button className={`fav-btn ${fav ? 'active' : ''}`} onClick={toggleFav}>
          {fav ? '★' : '☆'}
        </button>
      </div>

      <div className="poster-info">
        <p className="poster-title truncate">{item.name}</p>
        {epgTitle && <p className="poster-epg truncate">{epgTitle}</p>}
      </div>
    </div>
  )
}
