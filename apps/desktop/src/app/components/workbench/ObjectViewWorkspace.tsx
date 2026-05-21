import { useCallback, useMemo, useState } from 'react'
import type { ComponentType, ReactNode } from 'react'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  EnvironmentProfile,
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
  ObjectIndexIcon,
  ObjectRoleIcon,
  ObjectSearchIcon,
  ObjectSecurityIcon,
  PlayIcon,
  RefreshIcon,
  WarningIcon,
} from './icons'
import {
  getMongoObjectViewDescriptor,
  mongoScopedQueryMenuLabel,
  type MongoObjectViewDescriptor,
} from './MongoObjectViewDescriptors'
import { OracleObjectViewWorkspace } from './OracleObjectViewWorkspace'
import { RelationalObjectViewWorkspace } from './RelationalObjectViewWorkspace'
import { executeDataEditWithConfirmation } from './results/data-edit-confirmation'
import { RedisObjectViewWorkspace } from './RedisObjectViewWorkspace'
import { ExplorerNodeIcon } from './SideBar.node-icons'

interface ObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
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

export function ObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
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
        onPlanOperation={onPlanOperation}
        onExecuteDataEdit={onExecuteDataEdit}
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
    connection.engine === 'sqlserver'
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
  onPlanOperation,
  onExecuteDataEdit,
}: ObjectViewWorkspaceProps) {
  const state = tab.objectViewState
  const payload = asRecord(state?.payload)
  const [refreshing, setRefreshing] = useState(false)
  const [feedback, setFeedback] = useState<ObjectViewFeedback | undefined>()
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
      messages: response?.plan ? ['Operation preview generated.'] : [],
      warnings: response?.plan?.warnings ?? ['Operation planning did not return a plan.'],
    })
  }, [connection.id, environment.id, onPlanOperation, setFeedback])
  const uploadMongoDocument = useCallback(async (document: JsonRecord) => {
    if (!onExecuteDataEdit) {
      setFeedback({
        title: 'Upload Document',
        messages: [],
        warnings: ['Document upload is not available in this workspace.'],
      })
      return
    }

    const collection = stringValue(payload.collection)
    if (!collection) {
      setFeedback({
        title: 'Upload Document',
        messages: [],
        warnings: ['A target collection is required before a document can be uploaded.'],
      })
      return
    }

    const request: DataEditExecutionRequest = {
      connectionId: connection.id,
      environmentId: environment.id,
      editKind: 'insert-document',
      target: {
        objectKind: 'document',
        path: [stringValue(payload.database), collection].filter(Boolean),
        collection,
      },
      changes: [{
        value: document,
        valueType: 'json',
      }],
    }
    const response = await executeDataEditWithConfirmation(onExecuteDataEdit, request, {
      actionLabel: `Upload a document into ${collection}.`,
      confirmationTitle: 'Upload this MongoDB document?',
    })

    setFeedback({
      title: 'Upload Document',
      plan: response?.plan,
      executed: response?.executed,
      messages: response?.messages ?? [],
      warnings: response?.warnings ?? ['Document upload did not return a response.'],
      metadata: response?.metadata,
    })
  }, [connection.id, environment.id, onExecuteDataEdit, payload.collection, payload.database, setFeedback])

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

      <div className="object-view-purpose">
        <strong>{state?.label && state.label !== descriptor.title ? state.label : descriptor.menuLabel}</strong>
        <span>{descriptor.purpose}</span>
      </div>
      {summary ? <p className="object-view-summary">{summary}</p> : null}
      <WarningList warnings={warnings} />

      <div className="object-view-body">
        {renderMongoObjectView(kind, descriptor, payload, onOpenQuery, queryTarget, {
          feedback,
          onPlanOperation: planMongoOperation,
          onUploadDocument: uploadMongoDocument,
        })}
        <ObjectViewFeedbackPanel feedback={feedback} />
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
    onPlanOperation(request: {
      objectName?: string
      operationId: string
      parameters?: Record<string, unknown>
      title: string
    }): void
    onUploadDocument(document: JsonRecord): Promise<void>
  },
) {
  if (kind === 'database' || kind === 'collection' || kind === 'view') {
    return (
      <MongoOverviewView
        kind={kind}
        descriptor={descriptor}
        payload={payload}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
        onUploadDocument={kind === 'collection' ? actions?.onUploadDocument : undefined}
      />
    )
  }

  if (kind === 'schema-preview') {
    return <MongoSchemaView descriptor={descriptor} payload={payload} />
  }

  if (kind === 'indexes' || kind === 'search-indexes' || kind === 'vector-indexes') {
    return <MongoIndexesView descriptor={descriptor} payload={payload} onPlanOperation={actions?.onPlanOperation} />
  }

  if (kind === 'validation-rules') {
    return <MongoValidationView descriptor={descriptor} payload={payload} onPlanOperation={actions?.onPlanOperation} />
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
    return <MongoGridFsView descriptor={descriptor} payload={payload} queryTarget={queryTarget} onOpenQuery={onOpenQuery} />
  }

  return <MongoOverviewView kind={kind} descriptor={descriptor} payload={payload} queryTarget={queryTarget} onOpenQuery={onOpenQuery} />
}

