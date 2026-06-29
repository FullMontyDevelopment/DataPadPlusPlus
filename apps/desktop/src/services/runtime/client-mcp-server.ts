import type {
  BootstrapPayload,
  DatastoreMcpClientSetupApplyRequest,
  DatastoreMcpClientSetupApplyResponse,
  DatastoreMcpClientSetupPreview,
  DatastoreMcpClientSetupRequest,
  DatastoreMcpServerConfig,
  DatastoreMcpServerCreateRequest,
  DatastoreMcpServerDeleteRequest,
  DatastoreMcpServerLogs,
  DatastoreMcpServerLogsRequest,
  DatastoreMcpServerMetrics,
  DatastoreMcpServerPreferences,
  DatastoreMcpServerSettingsRequest,
  DatastoreMcpServerStartRequest,
  DatastoreMcpServerStatus,
  DatastoreMcpServerStopRequest,
  DatastoreMcpServerTokenConfig,
  DatastoreMcpServerTokenCreateRequest,
  DatastoreMcpServerTokenCreateResponse,
  DatastoreMcpServerTokenDeleteRequest,
  DatastoreMcpServerUpdateRequest,
} from '@datapadplusplus/shared-types'
import { DATASTORE_MCP_SERVER_SCOPES } from '@datapadplusplus/shared-types'
import { createId } from '../../app/state/helpers'
import { buildBrowserPayload, cloneSnapshot, loadBrowserSnapshot, saveBrowserSnapshot } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'

const MCP_HOST = '127.0.0.1' as const
const DEFAULT_MCP_PORT = 17641

