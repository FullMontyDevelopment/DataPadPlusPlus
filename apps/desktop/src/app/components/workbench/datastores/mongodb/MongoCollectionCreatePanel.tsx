import { useState } from 'react'
import { SettingsIcon } from '../../icons'

type JsonRecord = Record<string, unknown>

export type MongoCollectionCreatePlanner = (request: {
  objectName?: string
  operationId: string
  parameters?: Record<string, unknown>
  title: string
}) => void

export function MongoCollectionCreatePanel({
  database,
  mode = 'collection',
  onCancel,
  onPlanOperation,
}: {
  database: string
  mode?: 'collection' | 'database'
  onCancel(): void
  onPlanOperation?: MongoCollectionCreatePlanner
}) {
  const [newDatabaseName, setNewDatabaseName] = useState('')
  const [collectionName, setCollectionName] = useState('')
  const [collectionType, setCollectionType] = useState<'standard' | 'capped' | 'time-series'>('standard')
  const [cappedSize, setCappedSize] = useState('10485760')
  const [cappedMax, setCappedMax] = useState('')
  const [timeField, setTimeField] = useState('timestamp')
  const [metaField, setMetaField] = useState('')
  const [granularity, setGranularity] = useState<'seconds' | 'minutes' | 'hours'>('seconds')
  const [expireAfterSeconds, setExpireAfterSeconds] = useState('')
  const [validatorJson, setValidatorJson] = useState('{}')
  const [validationLevel, setValidationLevel] = useState<'off' | 'strict' | 'moderate'>('strict')
  const [validationAction, setValidationAction] = useState<'error' | 'warn'>('error')
  const [collationJson, setCollationJson] = useState('{}')
  const [preAndPostImages, setPreAndPostImages] = useState(false)
  const [validationError, setValidationError] = useState('')

  const planCreateCollection = () => {
    const targetDatabase = mode === 'database' ? newDatabaseName.trim() : database
    const collection = collectionName.trim()
    if (!targetDatabase) {
      setValidationError('Database name is required.')
      return
    }
    if (!collection) {
      setValidationError('Collection name is required.')
      return
    }
    const invalidName = mongoCollectionNameError(collection)
    if (invalidName) {
      setValidationError(invalidName)
      return
    }

    const options: JsonRecord = {}
    if (collectionType === 'capped') {
      const size = parseOptionalPositiveInteger(cappedSize, 'Capped size')
      if (!size.ok || size.value === undefined) {
        setValidationError(size.ok ? 'Capped size is required.' : size.error)
        return
      }
      const max = parseOptionalPositiveInteger(cappedMax, 'Maximum documents')
      if (!max.ok) {
        setValidationError(max.error)
        return
      }
      options.capped = true
      options.size = size.value
      if (max.value !== undefined) {
        options.max = max.value
      }
    }

    if (collectionType === 'time-series') {
      const normalizedTimeField = timeField.trim()
      if (!normalizedTimeField) {
        setValidationError('Time field is required for a time-series collection.')
        return
      }
      const timeseries: JsonRecord = {
        timeField: normalizedTimeField,
        granularity,
      }
      if (metaField.trim()) {
        timeseries.metaField = metaField.trim()
      }
      options.timeseries = timeseries
      const expiry = parseOptionalPositiveInteger(expireAfterSeconds, 'Expiry')
      if (!expiry.ok) {
        setValidationError(expiry.error)
        return
      }
      if (expiry.value !== undefined) {
        options.expireAfterSeconds = expiry.value
      }
    }

    const validator = parseJsonObject(validatorJson, 'Validator')
    if (!validator.ok) {
      setValidationError(validator.error)
      return
    }
    if (Object.keys(validator.value).length > 0) {
      options.validator = validator.value
      options.validationLevel = validationLevel
      options.validationAction = validationAction
    }

    const collation = parseJsonObject(collationJson, 'Default collation')
    if (!collation.ok) {
      setValidationError(collation.error)
      return
    }
    if (Object.keys(collation.value).length > 0) {
      options.collation = collation.value
    }
    if (preAndPostImages) {
      options.changeStreamPreAndPostImages = { enabled: true }
    }

    setValidationError('')
    onPlanOperation?.({
      title: mode === 'database'
        ? `Create database ${targetDatabase}`
        : `Create collection ${collection}`,
      operationId: mode === 'database' ? 'mongodb.database.create' : 'mongodb.collection.create',
      objectName: mode === 'database' ? targetDatabase : collection,
      parameters: {
        database: targetDatabase,
        collection,
        options,
      },
    })
  }

  return (
    <form
      id="mongo-create-collection-panel"
      className="mongo-create-collection"
      onSubmit={(event) => {
        event.preventDefault()
        planCreateCollection()
      }}
    >
      <div className="mongo-create-collection-heading">
        <div>
          <h3>Create a collection</h3>
          <span>
            {mode === 'database'
              ? 'MongoDB creates a database when its first collection is created.'
              : 'Configure the native MongoDB collection options before reviewing the operation.'}
          </span>
        </div>
        <span className="mongo-database-scope">
          {mode === 'database' ? newDatabaseName.trim() || 'New database' : database}
        </span>
      </div>

      <div className="mongo-create-collection-primary-fields">
        {mode === 'database' ? (
          <label className="object-view-field">
            <span>Database name</span>
            <input
              autoFocus
              placeholder="analytics"
              value={newDatabaseName}
              onChange={(event) => setNewDatabaseName(event.target.value)}
            />
          </label>
        ) : null}
        <label className="object-view-field">
          <span>{mode === 'database' ? 'First collection' : 'Collection name'}</span>
          <input
            autoFocus={mode === 'collection'}
            placeholder="documents"
            value={collectionName}
            onChange={(event) => setCollectionName(event.target.value)}
          />
        </label>
        <label className="object-view-field">
          <span>Collection type</span>
          <select
            value={collectionType}
            onChange={(event) => setCollectionType(event.target.value as typeof collectionType)}
          >
            <option value="standard">Standard</option>
            <option value="time-series">Time series</option>
            <option value="capped">Capped</option>
          </select>
        </label>
      </div>

      {collectionType === 'capped' ? (
        <div className="mongo-create-collection-option-grid">
          <label className="object-view-field">
            <span>Capped size (bytes)</span>
            <input
              inputMode="numeric"
              value={cappedSize}
              onChange={(event) => setCappedSize(event.target.value)}
            />
          </label>
          <label className="object-view-field">
            <span>Maximum documents</span>
            <input
              inputMode="numeric"
              placeholder="Optional"
              value={cappedMax}
              onChange={(event) => setCappedMax(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {collectionType === 'time-series' ? (
        <div className="mongo-create-collection-option-grid">
          <label className="object-view-field">
            <span>Time field</span>
            <input value={timeField} onChange={(event) => setTimeField(event.target.value)} />
          </label>
          <label className="object-view-field">
            <span>Metadata field</span>
            <input
              placeholder="Optional"
              value={metaField}
              onChange={(event) => setMetaField(event.target.value)}
            />
          </label>
          <label className="object-view-field">
            <span>Granularity</span>
            <select
              value={granularity}
              onChange={(event) => setGranularity(event.target.value as typeof granularity)}
            >
              <option value="seconds">Seconds</option>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
            </select>
          </label>
          <label className="object-view-field">
            <span>Expire after (seconds)</span>
            <input
              inputMode="numeric"
              placeholder="Never"
              value={expireAfterSeconds}
              onChange={(event) => setExpireAfterSeconds(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      <details className="mongo-create-collection-advanced">
        <summary>
          <SettingsIcon className="panel-inline-icon" />
          <span>
            <strong>Advanced options</strong>
            <small>Validation, collation, and change stream document images</small>
          </span>
        </summary>
        <div className="mongo-create-collection-advanced-body">
          <label className="object-view-field mongo-create-collection-json-field">
            <span>Validator JSON</span>
            <textarea
              className="object-view-textarea"
              value={validatorJson}
              onChange={(event) => setValidatorJson(event.target.value)}
              spellCheck={false}
            />
          </label>
          <div className="mongo-create-collection-option-grid">
            <label className="object-view-field">
              <span>Validation level</span>
              <select
                value={validationLevel}
                onChange={(event) => setValidationLevel(event.target.value as typeof validationLevel)}
              >
                <option value="strict">Strict</option>
                <option value="moderate">Moderate</option>
                <option value="off">Off</option>
              </select>
            </label>
            <label className="object-view-field">
              <span>Validation action</span>
              <select
                value={validationAction}
                onChange={(event) => setValidationAction(event.target.value as typeof validationAction)}
              >
                <option value="error">Reject invalid documents</option>
                <option value="warn">Allow and warn</option>
              </select>
            </label>
          </div>
          <label className="object-view-field mongo-create-collection-json-field">
            <span>Default collation JSON</span>
            <textarea
              className="object-view-textarea"
              value={collationJson}
              onChange={(event) => setCollationJson(event.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="mongo-operation-check">
            <input
              checked={preAndPostImages}
              type="checkbox"
              onChange={(event) => setPreAndPostImages(event.target.checked)}
            />
            Store pre-images and post-images for change streams
          </label>
        </div>
      </details>

      {validationError ? <p className="object-view-status is-error">{validationError}</p> : null}
      <div className="object-view-button-row mongo-create-collection-actions">
        <button type="button" className="drawer-button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="submit"
          className="drawer-button drawer-button--primary"
          disabled={!onPlanOperation || (mode === 'collection' && !database)}
        >
          Review {mode === 'database' ? 'database' : 'collection'} creation
        </button>
      </div>
    </form>
  )
}

function parseJsonObject(
  value: string,
  label: string,
): { ok: true; value: JsonRecord } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(value || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: `${label} must be a JSON object.` }
    }
    return { ok: true, value: parsed as JsonRecord }
  } catch {
    return { ok: false, error: `${label} contains invalid JSON.` }
  }
}

function parseOptionalPositiveInteger(
  value: string,
  label: string,
): { ok: true; value?: number } | { ok: false; error: string } {
  const normalized = value.trim()
  if (!normalized) {
    return { ok: true }
  }
  const parsed = Number(normalized)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return { ok: false, error: `${label} must be a positive whole number.` }
  }
  return { ok: true, value: parsed }
}

function mongoCollectionNameError(collection: string) {
  if (collection.includes('\0')) {
    return 'Collection name cannot contain a null character.'
  }
  if (collection.includes('$')) {
    return 'Collection name cannot contain $.'
  }
  if (collection.startsWith('system.')) {
    return 'Collection names beginning with system. are reserved by MongoDB.'
  }
  return ''
}
