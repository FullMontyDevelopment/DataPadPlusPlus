import { useEffect, useState } from 'react'
import type {
  AppHealth,
  DiagnosticsReport,
  WorkspaceBackupSummary,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { canUseWorkspaceBundlePassphrase } from '../../security/workspace-passphrase'
import {
  ClockIcon,
  DownloadIcon,
  HistoryIcon,
  LockIcon,
  RefreshIcon,
  SettingsIcon,
  ThemeIcon,
  UploadIcon,
} from './icons'
import { DeleteConfirmationPanel } from './results/DeleteConfirmationPanel'
import { SHORTCUTS } from './RightDrawer.helpers'
import { formatSecretStorageStatus } from './SettingsWorkspace.format'
import {
  BackupList,
  MetricCard,
  PassphraseStrength,
  RestoreBackupConfirmation,
  SettingsPanel,
} from './SettingsWorkspace.parts'

export type SettingsSection = 'appearance' | 'workspace' | 'backups' | 'security' | 'shortcuts' | 'health'

const SETTINGS_SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'backups', label: 'Backups' },
  { id: 'security', label: 'Security' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'health', label: 'Health' },
]

const THEMES: Array<{ id: WorkspaceSnapshot['preferences']['theme']; label: string; base: 'light' | 'dark' }> = [
  { id: 'system', label: 'System', base: 'dark' },
  { id: 'dark', label: 'Dark', base: 'dark' },
  { id: 'light', label: 'Light', base: 'light' },
  { id: 'midnight', label: 'Midnight', base: 'dark' },
  { id: 'graphite', label: 'Graphite', base: 'dark' },
  { id: 'solarized-dark', label: 'Solarized Dark', base: 'dark' },
  { id: 'solarized-light', label: 'Solarized Light', base: 'light' },
  { id: 'high-contrast', label: 'High Contrast', base: 'dark' },
]

