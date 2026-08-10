import { useMemo, useState } from 'react'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type { DocumentValueType } from './document-grid-model'
import { validateDocumentFieldName } from './document-edit-validation'
import {
  coerceValue,
  dateTimeLocalToUtc,
  editableValue,
  parseEditedValue,
} from './document-value-editing'

interface DocumentAddFieldDialogProps {
  connection?: ConnectionProfile
  parent: Record<string, unknown>
  parentPath: Array<string | number>
  protectedPaths: string[][]
  onAdd(fieldName: string, value: unknown): void
  onCancel(): void
}

export function DocumentAddFieldDialog({
  connection,
  parent,
  parentPath,
  protectedPaths,
  onAdd,
  onCancel,
}: DocumentAddFieldDialogProps) {
  const typeOptions = useMemo(() => documentFieldTypeOptions(connection), [connection])
  const [fieldName, setFieldName] = useState('')
  const [type, setType] = useState<DocumentValueType>('string')
  const [valueDraft, setValueDraft] = useState('')
  const [error, setError] = useState('')

  const submit = () => {
    const fieldError = validateDocumentFieldName({
      fieldName,
      parent,
      parentPath,
      protectedPaths,
    })
    if (fieldError) {
      setError(fieldError)
      return
    }

    const parsed = parseEditedValue(valueDraft, type)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    onAdd(fieldName.trim(), parsed.value)
  }

  return (
    <div className="data-grid-confirmation document-add-field-dialog" role="dialog" aria-label="Add document field">
      <div className="document-add-field-form">
        <strong>Add Field</strong>
        <label>
          <span>Field name</span>
          <input
            aria-label="New field name"
            autoFocus
            value={fieldName}
            onChange={(event) => {
              setFieldName(event.target.value)
              setError('')
            }}
          />
        </label>
        <label>
          <span>Type</span>
          <select
            aria-label="New field type"
            value={type}
            onChange={(event) => {
              const nextType = event.target.value as DocumentValueType
              setType(nextType)
              setValueDraft(editableValue(coerceValue(undefined, nextType)))
              setError('')
            }}
          >
            {typeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <DocumentDraftInput
          type={type}
          value={valueDraft}
          onChange={(value) => {
            setValueDraft(value)
            setError('')
          }}
          onError={setError}
        />
        {error ? <span className="document-edit-error" role="alert">{error}</span> : null}
      </div>
      <button type="button" className="drawer-button" onClick={onCancel}>Cancel</button>
      <button type="button" className="drawer-button drawer-button--primary" onClick={submit}>Add Field</button>
    </div>
  )
}

export function DocumentDraftInput({
  type,
  value,
  ariaLabel,
  autoFocus = false,
  onChange,
  onError,
}: {
  type: DocumentValueType
  value: string
  ariaLabel?: string
  autoFocus?: boolean
  onChange(value: string): void
  onError(message: string): void
}) {
  if (type === 'null') {
    return <span className="panel-footnote">The field value will be null.</span>
  }

  if (type === 'boolean') {
    return (
      <select aria-label={ariaLabel ?? 'Boolean field value'} value={value || 'false'} onChange={(event) => onChange(event.target.value)}>
        <option value="false">false</option>
        <option value="true">true</option>
      </select>
    )
  }

  const compound = ['object', 'array', 'binary', 'regex', 'timestamp'].includes(type)
  return (
    <div className="document-typed-value-editor">
      {compound ? (
        <textarea
          aria-label={ariaLabel ?? 'New field JSON value'}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          aria-label={ariaLabel ?? 'New field value'}
          autoFocus={autoFocus}
          inputMode={type === 'number' || type === 'decimal' ? 'decimal' : 'text'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {type === 'date' ? (
        <label className="document-date-picker">
          <span>Pick local time</span>
          <input
            type="datetime-local"
            aria-label="Pick local date and time"
            onChange={(event) => {
              const parsed = dateTimeLocalToUtc(event.target.value)
              if (!parsed.ok) {
                onError(parsed.error)
                return
              }
              const date = parsed.value as { $date: string }
              onChange(date.$date)
            }}
          />
        </label>
      ) : null}
    </div>
  )
}

function documentFieldTypeOptions(connection?: ConnectionProfile): DocumentValueType[] {
  const common: DocumentValueType[] = ['string', 'number', 'boolean', 'null', 'object', 'array']
  if (connection?.engine === 'mongodb') {
    return [...common, 'date', 'objectid', 'uuid', 'decimal', 'binary', 'regex', 'timestamp']
  }
  if (connection?.engine === 'litedb') {
    return [...common, 'date', 'objectid', 'guid', 'decimal', 'binary']
  }
  return common
}
