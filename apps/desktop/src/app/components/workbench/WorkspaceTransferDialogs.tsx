import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type {
  WorkspaceBundleFileExportResponse,
  WorkspaceImportCommitResponse,
  WorkspaceImportPreview,
  WorkspaceImportSelection,
} from '@datapadplusplus/shared-types'
import type { WorkspaceTransferOutcome } from '../../state/app-state-types'
import { canUseWorkspaceBundlePassphrase } from '../../security/workspace-passphrase'
import { DownloadIcon, HideIcon, ShowIcon, UploadIcon } from './icons'
import { PassphraseStrength } from './SettingsWorkspace.parts'

type ImportStep = 'choose' | 'unlock' | 'review'

interface WorkspaceImportDialogProps {
  canImportSecrets: boolean
  currentWorkspaceName: string
  onCancelSelection(selectionId: string): Promise<boolean>
  onClose(): void
  onCommit(request: {
    selectionId: string
    workspaceRevision: number
    importSecrets: boolean
    importAsNew: boolean
    workspaceName?: string
  }): Promise<WorkspaceTransferOutcome<WorkspaceImportCommitResponse>>
  onCompleted(workspaceName: string, refreshWarning?: string): void
  onPreview(request: {
    selectionId: string
    passphrase: string
  }): Promise<WorkspaceTransferOutcome<WorkspaceImportPreview>>
  onSelectFile(): Promise<WorkspaceTransferOutcome<WorkspaceImportSelection>>
}

