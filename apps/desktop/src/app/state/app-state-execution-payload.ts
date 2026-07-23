import type {
  BootstrapPayload,
  ExecutionResultEnvelope,
  QueryTabActiveExecution,
  QueryTabState,
} from '@datapadplusplus/shared-types'

export function preserveActiveExecutionsOnPayload(
  incoming: BootstrapPayload,
  current: BootstrapPayload | undefined,
  executionsByTab: Record<string, QueryTabActiveExecution>,
): BootstrapPayload {
  const next: BootstrapPayload = {
    ...incoming,
    snapshot: {
      ...incoming.snapshot,
      tabs: incoming.snapshot.tabs.map((tab) => ({ ...tab })),
    },
  }
  const currentTabsById = new Map(
    (current?.snapshot.tabs ?? []).map((tab) => [tab.id, tab]),
  )

  next.snapshot.tabs = next.snapshot.tabs.map((tab) => {
    const currentTab = currentTabsById.get(tab.id)
    const transientResultId = incoming.transientResultIds?.[tab.id]
    const tabWithResultReference =
      transientResultId && currentTab?.result?.id === transientResultId
        ? { ...tab, result: currentTab.result }
        : tab
    const tabWithNewestResult = preserveNewerExecutionState(
      tabWithResultReference,
      currentTab,
    )
    const activeExecution = executionsByTab[tab.id] ?? currentTab?.activeExecution

    if (!activeExecution) {
      return preserveResultDisplayTiming(tabWithNewestResult, currentTab)
    }

    return preserveResultDisplayTiming(
      {
        ...tabWithNewestResult,
        status: 'running',
        error: undefined,
        activeExecution,
      },
      currentTab,
    )
  })

  return next
}

function preserveNewerExecutionState(
  incoming: QueryTabState,
  current: QueryTabState | undefined,
): QueryTabState {
  if (!current || current.result?.id === incoming.result?.id) {
    return incoming
  }

  const currentRunAt = executionTimestamp(current)
  const incomingRunAt = executionTimestamp(incoming)
  if (currentRunAt === undefined || (incomingRunAt !== undefined && incomingRunAt >= currentRunAt)) {
    return incoming
  }

  return {
    ...incoming,
    status: current.status,
    lastRunAt: current.lastRunAt,
    error: current.error,
    result: current.result,
    history: current.history,
  }
}

function executionTimestamp(tab: QueryTabState) {
  const value = tab.lastRunAt ?? tab.result?.executedAt
  if (!value) {
    return undefined
  }

  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
}

export function withServerTiming(result: ExecutionResultEnvelope): ExecutionResultEnvelope {
  return {
    ...result,
    serverDurationMs: result.serverDurationMs ?? result.durationMs,
  }
}

export function withDisplayTiming(
  result: ExecutionResultEnvelope,
  startedAt: string | undefined,
): ExecutionResultEnvelope {
  const displayDurationMs = durationSince(startedAt)

  if (displayDurationMs === undefined) {
    return withServerTiming(result)
  }

  return {
    ...result,
    serverDurationMs: result.serverDurationMs ?? result.durationMs,
    displayDurationMs,
    durationMs: displayDurationMs,
  }
}

function preserveResultDisplayTiming(
  tab: QueryTabState,
  currentTab: QueryTabState | undefined,
): QueryTabState {
  if (!tab.result || !currentTab?.result || tab.result.id !== currentTab.result.id) {
    return tab
  }

  const displayDurationMs = currentTab.result.displayDurationMs
  const serverDurationMs = currentTab.result.serverDurationMs

  return {
    ...tab,
    result: {
      ...tab.result,
      serverDurationMs: tab.result.serverDurationMs ?? serverDurationMs,
      displayDurationMs: tab.result.displayDurationMs ?? displayDurationMs,
      durationMs: tab.result.displayDurationMs ?? displayDurationMs ?? tab.result.durationMs,
    },
  }
}

function durationSince(startedAt: string | undefined) {
  if (!startedAt) {
    return undefined
  }

  const startedAtMs = Date.parse(startedAt)

  if (!Number.isFinite(startedAtMs)) {
    return undefined
  }

  return Math.max(0, Date.now() - startedAtMs)
}
