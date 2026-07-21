import type { ConnectionProfile, CreateObjectViewTabRequest, CreateScopedQueryTabRequest, QueryTabReorderRequest, QueryTabState, ScopedQueryTarget, UpdateQueryTabTargetRequest, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createId, defaultQueryTextForConnection, defaultQueryViewModeForConnection, defaultScriptTextForConnection, editorLabelForConnection, languageForConnection } from '../../app/state/helpers'
import { createDefaultCosmosSqlBuilderState } from '../../app/components/workbench/query-builder/cosmos-sql'
import {
  cassandraPartitionKeyFromTarget,
  cassandraTargetFromTarget,
  cosmosSqlTargetFromTarget,
  dynamoTableNameFromTarget,
  mongoAggregationQueryText,
  mongoFindQueryText,
  mongoScriptAggregationText,
  mongoScriptFindText,
  redisDatabaseIndexFromTarget,
  redisKeyBrowserQueryText,
  redisPatternFromTarget,
  searchIndexFromTarget,
} from './browser-tab-scoped-builders'
import { cloneSnapshot, findTab } from './browser-store'
import { effectiveConnectionEnvironmentId } from './library-connection-helpers'

const MAX_CLOSED_TABS = 25

export function createQueryTabForConnection(
  snapshot: WorkspaceSnapshot,
  connection: ConnectionProfile,
  dirty: boolean,
): QueryTabState {
  return {
    id: createId('tab'),
    title: defaultQueryTabTitle(snapshot, connection),
    tabKind: 'query',
    connectionId: connection.id,
    environmentId: effectiveConnectionEnvironmentId(snapshot, connection),
    family: connection.family,
    language: languageForConnection(connection),
    editorLabel: editorLabelForConnection(connection),
    queryText: defaultQueryTextForConnection(connection),
    queryViewMode: defaultQueryViewModeForConnection(connection),
    scriptText: defaultScriptTextForConnection(connection),
    status: 'idle',
    dirty,
    history: [],
  }
}

export function createExplorerTabInSnapshot(
  snapshot: WorkspaceSnapshot,
  connectionId: string,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const connection = next.connections.find((item) => item.id === connectionId)

  if (!connection) {
    return next
  }

  const existingExplorerTab = next.tabs.find(
    (tab) => tab.connectionId === connection.id && tab.tabKind === 'explorer',
  )

  if (existingExplorerTab) {
    const focused = upsertTab(next, existingExplorerTab)
    focused.ui.activeActivity = 'library'
    focused.ui.activeSidebarPane = 'library'
    focused.ui.explorerView = 'structure'
    focused.ui.rightDrawer = 'none'
    return focused
  }

  const tab: QueryTabState = {
    id: createId('tab'),
    title: uniqueExactTabTitle(next, `Explorer - ${connection.name}`),
    tabKind: 'explorer',
    connectionId: connection.id,
    environmentId: effectiveConnectionEnvironmentId(next, connection),
    family: connection.family,
    language: 'text',
    editorLabel: 'Explorer',
    queryText: '',
    queryViewMode: undefined,
    scriptText: undefined,
    status: 'idle',
    dirty: false,
    history: [],
  }

  const focused = upsertTab(next, tab)
  focused.ui.activeActivity = 'library'
  focused.ui.activeSidebarPane = 'library'
  focused.ui.explorerView = 'structure'
  focused.ui.rightDrawer = 'none'
  return focused
}

