import { useCallback, useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  EnvironmentProfile,
  ExplorerNode,
  OperationPlan,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  DatabaseIcon,
  ObjectCollectionIcon,
  ObjectDocumentIcon,
  ObjectRoleIcon,
  ObjectSearchIcon,
  ObjectSecurityIcon,
  PlusIcon,
  PlayIcon,
  RefreshIcon,
  DownloadIcon,
  WarningIcon,
  TrashIcon,
} from './icons'
import {
  getMongoObjectViewDescriptor,
  mongoScopedQueryMenuLabel,
  type MongoObjectViewDescriptor,
} from './MongoObjectViewDescriptors'
import { MongoCreateIndexView } from './MongoCreateIndexView'
import { MongoDocumentInsertPanel } from './MongoDocumentInsertPanel'
import { MongoIndexesView } from './MongoIndexViews'
import { CassandraObjectViewWorkspace } from './CassandraObjectViewWorkspace'
import { CosmosObjectViewWorkspace } from './CosmosObjectViewWorkspace'
import { DynamoObjectViewWorkspace } from './DynamoObjectViewWorkspace'
import { GraphObjectViewWorkspace } from './GraphObjectViewWorkspace'
import { InfluxObjectViewWorkspace } from './InfluxObjectViewWorkspace'
import { LiteDbObjectViewWorkspace } from './LiteDbObjectViewWorkspace'
import { MemcachedObjectViewWorkspace } from './MemcachedObjectViewWorkspace'
import { OpenTsdbObjectViewWorkspace } from './OpenTsdbObjectViewWorkspace'
import { OracleObjectViewWorkspace } from './OracleObjectViewWorkspace'
import { PrometheusObjectViewWorkspace } from './PrometheusObjectViewWorkspace'
import { RelationalObjectViewWorkspace } from './RelationalObjectViewWorkspace'
import { executeDataEditWithConfirmation } from './results/data-edit-confirmation'
import { useDataEditConfirmation } from './results/use-data-edit-confirmation'
import { RedisObjectViewWorkspace } from './RedisObjectViewWorkspace'
import { SearchObjectViewWorkspace } from './SearchObjectViewWorkspace'
import { WarehouseObjectViewWorkspace } from './WarehouseObjectViewWorkspace'
import { ExplorerNodeIcon } from './SideBar.node-icons'

interface ObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
  onOpenObjectView?(connectionId: string, node: ExplorerNode): void
  onPlanOperation?(request: OperationPlanRequest): Promise<OperationPlanResponse | undefined>
  onExecuteDataEdit?(request: DataEditExecutionRequest): Promise<DataEditExecutionResponse | undefined>
}

type JsonRecord = Record<string, unknown>
type ObjectViewFeedback = {
  title: string
  plan?: OperationPlan
  executed?: boolean
  messages: string[]
  warnings: string[]
  metadata?: unknown
}
type MongoOperationPlanner = (request: {
  objectName?: string
  operationId: string
  parameters?: Record<string, unknown>
  title: string
}) => void

