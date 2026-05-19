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
import type { BootstrapPayload } from '@datapadplusplus/shared-types'
import { desktopClient } from '../../services/runtime/client'
import { useAppActions } from './app-actions'
import { initialState, reducer } from './app-state-reducer'
import { toUserMessage } from './app-state-selectors'
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
  saveEnvironment: noop,
  deleteEnvironment: noop,
  createTab: noop,
  createExplorerTab: noop,
  createMetricsTab: noop,
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
  updateUiState: noop,
  refreshDiagnostics: noop,
  exportWorkspace: noop,
  importWorkspace: noop,
}

const AppStateContext = createContext<AppContextValue>({
  ...initialState,
  actions: defaultActions,
})

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const stateRef = useRef<StateShape>(state)

  useEffect(() => {
    stateRef.current = state
  }, [state])

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