export function createMetricsTabInSnapshot(
  snapshot: WorkspaceSnapshot,
  connectionId: string,
  environmentId?: string,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const connection = next.connections.find((item) => item.id === connectionId)

  if (!connection) {
    return next
  }

  const resolvedEnvironmentId =
    effectiveConnectionEnvironmentId(next, connection, environmentId)
  const existingMetricsTab = next.tabs.find(
    (tab) =>
      tab.connectionId === connection.id &&
      tab.environmentId === resolvedEnvironmentId &&
      tab.tabKind === 'metrics',
  )

  if (existingMetricsTab) {
    const focused = upsertTab(next, existingMetricsTab)
    focused.ui.activeActivity = 'library'
    focused.ui.activeSidebarPane = 'library'
    focused.ui.rightDrawer = 'none'
    return focused
  }

  const tab: QueryTabState = {
    id: createId('tab'),
    title: uniqueExactTabTitle(next, `Metrics - ${connection.name}`),
    tabKind: 'metrics',
    connectionId: connection.id,
    environmentId: resolvedEnvironmentId,
    family: connection.family,
    language: 'json',
    editorLabel: 'Metrics',
    queryText: '',
    queryViewMode: undefined,
    scriptText: undefined,
    metricsState: {
      connectionId: connection.id,
      environmentId: resolvedEnvironmentId,
      warnings: [],
    },
    status: 'idle',
    dirty: false,
    history: [],
  }

  const focused = upsertTab(next, tab)
  focused.ui.activeActivity = 'library'
  focused.ui.activeSidebarPane = 'library'
  focused.ui.rightDrawer = 'none'
  return focused
}

export function createEnvironmentTabInSnapshot(
  snapshot: WorkspaceSnapshot,
  environmentId: string,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const environment = next.environments.find((item) => item.id === environmentId)

  if (!environment) {
    return next
  }

  const existingEnvironmentTab = next.tabs.find(
    (tab) => tab.tabKind === 'environment' && tab.environmentId === environment.id,
  )

  if (existingEnvironmentTab) {
    const focused = upsertTab(next, existingEnvironmentTab)
    focused.ui.activeActivity = 'library'
    focused.ui.activeSidebarPane = 'library'
    focused.ui.activeEnvironmentId = environment.id
    focused.ui.rightDrawer = 'none'
    return focused
  }

  const connection =
    next.connections.find((item) => item.id === next.ui.activeConnectionId) ??
    next.connections[0]
  const tab: QueryTabState = {
    id: createId('environment-tab'),
    title: uniqueExactTabTitle(next, `Environment - ${environment.label || 'Untitled'}`),
    tabKind: 'environment',
    connectionId: connection?.id ?? '',
    environmentId: environment.id,
    family: connection?.family ?? 'sql',
    language: 'text',
    editorLabel: 'Environment',
    queryText: '',
    queryViewMode: undefined,
    scriptText: undefined,
    status: 'idle',
    dirty: false,
    history: [],
  }

  const focused = upsertTab(next, tab)
  focused.ui.activeActivity = 'library'
  focused.ui.activeSidebarPane = 'library'
  focused.ui.activeEnvironmentId = environment.id
  focused.ui.rightDrawer = 'none'
  return focused
}

export function createObjectViewTabInSnapshot(
  snapshot: WorkspaceSnapshot,
  request: CreateObjectViewTabRequest,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const connection = next.connections.find((item) => item.id === request.connectionId)

  if (!connection) {
    return next
  }

  const environmentId = effectiveConnectionEnvironmentId(
    next,
    connection,
    request.environmentId,
  )
  const existingObjectViewTab = next.tabs.find(
    (tab) =>
      tab.connectionId === connection.id &&
      tab.environmentId === environmentId &&
      tab.tabKind === 'object-view' &&
      tab.objectViewState?.nodeId === request.nodeId,
  )

  if (existingObjectViewTab) {
    return upsertTab(next, existingObjectViewTab)
  }

  const tab: QueryTabState = {
    id: createId('object-view-tab'),
    title: uniqueObjectViewTabTitle(next, request, connection.name),
    tabKind: 'object-view',
    connectionId: connection.id,
    environmentId,
    family: connection.family,
    language: 'json',
    editorLabel: 'Object view',
    queryText: '',
    queryViewMode: undefined,
    scriptText: undefined,
    objectViewState: {
      connectionId: connection.id,
      environmentId,
      nodeId: request.nodeId,
      label: request.label,
      kind: request.kind,
      path: request.path,
      warnings: [],
    },
    status: 'idle',
    dirty: false,
    history: [],
  }

  return upsertTab(next, tab)
}

