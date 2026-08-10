import { useEffect, useRef } from 'react'
import type { QueryTabActiveExecution } from '@datapadplusplus/shared-types'
import { setTaskbarQueryActivity } from '../../services/runtime/desktop-bridge'

type ExecutionsByTab = Record<string, QueryTabActiveExecution>

export function runningWorkbenchQueryCount(executionsByTab: ExecutionsByTab) {
  return Object.keys(executionsByTab).length
}

export function useTaskbarQueryActivity(executionsByTab: ExecutionsByTab, enabled = true) {
  const runningCount = runningWorkbenchQueryCount(executionsByTab)
  const indicatorCount = runningCount > 0 ? 1 : 0
  const activeRef = useRef(false)

  useEffect(() => {
    activeRef.current = enabled && indicatorCount > 0
  }, [enabled, indicatorCount])

  useEffect(() => {
    if (enabled) {
      void setTaskbarQueryActivity(indicatorCount)
    }
  }, [enabled, indicatorCount])

  useEffect(
    () => () => {
      if (enabled && activeRef.current) {
        void setTaskbarQueryActivity(0)
      }
    },
    [enabled],
  )
}
