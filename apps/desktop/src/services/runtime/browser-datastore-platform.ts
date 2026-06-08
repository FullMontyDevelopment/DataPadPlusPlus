import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  DataEditPlanRequest,
  DataEditPlanResponse,
  DatastoreExperienceManifest,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import {
  DATASTORE_TEST_ASSERTIONS,
  DATAPADPLUSPLUS_ADAPTER_MANIFESTS,
  datastoreCompletenessForEngine,
  datastoreTreeForEngine,
  datastoreBacklogByEngine,
  datastoreTestTemplatesForEngine,
} from '@datapadplusplus/shared-types'
import { languageForConnection, resolveEnvironment } from '../../app/state/helpers'
import { redactSensitiveText } from '../../app/state/security-redaction'
import {
  browserDataEditPermission,
  browserDataEditRequest,
  browserDataEditWarnings,
} from './browser-data-edit-requests'
import { browserQueryBuilders } from './browser-query-builders'
import {
  applyEnvironmentGuardsToDataEditPlan,
  browserEnvironmentHasUnresolvedVariables,
  dataEditSecretReferences,
  pushUniqueWarning,
} from './browser-preview-guards'
import {
  redactDataEditPlanForEnvironment,
  redactDataEditResponseForEnvironment,
} from './browser-response-redaction'

export function buildDatastoreExperiences(): DatastoreExperienceManifest[] {
  return DATAPADPLUSPLUS_ADAPTER_MANIFESTS.map((manifest) => {
    const backlog = datastoreBacklogByEngine(manifest.engine)
    const family = manifest.family

    return {
      engine: manifest.engine,
      family,
      label: manifest.label,
      maturity: manifest.maturity,
      objectKinds: browserObjectKinds(family, manifest.engine),
      contextActions: browserContextActions(manifest.engine, family),
      queryBuilders: browserQueryBuilders(manifest.engine),
      editableScopes: browserEditableScopes(manifest.engine, family),
      diagnosticsTabs: browserDiagnosticsTabs(backlog?.capabilities ?? []),
      resultRenderers: backlog?.resultRenderers ?? ['raw'],
      safetyRules: [
        'Read-only profiles block live data edits before execution.',
        'Destructive and admin operations remain guarded preview plans in this phase.',
        'Safe edits require an unambiguous target and adapter-specific permission checks.',
      ],
      tree: datastoreTreeForEngine(manifest.engine, family),
      testTemplates: datastoreTestTemplatesForEngine(manifest.engine, family),
      testAssertions: DATASTORE_TEST_ASSERTIONS,
      completeness: datastoreCompletenessForEngine(manifest.engine),
    }
  })
}

export function planDataEditLocally(
  connection: ConnectionProfile,
  request: DataEditPlanRequest,
  snapshot?: WorkspaceSnapshot,
): DataEditPlanResponse {
  const generatedRequest = redactSensitiveText(browserDataEditRequest(connection, request))
  const warnings = [
    'Preview mode generates guarded data-edit plans without mutating the datastore.',
    ...browserDataEditWarnings(connection, request),
  ]
  const destructive = browserDataEditIsDestructive(request)
  const confirmationText = connection.engine === 'litedb' && isLiteDbDocumentCrud(request.editKind)
    ? `CONFIRM ${connection.engine.toUpperCase()} ${request.editKind.toUpperCase()}`
    : destructive
      ? `CONFIRM ${connection.engine.toUpperCase()} ${request.editKind.toUpperCase()}`
      : undefined
  const plan: DataEditPlanResponse['plan'] = {
    operationId: `${connection.engine}.data-edit.${request.editKind}`,
    engine: connection.engine,
    summary: `${request.editKind} data edit plan prepared for ${connection.name}.`,
    generatedRequest,
    requestLanguage: languageForConnection(connection),
    destructive,
    estimatedCost: 'Single-object edit; cost depends on the engine and indexes.',
    estimatedScanImpact: browserDataEditScanImpact(request),
    requiredPermissions: [browserDataEditPermission(connection, request)],
    confirmationText,
    warnings,
  }

  if (snapshot) {
    const resolvedEnvironment = resolveEnvironment(snapshot.environments, request.environmentId)
    const referencedSecrets = dataEditSecretReferences(request, resolvedEnvironment.sensitiveKeys)
    if (referencedSecrets.length > 0) {
      pushUniqueWarning(
        plan.warnings,
        `Secret variable ${referencedSecrets[0]} is resolved only by the desktop secret store.`,
      )
    }
    applyEnvironmentGuardsToDataEditPlan(snapshot, request.environmentId, plan)
  }

  const response: DataEditPlanResponse = {
    connectionId: request.connectionId,
    environmentId: request.environmentId,
    editKind: request.editKind,
    executionSupport: 'plan-only',
    plan,
  }

  return snapshot
    ? redactDataEditPlanForEnvironment(
        response,
        resolveEnvironment(snapshot.environments, request.environmentId),
      )
    : response
}

