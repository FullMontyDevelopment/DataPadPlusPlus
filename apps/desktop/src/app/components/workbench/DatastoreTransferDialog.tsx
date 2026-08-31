import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ConnectionProfile,
  DatastoreTransferAction,
  DatastoreTransferCapability,
  DatastoreTransferManifest,
  DatastoreTransferSelection,
  EnvironmentProfile,
  OperationExecutionRequest,
  OperationPlan,
  OperationPlanRequest,
} from '@datapadplusplus/shared-types'
import { desktopClient } from '../../../services/runtime/client'
import {
  CloseIcon,
  ConnectionConnectedIcon,
  DownloadIcon,
  ObjectBucketIcon,
  ObjectDatabaseIcon,
  ObjectFolderIcon,
  UploadIcon,
  WarningIcon,
} from './icons'

interface DatastoreTransferDialogProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  manifest: DatastoreTransferManifest
  request: OperationPlanRequest
  runtime: 'browser' | 'tauri'
  onClose(): void
  onPlan(request: OperationPlanRequest): Promise<OperationPlan | undefined>
  onStart(request: OperationExecutionRequest): void
}

export function DatastoreTransferDialog({
  connection,
  environment,
  manifest,
  request,
  runtime,
  onClose,
  onPlan,
  onStart,
}: DatastoreTransferDialogProps) {
  const initialAction = transferAction(request)
  const [action, setAction] = useState<DatastoreTransferAction>(initialAction)
  const capability = useMemo(
    () => manifest.capabilities.find((item) => item.action === action) ?? manifest.capabilities[0],
    [action, manifest.capabilities],
  )
  const [formatId, setFormatId] = useState(capability?.formats[0]?.id ?? '')
  const [destinationKind, setDestinationKind] = useState(capability?.destinationKinds[0] ?? 'local-file')
  const [selection, setSelection] = useState<DatastoreTransferSelection>()
  const [remoteDestination, setRemoteDestination] = useState('')
  const [plan, setPlan] = useState<OperationPlan>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLElement>(null)
  const selectedFormat = capability?.formats.find((item) => item.id === formatId)
  const localDestination = destinationKind === 'local-file' || destinationKind === 'local-folder'
  const canSelectLocal = runtime === 'tauri' && localDestination
  const canReview = Boolean(
    capability
    && capability.executionSupport !== 'unsupported'
    && selectedFormat
    && (localDestination ? runtime === 'browser' || selection : remoteDestination.trim()),
  )
  const canStart = Boolean(plan && runtime === 'tauri' && capability?.executionSupport === 'live')
  const close = useCallback(async () => {
    if (busy) return
    await releaseSelection(selection)
    onClose()
  }, [busy, onClose, selection])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault()
        void close()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
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
  }, [busy, close])

  if (!capability) return null

  const selectAction = (next: DatastoreTransferCapability) => {
    void releaseSelection(selection)
    setSelection(undefined)
    setAction(next.action)
    setFormatId(next.formats[0]?.id ?? '')
    setDestinationKind(next.destinationKinds[0] ?? 'local-file')
    setRemoteDestination('')
    setPlan(undefined)
    setError('')
  }

  const chooseLocalDestination = async () => {
    if (!selectedFormat || !localDestination) return
    setBusy(true)
    setError('')
    try {
      const next = await desktopClient.selectDatastoreTransferFile({
        operationId: capability.operationId,
        connectionId: request.connectionId,
        environmentId: request.environmentId,
        action,
        destinationKind,
        formatId: selectedFormat.id,
        extensions: selectedFormat.extensions,
        suggestedFileName: suggestedFileName(request.objectName, selectedFormat.extensions[0]),
      })
      if (!next) return
      await releaseSelection(selection)
      setSelection(next)
      setPlan(undefined)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const review = async () => {
    if (!canReview || !selectedFormat) return
    setBusy(true)
    setError('')
    setPlan(undefined)
    try {
      const response = await onPlan(operationRequest())
      if (!response) {
        setError('DataPad++ could not prepare this transfer. Review the workbench messages for details.')
        return
      }
      setPlan(response)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const operationRequest = (): OperationPlanRequest => ({
    ...request,
    operationId: capability.operationId,
    parameters: {
      ...request.parameters,
      mode: action,
      format: selectedFormat?.id,
      overwrite: false,
      conflictPolicy: 'fail',
      transferSelectionId: selection?.selectionId,
      transferFileName: selection?.fileName,
      transferDestinationKind: destinationKind,
      transferDestination: localDestination ? undefined : remoteDestination.trim(),
      [action === 'import' || action === 'restore' ? 'sourcePath' : 'targetPath']:
        selection
          ? `<selected-${destinationKind}>/${selection.fileName}`
          : localDestination
            ? `<selected-${destinationKind}>.${selectedFormat?.extensions[0] ?? selectedFormat?.id ?? 'data'}`
            : remoteDestination.trim(),
    },
  })

  const start = () => {
    if (!plan || !canStart) return
    onStart({
      ...operationRequest(),
      confirmationText: plan.confirmationText,
    })
    onClose()
  }

  return (
    <div className="workbench-modal-overlay datastore-transfer-overlay" role="presentation">
      <section
        ref={dialogRef}
        className="workbench-dialog datastore-transfer-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="datastore-transfer-title"
        aria-busy={busy}
      >
        <header className="datastore-transfer-header">
          <span className="datastore-transfer-header-icon" aria-hidden="true">
            {actionIcon(action)}
          </span>
          <div>
            <p className="sidebar-eyebrow">{connection.engine} · {environment.label}</p>
            <h2 id="datastore-transfer-title">Transfer {request.objectName || 'datastore data'}</h2>
            <p>{capability.description}</p>
          </div>
          <button type="button" className="datastore-transfer-close" aria-label="Close transfer dialog" title="Close" disabled={busy} onClick={() => void close()}>
            <CloseIcon />
          </button>
        </header>

        <div className="datastore-transfer-body">
          <nav className="datastore-transfer-actions" aria-label="Transfer action">
            {manifest.capabilities.map((item) => (
              <button
                key={item.action}
                type="button"
                className={item.action === action ? 'is-active' : undefined}
                aria-pressed={item.action === action}
                aria-label={`${actionLabel(item.action)}${item.executionSupport === 'unsupported' ? ' unavailable' : ''}`}
                onClick={() => selectAction(item)}
              >
                {actionIcon(item.action)}
                <span>{actionLabel(item.action)}</span>
                {item.executionSupport === 'unsupported' ? <small>Unavailable</small> : null}
              </button>
            ))}
          </nav>

          <div className="datastore-transfer-workflow">
            <section aria-labelledby="transfer-format-heading">
              <div className="datastore-transfer-section-heading">
                <span>1</span>
                <div><h3 id="transfer-format-heading">Format and location</h3><p>Only formats declared by this adapter are available.</p></div>
              </div>
              {capability.executionSupport === 'unsupported' ? (
                <p className="datastore-transfer-callout is-warning"><WarningIcon />{capability.disabledReason}</p>
              ) : (
                <div className="datastore-transfer-fields">
                  <label>
                    <span>Format</span>
                    <select value={formatId} disabled={busy} onChange={(event) => { void releaseSelection(selection); setFormatId(event.target.value); setPlan(undefined); setSelection(undefined) }}>
                      {capability.formats.map((item) => <option key={item.id} value={item.id}>{item.label} · {fidelityLabel(item.fidelity)}</option>)}
                    </select>
                  </label>
                  <label>
                    <span>Location</span>
                    <select value={destinationKind} disabled={busy} onChange={(event) => { void releaseSelection(selection); setDestinationKind(event.target.value as typeof destinationKind); setPlan(undefined); setSelection(undefined) }}>
                      {capability.destinationKinds.map((item) => <option key={item} value={item}>{destinationLabel(item)}</option>)}
                    </select>
                  </label>
                  {localDestination ? (
                    <div className="datastore-transfer-picker">
                      <button type="button" className="drawer-button" disabled={!canSelectLocal || busy} onClick={() => void chooseLocalDestination()}>
                        <ObjectFolderIcon className="drawer-inline-icon" />
                        {selection ? 'Choose Again' : action === 'import' || action === 'restore' ? 'Choose Source' : 'Choose Destination'}
                      </button>
                      {selection ? <span><strong>{selection.fileName}</strong>{selection.sizeBytes !== undefined ? <small>{formatBytes(selection.sizeBytes)}</small> : null}</span> : null}
                      {!canSelectLocal ? <small>Live file access is available in the desktop application. You can still preview the transfer plan here.</small> : null}
                    </div>
                  ) : (
                    <label className="datastore-transfer-wide-field">
                      <span>{destinationLabel(destinationKind)}</span>
                      <input value={remoteDestination} disabled={busy} placeholder={destinationPlaceholder(destinationKind)} onChange={(event) => { setRemoteDestination(event.target.value); setPlan(undefined) }} />
                      <small>Use a server-defined integration or the connection’s cloud identity. Embedded credentials are not accepted.</small>
                    </label>
                  )}
                  {selectedFormat?.warning ? <p className="datastore-transfer-callout is-warning"><WarningIcon />{selectedFormat.warning}</p> : null}
                </div>
              )}
            </section>

            <section aria-labelledby="transfer-review-heading">
              <div className="datastore-transfer-section-heading">
                <span>2</span>
                <div><h3 id="transfer-review-heading">Validate and review</h3><p>No existing data will be overwritten.</p></div>
              </div>
              {plan ? (
                <div className="datastore-transfer-review">
                  <p className="datastore-transfer-callout is-ready"><ConnectionConnectedIcon />Validation completed. Review the native request and warnings before starting.</p>
                  <dl>
                    <div><dt>Target</dt><dd>{request.objectName || 'Current datastore scope'}</dd></div>
                    <div><dt>Conflict policy</dt><dd>Fail safely</dd></div>
                    <div><dt>Execution</dt><dd>{capability.executionSupport === 'live' ? 'Available' : 'Plan only'}</dd></div>
                  </dl>
                  <pre>{plan.generatedRequest}</pre>
                  {plan.warnings.map((warning) => <p className="datastore-transfer-callout is-warning" key={warning}><WarningIcon />{warning}</p>)}
                  {capability.executionSupport !== 'live' ? <p className="datastore-transfer-callout is-warning"><WarningIcon />{capability.disabledReason}</p> : null}
                </div>
              ) : <p className="datastore-transfer-empty">Choose a format and location, then validate the transfer.</p>}
            </section>
          </div>
          {error ? <p className="workspace-transfer-error" role="alert">{error}</p> : null}
        </div>

        <footer className="workbench-dialog-actions datastore-transfer-footer">
          <button type="button" className="drawer-button" disabled={busy} onClick={() => void close()}>Cancel</button>
          <button type="button" className="drawer-button" disabled={!canReview || busy} onClick={() => void review()}>
            {busy ? 'Validating…' : plan ? runtime === 'browser' ? 'Preview Again' : 'Validate Again' : runtime === 'browser' ? 'Preview Plan' : 'Validate Transfer'}
          </button>
          <button type="button" className="drawer-button drawer-button--primary" disabled={!canStart || busy} onClick={start}>
            {actionIcon(action)}
            Start {actionLabel(action)}
          </button>
        </footer>
      </section>
    </div>
  )
}

async function releaseSelection(selection?: DatastoreTransferSelection) {
  if (!selection) return
  await desktopClient.cancelDatastoreTransferSelection({ selectionId: selection.selectionId }).catch(() => false)
}

function transferAction(request: OperationPlanRequest): DatastoreTransferAction {
  const mode = request.parameters?.mode
  if (mode === 'import' || mode === 'export' || mode === 'backup' || mode === 'restore') return mode
  if (request.operationId.endsWith('.import')) return 'import'
  if (request.operationId.endsWith('.backup')) return 'backup'
  if (request.operationId.endsWith('.restore')) return 'restore'
  return 'export'
}

function actionIcon(action: DatastoreTransferAction) {
  if (action === 'import') return <UploadIcon />
  if (action === 'export') return <DownloadIcon />
  if (action === 'backup') return <ObjectDatabaseIcon />
  return <ObjectBucketIcon />
}

function actionLabel(action: DatastoreTransferAction) {
  return action.charAt(0).toUpperCase() + action.slice(1)
}

function fidelityLabel(value: DatastoreTransferCapability['formats'][number]['fidelity']) {
  return value === 'native' ? 'Native' : value === 'portable-lossy' ? 'Portable, possible type loss' : 'Portable'
}

function destinationLabel(value: DatastoreTransferCapability['destinationKinds'][number]) {
  const labels: Record<typeof value, string> = {
    'local-file': 'Local file', 'local-folder': 'Local folder', 'server-path': 'Server path',
    'cloud-uri': 'Cloud storage URI', 'named-stage': 'Named stage', repository: 'Snapshot repository',
    'managed-restore': 'Managed backup or restore',
  }
  return labels[value]
}

function destinationPlaceholder(value: DatastoreTransferCapability['destinationKinds'][number]) {
  if (value === 'named-stage') return '@stage/path'
  if (value === 'repository') return 'repository/snapshot-name'
  if (value === 'server-path') return 'Server-visible path or directory object'
  if (value === 'managed-restore') return 'Managed backup identifier'
  return 's3://, gs://, or supported cloud destination'
}

function suggestedFileName(objectName: string | undefined, extension: string | undefined) {
  const base = (objectName || 'datastore-export').replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'datastore-export'
  return extension ? `${base}.${extension}` : base
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : 'The datastore transfer could not be prepared.'
}