function MongoOverviewView({
  kind,
  descriptor,
  payload,
  queryTarget,
  onOpenQuery,
  onUploadDocument,
}: {
  kind: string
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
  onUploadDocument?(document: JsonRecord): Promise<void>
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
      <KeyValueGrid rows={facts} emptyText="No object metadata has been loaded yet." />
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel ?? mongoScopedQueryMenuLabel(kind)}
        </button>
      ) : null}
      {onUploadDocument ? (
        <MongoDocumentUploadPanel payload={payload} onUploadDocument={onUploadDocument} />
      ) : null}
    </div>
  )
}

function MongoSchemaView({
  descriptor,
  payload,
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
}) {
  const fields = arrayOfRecords(payload.fields)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectDocumentIcon} title={descriptor.title} unit={`${fields.length} field(s)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      <ObjectViewTable
        columns={['Field path', 'BSON type', 'Presence', 'Examples']}
        rows={fields.map((field) => [
          stringValue(field.path),
          stringValue(field.type),
          field.count === undefined ? '' : String(field.count),
          compactJson(field.examples ?? field.example ?? ''),
        ])}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
    </div>
  )
}

function MongoIndexesView({
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
  const indexes = extractIndexes(payload)
  const database = stringValue(payload.database)
  const collection = stringValue(payload.collection)
  const [indexName, setIndexName] = useState('field_1')
  const [keyPattern, setKeyPattern] = useState('{\n  "field": 1\n}')
  const [options, setOptions] = useState('{\n  "name": "field_1"\n}')
  const [validationError, setValidationError] = useState('')
  const previewCreate = useCallback(() => {
    const key = parseJsonObject(keyPattern)
    const parsedOptions = parseJsonObject(options)
    if (!key.ok) {
      setValidationError(`Key pattern: ${key.error}`)
      return
    }
    if (!parsedOptions.ok) {
      setValidationError(`Options: ${parsedOptions.error}`)
      return
    }
    const name = indexName.trim() || stringValue(parsedOptions.value.name) || 'field_1'
    setValidationError('')
    onPlanOperation?.({
      title: `Create index ${name}`,
      operationId: 'mongodb.index.create',
      objectName: collection,
      parameters: {
        database,
        collection,
        indexName: name,
        key: key.value,
        options: { ...parsedOptions.value, name },
      },
    })
  }, [collection, database, indexName, keyPattern, onPlanOperation, options])
  const previewDrop = useCallback((name: string) => {
    onPlanOperation?.({
      title: `Drop index ${name}`,
      operationId: 'mongodb.index.drop',
      objectName: collection,
      parameters: {
        database,
        collection,
        indexName: name,
      },
    })
  }, [collection, database, onPlanOperation])

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectIndexIcon} title={descriptor.title} unit={`${indexes.length} index(es)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      {indexes.length === 0 ? (
        <PurposeEmptyState descriptor={descriptor} />
      ) : (
        <div className="object-view-table-wrap">
          <table className="object-view-table">
            <thead>
              <tr>
                {['Name', 'Key pattern', 'Unique', 'Sparse', 'TTL', 'Options', 'Actions'].map((column) => (
                  <th key={column}>{column}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {indexes.map((index) => {
                const name = stringValue(index.name)
                return (
                  <tr key={name || compactJson(index.key)}>
                    <td>{name}</td>
                    <td>{compactJson(index.key)}</td>
                    <td>{booleanText(index.unique)}</td>
                    <td>{booleanText(index.sparse)}</td>
                    <td>{stringValue(index.expireAfterSeconds)}</td>
                    <td>{compactJson(withoutKeys(index, ['name', 'key', 'unique', 'sparse', 'expireAfterSeconds']))}</td>
                    <td>
                      <button
                        type="button"
                        className="drawer-button drawer-button--danger"
                        disabled={!onPlanOperation || !name || name === '_id_'}
                        title={name === '_id_' ? 'MongoDB primary _id index cannot be dropped.' : 'Preview the guarded drop-index operation.'}
                        onClick={() => previewDrop(name)}
                      >
                        Preview Drop
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <MongoIndexCreatePanel
        disabled={!collection || !onPlanOperation}
        indexName={indexName}
        keyPattern={keyPattern}
        options={options}
        validationError={validationError}
        onIndexNameChange={setIndexName}
        onKeyPatternChange={setKeyPattern}
        onOptionsChange={setOptions}
        onPreviewCreate={previewCreate}
      />
      <p className="object-view-note">
        Create, drop, hide, and unhide index actions are preview-only and run through environment guardrails.
      </p>
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
  const [validatorJson, setValidatorJson] = useState(() => prettyJson(validator ?? {}))
  const [validationError, setValidationError] = useState('')
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

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectSecurityIcon} title={descriptor.title} unit={validator ? 'configured' : 'none'} />
      <p className="object-view-note">{descriptor.purpose}</p>
      {validator ? (
        <pre className="object-view-code">{prettyJson(validator)}</pre>
      ) : (
        <PurposeEmptyState descriptor={descriptor} />
      )}
      <p className="object-view-note">
        Validator changes are generated as guarded operation previews.
      </p>
      <div className="object-view-management">
        <strong>Update Validator Preview</strong>
        <label className="object-view-field">
          <span>Validator JSON</span>
          <textarea
            className="object-view-textarea"
            value={validatorJson}
            onChange={(event) => setValidatorJson(event.target.value)}
            spellCheck={false}
          />
        </label>
        {validationError ? <p className="object-view-status is-error">{validationError}</p> : null}
        <div className="object-view-button-row">
          <button
            type="button"
            className="drawer-button"
            disabled={!onPlanOperation || !collection}
            onClick={previewUpdate}
          >
            Preview Update Validator
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
  const isRoleView = kind === 'roles' || roles.length > 0
  const [principalName, setPrincipalName] = useState('')
  const [rolesJson, setRolesJson] = useState(`[\n  { "role": "readWrite", "db": "${database || 'admin'}" }\n]`)
  const [privilegesJson, setPrivilegesJson] = useState('[]')
  const [validationError, setValidationError] = useState('')
  const rows = kind === 'roles' || roles.length > 0
    ? roles.map((role) => [
        stringValue(role.role ?? role.name),
        compactJson(role.roles ?? role.inheritedRoles ?? []),
        compactJson(role.privileges ?? []),
      ])
    : users.map((user) => [
        stringValue(user.user ?? user.name),
        compactJson(user.roles ?? []),
        compactJson(user.mechanisms ?? user.privileges ?? []),
      ])
  const previewCreate = useCallback(() => {
    const name = principalName.trim()
    if (!name) {
      setValidationError(isRoleView ? 'Role name is required.' : 'Username is required.')
      return
    }
    const parsedRoles = parseJsonArray(rolesJson)
    if (!parsedRoles.ok) {
      setValidationError(`Roles: ${parsedRoles.error}`)
      return
    }
    const parsedPrivileges = isRoleView ? parseJsonArray(privilegesJson) : { ok: true as const, value: [] }
    if (!parsedPrivileges.ok) {
      setValidationError(`Privileges: ${parsedPrivileges.error}`)
      return
    }
    setValidationError('')
    onPlanOperation?.({
      title: `${isRoleView ? 'Create role' : 'Create user'} ${name}`,
      operationId: isRoleView ? 'mongodb.role.create' : 'mongodb.user.create',
      objectName: name,
      parameters: {
        database,
        name,
        roles: parsedRoles.value,
        privileges: parsedPrivileges.value,
      },
    })
  }, [database, isRoleView, onPlanOperation, principalName, privilegesJson, rolesJson])
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
      <p className="object-view-note">{descriptor.purpose}</p>
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
                        className="drawer-button drawer-button--danger"
                        disabled={!onPlanOperation || !name}
                        onClick={() => previewDrop(name)}
                      >
                        {isRoleView ? 'Preview Drop Role' : 'Preview Drop User'}
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
        <strong>{isRoleView ? 'Create Role Preview' : 'Create User Preview'}</strong>
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
            <span>Roles JSON</span>
            <textarea
              className="object-view-textarea"
              value={rolesJson}
              onChange={(event) => setRolesJson(event.target.value)}
              spellCheck={false}
            />
          </label>
          {isRoleView ? (
            <label className="object-view-field">
              <span>Privileges JSON</span>
              <textarea
                className="object-view-textarea"
                value={privilegesJson}
                onChange={(event) => setPrivilegesJson(event.target.value)}
                spellCheck={false}
              />
            </label>
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
            {isRoleView ? 'Preview Create Role' : 'Preview Create User'}
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
  const scripts = (Array.isArray(payload.scripts) ? payload.scripts : [])
    .map((script) => String(script))

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
      {scripts.length ? scripts.map((script) => (
        <pre key={script} className="object-view-code">{script}</pre>
      )) : (
        <PurposeEmptyState descriptor={descriptor} />
      )}
    </div>
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
  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectSearchIcon} title={descriptor.title} unit={`${pipeline.length} stage(s)`} />
      <p className="object-view-note">{descriptor.purpose}</p>
      {pipeline.length ? (
        <pre className="object-view-code">{prettyJson(pipeline)}</pre>
      ) : (
        <PurposeEmptyState descriptor={descriptor} />
      )}
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          {descriptor.primaryQueryLabel ?? 'Open Sample Results'}
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
}: {
  descriptor: MongoObjectViewDescriptor
  payload: JsonRecord
  queryTarget?: ScopedQueryTarget
  onOpenQuery(target: ScopedQueryTarget): void
}) {
  const facts = [
    ['Database', stringValue(payload.database)],
    ['Bucket', stringValue(payload.bucket)],
    ['Collection', stringValue(payload.collection)],
    ['Files collection', stringValue(payload.filesCollection)],
    ['Chunks collection', stringValue(payload.chunksCollection)],
  ].filter(([, value]) => value)

  return (
    <div className="object-view-section">
      <SectionHeading Icon={ObjectCollectionIcon} title={descriptor.title} unit="files and chunks" />
      <p className="object-view-note">{descriptor.purpose}</p>
      <KeyValueGrid
        rows={facts}
        emptyText={`${descriptor.emptyTitle}. ${descriptor.emptyDescription}`}
      />
      {queryTarget ? (
        <button type="button" className="drawer-button" onClick={() => onOpenQuery(queryTarget)}>
          <PlayIcon className="panel-inline-icon" />
          Query GridFS Collection
        </button>
      ) : null}
    </div>
  )
}

function MongoDocumentUploadPanel({
  payload,
  onUploadDocument,
}: {
  payload: JsonRecord
  onUploadDocument(document: JsonRecord): Promise<void>
}) {
  const collection = stringValue(payload.collection)
  const requiredFields = requiredFieldsForValidator(payload)
  const [documentText, setDocumentText] = useState('{\n  "sku": "new-product",\n  "name": "New Product"\n}')
  const [status, setStatus] = useState('')
  const validation = useMemo(
    () => validateDocumentUpload(documentText, requiredFields),
    [documentText, requiredFields],
  )
  const upload = useCallback(async () => {
    if (!validation.ok) {
      setStatus(validation.error)
      return
    }

    setStatus('')
    await onUploadDocument(validation.value)
  }, [onUploadDocument, validation])

  return (
    <div className="object-view-management">
      <strong>Upload Document</strong>
      <p className="object-view-note">
        Paste one JSON document. Validation checks the shape before DataPad++ sends it through guarded MongoDB insert handling.
      </p>
      {requiredFields.length ? (
        <p className="object-view-note">Required fields from validator: {requiredFields.join(', ')}</p>
      ) : null}
      <label className="object-view-field">
        <span>Document JSON</span>
        <textarea
          className="object-view-textarea object-view-textarea--tall"
          value={documentText}
          onChange={(event) => setDocumentText(event.target.value)}
          spellCheck={false}
        />
      </label>
      {!validation.ok ? <p className="object-view-status is-error">{validation.error}</p> : null}
      {status && (validation.ok || status !== validation.error) ? (
        <p className={`object-view-status ${validation.ok ? 'is-success' : 'is-error'}`}>{status}</p>
      ) : null}
      <div className="object-view-button-row">
        <button
          type="button"
          className="drawer-button"
          onClick={() => setStatus(validation.ok ? `Document is valid for ${collection}.` : validation.error)}
        >
          Validate
        </button>
        <button
          type="button"
          className="drawer-button drawer-button--primary"
          disabled={!collection || !validation.ok}
          onClick={() => void upload()}
        >
          Upload Document
        </button>
      </div>
    </div>
  )
}

function MongoIndexCreatePanel({
  disabled,
  indexName,
  keyPattern,
  options,
  validationError,
  onIndexNameChange,
  onKeyPatternChange,
  onOptionsChange,
  onPreviewCreate,
}: {
  disabled: boolean
  indexName: string
  keyPattern: string
  options: string
  validationError: string
  onIndexNameChange(value: string): void
  onKeyPatternChange(value: string): void
  onOptionsChange(value: string): void
  onPreviewCreate(): void
}) {
  return (
    <div className="object-view-management">
      <strong>Create Index Preview</strong>
      <div className="object-view-form-grid">
        <label className="object-view-field">
          <span>Name</span>
          <input
            value={indexName}
            onChange={(event) => onIndexNameChange(event.target.value)}
            placeholder="field_1"
          />
        </label>
        <label className="object-view-field">
          <span>Key pattern JSON</span>
          <textarea
            className="object-view-textarea"
            value={keyPattern}
            onChange={(event) => onKeyPatternChange(event.target.value)}
            spellCheck={false}
          />
        </label>
        <label className="object-view-field">
          <span>Options JSON</span>
          <textarea
            className="object-view-textarea"
            value={options}
            onChange={(event) => onOptionsChange(event.target.value)}
            spellCheck={false}
          />
        </label>
      </div>
      {validationError ? <p className="object-view-status is-error">{validationError}</p> : null}
      <div className="object-view-button-row">
        <button
          type="button"
          className="drawer-button"
          disabled={disabled}
          onClick={onPreviewCreate}
        >
          Preview Create Index
        </button>
      </div>
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
              ['Confirmation', feedback.plan.confirmationText ?? 'Not required'],
              ['Cost', feedback.plan.estimatedCost ?? 'Unknown'],
              ['Scan impact', feedback.plan.estimatedScanImpact ?? 'Unknown'],
            ]}
            emptyText="No operation plan details were returned."
          />
          <pre className="object-view-code">{feedback.plan.generatedRequest}</pre>
        </>
      ) : null}
      {feedback.metadata ? (
        <pre className="object-view-code">{prettyJson(feedback.metadata)}</pre>
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

function objectViewWarnings(tab: QueryTabState, payload: JsonRecord) {
  return [
    ...(tab.objectViewState?.warnings ?? []),
    ...(tab.error?.message ? [tab.error.message] : []),
    ...(typeof payload.warning === 'string' ? [payload.warning] : []),
  ].filter(Boolean)
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

function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
}

function parseJsonObject(value: string): { ok: true; value: JsonRecord } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Expected a JSON object.' }
    }
    return { ok: true, value: parsed as JsonRecord }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON.' }
  }
}

function parseJsonArray(value: string): { ok: true; value: unknown[] } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return { ok: false, error: 'Expected a JSON array.' }
    }
    return { ok: true, value: parsed }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Invalid JSON.' }
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

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function withoutKeys(record: JsonRecord, keys: string[]) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)))
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
