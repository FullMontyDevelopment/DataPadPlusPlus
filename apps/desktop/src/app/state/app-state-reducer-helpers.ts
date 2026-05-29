import type {
  BootstrapPayload,
  ExplorerRequest,
  ExplorerResponse,
  QueryTabActiveExecution,
  ResultPageResponse,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import { withDisplayTiming, withServerTiming } from './app-state-execution-payload'
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
  options: { waitForDisplay?: boolean } = {},
): BootstrapPayload | undefined {
  if (!payload) {
    return payload
  }

  const next = clonePayload(payload)
  const index = next.snapshot.tabs.findIndex((item) => item.id === execution.tab.id)

  const executionTab = {
    ...execution.tab,
    result: execution.tab.result
      ? withServerTiming({
          ...execution.tab.result,
          payloads: execution.tab.result.payloads.map((item) =>
            normalizeResultPayload(item, execution.tab.result?.defaultRenderer)),
        })
      : execution.tab.result,
  }
  const isActiveTab = next.snapshot.ui.activeTabId === executionTab.id
  const shouldWaitForDisplay = Boolean(
    options.waitForDisplay && executionTab.result && isActiveTab,
  )

  if (index >= 0) {
    const currentTab = next.snapshot.tabs[index]
    const result =
      executionTab.result && !shouldWaitForDisplay
        ? withDisplayTiming(
            executionTab.result,
            currentTab?.activeExecution?.startedAt,
          )
        : executionTab.result
    next.snapshot.tabs[index] = {
      ...executionTab,
      result,
      title: currentTab?.title ?? executionTab.title,
      editorLabel: currentTab?.editorLabel ?? executionTab.editorLabel,
      pinned: currentTab?.pinned ?? executionTab.pinned,
      saveTarget: currentTab?.saveTarget ?? executionTab.saveTarget,
      savedQueryId: currentTab?.savedQueryId ?? executionTab.savedQueryId,
      queryText: currentTab?.queryText ?? executionTab.queryText,
      queryViewMode: currentTab?.queryViewMode ?? executionTab.queryViewMode,
      scriptText: currentTab?.scriptText ?? executionTab.scriptText,
      builderState: currentTab?.builderState ?? executionTab.builderState,
      dirty: currentTab?.dirty ?? executionTab.dirty,
      status: shouldWaitForDisplay ? 'running' : executionTab.status,
      activeExecution: shouldWaitForDisplay
        ? {
            executionId: execution.executionId,
            phase: 'rendering',
            startedAt: currentTab?.activeExecution?.startedAt ?? new Date().toISOString(),
          }
        : undefined,
    }
  } else {
    next.snapshot.tabs.push({
      ...executionTab,
      activeExecution: undefined,
    })
  }

  next.snapshot.guardrails = [execution.guardrail]
  if (isActiveTab) {
    next.snapshot.ui.activeConnectionId = executionTab.connectionId
    next.snapshot.ui.activeEnvironmentId = executionTab.environmentId
    next.snapshot.ui.bottomPanelVisible = true
    next.snapshot.ui.activeBottomPanelTab = executionTab.result ? 'results' : 'messages'
  }
  next.snapshot.updatedAt = new Date().toISOString()
  return next
}

export function markTabExecutionLoading(
  payload: BootstrapPayload | undefined,
  tabId: string | undefined,
  execution: QueryTabActiveExecution,
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
  tab.activeExecution = execution
  next.snapshot.updatedAt = new Date().toISOString()
  return next
}

export function markTabExecutionPhase(
  payload: BootstrapPayload | undefined,
  tabId: string | undefined,
  executionId: string,
  phase: QueryTabActiveExecution['phase'],
  message?: string,
): BootstrapPayload | undefined {
  if (!payload || !tabId) {
    return payload
  }

  const next = clonePayload(payload)
  const tab = next.snapshot.tabs.find((item) => item.id === tabId)

  if (!tab?.activeExecution || tab.activeExecution.executionId !== executionId) {
    return payload
  }

  tab.status = 'running'
  tab.activeExecution = {
    ...tab.activeExecution,
    phase,
    message,
  }
  next.snapshot.updatedAt = new Date().toISOString()
  return next
}

