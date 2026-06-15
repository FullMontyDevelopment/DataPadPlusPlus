import { useMemo, useState } from 'react'
import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import {
  mongoScopedQueryMenuLabel,
  type MongoObjectViewDescriptor,
} from './MongoObjectViewDescriptors'
import { DownloadIcon, DatabaseIcon, ObjectCollectionIcon, PlayIcon, PlusIcon, RefreshIcon, RenameIcon, SettingsIcon, TrashIcon } from '../../icons'
import { mongoPipelineStageRows } from './MongoPipelineView.helpers'
import {
  arrayOfRecords,
  asRecord,
  documentFieldSummary,
  formatBytes,
  indexKeyPatternText,
  indexOptionsSummary,
  metadataSummary,
  normalizeIndexList,
  numericValue,
  pipelineSummary,
  stringValue,
} from './MongoOverviewView.helpers'
import { KeyValueGrid, ObjectViewTable, PurposeEmptyState, SectionHeading } from '../../ObjectViewPrimitives'

type JsonRecord = Record<string, unknown>

type MongoOperationPlanner = (request: {
  objectName?: string
  operationId: string
  parameters?: Record<string, unknown>
  title: string
}) => void

type MongoCollectionAdminOperation =
  | 'rename-collection'
  | 'drop-collection'
  | 'modify-collection'
  | 'convert-to-capped'
  | 'clone-as-capped'
  | 'compact-collection'
  | 'validate-collection'

const mongoCollectionAdminActions: {
  description: string
  icon: typeof RenameIcon
  id: MongoCollectionAdminOperation
  label: string
  runLabel: string
}[] = [
  {
    id: 'rename-collection',
    label: 'Rename',
    runLabel: 'Run Rename',
    description: 'Rename this collection, optionally moving it into another database.',
    icon: RenameIcon,
  },
  {
    id: 'modify-collection',
    label: 'Modify',
    runLabel: 'Run Modify',
    description: 'Prepare a collMod operation for validation or collection options.',
    icon: SettingsIcon,
  },
  {
    id: 'convert-to-capped',
    label: 'Convert To Capped',
    runLabel: 'Run Convert',
    description: 'Convert this collection to capped storage with a fixed byte size.',
    icon: ObjectCollectionIcon,
  },
  {
    id: 'clone-as-capped',
    label: 'Clone As Capped',
    runLabel: 'Run Clone',
    description: 'Clone this collection into a new capped collection.',
    icon: PlusIcon,
  },
  {
    id: 'compact-collection',
    label: 'Compact',
    runLabel: 'Run Compact',
    description: 'Prepare a compact operation for this collection.',
    icon: RefreshIcon,
  },
  {
    id: 'validate-collection',
    label: 'Validate',
    runLabel: 'Run Validate',
    description: 'Validate collection metadata and documents.',
    icon: PlayIcon,
  },
  {
    id: 'drop-collection',
    label: 'Drop',
    runLabel: 'Run Drop',
    description: 'Prepare a guarded drop operation for this collection.',
    icon: TrashIcon,
  },
]

export function MongoOverviewView({
  kind,
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
  onPlanOperation,
}: {
  kind: string
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: MongoOperationPlanner
}) {
  const facts = [
    ['Database', stringValue(payload.database)],
    ['Collection', stringValue(payload.collection)],
    ['View', stringValue(payload.view)],
    ['Object', stringValue(payload.object)],
  ].filter(([, value]) => value)

  return (
    <div className="object-view-section">
      <SectionHeading
        Icon={kind === 'database' || kind === 'databases' || kind === 'system-databases'
          ? DatabaseIcon
          : ObjectCollectionIcon}
        title={descriptor.title}
        unit="MongoDB"
      />
      {kind === 'databases' || kind === 'system-databases' ? (
        <MongoDatabasesOverview
          payload={payload}
          readOnly={kind === 'system-databases'}
          onPlanOperation={onPlanOperation}
        />
      ) : null}
      {kind === 'database' ? <MongoDatabaseOverview payload={payload} onPlanOperation={onPlanOperation} /> : null}
      {kind === 'collection' ? <MongoCollectionOverview payload={payload} onPlanOperation={onPlanOperation} /> : null}
      {kind === 'view' ? <MongoViewOverview payload={payload} /> : null}
      <KeyValueGrid rows={facts} emptyText="No object metadata has been loaded yet." />
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel ?? mongoScopedQueryMenuLabel(kind)}
        </button>
      ) : null}
    </div>
  )
}

