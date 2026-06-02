/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
} from 'react'
import type { ReactNode } from 'react'
import type { BootstrapPayload, ConnectionProfile } from '@datapadplusplus/shared-types'
import { desktopClient } from '../../services/runtime/client'
import { effectiveConnectionEnvironmentId } from '../../services/runtime/library-connection-helpers'
import { useAppActions } from './app-actions'
import { initialState, reducer } from './app-state-reducer'
import { toUserMessage } from './app-state-selectors'
import { buildConnectionTestFailure } from './connection-test-results'
import { connectionHealthKey } from './connection-health'
import type { Actions, AppContextValue, StateShape } from './app-state-types'

export type { WorkbenchMessage, WorkbenchMessageSeverity } from './app-state-types'

const noop = async () => {}
const noopFalse = async () => false

const defaultActions: Actions = {
  selectConnection: noop,
  selectTab: noop,
  selectEnvironment: noop,
  createConnection: noop,
  duplicateConnection: noop,
  deleteConnection: noop,
  saveConnection: noopFalse,
  createEnvironment: noop,
  saveEnvironment: noopFalse,
  deleteEnvironment: noop,
  createTab: noop,
  createExplorerTab: noop,
  createMetricsTab: noop,
  createEnvironmentTab: noop,
  createSettingsTab: noop,
  refreshMetricsTab: noop,
  createObjectViewTab: noop,
  refreshObjectViewTab: noop,
  createTestSuiteTab: noop,
  createScopedTab: noop,
  closeTab: noop,
  reopenClosedTab: noop,
  reorderTabs: noop,
  updateQuery: noop,
  updateQueryBuilderState: noop,
  updateTestSuiteTab: noop,
  renameTab: noop,
  saveCurrentQuery: noop,
  saveAndCloseTab: noop,
  createLibraryFolder: noop,
  renameLibraryNode: noop,
  moveLibraryNode: noop,
  setLibraryNodeEnvironment: noop,
  deleteLibraryNode: noop,
  openLibraryItem: noop,
  saveQueryTabToLibrary: noop,
  saveQueryTabToLocalFile: noop,
  openSavedWork: noop,
  deleteSavedWork: noop,
  testConnection: noop,
  loadExplorer: noop,
  loadStructureMap: noop,
  inspectExplorer: noop,
  scanRedisKeys: async () => undefined,
  inspectRedisKey: noop,
  executeQuery: noop,
  executeTestSuite: async () => undefined,
  cancelTestRun: async () => undefined,
  fetchResultPage: noop,
  fetchDocumentNodeChildren: async () => undefined,
  markExecutionDisplayed: () => undefined,
  cancelExecution: noop,
  pickLocalDatabaseFile: async () => ({ canceled: true }),
  createLocalDatabase: async () => undefined,
  listDatastoreOperations: async () => undefined,
  planDatastoreOperation: async () => undefined,
  executeDatastoreOperation: async () => undefined,
  planDataEdit: async () => undefined,
  executeDataEdit: async () => undefined,
  openWorkbenchMessages: () => undefined,
  dismissWorkbenchMessage: () => undefined,
  clearWorkbenchMessages: () => undefined,
  setTheme: noop,
  setSafeModeEnabled: noop,
  updateUiState: noop,
  refreshDiagnostics: noop,
  exportResultFile: async () => undefined,
  exportWorkspace: noop,
  importWorkspace: noop,
  exportWorkspaceFile: async () => undefined,
  importWorkspaceFile: noop,
  updateWorkspaceBackupSettings: noop,
  listWorkspaceBackups: async () => undefined,
  createWorkspaceBackupNow: async () => undefined,
  restoreWorkspaceBackup: noop,
  deleteWorkspaceBackup: async () => undefined,
}

const AppStateContext = createContext<AppContextValue>({
  ...initialState,
  actions: defaultActions,
})

const STARTUP_CONNECTION_TEST_CONCURRENCY = 4

