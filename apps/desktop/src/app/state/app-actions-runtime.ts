import { startTransition, useCallback, useMemo, useRef } from 'react'
import type { ResultPageRequest } from '@datapadplusplus/shared-types'
import type { ConnectionHealthSource } from './connection-health'
import { desktopClient } from '../../services/runtime/client'
import { resultEditQueryText } from '../result-edit-context'
import { ensureWorkspaceUnlocked } from './app-state-factories'
import { buildConnectionTestFailure } from './connection-test-results'
import { shouldRecordConnectionIssue } from './connection-health'
import { createId } from './helpers'
import { toUserMessage } from './app-state-selectors'
import type { Actions, AppActionContext } from './app-state-types'
import {
  isTabVisible,
  nextFrame,
  scheduleResultRenderAckFallback,
  shouldWaitForVisibleResult,
  tabExecution,
  waitForMinimumExecutionActivity,
} from './app-actions-execution-utils'
import { useRuntimeCommandActions } from './app-actions-runtime-commands'
import { useQueryExecutionActions } from './app-actions-query-execution'
import { isQueryTabExecutionLocked } from './query-execution-lock'

export {
  EXECUTION_ACTIVITY_MINIMUM_MS,
  RESULT_RENDER_ACK_FALLBACK_MS,
  scheduleResultRenderAckFallback,
  waitForMinimumExecutionActivity,
} from './app-actions-execution-utils'

type RuntimeActions = Pick<
  Actions,
  | 'testConnection'
  | 'loadExplorer'
  | 'loadStructureMap'
  | 'inspectExplorer'
  | 'scanRedisKeys'
  | 'inspectRedisKey'
  | 'executeQuery'
  | 'executeBuilderCount'
  | 'executeTestSuite'
  | 'cancelTestRun'
  | 'fetchResultPage'
  | 'fetchDocumentNodeChildren'
  | 'markExecutionDisplayed'
  | 'cancelExecution'
  | 'pickLocalDatabaseFile'
  | 'createLocalDatabase'
  | 'listDatastoreOperations'
  | 'planDatastoreOperation'
  | 'executeDatastoreOperation'
  | 'planDataEdit'
  | 'executeDataEdit'
>

