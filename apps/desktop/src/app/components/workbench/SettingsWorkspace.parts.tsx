import type { ReactNode } from 'react'
import type { WorkspaceBackupSummary } from '@datapadplusplus/shared-types'
import { rateWorkspaceBundlePassphrase } from '../../security/workspace-passphrase'
import { DeleteConfirmationPanel } from './results/DeleteConfirmationPanel'
import { TrashIcon, UploadIcon } from './icons'

export type SettingsNoticeTone = 'info' | 'success' | 'warning' | 'error'

export interface SettingsNoticeMessage {
  text: string
  tone?: SettingsNoticeTone
}

export function SettingsPanel({
  children,
  icon,
  title,
  tourId,
}: {
  children: ReactNode
  icon: ReactNode
  title: string
  tourId?: string
}) {
  return (
    <section className="settings-panel">
      <header className="settings-panel-header" data-tour-id={tourId}>
        {icon}
        <h2>{title}</h2>
      </header>
      {children}
    </section>
  )
}

export function SettingsNotice({ notice }: { notice?: SettingsNoticeMessage }) {
  if (!notice?.text) {
    return null
  }

  const tone = notice.tone ?? 'info'
  return (
    <div
      className={`settings-inline-message settings-inline-message--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {notice.text}
    </div>
  )
}

export function PassphraseStrength({ value }: { value: string }) {
  if (!value) {
    return null
  }
  const strength = rateWorkspaceBundlePassphrase(value)
  return (
    <div className={`settings-passphrase-strength settings-passphrase-strength--${strength.tone}`}>
      <span className="settings-passphrase-meter" aria-hidden="true">
        <span style={{ width: `${strength.tone === 'blocked' ? 100 : Math.max(8, strength.score * 25)}%` }} />
      </span>
      <span className="settings-passphrase-copy">
        <strong>{strength.label}</strong>
        <span>{strength.hints[0]}</span>
      </span>
    </div>
  )
}

export function BackupList({
  backups,
  onDelete,
  onRestore,
}: {
  backups: WorkspaceBackupSummary[]
  onDelete(backupId: string): void
  onRestore(backupId: string): void
}) {
  if (!backups.length) {
    return <div className="settings-empty">No backups yet.</div>
  }

  return (
    <div className="settings-table" role="table" aria-label="Workspace backups">
      <div className="settings-table-row settings-table-row--header" role="row">
        <span>Created</span>
        <span>Size</span>
        <span>Passwords</span>
        <span />
      </div>
      {backups.map((backup) => (
        <div key={backup.id} className="settings-table-row" role="row">
          <span>{formatDate(backup.createdAt)}</span>
          <span>{formatBytes(backup.sizeBytes)}</span>
          <span>{backup.includesSecrets ? backup.secretCount ?? 'Yes' : 'No'}</span>
          <span className="settings-table-actions">
            <button type="button" className="icon-button" aria-label={`Restore ${backup.fileName}`} onClick={() => onRestore(backup.id)}>
              <UploadIcon className="panel-inline-icon" />
            </button>
            <button type="button" className="icon-button" aria-label={`Delete ${backup.fileName}`} onClick={() => onDelete(backup.id)}>
              <TrashIcon className="panel-inline-icon" />
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

export function RestoreBackupConfirmation({
  backupId,
  passphrase,
  onCancel,
  onConfirm,
  onPassphraseChange,
}: {
  backupId: string
  passphrase: string
  onCancel(): void
  onConfirm(backupId: string, passphrase: string): void
  onPassphraseChange(value: string): void
}) {
  return (
    <div className="settings-confirm-panel">
      <label className="settings-field">
        <span>Restore passphrase</span>
        <input
          type="password"
          value={passphrase}
          onChange={(event) => onPassphraseChange(event.target.value)}
          placeholder="Backup password"
        />
      </label>
      <DeleteConfirmationPanel
        title="Restore backup?"
        body="This replaces the current workspace with the selected backup."
        confirmLabel="Restore"
        onCancel={onCancel}
        onConfirm={() => onConfirm(backupId, passphrase)}
      />
    </div>
  )
}

export function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function formatDate(value: string) {
  const numeric = Number(value)
  const date = Number.isFinite(numeric) ? new Date(numeric * 1000) : new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function formatBytes(value: number) {
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