function browserDataEditScanImpact(request: DataEditPlanRequest) {
  if (request.editKind === 'insert-document') {
    return 'Single collection insert; no scan should be required.'
  }

  return request.target.primaryKey ||
    request.target.documentId ||
    request.target.key ||
    request.target.itemKey
    ? 'Single object/key predicate supplied; no broad scan should be required.'
    : 'Target is not fully keyed yet; live execution must stay blocked until this is resolved.'
}

function browserDataEditIsDestructive(request: DataEditPlanRequest) {
  return request.editKind.includes('delete') || request.editKind === 'vector-remove-member'
}

export function executeDataEditLocally(
  connection: ConnectionProfile,
  request: DataEditExecutionRequest,
  snapshot?: WorkspaceSnapshot,
): DataEditExecutionResponse {
  const planResponse = planDataEditLocally(connection, request, snapshot)
  const warnings = [...planResponse.plan.warnings]
  const messages = [
    'Generated a safe data-edit plan. Live execution is not enabled in browser preview.',
  ]

  if (connection.readOnly) {
    warnings.push('Live data edit execution was blocked because this connection is read-only.')
  }

  if (planResponse.plan.confirmationText && request.confirmationText !== planResponse.plan.confirmationText) {
    warnings.push(
      'This data edit needs confirmation before it can run.',
    )
  }

  if (snapshot && browserEnvironmentHasUnresolvedVariables(snapshot, request.environmentId)) {
    warnings.push('Unresolved environment variables must be fixed before this data edit can run.')
  }
  if (snapshot) {
    const secretReferences = dataEditSecretReferences(
      request,
      resolveEnvironment(snapshot.environments, request.environmentId).sensitiveKeys,
    )
    if (secretReferences.length > 0) {
      warnings.push(
        `Secret variable ${secretReferences[0]} cannot be resolved in browser preview.`,
      )
    }
  }

  const response: DataEditExecutionResponse = {
    connectionId: request.connectionId,
    environmentId: request.environmentId,
    editKind: request.editKind,
    executionSupport: planResponse.executionSupport,
    executed: false,
    plan: planResponse.plan,
    messages,
    warnings,
  }

  return snapshot
    ? redactDataEditResponseForEnvironment(
        response,
        resolveEnvironment(snapshot.environments, request.environmentId),
      )
    : response
}

function browserObjectKinds(
  family: ConnectionProfile['family'],
  engine: ConnectionProfile['engine'],
): DatastoreExperienceManifest['objectKinds'] {
  if (family === 'document') {
    return [
      objectKind('database', 'Databases', 'Document database namespaces.', ['collection'], false),
      objectKind(
        'collection',
        'Collections',
        'Queryable document containers.',
        ['document', 'index'],
        true,
      ),
      objectKind('document', 'Documents', 'Inspectable JSON/BSON-like values.', ['field'], false),
      objectKind('index', 'Indexes', 'Collection indexes.', [], false),
    ]
  }

  if (family === 'keyvalue') {
    return [
      objectKind('database', 'Databases', 'Logical key namespaces.', ['key'], false),
      objectKind('key', 'Keys', 'Typed key/value entries.', [], true),
    ]
  }

  if (family === 'search') {
    return [
      objectKind('cluster', 'Cluster', 'Search cluster metadata.', ['index'], false),
      objectKind('index', 'Indexes', 'Queryable search indexes.', ['mapping'], true),
      objectKind('mapping', 'Mappings', 'Field mappings and analyzers.', [], false),
    ]
  }

  if (family === 'widecolumn') {
    return [
      objectKind('keyspace', 'Keyspaces', 'Wide-column namespaces.', ['table'], false),
      objectKind('table', 'Tables', 'Partition-key oriented tables.', ['index'], true),
      objectKind(
        'item',
        engine === 'dynamodb' ? 'Items' : 'Rows',
        'Key-addressed values.',
        [],
        false,
      ),
    ]
  }

  return [
    objectKind('database', 'Databases', 'Catalogs or local files.', ['schema'], false),
    objectKind('schema', 'Schemas', 'Namespaces containing queryable objects.', ['table', 'view'], false),
    objectKind('table', 'Tables', 'Queryable row sets.', ['column', 'index'], true),
    objectKind('view', 'Views', 'Stored query definitions.', [], true),
    objectKind('index', 'Indexes', 'Access paths and constraints.', [], false),
  ]
}

function objectKind(
  kind: string,
  label: string,
  description: string,
  childKinds: string[],
  queryable: boolean,
): DatastoreExperienceManifest['objectKinds'][number] {
  return {
    kind,
    label,
    description,
    childKinds,
    queryable,
    supportsContextMenu: true,
  }
}

