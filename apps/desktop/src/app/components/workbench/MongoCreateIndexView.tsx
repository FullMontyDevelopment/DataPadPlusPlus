import { useCallback, useState } from 'react'
import type { ComponentType } from 'react'
import { ObjectIndexIcon, PlusIcon, TrashIcon } from './icons'
import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'

type JsonRecord = Record<string, unknown>
type IndexDirection = '1' | '-1' | 'text' | 'hashed'
type IndexFieldDraft = {
  direction: IndexDirection
  fieldName: string
}

interface MongoOperationPlanHandler {
  (request: {
    objectName?: string
    operationId: string
    parameters?: Record<string, unknown>
    title: string
  }): void
}

export function MongoCreateIndexView({
  descriptor,
  payload,
  onPlanOperation,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  onPlanOperation?: MongoOperationPlanHandler
}) {
  const database = stringValue(payload.database)
  const collection = stringValue(payload.collection)
  const [indexName, setIndexName] = useState('field_1')
  const [fields, setFields] = useState<IndexFieldDraft[]>([
    { fieldName: 'field', direction: '1' },
  ])
  const [unique, setUnique] = useState(false)
  const [sparse, setSparse] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [ttlSeconds, setTtlSeconds] = useState('')
  const [partialFilter, setPartialFilter] = useState('')
  const [validationError, setValidationError] = useState('')
  const previewCreate = useCallback(() => {
    const normalizedFields = fields.map((field) => ({
      fieldName: field.fieldName.trim(),
      direction: field.direction,
    }))
    if (normalizedFields.some((field) => !field.fieldName)) {
      setValidationError('Every index field needs a name.')
      return
    }

    const duplicatedField = firstDuplicate(normalizedFields.map((field) => field.fieldName))
    if (duplicatedField) {
      setValidationError(`Duplicate field: ${duplicatedField}`)
      return
    }

    const ttl = ttlSeconds.trim()
    if (ttl && (!/^\d+$/.test(ttl) || Number(ttl) <= 0)) {
      setValidationError('TTL must be a positive number of seconds.')
      return
    }

    const partial = partialFilter.trim()
      ? parseJsonObject(partialFilter)
      : undefined
    if (partial && !partial.ok) {
      setValidationError(`Partial filter: ${partial.error}`)
      return
    }

    const key = Object.fromEntries(
      normalizedFields.map((field) => [field.fieldName, indexDirectionValue(field.direction)]),
    )
    const name = indexName.trim() || indexNameFromFields(normalizedFields)
    const options = {
      name,
      ...(unique ? { unique: true } : {}),
      ...(sparse ? { sparse: true } : {}),
      ...(hidden ? { hidden: true } : {}),
      ...(ttl ? { expireAfterSeconds: Number(ttl) } : {}),
      ...(partial && partial.ok ? { partialFilterExpression: partial.value } : {}),
    }
    setValidationError('')
    onPlanOperation?.({
      title: `Create index ${name}`,
      operationId: 'mongodb.index.create',
      objectName: collection,
      parameters: {
        database,
        collection,
        indexName: name,
        key,
        options,
      },
    })
  }, [
    collection,
    database,
    fields,
    hidden,
    indexName,
    onPlanOperation,
    partialFilter,
    sparse,
    ttlSeconds,
    unique,
  ])

  return (
    <div className="object-view-section">
      <SectionHeading
        Icon={ObjectIndexIcon}
        title={descriptor.title}
        unit={[database, collection].filter(Boolean).join(' / ') || 'MongoDB'}
      />
      <MongoIndexCreatePanel
        disabled={!collection || !onPlanOperation}
        fields={fields}
        hidden={hidden}
        indexName={indexName}
        partialFilter={partialFilter}
        sparse={sparse}
        ttlSeconds={ttlSeconds}
        unique={unique}
        validationError={validationError}
        onFieldsChange={setFields}
        onHiddenChange={setHidden}
        onIndexNameChange={setIndexName}
        onPartialFilterChange={setPartialFilter}
        onPreviewCreate={previewCreate}
        onSparseChange={setSparse}
        onTtlSecondsChange={setTtlSeconds}
        onUniqueChange={setUnique}
      />
    </div>
  )
}

