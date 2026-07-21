import type {
  ConnectionProfile,
  QueryBuilderState,
  QueryTabState,
  QueryViewMode,
  ScopedQueryTarget,
  UpdateQueryTabTargetRequest,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { defaultQueryTextForConnection } from '../../../state/helpers'
import { buildQueryTextForBuilderState } from '../../../controllers/query-builder-routing'
import {
  mongoScriptAggregationText,
  mongoScriptFindText,
  redisDatabaseIndexFromTarget,
  redisPatternFromTarget,
} from '../../../../services/runtime/browser-tab-scoped-builders'
import {
  queryTargetRegistryForEngine,
  queryTargetValues,
} from './query-target-registry'

export interface QueryTargetChangePlan {
  request: UpdateQueryTabTargetRequest
  customRepresentations: Array<'query' | 'script'>
}

export function buildQueryTargetChangePlan({
  builderState,
  connection,
  currentQueryText,
  currentScriptText,
  mode,
  snapshot,
  tab,
  target,
}: {
  builderState: QueryBuilderState | undefined
  connection: ConnectionProfile
  currentQueryText: string
  currentScriptText: string | undefined
  mode: QueryViewMode
  snapshot: WorkspaceSnapshot
  tab: QueryTabState
  target: ScopedQueryTarget
}): QueryTargetChangePlan {
  const nextBuilderState = builderState
    ? builderStateForQueryTarget(builderState, connection, target)
    : undefined
  const nextTab = { ...tab, scopedTarget: target, builderState: nextBuilderState }
  const generatedQueryText = nextBuilderState
    ? buildQueryTextForBuilderState(nextBuilderState, connection, nextTab)
    : undefined
  const queryText = generatedQueryText ?? target.queryTemplate ?? defaultQueryTextForConnection(connection)
  const builderWithAppliedText = nextBuilderState
    ? { ...nextBuilderState, lastAppliedQueryText: queryText } as QueryBuilderState
    : undefined
  const scriptText = connection.engine === 'mongodb'
    ? mongoScriptText(target, builderWithAppliedText)
    : tab.scriptText
  const customRepresentations: Array<'query' | 'script'> = []
  const previousGeneratedQuery = generatedQueryBaseline(tab, connection, builderState)

  if (
    currentQueryText.trim() &&
    normalizeText(currentQueryText) !== normalizeText(previousGeneratedQuery) &&
    normalizeText(currentQueryText) !== normalizeText(queryText)
  ) {
    customRepresentations.push('query')
  }

  if (connection.engine === 'mongodb' && currentScriptText?.trim()) {
    const previousScript = mongoScriptText(tab.scopedTarget, builderState)
    if (
      normalizeText(currentScriptText) !== normalizeText(previousScript) &&
      normalizeText(currentScriptText) !== normalizeText(scriptText)
    ) {
      customRepresentations.push('script')
    }
  }

  return {
    customRepresentations,
    request: {
      tabId: tab.id,
      scopedTarget: target,
      queryText,
      queryViewMode: mode,
      scriptText,
      builderState: builderWithAppliedText,
      title: generatedTitleForTarget(snapshot, tab, connection, target, builderWithAppliedText),
    },
  }
}

export function builderStateForQueryTarget(
  builderState: QueryBuilderState,
  connection: ConnectionProfile,
  target: ScopedQueryTarget,
): QueryBuilderState {
  const registry = queryTargetRegistryForEngine(connection.engine)
  const values = queryTargetValues(connection, target, registry)
  const value = (levelId: string) => {
    const index = registry.levels.findIndex((item) => item.id === levelId)
    return index >= 0 ? values[index] : undefined
  }
  const objectName = scopedObjectName(target, connection) || target.label

  switch (builderState.kind) {
    case 'mongo-find':
    case 'mongo-aggregation':
      return {
        ...builderState,
        database: value('database') || builderState.database,
        collection: value('collection') || objectName,
      }
    case 'sql-select':
      return {
        ...builderState,
        schema: value('schema') || builderState.schema,
        table: objectName,
      }
    case 'dynamodb-key-condition': {
      const indexTarget = registry.levels.findIndex((item) => item.id === 'index')
      const targetLevel = registry.levels.findIndex((item) => item.kinds.includes(normalizeKind(target.kind)))
      return {
        ...builderState,
        table: value('table') || builderState.table || objectName,
        indexName: targetLevel === indexTarget ? value('index') || objectName : undefined,
      }
    }
    case 'cql-partition':
      return {
        ...builderState,
        keyspace: value('keyspace') || builderState.keyspace,
        table: value('relation') || objectName,
      }
    case 'search-dsl':
      return { ...builderState, index: value('index') || objectName }
    case 'cosmos-sql':
      return {
        ...builderState,
        database: value('database') || builderState.database,
        container: value('container') || objectName,
      }
    case 'redis-key-browser':
      return {
        ...builderState,
        databaseIndex: redisDatabaseIndexFromTarget(target) ?? builderState.databaseIndex,
        pattern: redisPatternFromTarget(target),
        cursor: '0',
        scannedCount: 0,
        selectedKey: undefined,
      }
  }
}

function generatedQueryBaseline(
  tab: QueryTabState,
  connection: ConnectionProfile,
  builderState: QueryBuilderState | undefined,
) {
  if (builderState?.lastAppliedQueryText) {
    return builderState.lastAppliedQueryText
  }
  if (tab.scopedTarget?.queryTemplate) {
    return tab.scopedTarget.queryTemplate
  }
  return defaultQueryTextForConnection(connection)
}

function mongoScriptText(
  target: ScopedQueryTarget | undefined,
  builderState: QueryBuilderState | undefined,
) {
  const collection = target ? scopedObjectName(target) || target.label : mongoBuilderCollection(builderState)
  const aggregation = builderState?.kind === 'mongo-aggregation' || target?.preferredBuilder === 'mongo-aggregation'
  return aggregation
    ? mongoScriptAggregationText(collection)
    : mongoScriptFindText(collection)
}

function mongoBuilderCollection(builderState: QueryBuilderState | undefined) {
  return builderState?.kind === 'mongo-find' || builderState?.kind === 'mongo-aggregation'
    ? builderState.collection
    : undefined
}

function scopedObjectName(target: ScopedQueryTarget, connection?: ConnectionProfile) {
  const scopeParts = target.scope?.split(':').filter(Boolean) ?? []
  if (
    connection?.engine === 'cosmosdb' &&
    ['container', 'items'].includes(scopeParts[1] ?? '')
  ) {
    return scopeParts.at(-1) ?? target.label
  }
  if (connection?.engine === 'sqlserver' && scopeParts.length >= 4) {
    return scopeParts.at(-1) ?? target.label
  }
  if (['mysql', 'mariadb'].includes(connection?.engine ?? '') && target.scope?.startsWith('table:')) {
    return target.scope.slice('table:'.length).split('.').at(-1) ?? target.label
  }
  if (connection?.engine === 'oracle' && scopeParts[0] === 'oracle' && scopeParts[1] === 'object') {
    return scopeParts.at(-1) ?? target.label
  }
  if (
    ['postgresql', 'cockroachdb', 'timescaledb', 'sqlite', 'duckdb', 'clickhouse', 'snowflake', 'bigquery']
      .includes(connection?.engine ?? '') &&
    /^(?:table|view|materialized-view):/i.test(target.scope ?? '')
  ) {
    return target.scope?.split(':').at(-1)?.split('.').at(-1) ?? target.label
  }
  if (scopeParts.length >= 3) {
    return scopeParts.slice(2).join(':')
  }
  return target.label
}

function generatedTitleForTarget(
  snapshot: WorkspaceSnapshot,
  tab: QueryTabState,
  connection: ConnectionProfile,
  target: ScopedQueryTarget,
  builderState: QueryBuilderState | undefined,
) {
  if (tab.saveTarget || tab.savedQueryId || !tab.scopedTarget) {
    return undefined
  }
  const previousTitle = targetTitle(connection, tab.scopedTarget, tab.builderState as QueryBuilderState | undefined)
  if (tab.title !== previousTitle) {
    return undefined
  }
  const candidate = targetTitle(connection, target, builderState)
  if (!snapshot.tabs.some((item) => item.id !== tab.id && item.title === candidate)) {
    return candidate
  }
  return undefined
}

function targetTitle(
  connection: ConnectionProfile,
  target: ScopedQueryTarget,
  builderState: QueryBuilderState | undefined,
) {
  const label = [...target.label]
    .map((character) => character < ' ' || character === '/' || character === '\\' ? '_' : character)
    .join('')
    .slice(0, 80) || 'query'
  const extension = connection.family === 'keyvalue'
    ? 'redis'
    : connection.family === 'document' || connection.family === 'search' || connection.engine === 'dynamodb'
      ? 'json'
      : 'sql'
  if (builderState?.kind === 'mongo-aggregation' || target.preferredBuilder === 'mongo-aggregation') {
    return `${label}.aggregate.${extension}`
  }
  if (builderState?.kind === 'cosmos-sql' || target.preferredBuilder === 'cosmos-sql') {
    return `${label}.${extension}`
  }
  return builderState ? `${label}.find.${extension}` : `${label}.${extension}`
}

function normalizeText(value: string | undefined) {
  return value?.trim().replaceAll('\r\n', '\n') ?? ''
}

function normalizeKind(value: string) {
  return value.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')
}
