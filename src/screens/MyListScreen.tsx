import { useNavigate } from 'react-router-dom'
import { useUiStore } from '../store/slices/uiSlice'
import './MyListScreen.css'

export default function MyListScreen() {
  const { favorites, removeFavorite } = useUiStore()
  const navigate = useNavigate()

  const handlePlay = (url: string, title: string) => {
    if (url) navigate('/player', { state: { url, title } })
  }

  if (favorites.length === 0) {
    return (
      <div className="mylist-empty">
        <div className="mylist-empty-inner">
          <div style={{ fontSize: 64, marginBottom: 16 }}>☆</div>
          <h2>Your list is empty</h2>
          <p>Add movies, shows, and channels to your list to find them easily</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mylist-screen">
      <div className="screen-header">
        <h1 className="screen-title">My List</h1>
        <span className="mylist-count">{favorites.length} title{favorites.length !== 1 ? 's' : ''} in your list</span>
      </div>

      <div className="mylist-grid">
        {favorites.map((fav) => (
          <div
            key={fav.id}
            className="mylist-card"
            onClick={() => handlePlay('', fav.name)}
          >
            {fav.poster ? (
              <img src={fav.poster} alt={fav.name} className="mylist-poster" />
            ) : (
              <div className="mylist-placeholder">{fav.name.charAt(0)}</div>
            )}
            <div className="mylist-info">
              <span className="mylist-name truncate">{fav.name}</span>
              <button
                className="mylist-remove"
                onClick={(e) => { e.stopPropagation(); removeFavorite(fav.id) }}
                title="Remove from list"
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
