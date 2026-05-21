import type { BootstrapPayload, CreateObjectViewTabRequest, CreateScopedQueryTabRequest, QueryTabReorderRequest, QueryViewMode, UpdateQueryBuilderStateRequest } from '@datapadplusplus/shared-types'
import { closeQueryTab, createEnvironmentTabInSnapshot, createExplorerTabInSnapshot, createMetricsTabInSnapshot, createObjectViewTabInSnapshot, createQueryTabForConnection, createScopedQueryTabInSnapshot, renameQueryTab, reopenClosedQueryTab, reorderQueryTabsInSnapshot, upsertTab } from './browser-tabs'
import { collectDiagnosticsLocally } from './browser-operation-inspection'
import { inspectExplorerNodeLocally } from './browser-explorer'
import { buildBrowserPayload, cloneSnapshot, findConnection, findTab, loadBrowserSnapshot, saveBrowserSnapshot } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'

export const clientTabs = {
  async setActiveTab(tabId: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_active_tab', { tabId })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    const tab = findTab(next, tabId)

    if (!tab) {
      return buildBrowserPayload(next)
    }

    next.ui.activeTabId = tab.id
    next.ui.activeConnectionId = tab.connectionId
    next.ui.activeEnvironmentId = tab.environmentId
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async setTabEnvironment(
    tabId: string,
    environmentId: string,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_tab_environment', {
        tabId,
        environmentId,
      })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    const tab = findTab(next, tabId)
    const environment = next.environments.find((item) => item.id === environmentId)

    if (!tab || !environment) {
      return buildBrowserPayload(next)
    }

    tab.environmentId = environment.id
    tab.status = 'idle'
    tab.error = undefined
    tab.result = undefined
    tab.lastRunAt = undefined
    next.ui.activeTabId = tab.id
    next.ui.activeConnectionId = tab.connectionId
    next.ui.activeEnvironmentId = tab.environmentId
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async createQueryTab(connectionId: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_query_tab', { connectionId })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    const connection = findConnection(next, connectionId)

    if (!connection) {
      return buildBrowserPayload(next)
    }

    const tab = createQueryTabForConnection(next, connection, true)
    const snapshot = upsertTab(next, tab)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async createExplorerTab(connectionId: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_explorer_tab', { connectionId })
    }

    const snapshot = createExplorerTabInSnapshot(loadBrowserSnapshot(), connectionId)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async createMetricsTab(
    connectionId: string,
    environmentId?: string,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_metrics_tab', {
        connectionId,
        environmentId,
      })
    }

    const snapshot = createMetricsTabInSnapshot(
      loadBrowserSnapshot(),
      connectionId,
      environmentId,
    )
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async createEnvironmentTab(environmentId: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_environment_tab', { environmentId })
    }

    const snapshot = createEnvironmentTabInSnapshot(loadBrowserSnapshot(), environmentId)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async createObjectViewTab(
    request: CreateObjectViewTabRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_object_view_tab', { request })
    }

    const snapshot = createObjectViewTabInSnapshot(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async refreshObjectViewTab(tabId: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('refresh_object_view_tab', { tabId })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    const tab = findTab(next, tabId)

    if (!tab || tab.tabKind !== 'object-view' || !tab.objectViewState) {
      return buildBrowserPayload(next)
    }

    try {
      const response = inspectExplorerNodeLocally(next, {
        connectionId: tab.connectionId,
        environmentId: tab.environmentId,
        nodeId: tab.objectViewState.nodeId,
      })
      const refreshedAt = new Date().toISOString()
      tab.objectViewState = {
        ...tab.objectViewState,
        summary: response.summary,
        queryTemplate: response.queryTemplate,
        payload: response.payload,
        lastRefreshedAt: refreshedAt,
        warnings: [],
      }
      tab.status = 'success'
      tab.error = undefined
      tab.dirty = false
      tab.lastRunAt = refreshedAt
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh object view.'
      tab.objectViewState = {
        ...tab.objectViewState,
        lastRefreshedAt: new Date().toISOString(),
        warnings: [message],
      }
      tab.status = 'error'
      tab.error = { code: 'object-view-refresh-failed', message }
      tab.dirty = false
    }

    next.ui.activeTabId = tab.id
    next.ui.activeConnectionId = tab.connectionId
    next.ui.activeEnvironmentId = tab.environmentId
    next.ui.rightDrawer = 'none'
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async refreshMetricsTab(tabId: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('refresh_metrics_tab', { tabId })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    const tab = findTab(next, tabId)

    if (!tab || tab.tabKind !== 'metrics') {
      return buildBrowserPayload(next)
    }

    try {
      const response = collectDiagnosticsLocally(next, {
        connectionId: tab.connectionId,
        environmentId: tab.environmentId,
        scope: 'connection',
      })
      const refreshedAt = new Date().toISOString()
      tab.metricsState = {
        connectionId: tab.connectionId,
        environmentId: tab.environmentId,
        lastRefreshedAt: refreshedAt,
        diagnostics: response.diagnostics,
        warnings: response.diagnostics.warnings,
      }
      tab.status = 'success'
      tab.error = undefined
      tab.dirty = false
      tab.lastRunAt = refreshedAt
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to refresh metrics.'
      tab.metricsState = {
        connectionId: tab.connectionId,
        environmentId: tab.environmentId,
        lastRefreshedAt: new Date().toISOString(),
        warnings: [message],
      }
      tab.status = 'error'
      tab.error = { code: 'metrics-refresh-failed', message }
      tab.dirty = false
    }

    next.ui.activeTabId = tab.id
    next.ui.activeConnectionId = tab.connectionId
    next.ui.activeEnvironmentId = tab.environmentId
    next.ui.rightDrawer = 'none'
    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async createScopedQueryTab(
    request: CreateScopedQueryTabRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_scoped_query_tab', { request })
    }

    const snapshot = createScopedQueryTabInSnapshot(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async closeQueryTab(tabId: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('close_query_tab', { tabId })
    }

    const snapshot = closeQueryTab(loadBrowserSnapshot(), tabId)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async reorderQueryTabs(orderedTabIds: string[]): Promise<BootstrapPayload> {
    const request: QueryTabReorderRequest = { orderedTabIds }

    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('reorder_query_tabs', { request })
    }

    const snapshot = reorderQueryTabsInSnapshot(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async reopenClosedQueryTab(closedTabId: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('reopen_closed_query_tab', {
        closedTabId,
      })
    }

    const snapshot = reopenClosedQueryTab(loadBrowserSnapshot(), closedTabId)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async updateQueryTab(
    tabId: string,
    queryText: string,
    queryViewMode?: QueryViewMode,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_query_tab', {
        tabId,
        queryText,
        queryViewMode,
      })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    const tab = findTab(next, tabId)

    if (tab) {
      if (queryViewMode === 'script') {
        tab.scriptText = queryText
      } else {
        tab.queryText = queryText
      }
      if (queryViewMode) {
        tab.queryViewMode = queryViewMode
      }
      tab.dirty = true
      tab.error = undefined
      if (!tab.result) {
        tab.status = 'idle'
        tab.lastRunAt = undefined
      }
    }

    next.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async updateQueryBuilderState(
    request: UpdateQueryBuilderStateRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_query_builder_state', { request })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    const tab = findTab(next, request.tabId)

    if (tab) {
      tab.builderState = request.builderState
      if (request.queryText !== undefined) {
        tab.queryText = request.queryText
      }
      if (request.queryViewMode) {
        tab.queryViewMode = request.queryViewMode
      }
      tab.dirty = true
      tab.error = undefined
      if (!tab.result) {
        tab.status = 'idle'
        tab.lastRunAt = undefined
      }
      next.updatedAt = new Date().toISOString()
    }

    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async renameQueryTab(tabId: string, title: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('rename_query_tab', { tabId, title })
    }

    const snapshot = renameQueryTab(loadBrowserSnapshot(), tabId, title)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },
}
