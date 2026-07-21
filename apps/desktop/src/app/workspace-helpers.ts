import type {
  ConnectionProfile,
  ExecutionCapabilities,
  QueryBuilderState,
  QueryTabState,
  ResultPayload,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import {
  createDefaultCqlPartitionBuilderState,
  isCqlPartitionBuilderState,
  parseCqlPartitionQueryText,
} from './components/workbench/query-builder/cql-partition'
import {
  createDefaultCosmosSqlBuilderState,
  isCosmosSqlBuilderState,
  parseCosmosSqlQueryText,
} from './components/workbench/query-builder/cosmos-sql'
import {
  createDefaultDynamoDbKeyConditionBuilderState,
  isDynamoDbKeyConditionBuilderState,
  parseDynamoDbKeyConditionQueryText,
} from './components/workbench/query-builder/dynamodb-key-condition'
import {
  buildMongoFindQueryText,
  createDefaultMongoFindBuilderState,
  isMongoFindBuilderState,
} from './components/workbench/query-builder/mongo-find'
import {
  buildMongoAggregationQueryText,
  createDefaultMongoAggregationBuilderState,
  isMongoAggregationBuilderState,
  parseMongoAggregationQueryText,
} from './components/workbench/query-builder/mongo-aggregation'
import {
  isSqlSelectBuilderState,
  parseSqlSelectQueryText,
} from './components/workbench/query-builder/sql-select'
import {
  createDefaultSearchDslBuilderState,
  isSearchDslBuilderState,
  parseSearchDslQueryText,
} from './components/workbench/query-builder/search-dsl'
import {
  createDefaultRedisKeyBrowserState,
  isRedisKeyBrowserState,
  parseRedisKeyBrowserQueryText,
} from './components/workbench/query-builder/redis-key-browser'
import {
  defaultRowLimitForConnection,
  defaultScriptTextForConnection,
  editorLanguageForConnection,
} from './state/helpers'

export { defaultScriptTextForConnection }

export function resolveThemeMode(theme: WorkspaceSnapshot['preferences']['theme']) {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }

  return theme
}

export function builderStateForTab(
  tab: QueryTabState,
  connection: ConnectionProfile,
  draftStates: Record<string, QueryBuilderState>,
): QueryBuilderState | undefined {
  const draftState = draftStates[tab.id]

  if (connection.engine === 'mongodb') {
    if (isMongoAggregationBuilderState(draftState)) {
      return withMongoBuilderDatabase(draftState, tab, connection)
    }

    if (isMongoFindBuilderState(draftState)) {
      return withMongoBuilderDatabase(draftState, tab, connection)
    }

    if (isMongoAggregationBuilderState(tab.builderState)) {
      return withMongoBuilderDatabase(tab.builderState, tab, connection)
    }

    if (isMongoFindBuilderState(tab.builderState)) {
      return withMongoBuilderDatabase(tab.builderState, tab, connection)
    }

    const aggregation = parseMongoAggregationQueryText(tab.queryText)
    if (aggregation) {
      return withMongoBuilderDatabase(aggregation, tab, connection)
    }

    return createDefaultMongoFindBuilderState(
      mongoCollectionFromQueryText(tab.queryText),
      mongoLimitFromQueryText(tab.queryText),
      mongoDatabaseFromQueryText(tab.queryText) ??
        mongoDatabaseFromScopedTarget(tab.scopedTarget) ??
        connection.database,
    )
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    if (isRedisKeyBrowserState(draftState)) {
      return draftState
    }

    if (isRedisKeyBrowserState(tab.builderState)) {
      return tab.builderState
    }

    return parseRedisKeyBrowserQueryText(tab.queryText) ?? createDefaultRedisKeyBrowserState('*', 100)
  }

  if (isCosmosNoSqlConnection(connection)) {
    if (isCosmosSqlBuilderState(draftState)) {
      return draftState
    }

    if (isCosmosSqlBuilderState(tab.builderState)) {
      return tab.builderState
    }

    const target = cosmosTargetForTab(tab, connection)
    return parseCosmosSqlQueryText(tab.queryText, target)
      ?? createDefaultCosmosSqlBuilderState(target.container, target.database)
  }

  if (isSqlBuilderConnection(connection)) {
    if (isSqlSelectBuilderState(draftState)) {
      return draftState
    }

    if (isSqlSelectBuilderState(tab.builderState)) {
      return tab.builderState
    }

    return parseSqlSelectQueryText(tab.queryText, connection.engine)
  }

  if (connection.engine === 'dynamodb') {
    if (isDynamoDbKeyConditionBuilderState(draftState)) {
      return draftState
    }

    if (isDynamoDbKeyConditionBuilderState(tab.builderState)) {
      return tab.builderState
    }

    return parseDynamoDbKeyConditionQueryText(tab.queryText)
      ?? createDefaultDynamoDbKeyConditionBuilderState('', 20)
  }

  if (connection.engine === 'cassandra') {
    if (isCqlPartitionBuilderState(draftState)) {
      return draftState
    }

    if (isCqlPartitionBuilderState(tab.builderState)) {
      return tab.builderState
    }

    return parseCqlPartitionQueryText(tab.queryText)
      ?? createDefaultCqlPartitionBuilderState('', connection.database ?? '', 20)
  }

  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    if (isSearchDslBuilderState(draftState)) {
      return draftState
    }

    if (isSearchDslBuilderState(tab.builderState)) {
      return tab.builderState
    }

    return parseSearchDslQueryText(tab.queryText) ?? createDefaultSearchDslBuilderState('', 20)
  }

  return undefined
}

