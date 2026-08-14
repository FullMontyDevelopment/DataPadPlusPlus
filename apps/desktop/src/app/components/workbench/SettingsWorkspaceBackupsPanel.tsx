import { useEffect, useState } from 'react'
import type {
  AppHealth,
  WorkspaceBackupRunResponse,
  WorkspaceBackupSummary,
  WorkspaceSnapshot,
  WorkspaceStorageReport,
} from '@datapadplusplus/shared-types'
import { canUseWorkspaceBundlePassphrase } from '../../security/workspace-passphrase'
import { ClockIcon, DownloadIcon, HistoryIcon, RefreshIcon, UploadIcon } from './icons'
import { DeleteConfirmationPanel } from './results/DeleteConfirmationPanel'
import {
  BackupList,
  PassphraseStrength,
  RestoreBackupConfirmation,
  SettingsNotice,
  type SettingsNoticeMessage,
  SettingsPanel,
} from './SettingsWorkspace.parts'

export interface SettingsWorkspaceBackupsProps {
  health: AppHealth
  preferences: WorkspaceSnapshot['preferences']
  onCreateBackup(automatic?: boolean): Promise<WorkspaceBackupRunResponse | undefined>
  onAnalyzeWorkspaceStorage(includeSecretSizes?: boolean): Promise<WorkspaceStorageReport | undefined>
  onAnalyzeWorkspaceBackup(passphrase: string, includeSecretSizes?: boolean): Promise<WorkspaceStorageReport | undefined>
  onDeleteBackup(backupId: string): Promise<WorkspaceBackupSummary[] | undefined>
  onOpenWorkspaceExport(): void
  onOpenWorkspaceImport(): void
  onListBackups(): Promise<WorkspaceBackupSummary[] | undefined>
  onRestoreBackup(backupId: string, passphrase: string, importSecrets: boolean): Promise<boolean>
  onUpdateBackupSettings(request: {
    enabled: boolean
    passphrase?: string
    intervalMinutes?: number
    maxBackups?: number
    includeSecrets?: boolean
  }): Promise<boolean>
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function WorkspaceStorageAnalysis({
  report,
  onIncludeSecretSizes,
}: {
  report: WorkspaceStorageReport
  onIncludeSecretSizes(): void
}) {
  return (
    <section className="settings-subpanel" aria-label="Workspace size analysis">
      <h3>Workspace size analysis</h3>
      <div className="settings-metric-grid">
        <div className="settings-metric-card"><span>Workspace schema</span><strong>v{report.schemaVersion}</strong></div>
        <div className="settings-metric-card"><span>Live workspace</span><strong>{formatBytes(report.workspaceBytes)}</strong></div>
        <div className="settings-metric-card"><span>Recovery file</span><strong>{formatBytes(report.recoveryBytes)}</strong></div>
        <div className="settings-metric-card"><span>Projected plaintext</span><strong>{formatBytes(report.projectedPlaintextBytes)}</strong></div>
        <div className="settings-metric-card"><span>After compression</span><strong>{formatBytes(report.projectedCompressedBytes)}</strong></div>
        <div className="settings-metric-card"><span>Projected backup</span><strong>{formatBytes(report.projectedEncryptedBytes)}</strong></div>
        <div className="settings-metric-card"><span>Backup storage</span><strong>{formatBytes(report.backupTotalBytes)}</strong></div>
      </div>
      {report.invalidBackupCount > 0 ? (
        <div className="settings-empty">{report.invalidBackupCount} corrupt backup file{report.invalidBackupCount === 1 ? '' : 's'} detected.</div>
      ) : null}
      <div className="settings-table" role="table" aria-label="Workspace storage sections">
        <div className="settings-table-row settings-table-row--header" role="row">
          <span>Section</span><span>Items</span><span>Size</span><span />
        </div>
        {report.sections.map((section) => (
          <div key={section.key} className="settings-table-row" role="row">
            <span>{section.label}</span><span>{section.itemCount}</span><span>{formatBytes(section.sizeBytes)}</span><span />
          </div>
        ))}
      </div>
      {report.largestTabs.length ? (
        <div className="settings-table" role="table" aria-label="Largest workspace tabs">
          <div className="settings-table-row settings-table-row--header" role="row">
            <span>Largest tabs</span><span>State</span><span>Size</span><span />
          </div>
          {report.largestTabs.map((tab) => (
            <div key={`${tab.closed ? 'closed' : 'open'}-${tab.tabId}`} className="settings-table-row" role="row">
              <span>{tab.title}</span><span>{tab.closed ? 'Closed' : 'Open'}</span><span>{formatBytes(tab.totalBytes)}</span><span />
            </div>
          ))}
        </div>
      ) : null}
      {report.secretCount === undefined ? (
        <button type="button" className="drawer-button" onClick={onIncludeSecretSizes}>
          Include secret byte totals
        </button>
      ) : (
        <div className="settings-empty">
          {report.secretCount} secrets | {formatBytes(report.secretBytes ?? 0)} total secret bytes
        </div>
      )}
      <p className="settings-empty">This report contains byte counts only; it never displays queries, payloads, or credential values.</p>
    </section>
  )
}

export function SettingsWorkspaceBackupsPanel({
  health,
  preferences,
  onCreateBackup,
  onAnalyzeWorkspaceStorage,
  onAnalyzeWorkspaceBackup,
  onDeleteBackup,
  onOpenWorkspaceExport,
  onOpenWorkspaceImport,
  onListBackups,
  onRestoreBackup,
  onUpdateBackupSettings,
}: SettingsWorkspaceBackupsProps) {
  const [analyzePromptOpen, setAnalyzePromptOpen] = useState(false)
  const [bundlePassphrase, setBundlePassphrase] = useState('')
  const [backupPassphrase, setBackupPassphrase] = useState('')
  const [backupPromptOpen, setBackupPromptOpen] = useState(false)
  const [restorePassphrase, setRestorePassphrase] = useState('')
  const [restoreSecrets, setRestoreSecrets] = useState(false)
  const [restoreBackupId, setRestoreBackupId] = useState<string>()
  const [deleteBackupId, setDeleteBackupId] = useState<string>()
  const [backups, setBackups] = useState<WorkspaceBackupSummary[]>([])
  const [notice, setNotice] = useState<SettingsNoticeMessage>()
  const [storageReport, setStorageReport] = useState<WorkspaceStorageReport>()
  const [analyzing, setAnalyzing] = useState(false)
  const canIncludeSecrets = health.runtime === 'tauri'
  const backupPreferences = preferences.workspaceBackups ?? {
    enabled: false,
    intervalMinutes: 30,
    maxBackups: 20,
    includeSecrets: false,
  }
  const bundleReady = canUseWorkspaceBundlePassphrase(bundlePassphrase)
  const backupReady = canUseWorkspaceBundlePassphrase(backupPassphrase)

  useEffect(() => {
    let mounted = true
    void onListBackups().then((items) => {
      if (!mounted) return
      if (items) {
        setBackups(items)
      } else {
        setNotice({ text: 'Backups could not be loaded.', tone: 'error' })
      }
    })
    return () => {
      mounted = false
    }
  }, [onListBackups])

  const refreshBackups = async (showNotice = false) => {
    const items = await onListBackups()
    if (items) {
      setBackups(items)
      if (showNotice) {
        setNotice(undefined)
      }
    } else {
      setNotice({ text: 'Backups could not be loaded.', tone: 'error' })
    }
    return items
  }

  const analyzeBackup = async () => {
    const report = await onAnalyzeWorkspaceBackup(bundlePassphrase, false)
    if (report) {
      setStorageReport(report)
      setNotice({ text: 'Backup size analysis is ready.', tone: 'success' })
    } else {
      setNotice({ text: 'Backup analysis canceled.', tone: 'info' })
    }
    setAnalyzePromptOpen(false)
    setBundlePassphrase('')
  }

  const updateBackups = async (enabled: boolean, passphrase?: string) => {
    const ok = await onUpdateBackupSettings({
      enabled,
      passphrase,
      intervalMinutes: backupPreferences.intervalMinutes,
      maxBackups: backupPreferences.maxBackups,
      includeSecrets: backupPreferences.includeSecrets,
    })
    if (!ok) {
      setNotice({ text: 'Backup settings were not changed.', tone: 'warning' })
      return
    }
    setBackupPromptOpen(false)
    setBackupPassphrase('')
    const items = await refreshBackups(false)
    if (items) {
      setNotice({
        text: enabled ? 'Auto-backups enabled.' : 'Auto-backups disabled.',
        tone: 'success',
      })
    } else {
      setNotice({
        text: enabled
          ? 'Auto-backups enabled, but backups could not be reloaded.'
          : 'Auto-backups disabled, but backups could not be reloaded.',
        tone: 'warning',
      })
    }
  }

  const runBackupNow = async () => {
    const response = await onCreateBackup(false)
    setNotice(response
      ? { text: response.message, tone: response.created ? 'success' : 'info' }
      : { text: 'Backup could not be created.', tone: 'error' })
    if (response?.backups) {
      setBackups(response.backups)
    }
  }

  const analyzeWorkspace = async (includeSecretSizes = false) => {
    setAnalyzing(true)
    const report = await onAnalyzeWorkspaceStorage(includeSecretSizes)
    setAnalyzing(false)
    if (report) {
      setStorageReport(report)
      setNotice({ text: 'Workspace size analysis is ready.', tone: 'success' })
    } else {
      setNotice({ text: 'Workspace size could not be analyzed.', tone: 'error' })
    }
  }

  return (
    <SettingsPanel title="Workspace + Backups" icon={<HistoryIcon className="panel-inline-icon" />}>
      <div className="settings-split-grid">
        <section className="settings-subpanel" aria-label="Workspace transfer">
          <h3>Workspace</h3>
          <div className="settings-action-row">
            <button type="button" className="drawer-button drawer-button--primary" onClick={onOpenWorkspaceExport}>
              <DownloadIcon className="drawer-inline-icon" />
              Export
            </button>
            <button type="button" className="drawer-button" onClick={onOpenWorkspaceImport}>
              <UploadIcon className="drawer-inline-icon" />
              Import
            </button>
            <button type="button" className="drawer-button" onClick={() => setAnalyzePromptOpen(true)}>
              Analyze Backup
            </button>
          </div>
        </section>

        <section className="settings-subpanel" aria-label="Auto-backups">
          <h3>Backups</h3>
          <div className="settings-action-row">
            {backupPreferences.enabled ? (
              <button type="button" className="drawer-button" onClick={() => void updateBackups(false)}>
                Disable Auto-backups
              </button>
            ) : (
              <button type="button" className="drawer-button drawer-button--primary" onClick={() => setBackupPromptOpen(true)}>
                Enable Auto-backups
              </button>
            )}
            <button type="button" className="drawer-button" disabled={!backupPreferences.enabled} onClick={() => void runBackupNow()}>
              <ClockIcon className="drawer-inline-icon" />
              Back Up Now
            </button>
            <button type="button" className="drawer-button" onClick={() => void refreshBackups(true)}>
              <RefreshIcon className="drawer-inline-icon" />
              Refresh
            </button>
            <button type="button" className="drawer-button" disabled={analyzing} onClick={() => void analyzeWorkspace(false)}>
              {analyzing ? 'Analyzing...' : 'Analyze Workspace Size'}
            </button>
          </div>
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
                  maxBackups: backupPreferences.maxBackups,
                  includeSecrets: canIncludeSecrets && event.target.checked,
                }).then((ok) => setNotice(ok
                  ? { text: 'Backup settings saved.', tone: 'success' }
                  : { text: 'Backup settings were not changed.', tone: 'warning' }))
              }
            />
            <span>Include passwords in auto-backups</span>
          </label>
        </section>
      </div>

      {analyzePromptOpen ? (
        <div className="settings-confirm-panel">
          <label className="settings-field">
            <span>Backup passphrase</span>
            <input
              type="password"
              value={bundlePassphrase}
              onChange={(event) => setBundlePassphrase(event.target.value)}
              placeholder="Workspace passphrase"
            />
          </label>
          <PassphraseStrength value={bundlePassphrase} />
          <div className="settings-action-row">
            <button type="button" className="drawer-button drawer-button--primary" disabled={!bundleReady} onClick={() => void analyzeBackup()}>
              Choose Backup to Analyze
            </button>
            <button type="button" className="drawer-button" onClick={() => setAnalyzePromptOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {backupPromptOpen ? (
        <div className="settings-confirm-panel">
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
          <div className="settings-action-row">
            <button type="button" className="drawer-button drawer-button--primary" disabled={!backupReady} onClick={() => void updateBackups(true, backupPassphrase)}>
              Enable Auto-backups
            </button>
            <button type="button" className="drawer-button" onClick={() => setBackupPromptOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <BackupList
        backups={backups}
        onDelete={(backupId) => setDeleteBackupId(backupId)}
        onRestore={(backupId) => setRestoreBackupId(backupId)}
      />
      <div className="settings-empty">
        {backups.length
          ? `${backups.length} backups | ${formatBytes(backups.reduce((total, backup) => total + backup.sizeBytes, 0))} total | ${formatBytes(Math.floor(backups.reduce((total, backup) => total + backup.sizeBytes, 0) / backups.length))} average`
          : 'No backup disk usage yet.'}
      </div>
      {storageReport ? (
        <WorkspaceStorageAnalysis report={storageReport} onIncludeSecretSizes={() => void analyzeWorkspace(true)} />
      ) : null}
      {restoreBackupId ? (
        <RestoreBackupConfirmation
          backupId={restoreBackupId}
          passphrase={restorePassphrase}
          importSecrets={restoreSecrets}
          onCancel={() => setRestoreBackupId(undefined)}
          onPassphraseChange={setRestorePassphrase}
          onImportSecretsChange={setRestoreSecrets}
          onConfirm={(backupId, passphrase, includeImportedSecrets) => {
            void onRestoreBackup(backupId, passphrase, includeImportedSecrets).then((restored) => {
              if (restored) {
                setRestoreBackupId(undefined)
                setRestorePassphrase('')
                setRestoreSecrets(false)
              }
              setNotice(restored
                ? { text: 'Backup restored.', tone: 'success' }
                : { text: 'Backup was not restored.', tone: 'warning' })
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
                setNotice({ text: 'Backup deleted.', tone: 'success' })
              } else {
                setNotice({ text: 'Backup could not be deleted.', tone: 'error' })
              }
              setDeleteBackupId(undefined)
            })
          }}
        />
      ) : null}
      <SettingsNotice notice={notice} />
    </SettingsPanel>
  )
}
