import type {
  ExecutionResultEnvelope,
  QueryTabState,
} from '@datapadplusplus/shared-types'

export function resultEditQueryText(
  activeTab: QueryTabState,
  result: ExecutionResultEnvelope | undefined,
) {
  const executedAt = result?.executedAt
  const exactHistoryEntry = executedAt
    ? activeTab.history.find((entry) => entry.executedAt === executedAt)
    : undefined

  return exactHistoryEntry?.queryText ?? activeTab.history[0]?.queryText ?? activeTab.queryText
}
