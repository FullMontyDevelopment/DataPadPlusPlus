import type { ConnectionProfile, EnvironmentProfile, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { cloneSnapshot } from './browser-store'
import { createQueryTabForConnection } from './browser-tabs'
import {
  effectiveConnectionEnvironmentId,
  ensureConnectionLibraryNodes,
  removeConnectionLibraryNodes,
} from './library-connection-helpers'

export function setActiveConnection(
  snapshot: WorkspaceSnapshot,
  connectionId: string,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const connection =
    next.connections.find((item) => item.id === connectionId) ?? next.connections[0]

  if (!connection) {
    return next
  }

  const tab = next.tabs.find((item) => item.connectionId === connection.id)

  next.ui.activeConnectionId = connection.id
  next.ui.activeEnvironmentId =
    tab?.environmentId ?? effectiveConnectionEnvironmentId(next, connection)
  next.ui.activeTabId = tab?.id ?? ''
  next.updatedAt = new Date().toISOString()
  return next
}



export function upsertConnection(
  snapshot: WorkspaceSnapshot,
  profile: ConnectionProfile,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const index = next.connections.findIndex((item) => item.id === profile.id)

  if (index >= 0) {
    next.connections[index] = profile
  } else {
    next.connections.push(profile)
  }

  ensureConnectionLibraryNodes(next)
  next.updatedAt = new Date().toISOString()
  return next
}



export function deleteConnection(
  snapshot: WorkspaceSnapshot,
  connectionId: string,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)

  next.connections = next.connections.filter((connection) => connection.id !== connectionId)
  next.tabs = next.tabs.filter((tab) => tab.connectionId !== connectionId)
  removeConnectionLibraryNodes(next, connectionId)

  if (next.tabs.length === 0 && next.connections[0]) {
    const connection = next.connections[0]
    next.tabs.push(createQueryTabForConnection(next, connection, false))
  }

  const activeTab =
    next.tabs.find((tab) => tab.id === next.ui.activeTabId) ?? next.tabs[0]

  if (activeTab) {
    next.ui.activeConnectionId = activeTab.connectionId
    next.ui.activeEnvironmentId = activeTab.environmentId
    next.ui.activeTabId = activeTab.id
  } else {
    next.ui.activeConnectionId = ''
    next.ui.activeEnvironmentId = ''
    next.ui.activeTabId = ''
    next.ui.bottomPanelVisible = false
    next.ui.rightDrawer = 'none'
  }

  next.updatedAt = new Date().toISOString()
  return next
}



export function upsertEnvironment(
  snapshot: WorkspaceSnapshot,
  profile: EnvironmentProfile,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const index = next.environments.findIndex((item) => item.id === profile.id)

  if (index >= 0) {
    next.environments[index] = profile
  } else {
    next.environments.push(profile)
  }

  next.updatedAt = new Date().toISOString()
  return next
}

export function deleteEnvironment(
  snapshot: WorkspaceSnapshot,
  environmentId: string,
): WorkspaceSnapshot {
  const next = cloneSnapshot(snapshot)
  const deleted = next.environments.some((environment) => environment.id === environmentId)

  if (!deleted) {
    throw new Error('Environment was not found.')
  }

  if (next.environments.length <= 1) {
    throw new Error('At least one environment is required.')
  }

  next.environments = next.environments
    .filter((environment) => environment.id !== environmentId)
    .map((environment) =>
      environment.inheritsFrom === environmentId
        ? { ...environment, inheritsFrom: undefined, updatedAt: new Date().toISOString() }
        : environment,
    )

  const fallbackEnvironmentId =
    next.environments.find((environment) => environment.id !== environmentId)?.id ?? ''

  next.connections = next.connections.map((connection) => {
    const environmentIds = connection.environmentIds.filter((id) => id !== environmentId)
    return {
      ...connection,
      environmentIds: environmentIds.length > 0 ? environmentIds : [fallbackEnvironmentId],
      updatedAt: new Date().toISOString(),
    }
  })

  next.tabs = next.tabs.map((tab) =>
    tab.environmentId === environmentId
      ? { ...tab, environmentId: fallbackEnvironmentId }
      : tab,
  )
  next.closedTabs = next.closedTabs.map((tab) =>
    tab.environmentId === environmentId ? { ...tab, environmentId: fallbackEnvironmentId } : tab,
  )
  next.libraryNodes = next.libraryNodes.map((node) =>
    node.environmentId === environmentId
      ? { ...node, environmentId: undefined, updatedAt: new Date().toISOString() }
      : node,
  )
  next.savedWork = next.savedWork.map((item) =>
    item.environmentId === environmentId
      ? { ...item, environmentId: undefined, updatedAt: new Date().toISOString() }
      : item,
  )

  if (next.ui.activeEnvironmentId === environmentId) {
    next.ui.activeEnvironmentId = fallbackEnvironmentId
  }

  next.updatedAt = new Date().toISOString()
  return next
}