function withMongoBuilderDatabase<T extends QueryBuilderState>(
  builderState: T,
  tab: QueryTabState,
  connection: ConnectionProfile,
): T {
  if (!isMongoFindBuilderState(builderState) && !isMongoAggregationBuilderState(builderState)) {
    return builderState
  }

  const database =
    builderState.database?.trim() ||
    mongoDatabaseFromQueryText(builderState.lastAppliedQueryText ?? tab.queryText) ||
    mongoDatabaseFromScopedTarget(tab.scopedTarget) ||
    connection.database?.trim()

  if (!database || builderState.database === database) {
    return builderState
  }

  const nextBuilderState = {
    ...builderState,
    database,
  }

  return {
    ...nextBuilderState,
    lastAppliedQueryText: isMongoFindBuilderState(nextBuilderState)
      ? buildMongoFindQueryText(nextBuilderState)
      : buildMongoAggregationQueryText(nextBuilderState),
  } as T
}

export function queryBuilderObjectOptions(
  connection: ConnectionProfile | undefined,
  explorerItems: Array<{ kind: string; label: string }>,
) {
  if (connection?.engine !== 'mongodb') {
    if (connection?.engine === 'redis' || connection?.engine === 'valkey') {
      return []
    }

    if (connection?.engine === 'dynamodb') {
      return explorerItems
        .filter((node) => node.kind === 'table')
        .map((node) => node.label)
    }

    if (connection?.engine === 'cosmosdb') {
      return explorerItems
        .filter((node) => node.kind === 'container')
        .map((node) => node.label)
    }

    if (connection && isSqlBuilderConnection(connection)) {
      return explorerItems
        .filter((node) => ['table', 'view'].includes(node.kind))
        .map((node) => node.label)
    }

    if (connection?.engine === 'cassandra') {
      return explorerItems
        .filter((node) => node.kind === 'table')
        .map((node) => node.label)
    }

    if (connection?.engine === 'elasticsearch' || connection?.engine === 'opensearch') {
      return explorerItems
        .filter((node) => ['index', 'data-stream'].includes(node.kind))
        .map((node) => node.label)
    }

    return []
  }

  const explorerCollections = explorerItems
    .filter((node) => ['collection', 'view', 'gridfs-collection'].includes(node.kind))
    .map((node) => node.label)

  return Array.from(new Set(explorerCollections))
}

export function isSqlBuilderConnection(connection: ConnectionProfile) {
  return ['postgresql', 'cockroachdb', 'sqlserver', 'mysql', 'mariadb', 'sqlite'].includes(
    connection.engine,
  )
}

export function isCosmosNoSqlConnection(connection: ConnectionProfile) {
  return connection.engine === 'cosmosdb' &&
    (connection.cosmosDbOptions?.api ?? 'nosql') === 'nosql'
}

export function defaultCapabilities(): ExecutionCapabilities {
  return {
    canCancel: false,
    canExplain: false,
    supportsLiveMetadata: false,
    supportsBatchExecution: false,
    supportsSelectionExecution: false,
    batchSplitStrategy: 'none',
    editorLanguage: 'sql',
    defaultRowLimit: 200,
  }
}

export function deriveCapabilities(
  snapshot: WorkspaceSnapshot,
  connection: ConnectionProfile,
): ExecutionCapabilities {
  const manifest = snapshot.adapterManifests.find(
    (item) => item.engine === connection.engine,
  )
  const capabilities = new Set(manifest?.capabilities ?? [])

  return {
    canCancel: capabilities.has('supports_query_cancellation'),
    canExplain: capabilities.has('supports_explain_plan'),
    supportsBatchExecution: supportsBatchExecution(connection),
    supportsSelectionExecution: supportsSelectionExecution(connection),
    batchSplitStrategy: batchSplitStrategyForConnection(connection),
    supportsLiveMetadata:
      capabilities.has('supports_schema_browser') ||
      capabilities.has('supports_key_browser') ||
      capabilities.has('supports_document_view') ||
      capabilities.has('supports_graph_view') ||
      capabilities.has('supports_index_management') ||
      capabilities.has('supports_metrics_collection'),
    editorLanguage: editorLanguageForConnection(connection),
    defaultRowLimit: defaultRowLimitForConnection(connection),
  }
}

