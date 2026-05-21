import { useCallback, useMemo } from 'react'
import type {
  LibraryItemKind,
  QueryTabState,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { desktopClient } from '../../services/runtime/client'
import { defaultLibraryFolderForConnection } from '../../services/runtime/library-connection-helpers'
import { ensureWorkspaceUnlocked } from './app-state-factories'
import type { Actions, AppActionContext } from './app-state-types'

type QueryTabActions = Pick<
  Actions,
  | 'selectTab'
  | 'createTab'
  | 'createExplorerTab'
  | 'createMetricsTab'
  | 'createEnvironmentTab'
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
  applyPayload,
  handleError,
}: AppActionContext): QueryTabActions {
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
      try {
        const payload = await desktopClient.createMetricsTab(connectionId, environmentId)
        const activeMetricsTab = payload.snapshot.tabs.find(
          (tab) => tab.id === payload.snapshot.ui.activeTabId && tab.tabKind === 'metrics',
        )
        applyPayload(payload)

        if (!activeMetricsTab) {
          return
        }

        applyPayload(await desktopClient.refreshMetricsTab(activeMetricsTab.id))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
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

  const refreshMetricsTab = useCallback<Actions['refreshMetricsTab']>(
    async (tabId) => {
      try {
        applyPayload(await desktopClient.refreshMetricsTab(tabId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const createObjectViewTab = useCallback<Actions['createObjectViewTab']>(
    async (request) => {
      try {
        const payload = await desktopClient.createObjectViewTab(request)
        const activeObjectViewTab = payload.snapshot.tabs.find(
          (tab) =>
            tab.id === payload.snapshot.ui.activeTabId &&
            tab.tabKind === 'object-view',
        )
        applyPayload(payload)

        if (!activeObjectViewTab) {
          return
        }

        applyPayload(await desktopClient.refreshObjectViewTab(activeObjectViewTab.id))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const refreshObjectViewTab = useCallback<Actions['refreshObjectViewTab']>(
    async (tabId) => {
      try {
        applyPayload(await desktopClient.refreshObjectViewTab(tabId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
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