export function ObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
  onOpenObjectView,
  onPlanOperation,
  onExecuteDataEdit,
}: ObjectViewWorkspaceProps) {
  if (connection.engine === 'mongodb') {
    return (
      <MongoObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
        onOpenObjectView={onOpenObjectView}
        onPlanOperation={onPlanOperation}
        onExecuteDataEdit={onExecuteDataEdit}
      />
    )
  }

  if (connection.engine === 'litedb') {
    return (
      <LiteDbObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'cosmosdb') {
    return (
      <CosmosObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return (
      <RedisObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'memcached') {
    return (
      <MemcachedObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
      />
    )
  }

  if (connection.engine === 'oracle') {
    return (
      <OracleObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (
    connection.engine === 'postgresql' ||
    connection.engine === 'cockroachdb' ||
    connection.engine === 'timescaledb' ||
    connection.engine === 'sqlserver' ||
    connection.engine === 'sqlite' ||
    connection.engine === 'duckdb' ||
    connection.engine === 'mysql' ||
    connection.engine === 'mariadb'
  ) {
    return (
      <RelationalObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return (
      <SearchObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.family === 'graph') {
    return (
      <GraphObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.family === 'warehouse') {
    return (
      <WarehouseObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'prometheus') {
    return (
      <PrometheusObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'influxdb') {
    return (
      <InfluxObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'opentsdb') {
    return (
      <OpenTsdbObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'dynamodb') {
    return (
      <DynamoObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  if (connection.engine === 'cassandra') {
    return (
      <CassandraObjectViewWorkspace
        connection={connection}
        environment={environment}
        tab={tab}
        onRefresh={onRefresh}
        onOpenQuery={onOpenQuery}
      />
    )
  }

  return (
    <GenericObjectViewWorkspace
      connection={connection}
      environment={environment}
      tab={tab}
      onRefresh={onRefresh}
    />
  )
}

function MongoObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
  onOpenObjectView,
  onPlanOperation,
  onExecuteDataEdit,
}: ObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = useMemo(() => mongoObjectViewPayloadWithScope(asRecord(state?.payload), state), [state])
  const [refreshing, setRefreshing] = useState(false)
  const [feedback, setFeedback] = useState<ObjectViewFeedback | undefined>()
  const { confirmDataEdit, confirmationDialog } = useDataEditConfirmation()
  const warnings = objectViewWarnings(tab, payload)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])
  const queryTarget = useMemo(
    () => queryTargetFromObjectView(tab),
    [tab],
  )
  const kind = state?.kind ?? 'object'
  const descriptor = getMongoObjectViewDescriptor(kind)
  const title = descriptor.title
  const summary = mongoObjectViewSummary(state?.summary, descriptor)
  const compactManagementView = isCompactMongoObjectView(kind)
  const planMongoOperation = useCallback(async ({
    objectName,
    operationId,
    parameters,
    title,
  }: {
    objectName?: string
    operationId: string
    parameters?: Record<string, unknown>
    title: string
  }) => {
    if (!onPlanOperation) {
      setFeedback({
        title,
        messages: [],
        warnings: ['Operation planning is not available in this workspace.'],
      })
      return
    }

    const response = await onPlanOperation({
      connectionId: connection.id,
      environmentId: environment.id,
      operationId,
      objectName,
      parameters,
    })

    setFeedback({
      title,
      plan: response?.plan,
      messages: response?.plan ? ['Ready to review.'] : [],
      warnings: response?.plan?.warnings ?? ['DataPad++ could not prepare this change.'],
    })
  }, [connection.id, environment.id, onPlanOperation, setFeedback])
  const uploadMongoDocument = useCallback(async (document: JsonRecord) => {
    if (!onExecuteDataEdit) {
      setFeedback({
        title: 'Insert Document',
        messages: [],
        warnings: ['Document insert is not available in this workspace.'],
      })
      return
    }

    const collection = stringValue(payload.collection)
    const database = stringValue(payload.database)
    if (!collection) {
      setFeedback({
        title: 'Insert Document',
        messages: [],
        warnings: ['A target collection is required before a document can be inserted.'],
      })
      return
    }

    const request: DataEditExecutionRequest = {
      connectionId: connection.id,
      environmentId: environment.id,
      editKind: 'insert-document',
      target: {
        objectKind: 'document',
        path: [database, collection].filter(Boolean),
        database,
        collection,
      },
      changes: [{
        value: document,
        valueType: 'json',
      }],
    }
    const response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
      actionLabel: `Insert a document into ${collection}.`,
      confirm: confirmDataEdit,
      confirmationTitle: 'Insert this MongoDB document?',
    })

    setFeedback({
      title: 'Insert Document',
      plan: response?.plan,
      executed: response?.executed,
      messages: response?.messages ?? [],
      warnings: response?.warnings ?? ['Document insert did not return a response.'],
      metadata: response?.metadata,
    })
  }, [confirmDataEdit, connection.id, environment.id, onExecuteDataEdit, payload.collection, payload.database, setFeedback])
  const openMongoToolView = useCallback((toolKind: 'insert-document' | 'create-index', label: string) => {
    if (!onOpenObjectView) {
      return
    }

    const database = stringValue(payload.database)
    const collection = stringValue(payload.collection)
    if (!database || !collection) {
      return
    }

    onOpenObjectView(connection.id, {
      id: `${toolKind}:${database}:${collection}`,
      family: connection.family,
      label,
      kind: toolKind,
      detail: '',
      path: [database, 'Collections', collection],
      queryTemplate: undefined,
      expandable: false,
    })
  }, [connection.family, connection.id, onOpenObjectView, payload.collection, payload.database])

  return (
    <section className="object-view-workspace" aria-label={`${title} object view`}>
      <ObjectViewHeader
        connection={connection}
        environment={environment}
        kind={kind}
        path={state?.path}
        title={title}
        refreshing={refreshing}
        onRefresh={refresh}
      >
        {kind === 'collection' ? (
          <button
            type="button"
            className="drawer-button"
            disabled={!payload.collection}
            title="Add a document to this collection"
            onClick={() => openMongoToolView('insert-document', 'Add Document')}
          >
            <ObjectDocumentIcon className="panel-inline-icon" />
            Add Document
          </button>
        ) : null}
        {kind === 'indexes' ? (
          <button
            type="button"
            className="drawer-button"
            disabled={!payload.collection}
            title="Create a MongoDB index for this collection"
            onClick={() => openMongoToolView('create-index', 'Create Index')}
          >
            <PlusIcon className="panel-inline-icon" />
            Create Index
          </button>
        ) : null}
        {queryTarget ? (
          <button
            type="button"
            className="drawer-button"
            onClick={() => onOpenQuery(queryTarget)}
          >
            <PlayIcon className="panel-inline-icon" />
            {descriptor.primaryQueryLabel ?? mongoScopedQueryMenuLabel(kind)}
          </button>
        ) : null}
      </ObjectViewHeader>

      {compactManagementView ? null : (
        <div className="object-view-purpose">
          <strong>{state?.label && state.label !== descriptor.title ? state.label : descriptor.menuLabel}</strong>
          <div className="object-view-purpose-text" title={descriptor.purpose}>
            <span>{descriptor.purpose}</span>
            <div className="object-view-action-chips" aria-label="Primary workflows">
              {descriptor.primaryActions.map((action) => (
                <span key={action} className="object-view-action-chip">{action}</span>
              ))}
            </div>
          </div>
        </div>
      )}
      {summary ? <p className="object-view-summary">{summary}</p> : null}
      <WarningList warnings={warnings} />

      <div className="object-view-body">
        {renderMongoObjectView(kind, descriptor, payload, onOpenQuery, queryTarget, {
          feedback,
          onPlanOperation: planMongoOperation,
          onUploadDocument: uploadMongoDocument,
          onOpenToolView: openMongoToolView,
        })}
        <ObjectViewFeedbackPanel feedback={feedback} />
        {confirmationDialog}
      </div>
    </section>
  )
}

function GenericObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
}: Omit<ObjectViewWorkspaceProps, 'onOpenQuery'>) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      await onRefresh(tab.id)
    } finally {
      setRefreshing(false)
    }
  }, [onRefresh, tab.id])

  return (
    <section className="object-view-workspace" aria-label={`${state?.label ?? tab.title} object view`}>
      <ObjectViewHeader
        connection={connection}
        environment={environment}
        kind={state?.kind ?? 'object'}
        path={state?.path}
        title={state?.label ?? tab.title}
        refreshing={refreshing}
        onRefresh={refresh}
      />
      <WarningList warnings={objectViewWarnings(tab, payload)} />
    </section>
  )
}

function ObjectViewHeader({
  children,
  connection,
  environment,
  kind,
  path,
  title,
  refreshing,
  onRefresh,
}: {
  children?: ReactNode
  connection: ConnectionProfile
  environment: EnvironmentProfile
  kind: string
  path?: string[]
  title: string
  refreshing: boolean
  onRefresh(): void
}) {
  return (
    <div className="object-view-toolbar">
      <div className="object-view-heading">
        <ExplorerNodeIcon connection={connection} kind={kind} />
        <div>
          <strong>{title}</strong>
          <span>
            {[connection.name, environment.label, ...(path ?? [])].filter(Boolean).join(' / ')}
          </span>
        </div>
      </div>
      <div className="object-view-actions">
        {children}
        <button
          type="button"
          className="drawer-button"
          disabled={refreshing}
          onClick={onRefresh}
        >
          <RefreshIcon className="panel-inline-icon" />
          {refreshing ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
    </div>
  )
}

function renderMongoObjectView(
  kind: string,
  descriptor: MongoObjectViewDescriptor,
  payload: JsonRecord,
  onOpenQuery: (target: ScopedQueryTarget) => void,
  queryTarget?: ScopedQueryTarget,
  actions?: {
    feedback?: ObjectViewFeedback
    onPlanOperation: MongoOperationPlanner
    onUploadDocument(document: JsonRecord): Promise<void>
    onOpenToolView?(toolKind: 'insert-document' | 'create-index', label: string): void
  },
) {
  if (kind === 'insert-document') {
    return (
      <MongoDocumentInsertView
        descriptor={descriptor}
        payload={payload}
        onUploadDocument={actions?.onUploadDocument}
      />
    )
  }

  if (kind === 'create-index') {
    return (
      <MongoCreateIndexView
        descriptor={descriptor}
        payload={payload}
        onPlanOperation={actions?.onPlanOperation}
      />
    )
  }

  if (kind === 'database' || kind === 'collection' || kind === 'view') {
    return (
      <MongoOverviewView
        kind={kind}
        descriptor={descriptor}
        payload={payload}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
        onPlanOperation={actions?.onPlanOperation}
      />
    )
  }

  if (kind === 'schema-preview') {
    return <MongoSchemaView descriptor={descriptor} payload={payload} onPlanOperation={actions?.onPlanOperation} />
  }

  if (kind === 'indexes' || kind === 'search-indexes' || kind === 'vector-indexes') {
    return (
      <MongoIndexesView
        descriptor={descriptor}
        payload={payload}
        onOpenCreateIndex={kind === 'indexes' ? () => actions?.onOpenToolView?.('create-index', 'Create Index') : undefined}
        onPlanOperation={actions?.onPlanOperation}
      />
    )
  }

  if (kind === 'validation-rules') {
    return (
      <MongoValidationView
        key={mongoValidationViewKey(payload)}
        descriptor={descriptor}
        payload={payload}
        onPlanOperation={actions?.onPlanOperation}
      />
    )
  }

  if (kind === 'collection-statistics' || kind === 'database-statistics') {
    return <MongoStatisticsView descriptor={descriptor} payload={payload} />
  }

  if (kind === 'permissions' || kind === 'users' || kind === 'roles') {
    return <MongoSecurityView kind={kind} descriptor={descriptor} payload={payload} onPlanOperation={actions?.onPlanOperation} />
  }

  if (kind === 'scripts' || kind === 'aggregations') {
    return <MongoScriptsView descriptor={descriptor} payload={payload} queryTarget={queryTarget} onOpenQuery={onOpenQuery} />
  }

  if (kind === 'pipeline') {
    return <MongoPipelineView descriptor={descriptor} payload={payload} queryTarget={queryTarget} onOpenQuery={onOpenQuery} />
  }

  if (kind.startsWith('gridfs')) {
    return (
      <MongoGridFsView
        descriptor={descriptor}
        payload={payload}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
        onPlanOperation={actions?.onPlanOperation}
      />
    )
  }

  return <MongoOverviewView kind={kind} descriptor={descriptor} payload={payload} queryTarget={queryTarget} onOpenQuery={onOpenQuery} />
}

function MongoOverviewView({
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
        Icon={kind === 'database' ? DatabaseIcon : ObjectCollectionIcon}
        title={descriptor.title}
        unit="MongoDB"
      />
      <p className="object-view-note">{descriptor.purpose}</p>
      {kind === 'database' ? <MongoDatabaseOverview payload={payload} /> : null}
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

function MongoDocumentInsertView({
  descriptor,
  payload,
  onUploadDocument,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  onUploadDocument?: (document: JsonRecord) => Promise<void>
}) {
  const database = stringValue(payload.database)
  const collection = stringValue(payload.collection)
  const requiredFields = requiredFieldsForValidator(payload)

  return (
    <div className="object-view-section">
      <SectionHeading
        Icon={ObjectDocumentIcon}
        title={descriptor.title}
        unit={[database, collection].filter(Boolean).join(' / ') || 'MongoDB'}
      />
      <MongoDocumentInsertPanel
        collection={collection}
        requiredFields={requiredFields}
        onInsertDocument={async (document) => {
          if (onUploadDocument) {
            await onUploadDocument(document)
          }
        }}
      />
    </div>
  )
}

function MongoDatabaseOverview({ payload }: { payload: JsonRecord }) {
  const collections = arrayOfRecords(payload.collections)
  const views = arrayOfRecords(payload.views)
  const timeSeriesCollections = arrayOfRecords(payload.timeSeriesCollections)
  const cappedCollections = arrayOfRecords(payload.cappedCollections)
  const gridfsBuckets = arrayOfRecords(payload.gridfsBuckets)
  const users = arrayOfRecords(payload.users)
  const roles = arrayOfRecords(payload.roles)
  const stats = asRecord(payload.statistics ?? payload.stats)

  return (
    <>
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
  const indexes = normalizeIndexList(payload.indexes)
  const sampleDocuments = arrayOfRecords(payload.sampleDocuments)
  const validator = payload.validator ?? asRecord(payload.options)?.validator
  const statistics = asRecord(payload.statistics ?? payload.stats)
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
        kind: 'view',
        title: 'View Pipeline',
        menuLabel: 'Open Pipeline',
        purpose: '',
        emptyTitle: 'No view pipeline metadata',
        emptyDescription: 'Refresh this view or check that the selected MongoDB view still exists.',
        primaryActions: [],
      }} />
    )
  )
}

function MongoSchemaView({
  descriptor,
  payload,
  onPlanOperation,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  onPlanOperation?: (request: {
    objectName?: string
    operationId: string
    parameters?: Record<string, unknown>
    title: string
  }) => void
}) {
  const fields = arrayOfRecords(payload.fields)
  const database = stringValue(payload.database)
  const collection = stringValue(payload.collection)
  const sampleSize = numericValue(payload.sampleSize) || maxFieldPresence(fields)
  const mixedTypeCount = fields.filter((field) => fieldTypeNames(field).length > 1).length
  const requiredFields = requiredFieldsForValidator(payload)
  const previewValidator = useCallback(() => {
    onPlanOperation?.({
      title: `Generate validator for ${collection}`,
      operationId: 'mongodb.validation.update',
      objectName: collection,
      parameters: {
        database,
        collection,
        validator: generateValidatorFromFields(fields, sampleSize),
      },
    })
  }, [collection, database, fields, onPlanOperation, sampleSize])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectDocumentIcon} title={descriptor.title} unit={`${fields.length} field(s)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>Sampled documents</span>
          <strong>{sampleSize}</strong>
        </div>
        <div className="object-view-card">
          <span>Field paths</span>
          <strong>{fields.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Mixed types</span>
          <strong>{mixedTypeCount}</strong>
        </div>
        <div className="object-view-card">
          <span>Required fields</span>
          <strong>{requiredFields.length}</strong>
        </div>
      </div>
      <ObjectViewTable
        columns={['Field path', 'BSON types', 'Presence', 'Examples', 'Warnings']}
        rows={fields.map((field) => [
          stringValue(field.path),
          fieldTypesText(field),
          fieldPresenceText(field, sampleSize),
          compactJson(field.examples ?? field.example ?? ''),
          fieldWarningsText(field, sampleSize),
        ])}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      <div className="object-view-management">
        <strong>Validator</strong>
        <details className="object-view-disclosure">
          <summary>Generated rule</summary>
          <pre className="object-view-code">{prettyJson(generateValidatorFromFields(fields, sampleSize))}</pre>
        </details>
        <div className="object-view-button-row">
          <button
            type="button"
            className="drawer-button"
            disabled={!onPlanOperation || !collection || fields.length === 0}
            onClick={previewValidator}
          >
            Prepare Validator
          </button>
        </div>
      </div>
    </div>
  )
}

function MongoValidationView({
  descriptor,
  payload,
  onPlanOperation,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  onPlanOperation?: (request: {
    objectName?: string
    operationId: string
    parameters?: Record<string, unknown>
    title: string
  }) => void
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
      <p className="object-view-note">{descriptor.purpose}</p>
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

function MongoStatisticsView({
  descriptor,
  payload,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
}) {
  const stats = asRecord(payload.result) ?? payload
  const metricRows = Object.entries(stats)
    .filter(([, value]) => typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean')
    .map(([key, value]) => [humanizeMetric(key), String(value)])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={DatabaseIcon} title={descriptor.title} unit={`${metricRows.length} metric(s)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <div className="object-view-card-grid">
        {metricRows.slice(0, 8).map(([label, value]) => (
          <div key={label} className="object-view-card">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <ObjectViewTable
        columns={['Metric', 'Value']}
        rows={metricRows}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
    </div>
  )
}

function MongoSecurityView({
  kind,
  descriptor,
  payload,
  onPlanOperation,
}: {
  kind: string
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  onPlanOperation?: (request: {
    objectName?: string
    operationId: string
    parameters?: Record<string, unknown>
    title: string
  }) => void
}) {
  const users = arrayOfRecords(payload.users)
  const roles = arrayOfRecords(payload.roles)
  const database = stringValue(payload.database)
  const isRoleView = kind === 'roles'
  const roleReferenceCount = rowsForSecurityReferences(isRoleView ? roles : users, isRoleView)
  const privilegeCount = roles.reduce((count, role) => count + arrayOfRecords(role.privileges).length, 0)
  const [principalName, setPrincipalName] = useState('')
  const [passwordVariable, setPasswordVariable] = useState('')
  const [assignedRole, setAssignedRole] = useState('readWrite')
  const [assignedRoleDatabase, setAssignedRoleDatabase] = useState(database || 'admin')
  const [privilegeDatabase, setPrivilegeDatabase] = useState(database || 'admin')
  const [privilegeCollection, setPrivilegeCollection] = useState('')
  const [privilegeActions, setPrivilegeActions] = useState('find, insert, update')
  const [validationError, setValidationError] = useState('')
  const rows = isRoleView
    ? roles.map((role) => [
        stringValue(role.role ?? role.name),
        securityReferencesText(role.roles ?? role.inheritedRoles),
        privilegesText(role.privileges),
      ])
    : users.map((user) => [
        stringValue(user.user ?? user.name),
        securityReferencesText(user.roles),
        userDetailsText(user),
      ])
  const previewCreate = useCallback(() => {
    const name = principalName.trim()
    if (!name) {
      setValidationError(isRoleView ? 'Role name is required.' : 'Username is required.')
      return
    }
    const role = assignedRole.trim()
    const roleDb = assignedRoleDatabase.trim() || database || 'admin'
    if (!role) {
      setValidationError('Assigned role is required.')
      return
    }
    const passwordToken = passwordVariable.trim()
    if (!isRoleView && passwordToken && !isVariableToken(passwordToken)) {
      setValidationError('Use an environment secret variable such as {{MONGO_USER_PASSWORD}}.')
      return
    }
    const roles = [{ role, db: roleDb }]
    const privilegeActionList = privilegeActions
      .split(',')
      .map((action) => action.trim())
      .filter(Boolean)
    const privileges = isRoleView && privilegeActionList.length
      ? [{
          resource: {
            db: privilegeDatabase.trim() || database || '',
            collection: privilegeCollection.trim(),
          },
          actions: privilegeActionList,
        }]
      : []
    setValidationError('')
    onPlanOperation?.({
      title: `${isRoleView ? 'Create role' : 'Create user'} ${name}`,
      operationId: isRoleView ? 'mongodb.role.create' : 'mongodb.user.create',
      objectName: name,
      parameters: {
        database,
        name,
        ...(!isRoleView && passwordToken ? { password: passwordToken } : {}),
        roles,
        privileges,
      },
    })
  }, [
    assignedRole,
    assignedRoleDatabase,
    database,
    isRoleView,
    onPlanOperation,
    passwordVariable,
    principalName,
    privilegeActions,
    privilegeCollection,
    privilegeDatabase,
  ])
  const previewDrop = useCallback((name: string) => {
    onPlanOperation?.({
      title: `${isRoleView ? 'Drop role' : 'Drop user'} ${name}`,
      operationId: isRoleView ? 'mongodb.role.drop' : 'mongodb.user.drop',
      objectName: name,
      parameters: {
        database,
        name,
      },
    })
  }, [database, isRoleView, onPlanOperation])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectRoleIcon} title={descriptor.title} unit={`${rows.length} row(s)`} />
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>{isRoleView ? 'Roles' : 'Users'}</span>
          <strong>{rows.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Role references</span>
          <strong>{roleReferenceCount}</strong>
        </div>
        {isRoleView ? (
          <div className="object-view-card">
            <span>Privileges</span>
            <strong>{privilegeCount}</strong>
          </div>
        ) : null}
      </div>
      {rows.length === 0 ? (
        <PurposeEmptyState descriptor={descriptor} />
      ) : (
        <div className="object-view-table-wrap">
          <table className="object-view-table">
            <thead>
              <tr>
                {(isRoleView ? ['Role', 'Inherited roles', 'Privileges', 'Actions'] : ['User', 'Roles', 'Details', 'Actions']).map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const name = row[0] ?? ''
                return (
                  <tr key={row.join('|')}>
                    {row.map((cell, index) => (
                      <td key={`${name}:${index}`}>{cell}</td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="object-view-icon-action is-danger"
                        aria-label={isRoleView ? `Drop role ${name}` : `Drop user ${name}`}
                        disabled={!onPlanOperation || !name}
                        title={isRoleView ? 'Drop role' : 'Drop user'}
                        onClick={() => previewDrop(name)}
                      >
                        <TrashIcon className="toolbar-icon" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="object-view-management">
        <strong>{isRoleView ? 'Create Role' : 'Create User'}</strong>
        <div className="object-view-form-grid">
          <label className="object-view-field">
            <span>{isRoleView ? 'Role name' : 'Username'}</span>
            <input
              value={principalName}
              onChange={(event) => setPrincipalName(event.target.value)}
              placeholder={isRoleView ? 'analytics_reader' : 'reporting_user'}
            />
          </label>
          <label className="object-view-field">
            <span>{isRoleView ? 'Inherited role' : 'Assigned role'}</span>
            <input
              value={assignedRole}
              onChange={(event) => setAssignedRole(event.target.value)}
              placeholder="readWrite"
            />
          </label>
          <label className="object-view-field">
            <span>Role database</span>
            <input
              value={assignedRoleDatabase}
              onChange={(event) => setAssignedRoleDatabase(event.target.value)}
              placeholder={database || 'admin'}
            />
          </label>
          {!isRoleView ? (
            <label className="object-view-field">
              <span>Password variable</span>
              <input
                value={passwordVariable}
                onChange={(event) => setPasswordVariable(event.target.value)}
                placeholder="{{MONGO_USER_PASSWORD}}"
              />
            </label>
          ) : null}
          {isRoleView ? (
            <>
              <label className="object-view-field">
                <span>Privilege database</span>
                <input
                  value={privilegeDatabase}
                  onChange={(event) => setPrivilegeDatabase(event.target.value)}
                  placeholder={database || 'admin'}
                />
              </label>
              <label className="object-view-field">
                <span>Privilege collection</span>
                <input
                  value={privilegeCollection}
                  onChange={(event) => setPrivilegeCollection(event.target.value)}
                  placeholder="Leave empty for database scope"
                />
              </label>
              <label className="object-view-field">
                <span>Actions</span>
                <input
                  value={privilegeActions}
                  onChange={(event) => setPrivilegeActions(event.target.value)}
                  placeholder="find, insert, update"
                />
              </label>
            </>
          ) : null}
        </div>
        {validationError ? <p className="object-view-status is-error">{validationError}</p> : null}
        <div className="object-view-button-row">
          <button
            type="button"
            className="drawer-button"
            disabled={!onPlanOperation}
            onClick={previewCreate}
          >
            {isRoleView ? 'Create Role' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  )
}

function MongoScriptsView({
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const scripts = mongoScriptTemplates(payload.scripts)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectSearchIcon} title={descriptor.title} unit={`${scripts.length} template(s)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel ?? mongoScopedQueryMenuLabel(descriptor.kind)}
        </button>
      ) : null}
      {scripts.length ? (
        <div className="mongo-script-template-list" role="list" aria-label="MongoDB script templates">
          {scripts.map((script) => (
            <MongoScriptTemplateCard key={script.id} template={script} />
          ))}
        </div>
      ) : (
        <PurposeEmptyState descriptor={descriptor} />
      )}
    </div>
  )
}

type MongoScriptTemplate = {
  id: string
  title: string
  summary: string
  script: string
  tags: string[]
}

function MongoScriptTemplateCard({ template }: { template: MongoScriptTemplate }) {
  const [showScript, setShowScript] = useState(false)

  return (
    <article className="mongo-script-template" role="listitem">
      <div className="mongo-script-template-main">
        <strong>{template.title}</strong>
        <span>{template.summary}</span>
        {template.tags.length ? (
          <div className="mongo-pipeline-stage-tags" aria-label={`${template.title} tags`}>
            {template.tags.map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        ) : null}
      </div>
      <div className="mongo-script-template-actions">
        <button
          type="button"
          className="drawer-button"
          onClick={() => setShowScript((current) => !current)}
        >
          {showScript ? 'Hide script' : 'Show script'}
        </button>
      </div>
      {showScript ? <pre className="object-view-code">{template.script}</pre> : null}
    </article>
  )
}

function MongoPipelineView({
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const pipeline = Array.isArray(payload.pipeline) ? payload.pipeline : []
  const stageRows = mongoPipelineStageRows(pipeline)
  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectSearchIcon} title={descriptor.title} unit={`${pipeline.length} stage(s)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      {pipeline.length ? (
        <div className="mongo-pipeline-stage-list" role="group" aria-label="MongoDB view pipeline stages">
          {stageRows.map((stage, index) => (
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
                <details className="mongo-pipeline-stage-json">
                  <summary>View stage document</summary>
                  <pre className="object-view-code">{prettyJson(stage.value)}</pre>
                </details>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <PurposeEmptyState descriptor={descriptor} />
      )}
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel ?? 'Open Results Preview'}
        </button>
      ) : null}
    </div>
  )
}

function MongoGridFsView({
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
  onPlanOperation,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
  onPlanOperation?: MongoOperationPlanner
}) {
  const database = stringValue(payload.database)
  const bucket = stringValue(payload.bucket) || 'fs'
  const filesCollection = stringValue(payload.filesCollection) || `${bucket}.files`
  const chunksCollection = stringValue(payload.chunksCollection) || `${bucket}.chunks`
  const facts = [
    ['Database', database],
    ['Bucket', bucket],
    ['Collection', stringValue(payload.collection)],
    ['Files collection', filesCollection],
    ['Chunks collection', chunksCollection],
  ].filter(([, value]) => value)
  const buckets = arrayOfRecords(payload.buckets)
  const files = arrayOfRecords(payload.files)
  const chunks = arrayOfRecords(payload.chunks)
  const totalBytes = files.reduce((sum, file) => sum + numericValue(file.length ?? file.size), 0)
  const missingChunks = numericValue(payload.missingChunks ?? payload.missingChunkCount)
  const sampleFile = files[0]
  const sampleFilename = stringValue(sampleFile?.filename ?? sampleFile?.name ?? sampleFile?._id) || '*'
  const canPlan = Boolean(onPlanOperation && database)

  const planExport = () => {
    onPlanOperation?.({
      title: `Export GridFS ${bucket}`,
      operationId: 'mongodb.gridfs.export',
      objectName: filesCollection,
      parameters: {
        database,
        bucket,
        filename: sampleFilename,
        filesCollection,
        chunksCollection,
        format: 'binary',
      },
    })
  }

  const planUpload = () => {
    onPlanOperation?.({
      title: `Upload to GridFS ${bucket}`,
      operationId: 'mongodb.gridfs.upload',
      objectName: filesCollection,
      parameters: {
        database,
        bucket,
        filename: '<filename>',
        source: '<selected-file>',
        filesCollection,
        chunksCollection,
        metadata: {},
        validation: 'validate-before-write',
      },
    })
  }

  const planValidate = () => {
    onPlanOperation?.({
      title: `Validate GridFS ${bucket}`,
      operationId: 'mongodb.gridfs.validate',
      objectName: filesCollection,
      parameters: {
        database,
        bucket,
        filesCollection,
        chunksCollection,
      },
    })
  }

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectCollectionIcon} title={descriptor.title} unit="files and chunks" />
      <p className="object-view-note">{descriptor.purpose}</p>
      <div className="object-view-button-row object-view-button-row--compact" aria-label="GridFS actions">
        <button
          type="button"
          className="drawer-button"
          disabled={!canPlan}
          title="Review an export plan before writing files."
          onClick={planExport}
        >
          <DownloadIcon className="panel-inline-icon" />
          Export Files
        </button>
        <button
          type="button"
          className="drawer-button"
          disabled={!canPlan}
          title="Review upload validation before writing to GridFS."
          onClick={planUpload}
        >
          <PlusIcon className="panel-inline-icon" />
          Upload File
        </button>
        <button
          type="button"
          className="drawer-button"
          disabled={!canPlan}
          title="Check GridFS chunk consistency."
          onClick={planValidate}
        >
          <WarningIcon className="panel-inline-icon" />
          Validate Chunks
        </button>
      </div>
      <div className="object-view-card-grid">
        <div className="object-view-card">
          <span>Buckets</span>
          <strong>{buckets.length || (bucket ? 1 : 0)}</strong>
        </div>
        <div className="object-view-card">
          <span>Files</span>
          <strong>{files.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Chunks</span>
          <strong>{chunks.length}</strong>
        </div>
        <div className="object-view-card">
          <span>Stored bytes</span>
          <strong>{totalBytes ? formatBytes(totalBytes) : '0 B'}</strong>
        </div>
        <div className="object-view-card">
          <span>Missing chunks</span>
          <strong>{missingChunks}</strong>
        </div>
      </div>
      <KeyValueGrid
        rows={facts}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      {buckets.length || files.length || chunks.length ? (
        <>
          <ObjectViewTable
            columns={['Bucket', 'Files collection', 'Chunks collection']}
            rows={buckets.map((bucket) => [
              stringValue(bucket.bucket ?? bucket.name),
              stringValue(bucket.filesCollection ?? bucket.files),
              stringValue(bucket.chunksCollection ?? bucket.chunks),
            ])}
            emptyText="No GridFS buckets were returned."
          />
          <ObjectViewTable
            columns={['File', 'Length', 'Upload date', 'Metadata']}
            rows={files.map((file) => [
              stringValue(file.filename ?? file.name ?? file._id),
              formatBytes(numericValue(file.length ?? file.size)),
              stringValue(file.uploadDate ?? file.uploadedAt),
              compactJson(file.metadata ?? {}),
            ])}
            emptyText="No GridFS files were returned."
          />
          <ObjectViewTable
            columns={['File id', 'Chunk', 'Size']}
            rows={chunks.map((chunk) => [
              stringValue(chunk.files_id ?? chunk.fileId),
              stringValue(chunk.n ?? chunk.chunk),
              formatBytes(numericValue(chunk.size ?? chunk.length)),
            ])}
            emptyText="No GridFS chunks were returned."
          />
        </>
      ) : null}
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          Query GridFS Collection
        </button>
      ) : null}
    </div>
  )
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

function PurposeEmptyState({ descriptor }: { descriptor: MongoObjectViewDescriptor }) {
  return (
    <div className="object-view-empty-panel">
      <strong>{descriptor.emptyTitle}</strong>
      <span>{descriptor.emptyDescription}</span>
    </div>
  )
}

function ObjectViewFeedbackPanel({ feedback }: { feedback?: ObjectViewFeedback }) {
  const [showGeneratedRequest, setShowGeneratedRequest] = useState(false)
  const [showMetadata, setShowMetadata] = useState(false)

  if (!feedback) {
    return null
  }

  return (
    <div className="object-view-plan">
      <div className="object-view-section-heading">
        <WarningIcon className="panel-inline-icon" />
        <strong>{feedback.title}</strong>
        {feedback.executed !== undefined ? <span>{feedback.executed ? 'executed' : 'not executed'}</span> : null}
      </div>
      {feedback.messages.length ? (
        <ul className="object-view-message-list">
          {feedback.messages.map((message) => <li key={message}>{message}</li>)}
        </ul>
      ) : null}
      {feedback.warnings.length ? <WarningList warnings={feedback.warnings} /> : null}
      {feedback.plan ? (
        <>
          <KeyValueGrid
            rows={[
              ['Summary', feedback.plan.summary],
              ['Permissions', feedback.plan.requiredPermissions.join(', ')],
              ['Approval', feedback.plan.confirmationText ? 'Review required' : 'Not required'],
              ['Cost', feedback.plan.estimatedCost ?? 'Unknown'],
              ['Scan impact', feedback.plan.estimatedScanImpact ?? 'Unknown'],
            ]}
            emptyText="No operation plan details were returned."
          />
          <div className="object-view-disclosure">
            <button
              type="button"
              className="drawer-button"
              onClick={() => setShowGeneratedRequest((current) => !current)}
            >
              {showGeneratedRequest ? 'Hide details' : 'Details'}
            </button>
            {showGeneratedRequest ? (
              <pre className="object-view-code">{feedback.plan.generatedRequest}</pre>
            ) : null}
          </div>
        </>
      ) : null}
      {feedback.metadata ? (
        <div className="object-view-disclosure">
          <button
            type="button"
            className="drawer-button"
            onClick={() => setShowMetadata((current) => !current)}
          >
            {showMetadata ? 'Hide details' : 'Show details'}
          </button>
          {showMetadata ? (
            <pre className="object-view-code">{prettyJson(feedback.metadata)}</pre>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function KeyValueGrid({ rows, emptyText }: { rows: string[][]; emptyText: string }) {
  if (rows.length === 0) {
    return <p className="object-view-empty">{emptyText}</p>
  }

  return (
    <dl className="object-view-key-values">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function ObjectViewTable({
  columns,
  rows,
  emptyText,
}: {
  columns: string[]
  rows: string[][]
  emptyText: string
}) {
  if (rows.length === 0) {
    return <p className="object-view-empty">{emptyText}</p>
  }

  return (
    <div className="object-view-table-wrap">
      <table className="object-view-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${index}:${row.join('|')}`}>
              {columns.map((column, columnIndex) => (
                <td key={column}>{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null
  }

  return (
    <div className="object-view-warning-list">
      {warnings.map((warning) => (
        <div key={warning} className="object-view-warning">
          <WarningIcon className="panel-inline-icon" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  )
}

function queryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state?.queryTemplate) {
    return undefined
  }

  return {
    kind: state.kind,
    label: state.label,
    path: state.path,
    queryTemplate: state.queryTemplate,
    preferredBuilder: state.kind === 'pipeline' || state.kind === 'aggregations'
      ? 'mongo-aggregation'
      : 'mongo-find',
  }
}

function mongoScriptTemplates(value: unknown): MongoScriptTemplate[] {
  const scripts = Array.isArray(value) ? value : []
  return scripts
    .map((script, index) => mongoScriptTemplate(script, index))
    .filter((script): script is MongoScriptTemplate => Boolean(script))
}

function mongoScriptTemplate(value: unknown, index: number): MongoScriptTemplate | undefined {
  const record = asRecord(value)
  const script = typeof value === 'string'
    ? value
    : stringValue(record.script ?? record.text ?? record.content ?? record.queryTemplate)
  const trimmedScript = script.trim()
  if (!trimmedScript) {
    return undefined
  }

  const title = stringValue(record.name ?? record.title).trim()
    || mongoScriptTitle(trimmedScript, index)
  const summary = stringValue(record.description ?? record.summary).trim()
    || mongoScriptSummary(trimmedScript)
  const rawTags = Array.isArray(record.tags) ? record.tags : mongoScriptTags(trimmedScript)
  const tags = rawTags.map(String).map((tag) => tag.trim()).filter(Boolean)

  return {
    id: `${index}:${title}:${trimmedScript.slice(0, 80)}`,
    title,
    summary,
    script: trimmedScript,
    tags,
  }
}

function mongoScriptTitle(script: string, index: number) {
  const firstLine = script.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  if (!firstLine) {
    return `Template ${index + 1}`
  }

  if (/\.aggregate\s*\(/i.test(firstLine)) {
    return 'Aggregation Script'
  }

  if (/\.find\s*\(/i.test(firstLine)) {
    return 'Find Script'
  }

  if (/runCommand\s*\(/i.test(firstLine)) {
    return 'Command Script'
  }

  return firstLine.length > 48 ? `${firstLine.slice(0, 45)}...` : firstLine
}

function mongoScriptSummary(script: string) {
  if (/\.aggregate\s*\(/i.test(script)) {
    return 'Runs a read-only aggregation workflow from the MongoDB scripting view.'
  }

  if (/\.find\s*\(/i.test(script)) {
    return 'Reads documents with a mongosh-style find template.'
  }

  if (/runCommand\s*\(/i.test(script)) {
    return 'Runs a read-oriented database command through the scripting view.'
  }

  return 'Reusable MongoDB script template for this object.'
}

function mongoScriptTags(script: string) {
  const tags: string[] = []
  if (/\.aggregate\s*\(/i.test(script)) {
    tags.push('aggregation')
  }
  if (/\.find\s*\(/i.test(script)) {
    tags.push('find')
  }
  if (/runCommand\s*\(/i.test(script)) {
    tags.push('command')
  }
  return tags.length ? tags : ['script']
}

function objectViewWarnings(tab: QueryTabState, payload: JsonRecord) {
  return [
    ...(tab.objectViewState?.warnings ?? []),
    ...(tab.error?.message ? [tab.error.message] : []),
    ...(typeof payload.warning === 'string' ? [payload.warning] : []),
  ].filter(Boolean)
}

function mongoObjectViewPayloadWithScope(
  payload: JsonRecord,
  state: QueryTabState['objectViewState'],
) {
  const scope = mongoScopeFromObjectViewState(state)
  if (!scope.database && !scope.collection) {
    return payload
  }

  return {
    ...payload,
    ...(scope.database && !payload.database ? { database: scope.database } : {}),
    ...(scope.collection && !payload.collection ? { collection: scope.collection } : {}),
  }
}

function mongoScopeFromObjectViewState(state: QueryTabState['objectViewState']) {
  const nodeId = state?.nodeId ?? ''
  const knownPrefixes = [
    'insert-document:',
    'create-index:',
    'collection:',
    'documents:',
    'indexes:',
    'schema-preview:',
    'validation-rules:',
    'collection-statistics:',
    'collection-permissions:',
    'collection-scripts:',
    'aggregations:',
  ]
  const matchedPrefix = knownPrefixes.find((prefix) => nodeId.startsWith(prefix))
  if (matchedPrefix) {
    const rest = nodeId.slice(matchedPrefix.length)
    const [database = '', ...collectionParts] = rest.split(':')
    const collection = collectionParts.join(':')
    return {
      database: database || mongoDatabaseFromPath(state?.path),
      collection: collection || mongoCollectionFromPath(state?.path),
    }
  }

  return {
    database: mongoDatabaseFromPath(state?.path),
    collection: mongoCollectionFromPath(state?.path),
  }
}

function mongoDatabaseFromPath(path: string[] | undefined) {
  if (!path?.length) {
    return ''
  }

  const collectionsIndex = path.indexOf('Collections')
  if (collectionsIndex > 0) {
    return path[collectionsIndex - 1] ?? ''
  }

  const viewsIndex = path.indexOf('Views')
  if (viewsIndex > 0) {
    return path[viewsIndex - 1] ?? ''
  }

  return path[0] ?? ''
}

function mongoCollectionFromPath(path: string[] | undefined) {
  if (!path?.length) {
    return ''
  }

  const collectionsIndex = path.indexOf('Collections')
  if (collectionsIndex >= 0) {
    return path[collectionsIndex + 1] ?? path.at(-1) ?? ''
  }

  return path.length > 1 ? path.at(-1) ?? '' : ''
}

function mongoObjectViewSummary(
  summary: string | undefined,
  descriptor: MongoObjectViewDescriptor,
) {
  if (!summary) {
    return ''
  }

  if (/inspection metadata is not available/i.test(summary)) {
    return `${descriptor.emptyTitle}. ${descriptor.emptyDescription}`
  }

  return summary
}

function isVariableToken(value: string) {
  return /^\{\{[A-Z][A-Z0-9_]*\}\}$/.test(value)
}

function isCompactMongoObjectView(kind: string) {
  return kind === 'indexes' || kind === 'create-index' || kind === 'users' || kind === 'roles'
}

function extractIndexes(payload: JsonRecord) {
  const indexes = payload.indexes
  const result = asRecord(payload.result)
  const directIndexes = Array.isArray(indexes) ? indexes : undefined
  const commandIndexes = asRecord(indexes)?.cursor
    ? asRecord(asRecord(indexes)?.cursor)?.firstBatch
    : result?.cursor
      ? asRecord(result.cursor)?.firstBatch
      : undefined
  const rows = directIndexes ?? (Array.isArray(commandIndexes) ? commandIndexes : [])
  return rows.map(asRecord).filter(Boolean) as JsonRecord[]
}

function normalizeIndexList(value: unknown) {
  if (!Array.isArray(value)) {
    return extractIndexes({ indexes: value })
  }

  return value.map((item) => {
    if (typeof item === 'string') {
      return { name: item }
    }

    return asRecord(item)
  }).filter((item) => Object.keys(item).length > 0)
}

function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
}

function rowsForSecurityReferences(records: JsonRecord[], isRoleView: boolean) {
  return records.reduce((count, record) => {
    const roleRows = isRoleView
      ? arrayOfRecords(record.roles ?? record.inheritedRoles)
      : arrayOfRecords(record.roles)
    return count + roleRows.length
  }, 0)
}

function mongoPipelineStageRows(pipeline: unknown[]) {
  return pipeline.map((stage) => {
    const stageRecord = asRecord(stage)
    const [operator = 'stage', value = stage] = Object.entries(stageRecord)[0] ?? []
    return {
      operator,
      value,
      summary: mongoPipelineStageSummary(operator),
      details: mongoPipelineStageDetails(value),
    }
  })
}

function mongoPipelineStageSummary(operator: string) {
  switch (operator) {
    case '$match':
      return 'Filters documents before later stages run.'
    case '$project':
      return 'Shapes the fields returned by the view.'
    case '$sort':
      return 'Orders documents before they are returned.'
    case '$group':
      return 'Groups documents and computes aggregate values.'
    case '$lookup':
      return 'Joins related documents from another collection.'
    case '$unwind':
      return 'Expands array values into individual pipeline rows.'
    case '$limit':
      return 'Caps how many documents continue through the pipeline.'
    case '$skip':
      return 'Skips documents before later stages run.'
    case '$addFields':
    case '$set':
      return 'Adds or replaces computed fields.'
    default:
      return 'Runs a MongoDB aggregation stage.'
  }
}

function mongoPipelineStageDetails(value: unknown) {
  if (Array.isArray(value)) {
    return [`${value.length} item(s)`]
  }

  const record = asRecord(value)
  const keys = Object.keys(record)
  if (keys.length > 0) {
    return [
      `${keys.length} setting(s)`,
      ...keys.slice(0, 3),
    ]
  }

  const scalar = stringValue(value)
  return scalar ? [scalar] : []
}

function maxFieldPresence(fields: JsonRecord[]) {
  return fields.reduce((max, field) => Math.max(max, fieldPresenceCount(field)), 0)
}

function fieldPresenceCount(field: JsonRecord) {
  return numericValue(field.presenceCount ?? field.count)
}

function fieldTypeNames(field: JsonRecord) {
  const distribution = asRecord(field.typeDistribution)
  const distributionTypes = Object.keys(distribution)
  if (distributionTypes.length > 0) {
    return distributionTypes
  }

  const types = field.types
  if (Array.isArray(types)) {
    return types.map(String).filter(Boolean)
  }

  const single = stringValue(field.type)
  return single ? [single] : []
}

function fieldTypesText(field: JsonRecord) {
  const distribution = asRecord(field.typeDistribution)
  const entries = Object.entries(distribution)
  if (entries.length > 0) {
    return entries.map(([type, count]) => `${type} (${stringValue(count)})`).join(', ')
  }

  return fieldTypeNames(field).join(', ')
}

function fieldPresenceText(field: JsonRecord, sampleSize: number) {
  const count = fieldPresenceCount(field)
  if (!count) {
    return ''
  }

  if (!sampleSize) {
    return String(count)
  }

  const percent = Math.round((count / sampleSize) * 100)
  return `${count}/${sampleSize} (${percent}%)`
}

function fieldWarningsText(field: JsonRecord, sampleSize: number) {
  const warnings = Array.isArray(field.warnings)
    ? field.warnings.map(String).filter(Boolean)
    : []
  if (fieldTypeNames(field).length > 1) {
    warnings.push('Mixed BSON types')
  }
  if (sampleSize > 0 && fieldPresenceCount(field) > 0 && fieldPresenceCount(field) < sampleSize) {
    warnings.push('Missing from some documents')
  }

  return [...new Set(warnings)].join(', ')
}

function generateValidatorFromFields(fields: JsonRecord[], sampleSize: number): JsonRecord {
  const schema: JsonRecord = {
    bsonType: 'object',
    properties: {},
  }
  const required = new Set<string>()
  const properties = schema.properties as JsonRecord

  for (const field of fields) {
    const path = stringValue(field.path)
    if (!path || path === '_id') {
      continue
    }

    addSchemaProperty(properties, path.split('.'), fieldTypeNames(field))
    if (!path.includes('.') && sampleSize > 0 && fieldPresenceCount(field) >= sampleSize) {
      required.add(path)
    }
  }

  if (required.size > 0) {
    schema.required = [...required]
  }

  return { $jsonSchema: schema }
}

function addSchemaProperty(target: JsonRecord, segments: string[], types: string[]) {
  const [segment, ...rest] = segments
  if (!segment) {
    return
  }

  if (rest.length === 0) {
    target[segment] = { bsonType: types.length > 1 ? types : types[0] ?? 'object' }
    return
  }

  const existing = asRecord(target[segment])
  const childProperties = asRecord(existing.properties)
  target[segment] = {
    ...existing,
    bsonType: 'object',
    properties: childProperties,
  }
  addSchemaProperty(childProperties, rest, types)
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

function mongoValidationViewKey(payload: JsonRecord) {
  const validator = payload.validator ?? asRecord(payload.options).validator ?? {}
  return [
    stringValue(payload.database),
    stringValue(payload.collection),
    compactJson(validator),
  ].join(':')
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

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function withoutKeys(record: JsonRecord, keys: string[]) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)))
}

function metadataSummary(record: JsonRecord, omittedKeys: string[]) {
  const entries = Object.entries(withoutKeys(record, omittedKeys))
    .filter(([, value]) => value !== undefined && value !== null && value !== '')

  if (entries.length === 0) {
    return 'Default options'
  }

  return entries
    .slice(0, 4)
    .map(([key, value]) => `${humanizeMetric(key)}: ${shortValueSummary(value)}`)
    .join(', ')
}

function pipelineSummary(value: unknown) {
  const pipeline = Array.isArray(value) ? value : []
  const firstStage = mongoPipelineStageRows(pipeline)[0]
  return firstStage ? `${firstStage.operator} - ${firstStage.summary}` : 'No pipeline stages'
}

function documentFieldSummary(document: JsonRecord) {
  const fields = Object.keys(document).filter((field) => field !== '_id')
  if (fields.length === 0) {
    return 'Only _id'
  }

  const visible = fields.slice(0, 5)
  const remaining = fields.length - visible.length
  return remaining > 0
    ? `${visible.join(', ')} +${remaining} more`
    : visible.join(', ')
}

function indexKeyPatternText(value: unknown) {
  const key = asRecord(value)
  const entries = Object.entries(key)
  if (entries.length === 0) {
    return stringValue(value) || 'No key pattern'
  }

  return entries
    .map(([field, direction]) => `${field} ${indexDirectionText(direction)}`)
    .join(', ')
}

function indexDirectionText(value: unknown) {
  if (value === 1 || value === '1') {
    return 'ascending'
  }

  if (value === -1 || value === '-1') {
    return 'descending'
  }

  return stringValue(value)
}

function indexOptionsSummary(index: JsonRecord, omittedKeys: string[]) {
  const entries = Object.entries(withoutKeys(index, omittedKeys))
    .filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== false)

  if (entries.length === 0) {
    return 'Default options'
  }

  return entries
    .slice(0, 5)
    .map(([key, value]) => indexOptionText(key, value))
    .join(', ')
}

function indexOptionText(key: string, value: unknown) {
  if (typeof value === 'boolean') {
    return value ? humanizeMetric(key) : ''
  }

  if (key === 'partialFilterExpression') {
    return `Partial filter: ${Object.keys(asRecord(value)).join(', ') || 'configured'}`
  }

  if (key === 'collation') {
    const collation = asRecord(value)
    return `Collation: ${stringValue(collation.locale) || 'configured'}`
  }

  if (key === 'weights') {
    return `Weights: ${Object.keys(asRecord(value)).join(', ')}`
  }

  return `${humanizeMetric(key)}: ${shortValueSummary(value)}`
}

function securityReferencesText(value: unknown) {
  const references = Array.isArray(value) ? value : []
  if (references.length === 0) {
    return 'None'
  }

  return references.map((reference) => {
    if (typeof reference === 'string') {
      return reference
    }

    const record = asRecord(reference)
    const role = stringValue(record.role ?? record.name)
    const database = stringValue(record.db ?? record.database)
    return database ? `${role} on ${database}` : role
  }).filter(Boolean).join(', ')
}

function privilegesText(value: unknown) {
  const privileges = arrayOfRecords(value)
  if (privileges.length === 0) {
    return 'None'
  }

  return privileges.map((privilege) => {
    const actions = Array.isArray(privilege.actions)
      ? privilege.actions.map(String).join(', ')
      : stringValue(privilege.action ?? privilege.privilege)
    const resource = asRecord(privilege.resource)
    const database = stringValue(resource.db ?? resource.database)
    const collection = stringValue(resource.collection)
    const scope = [database, collection].filter(Boolean).join('.') || 'cluster'
    return actions ? `${actions} on ${scope}` : scope
  }).join(', ')
}

function userDetailsText(user: JsonRecord) {
  const mechanisms = Array.isArray(user.mechanisms)
    ? user.mechanisms.map(String).filter(Boolean)
    : []
  const privileges = privilegesText(user.privileges)

  if (mechanisms.length > 0 && privileges !== 'None') {
    return `${mechanisms.join(', ')}; ${privileges}`
  }

  if (mechanisms.length > 0) {
    return mechanisms.join(', ')
  }

  return privileges
}

function shortValueSummary(value: unknown) {
  if (Array.isArray(value)) {
    return `${value.length} item(s)`
  }

  if (typeof value === 'boolean') {
    return booleanText(value)
  }

  if (typeof value === 'number') {
    return value.toLocaleString()
  }

  if (typeof value === 'string') {
    return value
  }

  const record = asRecord(value)
  const keys = Object.keys(record)
  if (keys.length === 0) {
    return 'object'
  }

  return keys.slice(0, 3).join(', ')
}

function numericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const record = asRecord(value)
  const extendedNumber = record.$numberLong ?? record.$numberInt ?? record.$numberDouble
  return typeof extendedNumber === 'string' ? numericValue(extendedNumber) : 0
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }

  return `${current >= 10 || unitIndex === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[unitIndex]}`
}

function stringValue(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  return compactJson(value)
}

function booleanText(value: unknown) {
  return value === undefined ? '' : value ? 'Yes' : 'No'
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function compactJson(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function humanizeMetric(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_.$-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
