import { useEffect, useRef } from 'react'
import type { QueryTabActiveExecution } from '@datapadplusplus/shared-types'
import { setTaskbarQueryActivity } from '../../services/runtime/desktop-bridge'

type ExecutionsByTab = Record<string, QueryTabActiveExecution>

export function runningWorkbenchQueryCount(executionsByTab: ExecutionsByTab) {
  return Object.keys(executionsByTab).length
}

export function useTaskbarQueryActivity(executionsByTab: ExecutionsByTab) {
  const runningCount = runningWorkbenchQueryCount(executionsByTab)
  const indicatorCount = runningCount > 0 ? 1 : 0
  const activeRef = useRef(false)

  useEffect(() => {
    activeRef.current = indicatorCount > 0
  }, [indicatorCount])

  useEffect(() => {
    void setTaskbarQueryActivity(indicatorCount)
  }, [indicatorCount])

  useEffect(
    () => () => {
      if (activeRef.current) {
        void setTaskbarQueryActivity(0)
      }
    },
    [],
  )
}
