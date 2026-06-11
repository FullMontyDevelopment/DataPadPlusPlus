import type {
  AppHealth,
  AppUpdateCheckResult,
  AppUpdateSettings,
  DiagnosticsReport,
} from '@datapadplusplus/shared-types'
import { DownloadIcon, RefreshIcon } from './icons'
import { MetricCard, SettingsPanel } from './SettingsWorkspace.parts'

export interface SettingsUpdatesProps {
  diagnostics?: DiagnosticsReport
  health: AppHealth
  updateCheckResult?: AppUpdateCheckResult
  updateDownload?: {
    downloadedBytes: number
    contentLength?: number
  }
  updateError?: string
  updateInstallStatus: 'idle' | 'installing' | 'installed' | 'error'
  updateSettings?: AppUpdateSettings
  updateStatus: 'idle' | 'loading' | 'ready'
  onCheckForUpdates(): void
  onInstallUpdate(): void
  onSetUpdatePrereleases(enabled: boolean): void
}

export function SettingsUpdatesPanel({
  diagnostics,
  health,
  updateCheckResult,
  updateDownload,
  updateError,
  updateInstallStatus,
  updateSettings,
  updateStatus,
  onCheckForUpdates,
  onInstallUpdate,
  onSetUpdatePrereleases,
}: SettingsUpdatesProps) {
  const updates = updateSettings ?? {
    includePrereleases: false,
    supported: false,
  }
  const availableUpdate = updateCheckResult?.status === 'available'
    ? updateCheckResult.candidate
    : undefined
  const updateBusy = updateStatus === 'loading' || updateInstallStatus === 'installing'
  const updateMessage =
    updateError ??
    updateCheckResult?.message ??
    updates.lastResult?.message ??
    (updates.supported ? 'Ready.' : 'Unavailable in this build.')
  const updateProgress =
    updateDownload?.contentLength && updateDownload.contentLength > 0
      ? Math.min(100, Math.round((updateDownload.downloadedBytes / updateDownload.contentLength) * 100))
      : undefined

  return (
    <SettingsPanel title="Updates" icon={<RefreshIcon className="panel-inline-icon" />}>
      <div className="settings-form-grid">
        <label className="settings-check-row settings-check-row--card">
          <input
            type="checkbox"
            checked={updates.includePrereleases}
            disabled={!updates.supported || updateBusy}
            onChange={(event) => onSetUpdatePrereleases(event.target.checked)}
          />
          <span>Pre-release updates</span>
        </label>
        <div className="settings-action-row">
          <button
            type="button"
            className="drawer-button"
            disabled={!updates.supported || updateBusy}
            onClick={onCheckForUpdates}
          >
            <RefreshIcon className="drawer-inline-icon" />
            Check for Updates
          </button>
          {availableUpdate ? (
            <button
              type="button"
              className="drawer-button drawer-button--primary"
              disabled={updateBusy}
              onClick={onInstallUpdate}
            >
              <DownloadIcon className="drawer-inline-icon" />
              Update to {availableUpdate.version}
            </button>
          ) : null}
        </div>
      </div>
      {availableUpdate ? (
        <div className="settings-update-available" role="status">
          <strong>Update available</strong>
          <span>DataPad++ {availableUpdate.version} is ready to install.</span>
        </div>
      ) : null}
      <div className="settings-metric-grid">
        <MetricCard label="Current version" value={diagnostics?.appVersion ?? 'Unknown'} />
        <MetricCard label="Available version" value={availableUpdate?.version ?? updates.lastResult?.version ?? 'None'} />
      </div>
      {updateInstallStatus === 'installing' ? (
        <div className="settings-update-progress">
          <progress
            aria-label="Update download progress"
            value={updateProgress}
            max={updateProgress === undefined ? undefined : 100}
          />
          <span>
            {updateProgress === undefined
              ? 'Downloading update...'
              : `${updateProgress}%`}
          </span>
        </div>
      ) : null}
      {availableUpdate && health.platform.toLowerCase().includes('windows') ? (
        <div className="settings-empty">Installing updates closes DataPad++ on Windows.</div>
      ) : null}
      <div className="settings-inline-message" role="status">{updateMessage}</div>
    </SettingsPanel>
  )
}
