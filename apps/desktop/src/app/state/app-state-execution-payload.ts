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
  const next = clonePayload(incoming)
  const currentTabsById = new Map(
    (current?.snapshot.tabs ?? []).map((tab) => [tab.id, tab]),
  )

  next.snapshot.tabs = next.snapshot.tabs.map((tab) => {
    const currentTab = currentTabsById.get(tab.id)
    const activeExecution = executionsByTab[tab.id] ?? currentTab?.activeExecution

    if (!activeExecution) {
      return preserveResultDisplayTiming(tab, currentTab)
    }

    return preserveResultDisplayTiming(
      {
        ...tab,
        status: 'running',
        error: undefined,
        activeExecution,
      },
      currentTab,
    )
  })

  return next
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

function clonePayload(payload: BootstrapPayload): BootstrapPayload {
  return JSON.parse(JSON.stringify(payload)) as BootstrapPayload
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
