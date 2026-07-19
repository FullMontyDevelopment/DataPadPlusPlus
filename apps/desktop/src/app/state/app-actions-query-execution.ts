import { startTransition, useCallback, useMemo } from 'react'
import type { ExecutionRequest } from '@datapadplusplus/shared-types'
import { desktopClient } from '../../services/runtime/client'
import type { ConnectionHealthSource } from './connection-health'
import { ensureWorkspaceUnlocked } from './app-state-factories'
import { toUserError } from './app-state-selectors'
import { createId } from './helpers'
import type { Actions, AppActionContext } from './app-state-types'
import {
  nextFrame,
  scheduleResultRenderAckFallback,
  shouldWaitForVisibleResult,
  tabExecution,
  waitForMinimumExecutionActivity,
} from './app-actions-execution-utils'

type QueryExecutionActions = Pick<Actions, 'executeQuery' | 'executeBuilderCount'>

interface QueryExecutionActionContext
  extends Pick<AppActionContext, 'stateRef' | 'dispatch' | 'handleError'> {
  recordConnected(
    connectionId: string,
    environmentId: string,
    source: ConnectionHealthSource,
    message?: string,
    durationMs?: number,
  ): void
  recordIssue(
    connectionId: string,
    environmentId: string,
    source: ConnectionHealthSource,
    message: string,
  ): void
}

export function useQueryExecutionActions({
  stateRef,
  dispatch,
  handleError,
  recordConnected,
  recordIssue,
}: QueryExecutionActionContext): QueryExecutionActions {
  const executeQuery = useCallback<Actions['executeQuery']>(
    async (
      tabId,
      mode = 'full',
      confirmedGuardrailId,
      overrideQueryText,
      executionInputMode,
      scriptText,
      documentEfficiencyMode,
      selectedText,
      builderState,
    ) => {
      const executionId = createId('execution')
      const activityStartedAt = Date.now()
      let activityStarted = false
      try {
        const latest = stateRef.current
        if (!latest.payload) {
          throw new Error('Workspace is not ready for query execution.')
        }
        ensureWorkspaceUnlocked(latest.payload)

        const tab = latest.payload.snapshot.tabs.find((item) => item.id === tabId)
        if (!tab) {
          throw new Error('Query tab was not found.')
        }

        const executionRequest: ExecutionRequest = {
          executionId,
          tabId: tab.id,
          connectionId: tab.connectionId,
          environmentId: tab.environmentId,
          language: tab.language,
          queryText: overrideQueryText ?? tab.queryText,
          executionInputMode,
          scriptText,
          selectedText: selectedText?.trim() ? selectedText : undefined,
          mode,
          rowLimit: 500,
          documentEfficiencyMode,
          confirmedGuardrailId,
          builderState,
        }

        dispatch({
          type: 'EXECUTION_LOADING',
          tabId,
          execution: tabExecution(executionId, 'server'),
        })
        activityStarted = true
        await nextFrame()
        const execution = await desktopClient.executeQuery(executionRequest)
        const executionWithId = { ...execution, executionId }
        if (executionWithId.result) {
          dispatch({ type: 'EXECUTION_PHASE', tabId, executionId, phase: 'rendering' })
          await nextFrame()
        }
        await waitForMinimumExecutionActivity(activityStartedAt)
        const waitForDisplay = shouldWaitForVisibleResult(
          stateRef.current,
          tabId,
          executionWithId,
        )
        startTransition(() => {
          dispatch({
            type: 'EXECUTION_READY',
            execution: executionWithId,
            request: executionRequest,
            waitForDisplay,
          })
          if (executionWithId.persistenceWarning) {
            dispatch({
              type: 'WORKBENCH_MESSAGE_ADDED',
              openMessages: false,
              message: {
                id: createId('message'),
                severity: 'warning',
                message: executionWithId.persistenceWarning.message,
                source: 'Workspace persistence',
                createdAt: new Date().toISOString(),
                details: executionWithId.persistenceWarning.code,
              },
            })
          }
        })
        if (waitForDisplay) {
          scheduleResultRenderAckFallback(dispatch, tabId, executionId)
        }
        recordConnected(
          executionRequest.connectionId,
          executionRequest.environmentId,
          'query',
          'Query completed',
          executionWithId.result?.durationMs,
        )
      } catch (error) {
        const userError = toUserError(error, 'Query execution failed.')
        if (activityStarted) {
          await waitForMinimumExecutionActivity(activityStartedAt)
        }
        dispatch({
          type: 'EXECUTION_FAILED',
          tabId,
          executionId,
          code: userError.code,
          message: userError.message,
        })
        const latestTab = stateRef.current.payload?.snapshot.tabs.find((item) => item.id === tabId)
        if (latestTab) {
          recordIssue(
            latestTab.connectionId,
            latestTab.environmentId,
            'query',
            userError.message,
          )
        }
        handleError(error, { suppressWorkbenchMessage: true })
      }
    },
    [dispatch, handleError, recordConnected, recordIssue, stateRef],
  )

  const executeBuilderCount = useCallback<Actions['executeBuilderCount']>(
    async ({ tabId, builderState, queryText, countQueryText }) => {
      await executeQuery(
        tabId,
        'count',
        undefined,
        queryText,
        'builder',
        undefined,
        false,
        countQueryText,
        builderState,
      )
    },
    [executeQuery],
  )

  return useMemo(
    () => ({ executeQuery, executeBuilderCount }),
    [executeBuilderCount, executeQuery],
  )
}
