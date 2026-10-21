import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ExecutionResultEnvelope,
  ExportResultFileRequest,
  ResultPayload,
  ResultExportContext,
} from '@datapadplusplus/shared-types'
import {
  createResultExportFileReference,
  defaultExportOptionForPayload,
  exportOptionsForPayload,
  fullQueryExportOptions,
  type ResultExportFormat,
} from './payload-export'
import { createResultExportFileInBackground } from './payload-export-background'
import { isTauriRuntime } from '../../../../services/runtime/desktop-bridge'
import { desktopClient } from '../../../../services/runtime/client'
import { listen } from '@tauri-apps/api/event'

interface ResultExportDialogProps {
  payload: ResultPayload
  result?: ExecutionResultEnvelope
  tabId?: string
  onCancel(): void
  onExport(request: ExportResultFileRequest): Promise<void>
}

export function ResultExportDialog({
  payload,
  result,
  tabId,
  onCancel,
  onExport,
}: ResultExportDialogProps) {
  const [scope, setScope] = useState<'loaded' | 'full-query'>('loaded')
  const options = useMemo(() => scope === 'full-query' ? fullQueryExportOptions() : exportOptionsForPayload(payload), [payload, scope])
  const [format, setFormat] = useState<ResultExportFormat>(
    defaultExportOptionForPayload(payload).format,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const resultId = result?.id
  const contextKey = tabId && resultId ? JSON.stringify([tabId, resultId]) : undefined
  const [contextState, setContextState] = useState<{ key: string; value?: ResultExportContext; failed?: boolean }>()
  const contextPending = contextKey !== undefined && contextState?.key !== contextKey
  const contextFailed = !contextPending && contextState?.failed === true
  const context = contextState?.key === contextKey ? contextState?.value : undefined
  const [exportId] = useState(() => `result-export-${crypto.randomUUID()}`)
  const [exportedRows, setExportedRows] = useState(0)
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    dialogRef.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus()
    return () => { if (origin?.isConnected) origin.focus() }
  }, [])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) { event.preventDefault(); onCancel() }
      if (event.key !== 'Tab') return
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])
      const first = elements[0]
      const last = elements.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, saving])
  useEffect(() => {
    if (!isTauriRuntime()) return
    let disposed = false
    const subscription = listen<{ exportId: string; exportedRows: number }>('datapad://result-export-progress', event => {
      if (!disposed && event.payload.exportId === exportId) setExportedRows(event.payload.exportedRows)
    })
    void subscription.catch(() => { /* Final export outcome remains available without progress events. */ })
    return () => { disposed = true; void subscription.then(unlisten => unlisten()).catch(() => {}) }
  }, [exportId])
  const documentSource = payload.renderer === 'json' ? result?.payloads.find(item => item.renderer === 'document') : undefined
  const count = payload.renderer === 'document' ? payload.documents.length : payload.renderer === 'table' ? payload.rows.length
    : documentSource?.renderer === 'document' ? documentSource.documents.length : undefined
  useEffect(() => {
    if (!tabId || !resultId || !contextKey) return
    let canceled = false
    void desktopClient.getResultExportContext(tabId, resultId).then(
      value => {
        if (!canceled) {
          setContextState({ key: contextKey, value })
        }
      },
      () => {
        if (!canceled) {
          setContextState({ key: contextKey, failed: true })
        }
      },
    )
    return () => { canceled = true }
  }, [tabId, resultId, contextKey])
  const selectedOption =
    options.find((option) => option.format === format) ?? options[0]

  if (!selectedOption) {
    return null
  }

  const save = async () => {
    setSaving(true)
    setError('')

    try {
      const canStreamCanonicalResult =
        isTauriRuntime() &&
        (scope === 'full-query' || payload.renderer === 'document' || payload.renderer === 'table' || documentSource !== undefined) &&
        result &&
        tabId &&
        (selectedOption.format === 'json' || selectedOption.format === 'ndjson' || selectedOption.format === 'csv')
      const exportPayload = !isTauriRuntime() && context?.maximumExportedRows != null
        ? limitPreviewPayload(payload, context.maximumExportedRows)
        : payload
      const request = canStreamCanonicalResult
        ? createResultExportFileReference(
            payload,
            result,
            tabId,
            selectedOption as typeof selectedOption & { format: 'json' | 'ndjson' | 'csv' },
          )
        : await createResultExportFileInBackground(exportPayload, result, selectedOption)
      if (request.resultReference) request.resultReference.scope = scope
      if (!isTauriRuntime() && count !== undefined) {
        request.preparedResult = {
          rowCount: exportPayload.renderer === 'document' ? exportPayload.documents.length : exportPayload.renderer === 'table' ? exportPayload.rows.length : count,
          sourceRowCount: count,
        }
      }
      request.exportId = exportId
      await onExport(request)
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : 'Unable to export the result.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        ref={dialogRef}
        className="workbench-dialog result-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export result"
      >
        <h2>Export Result</h2>
        <fieldset disabled={saving} className="result-export-format-grid">
          <legend>Export source</legend>
          <label><input type="radio" name="result-export-source" checked={scope === 'loaded'} onChange={() => setScope('loaded')} /> Loaded results{count === undefined ? '' : ` (${count.toLocaleString()})`}</label>
          <label title={context?.fullQuerySupported ? 'Re-run the original read-only query' : 'Native full-query streaming is unavailable for this result.'}>
            <input type="radio" name="result-export-source" checked={scope === 'full-query'}
              disabled={!isTauriRuntime() || !context?.fullQuerySupported}
              onChange={() => setScope('full-query')} /> Full query results
          </label>
        </fieldset>
        {context ? <p>{[context.connectionName, context.environmentName, context.database, context.schema].filter(Boolean).join(' / ')}</p> : null}
        {context?.maximumLoadedRows != null ? <p>Results view limit: {context.maximumLoadedRows.toLocaleString()} rows. This does not limit full-query exports.</p> : null}
        {scope === 'full-query' ? <p>Runs the original query again; data may have changed. Explicit query limits still apply. Your current editor draft is not used.</p> : null}
        {context?.maximumExportedRows != null ? <p>Export limit: {context.maximumExportedRows.toLocaleString()} rows. Larger results will be reported as limited.</p> : null}
        <div className="result-export-format-grid" role="radiogroup" aria-label="Export format">
          {options.map((option) => (
            <button
              key={option.format}
              type="button"
              disabled={saving}
              role="radio"
              aria-checked={selectedOption.format === option.format}
              className={`result-export-format${selectedOption.format === option.format ? ' is-active' : ''}`}
              onClick={() => setFormat(option.format)}
            >
              <span>{option.label}</span>
              <small>{option.description}</small>
            </button>
          ))}
        </div>

        {error ? <p className="dialog-error">{error}</p> : null}
        {contextFailed ? <p className="dialog-error" role="alert">Result export context is unavailable. Run the query again before exporting.</p> : null}
        {saving ? <p role="status">Exporting… {exportedRows.toLocaleString()} rows written</p> : null}

        <div className="workbench-dialog-actions">
          {saving && isTauriRuntime() ? <button type="button" className="drawer-button" onClick={onCancel}>Run in background</button> : null}
          <button type="button" className="drawer-button" onClick={() => {
            if (saving) void desktopClient.cancelResultExport(exportId).catch(() => setError('Unable to cancel the export. Try again.'))
            else onCancel()
          }}>
            {saving ? 'Cancel export' : 'Cancel'}
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            disabled={saving || contextPending || contextFailed || (scope === 'full-query' && !context?.fullQuerySupported)}
            onClick={() => void save()}
          >
            {saving ? 'Saving...' : 'Save As'}
          </button>
        </div>
      </section>
    </div>
  )
}

function limitPreviewPayload(payload: ResultPayload, maximum: number): ResultPayload {
  if (payload.renderer === 'document') return { ...payload, documents: payload.documents.slice(0, maximum) }
  if (payload.renderer === 'table') return { ...payload, rows: payload.rows.slice(0, maximum) }
  throw new Error('This result format cannot apply a row limit. Choose a table/document view, or turn off the export row limit in Queries & Results.')
}