export const clientMcpServer = {
  async getDatastoreMcpServerStatus(): Promise<DatastoreMcpServerStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreMcpServerStatus>('get_datastore_mcp_server_status')
    }

    return browserMcpServerStatus()
  },

  async getDatastoreMcpServerMetrics(): Promise<DatastoreMcpServerMetrics> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreMcpServerMetrics>('get_datastore_mcp_server_metrics')
    }

    return browserMcpServerMetrics()
  },

  async getDatastoreMcpServerLogs(
    request: DatastoreMcpServerLogsRequest = {},
  ): Promise<DatastoreMcpServerLogs> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreMcpServerLogs>('get_datastore_mcp_server_logs', { request })
    }

    return browserMcpServerLogs()
  },

  async createDatastoreMcpServer(
    request: DatastoreMcpServerCreateRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_datastore_mcp_server', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreMcpServer
    const servers = browserServers(existing)
    const port = clampPort(request.port ?? nextAvailableBrowserPort(servers))
    const server = normalizeBrowserServer({
      id: createId('mcp-server'),
      name: request.name?.trim() || defaultBrowserServerName(port),
      description: request.description,
      host: MCP_HOST,
      port,
      autoStart: Boolean(request.autoStart),
      allowedOrigins: request.allowedOrigins ?? [],
      connectionIds: request.connectionIds ?? [],
      environmentIds: request.environmentIds ?? [],
      tokens: [],
    }, servers.length)
    snapshot.preferences.datastoreMcpServer = browserPreferencesFromServers(existing, [...servers, server], server.id)
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async updateDatastoreMcpServer(
    request: DatastoreMcpServerUpdateRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_datastore_mcp_server', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreMcpServer
    const nextServers = browserServers(existing).map((server, index) =>
      server.id === request.serverId
        ? normalizeBrowserServer({
            ...server,
            name: request.name ?? server.name,
            description: request.description !== undefined ? request.description : server.description,
            port: request.port ?? server.port,
            autoStart: request.autoStart ?? server.autoStart,
            allowedOrigins: request.allowedOrigins ?? server.allowedOrigins,
            connectionIds: request.connectionIds ?? server.connectionIds,
            environmentIds: request.environmentIds ?? server.environmentIds,
          }, index)
        : server,
    )
    snapshot.preferences.datastoreMcpServer = browserPreferencesFromServers(existing, nextServers, request.serverId)
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async updateDatastoreMcpServerSettings(
    request: DatastoreMcpServerSettingsRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_datastore_mcp_server_settings', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    snapshot.preferences.datastoreMcpServer = browserRequestUpdatesServer(
      snapshot.preferences.datastoreMcpServer,
      request,
    )
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async startDatastoreMcpServer(
    request: DatastoreMcpServerStartRequest,
  ): Promise<DatastoreMcpServerStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreMcpServerStatus>('start_datastore_mcp_server', { request })
    }

    return browserMcpServerStatus()
  },

  async stopDatastoreMcpServer(
    request: DatastoreMcpServerStopRequest = {},
  ): Promise<DatastoreMcpServerStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreMcpServerStatus>('stop_datastore_mcp_server', { request })
    }

    return browserMcpServerStatus()
  },

  async deleteDatastoreMcpServer(
    request: DatastoreMcpServerDeleteRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('delete_datastore_mcp_server', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreMcpServer
    const servers = browserServers(existing).filter((server) => server.id !== request.serverId)
    snapshot.preferences.datastoreMcpServer = browserPreferencesFromServers(
      existing,
      servers,
      servers[0]?.id,
    )
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async createDatastoreMcpServerToken(
    request: DatastoreMcpServerTokenCreateRequest,
  ): Promise<DatastoreMcpServerTokenCreateResponse> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreMcpServerTokenCreateResponse>('create_datastore_mcp_server_token', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreMcpServer
    const tokenId = createId('mcp-token')
    const createdAt = new Date().toISOString()
    const config: DatastoreMcpServerTokenConfig = {
      id: tokenId,
      label: request.label?.trim() || 'Browser preview auth token',
      enabled: true,
      scopes: request.scopes?.length ? request.scopes : [...DATASTORE_MCP_SERVER_SCOPES],
      verifierSecretRef: {
        id: `browser-preview-${tokenId}`,
        provider: 'session',
        service: 'browser-preview',
        account: tokenId,
        label: 'Unavailable in browser preview',
      },
      createdAt,
    }
    const servers = browserServers(existing).map((server, index) =>
      server.id === request.serverId
        ? normalizeBrowserServer({
            ...server,
            tokens: [...(server.tokens ?? []), config],
          }, index)
        : server,
    )
    snapshot.preferences.datastoreMcpServer = browserPreferencesFromServers(existing, servers, request.serverId)
    snapshot.updatedAt = createdAt
    saveBrowserSnapshot(snapshot)
    return {
      serverId: request.serverId,
      tokenId,
      token: '',
      config,
      status: browserMcpServerStatus(),
    }
  },

  async deleteDatastoreMcpServerToken(
    request: DatastoreMcpServerTokenDeleteRequest,
  ): Promise<DatastoreMcpServerStatus> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreMcpServerStatus>('delete_datastore_mcp_server_token', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreMcpServer
    const servers = browserServers(existing).map((server, index) =>
      server.id === request.serverId
        ? normalizeBrowserServer({
            ...server,
            tokens: (server.tokens ?? []).filter((token) => token.id !== request.tokenId),
          }, index)
        : server,
    )
    snapshot.preferences.datastoreMcpServer = browserPreferencesFromServers(existing, servers, request.serverId)
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return browserMcpServerStatus()
  },

  async previewDatastoreMcpClientSetup(
    request: DatastoreMcpClientSetupRequest,
  ): Promise<DatastoreMcpClientSetupPreview> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreMcpClientSetupPreview>('preview_datastore_mcp_client_setup', { request })
    }

    return browserMcpClientSetupPreview(request)
  },

  async applyDatastoreMcpClientSetup(
    request: DatastoreMcpClientSetupApplyRequest,
  ): Promise<DatastoreMcpClientSetupApplyResponse> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreMcpClientSetupApplyResponse>('apply_datastore_mcp_client_setup', { request })
    }

    return {
      ...browserMcpClientSetupPreview(request),
      previewId: request.previewId,
      applied: false,
      changeSummary: 'Automatic MCP client setup is unavailable in browser preview.',
    }
  },
}

