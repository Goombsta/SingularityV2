import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { platform } from '@tauri-apps/plugin-os'
import { usePlaylistStore } from '../store/slices/playlistSlice'
import { useEpgStore } from '../store/slices/epgSlice'
import type { Playlist } from '../types'
import './SettingsScreen.css'

type Tab = 'playlists' | 'epg' | 'integrations' | 'about'
type AddMode = 'xtream' | 'm3u' | 'stalker' | null

function expiryLabel(expiry: string): { text: string; expired: boolean } {
  const d = new Date(expiry)
  if (isNaN(d.getTime())) return { text: expiry, expired: false }
  const now = new Date()
  const expired = d < now
  return {
    text: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    expired,
  }
}

export default function SettingsScreen() {
  const [tab, setTab] = useState<Tab>('playlists')
  const [addMode, setAddMode] = useState<AddMode>(null)

  return (
    <div className="settings-screen">
      <h1 className="screen-title" style={{ padding: '0 0 20px' }}>Settings</h1>

      <div className="settings-tabs">
        <button className={`settings-tab ${tab === 'playlists' ? 'active' : ''}`} onClick={() => setTab('playlists')}>
          Playlists
        </button>
        <button className={`settings-tab ${tab === 'epg' ? 'active' : ''}`} onClick={() => setTab('epg')}>
          EPG Sources
        </button>
        <button className={`settings-tab ${tab === 'integrations' ? 'active' : ''}`} onClick={() => setTab('integrations')}>
          Integrations
        </button>
        <button className={`settings-tab ${tab === 'about' ? 'active' : ''}`} onClick={() => setTab('about')}>
          About
        </button>
      </div>

      {tab === 'playlists' && <PlaylistSettings addMode={addMode} setAddMode={setAddMode} />}
      {tab === 'epg' && <EpgSettings />}
      {tab === 'integrations' && <IntegrationsSettings />}
      {tab === 'about' && <AboutSettings />}
    </div>
  )
}