export function createScopedQueryTabInSnapshot(
  snapshot: WorkspaceSnapshot,
  request: CreateScopedQueryTabRequest,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const connection = next.connections.find((item) => item.id === request.connectionId)

  if (!connection) {
    return next
  }

  const targetObjectName = scopedTargetObjectName(request.target, connection)
  const targetDatabase = scopedTargetDatabase(request.target, connection)
  const targetLabel = scopedTargetObjectLabel(request.target, connection, targetObjectName)
  const builderKind = scopedBuilderKind(connection, request.target)
  const cosmosTarget = builderKind === 'cosmos-sql'
    ? cosmosSqlTargetFromTarget(request.target, connection, targetObjectName)
    : undefined
  const cosmosBuilderState = cosmosTarget
    ? createDefaultCosmosSqlBuilderState(
        cosmosTarget.container,
        cosmosTarget.database,
        50,
      )
    : undefined
  const legacyTitle = scopedQueryTitleCandidate(
    connection,
    targetLabel,
    builderKind === 'mongo-find' || builderKind === 'mongo-aggregation',
  )
  const existingScopedTab = next.tabs.find(
    (tab) =>
      tab.connectionId === request.connectionId &&
      (tab.scopedTarget
        ? scopedTargetsMatch(tab.scopedTarget, request.target)
        : tab.title === legacyTitle),
  )

  if (existingScopedTab) {
    return upsertTab(next, existingScopedTab)
  }

  const queryText =
    builderKind === 'mongo-find'
      ? mongoFindQueryText(targetObjectName ?? '', 20, targetDatabase)
      : builderKind === 'mongo-aggregation'
        ? mongoAggregationQueryText(targetObjectName ?? '', 20, targetDatabase)
      : builderKind === 'cosmos-sql'
        ? cosmosBuilderState?.lastAppliedQueryText ?? request.target.queryTemplate ?? ''
      : builderKind === 'redis-key-browser'
        ? redisKeyBrowserQueryText(
            redisPatternFromTarget(request.target),
            100,
            redisDatabaseIndexFromTarget(request.target),
          )
      : (request.target.queryTemplate ?? defaultQueryTextForConnection(connection))
  const redisDatabaseIndex =
    builderKind === 'redis-key-browser'
      ? redisDatabaseIndexFromTarget(request.target) ?? 0
      : undefined
  const tab: QueryTabState = {
    id: createId('tab'),
    title: uniqueScopedQueryTitle(
      next,
      connection,
      targetLabel,
      builderKind === 'mongo-find' || builderKind === 'mongo-aggregation',
      builderKind,
    ),
    tabKind: 'query',
    connectionId: connection.id,
    environmentId:
      effectiveConnectionEnvironmentId(next, connection, request.environmentId),
    family: connection.family,
    language: languageForConnection(connection),
    editorLabel: editorLabelForConnection(connection),
    queryText,
    queryViewMode: builderKind ? 'builder' : 'raw',
    scriptText:
      connection.engine === 'mongodb' && builderKind === 'mongo-find'
        ? mongoScriptFindText(targetObjectName)
        : connection.engine === 'mongodb' && builderKind === 'mongo-aggregation'
          ? mongoScriptAggregationText(targetObjectName)
        : defaultScriptTextForConnection(connection),
    scopedTarget: request.target,
    builderState:
      builderKind === 'mongo-find'
        ? {
            kind: 'mongo-find',
            ...(targetDatabase ? { database: targetDatabase } : {}),
            collection: targetObjectName ?? '',
            filters: [],
            projectionMode: 'all',
            projectionFields: [],
            sort: [],
            skip: 0,
            limit: 20,
            lastAppliedQueryText: queryText,
          }
        : builderKind === 'mongo-aggregation'
          ? {
              kind: 'mongo-aggregation',
              ...(targetDatabase ? { database: targetDatabase } : {}),
              collection: targetObjectName ?? '',
              stages: [
                { id: 'stage-match', enabled: true, stage: '$match', body: '{}' },
              ],
              limit: 20,
              lastAppliedQueryText: queryText,
            }
        : builderKind === 'redis-key-browser'
          ? {
              kind: 'redis-key-browser',
              pattern: redisPatternFromTarget(request.target),
              typeFilter: 'all',
              databaseIndex: redisDatabaseIndex,
              delimiter: ':',
              cursor: '0',
              scanCount: 100,
              pageSize: 100,
              scannedCount: 0,
              scanCursorByDb: { [String(redisDatabaseIndex ?? 0)]: '0' },
              filters: { ttl: 'all' },
              expandedPrefixes: [],
              visibleColumns: ['ttl', 'memory', 'length'],
              viewMode: 'tree',
              lastAppliedQueryText: queryText,
            }
        : builderKind === 'dynamodb-key-condition'
          ? {
              kind: 'dynamodb-key-condition',
              table: dynamoTableNameFromTarget(request.target, targetLabel),
              partitionKey: {
                id: 'pk',
                enabled: true,
                field: 'pk',
                operator: 'eq',
                value: '',
                valueType: 'string',
              },
              filters: [],
              projectionFields: [],
              limit: 20,
              lastAppliedQueryText: queryText,
            }
        : builderKind === 'cql-partition'
          ? (() => {
              const cqlTarget = cassandraTargetFromTarget(request.target, connection, targetLabel)
              return {
                kind: 'cql-partition' as const,
                keyspace: cqlTarget.keyspace,
                table: cqlTarget.table,
                projectionFields: [],
                partitionKeys: [
                  {
                    id: 'partition-key',
                    enabled: true,
                    field: cassandraPartitionKeyFromTarget(request.target),
                    operator: 'eq',
                    value: '',
                    valueType: 'string',
                  },
                ],
                clusteringKeys: [],
                filters: [],
                limit: 20,
                lastAppliedQueryText: queryText,
              }
            })()
        : builderKind === 'search-dsl'
          ? {
              kind: 'search-dsl',
              index: searchIndexFromTarget(request.target, targetLabel),
              queryMode: 'match-all',
              field: '',
              value: '',
              valueType: 'string',
              filters: [],
              sourceFields: [],
              sort: [],
              aggregations: [],
              size: 20,
              lastAppliedQueryText: queryText,
            }
        : builderKind === 'cosmos-sql'
          ? {
              ...cosmosBuilderState,
              kind: 'cosmos-sql',
              container: cosmosBuilderState?.container ?? '',
              projectionFields: cosmosBuilderState?.projectionFields ?? [],
              filters: cosmosBuilderState?.filters ?? [],
              filterLogic: cosmosBuilderState?.filterLogic ?? 'and',
              sort: cosmosBuilderState?.sort ?? [],
              lastAppliedQueryText: queryText,
            }
        : undefined,
    status: 'idle',
    dirty: true,
    history: [],
  }

  return upsertTab(next, tab)
}