function browserMcpServerStatus(): DatastoreMcpServerStatus {
  const preferences = loadBrowserSnapshot().preferences.datastoreMcpServer
  const servers = browserServers(preferences)
  const activeId = preferences?.activeServerId && servers.some((server) => server.id === preferences.activeServerId)
    ? preferences.activeServerId
    : servers[0]?.id
  const statuses = servers.map((server) => browserServerStatus(server, Boolean(preferences?.enabled)))
  const active = statuses.find((server) => server.id === activeId) ?? statuses[0]
  if (active) {
    return {
      enabled: Boolean(preferences?.enabled),
      running: false,
      host: MCP_HOST,
      port: active.port,
      endpoint: active.endpoint,
      serverId: active.id,
      name: active.name,
      description: active.description,
      activeServerId: active.id,
      message: 'MCP server is desktop-only and unavailable in browser preview.',
      warnings: browserWarnings(),
      allowedOrigins: active.allowedOrigins,
      connectionIds: active.connectionIds,
      environmentIds: active.environmentIds,
      tokenCount: active.tokenCount,
      servers: statuses,
    }
  }
  return {
    enabled: Boolean(preferences?.enabled),
    running: false,
    host: MCP_HOST,
    port: preferences?.port ?? DEFAULT_MCP_PORT,
    message: preferences?.enabled
      ? 'No MCP servers are configured.'
      : 'Experimental MCP server is disabled.',
    warnings: preferences?.enabled ? browserWarnings() : [],
    allowedOrigins: [],
    connectionIds: [],
    environmentIds: [],
    tokenCount: 0,
    servers: [],
  }
}

function browserServerStatus(server: DatastoreMcpServerConfig, enabled: boolean) {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    running: false,
    host: MCP_HOST,
    port: server.port,
    endpoint: enabled ? `http://${MCP_HOST}:${server.port}/mcp` : undefined,
    message: enabled
      ? 'MCP server is desktop-only and unavailable in browser preview.'
      : 'Experimental MCP server is disabled.',
    warnings: enabled ? browserWarnings() : [],
    allowedOrigins: server.allowedOrigins ?? [],
    connectionIds: server.connectionIds ?? [],
    environmentIds: server.environmentIds ?? [],
    tokenCount: (server.tokens ?? []).filter((token) => token.enabled).length,
  }
}

