import { startTransition, useCallback, useMemo } from 'react'
import type {
  ExecutionRequest,
  ResultPageRequest,
} from '@datapadplusplus/shared-types'
import type { ConnectionHealthSource } from './connection-health'
import { desktopClient } from '../../services/runtime/client'
import { resultEditQueryText } from '../result-edit-context'
import { ensureWorkspaceUnlocked } from './app-state-factories'
import { buildConnectionTestFailure } from './connection-test-results'
import { shouldRecordConnectionIssue } from './connection-health'
import { createId } from './helpers'
import { toUserError, toUserMessage } from './app-state-selectors'
import type { Actions, AppActionContext } from './app-state-types'
import {
  isTabVisible,
  nextFrame,
  scheduleResultRenderAckFallback,
  shouldWaitForVisibleResult,
  tabExecution,
} from './app-actions-execution-utils'
import { useRuntimeCommandActions } from './app-actions-runtime-commands'

export {
  RESULT_RENDER_ACK_FALLBACK_MS,
  scheduleResultRenderAckFallback,
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
      try {
        ensureWorkspaceUnlocked(state.payload)
        dispatch({ type: 'STRUCTURE_LOADING' })
        const structure = await desktopClient.loadStructureMap(request)
        dispatch({ type: 'STRUCTURE_READY', structure })
        recordConnected(
          request.connectionId,
          request.environmentId,
          'structure',
          'Structure loaded',
        )
      } catch (error) {
        const message = toUserMessage(error, 'Unable to load visual database structure.')
        dispatch({
          type: 'STRUCTURE_ERROR',
          message,
        })
        recordIssue(request.connectionId, request.environmentId, 'structure', message)
      }
    },
    [dispatch, recordConnected, recordIssue, state.payload],
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
    ) => {
      const executionId = createId('execution')
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
        }

        dispatch({
          type: 'EXECUTION_LOADING',
          tabId,
          execution: tabExecution(executionId, 'server'),
        })
        const execution = await desktopClient.executeQuery(executionRequest)
        const executionWithId = { ...execution, executionId }
        if (executionWithId.result) {
          dispatch({
            type: 'EXECUTION_PHASE',
            tabId,
            executionId,
            phase: 'rendering',
          })
          await nextFrame()
        }
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
        const message = userError.message
        dispatch({
          type: 'EXECUTION_FAILED',
          tabId,
          executionId,
          code: userError.code,
          message,
        })
        const latestTab = stateRef.current.payload?.snapshot.tabs.find((item) => item.id === tabId)
        if (latestTab) {
          recordIssue(latestTab.connectionId, latestTab.environmentId, 'query', message)
        }
        handleError(error, { suppressWorkbenchMessage: true })
      }
    },
    [dispatch, handleError, recordConnected, recordIssue, stateRef],
  )

  const fetchResultPage = useCallback<Actions['fetchResultPage']>(
    async (tabId, renderer) => {
      const executionId = createId('execution')
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

        const pageInfo = tab.result.pageInfo

        if (!pageInfo?.hasMore) {
          return
        }

        const request: ResultPageRequest = {
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
        }

        dispatch({
          type: 'RESULT_PAGE_LOADING',
          tabId,
          execution: tabExecution(executionId, 'paging', 'Loading more results'),
        })
        const page = await desktopClient.fetchResultPage(request)
        dispatch({
          type: 'EXECUTION_PHASE',
          tabId,
          executionId,
          phase: 'paging',
        })
        await nextFrame()
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
      }
    },
    [dispatch, handleError, recordConnected, recordIssue, stateRef],
  )

  const fetchDocumentNodeChildren = useCallback<Actions['fetchDocumentNodeChildren']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
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
        return undefined
      }
    },
    [handleError, recordConnected, recordIssue, state.payload],
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
      executeQuery,
      fetchResultPage,
      fetchDocumentNodeChildren,
      markExecutionDisplayed,
      ...commandActions,
    }),
    [
      commandActions,
      executeQuery,
      fetchDocumentNodeChildren,
      fetchResultPage,
      inspectRedisKey,
      inspectExplorer,
      loadExplorer,
      loadStructureMap,
      markExecutionDisplayed,
      scanRedisKeys,
      testConnection,
    ],
  )
}
