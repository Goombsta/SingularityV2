import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { platform } from '@tauri-apps/plugin-os'

export type UpdateState = 'idle' | 'checking' | 'up-to-date' | 'update-available' | 'downloading' | 'downloaded' | 'download-error' | 'install-permission' | 'error'

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff !== 0) return diff
  }
  return 0
}

export function useUpdate() {
  const [version, setVersion] = useState<string | null>(null)
  const [updateState, setUpdateState] = useState<UpdateState>('idle')
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [downloadedPath, setDownloadedPath] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null }>({ downloaded: 0, total: null })
  const [isAndroid] = useState(() => { try { return platform() === 'android' } catch { return false } })
  const [remoteDownloadUrl, setRemoteDownloadUrl] = useState('')

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
      const data = await invoke<{ android: { version: string; url: string }; desktop: { version: string; url: string } }>('fetch_version_info')
      const p = isAndroid ? data.android : data.desktop
      setLatestVersion(p.version)
      setRemoteDownloadUrl(p.url)
      setUpdateState(compareVersions(version, p.version) < 0 ? 'update-available' : 'up-to-date')
    } catch {
      setUpdateState('error')
    }
  }

  const downloadUrl = remoteDownloadUrl || (isAndroid
    ? 'https://www.singularitytv.app/downloads/Singularitydeux.apk'
    : 'https://www.singularitytv.app/downloads/Singularitydeux.Setup.exe')
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
      setDownloadError(typeof e === 'string' ? e : (e as any)?.message ?? JSON.stringify(e))
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
      setDownloadError(typeof e === 'string' ? e : (e as any)?.message ?? JSON.stringify(e))
      setUpdateState('download-error')
    }
  }

  const dismiss = () => {
    setUpdateState('idle')
    setDownloadError(null)
  }

  const formatProgress = (): string => {
    const mb = (n: number) => (n / (1024 * 1024)).toFixed(1)
    if (progress.total) return `${mb(progress.downloaded)} / ${mb(progress.total)} MB`
    if (progress.downloaded > 0) return `${mb(progress.downloaded)} MB`
    return ''
  }

  return {
    updateState,
    version,
    latestVersion,
    progress,
    downloadError,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    dismiss,
    formatProgress,
  }
}
