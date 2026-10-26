import { startTransition, useCallback, useMemo, useRef } from 'react'
import type { ExecutionRequest } from '@datapadplusplus/shared-types'
import { effectiveQueryBatchSize } from '@datapadplusplus/shared-types'
import { desktopClient } from '../../services/runtime/client'
import { listenScriptProgress } from '../../services/runtime/script-progress'
import { tabEnvironmentConflict } from '../../services/runtime/library-connection-helpers'
import type { ConnectionHealthSource } from './connection-health'
import { ensureWorkspaceUnlocked } from './app-state-factories'
import { toUserError } from './app-state-selectors'
import { createId } from './helpers'
import type { Actions, AppActionContext } from './app-state-types'
import { isQueryTabExecutionLocked } from './query-execution-lock'
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
  const dispatchingTabsRef = useRef(new Set<string>())
  const consumedApprovalsRef = useRef(new Set<string>())
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
      datastoreExecutionInput,
      confirmedRequest,
    ) => {
      if (dispatchingTabsRef.current.has(tabId)) {
        return
      }

      const executionId = createId('execution')
      const activityStartedAt = Date.now()
      let activityStarted = false
      let stopProgress: (() => void) | undefined
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
        const environmentConflict = tabEnvironmentConflict(latest.payload.snapshot, tab)
        if (environmentConflict) throw new Error(environmentConflict.message)
        if (isQueryTabExecutionLocked(tab, latest.executionsByTab[tabId])) {
          return
        }
        if (confirmedRequest) {
          if (!confirmedGuardrailId || consumedApprovalsRef.current.has(confirmedGuardrailId)) return
          if (latest.lastExecutionRequest?.executionId !== confirmedRequest.executionId) throw new Error('The pending execution changed. Run again to review the current request.')
          if (tab.connectionId !== confirmedRequest.connectionId || tab.environmentId !== confirmedRequest.environmentId ||
            JSON.stringify(tab.sqlScope) !== JSON.stringify(confirmedRequest.sqlScope) ||
            JSON.stringify(tab.scopedTarget) !== JSON.stringify(confirmedRequest.scopedTarget)) {
            throw new Error('The query target changed. Run it again to review the new target.')
          }
          consumedApprovalsRef.current.add(confirmedGuardrailId)
        }
        dispatchingTabsRef.current.add(tabId)

        const executionRequest: ExecutionRequest = {
          tabId: tab.id,
          connectionId: tab.connectionId,
          environmentId: tab.environmentId,
          language: tab.language,
          queryText: overrideQueryText ?? tab.queryText,
          executionInputMode,
          scriptText,
          selectedText: selectedText?.trim() ? selectedText : undefined,
          mode,
          rowLimit: effectiveQueryBatchSize(latest.payload.snapshot.preferences.queryResults, tab.queryFetchBatchSize),
          documentEfficiencyMode,
          builderState,
          scopedTarget: tab.scopedTarget,
          sqlScope: tab.sqlScope,
          datastoreExecutionInput,
          ...(confirmedRequest ?? {}),
          executionId,
          confirmedGuardrailId,
        }

        dispatch({
          type: 'EXECUTION_LOADING',
          tabId,
          execution: tabExecution(executionId, 'server'),
        })
        activityStarted = true
        if (executionRequest.executionInputMode === 'script') {
          stopProgress = await listenScriptProgress(progress => {
            if (progress.executionId !== executionId || progress.tabId !== tabId || stateRef.current.payload?.snapshot.lockState.isLocked ||
              stateRef.current.workspaceSwitcherStatus?.activeWorkspaceId !== latest.workspaceSwitcherStatus?.activeWorkspaceId) return
            dispatch({ type: 'EXECUTION_PHASE', tabId, executionId, phase: 'server', message: `Operation ${progress.sequence}: ${progress.method} — ${progress.status}` })
            if (progress.console) dispatch({ type: 'WORKBENCH_MESSAGE_ADDED', openMessages: false, message: {
              id: `script-console-${executionId}`, severity: 'info', source: 'Script console',
              message: progress.console, createdAt: new Date().toISOString(),
            } })
          })
        }
        await nextFrame()
        const execution = await desktopClient.executeQuery(executionRequest)
        stopProgress?.()
        stopProgress = undefined
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
        const invalidatesOracleMetadata = executionWithId.result?.notices.some(
          (notice) => notice.code === 'oracle-metadata-invalidated',
        )
        startTransition(() => {
          dispatch({
            type: 'EXECUTION_READY',
            execution: executionWithId,
            request: executionRequest,
            waitForDisplay,
          })
          if (invalidatesOracleMetadata) {
            dispatch({
              type: 'STRUCTURE_INVALIDATED',
              connectionId: executionRequest.connectionId,
              environmentId: executionRequest.environmentId,
            })
          }
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
      } finally {
        stopProgress?.()
        dispatchingTabsRef.current.delete(tabId)
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
