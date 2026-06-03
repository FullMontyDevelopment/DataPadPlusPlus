import { useCallback, useMemo } from 'react'
import { desktopClient } from '../../services/runtime/client'
import { ensureWorkspaceUnlocked } from './app-state-factories'
import { toUserMessage } from './app-state-selectors'
import { createId } from './helpers'
import type { Actions, AppActionContext } from './app-state-types'
import { tabExecution } from './app-actions-execution-utils'

type RuntimeCommandActions = Pick<
  Actions,
  | 'cancelExecution'
  | 'executeTestSuite'
  | 'cancelTestRun'
  | 'pickLocalDatabaseFile'
  | 'createLocalDatabase'
  | 'listDatastoreOperations'
  | 'planDatastoreOperation'
  | 'executeDatastoreOperation'
  | 'planDataEdit'
  | 'executeDataEdit'
>

export function useRuntimeCommandActions({
  state,
  dispatch,
  handleError,
}: AppActionContext): RuntimeCommandActions {
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
    async (request) => callRuntimeCommand(state.payload, handleError, () =>
      desktopClient.listDatastoreOperations(request),
    ),
    [handleError, state.payload],
  )

  const planDatastoreOperation = useCallback<Actions['planDatastoreOperation']>(
    async (request) => callRuntimeCommand(state.payload, handleError, () =>
      desktopClient.planDatastoreOperation(request),
    ),
    [handleError, state.payload],
  )

  const executeDatastoreOperation = useCallback<Actions['executeDatastoreOperation']>(
    async (request) => callRuntimeCommand(state.payload, handleError, () =>
      desktopClient.executeDatastoreOperation(request),
    ),
    [handleError, state.payload],
  )

  const planDataEdit = useCallback<Actions['planDataEdit']>(
    async (request) => callRuntimeCommand(state.payload, handleError, () =>
      desktopClient.planDataEdit(request),
    ),
    [handleError, state.payload],
  )

  const executeDataEdit = useCallback<Actions['executeDataEdit']>(
    async (request) => callRuntimeCommand(state.payload, handleError, () =>
      desktopClient.executeDataEdit(request),
    ),
    [handleError, state.payload],
  )

  return useMemo(
    () => ({
      cancelExecution,
      executeTestSuite,
      cancelTestRun,
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
      cancelTestRun,
      createLocalDatabase,
      executeDataEdit,
      executeDatastoreOperation,
      executeTestSuite,
      listDatastoreOperations,
      pickLocalDatabaseFile,
      planDataEdit,
      planDatastoreOperation,
    ],
  )
}

async function callRuntimeCommand<T>(
  payload: AppActionContext['state']['payload'],
  handleError: AppActionContext['handleError'],
  command: () => Promise<T>,
): Promise<T | undefined> {
  try {
    ensureWorkspaceUnlocked(payload)
    return await command()
  } catch (error) {
    handleError(error)
    return undefined
  }
}
