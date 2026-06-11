import { useCallback, useMemo, useState } from 'react'
import type { MongoObjectViewDescriptor } from './MongoObjectViewDescriptors'
import { ObjectSecurityIcon, PlusIcon, TrashIcon } from '../../icons'
import { PurposeEmptyState, SectionHeading } from '../../ObjectViewPrimitives'

type JsonRecord = Record<string, unknown>

type MongoOperationPlanner = (request: {
  objectName?: string
  operationId: string
  parameters?: Record<string, unknown>
  title: string
}) => void

export function MongoValidationView({
  descriptor,
  payload,
  onPlanOperation,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  onPlanOperation?: MongoOperationPlanner
}) {
  const validator = payload.validator ?? asRecord(payload.options)?.validator
  const database = stringValue(payload.database)
  const collection = stringValue(payload.collection)
  const validatorJsonFromPayload = useMemo(() => prettyJson(validator ?? {}), [validator])
  const initialRequiredFields = useMemo(() => requiredFieldsForValidator(payload), [payload])
  const [validatorJson, setValidatorJson] = useState(validatorJsonFromPayload)
  const [testDocumentJson, setTestDocumentJson] = useState('{\n  "sku": "example",\n  "name": "Example"\n}')
  const [validationError, setValidationError] = useState('')
  const [testStatus, setTestStatus] = useState<{ kind: 'success' | 'error'; text: string } | undefined>()
  const [requiredFields, setRequiredFields] = useState(initialRequiredFields)
  const [newRequiredField, setNewRequiredField] = useState('')
  const previewUpdate = useCallback(() => {
    const parsed = parseJsonObject(validatorJson)
    if (!parsed.ok) {
      setValidationError(parsed.error)
      return
    }
    setValidationError('')
    onPlanOperation?.({
      title: `Update validator for ${collection}`,
      operationId: 'mongodb.validation.update',
      objectName: collection,
      parameters: {
        database,
        collection,
        validator: parsed.value,
      },
    })
  }, [collection, database, onPlanOperation, validatorJson])
  const reviewRequiredFields = useCallback(() => {
    setValidationError('')
    onPlanOperation?.({
      title: `Update validator for ${collection}`,
      operationId: 'mongodb.validation.update',
      objectName: collection,
      parameters: {
        database,
        collection,
        validator: validatorWithRequiredFields(validator, requiredFields),
      },
    })
  }, [collection, database, onPlanOperation, requiredFields, validator])
  const addRequiredField = useCallback(() => {
    const field = newRequiredField.trim()
    if (!field) {
      setValidationError('Field name is required.')
      return
    }
    if (requiredFields.includes(field)) {
      setValidationError(`Required field already exists: ${field}`)
      return
    }
    setRequiredFields([...requiredFields, field])
    setNewRequiredField('')
    setValidationError('')
  }, [newRequiredField, requiredFields])
  const removeRequiredField = useCallback((field: string) => {
    setRequiredFields(requiredFields.filter((item) => item !== field))
    setValidationError('')
  }, [requiredFields])
  const testDocument = useCallback(() => {
    const validation = validateDocumentUpload(testDocumentJson, requiredFields)
    setTestStatus(validation.ok
      ? { kind: 'success', text: 'Document matches the validator fields DataPad++ can verify locally.' }
      : { kind: 'error', text: validation.error })
  }, [requiredFields, testDocumentJson])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectSecurityIcon} title={descriptor.title} unit={validator ? 'configured' : 'none'} />
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>Required fields</span>
          <strong>{requiredFields.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Validation source</span>
          <strong>{validator ? 'JSON Schema' : 'none'}</strong>
        </div>
      </div>
      <div className="object-view-management">
        <strong>Required Fields</strong>
        {requiredFields.length ? (
          <div className="object-view-chip-row" aria-label="Required fields">
            {requiredFields.map((field) => (
              <button
                type="button"
                className="object-view-chip-button"
                key={field}
                aria-label={`Remove required field ${field}`}
                title="Remove required field"
                onClick={() => removeRequiredField(field)}
              >
                <span>{field}</span>
                <TrashIcon className="toolbar-icon" />
              </button>
            ))}
          </div>
        ) : (
          <PurposeEmptyState descriptor={descriptor} />
        )}
        <div className="object-view-form-grid">
          <label className="object-view-field">
            <span>Field</span>
            <input
              value={newRequiredField}
              onChange={(event) => setNewRequiredField(event.target.value)}
              placeholder="sku"
            />
          </label>
        </div>
        {validationError ? <p className="object-view-status is-error">{validationError}</p> : null}
        <div className="object-view-button-row">
          <button type="button" className="drawer-button" onClick={addRequiredField}>
            <PlusIcon className="panel-inline-icon" />
            Add Field
          </button>
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            disabled={!onPlanOperation || !collection}
            onClick={reviewRequiredFields}
          >
            Review Required Fields
          </button>
        </div>
      </div>
      <details className="object-view-disclosure">
        <summary>Advanced JSON rule</summary>
        <label className="object-view-field">
          <span>Validator rule</span>
          <textarea
            className="object-view-textarea"
            value={validatorJson}
            onChange={(event) => setValidatorJson(event.target.value)}
            spellCheck={false}
          />
        </label>
        <div className="object-view-button-row">
          <button
            type="button"
            className="drawer-button"
            disabled={!onPlanOperation || !collection}
            onClick={previewUpdate}
          >
            Review JSON Rule
          </button>
        </div>
      </details>
      <div className="object-view-management">
        <strong>Test Document</strong>
        <label className="object-view-field">
          <span>Test document</span>
          <textarea
            className="object-view-textarea"
            value={testDocumentJson}
            onChange={(event) => setTestDocumentJson(event.target.value)}
            spellCheck={false}
          />
        </label>
        {testStatus ? (
          <p className={`object-view-status ${testStatus.kind === 'success' ? 'is-success' : 'is-error'}`}>
            {testStatus.text}
          </p>
        ) : null}
        <div className="object-view-button-row">
          <button type="button" className="drawer-button" onClick={testDocument}>
            Test Document
          </button>
        </div>
      </div>
    </div>
  )
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
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

function validateDocumentUpload(
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

function requiredFieldsForValidator(payload: JsonRecord) {
  const validator = asRecord(payload.validator ?? asRecord(payload.options).validator)
  const schema = asRecord(validator.$jsonSchema)
  const required = schema.required

  return Array.isArray(required)
    ? required.filter((item): item is string => typeof item === 'string')
    : []
}

function validatorWithRequiredFields(validator: unknown, requiredFields: string[]): JsonRecord {
  const currentValidator = asRecord(validator)
  const currentSchema = asRecord(currentValidator.$jsonSchema)
  const nextSchema: JsonRecord = {
    bsonType: currentSchema.bsonType ?? 'object',
    ...currentSchema,
  }

  if (requiredFields.length > 0) {
    nextSchema.required = [...requiredFields]
  } else {
    delete nextSchema.required
  }

  return {
    ...currentValidator,
    $jsonSchema: nextSchema,
  }
}

function prettyJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}
