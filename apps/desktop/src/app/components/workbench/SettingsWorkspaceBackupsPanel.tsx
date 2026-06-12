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
  SettingsNotice,
  type SettingsNoticeMessage,
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
  const [notice, setNotice] = useState<SettingsNoticeMessage>()
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

  const finishBundleTask = async () => {
    if (!bundleTask) return

    if (bundleTask === 'export') {
      const path = await onExportWorkspaceFile(bundlePassphrase, canIncludeSecrets && includeSecrets)
      setNotice(path
        ? { text: 'Workspace exported.', tone: 'success' }
        : { text: 'Export canceled.', tone: 'info' })
    } else {
      await onImportWorkspaceFile(bundlePassphrase)
      setNotice({ text: 'Workspace import finished.', tone: 'success' })
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
            <button type="button" className="drawer-button" onClick={() => void refreshBackups(true)}>
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
                }).then((ok) => setNotice(ok
                  ? { text: 'Backup settings saved.', tone: 'success' }
                  : { text: 'Backup settings were not changed.', tone: 'warning' }))
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
              setNotice({ text: 'Backup restored.', tone: 'success' })
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
