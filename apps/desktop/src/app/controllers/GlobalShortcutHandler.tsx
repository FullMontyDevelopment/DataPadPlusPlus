import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type {
  AppShortcutId,
  ExecutionRequest,
  QueryTabState,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'
import { shortcutMatchesEvent } from '../keyboard-shortcuts'
import type { Actions } from '../state/app-state-types'

export interface GlobalShortcutHandlerProps {
  actions: Pick<Actions, 'reopenClosedTab' | 'updateUiState'>
  activeConnectionId?: string
  activeTab?: QueryTabState
  activeTabIsEnvironment: boolean
  activeTabIsApiServer: boolean
  activeTabIsMcpServer: boolean
  activeTabIsSecurityChecks: boolean
  activeTabIsExplorer: boolean
  activeTabIsMetrics: boolean
  activeTabIsObjectView: boolean
  activeTabIsSettings: boolean
  activeTabIsTestSuite: boolean
  activeTabIsWorkspaceSearch: boolean
  bottomPanelVisibleRef: MutableRefObject<boolean>
  keyboardShortcuts: Record<AppShortcutId, string>
  openQueryTab(connectionId: string | undefined): void
  requestCloseTab(tabId: string): void
  requestSaveQuery(tabId: string): void
  runCurrentTabQuery(mode?: ExecutionRequest['mode']): void
  snapshot: WorkspaceSnapshot
}

export function GlobalShortcutHandler({
  actions,
  activeConnectionId,
  activeTab,
  activeTabIsEnvironment,
  activeTabIsApiServer,
  activeTabIsMcpServer,
  activeTabIsSecurityChecks,
  activeTabIsExplorer,
  activeTabIsMetrics,
  activeTabIsObjectView,
  activeTabIsSettings,
  activeTabIsTestSuite,
  activeTabIsWorkspaceSearch,
  bottomPanelVisibleRef,
  keyboardShortcuts,
  openQueryTab,
  requestCloseTab,
  requestSaveQuery,
  runCurrentTabQuery,
  snapshot,
}: GlobalShortcutHandlerProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (shortcutMatchesEvent(event, keyboardShortcuts.refresh)) {
        event.preventDefault()
        if (activeTab && !activeTabIsExplorer && !activeTabIsEnvironment && !activeTabIsSettings && !activeTabIsApiServer && !activeTabIsMcpServer && !activeTabIsWorkspaceSearch && !activeTabIsSecurityChecks) {
          runCurrentTabQuery()
        }
        return
      }

      if (!activeTab) return

      if (shortcutMatchesEvent(event, keyboardShortcuts.saveQuery)) {
        event.preventDefault()
        if (!activeTabIsExplorer && !activeTabIsMetrics && !activeTabIsObjectView && !activeTabIsSettings && !activeTabIsApiServer && !activeTabIsMcpServer && !activeTabIsWorkspaceSearch && !activeTabIsSecurityChecks) {
          requestSaveQuery(activeTab.id)
        }
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.runQuery)) {
        event.preventDefault()
        if (!activeTabIsExplorer && !activeTabIsEnvironment && !activeTabIsSettings && !activeTabIsApiServer && !activeTabIsMcpServer && !activeTabIsWorkspaceSearch && !activeTabIsSecurityChecks) {
          runCurrentTabQuery()
        }
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.togglePanel)) {
        event.preventDefault()
        const bottomPanelVisible = !bottomPanelVisibleRef.current
        bottomPanelVisibleRef.current = bottomPanelVisible
        void actions.updateUiState({ bottomPanelVisible })
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.toggleSidebar)) {
        event.preventDefault()
        void actions.updateUiState({ sidebarCollapsed: !snapshot.ui.sidebarCollapsed })
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.newQuery)) {
        event.preventDefault()
        openQueryTab(activeConnectionId)
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.closeTab)) {
        event.preventDefault()
        requestCloseTab(activeTab.id)
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.reopenClosedTab)) {
        event.preventDefault()
        const closedTab = snapshot.closedTabs.at(-1)
        if (closedTab) void actions.reopenClosedTab(closedTab.id)
        return
      }

      if (shortcutMatchesEvent(event, keyboardShortcuts.explainQuery)) {
        event.preventDefault()
        if (!activeTabIsExplorer && !activeTabIsMetrics && !activeTabIsObjectView && !activeTabIsTestSuite && !activeTabIsEnvironment && !activeTabIsSettings && !activeTabIsApiServer && !activeTabIsMcpServer && !activeTabIsWorkspaceSearch && !activeTabIsSecurityChecks) {
          runCurrentTabQuery('explain')
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [actions, activeConnectionId, activeTab, activeTabIsApiServer, activeTabIsMcpServer, activeTabIsSecurityChecks, activeTabIsEnvironment, activeTabIsExplorer, activeTabIsMetrics, activeTabIsObjectView, activeTabIsSettings, activeTabIsTestSuite, activeTabIsWorkspaceSearch, bottomPanelVisibleRef, keyboardShortcuts, openQueryTab, requestCloseTab, requestSaveQuery, runCurrentTabQuery, snapshot])

  return null
}