export function markTabExecutionDisplayed(
  payload: BootstrapPayload | undefined,
  tabId: string | undefined,
  executionId: string,
): BootstrapPayload | undefined {
  if (!payload || !tabId) {
    return payload
  }

  const next = clonePayload(payload)
  const tab = next.snapshot.tabs.find((item) => item.id === tabId)

  if (!tab?.activeExecution || tab.activeExecution.executionId !== executionId) {
    return payload
  }

  const phase = tab.activeExecution.phase
  const startedAt = tab.activeExecution.startedAt
  tab.activeExecution = undefined
  if (phase === 'rendering' || phase === 'paging') {
    tab.status = tab.error ? 'error' : 'success'
  }
  if (tab.result) {
    tab.result = withDisplayTiming(tab.result, startedAt)
  }
  next.snapshot.updatedAt = new Date().toISOString()
  return next
}

export function markTabExecutionFailed(
  payload: BootstrapPayload | undefined,
  tabId: string | undefined,
  message: string,
  executionId?: string,
): BootstrapPayload | undefined {
  if (!payload || !tabId) {
    return payload
  }

  const next = clonePayload(payload)
  const tab = next.snapshot.tabs.find((item) => item.id === tabId)

  if (!tab) {
    return payload
  }
  if (executionId && tab.activeExecution?.executionId !== executionId) {
    return payload
  }

  tab.status = 'error'
  tab.activeExecution = undefined
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
  options: { executionId?: string; waitForDisplay?: boolean } = {},
): BootstrapPayload | undefined {
  if (!payload) {
    return payload
  }

  const next = clonePayload(payload)
  const tab = next.snapshot.tabs.find((item) => item.id === page.tabId)

  if (!tab?.result) {
    return next
  }
  if (
    options.executionId &&
    tab.activeExecution &&
    tab.activeExecution.executionId !== options.executionId
  ) {
    return payload
  }

  const incomingPayload = normalizeResultPayload(
    page.payload,
    tab.result.defaultRenderer,
  )
  const payloadIndex = tab.result.payloads.findIndex(
    (item) => item.renderer === incomingPayload.renderer,
  )

  let mergedPayload = incomingPayload

  if (payloadIndex < 0) {
    tab.result.payloads.push(incomingPayload)
  } else {
    const existingPayload = tab.result.payloads[payloadIndex]
    if (existingPayload) {
      const currentPayload = normalizeResultPayload(
        existingPayload,
        incomingPayload.renderer,
      )
      mergedPayload = mergeResultPayload(currentPayload, incomingPayload)
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
  const isActiveTab = next.snapshot.ui.activeTabId === tab.id
  const shouldWaitForDisplay = Boolean(options.waitForDisplay && isActiveTab)
  if (shouldWaitForDisplay && options.executionId) {
    tab.status = 'running'
    tab.activeExecution = {
      executionId: options.executionId,
      phase: 'paging',
      startedAt: tab.activeExecution?.startedAt ?? new Date().toISOString(),
    }
  } else {
    tab.status = tab.error ? 'error' : 'success'
    if (tab.result) {
      tab.result = withDisplayTiming(tab.result, tab.activeExecution?.startedAt)
    }
    tab.activeExecution = undefined
  }
  if (isActiveTab) {
    next.snapshot.ui.bottomPanelVisible = true
    next.snapshot.ui.activeBottomPanelTab = 'results'
  }
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
      columns: arrayValue<string>(current.columns).length
        ? arrayValue<string>(current.columns)
        : arrayValue<string>(incoming.columns),
      rows: [...arrayValue<string[]>(current.rows), ...arrayValue<string[]>(incoming.rows)],
    }
  }

  if (current.renderer === 'document' && incoming.renderer === 'document') {
    return {
      ...current,
      documents: [
        ...arrayValue<Record<string, unknown>>(current.documents),
        ...arrayValue<Record<string, unknown>>(incoming.documents),
      ],
    }
  }

  if (current.renderer === 'keyvalue' && incoming.renderer === 'keyvalue') {
    const currentEntries = stringRecordValue(current.entries)
    const incomingEntries = stringRecordValue(incoming.entries)
    return {
      ...current,
      entries: {
        ...currentEntries,
        ...incomingEntries,
      },
      ttl: incoming.ttl ?? current.ttl,
      memoryUsage: incoming.memoryUsage ?? current.memoryUsage,
    }
  }

  if (current.renderer === 'schema' && incoming.renderer === 'schema') {
    return {
      ...current,
      items: [
        ...schemaItemsValue(current.items),
        ...schemaItemsValue(incoming.items),
      ],
    }
  }

  return incoming
}

