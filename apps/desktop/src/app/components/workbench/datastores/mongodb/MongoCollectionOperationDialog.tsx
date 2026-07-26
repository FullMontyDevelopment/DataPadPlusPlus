import { useMemo, useState } from 'react'
import { MongoAdvancedDisclosure } from './MongoOperationalViewPrimitives'
import {
  mongoCollectionAdminActions,
  type MongoCollectionAdminOperation,
} from './MongoCollectionOperations'

type JsonRecord = Record<string, unknown>

export function MongoCollectionOperationDialog({
  collection,
  database,
  operation,
  onCancel,
  onPlan,
}: {
  collection: string
  database: string
  operation: MongoCollectionAdminOperation
  onCancel(): void
  onPlan(
    title: string,
    operationId: string,
    extraParameters?: Record<string, unknown>,
    setDialogError?: (message: string) => void,
  ): void
}) {
  const action = useMemo(
    () => mongoCollectionAdminActions.find((item) => item.id === operation),
    [operation],
  )
  const [renameTarget, setRenameTarget] = useState(collection ? `${collection}_renamed` : '')
  const [renameDatabase, setRenameDatabase] = useState(database)
  const [dropTarget, setDropTarget] = useState(false)
  const [modifyJson, setModifyJson] = useState('{}')
  const [validationLevel, setValidationLevel] = useState('')
  const [validationAction, setValidationAction] = useState('')
  const [preAndPostImages, setPreAndPostImages] = useState(false)
  const [cappedSize, setCappedSize] = useState('1048576')
  const [cloneTarget, setCloneTarget] = useState(collection ? `${collection}_capped` : '')
  const [cloneSize, setCloneSize] = useState('1048576')
  const [compactForce, setCompactForce] = useState(false)
  const [validateFull, setValidateFull] = useState(false)
  const [dialogError, setDialogError] = useState('')

  if (!action) {
    return null
  }

  const planRename = () => {
    const newCollection = renameTarget.trim()
    if (!newCollection) {
      setDialogError('New collection name is required.')
      return
    }
    onPlan(`Rename ${collection}`, 'mongodb.collection.rename', {
      newCollection,
      targetDatabase: renameDatabase.trim() || database,
      dropTarget,
    }, setDialogError)
  }
  const planDrop = () => {
    onPlan(`Drop ${collection}`, 'mongodb.collection.drop', {}, setDialogError)
  }
  const planModify = () => {
    const options = parseJsonObject(modifyJson, 'Modification JSON')
    if (!options.ok) {
      setDialogError(options.error)
      return
    }
    const modification = {
      ...options.value,
      ...(validationLevel ? { validationLevel } : {}),
      ...(validationAction ? { validationAction } : {}),
      ...(preAndPostImages ? { changeStreamPreAndPostImages: { enabled: true } } : {}),
    }
    if (Object.keys(modification).length === 0) {
      setDialogError('Modification JSON needs at least one collMod field.')
      return
    }
    onPlan(`Modify ${collection}`, 'mongodb.collection.modify', {
      options: modification,
    }, setDialogError)
  }
  const planConvertToCapped = () => {
    const size = parsePositiveNumber(cappedSize)
    if (size === undefined) {
      setDialogError('Capped size must be a positive number of bytes.')
      return
    }
    onPlan(`Convert ${collection} to capped`, 'mongodb.collection.convert-to-capped', {
      size,
    }, setDialogError)
  }
  const planCloneAsCapped = () => {
    const targetCollection = cloneTarget.trim()
    if (!targetCollection) {
      setDialogError('Clone target collection is required.')
      return
    }
    const size = parsePositiveNumber(cloneSize)
    if (size === undefined) {
      setDialogError('Clone size must be a positive number of bytes.')
      return
    }
    onPlan(`Clone ${collection} as capped`, 'mongodb.collection.clone-as-capped', {
      targetCollection,
      size,
    }, setDialogError)
  }
  const planCompact = () => {
    onPlan(`Compact ${collection}`, 'mongodb.collection.compact', {
      force: compactForce,
    }, setDialogError)
  }
  const planValidate = () => {
    onPlan(`Validate ${collection}`, 'mongodb.collection.validate', {
      full: validateFull,
    }, setDialogError)
  }
  const submit = () => {
    setDialogError('')
    switch (operation) {
      case 'rename-collection':
        planRename()
        break
      case 'drop-collection':
        planDrop()
        break
      case 'modify-collection':
        planModify()
        break
      case 'convert-to-capped':
        planConvertToCapped()
        break
      case 'clone-as-capped':
        planCloneAsCapped()
        break
      case 'compact-collection':
        planCompact()
        break
      case 'validate-collection':
        planValidate()
        break
    }
  }

  return (
    <div className="workbench-modal-overlay" role="presentation">
      <section
        className="workbench-dialog mongo-operation-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mongo-operation-dialog-title"
      >
        <p className="sidebar-eyebrow">MongoDB Collection</p>
        <h2 id="mongo-operation-dialog-title">{action.label}</h2>
        <p>{action.description}</p>
        <dl className="object-view-key-values mongo-operation-target">
          <div>
            <dt>Database</dt>
            <dd>{database || 'unknown'}</dd>
          </div>
          <div>
            <dt>Collection</dt>
            <dd>{collection || 'unknown'}</dd>
          </div>
        </dl>
        <div className="mongo-operation-fields">
          {operation === 'rename-collection' ? (
            <>
              <label className="object-view-field">
                <span>New name</span>
                <input value={renameTarget} onChange={(event) => setRenameTarget(event.target.value)} />
              </label>
              <label className="object-view-field">
                <span>Target database</span>
                <input value={renameDatabase} onChange={(event) => setRenameDatabase(event.target.value)} />
              </label>
              <label className="mongo-operation-check">
                <input checked={dropTarget} type="checkbox" onChange={(event) => setDropTarget(event.target.checked)} />
                Drop existing target
              </label>
            </>
          ) : null}
          {operation === 'modify-collection' ? (
            <>
              <div className="object-view-form-grid">
                <label className="object-view-field">
                  <span>Validation level</span>
                  <select value={validationLevel} onChange={(event) => setValidationLevel(event.target.value)}>
                    <option value="">No change</option>
                    <option value="strict">Strict</option>
                    <option value="moderate">Moderate</option>
                    <option value="off">Off</option>
                  </select>
                </label>
                <label className="object-view-field">
                  <span>Validation action</span>
                  <select value={validationAction} onChange={(event) => setValidationAction(event.target.value)}>
                    <option value="">No change</option>
                    <option value="error">Reject invalid documents</option>
                    <option value="warn">Allow and warn</option>
                  </select>
                </label>
              </div>
              <label className="mongo-operation-check">
                <input
                  checked={preAndPostImages}
                  type="checkbox"
                  onChange={(event) => setPreAndPostImages(event.target.checked)}
                />
                Enable change stream pre-images and post-images
              </label>
              <MongoAdvancedDisclosure
                label="Native collMod JSON"
                description="Additional MongoDB collMod fields are merged with the structured options."
              >
                <label className="object-view-field">
                  <span>collMod fields</span>
                  <textarea
                    className="object-view-textarea"
                    placeholder='{ "validator": { "$jsonSchema": { "bsonType": "object" } } }'
                    value={modifyJson}
                    onChange={(event) => setModifyJson(event.target.value)}
                    spellCheck={false}
                  />
                </label>
              </MongoAdvancedDisclosure>
            </>
          ) : null}
          {operation === 'convert-to-capped' ? (
            <label className="object-view-field">
              <span>Size bytes</span>
              <input inputMode="numeric" value={cappedSize} onChange={(event) => setCappedSize(event.target.value)} />
            </label>
          ) : null}
          {operation === 'clone-as-capped' ? (
            <>
              <label className="object-view-field">
                <span>Target collection</span>
                <input value={cloneTarget} onChange={(event) => setCloneTarget(event.target.value)} />
              </label>
              <label className="object-view-field">
                <span>Size bytes</span>
                <input inputMode="numeric" value={cloneSize} onChange={(event) => setCloneSize(event.target.value)} />
              </label>
            </>
          ) : null}
          {operation === 'compact-collection' ? (
            <label className="mongo-operation-check">
              <input checked={compactForce} type="checkbox" onChange={(event) => setCompactForce(event.target.checked)} />
              Force compact when supported
            </label>
          ) : null}
          {operation === 'validate-collection' ? (
            <label className="mongo-operation-check">
              <input checked={validateFull} type="checkbox" onChange={(event) => setValidateFull(event.target.checked)} />
              Run full validation
            </label>
          ) : null}
          {operation === 'drop-collection' ? (
            <p className="object-view-status is-error">
              This prepares a guarded drop operation for the selected collection.
            </p>
          ) : null}
        </div>
        {dialogError ? <p className="dialog-error">{dialogError}</p> : null}
        <div className="workbench-dialog-actions">
          <button type="button" className="drawer-button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className={`drawer-button ${operation === 'drop-collection' ? 'drawer-button--danger' : 'drawer-button--primary'}`}
            onClick={submit}
          >
            {action.reviewLabel}
          </button>
        </div>
      </section>
    </div>
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

function parsePositiveNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}
