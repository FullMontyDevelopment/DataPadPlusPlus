import { useCallback, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'

type JsonRecord = Record<string, unknown>
const MAX_DOCUMENT_FILE_BYTES = 16 * 1024 * 1024

interface MongoDocumentInsertPanelProps {
  collection: string
  requiredFields: string[]
  onInsertDocument(document: JsonRecord): Promise<void>
}

export function MongoDocumentInsertPanel({
  collection,
  requiredFields,
  onInsertDocument,
}: MongoDocumentInsertPanelProps) {
  const [documentText, setDocumentText] = useState(() => defaultMongoInsertDocument(requiredFields))
  const [dragActive, setDragActive] = useState(false)
  const [status, setStatus] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const validation = useMemo(
    () => validateDocumentInsert(documentText, requiredFields),
    [documentText, requiredFields],
  )
  const insertDocument = useCallback(async () => {
    if (!validation.ok) {
      setStatus(validation.error)
      return
    }

    setStatus('')
    try {
      await onInsertDocument(validation.value)
      setStatus('Insert request sent.')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Document insert failed.')
    }
  }, [onInsertDocument, validation])
  const formatDocument = useCallback(() => {
    if (!validation.ok) {
      setStatus(validation.error)
      return
    }

    setDocumentText(prettyJson(validation.value))
    setStatus('Formatted document JSON.')
  }, [validation])
  const resetTemplate = useCallback(() => {
    setDocumentText(defaultMongoInsertDocument(requiredFields))
    setStatus('')
  }, [requiredFields])
  const loadJsonText = useCallback((text: string, sourceLabel: string) => {
    const parsed = validateDocumentInsert(text, requiredFields)
    if (!parsed.ok) {
      setDocumentText(text)
      setStatus(parsed.error)
      return
    }

    setDocumentText(prettyJson(parsed.value))
    setStatus(`Loaded ${sourceLabel}.`)
  }, [requiredFields])
  const loadJsonFile = useCallback((file: File | undefined) => {
    if (!file) {
      return
    }

    if (file.size > MAX_DOCUMENT_FILE_BYTES) {
      setStatus('JSON file is larger than MongoDB document limits.')
      return
    }

    void file.text()
      .then((text) => loadJsonText(text, file.name))
      .catch(() => setStatus(`Could not read ${file.name}.`))
  }, [loadJsonText])
  const loadJsonFromInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? [])
    event.target.value = ''
    loadJsonFile(file)
  }, [loadJsonFile])
  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragActive(false)
    const [file] = Array.from(event.dataTransfer.files ?? [])
    loadJsonFile(file)
  }, [loadJsonFile])

  return (
    <div className="object-view-management object-view-management--primary">
      <div className="object-view-management-header">
        <div title="Load, validate, and insert one MongoDB document.">
          <strong>Insert Document</strong>
        </div>
        <div className="object-view-action-chips" aria-label="Insert checks">
          <span>{validation.ok ? 'Valid JSON' : 'Needs fix'}</span>
          <span>{requiredFields.length ? `${requiredFields.length} required` : 'No required fields'}</span>
        </div>
      </div>
      {requiredFields.length ? (
        <div className="object-view-chip-row" aria-label="Required document fields">
          {requiredFields.map((field) => <span key={field}>{field}</span>)}
        </div>
      ) : null}
      <div
        className={`object-view-drop-zone${dragActive ? ' is-active' : ''}`}
        role="button"
        tabIndex={0}
        aria-label="Upload document JSON"
        title="Drop a JSON object file here, or press Enter to choose one."
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            fileInputRef.current?.click()
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragActive(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) {
            setDragActive(false)
          }
        }}
        onDrop={handleDrop}
      >
        <strong>Upload JSON</strong>
        <span>Drop one document object</span>
      </div>
      <label className="object-view-field">
        <span>Document</span>
        <textarea
          className="object-view-textarea object-view-textarea--tall"
          value={documentText}
          onChange={(event) => setDocumentText(event.target.value)}
          spellCheck={false}
        />
      </label>
      {!validation.ok ? <p className="object-view-status is-error">{validation.error}</p> : null}
      {status && (validation.ok || status !== validation.error) ? (
        <p className={`object-view-status ${validation.ok && !status.toLowerCase().includes('failed') && !status.toLowerCase().includes('could not') ? 'is-success' : 'is-error'}`}>{status}</p>
      ) : null}
      <div className="object-view-button-row">
        <button
          type="button"
          className="drawer-button"
          onClick={() => fileInputRef.current?.click()}
        >
          Upload JSON
        </button>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".json,application/json"
          onChange={loadJsonFromInput}
        />
        <button
          type="button"
          className="drawer-button"
          onClick={() => setStatus(validation.ok ? `Document is valid for ${collection}.` : validation.error)}
        >
          Validate
        </button>
        <button
          type="button"
          className="drawer-button"
          onClick={formatDocument}
        >
          Format
        </button>
        <button
          type="button"
          className="drawer-button"
          onClick={resetTemplate}
        >
          Template
        </button>
        <button
          type="button"
          className="drawer-button drawer-button--primary"
          disabled={!collection || !validation.ok}
          onClick={() => void insertDocument()}
        >
          Insert Document
        </button>
      </div>
    </div>
  )
}

function validateDocumentInsert(
  text: string,
  requiredFields: string[],
): { ok: true; value: JsonRecord } | { ok: false; error: string } {
  const parsed = parseJsonObject(text)
  if (!parsed.ok) {
    return parsed
  }

  const missing = requiredFields.filter((field) => !Object.prototype.hasOwnProperty.call(parsed.value, field))
  if (missing.length > 0) {
    return { ok: false, error: `Missing required field(s): ${missing.join(', ')}` }
  }

  return parsed
}

function defaultMongoInsertDocument(requiredFields: string[]) {
  const document: JsonRecord = {}

  for (const field of requiredFields) {
    const normalized = field.toLowerCase()
    if (normalized.includes('sku') || normalized.includes('code')) {
      document[field] = 'new-item'
    } else if (normalized.includes('name') || normalized.includes('title')) {
      document[field] = 'New item'
    } else if (normalized.includes('date') || normalized.endsWith('at')) {
      document[field] = new Date().toISOString()
    } else if (normalized.includes('count') || normalized.includes('qty') || normalized.includes('quantity')) {
      document[field] = 0
    } else {
      document[field] = ''
    }
  }

  if (Object.keys(document).length === 0) {
    document.name = 'New item'
  }

  return prettyJson(document)
}

function parseJsonObject(value: string): { ok: true; value: JsonRecord } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Expected a JSON object.' }
    }
    return { ok: true, value: parsed as JsonRecord }
  } catch {
    return { ok: false, error: 'Invalid JSON.' }
  }
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