interface StartupConnectionHealthTarget {
  connection: ConnectionProfile
  environmentId: string
  key: string
  connectionUpdatedAt: string
  environmentUpdatedAt: string
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef<StateShape>(state)
  const startupConnectionHealthKeysRef = useRef<Set<string>>(new Set())
  const providerMountedRef = useRef(true)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    return () => {
      providerMountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let mounted = true

    void desktopClient
      .bootstrapApp()
      .then((payload) => {
        if (mounted) {
          dispatch({ type: 'BOOTSTRAP_SUCCESS', payload })
        }
      })
      .catch((error: unknown) => {
        if (mounted) {
          dispatch({
            type: 'BOOTSTRAP_ERROR',
            message: toUserMessage(error, 'Unable to bootstrap workspace.'),
          })
        }
      })

    return () => {
      mounted = false
    }
  }, [])

  const applyPayload = useCallback((payload: BootstrapPayload) => {
    startTransition(() => {
      dispatch({ type: 'COMMAND_SUCCESS', payload })
    })
  }, [])

  const handleError = useCallback((error: unknown) => {
    dispatch({
      type: 'COMMAND_ERROR',
      message: toUserMessage(error, 'Unexpected desktop command failure.'),
    })
  }, [])

  const { actions, activeConnection, activeEnvironment } = useAppActions({
    state,
    stateRef,
    dispatch,
    applyPayload,
    handleError,
  })

  useEffect(() => {
    const payload = state.payload
    if (!payload || payload.snapshot.lockState.isLocked) {
      return
    }

    const pendingTargets = startupConnectionHealthTargets(payload).filter((target) => {
      if (startupConnectionHealthKeysRef.current.has(target.key)) {
        return false
      }
      startupConnectionHealthKeysRef.current.add(target.key)
      return true
    })

    if (pendingTargets.length === 0) {
      return
    }

    for (const target of pendingTargets) {
      dispatch({
        type: 'CONNECTION_HEALTH_CHECKING',
        connectionId: target.connection.id,
        environmentId: target.environmentId,
        source: 'startup',
        message: 'Testing connection',
      })
    }

    void runStartupConnectionHealthChecks(pendingTargets, async (target) => {
      try {
        const result = await desktopClient.testConnection({
          profile: target.connection,
          environmentId: target.environmentId,
        })

        if (!providerMountedRef.current || !isStartupHealthTargetCurrent(stateRef.current.payload, target)) {
          return
        }

        dispatch({
          type: 'CONNECTION_HEALTH_READY',
          connectionId: target.connection.id,
          environmentId: target.environmentId,
          source: 'startup',
          result,
        })
      } catch (error) {
        if (!providerMountedRef.current || !isStartupHealthTargetCurrent(stateRef.current.payload, target)) {
          return
        }

        dispatch({
          type: 'CONNECTION_HEALTH_READY',
          connectionId: target.connection.id,
          environmentId: target.environmentId,
          source: 'startup',
          result: buildConnectionTestFailure(target.connection, error),
        })
      }
    })
  }, [state.payload, stateRef])

  const value: AppContextValue = {
    ...state,
    activeConnection,
    activeEnvironment,
    actions,
  }

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

function startupConnectionHealthTargets(payload: BootstrapPayload): StartupConnectionHealthTarget[] {
  const snapshot = payload.snapshot
  const environmentsById = new Map(
    snapshot.environments.map((environment) => [environment.id, environment]),
  )
  const fallbackEnvironmentId =
    snapshot.ui.activeEnvironmentId || snapshot.environments[0]?.id || ''
  const targets: StartupConnectionHealthTarget[] = []

  for (const connection of snapshot.connections) {
    const effectiveEnvironmentId = effectiveConnectionEnvironmentId(snapshot, connection)
    const resolvedEnvironmentIds = uniqueValues(
      [
        effectiveEnvironmentId,
        ...connection.environmentIds,
        fallbackEnvironmentId,
      ].filter((environmentId): environmentId is string =>
        Boolean(environmentId && environmentsById.has(environmentId)),
      ),
    )

    for (const environmentId of resolvedEnvironmentIds) {
      const environment = environmentsById.get(environmentId)
      if (!environment) {
        continue
      }

      targets.push({
        connection,
        environmentId,
        key: `${connectionHealthKey(connection.id, environmentId)}::${connection.updatedAt}::${
          environment.updatedAt
        }`,
        connectionUpdatedAt: connection.updatedAt,
        environmentUpdatedAt: environment.updatedAt,
      })
    }
  }

  return targets
}

async function runStartupConnectionHealthChecks(
  targets: StartupConnectionHealthTarget[],
  testTarget: (target: StartupConnectionHealthTarget) => Promise<void>,
) {
  let nextIndex = 0
  const workerCount = Math.min(STARTUP_CONNECTION_TEST_CONCURRENCY, targets.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < targets.length) {
      const targetIndex = nextIndex
      nextIndex += 1
      const target = targets[targetIndex]
      if (!target) {
        continue
      }
      await testTarget(target)
    }
  })

  await Promise.all(workers)
}

function isStartupHealthTargetCurrent(
  payload: BootstrapPayload | undefined,
  target: StartupConnectionHealthTarget,
) {
  const currentConnection = payload?.snapshot.connections.find(
    (connection) => connection.id === target.connection.id,
  )
  const currentEnvironment = payload?.snapshot.environments.find(
    (environment) => environment.id === target.environmentId,
  )
  return (
    currentConnection?.updatedAt === target.connectionUpdatedAt &&
    currentEnvironment?.updatedAt === target.environmentUpdatedAt
  )
}

function uniqueValues(values: string[]) {
  return [...new Set(values)]
}

export function useAppState() {
  return useContext(AppStateContext)
}