function MongoDatabasesOverview({
  payload,
  readOnly,
  onPlanOperation,
}: {
  payload: JsonRecord
  readOnly: boolean
  onPlanOperation?: MongoOperationPlanner
}) {
  const databases = arrayOfRecords(payload.databases)
  const [databaseName, setDatabaseName] = useState('')
  const [collectionName, setCollectionName] = useState('init')
  const [optionsJson, setOptionsJson] = useState('{}')
  const [validationError, setValidationError] = useState('')

  const planCreateDatabase = () => {
    const database = databaseName.trim()
    const collection = collectionName.trim()
    if (!database) {
      setValidationError('Database name is required.')
      return
    }
    if (!collection) {
      setValidationError('First collection name is required.')
      return
    }
    const options = parseJsonObject(optionsJson, 'Collection options')
    if (!options.ok) {
      setValidationError(options.error)
      return
    }

    setValidationError('')
    onPlanOperation?.({
      title: `Create database ${database}`,
      operationId: 'mongodb.database.create',
      objectName: database,
      parameters: {
        database,
        collection,
        options: options.value,
      },
    })
  }

  return (
    <>
      {!readOnly ? (
        <div className="object-view-management">
          <strong>Create Database</strong>
          <div className="object-view-form-grid">
            <label className="object-view-field">
              <span>Database</span>
              <input
                placeholder="analytics"
                value={databaseName}
                onChange={(event) => setDatabaseName(event.target.value)}
              />
            </label>
            <label className="object-view-field">
              <span>First collection</span>
              <input
                placeholder="documents"
                value={collectionName}
                onChange={(event) => setCollectionName(event.target.value)}
              />
            </label>
          </div>
          <details className="object-view-disclosure">
            <summary>Collection options</summary>
            <label className="object-view-field">
              <span>Options JSON</span>
              <textarea
                className="object-view-textarea"
                value={optionsJson}
                onChange={(event) => setOptionsJson(event.target.value)}
                spellCheck={false}
              />
            </label>
          </details>
          {validationError ? <p className="object-view-status is-error">{validationError}</p> : null}
          <div className="object-view-button-row">
            <button
              type="button"
              className="drawer-button drawer-button--primary"
              disabled={!onPlanOperation}
              onClick={planCreateDatabase}
            >
              <PlusIcon className="panel-inline-icon" />
              Run Create Database
            </button>
          </div>
        </div>
      ) : null}
      <ObjectViewTable
        columns={['Database', 'Type', 'Details']}
        rows={databases.map((database) => [
          stringValue(database.name ?? database.database),
          stringValue(database.type) || (database.system ? 'System' : 'User'),
          metadataSummary(database, ['name', 'database', 'type', 'system']),
        ])}
        emptyText={readOnly
          ? 'No system database metadata was returned.'
          : 'No user database metadata was returned.'}
      />
    </>
  )
}

