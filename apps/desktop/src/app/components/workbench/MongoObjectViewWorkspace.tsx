import { useCallback, useMemo, useState } from 'react'
import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  EnvironmentProfile,
  ExplorerNode,
  OperationPlanRequest,
  OperationPlanResponse,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { ObjectDocumentIcon, PlayIcon, PlusIcon } from './icons'
import {
  getMongoObjectViewDescriptor,
  mongoScopedQueryMenuLabel,
  type MongoObjectViewDescriptor,
} from './MongoObjectViewDescriptors'
import { MongoCreateIndexView } from './MongoCreateIndexView'
import { MongoDocumentInsertPanel } from './MongoDocumentInsertPanel'
import { MongoGridFsView } from './MongoGridFsView'
import { MongoIndexesView } from './MongoIndexViews'
import {
  asRecord,
  mongoObjectViewPayloadWithScope,
  objectViewWarnings,
  queryTargetFromObjectView,
  stringValue,
  type JsonRecord,
} from './MongoObjectViewWorkspace.helpers'
import { MongoOverviewView } from './MongoOverviewView'
import { MongoPipelineView } from './MongoPipelineView'
import { MongoSchemaView } from './MongoSchemaView'
import { requiredFieldsForValidator } from './MongoSchemaView.helpers'
import { MongoScriptsView } from './MongoScriptsView'
import { MongoSecurityView } from './MongoSecurityView'
import { MongoStatisticsView } from './MongoStatisticsView'
import { MongoValidationView } from './MongoValidationView'
import { mongoValidationViewKey } from './MongoValidationView.helpers'
import { ObjectViewFeedbackPanel, type ObjectViewFeedback } from './ObjectViewFeedbackPanel'
import { ObjectViewHeader } from './ObjectViewHeader'
import { SectionHeading, WarningList } from './ObjectViewPrimitives'
import { executeDataEditWithConfirmation } from './results/data-edit-confirmation'
import { useDataEditConfirmation } from './results/use-data-edit-confirmation'

type MongoOperationPlanner = (request: {
  objectName?: string
  operationId: string
  parameters?: Record<string, unknown>
  title: string
}) => void

interface MongoObjectViewWorkspaceProps {
  connection: ConnectionProfile
  environment: EnvironmentProfile
  tab: QueryTabState
  onRefresh(tabId: string): Promise<void> | void
  onOpenQuery(target: ScopedQueryTarget): void
  onOpenObjectView?(connectionId: string, node: ExplorerNode): void
  onPlanOperation?(request: OperationPlanRequest): Promise<OperationPlanResponse | undefined>
  onExecuteDataEdit?(request: DataEditExecutionRequest): Promise<DataEditExecutionResponse | undefined>
}

export function MongoObjectViewWorkspace({
  connection,
  environment,
  tab,
  onRefresh,
  onOpenQuery,
  onOpenObjectView,
  onPlanOperation,
  onExecuteDataEdit,
}: MongoObjectViewWorkspaceProps) {
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
  const queryTarget = useMemo(() => queryTargetFromObjectView(tab), [tab])
  const kind = state?.kind ?? 'object'
  const descriptor = getMongoObjectViewDescriptor(kind)
  const title = descriptor.title
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
      messages: [],
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

      <WarningList warnings={warnings} />

      <div className="object-view-body">
        {renderMongoObjectView(kind, descriptor, payload, onOpenQuery, queryTarget, {
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

function renderMongoObjectView(
  kind: string,
  descriptor: MongoObjectViewDescriptor,
  payload: JsonRecord,
  onOpenQuery: (target: ScopedQueryTarget) => void,
  queryTarget?: ScopedQueryTarget,
  actions?: {
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
