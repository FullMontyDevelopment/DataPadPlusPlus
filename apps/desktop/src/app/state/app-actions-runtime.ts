import { startTransition, useCallback, useMemo } from 'react'
import type {
  ExecutionRequest,
  ExecutionResponse,
  QueryExecutionPhase,
  QueryTabActiveExecution,
  ResultPageRequest,
} from '@datapadplusplus/shared-types'
import { desktopClient } from '../../services/runtime/client'
import { resultEditQueryText } from '../result-edit-context'
import { ensureWorkspaceUnlocked } from './app-state-factories'
import { buildConnectionTestFailure } from './connection-test-results'
import { createId } from './helpers'
import { toUserMessage } from './app-state-selectors'
import type { Actions, AppActionContext, StateShape } from './app-state-types'

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
  handleError,
}: AppActionContext): RuntimeActions {
  const testConnection = useCallback<Actions['testConnection']>(
    async (profile, environmentId, secret) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        const result = await desktopClient.testConnection({
          profile,
          environmentId,
          secret: secret?.trim() || undefined,
        })
        dispatch({
          type: 'CONNECTION_TEST_READY',
          profileId: profile.id,
          result,
        })
      } catch (error) {
        dispatch({
          type: 'CONNECTION_TEST_READY',
          profileId: profile.id,
          result: buildConnectionTestFailure(profile, error, secret),
        })
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
      } catch (error) {
        dispatch({
          type: 'EXPLORER_ERROR',
          request,
          requestId,
          message: toUserMessage(error, 'Unable to load live explorer metadata.'),
        })
      }
    },
    [dispatch, state.payload],
  )

  const loadStructureMap = useCallback<Actions['loadStructureMap']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        dispatch({ type: 'STRUCTURE_LOADING' })
        const structure = await desktopClient.loadStructureMap(request)
        dispatch({ type: 'STRUCTURE_READY', structure })
      } catch (error) {
        dispatch({
          type: 'STRUCTURE_ERROR',
          message: toUserMessage(error, 'Unable to load visual database structure.'),
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
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.scanRedisKeys(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
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
          waitForDisplay: shouldWaitForVisibleResult(stateRef.current, request.tabId, executionWithId),
        })
      } catch (error) {
        dispatch({
          type: 'EXECUTION_FAILED',
          tabId: request.tabId,
          executionId,
          message: toUserMessage(error, 'Unable to inspect Redis key.'),
        })
        handleError(error)
      }
    },
    [dispatch, handleError, state.payload, stateRef],
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
        startTransition(() => {
          dispatch({
            type: 'EXECUTION_READY',
            execution: executionWithId,
            request: executionRequest,
            waitForDisplay: shouldWaitForVisibleResult(
              stateRef.current,
              tabId,
              executionWithId,
            ),
          })
        })
      } catch (error) {
        dispatch({
          type: 'EXECUTION_FAILED',
          tabId,
          executionId,
          message: toUserMessage(error, 'Query execution failed.'),
        })
        handleError(error)
      }
    },
    [dispatch, handleError, stateRef],
  )

  const executeTestSuite = useCallback<Actions['executeTestSuite']>(
    async (request) => {
      const executionId = createId('execution')
      try {
        ensureWorkspaceUnlocked(state.payload)
        dispatch({
          type: 'EXECUTION_LOADING',
          tabId: request.tabId,
          execution: tabExecution(executionId, 'server', 'Running test suite'),
        })
        const response = await desktopClient.executeTestSuite(request)
        dispatch({ type: 'COMMAND_SUCCESS', payload: await desktopClient.bootstrapApp() })
        dispatch({
          type: 'EXECUTION_DISPLAYED',
          tabId: request.tabId,
          executionId,
        })
        return response
      } catch (error) {
        dispatch({
          type: 'EXECUTION_FAILED',
          tabId: request.tabId,
          executionId,
          message: toUserMessage(error, 'Test suite execution failed.'),
        })
        handleError(error)
        return undefined
      }
    },
    [dispatch, handleError, state.payload],
  )

  const cancelTestRun = useCallback<Actions['cancelTestRun']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        const response = await desktopClient.cancelTestRun(request)
        dispatch({ type: 'COMMAND_SUCCESS', payload: await desktopClient.bootstrapApp() })
        return response
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [dispatch, handleError, state.payload],
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
        startTransition(() => {
          dispatch({
            type: 'RESULT_PAGE_READY',
            page,
            executionId,
            waitForDisplay: isTabVisible(stateRef.current, tabId),
          })
        })
      } catch (error) {
        dispatch({
          type: 'EXECUTION_FAILED',
          tabId,
          executionId,
          message: toUserMessage(error, 'Unable to load more results.'),
        })
        handleError(error)
      }
    },
    [dispatch, handleError, stateRef],
  )

  const fetchDocumentNodeChildren = useCallback<Actions['fetchDocumentNodeChildren']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.fetchDocumentNodeChildren(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const markExecutionDisplayed = useCallback<Actions['markExecutionDisplayed']>(
    (tabId, executionId) => {
      dispatch({ type: 'EXECUTION_DISPLAYED', tabId, executionId })
    },
    [dispatch],
  )

  const cancelExecution = useCallback<Actions['cancelExecution']>(
    async (executionId, tabId) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        const result = await desktopClient.cancelExecution({ executionId, tabId })

        if (!result.ok) {
          dispatch({
            type: 'COMMAND_ERROR',
            message: result.message,
          })
        }
      } catch (error) {
        handleError(error)
      }
    },
    [dispatch, handleError, state.payload],
  )

  const pickLocalDatabaseFile = useCallback<Actions['pickLocalDatabaseFile']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.pickLocalDatabaseFile(request)
      } catch (error) {
        handleError(error)
        return { canceled: true }
      }
    },
    [handleError, state.payload],
  )

  const createLocalDatabase = useCallback<Actions['createLocalDatabase']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.createLocalDatabase(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const listDatastoreOperations = useCallback<Actions['listDatastoreOperations']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.listDatastoreOperations(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const planDatastoreOperation = useCallback<Actions['planDatastoreOperation']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.planDatastoreOperation(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const executeDatastoreOperation = useCallback<Actions['executeDatastoreOperation']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.executeDatastoreOperation(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const planDataEdit = useCallback<Actions['planDataEdit']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.planDataEdit(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
  )

  const executeDataEdit = useCallback<Actions['executeDataEdit']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        return await desktopClient.executeDataEdit(request)
      } catch (error) {
        handleError(error)
        return undefined
      }
    },
    [handleError, state.payload],
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
      executeTestSuite,
      cancelTestRun,
      fetchResultPage,
      fetchDocumentNodeChildren,
      markExecutionDisplayed,
      cancelExecution,
      pickLocalDatabaseFile,
      createLocalDatabase,
      listDatastoreOperations,
      planDatastoreOperation,
      executeDatastoreOperation,
      planDataEdit,
      executeDataEdit,
    }),
    [
      cancelExecution,
      createLocalDatabase,
      executeDatastoreOperation,
      executeQuery,
      executeTestSuite,
      cancelTestRun,
      fetchDocumentNodeChildren,
      fetchResultPage,
      inspectRedisKey,
      inspectExplorer,
      listDatastoreOperations,
      loadExplorer,
      loadStructureMap,
      markExecutionDisplayed,
      scanRedisKeys,
      executeDataEdit,
      pickLocalDatabaseFile,
      planDataEdit,
      planDatastoreOperation,
      testConnection,
    ],
  )
}

function tabExecution(
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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      setTimeout(resolve, 0)
      return
    }

    window.requestAnimationFrame(() => resolve())
  })
}

function shouldWaitForVisibleResult(
  state: StateShape,
  tabId: string,
  execution: Pick<ExecutionResponse, 'result'>,
) {
  return Boolean(execution.result && state.payload?.snapshot.ui.activeTabId === tabId)
}

function isTabVisible(state: StateShape, tabId: string) {
  return state.payload?.snapshot.ui.activeTabId === tabId
}