function MongoDatabaseOverview({
  payload,
  onPlanOperation,
}: {
  payload: JsonRecord
  onPlanOperation?: MongoOperationPlanner
}) {
  const collections = arrayOfRecords(payload.collections)
  const views = arrayOfRecords(payload.views)
  const timeSeriesCollections = arrayOfRecords(payload.timeSeriesCollections)
  const cappedCollections = arrayOfRecords(payload.cappedCollections)
  const gridfsBuckets = arrayOfRecords(payload.gridfsBuckets)
  const users = arrayOfRecords(payload.users)
  const roles = arrayOfRecords(payload.roles)
  const stats = asRecord(payload.statistics ?? payload.stats)
  const database = stringValue(payload.database)
  const [collectionName, setCollectionName] = useState('')
  const [optionsJson, setOptionsJson] = useState('{}')
  const [validationError, setValidationError] = useState('')
  const isSystemDatabase = isMongoSystemDatabase(database)
  const planCreateCollection = () => {
    const collection = collectionName.trim()
    if (!database) {
      setValidationError('Database name is required.')
      return
    }
    if (!collection) {
      setValidationError('Collection name is required.')
      return
    }
    const options = parseJsonObject(optionsJson, 'Collection options')
    if (!options.ok) {
      setValidationError(options.error)
      return
    }

    setValidationError('')
    onPlanOperation?.({
      title: `Create collection ${collection}`,
      operationId: 'mongodb.collection.create',
      objectName: collection,
      parameters: {
        database,
        collection,
        options: options.value,
      },
    })
  }
  const planDropDatabase = () => {
    if (!database || isSystemDatabase) {
      return
    }

    onPlanOperation?.({
      title: `Drop database ${database}`,
      operationId: 'mongodb.database.drop',
      objectName: database,
      parameters: { database },
    })
  }

  return (
    <>
      <div className="object-view-management">
        <strong>Database Management</strong>
        <div className="object-view-form-grid">
          <label className="object-view-field">
            <span>New collection</span>
            <input
              placeholder="documents"
              value={collectionName}
              onChange={(event) => setCollectionName(event.target.value)}
            />
          </label>
          <label className="object-view-field">
            <span>Database</span>
            <input value={database} disabled readOnly />
          </label>
        </div>
        <details className="object-view-disclosure">
          <summary>Collection options</summary>
          <label className="object-view-field">
            <span>Options JSON</span>
            <textarea
              className="object-view-textarea"
              value={optionsJson}
              onChange={(event) => setOptionsJson(event.target.value)}
              spellCheck={false}
            />
          </label>
        </details>
        {validationError ? <p className="object-view-status is-error">{validationError}</p> : null}
        <div className="object-view-button-row">
          <button
            type="button"
            className="drawer-button drawer-button--primary"
            disabled={!onPlanOperation || !database}
            onClick={planCreateCollection}
          >
            <PlusIcon className="panel-inline-icon" />
            Run Create Collection
          </button>
          <button
            type="button"
            className="drawer-button"
            disabled={!onPlanOperation || !database || isSystemDatabase}
            title={isSystemDatabase ? 'System databases cannot be dropped from DataPad++.' : undefined}
            onClick={planDropDatabase}
          >
            <TrashIcon className="panel-inline-icon" />
            Run Drop Database
          </button>
        </div>
      </div>
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>Collections</span>
          <strong>{collections.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Views</span>
          <strong>{views.length}</strong>
        </div>
        <div className="object-view-card">
          <span>GridFS buckets</span>
          <strong>{gridfsBuckets.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Users / roles</span>
          <strong>{users.length}/{roles.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Objects</span>
          <strong>{stringValue(stats.objects ?? stats.collections ?? '') || 'unknown'}</strong>
        </div>
      </div>
      <ObjectViewTable
        columns={['Collection', 'Type', 'Details']}
        rows={[
          ...collections.map((collection) => [
            stringValue(collection.name ?? collection.collection),
            'Collection',
            metadataSummary(collection, ['name', 'collection', 'type']),
          ]),
          ...timeSeriesCollections.map((collection) => [
            stringValue(collection.name ?? collection.collection),
            'Time series',
            metadataSummary(collection, ['name', 'collection', 'type']),
          ]),
          ...cappedCollections.map((collection) => [
            stringValue(collection.name ?? collection.collection),
            'Capped',
            metadataSummary(collection, ['name', 'collection', 'type']),
          ]),
        ]}
        emptyText="No collection metadata was returned for this database."
      />
      <ObjectViewTable
        columns={['View', 'Stages', 'First stage']}
        rows={views.map((view) => [
          stringValue(view.name ?? view.view),
          String(Array.isArray(view.pipeline) ? view.pipeline.length : 0),
          pipelineSummary(view.pipeline),
        ])}
        emptyText="No MongoDB views were returned for this database."
      />
    </>
  )
}

function MongoCollectionOverview({
  payload,
  onPlanOperation,
}: {
  payload: JsonRecord
  onPlanOperation?: MongoOperationPlanner
}) {
  const database = stringValue(payload.database)
  const collection = stringValue(payload.collection)
  const initialAdminOperation = mongoCollectionAdminOperationFromNodeId(
    stringValue(payload.nodeId),
  )
  const indexes = normalizeIndexList(payload.indexes)
  const sampleDocuments = arrayOfRecords(payload.sampleDocuments)
  const validator = payload.validator ?? asRecord(payload.options)?.validator
  const statistics = asRecord(payload.statistics ?? payload.stats)
  const [activeAdminOperation, setActiveAdminOperation] =
    useResettableState<MongoCollectionAdminOperation | undefined>(initialAdminOperation)
  const [managementError, setManagementError] = useState('')
  const requireCollection = (setDialogError?: (message: string) => void) => {
    if (!database || !collection) {
      const message = 'A database and collection are required.'
      if (setDialogError) {
        setDialogError(message)
      } else {
        setManagementError(message)
      }
      return false
    }
    return true
  }
  const planCollectionManagement = (
    title: string,
    operationId: string,
    extraParameters: Record<string, unknown> = {},
    setDialogError?: (message: string) => void,
  ) => {
    if (!requireCollection(setDialogError)) {
      return
    }
    setManagementError('')
    setActiveAdminOperation(undefined)
    onPlanOperation?.({
      title,
      operationId,
      objectName: collection,
      parameters: {
        database,
        collection,
        ...extraParameters,
      },
    })
  }
  const planExport = () => {
    onPlanOperation?.({
      title: `Export ${collection}`,
      operationId: 'mongodb.collection.export',
      objectName: collection,
      parameters: {
        database,
        collection,
        format: 'extended-json',
        filter: {},
        projection: {},
        sort: {},
        batchSize: 1000,
      },
    })
  }
  const planImport = () => {
    onPlanOperation?.({
      title: `Import into ${collection}`,
      operationId: 'mongodb.collection.import',
      objectName: collection,
      parameters: {
        database,
        collection,
        format: 'json',
        mode: 'insertMany',
        validation: 'validate-before-write',
        mapping: {},
      },
    })
  }

  return (
    <>
      <div className="object-view-button-row object-view-button-row--compact" aria-label="Collection data actions">
        <button
          type="button"
          className="drawer-button"
          disabled={!onPlanOperation || !collection}
          title="Review export settings before writing files."
          onClick={planExport}
        >
          <DownloadIcon className="panel-inline-icon" />
          Export
        </button>
        <button
          type="button"
          className="drawer-button"
          disabled={!onPlanOperation || !collection}
          title="Review import settings before changing data."
          onClick={planImport}
        >
          <PlusIcon className="panel-inline-icon" />
          Import
        </button>
      </div>
      <div className="object-view-management">
        <strong>Collection Management</strong>
        <div className="object-view-action-chips" aria-label="Collection management actions">
          {mongoCollectionAdminActions.map((action) => {
            const Icon = action.icon
            return (
              <button
                type="button"
                className="object-view-action-chip object-view-action-chip--button"
                disabled={!onPlanOperation || !collection}
                key={action.id}
                title={action.description}
                onClick={() => {
                  setManagementError('')
                  setActiveAdminOperation(action.id)
                }}
              >
                <Icon className="panel-inline-icon" />
                {action.label}
              </button>
            )
          })}
        </div>
        {managementError ? <p className="object-view-status is-error">{managementError}</p> : null}
      </div>
      {activeAdminOperation ? (
        <MongoCollectionOperationDialog
          collection={collection}
          database={database}
          operation={activeAdminOperation}
          onCancel={() => setActiveAdminOperation(undefined)}
          onPlan={planCollectionManagement}
        />
      ) : null}
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>Sample size</span>
          <strong>{sampleDocuments.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Indexes</span>
          <strong>{indexes.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Validator</span>
          <strong>{validator && Object.keys(asRecord(validator)).length ? 'configured' : 'none'}</strong>
        </div>
        <div className="object-view-card">
          <span>Documents</span>
          <strong>{stringValue(statistics.count ?? statistics.objects ?? '') || 'unknown'}</strong>
        </div>
        <div className="object-view-card">
          <span>Storage</span>
          <strong>{formatBytes(numericValue(statistics.storageSize ?? statistics.size))}</strong>
        </div>
      </div>
      <ObjectViewTable
        columns={['Index', 'Key pattern', 'Options']}
        rows={indexes.map((index) => [
          stringValue(index.name),
          indexKeyPatternText(index.key),
          indexOptionsSummary(index, ['name', 'key']),
        ])}
        emptyText="No index metadata was returned for this collection."
      />
      <ObjectViewTable
        columns={['Document', 'Fields', 'Top fields']}
        rows={sampleDocuments.map((document, index) => [
          stringValue(document._id ?? `Document ${index + 1}`),
          String(Object.keys(document).length),
          documentFieldSummary(document),
        ])}
        emptyText="No document sample metadata was returned for this collection."
      />
    </>
  )
}

function MongoCollectionOperationDialog({
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
    if (Object.keys(options.value).length === 0) {
      setDialogError('Modification JSON needs at least one collMod field.')
      return
    }
    onPlan(`Modify ${collection}`, 'mongodb.collection.modify', {
      options: options.value,
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
            <label className="object-view-field">
              <span>collMod JSON</span>
              <textarea
                className="object-view-textarea"
                placeholder='{ "validationLevel": "moderate" }'
                value={modifyJson}
                onChange={(event) => setModifyJson(event.target.value)}
                spellCheck={false}
              />
            </label>
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
            {action.runLabel}
          </button>
        </div>
      </section>
    </div>
  )
}

function MongoViewOverview({ payload }: { payload: JsonRecord }) {
  const pipeline = Array.isArray(payload.pipeline) ? payload.pipeline : []

  return (
    pipeline.length ? (
      <div className="mongo-pipeline-stage-list" role="group" aria-label="MongoDB object pipeline stages">
        {mongoPipelineStageRows(pipeline).map((stage, index) => (
          <article className="mongo-pipeline-stage" key={`${stage.operator}:${index}`}>
            <div className="mongo-pipeline-stage-order">{index + 1}</div>
            <div className="mongo-pipeline-stage-body">
              <div className="mongo-pipeline-stage-title">
                <strong>{stage.operator}</strong>
                <span>{stage.summary}</span>
              </div>
              {stage.details.length ? (
                <div className="mongo-pipeline-stage-tags">
                  {stage.details.map((detail) => <span key={detail}>{detail}</span>)}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    ) : (
      <PurposeEmptyState descriptor={{
        emptyTitle: 'No view pipeline metadata',
        emptyDescription: 'Refresh this view or check that the selected MongoDB view still exists.',
      }} />
    )
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

function mongoCollectionAdminOperationFromNodeId(
  nodeId: string,
): MongoCollectionAdminOperation | undefined {
  if (!nodeId.startsWith('collection-admin:')) {
    return undefined
  }
  const operation = nodeId.slice('collection-admin:'.length).split(':')[0]
  return mongoCollectionAdminActions.some((action) => action.id === operation)
    ? operation as MongoCollectionAdminOperation
    : undefined
}

function useResettableState<T>(resetValue: T) {
  const [state, setState] = useState(() => ({
    resetValue,
    value: resetValue,
  }))
  const value = Object.is(state.resetValue, resetValue) ? state.value : resetValue
  const setValue = (nextValue: T) => setState({ resetValue, value: nextValue })
  return [value, setValue] as const
}

function isMongoSystemDatabase(database: string) {
  return database === 'admin' || database === 'config' || database === 'local'
}
