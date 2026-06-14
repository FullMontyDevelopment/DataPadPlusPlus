/* eslint-disable react-refresh/only-export-components */
import { createContext, startTransition, useCallback, useContext, useEffect, useReducer, useRef } from 'react'
import type { Dispatch, ReactNode } from 'react'
import type { BootstrapPayload, ConnectionProfile } from '@datapadplusplus/shared-types'
import { desktopClient } from '../../services/runtime/client'
import { effectiveConnectionEnvironmentIds } from '../../services/runtime/library-connection-helpers'
import { useAppActions } from './app-actions'
import { initialState, reducer } from './app-state-reducer'
import { toUserMessage } from './app-state-selectors'
import { buildConnectionTestFailure } from './connection-test-results'
import { connectionHealthKey } from './connection-health'
import { useStartupUpdateCheck } from './use-startup-update-check'
import type { Actions, AppAction, AppContextValue, StateShape } from './app-state-types'

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
  createApiServerTab: noop,
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
  setKeyboardShortcut: noop,
  updateUiState: noop,
  refreshDiagnostics: noop,
  listAppLogFiles: async () => undefined,
  readAppLogFile: async () => undefined,
  clearAppLogFile: async () => undefined,
  deleteAppLogFile: async () => undefined,
  exportResultFile: async () => undefined,
  exportWorkspace: noop,
  importWorkspace: noop,
  exportWorkspaceFile: async () => undefined,
  importWorkspaceFile: noop,
  updateWorkspaceBackupSettings: noopFalse,
  getDatastoreApiServerStatus: async () => undefined,
  getDatastoreApiServerMetrics: async () => undefined,
  getDatastoreApiServerLogs: async () => undefined,
  updateDatastoreApiServerSettings: noopFalse,
  startDatastoreApiServer: async () => undefined,
  stopDatastoreApiServer: async () => undefined,
  deleteDatastoreApiServer: noopFalse,
  listWorkspaceBackups: async () => undefined,
  createWorkspaceBackupNow: async () => undefined,
  restoreWorkspaceBackup: noop,
  deleteWorkspaceBackup: async () => undefined,
  getAppUpdateSettings: async () => undefined,
  setAppUpdateSettings: noop,
  checkAppUpdate: async () => undefined,
  installAppUpdate: noop,
}

const AppStateContext = createContext<AppContextValue>({
  ...initialState,
  actions: defaultActions,
})

const STARTUP_CONNECTION_TEST_TIMEOUT_MS = 20_000

interface StartupConnectionHealthTarget {
  connection: ConnectionProfile
  environmentId: string
  key: string
  checkId: string
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
    providerMountedRef.current = true

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

  useStartupUpdateCheck({
    actions,
    providerMountedRef,
    runtime: state.payload?.health.runtime,
    status: state.status,
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
        checkId: target.checkId,
      })
    }

    void runStartupConnectionHealthChecks(pendingTargets, async (target) => {
      try {
        const result = await startupConnectionTestWithTimeout(target)

        if (!providerMountedRef.current) {
          return
        }

        if (!isStartupHealthTargetCurrent(stateRef.current.payload, target)) {
          settleStartupConnectionHealth(dispatch, target)
          return
        }

        dispatch({
          type: 'CONNECTION_HEALTH_READY',
          connectionId: target.connection.id,
          environmentId: target.environmentId,
          source: 'startup',
          result,
          checkId: target.checkId,
        })
      } catch (error) {
        if (!providerMountedRef.current) {
          return
        }

        if (!isStartupHealthTargetCurrent(stateRef.current.payload, target)) {
          settleStartupConnectionHealth(dispatch, target)
          return
        }

        dispatch({
          type: 'CONNECTION_HEALTH_READY',
          connectionId: target.connection.id,
          environmentId: target.environmentId,
          source: 'startup',
          result: buildConnectionTestFailure(target.connection, error),
          checkId: target.checkId,
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

export function startupConnectionHealthTargets(payload: BootstrapPayload): StartupConnectionHealthTarget[] {
  const snapshot = payload.snapshot
  const environmentsById = new Map(
    snapshot.environments.map((environment) => [environment.id, environment]),
  )
  const fallbackEnvironmentId =
    snapshot.ui.activeEnvironmentId || snapshot.environments[0]?.id || ''
  const targets: StartupConnectionHealthTarget[] = []
  const targetKeys = new Set<string>()

  const addTarget = (connection: ConnectionProfile, environmentId: string | undefined) => {
    if (!environmentId) {
      return
    }
    const environment = environmentsById.get(environmentId)
    if (!environment) {
      return
    }

    const healthKey = connectionHealthKey(connection.id, environmentId)
    const key = `${healthKey}::${connection.updatedAt}::${environment.updatedAt}`
    if (targetKeys.has(key)) {
      return
    }

    targetKeys.add(key)
    targets.push({
      connection,
      environmentId,
      key,
      checkId: key,
      connectionUpdatedAt: connection.updatedAt,
      environmentUpdatedAt: environment.updatedAt,
    })
  }

  for (const connection of snapshot.connections) {
    const effectiveEnvironmentIds = effectiveConnectionEnvironmentIds(snapshot, connection)
    for (const environmentId of uniqueValues(
      [...effectiveEnvironmentIds, ...connection.environmentIds, fallbackEnvironmentId].filter(
        (item): item is string => Boolean(item),
      ),
    )) {
      addTarget(connection, environmentId)
    }
  }

  return targets
}

async function startupConnectionTestWithTimeout(target: StartupConnectionHealthTarget) {
  let timeoutId: number | undefined

  try {
    return await Promise.race([
      desktopClient.testConnection({
        profile: target.connection,
        environmentId: target.environmentId,
      }),
      new Promise<never>((_, reject) => {
        timeoutId = window.setTimeout(
          () =>
            reject(
              new Error(
                `Connection test did not finish within ${Math.round(
                  STARTUP_CONNECTION_TEST_TIMEOUT_MS / 1000,
                )} seconds.`,
              ),
            ),
          STARTUP_CONNECTION_TEST_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (typeof timeoutId === 'number') {
      window.clearTimeout(timeoutId)
    }
  }
}

async function runStartupConnectionHealthChecks(
  targets: StartupConnectionHealthTarget[],
  testTarget: (target: StartupConnectionHealthTarget) => Promise<void>,
) {
  await Promise.allSettled(targets.map((target) => testTarget(target)))
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

function settleStartupConnectionHealth(
  dispatch: Dispatch<AppAction>,
  target: StartupConnectionHealthTarget,
) {
  dispatch({
    type: 'CONNECTION_HEALTH_SETTLED',
    connectionId: target.connection.id,
    environmentId: target.environmentId,
    source: 'startup',
    checkId: target.checkId,
  })
}

function uniqueValues(values: string[]) {
  return [...new Set(values)]
}

export function useAppState() {
  return useContext(AppStateContext)
}
