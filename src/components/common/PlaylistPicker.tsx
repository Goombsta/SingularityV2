import { usePlaylistStore } from '../../store/slices/playlistSlice'
import './PlaylistPicker.css'

export default function PlaylistPicker() {
  const { playlists, activePlaylistId, setActivePlaylist } = usePlaylistStore()

  if (playlists.length <= 1) return null

  return (
    <select
      className="playlist-picker"
      value={activePlaylistId ?? ''}
      onChange={(e) => setActivePlaylist(e.target.value)}
    >
      {playlists.map((p) => (
        <option key={p.id} value={p.id}>{p.name}</option>
      ))}
    </select>
  )
}
