import type {
  ExecutionResponse,
  QueryExecutionPhase,
  QueryTabActiveExecution,
} from '@datapadplusplus/shared-types'
import type { AppActionContext, StateShape } from './app-state-types'

export const RESULT_RENDER_ACK_FALLBACK_MS = 3000

export function tabExecution(
  executionId: string,
  phase: QueryExecutionPhase,
  message?: string,
): QueryTabActiveExecution {
  return {
    executionId,
    phase,
    startedAt: new Date().toISOString(),
    message,
  }
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
      return
    }

    window.requestAnimationFrame(() => resolve())
  })
}

export function shouldWaitForVisibleResult(
  state: StateShape,
  tabId: string,
  execution: Pick<ExecutionResponse, 'result'>,
) {
  return Boolean(execution.result && isTabVisible(state, tabId))
}

export function isTabVisible(state: StateShape, tabId: string) {
  return state.payload?.snapshot.ui.activeTabId === tabId
}

export function scheduleResultRenderAckFallback(
  dispatch: AppActionContext['dispatch'],
  tabId: string,
  executionId: string,
) {
  const schedule = globalThis.setTimeout ?? setTimeout
  schedule(() => {
    dispatch({
      type: 'EXECUTION_DISPLAYED',
      tabId,
      executionId,
    })
  }, RESULT_RENDER_ACK_FALLBACK_MS)
}
