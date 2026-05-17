import type { ConnectionProfile, CreateScopedQueryTabRequest, QueryTabReorderRequest, QueryTabState, ScopedQueryTarget, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createId, defaultQueryTextForConnection, editorLabelForConnection, languageForConnection } from '../../app/state/helpers'
import { cloneSnapshot, findTab } from './browser-store'

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
    environmentId: connection.environmentIds[0] ?? snapshot.environments[0]?.id ?? 'env-dev',
    family: connection.family,
    language: languageForConnection(connection),
    editorLabel: editorLabelForConnection(connection),
    queryText: defaultQueryTextForConnection(connection),
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
    focused.ui.activeActivity = 'connections'
    focused.ui.activeSidebarPane = 'connections'
    focused.ui.explorerView = 'structure'
    focused.ui.rightDrawer = 'none'
    return focused
  }

  const tab: QueryTabState = {
    id: createId('tab'),
    title: uniqueExplorerTabTitle(next, connection),
    tabKind: 'explorer',
    connectionId: connection.id,
    environmentId: connection.environmentIds[0] ?? next.environments[0]?.id ?? 'env-dev',
    family: connection.family,
    language: 'text',
    editorLabel: 'Explorer',
    queryText: '',
    status: 'idle',
    dirty: false,
    history: [],
  }

  const focused = upsertTab(next, tab)
  focused.ui.activeActivity = 'connections'
  focused.ui.activeSidebarPane = 'connections'
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
    environmentId ?? connection.environmentIds[0] ?? next.environments[0]?.id ?? 'env-dev'
  const existingMetricsTab = next.tabs.find(
    (tab) =>
      tab.connectionId === connection.id &&
      tab.environmentId === resolvedEnvironmentId &&
      tab.tabKind === 'metrics',
  )

  if (existingMetricsTab) {
    const focused = upsertTab(next, existingMetricsTab)
    focused.ui.activeActivity = 'connections'
    focused.ui.activeSidebarPane = 'connections'
    focused.ui.rightDrawer = 'none'
    return focused
  }

  const tab: QueryTabState = {
    id: createId('tab'),
    title: uniqueMetricsTabTitle(next, connection),
    tabKind: 'metrics',
    connectionId: connection.id,
    environmentId: resolvedEnvironmentId,
    family: connection.family,
    language: 'json',
    editorLabel: 'Metrics',
    queryText: '',
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
  focused.ui.activeActivity = 'connections'
  focused.ui.activeSidebarPane = 'connections'
  focused.ui.rightDrawer = 'none'
  return focused
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

  const targetLabel = normalizeScopedTargetLabel(request.target.label)
  const builderKind = scopedBuilderKind(connection, request.target)
  const legacyTitle = scopedQueryTitleCandidate(
    connection,
    targetLabel,
    builderKind === 'mongo-find',
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
      ? mongoFindQueryText(targetLabel, 50, connection.database)
      : builderKind === 'redis-key-browser'
        ? redisKeyBrowserQueryText(redisPatternFromTarget(request.target))
      : (request.target.queryTemplate ?? defaultQueryTextForConnection(connection))
  const tab: QueryTabState = {
    id: createId('tab'),
    title: uniqueScopedQueryTitle(next, connection, targetLabel, builderKind === 'mongo-find'),
    tabKind: 'query',
    connectionId: connection.id,
    environmentId:
      request.environmentId ?? connection.environmentIds[0] ?? next.environments[0]?.id ?? 'env-dev',
    family: connection.family,
    language: languageForConnection(connection),
    editorLabel: editorLabelForConnection(connection),
    queryText,
    scopedTarget: request.target,
    builderState:
      builderKind === 'mongo-find'
        ? {
            kind: 'mongo-find',
            collection: targetLabel,
            filters: [],
            projectionMode: 'all',
            projectionFields: [],
            sort: [],
            skip: 0,
            limit: 50,
            lastAppliedQueryText: queryText,
          }
        : builderKind === 'redis-key-browser'
          ? {
              kind: 'redis-key-browser',
              pattern: redisPatternFromTarget(request.target),
              typeFilter: 'all',
              cursor: '0',
              scanCount: 100,
              pageSize: 100,
              scannedCount: 0,
              expandedPrefixes: [],
              visibleColumns: ['ttl', 'memory', 'length'],
              viewMode: 'tree',
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

  if (
    (connection.engine === 'redis' || connection.engine === 'valkey') &&
    target.preferredBuilder === 'redis-key-browser'
  ) {
    return 'redis-key-browser'
  }

  return undefined
}

function uniqueExplorerTabTitle(snapshot: WorkspaceSnapshot, connection: ConnectionProfile) {
  const candidate = `Explorer - ${connection.name}`
  const titles = new Set(snapshot.tabs.map((tab) => tab.title))

  if (!titles.has(candidate)) {
    return candidate
  }

  let index = 2
  let title = `${candidate} ${index}`

  while (titles.has(title)) {
    index += 1
    title = `${candidate} ${index}`
  }

  return title
}

function uniqueMetricsTabTitle(snapshot: WorkspaceSnapshot, connection: ConnectionProfile) {
  const candidate = `Metrics - ${connection.name}`
  const titles = new Set(snapshot.tabs.map((tab) => tab.title))

  if (!titles.has(candidate)) {
    return candidate
  }

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
) {
  const candidate = scopedQueryTitleCandidate(connection, label, hasBuilder)
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
) {
  const extension = tabTitleParts(connection).extension
  return hasBuilder ? `${label}.find.${extension}` : `${label}.${extension}`
}



export function mongoFindQueryText(collection: string, limit: number, database?: string) {
  const trimmedDatabase = database?.trim()

  return JSON.stringify(
    {
      ...(trimmedDatabase ? { database: trimmedDatabase } : {}),
      collection,
      filter: {},
      limit,
    },
    null,
    2,
  )
}

export function redisKeyBrowserQueryText(pattern: string, count = 100) {
  return JSON.stringify(
    {
      mode: 'redis-key-browser',
      pattern,
      type: 'all',
      count,
    },
    null,
    2,
  )
}

function redisPatternFromTarget(target: ScopedQueryTarget) {
  const scopedPrefix = target.scope?.startsWith('prefix:')
    ? target.scope.replace('prefix:', '')
    : undefined
  const candidate = scopedPrefix || target.label || '*'

  if (candidate.includes('*')) {
    return candidate
  }

  if (candidate.endsWith(':')) {
    return `${candidate}*`
  }

  return candidate
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
