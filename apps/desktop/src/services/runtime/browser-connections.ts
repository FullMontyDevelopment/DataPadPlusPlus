import type { ConnectionProfile, EnvironmentProfile, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { sanitizeEnvironmentProfile } from '../../app/state/environment-variables'
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
  const connection = next.connections.find((item) => item.id === connectionId)

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
  const deleted = next.connections.some((connection) => connection.id === connectionId)

  if (!deleted) {
    return next
  }

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
  const safeProfile = sanitizeEnvironmentProfile(profile)
  const index = next.environments.findIndex((item) => item.id === safeProfile.id)

  if (index >= 0) {
    next.environments[index] = safeProfile
  } else {
    next.environments.push(safeProfile)
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

  next.environments = next.environments
    .filter((environment) => environment.id !== environmentId)
    .map((environment) =>
      environment.inheritsFrom === environmentId
        ? { ...environment, inheritsFrom: undefined, updatedAt: new Date().toISOString() }
        : environment,
    )

  next.connections = next.connections.map((connection) => {
    const environmentIds = connection.environmentIds.filter((id) => id !== environmentId)
    return {
      ...connection,
      environmentIds,
      updatedAt: new Date().toISOString(),
    }
  })

  next.tabs = next.tabs
    .filter((tab) => !(tab.tabKind === 'environment' && tab.environmentId === environmentId))
    .map((tab) =>
      tab.environmentId === environmentId
        ? clearEnvironmentReferences({ ...tab, environmentId: '' }, environmentId)
        : clearEnvironmentReferences(tab, environmentId),
    )
  next.closedTabs = next.closedTabs
    .filter((tab) => !(tab.tabKind === 'environment' && tab.environmentId === environmentId))
    .map((tab) =>
      tab.environmentId === environmentId
        ? clearEnvironmentReferences({ ...tab, environmentId: '' }, environmentId)
        : clearEnvironmentReferences(tab, environmentId),
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

  if (
    next.ui.activeEnvironmentId === environmentId ||
    !next.environments.some((environment) => environment.id === next.ui.activeEnvironmentId)
  ) {
    next.ui.activeEnvironmentId = ''
  }

  const apiPreferences = next.preferences.datastoreApiServer ?? {
    enabled: false,
    host: '127.0.0.1' as const,
    port: 17640,
    autoStart: false,
    servers: [],
  }
  next.preferences.datastoreApiServer = apiPreferences
  apiPreferences.environmentId =
    apiPreferences.environmentId === environmentId ? undefined : apiPreferences.environmentId
  apiPreferences.servers = apiPreferences.servers?.map((server) => ({
    ...server,
    environmentId: server.environmentId === environmentId ? undefined : server.environmentId,
  }))

  const connectionById = new Map(next.connections.map((connection) => [connection.id, connection]))
  const mcpPreferences = next.preferences.datastoreMcpServer ?? {
    enabled: false,
    host: '127.0.0.1' as const,
    port: 17641,
    autoStart: false,
    servers: [],
  }
  next.preferences.datastoreMcpServer = mcpPreferences
  mcpPreferences.servers =
    mcpPreferences.servers?.map((server) => {
      const environmentIds = server.environmentIds.filter((id) => id !== environmentId)
      return {
        ...server,
        environmentIds,
        connectionIds: server.connectionIds.filter((connectionId) => {
          const connection = connectionById.get(connectionId)
          return Boolean(
            connection &&
              (connection.environmentIds.some((id) => environmentIds.includes(id)) ||
                (server.allowNoEnvironment && connection.environmentIds.length === 0)),
          )
        }),
      }
    })

  if (!next.tabs.some((tab) => tab.id === next.ui.activeTabId)) {
    const activeTab = next.tabs[0]
    next.ui.activeTabId = activeTab?.id ?? ''
    next.ui.activeConnectionId = activeTab?.connectionId ?? next.ui.activeConnectionId
    next.ui.activeEnvironmentId = activeTab?.environmentId ?? next.ui.activeEnvironmentId
  }

  next.updatedAt = new Date().toISOString()
  return next
}

function clearEnvironmentReferences<T>(value: T, environmentId: string): T {
  if (Array.isArray(value)) {
    return value.map((item) => clearEnvironmentReferences(item, environmentId)) as T
  }
  if (!value || typeof value !== 'object') {
    return value
  }
  const next = { ...(value as Record<string, unknown>) }
  for (const [key, nested] of Object.entries(next)) {
    if (key === 'environmentId' && nested === environmentId) {
      next[key] = ''
    } else if (key === 'inheritsFrom' && nested === environmentId) {
      next[key] = undefined
    } else if (key === 'environmentIds' && Array.isArray(nested)) {
      next[key] = nested.filter((id) => id !== environmentId)
    } else {
      next[key] = clearEnvironmentReferences(nested, environmentId)
    }
  }
  return next as T
}