function scopedBuilderKind(
  connection: ConnectionProfile,
  target: ScopedQueryTarget,
): ScopedQueryTarget['preferredBuilder'] {
  if (connection.engine === 'mongodb' && target.preferredBuilder === 'mongo-find') {
    return 'mongo-find'
  }

  if (connection.engine === 'mongodb' && target.preferredBuilder === 'mongo-aggregation') {
    return 'mongo-aggregation'
  }

  if (
    (connection.engine === 'redis' || connection.engine === 'valkey') &&
    target.preferredBuilder === 'redis-key-browser'
  ) {
    return 'redis-key-browser'
  }

  if (
    connection.engine === 'dynamodb' &&
    target.preferredBuilder === 'dynamodb-key-condition'
  ) {
    return 'dynamodb-key-condition'
  }

  if (connection.engine === 'cassandra' && target.preferredBuilder === 'cql-partition') {
    return 'cql-partition'
  }

  if (
    (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') &&
    target.preferredBuilder === 'search-dsl'
  ) {
    return 'search-dsl'
  }

  if (
    connection.engine === 'cosmosdb' &&
    (connection.cosmosDbOptions?.api ?? 'nosql') === 'nosql' &&
    target.preferredBuilder === 'cosmos-sql'
  ) {
    return 'cosmos-sql'
  }

  return undefined
}

function uniqueObjectViewTabTitle(
  snapshot: WorkspaceSnapshot,
  request: CreateObjectViewTabRequest,
  connectionName: string,
) {
  const parent = request.path?.at(-1)
  const candidate =
    parent && parent !== request.label
      ? `${parent} - ${request.label}`
      : request.label || `View - ${connectionName}`
  return uniqueExactTabTitle(snapshot, candidate)
}

function uniqueExactTabTitle(snapshot: WorkspaceSnapshot, candidate: string) {
  const titles = new Set(snapshot.tabs.map((tab) => tab.title))
  if (!titles.has(candidate)) return candidate

  let index = 2
  let title = `${candidate} ${index}`
  while (titles.has(title)) {
    index += 1
    title = `${candidate} ${index}`
  }
  return title
}

export function scopedTargetsMatch(left: ScopedQueryTarget, right: ScopedQueryTarget) {
  return (
    left.kind === right.kind &&
    left.label === right.label &&
    (left.scope ?? '') === (right.scope ?? '') &&
    (left.preferredBuilder ?? '') === (right.preferredBuilder ?? '') &&
    scopedPathKey(left.path) === scopedPathKey(right.path)
  )
}

function scopedPathKey(path?: string[]) {
  return (path ?? []).join('\u001f')
}

function scopedTargetObjectLabel(
  target: ScopedQueryTarget,
  connection: ConnectionProfile,
  targetObjectName = scopedTargetObjectName(target, connection),
) {
  if (connection.engine === 'mongodb') {
    return normalizeScopedTargetLabel(targetObjectName ?? '')
  }

  return normalizeScopedTargetLabel(target.label)
}

function scopedTargetObjectName(
  target: ScopedQueryTarget,
  connection: ConnectionProfile,
) {
  if (connection.engine !== 'mongodb') {
    return undefined
  }

  const scopeParts = target.scope?.split(':').filter(Boolean) ?? []
  const scopeKind = scopeParts[0]
  if (
    scopeKind &&
    ['collection', 'documents', 'aggregation', 'view', 'gridfs'].includes(scopeKind)
  ) {
    if (scopeParts.length >= 3) {
      return normalizeOptionalObjectName(scopeParts.slice(2).join(':'))
    }
    if (scopeParts.length === 2 && scopeKind !== 'aggregation') {
      return normalizeOptionalObjectName(scopeParts[1])
    }
  }

  const path = target.path ?? []
  const objectContainerIndex = firstExistingIndex(path, ['Collections', 'Views', 'GridFS'])
  if (objectContainerIndex >= 0) {
    return normalizeOptionalObjectName(path[objectContainerIndex + 1])
  }

  return undefined
}

function scopedTargetDatabase(
  target: ScopedQueryTarget,
  connection: ConnectionProfile,
) {
  if (connection.engine !== 'mongodb') {
    return connection.database
  }

  const scopeParts = target.scope?.split(':').filter(Boolean) ?? []
  const scopeKind = scopeParts[0]
  if (
    scopeParts.length >= 3 &&
    scopeKind &&
    ['collection', 'documents', 'aggregation', 'view', 'gridfs'].includes(scopeKind)
  ) {
    return normalizeOptionalObjectName(scopeParts[1]) ?? connection.database
  }

  const path = target.path ?? []
  const objectContainerIndex = firstExistingIndex(path, ['Collections', 'Views', 'GridFS'])
  if (objectContainerIndex > 0) {
    return normalizeOptionalObjectName(path[objectContainerIndex - 1]) ?? connection.database
  }

  return connection.database
}

function firstExistingIndex(values: string[], candidates: string[]) {
  for (const candidate of candidates) {
    const index = values.indexOf(candidate)
    if (index >= 0) return index
  }
  return -1
}

function normalizeOptionalObjectName(value: string | undefined) {
  const trimmed = typeof value === 'string' ? value.trim() : undefined
  return trimmed ? trimmed : undefined
}

export function normalizeScopedTargetLabel(label: string) {
  const trimmed = label.trim()

  if (!trimmed) {
    return 'query'
  }

  return [...trimmed]
    .map((character) =>
      character < ' ' || character === '/' || character === '\\' ? '_' : character,
    )
    .join('')
    .slice(0, 80)
}

export function uniqueScopedQueryTitle(
  snapshot: WorkspaceSnapshot,
  connection: ConnectionProfile,
  label: string,
  hasBuilder: boolean,
  builderKind?: ScopedQueryTarget['preferredBuilder'],
) {
  const candidate = scopedQueryTitleCandidate(connection, label, hasBuilder, builderKind)
  const titles = new Set(snapshot.tabs.map((tab) => tab.title))

  if (!titles.has(candidate)) {
    return candidate
  }

  const splitAt = candidate.lastIndexOf('.')
  const stem = splitAt >= 0 ? candidate.slice(0, splitAt) : candidate
  const suffix = splitAt >= 0 ? candidate.slice(splitAt) : ''
  let index = 2
  let title = `${stem} ${index}${suffix}`

  while (titles.has(title)) {
    index += 1
    title = `${stem} ${index}${suffix}`
  }

  return title
}

function scopedQueryTitleCandidate(
  connection: ConnectionProfile,
  label: string,
  hasBuilder: boolean,
  builderKind?: ScopedQueryTarget['preferredBuilder'],
) {
  const extension = tabTitleParts(connection).extension
  if (builderKind === 'mongo-aggregation') {
    return `${label}.aggregate.${extension}`
  }
  return hasBuilder ? `${label}.find.${extension}` : `${label}.${extension}`
}

export function upsertTab(snapshot: WorkspaceSnapshot, tab: QueryTabState): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const index = next.tabs.findIndex((item) => item.id === tab.id)

  if (index >= 0) {
    next.tabs[index] = tab
  } else {
    next.tabs.push(tab)
  }

  next.ui.activeConnectionId = tab.connectionId
  next.ui.activeEnvironmentId = tab.environmentId
  next.ui.activeTabId = tab.id
  next.ui.activeActivity = 'library'
  next.ui.activeSidebarPane = 'library'
  next.ui.rightDrawer = 'none'
  next.updatedAt = new Date().toISOString()
  return next
}

