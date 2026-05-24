import type {
  BootstrapPayload,
  ExplorerRequest,
  ExplorerResponse,
  ResultPageResponse,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import { createId } from './helpers'
import type {
  AppAction,
  ExplorerCacheEntry,
  WorkbenchMessage,
  WorkbenchMessageSeverity,
} from './app-state-types'

const ROOT_EXPLORER_SCOPE = '__root__'

export function explorerCacheKey(connectionId: string, environmentId: string) {
  return `${connectionId}::${environmentId}`
}

export function explorerScopeKey(scope: string | undefined) {
  return scope?.trim() || ROOT_EXPLORER_SCOPE
}

export function explorerRequestKey(request: ExplorerRequest) {
  return `${explorerCacheKey(request.connectionId, request.environmentId)}::${explorerScopeKey(
    request.scope,
  )}`
}

export function isExplorerRequestLoading(
  loadingRequests: Record<string, string> | undefined,
  connectionId: string | undefined,
  environmentId: string | undefined,
  scope?: string,
) {
  if (!loadingRequests || !connectionId || !environmentId) {
    return false
  }

  return Boolean(
    loadingRequests[
      explorerRequestKey({
        connectionId,
        environmentId,
        scope,
      })
    ],
  )
}

export function hasExplorerScope(
  entry: ExplorerCacheEntry | undefined,
  scope?: string,
) {
  return Boolean(entry?.scopes[explorerScopeKey(scope)])
}

export function mergeExplorerCacheEntry(
  current: ExplorerCacheEntry | undefined,
  incoming: ExplorerResponse,
): ExplorerCacheEntry {
  const scopeKey = explorerScopeKey(incoming.scope)
  const scopes =
    current &&
    current.connectionId === incoming.connectionId &&
    current.environmentId === incoming.environmentId
      ? {
          ...current.scopes,
          [scopeKey]: incoming,
        }
      : {
          [scopeKey]: incoming,
        }
  const nodesById = new Map<string, ExplorerResponse['nodes'][number]>()
  const scopedResponses = [
    scopes[ROOT_EXPLORER_SCOPE],
    ...Object.entries(scopes)
      .filter(([key]) => key !== ROOT_EXPLORER_SCOPE)
      .map(([, response]) => response),
  ].filter((response): response is ExplorerResponse => Boolean(response))

  for (const response of scopedResponses) {
    for (const node of response.nodes) {
      nodesById.set(node.id, node)
    }
  }

  return {
    connectionId: incoming.connectionId,
    environmentId: incoming.environmentId,
    scopes,
    response: {
      ...incoming,
      scope: undefined,
      nodes: Array.from(nodesById.values()),
    },
  }
}

export function createWorkbenchMessage(
  message: string,
  source = 'Workbench',
  severity: WorkbenchMessageSeverity = 'error',
  details?: string,
): WorkbenchMessage {
  return {
    id: createId('msg'),
    severity,
    message,
    source,
    createdAt: new Date().toISOString(),
    details,
  }
}

export function openMessagesPayload(payload: BootstrapPayload | undefined) {
  if (!payload) {
    return payload
  }

  const next = clonePayload(payload)
  next.snapshot.ui.bottomPanelVisible = true
  next.snapshot.ui.activeBottomPanelTab = 'messages'
  next.snapshot.updatedAt = new Date().toISOString()
  return next
}

export function applyExecutionToPayload(
  payload: BootstrapPayload | undefined,
  execution: Extract<AppAction, { type: 'EXECUTION_READY' }>['execution'],
): BootstrapPayload | undefined {
  if (!payload) {
    return payload
  }

  const next = clonePayload(payload)
  const index = next.snapshot.tabs.findIndex((item) => item.id === execution.tab.id)

  if (index >= 0) {
    const currentTab = next.snapshot.tabs[index]
    next.snapshot.tabs[index] = {
      ...execution.tab,
      dirty: currentTab?.dirty ?? execution.tab.dirty,
    }
  } else {
    next.snapshot.tabs.push(execution.tab)
  }

  next.snapshot.guardrails = [execution.guardrail]
  next.snapshot.ui.activeTabId = execution.tab.id
  next.snapshot.ui.activeConnectionId = execution.tab.connectionId
  next.snapshot.ui.activeEnvironmentId = execution.tab.environmentId
  next.snapshot.ui.bottomPanelVisible = true
  next.snapshot.ui.activeBottomPanelTab = execution.result ? 'results' : 'messages'
  next.snapshot.updatedAt = new Date().toISOString()
  return next
}

export function markTabExecutionLoading(
  payload: BootstrapPayload | undefined,
  tabId: string | undefined,
): BootstrapPayload | undefined {
  if (!payload || !tabId) {
    return payload
  }

  const next = clonePayload(payload)
  const tab = next.snapshot.tabs.find((item) => item.id === tabId)

  if (!tab) {
    return payload
  }

  tab.status = 'running'
  tab.error = undefined
  next.snapshot.ui.activeTabId = tab.id
  next.snapshot.updatedAt = new Date().toISOString()
  return next
}

export function markTabExecutionFailed(
  payload: BootstrapPayload | undefined,
  tabId: string | undefined,
  message: string,
): BootstrapPayload | undefined {
  if (!payload || !tabId) {
    return payload
  }

  const next = clonePayload(payload)
  const tab = next.snapshot.tabs.find((item) => item.id === tabId)

  if (!tab) {
    return payload
  }

  tab.status = 'error'
  tab.error = {
    code: 'execution-error',
    message,
  }
  next.snapshot.updatedAt = new Date().toISOString()
  return next
}

export function applyResultPageToPayload(
  payload: BootstrapPayload | undefined,
  page: ResultPageResponse,
): BootstrapPayload | undefined {
  if (!payload) {
    return payload
  }

  const next = clonePayload(payload)
  const tab = next.snapshot.tabs.find((item) => item.id === page.tabId)

  if (!tab?.result) {
    return next
  }

  const payloadIndex = tab.result.payloads.findIndex(
    (item) => item.renderer === page.payload.renderer,
  )

  let mergedPayload = page.payload

  if (payloadIndex < 0) {
    tab.result.payloads.push(page.payload)
  } else {
    const currentPayload = tab.result.payloads[payloadIndex]

    if (currentPayload) {
      mergedPayload = mergeResultPayload(currentPayload, page.payload)
      tab.result.payloads[payloadIndex] = mergedPayload
    }
  }

  tab.result.pageInfo = {
    ...page.pageInfo,
    bufferedRows: resultPayloadSize(mergedPayload),
  }
  tab.result.truncated = page.pageInfo.hasMore
  tab.result.continuationToken = page.pageInfo.nextCursor
  tab.result.notices = [
    ...tab.result.notices,
    ...page.notices.map((message) => ({
      code: 'result-page',
      level: 'info' as const,
      message,
    })),
  ]
  next.snapshot.ui.bottomPanelVisible = true
  next.snapshot.ui.activeBottomPanelTab = 'results'
  next.snapshot.updatedAt = new Date().toISOString()
  return next
}

export function mergeExplorerResponse(
  current: ExplorerResponse | undefined,
  incoming: ExplorerResponse,
): ExplorerResponse {
  if (
    !current ||
    current.connectionId !== incoming.connectionId ||
    current.environmentId !== incoming.environmentId
  ) {
    return incoming
  }

  const mergedNodes = new Map(current.nodes.map((node) => [node.id, node]))

  for (const node of incoming.nodes) {
    mergedNodes.set(node.id, node)
  }

  return {
    ...incoming,
    summary: incoming.summary,
    nodes: Array.from(mergedNodes.values()),
  }
}

function clonePayload(payload: BootstrapPayload): BootstrapPayload {
  return JSON.parse(JSON.stringify(payload)) as BootstrapPayload
}

function mergeResultPayload(current: ResultPayload, incoming: ResultPayload): ResultPayload {
  if (current.renderer === 'table' && incoming.renderer === 'table') {
    return {
      ...current,
      columns: current.columns.length ? current.columns : incoming.columns,
      rows: [...current.rows, ...incoming.rows],
    }
  }

  if (current.renderer === 'document' && incoming.renderer === 'document') {
    return {
      ...current,
      documents: [...current.documents, ...incoming.documents],
    }
  }

  if (current.renderer === 'keyvalue' && incoming.renderer === 'keyvalue') {
    return {
      ...current,
      entries: {
        ...current.entries,
        ...incoming.entries,
      },
      ttl: incoming.ttl ?? current.ttl,
      memoryUsage: incoming.memoryUsage ?? current.memoryUsage,
    }
  }

  if (current.renderer === 'schema' && incoming.renderer === 'schema') {
    return {
      ...current,
      items: [...current.items, ...incoming.items],
    }
  }

  return incoming
}

function resultPayloadSize(payload: ResultPayload) {
  if (payload.renderer === 'table') {
    return payload.rows.length
  }

  if (payload.renderer === 'document') {
    return payload.documents.length
  }

  if (payload.renderer === 'keyvalue') {
    return Object.keys(payload.entries).length
  }

  if (payload.renderer === 'schema') {
    return payload.items.length
  }

  return 1
}
