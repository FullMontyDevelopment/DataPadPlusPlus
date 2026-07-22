import type { BootstrapPayload, CreateObjectViewTabRequest, CreateScopedQueryTabRequest, QueryTabReorderRequest, QueryViewMode, UpdateQueryBuilderStateRequest, UpdateQueryTabTargetRequest } from '@datapadplusplus/shared-types'
import { resolveEnvironment } from '../../app/state/helpers'
import { closeQueryTab, createEnvironmentTabInSnapshot, createExplorerTabInSnapshot, createMetricsTabInSnapshot, createObjectViewTabInSnapshot, createQueryTabForConnection, createScopedQueryTabInSnapshot, renameQueryTab, reopenClosedQueryTab, reorderQueryTabsInSnapshot, updateQueryTabTargetInSnapshot, upsertTab } from './browser-tabs'
import { collectDiagnosticsLocally } from './browser-operation-inspection'
import { redactForEnvironment } from './browser-response-redaction'
import { buildBrowserPayload, cloneSnapshot, findConnection, findTab, loadBrowserSnapshot, saveBrowserSnapshot } from './browser-store'
import { redactErrorMessage } from '../../app/state/security-redaction'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'
import {
  validateCreateObjectViewTabRequest,
  validateCreateScopedQueryTabRequest,
  validateQueryTabReorderRequest,
  validateRequiredTabId,
  validateUpdateQueryBuilderStateRequest,
  validateUpdateQueryTabTargetRequest,
  validateUpdateQueryTabRequest,
} from './request-validation'
import { validateEnvironmentContextId, validateOptionalId, validateRequiredId, validateRequiredText } from './datastores/common/request-validation-core'

export const clientTabs = {
  async setActiveTab(tabId: string): Promise<BootstrapPayload> {
    validateRequiredTabId(tabId)
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
    validateRequiredTabId(tabId)
    validateEnvironmentContextId(environmentId)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_tab_environment', {
        tabId,
        environmentId,
      })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    const tab = findTab(next, tabId)
    const environment = next.environments.find((item) => item.id === environmentId)

    if (!tab || (environmentId && !environment)) {
      return buildBrowserPayload(next)
    }

    tab.environmentId = environment?.id ?? ''
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
    validateRequiredId(connectionId, 'Connection id')
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
    validateRequiredId(connectionId, 'Connection id')
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
    validateRequiredId(connectionId, 'Connection id')
    validateOptionalId(environmentId, 'Environment id')
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
    validateRequiredId(environmentId, 'Environment id')
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
    const normalizedRequest = validateCreateObjectViewTabRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_object_view_tab', {
        request: normalizedRequest,
      })
    }

    const snapshot = createObjectViewTabInSnapshot(loadBrowserSnapshot(), normalizedRequest)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async refreshObjectViewTab(tabId: string): Promise<BootstrapPayload> {
    validateRequiredTabId(tabId)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('refresh_object_view_tab', { tabId })
    }

    const next = cloneSnapshot(loadBrowserSnapshot())
    const tab = findTab(next, tabId)

    if (!tab || tab.tabKind !== 'object-view' || !tab.objectViewState) {
      return buildBrowserPayload(next)
    }

    try {
      const { inspectExplorerNodeLocally } = await import('./browser-explorer')
      const response = inspectExplorerNodeLocally(next, {
        connectionId: tab.connectionId,
        environmentId: tab.environmentId,
        nodeId: tab.objectViewState.nodeId,
      })
      const redactedResponse = redactForEnvironment(
        response,
        resolveEnvironment(next.environments, tab.environmentId),
      )
      const refreshedAt = new Date().toISOString()
      tab.objectViewState = {
        ...tab.objectViewState,
        summary: redactedResponse.summary,
        queryTemplate: redactedResponse.queryTemplate,
        payload: redactedResponse.payload,
        lastRefreshedAt: refreshedAt,
        warnings: [],
      }
      tab.status = 'success'
      tab.error = undefined
      tab.dirty = false
      tab.lastRunAt = refreshedAt
    } catch (error) {
      const message = redactErrorMessage(error, 'Unable to refresh object view.')
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
    validateRequiredTabId(tabId)
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
      const diagnostics = redactForEnvironment(
        response.diagnostics,
        resolveEnvironment(next.environments, tab.environmentId),
      )
      const refreshedAt = new Date().toISOString()
      tab.metricsState = {
        connectionId: tab.connectionId,
        environmentId: tab.environmentId,
        lastRefreshedAt: refreshedAt,
        diagnostics,
        warnings: diagnostics.warnings,
      }
      tab.status = 'success'
      tab.error = undefined
      tab.dirty = false
      tab.lastRunAt = refreshedAt
    } catch (error) {
      const message = redactErrorMessage(error, 'Unable to refresh metrics.')
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
    request = validateCreateScopedQueryTabRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_scoped_query_tab', { request })
    }

    const snapshot = createScopedQueryTabInSnapshot(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async closeQueryTab(tabId: string): Promise<BootstrapPayload> {
    validateRequiredTabId(tabId)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('close_query_tab', { tabId })
    }

    const snapshot = closeQueryTab(loadBrowserSnapshot(), tabId)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async reorderQueryTabs(orderedTabIds: string[]): Promise<BootstrapPayload> {
    const request: QueryTabReorderRequest = validateQueryTabReorderRequest({ orderedTabIds })

    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('reorder_query_tabs', { request })
    }

    const snapshot = reorderQueryTabsInSnapshot(loadBrowserSnapshot(), request)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async reopenClosedQueryTab(closedTabId: string): Promise<BootstrapPayload> {
    validateRequiredId(closedTabId, 'Closed tab id')
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
    documentEfficiencyMode?: boolean,
  ): Promise<BootstrapPayload> {
    validateUpdateQueryTabRequest({
      tabId,
      queryText,
      queryViewMode,
      documentEfficiencyMode,
    })
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_query_tab', {
        tabId,
        queryText,
        queryViewMode,
        documentEfficiencyMode,
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
      if (documentEfficiencyMode !== undefined) {
        tab.documentEfficiencyMode = documentEfficiencyMode
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
    request = validateUpdateQueryBuilderStateRequest(request)
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

  async updateQueryTarget(
    request: UpdateQueryTabTargetRequest,
  ): Promise<BootstrapPayload> {
    request = validateUpdateQueryTabTargetRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_query_tab_target', { request })
    }

    const next = updateQueryTabTargetInSnapshot(loadBrowserSnapshot(), request)

    saveBrowserSnapshot(next)
    return buildBrowserPayload(next)
  },

  async renameQueryTab(tabId: string, title: string): Promise<BootstrapPayload> {
    validateRequiredTabId(tabId)
    validateRequiredText(title, 'Tab title', 80)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('rename_query_tab', { tabId, title })
    }

    const snapshot = renameQueryTab(loadBrowserSnapshot(), tabId, title)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },
}