export function archiveClosedTab(
  snapshot: WorkspaceSnapshot,
  tab: QueryTabState,
  closeReason: WorkspaceSnapshot['closedTabs'][number]['closeReason'] = 'user',
) {
  snapshot.closedTabs = [
    {
      ...tab,
      result: undefined,
      closedAt: new Date().toISOString(),
      closeReason,
    },
    ...(snapshot.closedTabs ?? []).filter((item) => item.id !== tab.id),
  ].slice(0, MAX_CLOSED_TABS)
}

export function defaultQueryTabTitle(
  snapshot: WorkspaceSnapshot,
  connection: ConnectionProfile,
) {
  const { prefix, extension } = tabTitleParts(connection)
  let index = 1
  let title = `${prefix} ${index}.${extension}`
  const existingTitles = new Set(snapshot.tabs.map((tab) => tab.title))

  while (existingTitles.has(title)) {
    index += 1
    title = `${prefix} ${index}.${extension}`
  }

  return title
}

export function tabTitleParts(connection: ConnectionProfile) {
  if (connection.engine === 'dynamodb' || connection.family === 'search') {
    return { prefix: 'Query', extension: 'json' }
  }

  if (connection.family === 'document') {
    return { prefix: 'Query', extension: 'json' }
  }

  if (connection.family === 'keyvalue') {
    return { prefix: 'Console', extension: 'redis' }
  }

  return { prefix: 'Query', extension: 'sql' }
}

