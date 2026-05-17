import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditExecutionResponse,
  DataEditPlanRequest,
  DataEditPlanResponse,
  DatastoreExperienceManifest,
} from '@datapadplusplus/shared-types'
import {
  DATASTORE_TEST_ASSERTIONS,
  DATAPADPLUSPLUS_ADAPTER_MANIFESTS,
  datastoreBacklogByEngine,
  datastoreTestTemplatesForEngine,
} from '@datapadplusplus/shared-types'
import { languageForConnection } from '../../app/state/helpers'
import {
  browserDataEditPermission,
  browserDataEditRequest,
  browserDataEditWarnings,
} from './browser-data-edit-requests'

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
      testTemplates: datastoreTestTemplatesForEngine(manifest.engine, family),
      testAssertions: DATASTORE_TEST_ASSERTIONS,
    }
  })
}

export function planDataEditLocally(
  connection: ConnectionProfile,
  request: DataEditPlanRequest,
): DataEditPlanResponse {
  const generatedRequest = browserDataEditRequest(connection, request)
  const warnings = [
    'Preview mode generates guarded data-edit plans without mutating the datastore.',
    ...browserDataEditWarnings(connection, request),
  ]

  return {
    connectionId: request.connectionId,
    environmentId: request.environmentId,
    editKind: request.editKind,
    executionSupport: 'plan-only',
    plan: {
      operationId: `${connection.engine}.data-edit.${request.editKind}`,
      engine: connection.engine,
      summary: `${request.editKind} data edit plan prepared for ${connection.name}.`,
      generatedRequest,
      requestLanguage: languageForConnection(connection),
      destructive: request.editKind.includes('delete'),
      estimatedCost: 'Single-object edit; cost depends on the engine and indexes.',
      estimatedScanImpact:
        request.target.primaryKey ||
        request.target.documentId ||
        request.target.key ||
        request.target.itemKey
          ? 'Single object/key predicate supplied; no broad scan should be required.'
          : 'Target is not fully keyed yet; live execution must stay blocked until this is resolved.',
      requiredPermissions: [browserDataEditPermission(connection, request)],
      confirmationText: `CONFIRM ${connection.engine.toUpperCase()} ${request.editKind.toUpperCase()}`,
      warnings,
    },
  }
}

export function executeDataEditLocally(
  connection: ConnectionProfile,
  request: DataEditExecutionRequest,
): DataEditExecutionResponse {
  const planResponse = planDataEditLocally(connection, request)
  const warnings = [...planResponse.plan.warnings]
  const messages = [
    'Generated a safe data-edit plan. Live execution is not enabled in browser preview.',
  ]

  if (connection.readOnly) {
    warnings.push('Live data edit execution was blocked because this connection is read-only.')
  }

  if (request.confirmationText !== planResponse.plan.confirmationText) {
    warnings.push(`Type \`${planResponse.plan.confirmationText}\` before executing this data edit.`)
  }

  return {
    connectionId: request.connectionId,
    environmentId: request.environmentId,
    editKind: request.editKind,
    executionSupport: planResponse.executionSupport,
    executed: false,
    plan: planResponse.plan,
    messages,
    warnings,
  }
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

function browserQueryBuilders(
  engine: ConnectionProfile['engine'],
): DatastoreExperienceManifest['queryBuilders'] {
  if (engine === 'mongodb') {
    return [{ kind: 'mongo-find', label: 'Find Builder', scope: 'collection', defaultMode: 'split' }]
  }

  if (engine === 'elasticsearch' || engine === 'opensearch') {
    return [{ kind: 'search-dsl', label: 'Search DSL Builder', scope: 'index', defaultMode: 'split' }]
  }

  if (engine === 'dynamodb') {
    return [
      {
        kind: 'dynamodb-key-condition',
        label: 'Key Condition Builder',
        scope: 'table',
        defaultMode: 'split',
      },
    ]
  }

  if (engine === 'cassandra') {
    return [
      {
        kind: 'cql-partition',
        label: 'Partition Key Builder',
        scope: 'table',
        defaultMode: 'split',
      },
    ]
  }

  if (engine === 'redis' || engine === 'valkey') {
    return [{ kind: 'redis-key-browser', label: 'Key Browser', scope: 'key', defaultMode: 'visual' }]
  }

  if (['postgresql', 'cockroachdb', 'sqlserver', 'mysql', 'mariadb', 'sqlite'].includes(engine)) {
    return [{ kind: 'sql-select', label: 'SQL SELECT Builder', scope: 'table', defaultMode: 'split' }]
  }

  return []
}

function browserEditableScopes(
  engine: ConnectionProfile['engine'],
  family: ConnectionProfile['family'],
): DatastoreExperienceManifest['editableScopes'] {
  if (['postgresql', 'cockroachdb', 'sqlserver', 'mysql', 'mariadb', 'sqlite'].includes(engine)) {
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
        editKinds: ['set-field', 'unset-field', 'rename-field', 'change-field-type'],
        requiresPrimaryKey: true,
        liveExecution: false,
      },
    ]
  }

  if (engine === 'redis' || engine === 'valkey') {
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