function browserMcpServerMetrics(): DatastoreMcpServerMetrics {
  return {
    running: false,
    generatedAt: new Date().toISOString(),
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

function browserMcpServerLogs(): DatastoreMcpServerLogs {
  return {
    running: false,
    generatedAt: new Date().toISOString(),
    totalRetained: 0,
    entries: [],
  }
}

function browserMcpClientSetupPreview(
  request: DatastoreMcpClientSetupRequest,
): DatastoreMcpClientSetupPreview {
  return {
    clientId: request.clientId,
    scope: request.scope,
    endpoint: request.endpoint,
    targetPath: 'Desktop app required',
    targetExists: false,
    canApply: false,
    previewId: `browser-preview-${request.clientId}`,
    changeSummary: 'Automatic MCP client setup is available only in the desktop app.',
    proposedSnippet: '',
    warnings: browserWarnings(),
  }
}

function browserServers(preferences: DatastoreMcpServerPreferences | undefined): DatastoreMcpServerConfig[] {
  const servers = preferences?.servers?.length
    ? preferences.servers
    : preferences?.activeServerId
      ? [{
          id: preferences.activeServerId,
          name: 'Local MCP Server',
          host: MCP_HOST,
          port: preferences.port ?? DEFAULT_MCP_PORT,
          autoStart: Boolean(preferences.autoStart),
          allowedOrigins: [],
          connectionIds: [],
          environmentIds: [],
          tokens: [],
        }]
      : []
  return servers.map(normalizeBrowserServer)
}

function browserRequestUpdatesServer(
  preferences: DatastoreMcpServerPreferences | undefined,
  request: DatastoreMcpServerSettingsRequest,
): DatastoreMcpServerPreferences {
  const servers = browserServers(preferences)
  const selectedId = request.activeServerId ?? request.serverId ?? preferences?.activeServerId ?? servers[0]?.id
  const updatesServer =
    Boolean(selectedId) ||
    request.name !== undefined ||
    request.description !== undefined ||
    request.port !== undefined ||
    request.autoStart !== undefined ||
    request.allowedOrigins !== undefined ||
    request.connectionIds !== undefined ||
    request.environmentIds !== undefined
  let nextServers = servers
  if (updatesServer) {
    const existingIndex = servers.findIndex((server) => server.id === selectedId)
    if (existingIndex >= 0) {
      nextServers = servers.map((server, index) =>
        index === existingIndex
          ? normalizeBrowserServer({
              ...server,
              name: request.name ?? server.name,
              description: request.description !== undefined ? request.description : server.description,
              port: request.port ?? server.port,
              autoStart: request.autoStart ?? server.autoStart,
              allowedOrigins: request.allowedOrigins ?? server.allowedOrigins,
              connectionIds: request.connectionIds ?? server.connectionIds,
              environmentIds: request.environmentIds ?? server.environmentIds,
            }, index)
          : server,
      )
    } else {
      const port = clampPort(request.port ?? DEFAULT_MCP_PORT)
      nextServers = [
        ...servers,
        normalizeBrowserServer({
          id: selectedId || createId('mcp-server'),
          name: request.name?.trim() || defaultBrowserServerName(port),
          description: request.description,
          host: MCP_HOST,
          port,
          autoStart: Boolean(request.autoStart),
          allowedOrigins: request.allowedOrigins ?? [],
          connectionIds: request.connectionIds ?? [],
          environmentIds: request.environmentIds ?? [],
          tokens: [],
        }, servers.length),
      ]
    }
  }
  return browserPreferencesFromServers(
    {
      enabled: Boolean(preferences?.enabled),
      host: MCP_HOST,
      port: preferences?.port ?? DEFAULT_MCP_PORT,
      autoStart: Boolean(preferences?.autoStart),
      activeServerId: preferences?.activeServerId,
      servers,
    },
    nextServers,
    selectedId,
    request,
  )
}

function browserPreferencesFromServers(
  existing: DatastoreMcpServerPreferences | undefined,
  servers: DatastoreMcpServerConfig[],
  activeServerId?: string,
  request?: Partial<DatastoreMcpServerSettingsRequest>,
): DatastoreMcpServerPreferences {
  const normalizedServers = servers.map(normalizeBrowserServer)
  const active = normalizedServers.find((server) => server.id === activeServerId) ?? normalizedServers[0]
  return {
    enabled: request?.enabled ?? Boolean(existing?.enabled),
    host: MCP_HOST,
    port: active?.port ?? request?.port ?? existing?.port ?? DEFAULT_MCP_PORT,
    autoStart: active?.autoStart ?? request?.autoStart ?? existing?.autoStart ?? false,
    activeServerId: active?.id,
    servers: normalizedServers,
  }
}

function normalizeBrowserServer(server: DatastoreMcpServerConfig, index: number): DatastoreMcpServerConfig {
  const port = clampPort(server.port)
  return {
    ...server,
    id: server.id || `mcp-server-${index + 1}`,
    name: server.name?.trim() || defaultBrowserServerName(port),
    host: MCP_HOST,
    port,
    autoStart: Boolean(server.autoStart),
    allowedOrigins: uniqueStrings(server.allowedOrigins ?? []),
    connectionIds: uniqueStrings(server.connectionIds ?? []),
    environmentIds: uniqueStrings(server.environmentIds ?? []),
    tokens: (server.tokens ?? []).map((token, tokenIndex) => ({
      ...token,
      id: token.id || `mcp-token-${tokenIndex + 1}`,
      label: token.label?.trim() || 'MCP client auth token',
      enabled: token.enabled !== false,
      scopes: token.scopes?.filter((scope) => DATASTORE_MCP_SERVER_SCOPES.includes(scope)) ?? [],
    })),
  }
}

function clampPort(value: number | undefined) {
  return Math.min(65535, Math.max(1024, Math.floor(value ?? DEFAULT_MCP_PORT)))
}

function defaultBrowserServerName(port: number) {
  return port === DEFAULT_MCP_PORT ? 'Local MCP Server' : `Local MCP Server ${port}`
}

function nextAvailableBrowserPort(servers: DatastoreMcpServerConfig[]) {
  const used = new Set(servers.map((server) => server.port))
  let port = DEFAULT_MCP_PORT
  while (used.has(port) && port < 65535) {
    port += 1
  }
  return port
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function browserWarnings() {
  return [
    'Browser preview can save MCP settings but cannot open a desktop listener.',
    'Use the desktop app to create usable auth tokens and start the MCP endpoint.',
  ]
}
