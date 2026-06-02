import { useCallback, useMemo } from 'react'
import type {
  LibraryItemKind,
  QueryTabState,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { desktopClient } from '../../services/runtime/client'
import { defaultLibraryFolderForConnection } from '../../services/runtime/library-connection-helpers'
import { ensureWorkspaceUnlocked } from './app-state-factories'
import { toUserMessage } from './app-state-selectors'
import { shouldRecordConnectionIssue } from './connection-health'
import type { Actions, AppActionContext } from './app-state-types'

type QueryTabActions = Pick<
  Actions,
  | 'selectTab'
  | 'createTab'
  | 'createExplorerTab'
  | 'createMetricsTab'
  | 'createEnvironmentTab'
  | 'createSettingsTab'
  | 'refreshMetricsTab'
  | 'createObjectViewTab'
  | 'refreshObjectViewTab'
  | 'createTestSuiteTab'
  | 'createScopedTab'
  | 'closeTab'
  | 'reopenClosedTab'
  | 'reorderTabs'
  | 'updateQuery'
  | 'updateQueryBuilderState'
  | 'updateTestSuiteTab'
  | 'renameTab'
  | 'saveCurrentQuery'
  | 'saveAndCloseTab'
  | 'createLibraryFolder'
  | 'renameLibraryNode'
  | 'moveLibraryNode'
  | 'setLibraryNodeEnvironment'
  | 'deleteLibraryNode'
  | 'openLibraryItem'
  | 'saveQueryTabToLibrary'
  | 'saveQueryTabToLocalFile'
  | 'openSavedWork'
  | 'deleteSavedWork'
>

export function useQueryTabActions({
  state,
  dispatch,
  applyPayload,
  handleError,
}: AppActionContext): QueryTabActions {
  const recordTabIssue = useCallback((
    tab: QueryTabState | undefined,
    source: 'metrics' | 'object-view',
    message: string,
  ) => {
    if (!tab) {
      return
    }
    if (!shouldRecordConnectionIssue(message)) {
      dispatch({
        type: 'CONNECTION_HEALTH_SETTLED',
        connectionId: tab.connectionId,
        environmentId: tab.environmentId,
        source,
      })
      return
    }

    dispatch({
      type: 'CONNECTION_HEALTH_ISSUE',
      connectionId: tab.connectionId,
      environmentId: tab.environmentId,
      source,
      message,
    })
  }, [dispatch])
  const currentTabs = state.payload?.snapshot.tabs

  const selectTab = useCallback<Actions['selectTab']>(
    async (tabId) => {
      try {
        applyPayload(await desktopClient.setActiveTab(tabId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const createTab = useCallback<Actions['createTab']>(
    async (connectionId) => {
      try {
        applyPayload(await desktopClient.createQueryTab(connectionId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const createExplorerTab = useCallback<Actions['createExplorerTab']>(
    async (connectionId) => {
      try {
        applyPayload(await desktopClient.createExplorerTab(connectionId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const createMetricsTab = useCallback<Actions['createMetricsTab']>(
    async (connectionId, environmentId) => {
      let refreshTarget: QueryTabState | undefined
      try {
        const payload = await desktopClient.createMetricsTab(connectionId, environmentId)
        const activeMetricsTab = payload.snapshot.tabs.find(
          (tab) => tab.id === payload.snapshot.ui.activeTabId && tab.tabKind === 'metrics',
        )
        refreshTarget = activeMetricsTab
        applyPayload(payload)

        if (!activeMetricsTab) {
          return
        }

        dispatch({
          type: 'CONNECTION_HEALTH_CHECKING',
          connectionId: activeMetricsTab.connectionId,
          environmentId: activeMetricsTab.environmentId,
          source: 'metrics',
          message: 'Refreshing metrics',
        })
        applyPayload(await desktopClient.refreshMetricsTab(activeMetricsTab.id))
        dispatch({
          type: 'CONNECTION_HEALTH_CONNECTED',
          connectionId: activeMetricsTab.connectionId,
          environmentId: activeMetricsTab.environmentId,
          source: 'metrics',
          message: 'Metrics refreshed',
        })
      } catch (error) {
        recordTabIssue(
          refreshTarget,
          'metrics',
          toUserMessage(error, 'Unable to refresh metrics.'),
        )
        handleError(error)
      }
    },
    [applyPayload, dispatch, handleError, recordTabIssue],
  )

  const createEnvironmentTab = useCallback<Actions['createEnvironmentTab']>(
    async (environmentId) => {
      try {
        applyPayload(await desktopClient.createEnvironmentTab(environmentId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const createSettingsTab = useCallback<Actions['createSettingsTab']>(
    async () => {
      try {
        applyPayload(await desktopClient.createSettingsTab())
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const refreshMetricsTab = useCallback<Actions['refreshMetricsTab']>(
    async (tabId) => {
      const tab = currentTabs?.find((item) => item.id === tabId)
      try {
        if (tab) {
          dispatch({
            type: 'CONNECTION_HEALTH_CHECKING',
            connectionId: tab.connectionId,
            environmentId: tab.environmentId,
            source: 'metrics',
            message: 'Refreshing metrics',
          })
        }
        applyPayload(await desktopClient.refreshMetricsTab(tabId))
        if (tab) {
          dispatch({
            type: 'CONNECTION_HEALTH_CONNECTED',
            connectionId: tab.connectionId,
            environmentId: tab.environmentId,
            source: 'metrics',
            message: 'Metrics refreshed',
          })
        }
      } catch (error) {
        recordTabIssue(tab, 'metrics', toUserMessage(error, 'Unable to refresh metrics.'))
        handleError(error)
      }
    },
    [applyPayload, currentTabs, dispatch, handleError, recordTabIssue],
  )

  const createObjectViewTab = useCallback<Actions['createObjectViewTab']>(
    async (request) => {
      let refreshTarget: QueryTabState | undefined
      try {
        const payload = await desktopClient.createObjectViewTab(request)
        const activeObjectViewTab = payload.snapshot.tabs.find(
          (tab) =>
            tab.id === payload.snapshot.ui.activeTabId &&
            tab.tabKind === 'object-view',
        )
        refreshTarget = activeObjectViewTab
        applyPayload(payload)

        if (!activeObjectViewTab) {
          return
        }

        dispatch({
          type: 'CONNECTION_HEALTH_CHECKING',
          connectionId: activeObjectViewTab.connectionId,
          environmentId: activeObjectViewTab.environmentId,
          source: 'object-view',
          message: 'Refreshing object view',
        })
        applyPayload(await desktopClient.refreshObjectViewTab(activeObjectViewTab.id))
        dispatch({
          type: 'CONNECTION_HEALTH_CONNECTED',
          connectionId: activeObjectViewTab.connectionId,
          environmentId: activeObjectViewTab.environmentId,
          source: 'object-view',
          message: 'Object view refreshed',
        })
      } catch (error) {
        recordTabIssue(
          refreshTarget,
          'object-view',
          toUserMessage(error, 'Unable to refresh object view.'),
        )
        handleError(error)
      }
    },
    [applyPayload, dispatch, handleError, recordTabIssue],
  )

  const refreshObjectViewTab = useCallback<Actions['refreshObjectViewTab']>(
    async (tabId) => {
      const tab = currentTabs?.find((item) => item.id === tabId)
      try {
        if (tab) {
          dispatch({
            type: 'CONNECTION_HEALTH_CHECKING',
            connectionId: tab.connectionId,
            environmentId: tab.environmentId,
            source: 'object-view',
            message: 'Refreshing object view',
          })
        }
        applyPayload(await desktopClient.refreshObjectViewTab(tabId))
        if (tab) {
          dispatch({
            type: 'CONNECTION_HEALTH_CONNECTED',
            connectionId: tab.connectionId,
            environmentId: tab.environmentId,
            source: 'object-view',
            message: 'Object view refreshed',
          })
        }
      } catch (error) {
        recordTabIssue(tab, 'object-view', toUserMessage(error, 'Unable to refresh object view.'))
        handleError(error)
      }
    },
    [applyPayload, currentTabs, dispatch, handleError, recordTabIssue],
  )

  const createTestSuiteTab = useCallback<Actions['createTestSuiteTab']>(
    async (request) => {
      try {
        applyPayload(await desktopClient.createTestSuiteTab(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const createScopedTab = useCallback<Actions['createScopedTab']>(
    async (request) => {
      try {
        applyPayload(await desktopClient.createScopedQueryTab(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const closeTab = useCallback<Actions['closeTab']>(
    async (tabId) => {
      try {
        applyPayload(await desktopClient.closeQueryTab(tabId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const reopenClosedTab = useCallback<Actions['reopenClosedTab']>(
    async (closedTabId) => {
      try {
        applyPayload(await desktopClient.reopenClosedQueryTab(closedTabId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const reorderTabs = useCallback<Actions['reorderTabs']>(
    async (orderedTabIds) => {
      try {
        applyPayload(await desktopClient.reorderQueryTabs(orderedTabIds))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const updateQuery = useCallback<Actions['updateQuery']>(
    async (tabId, queryText, queryViewMode) => {
      try {
        applyPayload(await desktopClient.updateQueryTab(tabId, queryText, queryViewMode))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const updateQueryBuilderState = useCallback<Actions['updateQueryBuilderState']>(
    async (request) => {
      try {
        applyPayload(await desktopClient.updateQueryBuilderState(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const updateTestSuiteTab = useCallback<Actions['updateTestSuiteTab']>(
    async (request) => {
      try {
        applyPayload(await desktopClient.updateTestSuiteTab(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const renameTab = useCallback<Actions['renameTab']>(
    async (tabId, title) => {
      try {
        applyPayload(await desktopClient.renameQueryTab(tabId, title))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const saveCurrentQuery = useCallback<Actions['saveCurrentQuery']>(
    async (tabId) => {
      try {
        if (!state.payload) {
          throw new Error('Workspace is not ready for Library saves.')
        }
        ensureWorkspaceUnlocked(state.payload)

        const tab = state.payload.snapshot.tabs.find((item) => item.id === tabId)
        if (!tab) {
          throw new Error('The active query tab cannot be saved yet.')
        }
        if (tab.tabKind === 'explorer' || tab.tabKind === 'metrics' || tab.tabKind === 'object-view') {
          return
        }
        if (tab.saveTarget?.kind === 'local-file') {
          applyPayload(
            await desktopClient.saveQueryTabToLocalFile({
              tabId,
              path: tab.saveTarget.path,
            }),
          )
          return
        }

        applyPayload(
          await desktopClient.saveQueryTabToLibrary({
            tabId,
            itemId:
              tab.saveTarget?.kind === 'library'
                ? tab.saveTarget.libraryItemId
                : tab.savedQueryId,
            folderId: defaultLibraryFolderForTab(state.payload.snapshot, tab),
            name: tab.title,
            kind: inferLibraryItemKind(state.payload.snapshot, tab),
            tags: [],
          }),
        )
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const saveAndCloseTab = useCallback<Actions['saveAndCloseTab']>(
    async (tabId) => {
      try {
        if (!state.payload) {
          throw new Error('Workspace is not ready for Library saves.')
        }
        ensureWorkspaceUnlocked(state.payload)

        const tab = state.payload.snapshot.tabs.find((item) => item.id === tabId)
        if (!tab) {
          throw new Error('The active query tab cannot be saved yet.')
        }
        if (tab.tabKind === 'explorer' || tab.tabKind === 'metrics' || tab.tabKind === 'object-view') {
          applyPayload(await desktopClient.closeQueryTab(tabId))
          return
        }
        if (tab.saveTarget?.kind === 'local-file') {
          await desktopClient.saveQueryTabToLocalFile({
            tabId,
            path: tab.saveTarget.path,
          })
        } else {
          await desktopClient.saveQueryTabToLibrary({
            tabId,
            itemId:
              tab.saveTarget?.kind === 'library'
                ? tab.saveTarget.libraryItemId
                : tab.savedQueryId,
            folderId: defaultLibraryFolderForTab(state.payload.snapshot, tab),
            name: tab.title,
            kind: inferLibraryItemKind(state.payload.snapshot, tab),
            tags: [],
          })
        }
        applyPayload(await desktopClient.closeQueryTab(tabId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const createLibraryFolder = useCallback<Actions['createLibraryFolder']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.createLibraryFolder(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const renameLibraryNode = useCallback<Actions['renameLibraryNode']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.renameLibraryNode(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const moveLibraryNode = useCallback<Actions['moveLibraryNode']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.moveLibraryNode(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const setLibraryNodeEnvironment = useCallback<Actions['setLibraryNodeEnvironment']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.setLibraryNodeEnvironment(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const deleteLibraryNode = useCallback<Actions['deleteLibraryNode']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.deleteLibraryNode(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const openLibraryItem = useCallback<Actions['openLibraryItem']>(
    async (libraryItemId) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.openLibraryItem(libraryItemId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const saveQueryTabToLibrary = useCallback<Actions['saveQueryTabToLibrary']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.saveQueryTabToLibrary(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const saveQueryTabToLocalFile = useCallback<Actions['saveQueryTabToLocalFile']>(
    async (request) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.saveQueryTabToLocalFile(request))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const openSavedWork = useCallback<Actions['openSavedWork']>(
    async (savedWorkId) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.openSavedWork(savedWorkId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const deleteSavedWork = useCallback<Actions['deleteSavedWork']>(
    async (savedWorkId) => {
      try {
        ensureWorkspaceUnlocked(state.payload)
        applyPayload(await desktopClient.deleteSavedWork(savedWorkId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  return useMemo(
    () => ({
      selectTab,
      createTab,
      createExplorerTab,
      createMetricsTab,
      createEnvironmentTab,
      createSettingsTab,
      createObjectViewTab,
      refreshMetricsTab,
      refreshObjectViewTab,
      createTestSuiteTab,
      createScopedTab,
      closeTab,
      reopenClosedTab,
      reorderTabs,
      updateQuery,
      updateQueryBuilderState,
      updateTestSuiteTab,
      renameTab,
      saveCurrentQuery,
      saveAndCloseTab,
      createLibraryFolder,
      renameLibraryNode,
      moveLibraryNode,
      setLibraryNodeEnvironment,
      deleteLibraryNode,
      openLibraryItem,
      saveQueryTabToLibrary,
      saveQueryTabToLocalFile,
      openSavedWork,
      deleteSavedWork,
    }),
    [
      closeTab,
      createEnvironmentTab,
      createLibraryFolder,
      createExplorerTab,
      createMetricsTab,
      createSettingsTab,
      createObjectViewTab,
      createTestSuiteTab,
      createScopedTab,
      createTab,
      deleteLibraryNode,
      deleteSavedWork,
      moveLibraryNode,
      openLibraryItem,
      openSavedWork,
      renameTab,
      renameLibraryNode,
      reorderTabs,
      reopenClosedTab,
      refreshMetricsTab,
      refreshObjectViewTab,
      saveAndCloseTab,
      saveCurrentQuery,
      saveQueryTabToLibrary,
      saveQueryTabToLocalFile,
      selectTab,
      setLibraryNodeEnvironment,
      updateQuery,
      updateQueryBuilderState,
      updateTestSuiteTab,
    ],
  )
}

function inferLibraryItemKind(
  snapshot: WorkspaceSnapshot,
  tab: QueryTabState,
): LibraryItemKind {
  const existingItemId =
    tab.saveTarget?.kind === 'library' ? tab.saveTarget.libraryItemId : tab.savedQueryId
  const existingNode = snapshot.libraryNodes.find((node) => node.id === existingItemId)

  if (
    existingNode?.kind &&
    existingNode.kind !== 'folder' &&
    existingNode.kind !== 'connection'
  ) {
    return existingNode.kind
  }

  if (tab.tabKind === 'test-suite' || tab.testSuite) {
    return 'test-suite'
  }

  if (/\.(ps1|sh|bash|bat|cmd|js|ts|py)$/i.test(tab.title)) {
    return 'script'
  }

  return 'query'
}

function defaultLibraryFolderForTab(snapshot: WorkspaceSnapshot, tab: QueryTabState) {
  return defaultLibraryFolderForConnection(snapshot, tab.connectionId)
}