export function useRuntimeActions({
  state,
  stateRef,
  dispatch,
  applyPayload,
  handleError,
}: AppActionContext): RuntimeActions {
  const pagingTabsRef = useRef(new Set<string>())
  const commandActions = useRuntimeCommandActions({
    state,
    stateRef,
    dispatch,
    applyPayload,
    handleError,
  })
  const recordConnected = useCallback(
    (
      connectionId: string,
      environmentId: string,
      source: ConnectionHealthSource,
      message?: string,
      durationMs?: number,
    ) => {
      dispatch({
        type: 'CONNECTION_HEALTH_CONNECTED',
        connectionId,
        environmentId,
        source,
        message,
        durationMs,
      })
    },
    [dispatch],
  )
  const recordIssue = useCallback(
    (
      connectionId: string,
      environmentId: string,
      source: ConnectionHealthSource,
      message: string,
    ) => {
      if (!shouldRecordConnectionIssue(message)) {
        dispatch({
          type: 'CONNECTION_HEALTH_SETTLED',
          connectionId,
          environmentId,
          source,
        })
        return
      }
      dispatch({
        type: 'CONNECTION_HEALTH_ISSUE',
        connectionId,
        environmentId,
        source,
        message,
      })
    },
    [dispatch],
  )
  const queryActions = useQueryExecutionActions({
    stateRef,
    dispatch,
    handleError,
    recordConnected,
    recordIssue,
  })

  const testConnection = useCallback<Actions['testConnection']>(
    async (profile, environmentId, secret) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        dispatch({
          type: 'CONNECTION_HEALTH_CHECKING',
          connectionId: profile.id,
          environmentId,
          source: 'manual-test',
          message: 'Testing connection',
        })
        const trimmedSecret = typeof secret === 'string' ? secret.trim() : undefined
        const result = await desktopClient.testConnection({
          profile,
          environmentId,
          secret: trimmedSecret || undefined,
        })
        dispatch({
          type: 'CONNECTION_TEST_READY',
          profileId: profile.id,
          result,
        })
        dispatch({
          type: 'CONNECTION_HEALTH_READY',
          connectionId: profile.id,
          environmentId,
          source: 'manual-test',
          result,
        })
        return result
      } catch (error) {
        const result = buildConnectionTestFailure(profile, error, secret)
        dispatch({
          type: 'CONNECTION_TEST_READY',
          profileId: profile.id,
          result,
        })
        dispatch({
          type: 'CONNECTION_HEALTH_READY',
          connectionId: profile.id,
          environmentId,
          source: 'manual-test',
          result,
        })
        return result
      }
    },
    [dispatch, state.payload],
  )

  const loadExplorer = useCallback<Actions['loadExplorer']>(
    async (request) => {
      const requestId = `explorer-${Date.now()}-${Math.random().toString(36).slice(2)}`
      try {
        ensureWorkspaceUnlocked(state.payload)
        dispatch({ type: 'EXPLORER_LOADING', request, requestId })
        const explorer = await desktopClient.loadExplorer(request)
        dispatch({ type: 'EXPLORER_READY', explorer, requestId })
        recordConnected(
          request.connectionId,
          request.environmentId,
          'metadata',
          'Metadata loaded',
        )
      } catch (error) {
        const message = toUserMessage(error, 'Unable to load live explorer metadata.')
        dispatch({
          type: 'EXPLORER_ERROR',
          request,
          requestId,
          message,
        })
        recordIssue(request.connectionId, request.environmentId, 'metadata', message)
      }
    },
    [dispatch, recordConnected, recordIssue, state.payload],
  )

  const loadStructureMap = useCallback<Actions['loadStructureMap']>(
    async (request) => {
      const requestId = `structure-${Date.now()}-${Math.random().toString(36).slice(2)}`
      try {
        ensureWorkspaceUnlocked(state.payload)
        dispatch({ type: 'STRUCTURE_LOADING', request, requestId })
        const structure = await desktopClient.loadStructureMap(request)
        dispatch({ type: 'STRUCTURE_READY', structure, requestId })
      } catch (error) {
        const message = toUserMessage(error, 'Unable to load visual database structure.')
        dispatch({
          type: 'STRUCTURE_ERROR',
          message,
          requestId,
        })
      }
    },
    [dispatch, state.payload],
  )

  const inspectExplorer = useCallback<Actions['inspectExplorer']>(
    async ({ connectionId, environmentId, nodeId }) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        const inspection = await desktopClient.inspectExplorer({
          connectionId,
          environmentId,
          nodeId,
        })
        dispatch({ type: 'EXPLORER_INSPECTION_READY', inspection })
      } catch (error) {
        dispatch({
          type: 'EXPLORER_ERROR',
          request: { connectionId, environmentId },
          message: toUserMessage(error, 'Unable to inspect explorer object.'),
        })
      }
    },
    [dispatch, state.payload],
  )

  const scanRedisKeys = useCallback<Actions['scanRedisKeys']>(
    async (request) => {
      const executionId = createId('execution')
      try {
        ensureWorkspaceUnlocked(state.payload)
        if (request.tabId) {
          dispatch({
            type: 'EXECUTION_LOADING',
            tabId: request.tabId,
            execution: tabExecution(executionId, 'server', 'Refreshing Redis keys'),
          })
        }
        const response = await desktopClient.scanRedisKeys(request)
        if (request.tabId) {
          dispatch({
            type: 'EXECUTION_DISPLAYED',
            tabId: request.tabId,
            executionId,
          })
        }
        recordConnected(
          request.connectionId,
          request.environmentId,
          'redis-browser',
          'Redis keys refreshed',
        )
        return response
      } catch (error) {
        const message = toUserMessage(error, 'Unable to refresh Redis keys.')
        if (request.tabId) {
          dispatch({
            type: 'EXECUTION_FAILED',
            tabId: request.tabId,
            executionId,
            message,
          })
        }
        recordIssue(request.connectionId, request.environmentId, 'redis-browser', message)
        handleError(error, { suppressWorkbenchMessage: true })
        return undefined
      }
    },
    [dispatch, handleError, recordConnected, recordIssue, state.payload],
  )

  const inspectRedisKey = useCallback<Actions['inspectRedisKey']>(
    async (request) => {
      const executionId = createId('execution')
      try {
        ensureWorkspaceUnlocked(state.payload)
        dispatch({
          type: 'EXECUTION_LOADING',
          tabId: request.tabId,
          execution: tabExecution(executionId, 'server'),
        })
        const execution = await desktopClient.inspectRedisKey({
          ...request,
          executionId,
        })
        const executionWithId = { ...execution, executionId }
        if (executionWithId.result) {
          dispatch({
            type: 'EXECUTION_PHASE',
            tabId: request.tabId,
            executionId,
            phase: 'rendering',
          })
          await nextFrame()
        }
        const waitForDisplay = shouldWaitForVisibleResult(
          stateRef.current,
          request.tabId,
          executionWithId,
        )
        dispatch({
          type: 'EXECUTION_READY',
          execution: executionWithId,
          request: {
            executionId,
            tabId: request.tabId,
            connectionId: request.connectionId,
            environmentId: request.environmentId,
            language: 'redis',
            queryText: `INSPECT ${request.key}`,
          },
          waitForDisplay,
        })
        if (waitForDisplay) {
          scheduleResultRenderAckFallback(dispatch, request.tabId, executionId)
        }
        recordConnected(
          request.connectionId,
          request.environmentId,
          'redis-browser',
          'Redis key inspected',
          executionWithId.result?.durationMs,
        )
      } catch (error) {
        const message = toUserMessage(error, 'Unable to inspect Redis key.')
        dispatch({
          type: 'EXECUTION_FAILED',
          tabId: request.tabId,
          executionId,
          message,
        })
        recordIssue(request.connectionId, request.environmentId, 'redis-browser', message)
        handleError(error, { suppressWorkbenchMessage: true })
      }
    },
    [dispatch, handleError, recordConnected, recordIssue, state.payload, stateRef],
  )

  const fetchResultPage = useCallback<Actions['fetchResultPage']>(
    async (tabId, renderer) => {
      if (pagingTabsRef.current.has(tabId)) {
        return
      }

      const executionId = createId('execution')
      const activityStartedAt = Date.now()
      let activityStarted = false
      try {
        const latest = stateRef.current
        if (!latest.payload) {
          throw new Error('Workspace is not ready for paged result loading.')
        }
        ensureWorkspaceUnlocked(latest.payload)
        const tab = latest.payload.snapshot.tabs.find((item) => item.id === tabId)

        if (!tab?.result) {
          throw new Error('Run a query before loading another result page.')
        }
        if (isQueryTabExecutionLocked(tab, latest.executionsByTab[tabId])) {
          return
        }
        pagingTabsRef.current.add(tabId)

        const pageInfo = tab.result.pageInfo

        if (!pageInfo?.hasMore) {
          return
        }

        const request: ResultPageRequest = {
          executionId,
          tabId: tab.id,
          connectionId: tab.connectionId,
          environmentId: tab.environmentId,
          language: tab.language,
          queryText: resultEditQueryText(tab, tab.result),
          renderer: renderer ?? tab.result.defaultRenderer,
          pageSize: pageInfo.pageSize,
          pageIndex: pageInfo.pageIndex + 1,
          cursor: pageInfo.nextCursor,
          documentEfficiencyMode: tab.result.payloads.some(
            (payload) => payload.renderer === 'document' && payload.hydrationMode === 'lazy',
          ),
          scopedTarget: tab.scopedTarget,
        }

        dispatch({
          type: 'RESULT_PAGE_LOADING',
          tabId,
          execution: tabExecution(executionId, 'paging', 'Loading more results'),
        })
        activityStarted = true
        await nextFrame()
        const page = await desktopClient.fetchResultPage(request)
        dispatch({
          type: 'EXECUTION_PHASE',
          tabId,
          executionId,
          phase: 'paging',
        })
        await nextFrame()
        await waitForMinimumExecutionActivity(activityStartedAt)
        const waitForDisplay = isTabVisible(stateRef.current, tabId)
        startTransition(() => {
          dispatch({
            type: 'RESULT_PAGE_READY',
            page,
            executionId,
            waitForDisplay,
          })
        })
        if (waitForDisplay) {
          scheduleResultRenderAckFallback(dispatch, tabId, executionId)
        }
        recordConnected(
          request.connectionId,
          request.environmentId,
          'query',
          'Result page loaded',
        )
      } catch (error) {
        const message = toUserMessage(error, 'Unable to load more results.')
        if (activityStarted) {
          await waitForMinimumExecutionActivity(activityStartedAt)
        }
        dispatch({
          type: 'EXECUTION_FAILED',
          tabId,
          executionId,
          message,
        })
        const latestTab = stateRef.current.payload?.snapshot.tabs.find((item) => item.id === tabId)
        if (latestTab) {
          recordIssue(latestTab.connectionId, latestTab.environmentId, 'query', message)
        }
        handleError(error, { suppressWorkbenchMessage: true })
      } finally {
        pagingTabsRef.current.delete(tabId)
      }
    },
    [dispatch, handleError, recordConnected, recordIssue, stateRef],
  )

  const fetchDocumentNodeChildren = useCallback<Actions['fetchDocumentNodeChildren']>(
    async (request) => {
      try {
        const latest = stateRef.current
        ensureWorkspaceUnlocked(latest.payload)
        const tab = latest.payload?.snapshot.tabs.find((item) => item.id === request.tabId)
        if (isQueryTabExecutionLocked(tab, latest.executionsByTab[request.tabId])) {
          return undefined
        }
        const response = await desktopClient.fetchDocumentNodeChildren(request)
        recordConnected(
          request.connectionId,
          request.environmentId,
          'query',
          'Document node loaded',
        )
        return response
      } catch (error) {
        const message = toUserMessage(error, 'Unable to load document node.')
        recordIssue(request.connectionId, request.environmentId, 'query', message)
        handleError(error, { suppressWorkbenchMessage: true })
        throw error
      }
    },
    [handleError, recordConnected, recordIssue, stateRef],
  )

  const markExecutionDisplayed = useCallback<Actions['markExecutionDisplayed']>(
    (tabId, executionId) => {
      dispatch({ type: 'EXECUTION_DISPLAYED', tabId, executionId })
    },
    [dispatch],
  )

  return useMemo(
    () => ({
      testConnection,
      loadExplorer,
      loadStructureMap,
      inspectExplorer,
      scanRedisKeys,
      inspectRedisKey,
      ...queryActions,
      fetchResultPage,
      fetchDocumentNodeChildren,
      markExecutionDisplayed,
      ...commandActions,
    }),
    [
      commandActions,
      fetchDocumentNodeChildren,
      fetchResultPage,
      inspectRedisKey,
      inspectExplorer,
      loadExplorer,
      loadStructureMap,
      markExecutionDisplayed,
      queryActions,
      scanRedisKeys,
      testConnection,
    ],
  )
}