function MongoIndexCreatePanel({
  disabled,
  fields,
  hidden,
  indexName,
  partialFilter,
  sparse,
  ttlSeconds,
  unique,
  validationError,
  onFieldsChange,
  onHiddenChange,
  onIndexNameChange,
  onPartialFilterChange,
  onPreviewCreate,
  onSparseChange,
  onTtlSecondsChange,
  onUniqueChange,
}: {
  disabled: boolean
  fields: IndexFieldDraft[]
  hidden: boolean
  indexName: string
  partialFilter: string
  sparse: boolean
  ttlSeconds: string
  unique: boolean
  validationError: string
  onFieldsChange(value: IndexFieldDraft[]): void
  onHiddenChange(value: boolean): void
  onIndexNameChange(value: string): void
  onPartialFilterChange(value: string): void
  onPreviewCreate(): void
  onSparseChange(value: boolean): void
  onTtlSecondsChange(value: string): void
  onUniqueChange(value: boolean): void
}) {
  const updateField = (index: number, patch: Partial<IndexFieldDraft>) => {
    onFieldsChange(fields.map((field, fieldIndex) =>
      fieldIndex === index ? { ...field, ...patch } : field))
  }
  const addField = () => {
    onFieldsChange([...fields, { fieldName: `field${fields.length + 1}`, direction: '1' }])
  }
  const removeField = (index: number) => {
    if (fields.length <= 1) {
      return
    }
    onFieldsChange(fields.filter((_, fieldIndex) => fieldIndex !== index))
  }

  return (
    <div className="object-view-management">
      <strong>Create Index</strong>
      <div className="object-view-form-grid">
        <label className="object-view-field">
          <span>Name</span>
          <input value={indexName} onChange={(event) => onIndexNameChange(event.target.value)} />
        </label>
        <label className="object-view-field">
          <span>TTL seconds</span>
          <input
            inputMode="numeric"
            placeholder="Optional"
            value={ttlSeconds}
            onChange={(event) => onTtlSecondsChange(event.target.value)}
          />
        </label>
      </div>
      <div className="object-view-field-list" aria-label="Index fields">
        {fields.map((field, index) => (
          <div className="object-view-field-row" key={`${index}:${field.fieldName}`}>
            <label className="object-view-field">
              <span>{index === 0 ? 'Field' : `Field ${index + 1}`}</span>
              <input
                value={field.fieldName}
                onChange={(event) => updateField(index, { fieldName: event.target.value })}
              />
            </label>
            <label className="object-view-field">
              <span>{index === 0 ? 'Order' : `Order ${index + 1}`}</span>
              <select
                value={field.direction}
                onChange={(event) => updateField(index, { direction: event.target.value as IndexDirection })}
              >
                <option value="1">Ascending</option>
                <option value="-1">Descending</option>
                <option value="text">Text</option>
                <option value="hashed">Hashed</option>
              </select>
            </label>
            <button
              type="button"
              className="object-view-icon-action is-danger"
              aria-label={`Remove field ${index + 1}`}
              disabled={fields.length <= 1}
              title="Remove field"
              onClick={() => removeField(index)}
            >
              <TrashIcon className="toolbar-icon" />
            </button>
          </div>
        ))}
        <button type="button" className="drawer-button" onClick={addField}>
          <PlusIcon className="panel-inline-icon" />
          Add Field
        </button>
      </div>
      <div className="object-view-action-chips object-view-action-chips--controls" aria-label="Index options">
        <label>
          <input checked={unique} type="checkbox" onChange={(event) => onUniqueChange(event.target.checked)} />
          Unique
        </label>
        <label>
          <input checked={sparse} type="checkbox" onChange={(event) => onSparseChange(event.target.checked)} />
          Sparse
        </label>
        <label>
          <input checked={hidden} type="checkbox" onChange={(event) => onHiddenChange(event.target.checked)} />
          Hidden
        </label>
      </div>
      <details className="object-view-disclosure">
        <summary>Partial filter</summary>
        <label className="object-view-field">
          <span>Filter JSON</span>
          <textarea
            className="object-view-textarea"
            placeholder='{ "status": "active" }'
            value={partialFilter}
            onChange={(event) => onPartialFilterChange(event.target.value)}
            spellCheck={false}
          />
        </label>
      </details>
      {validationError ? <p className="object-view-status is-error">{validationError}</p> : null}
      <div className="object-view-button-row">
        <button
          type="button"
          className="drawer-button drawer-button--primary"
          disabled={disabled}
          title="Review the index change before it is applied."
          onClick={onPreviewCreate}
        >
          Review
        </button>
      </div>
    </div>
  )
}

function indexDirectionValue(direction: IndexDirection) {
  if (direction === '1') {
    return 1
  }
  if (direction === '-1') {
    return -1
  }
  return direction
}

function indexNameFromFields(fields: IndexFieldDraft[]) {
  return fields
    .map((field) => `${field.fieldName}_${field.direction}`)
    .join('_')
}

function firstDuplicate(values: string[]) {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) {
      return value
    }
    seen.add(value)
  }
  return ''
}

function SectionHeading({
  Icon,
  title,
  unit,
}: {
  Icon: ComponentType<{ className?: string }>
  title: string
  unit?: string
}) {
  return (
    <div className="object-view-section-heading">
      <Icon className="panel-inline-icon" />
      <strong>{title}</strong>
      {unit ? <span>{unit}</span> : null}
    </div>
  )
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

function stringValue(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  return String(value)
}