export function SettingsWorkspace({
  diagnostics,
  health,
  initialSection,
  preferences,
  onCreateBackup,
  onDeleteBackup,
  onExportWorkspaceFile,
  onImportWorkspaceFile,
  onListBackups,
  onRefreshDiagnostics,
  onRestoreBackup,
  onSetSafeMode,
  onSetTheme,
  onUpdateBackupSettings,
}: {
  diagnostics?: DiagnosticsReport
  health: AppHealth
  initialSection?: SettingsSection
  preferences: WorkspaceSnapshot['preferences']
  onCreateBackup(automatic?: boolean): Promise<void>
  onDeleteBackup(backupId: string): Promise<WorkspaceBackupSummary[] | undefined>
  onExportWorkspaceFile(passphrase: string, includeSecrets: boolean): Promise<string | undefined>
  onImportWorkspaceFile(passphrase: string): Promise<void>
  onListBackups(): Promise<WorkspaceBackupSummary[] | undefined>
  onRefreshDiagnostics(): void
  onRestoreBackup(backupId: string, passphrase: string): Promise<void>
  onSetSafeMode(enabled: boolean): void
  onSetTheme(theme: WorkspaceSnapshot['preferences']['theme']): void
  onUpdateBackupSettings(request: {
    enabled: boolean
    passphrase?: string
    intervalMinutes?: number
    maxBackups?: number
    includeSecrets?: boolean
  }): Promise<void>
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection ?? 'appearance')
  const [bundlePassphrase, setBundlePassphrase] = useState('')
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [backupPassphrase, setBackupPassphrase] = useState('')
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [restoreBackupId, setRestoreBackupId] = useState<string>()
  const [deleteBackupId, setDeleteBackupId] = useState<string>()
  const [backups, setBackups] = useState<WorkspaceBackupSummary[]>([])
  const [message, setMessage] = useState('')
  const canIncludeSecrets = health.runtime === 'tauri'
  const backupPreferences = preferences.workspaceBackups ?? {
    enabled: false,
    intervalMinutes: 30,
    maxBackups: 20,
    includeSecrets: false,
  }
  const bundleReady = canUseWorkspaceBundlePassphrase(bundlePassphrase)
  const backupReady =
    !backupPreferences.enabled ||
    Boolean(backupPreferences.passphraseSecretRef) ||
    canUseWorkspaceBundlePassphrase(backupPassphrase)

  useEffect(() => {
    let mounted = true
    void onListBackups().then((items) => {
      if (mounted && items) {
        setBackups(items)
      }
    })
    return () => {
      mounted = false
    }
  }, [onListBackups])

  const refreshBackups = async () => {
    const items = await onListBackups()
    if (items) {
      setBackups(items)
    }
  }

  const exportWorkspace = async () => {
    const path = await onExportWorkspaceFile(bundlePassphrase, canIncludeSecrets && includeSecrets)
    setMessage(path ? 'Workspace exported.' : 'Export canceled.')
  }

  const importWorkspace = async () => {
    await onImportWorkspaceFile(bundlePassphrase)
    setMessage('Workspace imported.')
  }

  const updateBackups = async (enabled: boolean) => {
    await onUpdateBackupSettings({
      enabled,
      passphrase: backupPassphrase,
      intervalMinutes: backupPreferences.intervalMinutes,
      maxBackups: 20,
      includeSecrets: backupPreferences.includeSecrets,
    })
    setBackupPassphrase('')
    setMessage(enabled ? 'Auto-backups enabled.' : 'Auto-backups disabled.')
  }

  const runBackupNow = async () => {
    await onCreateBackup(false)
    await refreshBackups()
    setMessage('Backup created.')
  }

  return (
    <section className="settings-workspace" aria-label="Settings">
      <aside className="settings-nav" aria-label="Settings sections">
        <div className="settings-nav-header">
          <SettingsIcon className="panel-inline-icon" />
          <strong>Settings</strong>
        </div>
        {SETTINGS_SECTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`settings-nav-item${section === item.id ? ' is-active' : ''}`}
            onClick={() => setSection(item.id)}
          >
            {item.label}
          </button>
        ))}
      </aside>

      <div className="settings-content">
        {section === 'appearance' ? (
          <SettingsPanel title="Appearance" icon={<ThemeIcon className="panel-inline-icon" />}>
            <div className="theme-grid" role="list">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  className={`theme-card theme-card--${theme.base}${preferences.theme === theme.id ? ' is-active' : ''}`}
                  onClick={() => onSetTheme(theme.id)}
                >
                  <span className="theme-card-swatch" />
                  <strong>{theme.label}</strong>
                </button>
              ))}
            </div>
          </SettingsPanel>
        ) : null}

        {section === 'workspace' ? (
          <SettingsPanel title="Workspace" icon={<DownloadIcon className="panel-inline-icon" />}>
            <div className="settings-form-grid">
              <label className="settings-field">
                <span>Passphrase</span>
                <input
                  type="password"
                  value={bundlePassphrase}
                  onChange={(event) => setBundlePassphrase(event.target.value)}
                  placeholder="Backup password"
                />
              </label>
              <PassphraseStrength value={bundlePassphrase} />
              <label className="settings-check-row">
                <input
                  type="checkbox"
                  checked={canIncludeSecrets && includeSecrets}
                  disabled={!canIncludeSecrets}
                  title={canIncludeSecrets ? 'Include saved connection passwords.' : 'Available in the desktop app.'}
                  onChange={(event) => setIncludeSecrets(event.target.checked)}
                />
                <span>Include passwords</span>
              </label>
              <div className="settings-action-row">
                <button type="button" className="drawer-button drawer-button--primary" disabled={!bundleReady} onClick={() => void exportWorkspace()}>
                  <DownloadIcon className="drawer-inline-icon" />
                  Export
                </button>
                <button type="button" className="drawer-button" disabled={!bundleReady} onClick={() => void importWorkspace()}>
                  <UploadIcon className="drawer-inline-icon" />
                  Import
                </button>
              </div>
            </div>
          </SettingsPanel>
        ) : null}

        {section === 'backups' ? (
          <SettingsPanel title="Backups" icon={<HistoryIcon className="panel-inline-icon" />}>
            <div className="settings-form-grid">
              <label className="settings-check-row">
                <input
                  type="checkbox"
                  checked={backupPreferences.enabled}
                  onChange={(event) => void updateBackups(event.target.checked)}
                  disabled={!backupReady}
                />
                <span>Auto-backup</span>
              </label>
              {!backupPreferences.passphraseSecretRef ? (
                <>
                  <label className="settings-field">
                    <span>Auto-backup passphrase</span>
                    <input
                      type="password"
                      value={backupPassphrase}
                      onChange={(event) => setBackupPassphrase(event.target.value)}
                      placeholder="Stored in secure storage"
                    />
                  </label>
                  <PassphraseStrength value={backupPassphrase} />
                </>
              ) : null}
              <label className="settings-check-row">
                <input
                  type="checkbox"
                  checked={canIncludeSecrets && backupPreferences.includeSecrets}
                  disabled={!canIncludeSecrets}
                  title={canIncludeSecrets ? 'Include saved connection passwords.' : 'Available in the desktop app.'}
                  onChange={(event) =>
                    void onUpdateBackupSettings({
                      enabled: backupPreferences.enabled,
                      intervalMinutes: backupPreferences.intervalMinutes,
                      maxBackups: 20,
                      includeSecrets: canIncludeSecrets && event.target.checked,
                    })
                  }
                />
                <span>Include passwords in auto-backups</span>
              </label>
              <div className="settings-action-row">
                <button type="button" className="drawer-button drawer-button--primary" disabled={!backupPreferences.enabled} onClick={() => void runBackupNow()}>
                  <ClockIcon className="drawer-inline-icon" />
                  Back Up Now
                </button>
                <button type="button" className="drawer-button" onClick={() => void refreshBackups()}>
                  <RefreshIcon className="drawer-inline-icon" />
                  Refresh
                </button>
              </div>
            </div>
            <BackupList
              backups={backups}
              onDelete={(backupId) => setDeleteBackupId(backupId)}
              onRestore={(backupId) => setRestoreBackupId(backupId)}
            />
            {restoreBackupId ? (
              <RestoreBackupConfirmation
                backupId={restoreBackupId}
                passphrase={restorePassphrase}
                onCancel={() => setRestoreBackupId(undefined)}
                onPassphraseChange={setRestorePassphrase}
                onConfirm={(backupId, passphrase) => {
                  void onRestoreBackup(backupId, passphrase).then(() => {
                    setRestoreBackupId(undefined)
                    setRestorePassphrase('')
                  })
                }}
              />
            ) : null}
            {deleteBackupId ? (
              <DeleteConfirmationPanel
                title="Delete backup?"
                body="This removes the selected backup file."
                confirmLabel="Delete"
                onCancel={() => setDeleteBackupId(undefined)}
                onConfirm={() => {
                  void onDeleteBackup(deleteBackupId).then((items) => {
                    if (items) {
                      setBackups(items)
                    }
                    setDeleteBackupId(undefined)
                  })
                }}
              />
            ) : null}
          </SettingsPanel>
        ) : null}

        {section === 'security' ? (
          <SettingsPanel title="Security" icon={<LockIcon className="panel-inline-icon" />}>
            <div className="settings-form-grid settings-form-grid--compact">
              <label className="settings-check-row settings-check-row--card">
                <input
                  type="checkbox"
                  checked={preferences.safeModeEnabled}
                  onChange={(event) => onSetSafeMode(event.target.checked)}
                />
                <span>Global safe mode</span>
              </label>
            </div>
            <div className="settings-metric-grid">
              <MetricCard label="Credential storage" value={formatSecretStorageStatus(health.secretStorage)} />
              <MetricCard label="Safe mode" value={preferences.safeModeEnabled ? 'On' : 'Off'} />
              <MetricCard label="Auto-backup secrets" value={canIncludeSecrets && backupPreferences.includeSecrets ? 'Included' : 'Excluded'} />
            </div>
          </SettingsPanel>
        ) : null}

        {section === 'shortcuts' ? (
          <SettingsPanel title="Shortcuts" icon={<SettingsIcon className="panel-inline-icon" />}>
            <div className="drawer-shortcut-list settings-shortcut-list">
              {SHORTCUTS.map(([label, shortcut]) => (
                <div key={label} className="drawer-shortcut-row">
                  <span>{label}</span>
                  <kbd>{shortcut}</kbd>
                </div>
              ))}
            </div>
          </SettingsPanel>
        ) : null}

        {section === 'health' ? (
          <SettingsPanel title="Health" icon={<RefreshIcon className="panel-inline-icon" />}>
            <div className="settings-action-row">
              <button type="button" className="drawer-button" onClick={onRefreshDiagnostics}>
                <RefreshIcon className="drawer-inline-icon" />
                Refresh
              </button>
            </div>
            <div className="settings-metric-grid">
              <MetricCard label="Version" value={diagnostics?.appVersion ?? 'Unknown'} />
              <MetricCard label="Platform" value={diagnostics?.platform ?? health.platform} />
              <MetricCard label="Log file" value={diagnostics?.logPath ?? 'Not available'} />
              <MetricCard label="Connections" value={String(diagnostics?.counts.connections ?? 0)} />
              <MetricCard label="Library" value={String(diagnostics?.counts.library ?? 0)} />
              <MetricCard label="Environments" value={String(diagnostics?.counts.environments ?? 0)} />
              <MetricCard label="Open tabs" value={String(diagnostics?.counts.tabs ?? 0)} />
            </div>
            <ul className="messages-list settings-warning-list">
              {((diagnostics?.warnings.length ? diagnostics.warnings : ['No workspace warnings.'])).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </SettingsPanel>
        ) : null}

        {message ? <div className="settings-inline-message" role="status">{message}</div> : null}
      </div>
    </section>
  )
}