export function WorkspaceImportDialog({
  canImportSecrets,
  currentWorkspaceName,
  onCancelSelection,
  onClose,
  onCommit,
  onCompleted,
  onPreview,
  onSelectFile,
}: WorkspaceImportDialogProps) {
  const [step, setStep] = useState<ImportStep>('choose')
  const [selection, setSelection] = useState<WorkspaceImportSelection>()
  const [preview, setPreview] = useState<WorkspaceImportPreview>()
  const [passphrase, setPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('Imported Workspace')
  const [importAsNew, setImportAsNew] = useState(true)
  const [importSecrets, setImportSecrets] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const initialButtonRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)

  const close = async () => {
    if (busy) return
    if (selection) {
      await onCancelSelection(selection.selectionId)
    }
    onClose()
  }

  useEffect(() => {
    initialButtonRef.current?.focus()
  }, [])
  useWorkspaceDialogKeyboard(dialogRef, () => void close(), busy)

  const chooseFile = async () => {
    setBusy(true)
    setError('')
    const result = await onSelectFile()
    setBusy(false)
    if (result.status === 'failed') {
      setError(result.message)
      return
    }
    if (result.status === 'canceled') return
    if (selection) {
      await onCancelSelection(selection.selectionId)
    }
    setSelection(result.value)
    setPreview(undefined)
    setPassphrase('')
    setStep('unlock')
  }

  const unlock = async () => {
    if (!selection) return
    setBusy(true)
    setError('')
    const result = await onPreview({ selectionId: selection.selectionId, passphrase })
    setBusy(false)
    if (result.status === 'failed') {
      setError(result.message)
      return
    }
    if (result.status === 'canceled') return
    setPreview(result.value)
    setWorkspaceName(result.value.suggestedWorkspaceName)
    setImportSecrets(false)
    setStep('review')
  }

  const commit = async () => {
    if (!preview) return
    const normalizedName = workspaceName.trim()
    if (importAsNew && (!normalizedName || normalizedName.length > 80)) {
      setError('Enter a workspace name between 1 and 80 characters.')
      return
    }
    setBusy(true)
    setError('')
    const result = await onCommit({
      selectionId: preview.selectionId,
      workspaceRevision: preview.workspaceRevision,
      importSecrets: canImportSecrets && preview.includesSecrets && importSecrets,
      importAsNew,
      workspaceName: importAsNew ? normalizedName : undefined,
    })
    setBusy(false)
    if (result.status === 'failed') {
      setError(result.message)
      return
    }
    if (result.status === 'canceled') return
    onCompleted(
      importAsNew ? normalizedName : currentWorkspaceName,
      result.value.registryRefreshWarning,
    )
    onClose()
  }

  return (
    <div className="workbench-modal-overlay workspace-transfer-overlay" role="presentation">
      <section
        ref={dialogRef}
        className="workbench-dialog workspace-transfer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-import-dialog-title"
        aria-busy={busy}
      >
        <header className="workspace-transfer-header">
          <span className="workspace-transfer-icon" aria-hidden="true">
            <UploadIcon />
          </span>
          <div>
            <p className="sidebar-eyebrow">Workspace Import</p>
            <h2 id="workspace-import-dialog-title">Import a workspace</h2>
          </div>
        </header>

        <ol className="workspace-transfer-steps" aria-label="Import progress">
          {(['choose', 'unlock', 'review'] as const).map((item, index) => (
            <li key={item} className={step === item ? 'is-active' : undefined}>
              <span>{index + 1}</span>
              {item === 'choose' ? 'Choose File' : item === 'unlock' ? 'Unlock' : 'Review'}
            </li>
          ))}
        </ol>

        <div className="workspace-transfer-body">
          {step === 'choose' ? (
            <div className="workspace-transfer-section">
              <p>Select an encrypted DataPad++ workspace bundle. Its contents stay locked until you enter the passphrase.</p>
              <button
                ref={initialButtonRef}
                type="button"
                className="drawer-button drawer-button--primary"
                disabled={busy}
                onClick={() => void chooseFile()}
              >
                <UploadIcon className="drawer-inline-icon" />
                {busy ? 'Opening…' : 'Choose Workspace File'}
              </button>
            </div>
          ) : null}

          {step === 'unlock' && selection ? (
            <div className="workspace-transfer-section">
              <FileSummary selection={selection} />
              <label className="workspace-transfer-field">
                <span>Passphrase</span>
                <span className="workspace-transfer-secret-input">
                  <input
                    autoFocus
                    type={showPassphrase ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={passphrase}
                    disabled={busy}
                    onChange={(event) => {
                      setPassphrase(event.target.value)
                      setError('')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && canUseWorkspaceBundlePassphrase(passphrase)) {
                        void unlock()
                      }
                    }}
                  />
                  <button
                    type="button"
                    aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                    title={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                    onClick={() => setShowPassphrase((value) => !value)}
                  >
                    {showPassphrase ? <HideIcon /> : <ShowIcon />}
                  </button>
                </span>
              </label>
              <p className="workspace-transfer-hint">A wrong passphrase can be retried without choosing the file again.</p>
            </div>
          ) : null}

          {step === 'review' && preview ? (
            <div className="workspace-transfer-section">
              <FileSummary selection={preview} />
              <dl className="workspace-transfer-summary">
                <div><dt>Connections</dt><dd>{preview.connections}</dd></div>
                <div><dt>Environments</dt><dd>{preview.environments}</dd></div>
                <div><dt>Open / closed tabs</dt><dd>{preview.openTabs} / {preview.closedTabs}</dd></div>
                <div><dt>Saved items</dt><dd>{preview.savedItems}</dd></div>
                <div><dt>Format / schema</dt><dd>{preview.formatVersion} / {preview.workspaceSchemaVersion}</dd></div>
                <div><dt>Unlocked size</dt><dd>{formatBytes(preview.decryptedSizeBytes)}</dd></div>
              </dl>
              {preview.warnings.map((warning) => (
                <p key={warning} className="workspace-transfer-warning">{warning}</p>
              ))}

              <fieldset className="workspace-transfer-modes">
                <legend>Import destination</legend>
                <label className={importAsNew ? 'is-selected' : undefined}>
                  <input type="radio" checked={importAsNew} disabled={busy} onChange={() => setImportAsNew(true)} />
                  <span><strong>Create New Workspace</strong><small>Recommended. Keeps the current workspace unchanged.</small></span>
                </label>
                <label className={!importAsNew ? 'is-selected is-destructive' : undefined}>
                  <input type="radio" checked={!importAsNew} disabled={busy} onChange={() => setImportAsNew(false)} />
                  <span><strong>Replace Current Workspace</strong><small>Replaces “{currentWorkspaceName}” after creating a recovery copy.</small></span>
                </label>
              </fieldset>

              {importAsNew ? (
                <label className="workspace-transfer-field">
                  <span>Workspace name</span>
                  <input
                    aria-label="Workspace name"
                    value={workspaceName}
                    maxLength={80}
                    disabled={busy}
                    onChange={(event) => {
                      setWorkspaceName(event.target.value)
                      setError('')
                    }}
                  />
                  <small>{workspaceName.trim().length}/80 characters</small>
                </label>
              ) : (
                <p className="workspace-transfer-destructive-copy">
                  This action is destructive. If validation or secure-storage writes fail, the current workspace remains unchanged.
                </p>
              )}

              {preview.includesSecrets ? (
                <label className="workspace-transfer-check">
                  <input
                    type="checkbox"
                    checked={canImportSecrets && importSecrets}
                    disabled={!canImportSecrets || busy}
                    onChange={(event) => setImportSecrets(event.target.checked)}
                  />
                  <span>Import {preview.secretCount} included password{preview.secretCount === 1 ? '' : 's'} and secret{preview.secretCount === 1 ? '' : 's'}</span>
                </label>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="workspace-transfer-error" role="alert">{error}</p> : null}
        </div>

        <footer className="workbench-dialog-actions workspace-transfer-actions">
          <button type="button" className="drawer-button" disabled={busy} onClick={() => void close()}>
            Cancel
          </button>
          {step !== 'choose' ? (
            <button
              type="button"
              className="drawer-button"
              disabled={busy}
              onClick={() => {
                setError('')
                setStep(step === 'review' ? 'unlock' : 'choose')
              }}
            >
              Back
            </button>
          ) : null}
          {step === 'unlock' ? (
            <button
              type="button"
              className="drawer-button drawer-button--primary"
              disabled={busy || !canUseWorkspaceBundlePassphrase(passphrase)}
              onClick={() => void unlock()}
            >
              {busy ? 'Unlocking…' : 'Unlock and Review'}
            </button>
          ) : null}
          {step === 'review' ? (
            <button
              type="button"
              className={`drawer-button ${importAsNew ? 'drawer-button--primary' : 'drawer-button--danger'}`}
              disabled={busy || (importAsNew && (!workspaceName.trim() || workspaceName.trim().length > 80))}
              onClick={() => void commit()}
            >
              {busy ? 'Importing…' : importAsNew ? 'Create and Import' : 'Replace Current Workspace'}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  )
}

interface WorkspaceExportDialogProps {
  canIncludeSecrets: boolean
  onClose(): void
  onCompleted(): void
  onExport(passphrase: string, includeSecrets: boolean): Promise<WorkspaceTransferOutcome<WorkspaceBundleFileExportResponse>>
  workspaceName: string
}

export function WorkspaceExportDialog({
  canIncludeSecrets,
  onClose,
  onCompleted,
  onExport,
  workspaceName,
}: WorkspaceExportDialogProps) {
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassphrases, setShowPassphrases] = useState(false)
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const ready = canUseWorkspaceBundlePassphrase(passphrase) && passphrase === confirmation
  useWorkspaceDialogKeyboard(dialogRef, onClose, busy)

  const submit = async () => {
    setBusy(true)
    setMessage('')
    const result = await onExport(passphrase, canIncludeSecrets && includeSecrets)
    setBusy(false)
    if (result.status === 'completed') {
      onCompleted()
      onClose()
    } else if (result.status === 'canceled') {
      setMessage('No file was saved. You can choose a location again.')
    } else {
      setMessage(result.message)
    }
  }

  return (
    <div className="workbench-modal-overlay workspace-transfer-overlay" role="presentation">
      <section ref={dialogRef} className="workbench-dialog workspace-transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-export-dialog-title" aria-busy={busy}>
        <header className="workspace-transfer-header">
          <span className="workspace-transfer-icon" aria-hidden="true"><DownloadIcon /></span>
          <div>
            <p className="sidebar-eyebrow">Workspace Export</p>
            <h2 id="workspace-export-dialog-title">Export {workspaceName}</h2>
          </div>
        </header>
        <div className="workspace-transfer-body workspace-transfer-section">
          <p>The workspace is compressed, encrypted, and authenticated before you choose where to save it.</p>
          <label className="workspace-transfer-check">
            <input type="checkbox" checked={canIncludeSecrets && includeSecrets} disabled={!canIncludeSecrets || busy} onChange={(event) => setIncludeSecrets(event.target.checked)} />
            <span>Include saved passwords and secrets</span>
          </label>
          {!canIncludeSecrets ? <p className="workspace-transfer-hint">Browser exports never include passwords.</p> : null}
          <label className="workspace-transfer-field">
            <span>Passphrase</span>
            <span className="workspace-transfer-secret-input">
              <input autoFocus type={showPassphrases ? 'text' : 'password'} autoComplete="new-password" value={passphrase} disabled={busy} onChange={(event) => { setPassphrase(event.target.value); setMessage('') }} />
              <button type="button" aria-label={showPassphrases ? 'Hide passphrases' : 'Show passphrases'} title={showPassphrases ? 'Hide passphrases' : 'Show passphrases'} onClick={() => setShowPassphrases((value) => !value)}>
                {showPassphrases ? <HideIcon /> : <ShowIcon />}
              </button>
            </span>
          </label>
          <PassphraseStrength value={passphrase} />
          <label className="workspace-transfer-field">
            <span>Confirm passphrase</span>
            <input type={showPassphrases ? 'text' : 'password'} autoComplete="new-password" value={confirmation} disabled={busy} onChange={(event) => { setConfirmation(event.target.value); setMessage('') }} />
          </label>
          {confirmation && confirmation !== passphrase ? <p className="workspace-transfer-error" role="alert">The passphrases do not match.</p> : null}
          <div className="workspace-transfer-security-summary">
            <strong>AES-256-GCM encrypted</strong>
            <span>DataPad++ does not store this passphrase. Keep it somewhere safe.</span>
          </div>
          {message ? <p className="workspace-transfer-error" role="status">{message}</p> : null}
        </div>
        <footer className="workbench-dialog-actions workspace-transfer-actions">
          <button type="button" className="drawer-button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className="drawer-button drawer-button--primary" disabled={busy || !ready} onClick={() => void submit()}>
            <DownloadIcon className="drawer-inline-icon" />
            {busy ? 'Preparing…' : 'Choose Location and Export'}
          </button>
        </footer>
      </section>
    </div>
  )
}

function FileSummary({ selection }: { selection: { fileName: string; encryptedSizeBytes: number } }) {
  return (
    <div className="workspace-transfer-file-summary">
      <span aria-hidden="true"><UploadIcon /></span>
      <div><strong>{selection.fileName}</strong><small>{formatBytes(selection.encryptedSizeBytes)} encrypted</small></div>
    </div>
  )
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function useWorkspaceDialogKeyboard(
  dialogRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
  disabled: boolean,
) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !disabled) {
        event.preventDefault()
        onEscape()
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((element) => !element.hasAttribute('hidden'))
      if (!focusable.length) return
      const first = focusable.at(0)
      const last = focusable.at(-1)
      if (!first || !last) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [dialogRef, disabled, onEscape])
}