export function renameQueryTab(
  snapshot: WorkspaceSnapshot,
  tabId: string,
  title: string,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const tab = findTab(next, tabId)
  const nextTitle = title.trim()

  if (tab && nextTitle) {
    tab.title = nextTitle

    if (tab.savedQueryId) {
      tab.dirty = true
    }
  }

  next.updatedAt = new Date().toISOString()
  return next
}

export function updateQueryTabTargetInSnapshot(
  snapshot: WorkspaceSnapshot,
  request: UpdateQueryTabTargetRequest,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const tab = findTab(next, request.tabId)
  if (!tab) {
    return next
  }
  if (tab.activeExecution) {
    throw new Error('Wait for the current query to finish before changing its target.')
  }

  tab.scopedTarget = request.scopedTarget
  tab.queryText = request.queryText
  tab.queryViewMode = request.queryViewMode
  tab.scriptText = request.scriptText
  tab.builderState = request.builderState
  if (request.title?.trim()) {
    tab.title = request.title.trim()
  }
  tab.status = 'idle'
  tab.activeExecution = undefined
  tab.dirty = true
  tab.lastRunAt = undefined
  tab.result = undefined
  tab.error = undefined
  next.updatedAt = new Date().toISOString()
  return next
}

export function closeQueryTab(snapshot: WorkspaceSnapshot, tabId: string): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const tabIndex = next.tabs.findIndex((item) => item.id === tabId)

  if (tabIndex < 0) {
    return next
  }

  const closedTab = next.tabs.splice(tabIndex, 1)[0]

  if (!closedTab) {
    return next
  }

  archiveClosedTab(next, closedTab)

  const nextActiveTab =
    next.tabs[tabIndex] ?? next.tabs[tabIndex - 1] ?? next.tabs[0]

  if (nextActiveTab) {
    next.ui.activeTabId = nextActiveTab.id
    next.ui.activeConnectionId = nextActiveTab.connectionId
    next.ui.activeEnvironmentId = nextActiveTab.environmentId
  } else {
    const fallbackConnection =
      next.connections.find((connection) => connection.id === closedTab.connectionId) ??
      next.connections[0]
    next.ui.activeTabId = ''
    next.ui.activeConnectionId = fallbackConnection?.id ?? ''
    next.ui.activeEnvironmentId =
      closedTab.environmentId || fallbackConnection?.environmentIds[0] || ''
    next.ui.bottomPanelVisible = false
  }

  next.updatedAt = new Date().toISOString()
  return next
}