function browserContextActions(
  engine: ConnectionProfile['engine'],
  family: ConnectionProfile['family'],
): DatastoreExperienceManifest['contextActions'] {
  return [
    {
      id: 'open-query',
      label: 'Open Query',
      scope: 'query',
      risk: 'read',
      operationId: `${engine}.query.execute`,
      requiresSelection: true,
      description: `Open a ${family} query scoped to the selected object.`,
    },
    {
      id: 'refresh-metadata',
      label: 'Refresh Metadata',
      scope: 'connection',
      risk: 'read',
      operationId: `${engine}.metadata.refresh`,
      requiresSelection: false,
      description: 'Reload engine-native metadata.',
    },
  ]
}

function browserEditableScopes(
  engine: ConnectionProfile['engine'],
  family: ConnectionProfile['family'],
): DatastoreExperienceManifest['editableScopes'] {
  if (
    [
      'postgresql',
      'cockroachdb',
      'sqlserver',
      'mysql',
      'mariadb',
      'sqlite',
      'timescaledb',
      'oracle',
    ].includes(
      engine,
    )
  ) {
    return [
      {
        scope: 'table',
        label: 'Table Rows',
        editKinds: ['insert-row', 'update-row', 'delete-row'],
        requiresPrimaryKey: true,
        liveExecution: false,
      },
    ]
  }

  if (engine === 'mongodb') {
    return [
      {
        scope: 'collection',
        label: 'Collection Documents',
        editKinds: [
          'insert-document',
          'set-field',
          'unset-field',
          'rename-field',
          'change-field-type',
          'update-document',
          'delete-document',
        ],
        requiresPrimaryKey: true,
        liveExecution: false,
      },
    ]
  }

  if (engine === 'litedb') {
    return [
      {
        scope: 'collection',
        label: 'Collection Documents',
        editKinds: ['insert-document', 'update-document', 'delete-document'],
        requiresPrimaryKey: true,
        liveExecution: false,
      },
    ]
  }

  if (engine === 'redis') {
    return [
      {
        scope: 'key',
        label: 'Keys',
        editKinds: [
          'set-key-value',
          'set-ttl',
          'delete-key',
          'hash-set-field',
          'hash-delete-field',
          'list-set-index',
          'list-push',
          'list-remove-value',
          'set-add-member',
          'set-remove-member',
          'zset-add-member',
          'zset-remove-member',
          'stream-add-entry',
          'stream-delete-entry',
          'timeseries-add-sample',
          'timeseries-delete-sample',
          'json-set-path',
          'json-delete-path',
          'vector-add-member',
          'vector-remove-member',
          'vector-set-attributes',
        ],
        requiresPrimaryKey: false,
        liveExecution: false,
      },
    ]
  }

  if (engine === 'valkey') {
    return [
      {
        scope: 'key',
        label: 'Keys',
        editKinds: [
          'set-key-value',
          'set-ttl',
          'delete-key',
          'hash-set-field',
          'hash-delete-field',
          'list-set-index',
          'list-push',
          'list-remove-value',
          'set-add-member',
          'set-remove-member',
          'zset-add-member',
          'zset-remove-member',
          'stream-add-entry',
          'stream-delete-entry',
        ],
        requiresPrimaryKey: false,
        liveExecution: false,
      },
    ]
  }

  if (family === 'widecolumn') {
    return [
      {
        scope: 'table',
        label: engine === 'dynamodb' ? 'Items' : 'Rows',
        editKinds: engine === 'dynamodb' ? ['put-item', 'update-item', 'delete-item'] : ['update-row'],
        requiresPrimaryKey: true,
        liveExecution: false,
      },
    ]
  }

  if (family === 'search') {
    return [
      {
        scope: 'index',
        label: 'Documents',
        editKinds: ['index-document', 'update-document', 'delete-document'],
        requiresPrimaryKey: true,
        liveExecution: false,
      },
    ]
  }

  return []
}

function isLiteDbDocumentCrud(editKind: string) {
  return ['insert-document', 'update-document', 'delete-document'].includes(editKind)
}

function browserDiagnosticsTabs(
  capabilities: string[],
): DatastoreExperienceManifest['diagnosticsTabs'] {
  const tabs: DatastoreExperienceManifest['diagnosticsTabs'] = [
    {
      id: 'overview',
      label: 'Overview',
      description: 'Connection health, adapter maturity, and metadata status.',
      defaultRenderer: 'metrics',
    },
  ]

  if (capabilities.includes('supports_explain_plan')) {
    tabs.push({
      id: 'plans',
      label: 'Plans',
      description: 'Execution plans and plan visualization payloads.',
      defaultRenderer: 'plan',
    })
  }

  if (capabilities.includes('supports_permission_inspection')) {
    tabs.push({
      id: 'security',
      label: 'Security',
      description: 'Roles, grants, IAM hints, and disabled-action reasons.',
      defaultRenderer: 'table',
    })
  }

  return tabs
}
