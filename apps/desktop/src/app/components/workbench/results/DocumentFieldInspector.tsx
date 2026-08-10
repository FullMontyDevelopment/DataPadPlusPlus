import { useEffect, useState } from 'react'
import { DesktopCodeEditor } from '../DesktopCodeEditor'
import {
  documentValueTypeLabel,
  type DocumentGridRow,
  type DocumentValueType,
} from './document-grid-model'
import { copyText } from './payload-export'

const TYPE_OPTIONS: DocumentValueType[] = ['string', 'number', 'boolean', 'null', 'object', 'array']

interface DocumentFieldInspectorProps {
  canChangeType: boolean
  canEditRaw: boolean
  document: Record<string, unknown>
  editUnavailableReason?: string
  initialMode?: 'view' | 'edit'
  row: DocumentGridRow
  theme: string
  onChangeType(row: DocumentGridRow, nextType: DocumentValueType): void
  onClose(): void
  onSaveRaw(row: DocumentGridRow, value: unknown): void
  onValidateRaw(row: DocumentGridRow, value: unknown): string[]
}

export function DocumentFieldInspector({
  canChangeType,
  canEditRaw,
  document,
  editUnavailableReason,
  initialMode = 'view',
  row,
  theme,
  onChangeType,
  onClose,
  onSaveRaw,
  onValidateRaw,
}: DocumentFieldInspectorProps) {
  const formattedValue = formatRawJson(row.value, true)
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode)
  const [draft, setDraft] = useState(formattedValue)
  const [validatedDraft, setValidatedDraft] = useState<string>()
  const [validationErrors, setValidationErrors] = useState<string[]>([])
  const [copyStatus, setCopyStatus] = useState('')
  const fieldPath = row.fieldPath || '$'
  const saveEnabled = mode === 'edit' && validatedDraft === draft && validationErrors.length === 0

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) {
        setDraft(formattedValue)
        setValidatedDraft(undefined)
        setValidationErrors([])
      }
    })
    return () => {
      cancelled = true
    }
  }, [formattedValue, row.id])

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) setMode(initialMode)
    })
    return () => {
      cancelled = true
    }
  }, [initialMode, row.id])

  const copy = async (label: string, text: string) => {
    await copyText(text)
    setCopyStatus(`${label} copied.`)
  }

  const validate = () => {
    let parsed: unknown
    try {
      parsed = JSON.parse(draft) as unknown
    } catch (error) {
      setValidatedDraft(draft)
      setValidationErrors([error instanceof Error ? error.message : 'JSON is invalid.'])
      return
    }

    if (row.path.length === 0 && (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))) {
      setValidatedDraft(draft)
      setValidationErrors(['A root document edit must produce a JSON object.'])
      return
    }

    const errors = onValidateRaw(row, parsed)
    setValidatedDraft(draft)
    setValidationErrors(errors)
  }

  const save = () => {
    if (!saveEnabled) return
    onSaveRaw(row, JSON.parse(draft) as unknown)
  }

  return (
    <aside className="document-field-inspector" aria-label="Document field raw JSON inspector">
      <header className="document-field-inspector-header">
        <div>
          <strong>{mode === 'edit' ? 'Edit Raw JSON' : 'Raw JSON'}</strong>
          <span>{fieldPath}</span>
        </div>
        <button type="button" className="bottom-panel-icon-button" aria-label="Close inspector" onClick={onClose}>x</button>
      </header>

      <dl className="document-field-inspector-meta">
        <div><dt>Document</dt><dd>{documentIdentity(document, row.documentIndex)}</dd></div>
        <div>
          <dt>Type</dt>
          <dd>
            {canChangeType ? (
              <select
                aria-label={`Change inspected field type ${fieldPath}`}
                value={row.type}
                onChange={(event) => onChangeType(row, event.target.value as DocumentValueType)}
              >
                {TYPE_OPTIONS.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            ) : (
              <span className={`document-type-badge is-${row.type}`}>{documentValueTypeLabel(row.type)}</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="document-field-inspector-editor" title="Use Ctrl+F to search within the JSON editor.">
        <DesktopCodeEditor
          ariaLabel={mode === 'edit' ? 'Edit selected value raw JSON' : 'Selected field raw JSON'}
          language="json"
          readOnly={mode === 'view'}
          resetKey={`${row.id}:${mode}`}
          theme={theme}
          value={mode === 'edit' ? draft : formattedValue}
          onChange={(value) => {
            setDraft(value)
            setValidatedDraft(undefined)
            setValidationErrors([])
          }}
        />
      </div>

      {validationErrors.length > 0 ? (
        <ul className="document-raw-json-errors" role="alert">
          {validationErrors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      ) : validatedDraft === draft && mode === 'edit' ? (
        <span className="document-raw-json-valid" role="status">JSON and datastore safeguards passed validation.</span>
      ) : null}

      <div className="document-field-inspector-actions">
        {mode === 'view' ? (
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            disabled={!canEditRaw || Boolean(editUnavailableReason)}
            title={editUnavailableReason}
            onClick={() => {
              setMode('edit')
              setDraft(formattedValue)
              setValidatedDraft(undefined)
            }}
          >
            Edit Raw JSON
          </button>
        ) : (
          <>
            <button type="button" className="drawer-button" onClick={validate}>Validate JSON</button>
            <button type="button" className="drawer-button drawer-button--primary" disabled={!saveEnabled} onClick={save}>Save</button>
            <button
              type="button"
              className="drawer-button"
              onClick={() => {
                setMode('view')
                setDraft(formattedValue)
                setValidatedDraft(undefined)
                setValidationErrors([])
              }}
            >
              Cancel
            </button>
          </>
        )}
        <button type="button" className="drawer-button" onClick={() => void copy('Path', fieldPath)}>Copy Path</button>
        <button type="button" className="drawer-button" onClick={() => void copy('Raw JSON', mode === 'edit' ? draft : formattedValue)}>Copy Raw JSON</button>
        <button type="button" className="drawer-button" onClick={() => void copy('Document JSON', formatRawJson(document, true))}>Copy Document JSON</button>
        {copyStatus ? <span>{copyStatus}</span> : null}
      </div>
    </aside>
  )
}

function formatRawJson(value: unknown, pretty: boolean) {
  if (value === undefined) return 'null'
  try {
    return JSON.stringify(value, null, pretty ? 2 : 0) ?? String(value)
  } catch {
    return String(value)
  }
}

function documentIdentity(document: Record<string, unknown>, index: number) {
  const value = document._id ?? document.id ?? document._key ?? document.key
  if (value === undefined) return `document ${index + 1}`
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return formatRawJson(value, false)
}