export function reorderQueryTabsInSnapshot(
  snapshot: WorkspaceSnapshot,
  request: QueryTabReorderRequest,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const tabById = new Map(next.tabs.map((tab) => [tab.id, tab]))

  if (
    request.orderedTabIds.length !== next.tabs.length ||
    new Set(request.orderedTabIds).size !== request.orderedTabIds.length ||
    request.orderedTabIds.some((tabId) => !tabById.has(tabId))
  ) {
    return next
  }

  next.tabs = request.orderedTabIds
    .map((tabId) => tabById.get(tabId))
    .filter((tab): tab is QueryTabState => Boolean(tab))
  next.updatedAt = new Date().toISOString()
  return next
}

export function reopenClosedQueryTab(
  snapshot: WorkspaceSnapshot,
  closedTabId: string,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const closedTabIndex = (next.closedTabs ?? []).findIndex(
    (item) => item.id === closedTabId,
  )

  if (closedTabIndex < 0) {
    return next
  }

  const closedTab = next.closedTabs.splice(closedTabIndex, 1)[0]

  if (!closedTab) {
    return next
  }

  const tabState = { ...closedTab } as QueryTabState & {
    closedAt?: string
    closeReason?: string
  }
  delete tabState.closedAt
  delete tabState.closeReason
  const reopenedTab: QueryTabState = {
    ...tabState,
    id: createId('tab'),
    result: undefined,
    status:
      closedTab.status === 'running' || closedTab.status === 'queued'
        ? 'idle'
        : closedTab.status,
  }

  next.tabs.push(reopenedTab)
  next.ui.activeTabId = reopenedTab.id
  next.ui.activeConnectionId = reopenedTab.connectionId
  next.ui.activeEnvironmentId = reopenedTab.environmentId
  next.updatedAt = new Date().toISOString()
  return next
}
