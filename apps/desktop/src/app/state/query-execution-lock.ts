import type {
  QueryTabActiveExecution,
  QueryTabState,
} from '@datapadplusplus/shared-types'

export function isQueryTabExecutionLocked(
  tab: QueryTabState | undefined,
  execution?: QueryTabActiveExecution,
) {
  return Boolean(execution ?? tab?.activeExecution) || tab?.status === 'queued'
}
