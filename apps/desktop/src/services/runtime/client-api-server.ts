import type {
  BootstrapPayload,
  DatastoreApiServerLogs,
  DatastoreApiServerLogsRequest,
  DatastoreApiServerMetrics,
  DatastoreApiServerDeleteRequest,
  DatastoreApiServerConfig,
  DatastoreApiServerSettingsRequest,
  DatastoreApiServerStartRequest,
  DatastoreApiServerStatus,
  DatastoreApiServerStopRequest,
} from '@datapadplusplus/shared-types'
import { buildBrowserPayload, cloneSnapshot, loadBrowserSnapshot, saveBrowserSnapshot } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'

export const clientApiServer = {
  async getDatastoreApiServerStatus(): Promise<DatastoreApiServerStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreApiServerStatus>('get_datastore_api_server_status')
    }

    return browserApiServerStatus()
  },

  async getDatastoreApiServerMetrics(): Promise<DatastoreApiServerMetrics> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreApiServerMetrics>('get_datastore_api_server_metrics')
    }

    return browserApiServerMetrics()
  },

  async getDatastoreApiServerLogs(
    request: DatastoreApiServerLogsRequest = {},
  ): Promise<DatastoreApiServerLogs> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreApiServerLogs>('get_datastore_api_server_logs', { request })
    }

    return browserApiServerLogs()
  },

  async updateDatastoreApiServerSettings(
    request: DatastoreApiServerSettingsRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_datastore_api_server_settings', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    snapshot.preferences.datastoreApiServer = {
      enabled: request.enabled,
      host: '127.0.0.1',
      ...upsertBrowserServer(snapshot.preferences.datastoreApiServer, request),
    }
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async startDatastoreApiServer(
    request: DatastoreApiServerStartRequest,
  ): Promise<DatastoreApiServerStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreApiServerStatus>('start_datastore_api_server', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreApiServer
    snapshot.preferences.datastoreApiServer = {
      enabled: existing?.enabled ?? true,
      host: '127.0.0.1',
      ...upsertBrowserServer(existing, {
        enabled: existing?.enabled ?? true,
        serverId: request.serverId,
        activeServerId: request.serverId,
        port: request.port,
        connectionId: request.connectionId,
        environmentId: request.environmentId,
      }),
    }
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    const status = browserApiServerStatus()
    return {
      ...status,
      running: false,
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      message: 'The experimental API server can only run in the desktop app.',
      warnings: ['Browser preview cannot open local listener ports.'],
    }
  },

  async stopDatastoreApiServer(
    request: DatastoreApiServerStopRequest = {},
  ): Promise<DatastoreApiServerStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreApiServerStatus>('stop_datastore_api_server', { request })
    }

    return browserApiServerStatus()
  },

  async deleteDatastoreApiServer(
    request: DatastoreApiServerDeleteRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('delete_datastore_api_server', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreApiServer
    const remaining = browserServers(existing).filter((server) => server.id !== request.serverId)
    const servers = remaining.length > 0 ? remaining : [defaultBrowserServer()]
    const activeServerId =
      existing?.activeServerId && servers.some((server) => server.id === existing.activeServerId)
        ? existing.activeServerId
        : servers[0]?.id
    const active = servers.find((server) => server.id === activeServerId) ?? servers[0]
    snapshot.preferences.datastoreApiServer = {
      enabled: Boolean(existing?.enabled),
      host: '127.0.0.1',
      port: active?.port ?? 17640,
      autoStart: Boolean(active?.autoStart),
      connectionId: active?.connectionId,
      environmentId: active?.environmentId,
      activeServerId,
      servers,
    }
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },
}

function browserApiServerStatus(): DatastoreApiServerStatus {
  const preferences = loadBrowserSnapshot().preferences.datastoreApiServer
  const enabled = Boolean(preferences?.enabled)
  const servers = browserServers(preferences)
  const activeServerId =
    preferences?.activeServerId && servers.some((server) => server.id === preferences.activeServerId)
      ? preferences.activeServerId
      : servers[0]?.id
  const active = servers.find((server) => server.id === activeServerId) ?? servers[0]
  const port = clampPort(active?.port ?? preferences?.port ?? 17640)
  const serverStatuses = servers.map((server) => ({
    id: server.id,
    name: server.name,
    running: false,
    host: '127.0.0.1' as const,
    port: clampPort(server.port),
    baseUrl: enabled ? `http://127.0.0.1:${clampPort(server.port)}` : undefined,
    connectionId: server.connectionId,
    environmentId: server.environmentId,
    message: enabled
      ? 'The experimental API server is stopped in browser preview.'
      : 'The experimental API server is disabled.',
    warnings: enabled ? ['Browser preview cannot open local listener ports.'] : [],
  }))
  return {
    enabled,
    running: false,
    host: '127.0.0.1',
    port,
    baseUrl: enabled ? `http://127.0.0.1:${port}` : undefined,
    connectionId: active?.connectionId,
    environmentId: active?.environmentId,
    serverId: active?.id,
    name: active?.name,
    activeServerId,
    message: enabled
      ? 'The experimental API server is stopped in browser preview.'
      : 'The experimental API server is disabled.',
    warnings: enabled ? ['Browser preview cannot open local listener ports.'] : [],
    servers: serverStatuses,
  }
}