function supportsBatchExecution(connection: ConnectionProfile) {
  return batchCapableEngines.has(connection.engine)
}

function supportsSelectionExecution(connection: ConnectionProfile) {
  return supportsBatchExecution(connection) || editorLanguageForConnection(connection) !== 'plaintext'
}

function batchSplitStrategyForConnection(
  connection: ConnectionProfile,
): NonNullable<ExecutionCapabilities['batchSplitStrategy']> {
  if (connection.engine === 'sqlserver') {
    return 'sqlserver-go'
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return 'newline'
  }

  if (connection.engine === 'mongodb') {
    return 'script'
  }

  if (supportsBatchExecution(connection)) {
    return 'sql'
  }

  return 'none'
}

const batchCapableEngines = new Set([
  'postgresql',
  'cockroachdb',
  'timescaledb',
  'sqlserver',
  'sqlite',
  'mysql',
  'mariadb',
  'redis',
  'valkey',
  'mongodb',
  'cassandra',
])

export function selectPayload(payloads: ResultPayload[], selectedRenderer?: string) {
  if (payloads.length === 0) {
    return undefined
  }

  return (
    payloads.find((payload) => payload.renderer === selectedRenderer) ?? payloads[0]
  )
}

export function appendFieldToQueryText(queryText: string, fieldPath: string) {
  const trimmedField = fieldPath.trim()

  if (!trimmedField) {
    return queryText
  }

  if (!queryText.trim()) {
    return trimmedField
  }

  return `${queryText.trimEnd()}\n${trimmedField}`
}

export { createDefaultMongoAggregationBuilderState, isMongoAggregationBuilderState }

function cosmosTargetForTab(tab: QueryTabState, connection: ConnectionProfile) {
  const parts = tab.scopedTarget?.scope?.split(':').filter(Boolean) ?? []
  const scopedDatabase = parts[0] === 'cosmos' && parts.length >= 3
    ? parts[2]
    : undefined
  const scopedContainer =
    parts[0] === 'cosmos' && ['container', 'items'].includes(parts[1] ?? '')
      ? parts[3]
      : undefined
  return {
    database:
      scopedDatabase ??
      connection.cosmosDbOptions?.databaseName ??
      connection.database,
    container:
      scopedContainer ??
      (['container', 'items'].includes(tab.scopedTarget?.kind ?? '')
        ? tab.scopedTarget?.label
        : undefined) ??
      connection.cosmosDbOptions?.containerPrefix,
  }
}

function mongoCollectionFromQueryText(queryText: string) {
  try {
    const parsed = JSON.parse(queryText) as { collection?: unknown }
    return typeof parsed.collection === 'string' ? parsed.collection : ''
  } catch {
    return ''
  }
}

function mongoDatabaseFromQueryText(queryText: string) {
  try {
    const parsed = JSON.parse(queryText) as { database?: unknown; db?: unknown }
    const database =
      typeof parsed.database === 'string'
        ? parsed.database
        : typeof parsed.db === 'string'
          ? parsed.db
          : undefined
    return database?.trim() || ''
  } catch {
    return ''
  }
}

function mongoDatabaseFromScopedTarget(target: QueryTabState['scopedTarget']) {
  if (!target) {
    return ''
  }

  const scopeParts = target.scope?.split(':').filter(Boolean) ?? []
  if (
    scopeParts.length >= 3 &&
    ['collection', 'aggregation', 'view', 'gridfs'].includes(scopeParts[0] ?? '')
  ) {
    return scopeParts[1] ?? ''
  }

  const path = target.path ?? []
  const collectionContainerIndex = ['Collections', 'Views', 'GridFS']
    .map((container) => path.indexOf(container))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0]

  return collectionContainerIndex && collectionContainerIndex > 0
    ? path[collectionContainerIndex - 1] ?? ''
    : ''
}

function mongoLimitFromQueryText(queryText: string) {
  try {
    const parsed = JSON.parse(queryText) as { limit?: unknown }
    return typeof parsed.limit === 'number' && Number.isFinite(parsed.limit) && parsed.limit > 0
      ? Math.floor(parsed.limit)
      : 20
  } catch {
    return 20
  }
}
