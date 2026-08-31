/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { BootstrapPayload } from '@datapadplusplus/shared-types'
import { desktopClient } from '../../services/runtime/client'
import { useAppActions } from './app-actions'
import { initialState, reducer } from './app-state-reducer'
import { dispatchBootstrapPayload } from './app-state-payload'
import { toUserError, toUserMessage } from './app-state-selectors'
import { useStartupUpdateCheck } from './use-startup-update-check'
import type { Actions, AppContextValue, StateShape, AppErrorOptions } from './app-state-types'
export type { WorkbenchMessage, WorkbenchMessageSeverity } from './app-state-types'
const noop = async () => {}
const noopFalse = async () => false

const defaultActions: Actions = {
  selectConnection: noop,
  selectTab: noop,
  selectEnvironment: noop,
  createConnection: noop,
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
  createMcpServerTab: noop,
  createWorkspaceSearchTab: noop,
  createSecurityChecksTab: noop,
  refreshMetricsTab: noop,
  createObjectViewTab: noop,
  refreshObjectViewTab: noop,
  createTestSuiteTab: noop,
  createScopedTab: noop,
  closeTab: noop,
  closeTabs: async () => undefined,
  reopenClosedTab: noop,
  reorderTabs: noop,
  updateQuery: noop,
  updateQueryBuilderState: noop,
  updateDatastoreQueryEditorState: noop,
  updateQueryTarget: async () => false,
  updateQuerySqlScope: async () => false,
  updateTestSuiteTab: noop,
  renameTab: noop,
  saveCurrentQuery: noop,
  saveAndCloseTab: async () => undefined,
  createLibraryFolder: noop,
  renameLibraryNode: noop,
  moveLibraryNode: noop,
  setLibraryNodeEnvironment: noop,
  deleteLibraryNode: noop,
  duplicateLibraryNode: noop,
  openLibraryItem: noop,
  openTestSuiteCase: noop,
  saveQueryTabToLibrary: noop,
  saveQueryTabToLocalFile: noop,
  openSavedWork: noop,
  deleteSavedWork: noop,
  testConnection: async () => undefined,
  loadExplorer: noop,
  loadStructureMap: noop,
  inspectExplorer: noop,
  scanRedisKeys: async () => undefined,
  inspectRedisKey: noop,
  readKeyValue: async () => undefined,
  executeQuery: noop,
  executeBuilderCount: noop,
  executeTestSuite: async () => undefined,
  planTestSuiteRun: async () => undefined,
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
  addWorkbenchMessage: () => undefined,
  openWorkbenchMessages: () => undefined,
  dismissWorkbenchMessage: () => undefined,
  clearWorkbenchMessages: () => undefined,
  setTheme: noop,
  setSafeModeEnabled: noop,
  setKeyboardShortcut: noop,
  setFirstInstallGuideStatus: noop,
  setExplorerFolderOrder: noop,
  updateUiState: noop,
  refreshDiagnostics: noop,
  listAppLogFiles: async () => undefined,
  readAppLogFile: async () => undefined,
  clearAppLogFile: async () => undefined,
  deleteAppLogFile: async () => undefined,
  exportResultFile: async () => undefined,
  exportWorkspace: noop,
  importWorkspace: noop,
  exportWorkspaceFile: async () => ({ status: 'failed', message: 'Unavailable.' }),
  importWorkspaceFile: noopFalse,
  selectWorkspaceImportFile: async () => ({ status: 'failed', message: 'Unavailable.' }),
  previewWorkspaceImportFile: async () => ({ status: 'failed', message: 'Unavailable.' }),
  commitWorkspaceImport: async () => ({ status: 'failed', message: 'Unavailable.' }),
  cancelWorkspaceImport: noopFalse,
  getWorkspaceSwitcherStatus: async () => undefined,
  setWorkspaceSwitcherEnabled: noopFalse,
  updateMultiWindowTabsSettings: noopFalse,
  createWorkspace: noopFalse,
  renameWorkspace: noopFalse,
  switchWorkspace: noopFalse,
  updateWorkspaceBackupSettings: noopFalse,
  updateWorkspaceSearchSettings: noopFalse,
  updateDatastoreTestsSettings: noopFalse,
  getDatastoreSecurityCheckStatus: async () => undefined,
  updateDatastoreSecurityCheckSettings: noopFalse,
  refreshDatastoreSecurityChecks: noopFalse,
  getDatastoreApiServerStatus: async () => undefined,
  getDatastoreApiServerMetrics: async () => undefined,
  getDatastoreApiServerLogs: async () => undefined,
  createDatastoreApiServer: noopFalse,
  updateDatastoreApiServer: noopFalse,
  discoverDatastoreApiServerResources: async () => undefined,
  discoverDatastoreApiServerQuerySources: async () => undefined,
  addDatastoreApiServerResources: noopFalse,
  removeDatastoreApiServerResource: noopFalse,
  addDatastoreApiServerCustomEndpoint: noopFalse,
  updateDatastoreApiServerCustomEndpoint: noopFalse,
  removeDatastoreApiServerCustomEndpoint: noopFalse,
  getDatastoreApiServerProjectExportCapabilities: async () => undefined,
  exportDatastoreApiServerProjectFile: async () => undefined,
  updateDatastoreApiServerSettings: noopFalse,
  startDatastoreApiServer: async () => undefined,
  stopDatastoreApiServer: async () => undefined,
  deleteDatastoreApiServer: noopFalse,
  getDatastoreMcpServerStatus: async () => undefined,
  getDatastoreMcpServerMetrics: async () => undefined,
  getDatastoreMcpServerLogs: async () => undefined,
  createDatastoreMcpServer: noopFalse,
  updateDatastoreMcpServer: noopFalse,
  updateDatastoreMcpServerSettings: noopFalse,
  startDatastoreMcpServer: async () => undefined,
  stopDatastoreMcpServer: async () => undefined,
  deleteDatastoreMcpServer: noopFalse,
  createDatastoreMcpServerToken: async () => undefined,
  deleteDatastoreMcpServerToken: async () => undefined,
  previewDatastoreMcpClientSetup: async () => undefined,
  applyDatastoreMcpClientSetup: async () => undefined,
  listWorkspaceBackups: async () => undefined,
  analyzeWorkspaceStorage: async () => undefined,
  analyzeWorkspaceBackupFile: async () => undefined,
  createWorkspaceBackupNow: async () => undefined,
  restoreWorkspaceBackup: noopFalse,
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

export function shouldDispatchCommandError(options?: AppErrorOptions) {
  return !options?.suppressWorkbenchMessage
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef<StateShape>(state)
  const providerMountedRef = useRef(true)
  const [windowRole, setWindowRole] = useState<'main' | 'editor' | undefined>(undefined)
  const workspaceRefreshTimerRef = useRef<number | undefined>(undefined)

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

    void desktopClient.getWorkspaceWindowContext().then((context) => {
      if (mounted) {
        setWindowRole(context.role)
      }
    }).catch(() => {
      if (mounted) {
        setWindowRole('main')
      }
    })

    void desktopClient
      .bootstrapApp()
      .then((payload) => {
        if (mounted) {
          dispatch({ type: 'BOOTSTRAP_SUCCESS', payload })
          void desktopClient
            .getWorkspaceSwitcherStatus()
            .then((status) => {
              if (mounted) {
                dispatch({ type: 'WORKSPACE_SWITCHER_STATUS_READY', status })
              }
            })
            .catch(() => {
              // Older desktop runtimes may not have workspace switcher commands yet.
            })
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
    dispatchBootstrapPayload(dispatch, payload)
  }, [])

  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined

    void desktopClient.listenForWorkspaceChanges(({ revision, contextChanged }) => {
      if (
        disposed
        || (!contextChanged && revision <= (stateRef.current.payload?.snapshot.workspaceRevision ?? 0))
      ) {
        return
      }
      if (workspaceRefreshTimerRef.current !== undefined) {
        window.clearTimeout(workspaceRefreshTimerRef.current)
      }
      workspaceRefreshTimerRef.current = window.setTimeout(() => {
        workspaceRefreshTimerRef.current = undefined
        void desktopClient.bootstrapApp().then(async (nextPayload) => {
          if (!providerMountedRef.current) {
            return
          }
          if (contextChanged) {
            const status = await desktopClient.getWorkspaceSwitcherStatus().catch(() => undefined)
            dispatch({ type: 'WORKSPACE_CONTEXT_COMMITTED', payload: nextPayload, status })
          } else {
            dispatchBootstrapPayload(dispatch, nextPayload)
          }
        }).catch(() => {
          // A command response may already carry the authoritative workspace context.
        })
      }, 40)
    }).then((stopListening) => {
      if (disposed) {
        stopListening()
      } else {
        unlisten = stopListening
      }
    }).catch(() => {
      // Browser preview and unit-test hosts do not expose native window events.
    })

    return () => {
      disposed = true
      unlisten?.()
      if (workspaceRefreshTimerRef.current !== undefined) {
        window.clearTimeout(workspaceRefreshTimerRef.current)
      }
    }
  }, [])

  const handleError = useCallback((error: unknown, options?: AppErrorOptions) => {
    if (!shouldDispatchCommandError(options)) {
      return
    }
    const { code, message } = toUserError(error, 'Unexpected desktop command failure.')
    dispatch({
      type: 'COMMAND_ERROR',
      message,
      openMessages: options?.openMessages ?? code !== 'workspace-save-blocked',
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
    enabled: windowRole === 'main',
    providerMountedRef,
    runtime: state.payload?.health.runtime,
    status: state.status,
  })

  const value: AppContextValue = {
    ...state,
    activeConnection,
    activeEnvironment,
    actions,
  }

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}

export function useAppState() {
  return useContext(AppStateContext)
}
