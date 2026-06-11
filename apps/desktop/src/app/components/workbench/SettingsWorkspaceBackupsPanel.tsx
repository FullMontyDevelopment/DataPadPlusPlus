import { useEffect, useState } from 'react'
import type {
  AppHealth,
  WorkspaceBackupRunResponse,
  WorkspaceBackupSummary,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { canUseWorkspaceBundlePassphrase } from '../../security/workspace-passphrase'
import { ClockIcon, DownloadIcon, HistoryIcon, RefreshIcon, UploadIcon } from './icons'
import { DeleteConfirmationPanel } from './results/DeleteConfirmationPanel'
import {
  BackupList,
  PassphraseStrength,
  RestoreBackupConfirmation,
  SettingsPanel,
} from './SettingsWorkspace.parts'

type BundleTask = 'export' | 'import'

export interface SettingsWorkspaceBackupsProps {
  health: AppHealth
  preferences: WorkspaceSnapshot['preferences']
  onCreateBackup(automatic?: boolean): Promise<WorkspaceBackupRunResponse | undefined>
  onDeleteBackup(backupId: string): Promise<WorkspaceBackupSummary[] | undefined>
  onExportWorkspaceFile(passphrase: string, includeSecrets: boolean): Promise<string | undefined>
  onImportWorkspaceFile(passphrase: string): Promise<void>
  onListBackups(): Promise<WorkspaceBackupSummary[] | undefined>
  onRestoreBackup(backupId: string, passphrase: string): Promise<void>
  onUpdateBackupSettings(request: {
    enabled: boolean
    passphrase?: string
    intervalMinutes?: number
    maxBackups?: number
    includeSecrets?: boolean
  }): Promise<boolean>
}

export function SettingsWorkspaceBackupsPanel({
  health,
  preferences,
  onCreateBackup,
  onDeleteBackup,
  onExportWorkspaceFile,
  onImportWorkspaceFile,
  onListBackups,
  onRestoreBackup,
  onUpdateBackupSettings,
}: SettingsWorkspaceBackupsProps) {
  const [bundleTask, setBundleTask] = useState<BundleTask>()
  const [bundlePassphrase, setBundlePassphrase] = useState('')
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [backupPassphrase, setBackupPassphrase] = useState('')
  const [backupPromptOpen, setBackupPromptOpen] = useState(false)
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
  const backupReady = canUseWorkspaceBundlePassphrase(backupPassphrase)

  useEffect(() => {
    let mounted = true
    void onListBackups().then((items) => {
      if (!mounted) return
      if (items) {
        setBackups(items)
      } else {
        setMessage('Backups could not be loaded.')
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
      setMessage('Backups refreshed.')
    } else {
      setMessage('Backups could not be loaded.')
    }
  }

  const finishBundleTask = async () => {
    if (!bundleTask) return

    if (bundleTask === 'export') {
      const path = await onExportWorkspaceFile(bundlePassphrase, canIncludeSecrets && includeSecrets)
      setMessage(path ? 'Workspace exported.' : 'Export canceled.')
    } else {
      await onImportWorkspaceFile(bundlePassphrase)
      setMessage('Workspace import finished.')
    }
    setBundleTask(undefined)
    setBundlePassphrase('')
    setIncludeSecrets(false)
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
      setMessage('Backup settings were not changed.')
      return
    }
    setBackupPromptOpen(false)
    setBackupPassphrase('')
    setMessage(enabled ? 'Auto-backups enabled.' : 'Auto-backups disabled.')
    await refreshBackups()
  }

  const runBackupNow = async () => {
    const response = await onCreateBackup(false)
    setMessage(response?.message ?? 'Backup could not be created.')
    if (response?.backups) {
      setBackups(response.backups)
    }
  }

  return (
    <SettingsPanel title="Workspace + Backups" icon={<HistoryIcon className="panel-inline-icon" />}>
      <div className="settings-split-grid">
        <section className="settings-subpanel" aria-label="Workspace transfer">
          <h3>Workspace</h3>
          <div className="settings-action-row">
            <button type="button" className="drawer-button drawer-button--primary" onClick={() => setBundleTask('export')}>
              <DownloadIcon className="drawer-inline-icon" />
              Export
            </button>
            <button type="button" className="drawer-button" onClick={() => setBundleTask('import')}>
              <UploadIcon className="drawer-inline-icon" />
              Import
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
            <button type="button" className="drawer-button" onClick={() => void refreshBackups()}>
              <RefreshIcon className="drawer-inline-icon" />
              Refresh
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
                }).then((ok) => setMessage(ok ? 'Backup settings saved.' : 'Backup settings were not changed.'))
              }
            />
            <span>Include passwords in auto-backups</span>
          </label>
        </section>
      </div>

      {bundleTask ? (
        <div className="settings-confirm-panel">
          <label className="settings-field">
            <span>{bundleTask === 'export' ? 'Export passphrase' : 'Import passphrase'}</span>
            <input
              type="password"
              value={bundlePassphrase}
              onChange={(event) => setBundlePassphrase(event.target.value)}
              placeholder="Workspace passphrase"
            />
          </label>
          <PassphraseStrength value={bundlePassphrase} />
          {bundleTask === 'export' ? (
            <label className="settings-check-row">
              <input
                type="checkbox"
                checked={canIncludeSecrets && includeSecrets}
                disabled={!canIncludeSecrets}
                onChange={(event) => setIncludeSecrets(event.target.checked)}
              />
              <span>Include passwords</span>
            </label>
          ) : null}
          <div className="settings-action-row">
            <button type="button" className="drawer-button drawer-button--primary" disabled={!bundleReady} onClick={() => void finishBundleTask()}>
              {bundleTask === 'export' ? 'Export Workspace' : 'Import Workspace'}
            </button>
            <button type="button" className="drawer-button" onClick={() => setBundleTask(undefined)}>
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
              if (items) setBackups(items)
              setDeleteBackupId(undefined)
            })
          }}
        />
      ) : null}
      {message ? <div className="settings-inline-message" role="status">{message}</div> : null}
    </SettingsPanel>
  )
}