function browserApiServerMetrics(): DatastoreApiServerMetrics {
  const status = browserApiServerStatus()
  return {
    running: false,
    generatedAt: new Date().toISOString(),
    connectionId: status.connectionId,
    environmentId: status.environmentId,
    totalRequests: 0,
    totalErrors: 0,
    requestBytes: 0,
    responseBytes: 0,
    routes: [],
    retention: {
      routeSamples: 256,
      logs: 500,
    },
  }
}

function browserApiServerLogs(): DatastoreApiServerLogs {
  return {
    running: false,
    generatedAt: new Date().toISOString(),
    totalRetained: 0,
    entries: [],
  }
}

function clampPort(value: number) {
  if (!Number.isFinite(value)) return 17640
  return Math.min(65535, Math.max(1024, Math.floor(value)))
}

function defaultBrowserServer(): DatastoreApiServerConfig {
  return {
    id: 'api-server-default',
    name: 'Local API Server',
    host: '127.0.0.1',
    port: 17640,
    autoStart: false,
  }
}

function browserServers(
  preferences: ReturnType<typeof loadBrowserSnapshot>['preferences']['datastoreApiServer'],
): DatastoreApiServerConfig[] {
  const servers = preferences?.servers?.length
    ? preferences.servers
    : [{
        ...defaultBrowserServer(),
        id: preferences?.activeServerId || 'api-server-default',
        port: clampPort(preferences?.port ?? 17640),
        autoStart: Boolean(preferences?.autoStart),
        connectionId: preferences?.connectionId,
        environmentId: preferences?.environmentId,
      }]

  return servers.map((server, index) => ({
    id: server.id || `api-server-${index + 1}`,
    name: server.name?.trim() || defaultBrowserServerName(server.port),
    host: '127.0.0.1',
    port: clampPort(server.port),
    autoStart: Boolean(server.autoStart),
    connectionId: server.connectionId,
    environmentId: server.environmentId,
  }))
}

function upsertBrowserServer(
  preferences: ReturnType<typeof loadBrowserSnapshot>['preferences']['datastoreApiServer'],
  request: DatastoreApiServerSettingsRequest,
) {
  const servers = browserServers(preferences)
  const selectedId =
    request.activeServerId ||
    request.serverId ||
    preferences?.activeServerId ||
    servers[0]?.id ||
    `api-server-${Date.now()}`
  const index = servers.findIndex((server) => server.id === selectedId)
  const existingServer = index >= 0 ? servers[index] : undefined
  const port = clampPort(request.port ?? existingServer?.port ?? 17640)
  const nextServer: DatastoreApiServerConfig = {
    ...(existingServer ?? defaultBrowserServer()),
    id: selectedId,
    name: request.name?.trim() || existingServer?.name || defaultBrowserServerName(port),
    host: '127.0.0.1',
    port,
    autoStart: Boolean(request.autoStart ?? existingServer?.autoStart ?? false),
    connectionId:
      request.connectionId !== undefined
        ? request.connectionId || undefined
        : existingServer?.connectionId,
    environmentId:
      request.environmentId !== undefined
        ? request.environmentId || undefined
        : existingServer?.environmentId,
  }
  const nextServers =
    index >= 0
      ? servers.map((server) => (server.id === selectedId ? nextServer : server))
      : [...servers, nextServer]

  return {
    port: nextServer.port,
    autoStart: nextServer.autoStart,
    connectionId: nextServer.connectionId,
    environmentId: nextServer.environmentId,
    activeServerId: nextServer.id,
    servers: nextServers,
  }
}

function defaultBrowserServerName(port: number) {
  const safePort = clampPort(port)
  return safePort === 17640 ? 'Local API Server' : `Local API Server ${safePort}`
}
