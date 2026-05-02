import type { UpdateState } from '../../hooks/useUpdate'
import './UpdateModal.css'

interface UpdateModalProps {
  latestVersion: string
  updateState: UpdateState
  progress: { downloaded: number; total: number | null }
  downloadError: string | null
  onUpdate: () => void
  onClose: () => void
  formatProgress: () => string
}

export default function UpdateModal({ latestVersion, updateState, progress, downloadError, onUpdate, onClose, formatProgress }: UpdateModalProps) {
  const pct = progress.total
    ? Math.min(100, (progress.downloaded / progress.total) * 100)
    : null

  return (
    <div className="update-modal-backdrop" onClick={onClose}>
      <div className="update-modal-card" onClick={e => e.stopPropagation()}>
        <h2 className="update-modal-title">
          Update Available <span className="update-modal-version">v{latestVersion}</span>
        </h2>

        {updateState === 'downloading' && (
          <div className="update-modal-progress">
            <div className="update-modal-progress-track">
              {pct !== null ? (
                <div className="update-modal-progress-fill" style={{ width: `${pct.toFixed(1)}%` }} />
              ) : (
                <div className="update-modal-progress-indeterminate" />
              )}
            </div>
            <p className="update-modal-progress-text">{formatProgress()}</p>
          </div>
        )}

        {updateState === 'download-error' && (
          <p className="update-modal-error">Download failed{downloadError ? `: ${downloadError}` : ''}</p>
        )}

        {updateState === 'install-permission' && (
          <p className="update-modal-permission">Grant "Install unknown apps" permission in Settings, then tap Update again.</p>
        )}

        <div className="update-modal-actions">
          {updateState === 'downloading' ? (
            <button className="update-modal-btn primary" disabled>
              Downloading…
            </button>
          ) : updateState === 'downloaded' ? (
            <button className="update-modal-btn primary" disabled>
              Installing…
            </button>
          ) : (
            <button className="update-modal-btn primary" onClick={onUpdate}>
              {updateState === 'download-error' ? 'Retry' : 'Update'}
            </button>
          )}
          <button className="update-modal-btn secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
