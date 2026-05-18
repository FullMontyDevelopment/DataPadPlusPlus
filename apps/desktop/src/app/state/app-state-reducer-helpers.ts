import type {
  BootstrapPayload,
  ExplorerResponse,
  ResultPageResponse,
  ResultPayload,
} from '@datapadplusplus/shared-types'
import { createId } from './helpers'
import type { AppAction, WorkbenchMessage, WorkbenchMessageSeverity } from './app-state-types'

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
    next.snapshot.tabs[index] = execution.tab
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
