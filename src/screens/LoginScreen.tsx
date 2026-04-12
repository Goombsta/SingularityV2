import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import './LoginScreen.css'

type PlaylistType = 'xtream' | 'm3u' | 'stalker'

export default function LoginScreen() {
  const navigate = useNavigate()
  const { addXtream, addM3u, addStalker, status } = usePlaylistStore()

  const [type, setType] = useState<PlaylistType>('xtream')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [mac, setMac] = useState('')
  const [error, setError] = useState<string | null>(null)

  const loading = status === 'loading'

  const handleConnect = async () => {
    setError(null)
    const displayName = name.trim() || 'My Playlist'
    try {
      if (type === 'xtream') {
        if (!url.trim() || !username.trim() || !password.trim()) {
          setError('Please fill in all fields'); return
        }
        await addXtream(displayName, url.trim(), username.trim(), password.trim())
      } else if (type === 'm3u') {
        if (!url.trim()) { setError('Please enter a URL'); return }
        await addM3u(displayName, url.trim())
      } else {
        if (!url.trim() || !mac.trim()) {
          setError('Please fill in all fields'); return
        }
        await addStalker(displayName, url.trim(), mac.trim())
      }
      navigate('/', { replace: true })
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-logo">SINGULARITY DEUX</div>
        <p className="login-subtitle">Add your playlist to get started</p>

        {/* Type selector */}
        <div className="login-type-tabs">
          {(['xtream', 'm3u', 'stalker'] as PlaylistType[]).map((t) => (
            <button
              key={t}
              className={`login-type-tab ${type === t ? 'active' : ''}`}
              onClick={() => { setType(t); setError(null) }}
            >
              {t === 'xtream' ? 'Xtream' : t === 'm3u' ? 'M3U' : 'Stalker'}
            </button>
          ))}
        </div>

        {/* Fields */}
        <div className="login-fields">
          <input
            className="login-input"
            placeholder="Playlist name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <input
            className="login-input"
            placeholder={type === 'stalker' ? 'Portal URL' : type === 'm3u' ? 'M3U URL' : 'Server URL'}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />

          {type === 'xtream' && (
            <>
              <input
                className="login-input"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
              <input
                className="login-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </>
          )}

          {type === 'stalker' && (
            <input
              className="login-input"
              placeholder="MAC Address"
              value={mac}
              onChange={(e) => setMac(e.target.value)}
            />
          )}
        </div>

        {error && <p className="login-error">{error}</p>}

        <button
          className="login-connect-btn"
          onClick={handleConnect}
          disabled={loading}
        >
          {loading ? 'Connecting...' : 'Connect'}
        </button>
      </div>
    </div>
  )
}
