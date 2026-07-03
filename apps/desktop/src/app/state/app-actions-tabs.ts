import { useCallback, useMemo } from 'react'
import type { QueryTabState } from '@datapadplusplus/shared-types'
import { desktopClient } from '../../services/runtime/client'
import { ensureWorkspaceUnlocked } from './app-state-factories'
import { toUserMessage } from './app-state-selectors'
import { saveQueryTabToCurrentTarget } from './app-actions-tabs-save'
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
  | 'createApiServerTab'
  | 'createMcpServerTab'
  | 'createWorkspaceSearchTab'
  | 'createSecurityChecksTab'
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
        handleError(error, { suppressWorkbenchMessage: Boolean(refreshTarget) })
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

  const createApiServerTab = useCallback<Actions['createApiServerTab']>(
    async (serverId) => {
      try {
        const apiServer = state.payload?.snapshot.preferences.datastoreApiServer
        const server = serverId
          ? apiServer?.servers?.find((item) => item.id === serverId)
          : undefined
        if (apiServer?.enabled && server) {
          applyPayload(
            await desktopClient.updateDatastoreApiServerSettings({
              enabled: true,
              host: '127.0.0.1',
              serverId,
              activeServerId: serverId,
              name: server.name,
              port: server.port,
              autoStart: server.autoStart,
              connectionId: server.connectionId,
              environmentId: server.environmentId,
            }),
          )
        }
        applyPayload(await desktopClient.createApiServerTab(serverId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const createMcpServerTab = useCallback<Actions['createMcpServerTab']>(
    async (serverId) => {
      try {
        const mcpServer = state.payload?.snapshot.preferences.datastoreMcpServer
        const server = serverId
          ? mcpServer?.servers?.find((item) => item.id === serverId)
          : undefined
        if (mcpServer?.enabled && server) {
          applyPayload(
            await desktopClient.updateDatastoreMcpServerSettings({
              enabled: true,
              host: '127.0.0.1',
              serverId,
              activeServerId: serverId,
              name: server.name,
              port: server.port,
              autoStart: server.autoStart,
              allowedOrigins: server.allowedOrigins,
              connectionIds: server.connectionIds,
              environmentIds: server.environmentIds,
            }),
          )
        }
        applyPayload(await desktopClient.createMcpServerTab(serverId))
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const createWorkspaceSearchTab = useCallback<Actions['createWorkspaceSearchTab']>(
    async () => {
      try {
        applyPayload(await desktopClient.createWorkspaceSearchTab())
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError],
  )

  const createSecurityChecksTab = useCallback<Actions['createSecurityChecksTab']>(
    async () => {
      try {
        applyPayload(await desktopClient.createSecurityChecksTab())
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
        handleError(error, { suppressWorkbenchMessage: true })
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
        handleError(error, { suppressWorkbenchMessage: Boolean(refreshTarget) })
      }
    },
    [applyPayload, dispatch, handleError, recordTabIssue],
  )

  const refreshObjectViewTab = useCallback<Actions['refreshObjectViewTab']>(
    async (tabId) => {
      const tab = currentTabs?.find((item) => item.id === tabId)
      try {
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
        handleError(error, { suppressWorkbenchMessage: true })
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
    async (tabId, queryText, queryViewMode, documentEfficiencyMode) => {
      try {
        applyPayload(
          await desktopClient.updateQueryTab(
            tabId,
            queryText,
            queryViewMode,
            documentEfficiencyMode,
          ),
        )
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
        await saveQueryTabToCurrentTarget({ payload: state.payload, tabId, applyPayload })
      } catch (error) {
        handleError(error)
      }
    },
    [applyPayload, handleError, state.payload],
  )

  const saveAndCloseTab = useCallback<Actions['saveAndCloseTab']>(
    async (tabId) => {
      try {
        await saveQueryTabToCurrentTarget({
          payload: state.payload,
          tabId,
          applyPayload,
          closeAfterSave: true,
        })
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
      createApiServerTab,
      createMcpServerTab,
      createWorkspaceSearchTab,
      createSecurityChecksTab,
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
      createApiServerTab,
      createEnvironmentTab,
      createMcpServerTab,
      createWorkspaceSearchTab,
      createSecurityChecksTab,
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
