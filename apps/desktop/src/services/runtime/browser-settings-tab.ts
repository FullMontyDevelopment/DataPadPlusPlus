import type { QueryTabState, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createId } from '../../app/state/helpers'
import { cloneSnapshot } from './browser-store'
import { upsertTab } from './browser-tabs'

export function createSettingsTabInSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const existingSettingsTab = next.tabs.find((tab) => tab.tabKind === 'settings')

  if (existingSettingsTab) {
    const focused = upsertTab(next, existingSettingsTab)
    focused.ui.activeActivity = 'library'
    focused.ui.activeSidebarPane = 'library'
    focused.ui.rightDrawer = 'none'
    return focused
  }

  const connection =
    next.connections.find((item) => item.id === next.ui.activeConnectionId) ?? next.connections[0]
  const environment =
    next.environments.find((item) => item.id === next.ui.activeEnvironmentId) ?? next.environments[0]
  const tab: QueryTabState = {
    id: createId('settings-tab'),
    title: 'Settings',
    tabKind: 'settings',
    connectionId: connection?.id ?? '',
    environmentId: environment?.id ?? '',
    family: connection?.family ?? 'sql',
    language: 'text',
    editorLabel: 'Settings',
    queryText: '',
    queryViewMode: undefined,
    scriptText: undefined,
    status: 'idle',
    dirty: false,
    history: [],
  }

  const focused = upsertTab(next, tab)
  focused.ui.activeActivity = 'library'
  focused.ui.activeSidebarPane = 'library'
  focused.ui.rightDrawer = 'none'
  return focused
}

export function createApiServerTabInSnapshot(
  snapshot: WorkspaceSnapshot,
  serverId?: string,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const configured = next.preferences.datastoreApiServer
  const selectedServer =
    (serverId ? configured?.servers?.find((server) => server.id === serverId) : undefined) ??
    configured?.servers?.find((server) => server.id === configured.activeServerId) ??
    configured?.servers?.[0]
  const selectedServerId = selectedServer?.id
  const existingApiServerTab = next.tabs.find((tab) =>
    tab.tabKind === 'api-server' &&
    apiServerTabServerId(tab) === selectedServerId
  )

  if (existingApiServerTab) {
    const focused = upsertTab(next, existingApiServerTab)
    focused.ui.activeActivity = 'library'
    focused.ui.activeSidebarPane = 'library'
    focused.ui.rightDrawer = 'none'
    return focused
  }

  const connection =
    next.connections.find((item) => item.id === selectedServer?.connectionId) ??
    next.connections.find((item) => item.id === configured?.connectionId) ??
    next.connections.find((item) => item.id === next.ui.activeConnectionId) ??
    next.connections[0]
  const environment =
    next.environments.find((item) => item.id === selectedServer?.environmentId) ??
    next.environments.find((item) => item.id === configured?.environmentId) ??
    next.environments.find((item) => item.id === next.ui.activeEnvironmentId) ??
    next.environments[0]
  const title = selectedServer?.name?.trim() || 'API Server'
  const tab: QueryTabState = {
    id: createId('api-server-tab'),
    title,
    tabKind: 'api-server',
    connectionId: connection?.id ?? '',
    environmentId: environment?.id ?? '',
    family: connection?.family ?? 'sql',
    language: 'json',
    editorLabel: 'API Server',
    queryText: '',
    queryViewMode: undefined,
    scriptText: undefined,
    scopedTarget: selectedServerId
      ? {
          kind: 'api-server',
          label: title,
          scope: selectedServerId,
        }
      : undefined,
    status: 'idle',
    dirty: false,
    history: [],
  }

  const focused = upsertTab(next, tab)
  focused.ui.activeActivity = 'library'
  focused.ui.activeSidebarPane = 'library'
  focused.ui.rightDrawer = 'none'
  return focused
}

function apiServerTabServerId(tab: QueryTabState) {
  return tab.scopedTarget?.kind === 'api-server' ? tab.scopedTarget.scope : undefined
}

export function createWorkspaceSearchTabInSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const existingSearchTab = next.tabs.find((tab) => tab.tabKind === 'workspace-search')

  if (existingSearchTab) {
    const focused = upsertTab(next, existingSearchTab)
    focused.ui.activeActivity = 'library'
    focused.ui.activeSidebarPane = 'library'
    focused.ui.rightDrawer = 'none'
    return focused
  }

  const connection =
    next.connections.find((item) => item.id === next.ui.activeConnectionId) ?? next.connections[0]
  const environment =
    next.environments.find((item) => item.id === next.ui.activeEnvironmentId) ?? next.environments[0]
  const tab: QueryTabState = {
    id: createId('workspace-search-tab'),
    title: 'Search',
    tabKind: 'workspace-search',
    connectionId: connection?.id ?? '',
    environmentId: environment?.id ?? '',
    family: connection?.family ?? 'sql',
    language: 'text',
    editorLabel: 'Search',
    queryText: '',
    queryViewMode: undefined,
    scriptText: undefined,
    status: 'idle',
    dirty: false,
    history: [],
  }

  const focused = upsertTab(next, tab)
  focused.ui.activeActivity = 'library'
  focused.ui.activeSidebarPane = 'library'
  focused.ui.rightDrawer = 'none'
  return focused
}