function PlaylistSettings({ addMode, setAddMode }: {
  addMode: AddMode
  setAddMode: (m: AddMode) => void
}) {
  const { playlists, removePlaylist, updatePlaylist, refreshPlaylistExpiry, activePlaylistId, setActivePlaylist } = usePlaylistStore()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  return (
    <div className="settings-section">
      {/* Add buttons */}
      {!addMode && (
        <div className="add-buttons">
          <button className="add-btn" onClick={() => setAddMode('xtream')}>+ Xtream Codes</button>
          <button className="add-btn" onClick={() => setAddMode('m3u')}>+ M3U / M3U8</button>
          <button className="add-btn" onClick={() => setAddMode('stalker')}>+ Stalker Portal</button>
        </div>
      )}

      {addMode === 'xtream' && <AddXtreamForm onClose={() => setAddMode(null)} />}
      {addMode === 'm3u' && <AddM3UForm onClose={() => setAddMode(null)} />}
      {addMode === 'stalker' && <AddStalkerForm onClose={() => setAddMode(null)} />}

      {/* Playlist list */}
      <div className="playlist-list">
        {playlists.length === 0 && (
          <p className="settings-empty">No playlists added yet. Add one above to get started.</p>
        )}
        {playlists.map((p) => (
          <div key={p.id} className={`playlist-item ${p.id === activePlaylistId ? 'active' : ''}`}>
            {editingId === p.id ? (
              <PlaylistEditForm
                playlist={p}
                onSave={async (name, url, expiry) => {
                  await updatePlaylist(p.id, name, url, expiry)
                  setEditingId(null)
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <>
                <div className="playlist-info">
                  <span className="playlist-type-badge">{p.type}</span>
                  <div>
                    <p className="playlist-name">{p.name}</p>
                    <p className="playlist-url truncate">{p.url}</p>
                    {p.expiry && (() => {
                      const { text, expired } = expiryLabel(p.expiry)
                      return (
                        <p className={`playlist-expiry ${expired ? 'expired' : ''}`}>
                          {expired ? '⚠ Expired' : 'Expires'}: {text}
                        </p>
                      )
                    })()}
                  </div>
                </div>
                <div className="playlist-actions">
                  {p.id !== activePlaylistId && (
                    <button className="pl-btn" onClick={() => setActivePlaylist(p.id)}>Set active</button>
                  )}
                  {p.id === activePlaylistId && (
                    <span className="pl-active-badge">Active</span>
                  )}
                  <button className="pl-btn" onClick={() => setEditingId(p.id)}>Edit</button>
                  {p.type === 'xtream' && (
                    <button
                      className="pl-btn"
                      disabled={refreshingId === p.id}
                      onClick={async () => {
                        setRefreshingId(p.id)
                        try { await refreshPlaylistExpiry(p.id) } catch {}
                        setRefreshingId(null)
                      }}
                    >
                      {refreshingId === p.id ? '…' : '↻ Expiry'}
                    </button>
                  )}
                  <button className="pl-btn danger" onClick={() => removePlaylist(p.id)}>Remove</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function PlaylistEditForm({
  playlist, onSave, onCancel,
}: { playlist: Playlist; onSave: (name: string, url: string, expiry: string) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(playlist.name)
  const [url, setUrl] = useState(playlist.url)
  const [expiry, setExpiry] = useState(playlist.expiry ?? '')
  const [saving, setSaving] = useState(false)

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    await onSave(name, url, expiry)
    setSaving(false)
  }

  return (
    <form className="playlist-edit-form" onSubmit={handleSave}>
      <div className="playlist-edit-row">
        <label className="playlist-edit-label">Name</label>
        <input
          className="form-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Playlist name"
          required
        />
      </div>
      <div className="playlist-edit-row">
        <label className="playlist-edit-label">URL</label>
        <input
          className="form-input"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Playlist URL"
          required
        />
      </div>
      <div className="playlist-edit-row">
        <label className="playlist-edit-label">Expiry date</label>
        <input
          className="form-input"
          type="date"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
          placeholder="No expiry"
        />
      </div>
      <div className="form-actions">
        <button type="button" className="form-btn cancel" onClick={onCancel}>Cancel</button>
        <button type="submit" className="form-btn submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function AddXtreamForm({ onClose }: { onClose: () => void }) {
  const { addXtream, status, error } = usePlaylistStore()
  const [form, setForm] = useState({ name: '', url: '', username: '', password: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await addXtream(form.name, form.url, form.username, form.password)
      onClose()
    } catch {}
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <h3 className="form-title">Add Xtream Codes Playlist</h3>
      <input className="form-input" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
      <input className="form-input" placeholder="Server URL (http://...)" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} required />
      {form.url.trim().toLowerCase().startsWith('http://') && (
        <p className="form-http-warn">Your credentials will be sent unencrypted over HTTP. Use HTTPS if your provider supports it.</p>
      )}
      <input className="form-input" placeholder="Username" value={form.username} onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))} required />
      <input className="form-input" placeholder="Password" type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required />
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="form-btn cancel" onClick={onClose}>Cancel</button>
        <button type="submit" className="form-btn submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Connecting…' : 'Add Playlist'}
        </button>
      </div>
    </form>
  )
}

function AddM3UForm({ onClose }: { onClose: () => void }) {
  const { addM3u, status, error } = usePlaylistStore()
  const [form, setForm] = useState({ name: '', url: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await addM3u(form.name, form.url)
      onClose()
    } catch {}
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <h3 className="form-title">Add M3U Playlist</h3>
      <input className="form-input" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
      <input className="form-input" placeholder="M3U URL or local file path" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} required />
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="form-btn cancel" onClick={onClose}>Cancel</button>
        <button type="submit" className="form-btn submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Loading…' : 'Add Playlist'}
        </button>
      </div>
    </form>
  )
}

function AddStalkerForm({ onClose }: { onClose: () => void }) {
  const { addStalker, status, error } = usePlaylistStore()
  const [form, setForm] = useState({ name: '', url: '', mac: '' })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await addStalker(form.name, form.url, form.mac)
      onClose()
    } catch {}
  }

  return (
    <form className="add-form" onSubmit={handleSubmit}>
      <h3 className="form-title">Add Stalker Portal</h3>
      <input className="form-input" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
      <input className="form-input" placeholder="Portal URL (http://...)" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} required />
      {form.url.trim().toLowerCase().startsWith('http://') && (
        <p className="form-http-warn">Your MAC address will be sent unencrypted over HTTP. Use HTTPS if your portal supports it.</p>
      )}
      <input className="form-input" placeholder="MAC Address (00:1A:79:...)" value={form.mac} onChange={(e) => setForm((f) => ({ ...f, mac: e.target.value }))} required />
      {error && <p className="form-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="form-btn cancel" onClick={onClose}>Cancel</button>
        <button type="submit" className="form-btn submit" disabled={status === 'loading'}>
          {status === 'loading' ? 'Connecting…' : 'Add Portal'}
        </button>
      </div>
    </form>
  )
}

function EpgSettings() {
  const { sources, addSource, removeSource } = useEpgStore()
  const [form, setForm] = useState({ name: '', url: '' })
  const [adding, setAdding] = useState(false)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    await addSource(form.name, form.url)
    setForm({ name: '', url: '' })
    setAdding(false)
  }

  return (
    <div className="settings-section">
      {!adding && (
        <button className="add-btn" onClick={() => setAdding(true)}>+ Add EPG Source</button>
      )}
      {adding && (
        <form className="add-form" onSubmit={handleAdd}>
          <h3 className="form-title">Add EPG Source (XMLTV)</h3>
          <input className="form-input" placeholder="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
          <input className="form-input" placeholder="XMLTV URL" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} required />
          <div className="form-actions">
            <button type="button" className="form-btn cancel" onClick={() => setAdding(false)}>Cancel</button>
            <button type="submit" className="form-btn submit">Add Source</button>
          </div>
        </form>
      )}
      <div className="playlist-list">
        {sources.length === 0 && <p className="settings-empty">No EPG sources added.</p>}
        {sources.map((src) => (
          <div key={src.id} className="playlist-item">
            <div className="playlist-info">
              <div>
                <p className="playlist-name">{src.name}</p>
                <p className="playlist-url truncate">{src.url}</p>
              </div>
            </div>
            <div className="playlist-actions">
              <button className="pl-btn danger" onClick={() => removeSource(src.id)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

type TestState = 'idle' | 'testing' | 'ok' | 'fail'

function IntegrationsSettings() {
  const [tmdbKey, setTmdbKey] = useState('')
  const [omdbKey, setOmdbKey] = useState('')
  const [tmdbTest, setTmdbTest] = useState<TestState>('idle')
  const [tmdbError, setTmdbError] = useState('')
  const [omdbTest, setOmdbTest] = useState<TestState>('idle')
  const [omdbError, setOmdbError] = useState('')

  // Load saved keys from credential storage, fall back to localStorage
  useEffect(() => {
    invoke<string | null>('get_credential', { key: 'tmdb_api_key' })
      .catch(() => null)
      .then((v) => setTmdbKey(v || localStorage.getItem('tmdb_api_key') || ''))
    invoke<string | null>('get_credential', { key: 'omdb_api_key' })
      .catch(() => null)
      .then((v) => setOmdbKey(v || localStorage.getItem('omdb_api_key') || ''))
  }, [])

  const saveTmdb = async () => {
    const key = tmdbKey.trim()
    if (!key) return
    setTmdbTest('testing')
    setTmdbError('')
    try {
      await invoke('fetch_tmdb', { title: 'Inception', year: '2010', mediaType: 'movie', apiKey: key })
      await invoke('store_credential', { key: 'tmdb_api_key', value: key }).catch(() => {})
      localStorage.setItem('tmdb_api_key', key)
      setTmdbTest('ok')
    } catch (e) {
      setTmdbTest('fail')
      setTmdbError(String(e))
    }
  }

  const saveOmdb = async () => {
    const key = omdbKey.trim()
    if (!key) return
    setOmdbTest('testing')
    setOmdbError('')
    try {
      await invoke('fetch_omdb', { title: 'Inception', year: '2010', apiKey: key })
      await invoke('store_credential', { key: 'omdb_api_key', value: key }).catch(() => {})
      localStorage.setItem('omdb_api_key', key)
      setOmdbTest('ok')
    } catch (e) {
      setOmdbTest('fail')
      setOmdbError(String(e))
    }
  }

  return (
    <div className="settings-section">
      {/* TMDB — preferred source */}
      <div className="integration-card">
        <h3 className="integration-title">TMDB — Movie &amp; TV Metadata <span className="integration-badge">Recommended</span></h3>
        <p className="integration-desc">
          HD posters, backdrops, cast photos, trailers, genres and ratings from The Movie Database.
          Free with no daily limit. Get a key at{' '}
          <a href="https://www.themoviedb.org/settings/api" target="_blank" rel="noreferrer" className="integration-link">
            themoviedb.org
          </a>.
        </p>
        <div className="integration-row">
          <input
            className="integration-input"
            type="text"
            placeholder="Your TMDB API key (v3 auth)"
            value={tmdbKey}
            onChange={(e) => { setTmdbKey(e.target.value); setTmdbTest('idle') }}
          />
          <button className="add-btn" onClick={saveTmdb} disabled={!tmdbKey.trim() || tmdbTest === 'testing'}>
            {tmdbTest === 'testing' ? 'Testing…' : tmdbTest === 'ok' ? '✓ Saved' : 'Save & Test'}
          </button>
        </div>
        {tmdbTest === 'ok' && <p className="integration-status ok">✓ Key verified — TMDB active.</p>}
        {tmdbTest === 'fail' && <p className="integration-status fail">✗ {tmdbError || 'Key invalid or network error.'}</p>}
        {tmdbTest === 'idle' && tmdbKey && localStorage.getItem('tmdb_api_key') === tmdbKey.trim() && (
          <p className="integration-status ok">✓ TMDB active — HD metadata loads when you open a title.</p>
        )}
      </div>

      {/* OMDb — fallback */}
      <div className="integration-card">
        <h3 className="integration-title">OMDb — IMDb Ratings &amp; Awards <span className="integration-badge secondary">Fallback</span></h3>
        <p className="integration-desc">
          IMDb ratings, awards and box office. Used as fallback when no TMDB key is set.
          Free tier: 1,000 requests/day. Get a key at{' '}
          <a href="https://www.omdbapi.com/apikey.aspx" target="_blank" rel="noreferrer" className="integration-link">
            omdbapi.com
          </a>.
        </p>
        <div className="integration-row">
          <input
            className="integration-input"
            type="text"
            placeholder="Your OMDb API key (e.g. a1b2c3d4)"
            value={omdbKey}
            onChange={(e) => { setOmdbKey(e.target.value); setOmdbTest('idle') }}
          />
          <button className="add-btn" onClick={saveOmdb} disabled={!omdbKey.trim() || omdbTest === 'testing'}>
            {omdbTest === 'testing' ? 'Testing…' : omdbTest === 'ok' ? '✓ Saved' : 'Save & Test'}
          </button>
        </div>
        {omdbTest === 'ok' && <p className="integration-status ok">✓ Key verified — OMDb active.</p>}
        {omdbTest === 'fail' && <p className="integration-status fail">✗ {omdbError || 'Key invalid or network error.'}</p>}
        {omdbTest === 'idle' && omdbKey && localStorage.getItem('omdb_api_key') === omdbKey.trim() && (
          <p className="integration-status ok">✓ OMDb active — used when TMDB key is absent.</p>
        )}
      </div>
    </div>
  )
}

type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'downloading' | 'downloaded' | 'download-error' | 'install-permission' | 'error'

function formatProgress(p: { downloaded: number; total: number | null }): string {
  const mb = (n: number) => (n / (1024 * 1024)).toFixed(1)
  if (p.total) return `${mb(p.downloaded)} / ${mb(p.total)} MB`
  if (p.downloaded > 0) return `${mb(p.downloaded)} MB`
  return ''
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

function AboutSettings() {
  const [version, setVersion] = useState<string | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>('idle')
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null }>({ downloaded: 0, total: null })
  const [isAndroid] = useState(() => { try { return platform() === 'android' } catch { return false } })

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(null))
  }, [])

  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    listen<{ downloaded: number; total: number | null }>('update-download-progress', (ev) => {
      setProgress({ downloaded: ev.payload.downloaded, total: ev.payload.total ?? null })
    }).then((fn) => { unlisten = fn })
    return () => { unlisten?.() }
  }, [])

  const checkForUpdates = async () => {
    if (!version || updateState === 'checking') return
    setUpdateState('checking')
    setDownloadError(null)
    try {
      const res = await fetch('https://api.github.com/repos/Goombsta/SingularityV2/releases/latest')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { tag_name: string }
      const tag = data.tag_name.replace(/^v/, '')
      setLatestVersion(tag)
      setUpdateState(compareVersions(version, tag) < 0 ? 'update-available' : 'up-to-date')
    } catch {
      setUpdateState('error')
    }
  }

  const downloadUrl = isAndroid
    ? 'https://www.singularitytv.app/downloads/Singularitydeux.apk'
    : 'https://www.singularitytv.app/downloads/Singularitydeux.Setup.exe'
  const downloadFilename = isAndroid
    ? `Singularity-${latestVersion ?? 'update'}.apk`
    : `Singularity-${latestVersion ?? 'update'}-Setup.exe`

  const downloadUpdate = async () => {
    if (updateState === 'downloading') return
    setUpdateState('downloading')
    setDownloadError(null)
    setProgress({ downloaded: 0, total: null })
    try {
      const path = await invoke<string>('download_update', {
        url: downloadUrl,
        filename: downloadFilename,
      })
      setDownloadedPath(path)
      setUpdateState('downloaded')
    } catch (e) {
      setDownloadError(String(e))
      setUpdateState('download-error')
    }
  }

  const installUpdate = async () => {
    if (!downloadedPath) return
    setDownloadError(null)
    try {
      if (isAndroid) {
        const res = await invoke<{ needsPermission?: boolean } | null>('plugin:updater|install_apk', { path: downloadedPath })
        if (res?.needsPermission) {
          setUpdateState('install-permission')
          return
        }
      } else {
        await invoke('install_update', { path: downloadedPath })
      }
    } catch (e) {
      setDownloadError(String(e))
      setUpdateState('download-error')
    }
  }

  return (
    <div className="settings-section">
      <div className="about-hero">
        <div className="about-glow" />
        <img src="/icon-foreground.png" alt="Singularity" className="about-icon" />
        <div className="about-name-row">
          <h2 className="about-name">Singularity</h2>
          {version != null && <span className="about-version-badge">v{version}</span>}
        </div>
        <p className="about-tagline">IPTV &amp; VOD streaming for Android &amp; Windows</p>

        <div className="about-update-area">
          <button
            className={`about-update-btn${updateState === 'checking' ? ' checking' : ''}`}
            onClick={checkForUpdates}
            disabled={updateState === 'checking' || !version}
          >
            {updateState === 'checking'
              ? <><span className="about-spinner" />Checking…</>
              : 'Check for Updates'}
          </button>

          {updateState === 'up-to-date' && (
            <p className="about-status ok">✓ You're up to date</p>
          )}
          {updateState === 'error' && (
            <p className="about-status fail">Could not reach update server</p>
          )}
          {(updateState === 'update-available' || updateState === 'downloading' || updateState === 'downloaded' || updateState === 'download-error' || updateState === 'install-permission') && latestVersion && (
            <div className="about-update-available">
              <p className="about-status update">v{latestVersion} is available</p>
              {updateState === 'downloading' ? (
                <>
                  <button className="about-download-btn checking" disabled>
                    <span className="about-spinner" />Downloading… {formatProgress(progress)}
                  </button>
                  <div className="about-progress-track">
                    {progress.total ? (
                      <div
                        className="about-progress-fill"
                        style={{ width: `${Math.min(100, (progress.downloaded / progress.total) * 100).toFixed(1)}%` }}
                      />
                    ) : (
                      <div className="about-progress-indeterminate" />
                    )}
                  </div>
                </>
              ) : updateState === 'downloaded' || updateState === 'install-permission' ? (
                <button className="about-download-btn" onClick={installUpdate}>
                  Install Update
                </button>
              ) : updateState === 'download-error' ? (
                <button className="about-download-btn" onClick={downloadUpdate}>
                  Retry Download
                </button>
              ) : (
                <button className="about-download-btn" onClick={downloadUpdate}>
                  Download Update
                </button>
              )}
              {updateState === 'download-error' && (
                <p className="about-status fail">Download failed{downloadError ? `: ${downloadError}` : ''}</p>
              )}
              {updateState === 'install-permission' && (
                <p className="about-status update">Grant "Install unknown apps" permission in Settings, then tap Install Update again.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