function normalizeResultPayload(
  payload: unknown,
  fallbackRenderer: string = 'raw',
): ResultPayload {
  const record = recordValue(payload)
  const renderer = typeof record.renderer === 'string'
    ? record.renderer
    : fallbackRenderer

  if (renderer === 'table') {
    return {
      ...record,
      renderer,
      columns: arrayValue<string>(record.columns),
      rows: arrayValue<string[]>(record.rows),
    }
  }

  if (renderer === 'document') {
    return {
      ...record,
      renderer,
      documents: arrayValue<Record<string, unknown>>(record.documents),
    }
  }

  if (renderer === 'keyvalue') {
    return {
      ...record,
      renderer,
      entries: stringRecordValue(record.entries),
    }
  }

  if (renderer === 'schema') {
    return {
      ...record,
      renderer,
      items: schemaItemsValue(record.items),
    }
  }

  if (renderer === 'raw' || renderer === 'resp') {
    return {
      ...record,
      renderer,
      text: typeof record.text === 'string' ? record.text : '',
    } as ResultPayload
  }

  if (typeof record.renderer !== 'string') {
    return fallbackResultPayload(renderer)
  }

  return {
    ...record,
    renderer,
  } as ResultPayload
}

function resultPayloadSize(payload: ResultPayload) {
  if (payload.renderer === 'table') {
    return arrayValue(payload.rows).length
  }

  if (payload.renderer === 'document') {
    return arrayValue(payload.documents).length
  }

  if (payload.renderer === 'keyvalue') {
    return Object.keys(recordValue(payload.entries)).length
  }

  if (payload.renderer === 'schema') {
    return arrayValue(payload.items).length
  }

  return 1
}

function arrayValue<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function fallbackResultPayload(renderer: string): ResultPayload {
  if (renderer === 'table') {
    return {
      renderer: 'table',
      columns: [],
      rows: [],
    }
  }

  if (renderer === 'document') {
    return {
      renderer: 'document',
      documents: [],
    }
  }

  if (renderer === 'keyvalue') {
    return {
      renderer: 'keyvalue',
      entries: {},
    }
  }

  if (renderer === 'schema') {
    return {
      renderer: 'schema',
      items: [],
    }
  }

  return {
    renderer: 'raw',
    text: '',
  }
}

function stringRecordValue(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(recordValue(value)).map(([key, entry]) => [key, String(entry ?? '')]),
  )
}

function schemaItemsValue(
  value: unknown,
): Extract<ResultPayload, { renderer: 'schema' }>['items'] {
  return arrayValue<Partial<Extract<ResultPayload, { renderer: 'schema' }>['items'][number]>>(
    value,
  )
    .filter(
      (
        item,
      ): item is Extract<ResultPayload, { renderer: 'schema' }>['items'][number] =>
        typeof item.label === 'string' && typeof item.detail === 'string',
    )
    .map((item) => ({
      label: item.label,
      detail: item.detail,
    }))
}
