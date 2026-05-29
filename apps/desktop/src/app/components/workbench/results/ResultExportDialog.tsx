import { useMemo, useState } from 'react'
import type {
  ExecutionResultEnvelope,
  ExportResultFileRequest,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import {
  createResultExportFile,
  defaultExportOptionForPayload,
  exportOptionsForPayload,
  type ResultExportFormat,
} from './payload-export'

interface ResultExportDialogProps {
  payload: ResultPayload
  result?: ExecutionResultEnvelope
  onCancel(): void
  onExport(request: ExportResultFileRequest): Promise<void>
}

export function ResultExportDialog({
  payload,
  result,
  onCancel,
  onExport,
}: ResultExportDialogProps) {
  const options = useMemo(() => exportOptionsForPayload(payload), [payload])
  const [format, setFormat] = useState<ResultExportFormat>(
    defaultExportOptionForPayload(payload).format,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedOption =
    options.find((option) => option.format === format) ?? options[0]

  if (!selectedOption) {
    return null
  }

  const save = async () => {
    setSaving(true)
    setError('')

    try {
      await onExport(createResultExportFile(payload, result, selectedOption))
    } catch (exportError) {
      setError(
        exportError instanceof Error
          ? exportError.message
          : 'Unable to export the result.',
      )
      setSaving(false)
    }
  }

  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog result-export-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Export result"
      >
        <h2>Export Result</h2>
        <div className="result-export-format-grid" role="radiogroup" aria-label="Export format">
          {options.map((option) => (
            <button
              key={option.format}
              type="button"
              role="radio"
              aria-checked={format === option.format}
              className={`result-export-format${format === option.format ? ' is-active' : ''}`}
              onClick={() => setFormat(option.format)}
            >
              <span>{option.label}</span>
              <small>{option.description}</small>
            </button>
          ))}
        </div>

        {error ? <p className="dialog-error">{error}</p> : null}

        <div className="workbench-dialog-actions">
          <button type="button" className="drawer-button" disabled={saving} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? 'Saving...' : 'Save As'}
          </button>
        </div>
      </section>
    </div>
  )
}
