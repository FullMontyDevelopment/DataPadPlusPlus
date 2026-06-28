import type {
  BootstrapPayload,
  DatastoreApiServerLogs,
  DatastoreApiServerLogsRequest,
  DatastoreApiServerMetrics,
  DatastoreApiServerAddCustomEndpointRequest,
  DatastoreApiServerAddResourcesRequest,
  DatastoreApiServerCreateRequest,
  DatastoreApiServerCustomEndpointConfig,
  DatastoreApiServerCustomEndpointParameterConfig,
  DatastoreApiServerDeleteRequest,
  DatastoreApiServerConfig,
  DatastoreApiServerQuerySourceDiscoveryRequest,
  DatastoreApiServerQuerySourceDiscoveryResponse,
  DatastoreApiServerRemoveCustomEndpointRequest,
  DatastoreApiServerResourceConfig,
  DatastoreApiServerResourceDiscoveryRequest,
  DatastoreApiServerResourceDiscoveryResponse,
  DatastoreApiServerRemoveResourceRequest,
  DatastoreApiServerSettingsRequest,
  DatastoreApiServerStartRequest,
  DatastoreApiServerStatus,
  DatastoreApiServerStopRequest,
  DatastoreApiServerUpdateCustomEndpointRequest,
  DatastoreApiServerUpdateRequest,
  ExplorerNode,
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

  async createDatastoreApiServer(
    request: DatastoreApiServerCreateRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('create_datastore_api_server', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreApiServer
    const servers = browserServers(existing)
    const port = clampPort(request.port ?? nextAvailableBrowserPort(servers))
    const server: DatastoreApiServerConfig = normalizeBrowserServer({
      id: `api-server-${Date.now()}`,
      name: request.name?.trim() || defaultBrowserServerName(port),
      description: request.description,
      host: '127.0.0.1',
      port,
      autoStart: Boolean(request.autoStart),
      protocol: request.protocol ?? 'rest',
      basePath: request.basePath ?? '',
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      resources: request.resources ?? [],
      customEndpoints: request.customEndpoints ?? [],
    }, servers.length)
    snapshot.preferences.datastoreApiServer = browserPreferencesFromServers(existing, [...servers, server], server.id)
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async updateDatastoreApiServer(
    request: DatastoreApiServerUpdateRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_datastore_api_server', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreApiServer
    const servers = browserServers(existing)
    const nextServers = servers.map((server, index) =>
      server.id === request.serverId
        ? normalizeBrowserServer({
            ...server,
            name: request.name ?? server.name,
            description: request.description !== undefined ? request.description : server.description,
            port: request.port ?? server.port,
            autoStart: request.autoStart ?? server.autoStart,
            protocol: request.protocol ?? server.protocol,
            basePath: request.basePath !== undefined ? request.basePath : server.basePath,
            connectionId: request.connectionId !== undefined ? request.connectionId || undefined : server.connectionId,
            environmentId: request.environmentId !== undefined ? request.environmentId || undefined : server.environmentId,
            resources: request.resources ?? server.resources,
            customEndpoints: request.customEndpoints ?? server.customEndpoints,
          }, index)
        : server,
    )
    snapshot.preferences.datastoreApiServer = browserPreferencesFromServers(existing, nextServers, request.serverId)
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async discoverDatastoreApiServerResources(
    request: DatastoreApiServerResourceDiscoveryRequest,
  ): Promise<DatastoreApiServerResourceDiscoveryResponse> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreApiServerResourceDiscoveryResponse>(
        'discover_datastore_api_server_resources',
        { request },
      )
    }

    const snapshot = loadBrowserSnapshot()
    const resources = snapshot.explorerNodes
      .filter((node) => browserExplorerNodeMatchesScope(node, request.scope))
      .map((node) => browserResourceFromExplorerNode(node))
      .filter((resource): resource is DatastoreApiServerResourceConfig => Boolean(resource))
    return {
      connectionId: request.connectionId,
      environmentId: request.environmentId,
      scope: request.scope,
      resources: normalizeBrowserResources(resources),
    }
  },

  async discoverDatastoreApiServerQuerySources(
    request: DatastoreApiServerQuerySourceDiscoveryRequest,
  ): Promise<DatastoreApiServerQuerySourceDiscoveryResponse> {
    if (isTauriRuntime()) {
      return invokeDesktop<DatastoreApiServerQuerySourceDiscoveryResponse>(
        'discover_datastore_api_server_query_sources',
        { request },
      )
    }

    const snapshot = loadBrowserSnapshot()
    const server = browserServers(snapshot.preferences.datastoreApiServer).find(
      (item) => item.id === request.serverId,
    )
    const sources = snapshot.libraryNodes
      .filter(
        (node) =>
          node.kind === 'query' &&
          Boolean(node.queryText?.trim()) &&
          Boolean(server?.connectionId) &&
          node.connectionId === server?.connectionId &&
          (!node.environmentId ||
            !server?.environmentId ||
            node.environmentId === server.environmentId),
      )
      .map((node) => ({
        id: node.id,
        name: node.name,
        summary: node.summary,
        connectionId: node.connectionId,
        environmentId: node.environmentId,
        language: node.language,
        queryViewMode: node.queryViewMode,
        queryText: node.queryText ?? '',
      }))
      .sort((left, right) => left.name.localeCompare(right.name))
    return {
      serverId: request.serverId,
      sources,
    }
  },

  async addDatastoreApiServerCustomEndpoint(
    request: DatastoreApiServerAddCustomEndpointRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('add_datastore_api_server_custom_endpoint', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreApiServer
    const servers = browserServers(existing)
    const source = snapshot.libraryNodes.find((node) => node.id === request.endpoint.sourceLibraryNodeId)
    const endpoint = source?.queryText
      ? {
          ...request.endpoint,
          sourceName: source.name,
          queryText: source.queryText,
          language: source.language ?? request.endpoint.language,
          queryViewMode: source.queryViewMode ?? request.endpoint.queryViewMode,
        }
      : request.endpoint
    const nextServers = servers.map((server, index) =>
      server.id === request.serverId
        ? normalizeBrowserServer({
            ...server,
            customEndpoints: normalizeBrowserCustomEndpoints([
              ...(server.customEndpoints ?? []),
              endpoint,
            ], server.resources ?? []),
          }, index)
        : server,
    )
    snapshot.preferences.datastoreApiServer = browserPreferencesFromServers(existing, nextServers, request.serverId)
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async updateDatastoreApiServerCustomEndpoint(
    request: DatastoreApiServerUpdateCustomEndpointRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_datastore_api_server_custom_endpoint', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreApiServer
    const servers = browserServers(existing)
    const nextServers = servers.map((server, index) =>
      server.id === request.serverId
        ? normalizeBrowserServer({
            ...server,
            customEndpoints: (server.customEndpoints ?? []).map((endpoint) =>
              endpoint.id === request.endpointId ? request.endpoint : endpoint,
            ),
          }, index)
        : server,
    )
    snapshot.preferences.datastoreApiServer = browserPreferencesFromServers(existing, nextServers, request.serverId)
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async removeDatastoreApiServerCustomEndpoint(
    request: DatastoreApiServerRemoveCustomEndpointRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('remove_datastore_api_server_custom_endpoint', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreApiServer
    const servers = browserServers(existing)
    const nextServers = servers.map((server, index) =>
      server.id === request.serverId
        ? normalizeBrowserServer({
            ...server,
            customEndpoints: (server.customEndpoints ?? []).filter(
              (endpoint) => endpoint.id !== request.endpointId,
            ),
          }, index)
        : server,
    )
    snapshot.preferences.datastoreApiServer = browserPreferencesFromServers(existing, nextServers, request.serverId)
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async addDatastoreApiServerResources(
    request: DatastoreApiServerAddResourcesRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('add_datastore_api_server_resources', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreApiServer
    const servers = browserServers(existing)
    const nextServers = servers.map((server, index) =>
      server.id === request.serverId
        ? normalizeBrowserServer({
            ...server,
            resources: normalizeBrowserResources([
              ...(server.resources ?? []),
              ...request.resources.filter(
                (resource) => !(server.resources ?? []).some((existing) => existing.id === resource.id),
              ),
            ]),
          }, index)
        : server,
    )
    snapshot.preferences.datastoreApiServer = browserPreferencesFromServers(existing, nextServers, request.serverId)
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async removeDatastoreApiServerResource(
    request: DatastoreApiServerRemoveResourceRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('remove_datastore_api_server_resource', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreApiServer
    const servers = browserServers(existing)
    const nextServers = servers.map((server, index) =>
      server.id === request.serverId
        ? normalizeBrowserServer({
            ...server,
            resources: (server.resources ?? []).filter((resource) => resource.id !== request.resourceId),
          }, index)
        : server,
    )
    snapshot.preferences.datastoreApiServer = browserPreferencesFromServers(existing, nextServers, request.serverId)
    snapshot.updatedAt = new Date().toISOString()
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async updateDatastoreApiServerSettings(
    request: DatastoreApiServerSettingsRequest,
  ): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('update_datastore_api_server_settings', { request })
    }

    const snapshot = cloneSnapshot(loadBrowserSnapshot())
    const existing = snapshot.preferences.datastoreApiServer
    snapshot.preferences.datastoreApiServer = browserRequestUpdatesServer(request)
      ? {
          enabled: request.enabled,
          host: '127.0.0.1',
          ...upsertBrowserServer(existing, request),
        }
      : browserPreferencesFromServers(
          existing,
          browserServers(existing),
          existing?.activeServerId,
          request.enabled,
        )
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
    const activeServerId =
      existing?.activeServerId && remaining.some((server) => server.id === existing.activeServerId)
        ? existing.activeServerId
        : remaining[0]?.id
    snapshot.preferences.datastoreApiServer = browserPreferencesFromServers(
      existing,
      remaining,
      activeServerId,
      Boolean(existing?.enabled),
    )
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
  const hasServers = servers.length > 0
  const serverStatuses = servers.map((server) => ({
    id: server.id,
    name: server.name,
    description: server.description,
    running: false,
    host: '127.0.0.1' as const,
    port: clampPort(server.port),
    protocol: server.protocol ?? 'rest',
    basePath: server.basePath ?? '',
    baseUrl: enabled ? `http://127.0.0.1:${clampPort(server.port)}` : undefined,
    connectionId: server.connectionId,
    environmentId: server.environmentId,
    message: enabled
      ? 'The experimental API server is stopped in browser preview.'
      : 'The experimental API server is disabled.',
    warnings: enabled ? ['Browser preview cannot open local listener ports.'] : [],
    resources: server.resources ?? [],
    customEndpoints: server.customEndpoints ?? [],
  }))
  return {
    enabled,
    running: false,
    host: '127.0.0.1',
    port,
    baseUrl: enabled && hasServers ? `http://127.0.0.1:${port}` : undefined,
    connectionId: active?.connectionId,
    environmentId: active?.environmentId,
    serverId: active?.id,
    name: active?.name,
    description: active?.description,
    protocol: active?.protocol ?? 'rest',
    basePath: active?.basePath ?? '',
    activeServerId,
    message: enabled && !hasServers
      ? 'No API servers are configured.'
      : enabled
      ? 'The experimental API server is stopped in browser preview.'
      : 'The experimental API server is disabled.',
    warnings: enabled && hasServers ? ['Browser preview cannot open local listener ports.'] : [],
    resources: active?.resources ?? [],
    customEndpoints: active?.customEndpoints ?? [],
    servers: serverStatuses,
  }
}

function browserApiServerMetrics(): DatastoreApiServerMetrics {
  const status = browserApiServerStatus()
  return {
    running: false,
    generatedAt: new Date().toISOString(),
    serverId: status.serverId,
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

function clampRowLimit(value: number | undefined) {
  if (!Number.isFinite(value ?? Number.NaN)) return 100
  return Math.min(500, Math.max(1, Math.floor(value ?? 100)))
}

function defaultBrowserServer(): DatastoreApiServerConfig {
  return {
    id: 'api-server-default',
    name: 'Local API Server',
    host: '127.0.0.1',
    port: 17640,
    autoStart: false,
    protocol: 'rest',
    basePath: '',
    resources: [],
    customEndpoints: [],
  }
}

function browserServers(
  preferences: ReturnType<typeof loadBrowserSnapshot>['preferences']['datastoreApiServer'],
): DatastoreApiServerConfig[] {
  const hasLegacyServer = !preferences?.servers?.length && Boolean(preferences) && (
    typeof preferences?.connectionId === 'string' ||
    typeof preferences?.environmentId === 'string' ||
    Boolean(preferences?.autoStart) ||
    (typeof preferences?.port === 'number' && preferences.port !== 17640) ||
    (typeof preferences?.activeServerId === 'string' &&
      preferences.activeServerId !== 'api-server-default')
  )
  const servers = preferences?.servers?.length
    ? preferences.servers
    : hasLegacyServer
      ? [{
        ...defaultBrowserServer(),
        id: preferences?.activeServerId || 'api-server-default',
        port: clampPort(preferences?.port ?? 17640),
        autoStart: Boolean(preferences?.autoStart),
        connectionId: preferences?.connectionId,
        environmentId: preferences?.environmentId,
      }]
      : []

  return servers.map((server, index) => normalizeBrowserServer(server, index))
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
    'api-server-default'
  const index = servers.findIndex((server) => server.id === selectedId)
  const existingServer = index >= 0 ? servers[index] : undefined
  const port = clampPort(request.port ?? existingServer?.port ?? 17640)
  const nextServer: DatastoreApiServerConfig = {
    ...(existingServer ?? defaultBrowserServer()),
    id: selectedId,
    name: request.name?.trim() || existingServer?.name || defaultBrowserServerName(port),
    description:
      request.description !== undefined
        ? request.description?.trim() || undefined
        : existingServer?.description,
    host: '127.0.0.1',
    port,
    autoStart: Boolean(request.autoStart ?? existingServer?.autoStart ?? false),
    protocol: normalizeBrowserProtocol(request.protocol ?? existingServer?.protocol),
    basePath: normalizeBrowserBasePath(
      request.basePath !== undefined ? request.basePath : existingServer?.basePath,
    ),
    connectionId:
      request.connectionId !== undefined
        ? request.connectionId || undefined
        : existingServer?.connectionId,
    environmentId:
      request.environmentId !== undefined
        ? request.environmentId || undefined
        : existingServer?.environmentId,
    resources: request.resources
      ? normalizeBrowserResources(request.resources)
      : existingServer?.resources ?? [],
    customEndpoints: request.customEndpoints
      ? normalizeBrowserCustomEndpoints(request.customEndpoints, request.resources ?? existingServer?.resources ?? [])
      : existingServer?.customEndpoints ?? [],
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

function browserPreferencesFromServers(
  existing: ReturnType<typeof loadBrowserSnapshot>['preferences']['datastoreApiServer'],
  servers: DatastoreApiServerConfig[],
  activeServerId: string | undefined,
  enabled = Boolean(existing?.enabled ?? true),
) {
  const normalized = servers.map((server, index) => normalizeBrowserServer(server, index))
  const active =
    normalized.find((server) => server.id === activeServerId) ??
    normalized.find((server) => server.id === existing?.activeServerId) ??
    normalized[0]
  return {
    enabled,
    host: '127.0.0.1' as const,
    port: active?.port ?? 17640,
    autoStart: Boolean(active?.autoStart),
    connectionId: active?.connectionId,
    environmentId: active?.environmentId,
    activeServerId: active?.id,
    servers: normalized,
  }
}

function browserRequestUpdatesServer(request: DatastoreApiServerSettingsRequest) {
  return Boolean(
    request.serverId ||
    request.activeServerId ||
    request.name !== undefined ||
    request.description !== undefined ||
    request.port !== undefined ||
    request.autoStart !== undefined ||
    request.protocol !== undefined ||
    request.basePath !== undefined ||
    request.connectionId !== undefined ||
    request.environmentId !== undefined ||
    request.resources !== undefined ||
    request.customEndpoints !== undefined,
  )
}

function normalizeBrowserServer(server: DatastoreApiServerConfig, index: number): DatastoreApiServerConfig {
  const port = clampPort(server.port)
  return {
    id: server.id || `api-server-${index + 1}`,
    name: server.name?.trim() || defaultBrowserServerName(port),
    description: server.description?.trim() || undefined,
    host: '127.0.0.1',
    port,
    autoStart: Boolean(server.autoStart),
    protocol: normalizeBrowserProtocol(server.protocol),
    basePath: normalizeBrowserBasePath(server.basePath),
    connectionId: server.connectionId,
    environmentId: server.environmentId,
    resources: normalizeBrowserResources(server.resources ?? []),
    customEndpoints: normalizeBrowserCustomEndpoints(
      server.customEndpoints ?? [],
      normalizeBrowserResources(server.resources ?? []),
    ),
  }
}

function normalizeBrowserResources(
  resources: DatastoreApiServerResourceConfig[],
): DatastoreApiServerResourceConfig[] {
  const seen = new Map<string, number>()
  return resources.map((resource, index) => {
    const label = resource.label?.trim() || resource.nodeId || `Resource ${index + 1}`
    const slug = uniqueBrowserSlug(resource.endpointSlug || label, seen)
    return {
      id: resource.id || `api-resource-${index + 1}`,
      kind: normalizeBrowserKind(resource.kind),
      label,
      nodeId: resource.nodeId || label,
      path: Array.isArray(resource.path) ? resource.path.filter(Boolean) : [],
      scope: resource.scope,
      endpointSlug: slug,
      enabled: resource.enabled !== false,
      detail: resource.detail,
      metadata: resource.metadata,
    }
  })
}

function normalizeBrowserCustomEndpoints(
  endpoints: DatastoreApiServerCustomEndpointConfig[],
  resources: DatastoreApiServerResourceConfig[],
): DatastoreApiServerCustomEndpointConfig[] {
  const seen = new Map(normalizeBrowserResources(resources).map((resource) => [resource.endpointSlug, 1]))
  return endpoints.map((endpoint, index) => {
    const sourceName = endpoint.sourceName?.trim() || `Custom Endpoint ${index + 1}`
    const label = endpoint.label?.trim() || sourceName
    const slug = uniqueBrowserSlug(endpoint.endpointSlug || label, seen)
    return {
      id: endpoint.id || `api-endpoint-${index + 1}`,
      label,
      description: endpoint.description?.trim() || undefined,
      endpointSlug: slug,
      enabled: endpoint.enabled !== false,
      method: endpoint.method === 'POST' ? 'POST' : 'GET',
      sourceLibraryNodeId: endpoint.sourceLibraryNodeId || '',
      sourceName,
      queryText: endpoint.queryText ?? '',
      language: endpoint.language || 'sql',
      queryViewMode:
        endpoint.queryViewMode === 'builder' ||
        endpoint.queryViewMode === 'raw' ||
        endpoint.queryViewMode === 'script'
          ? endpoint.queryViewMode
          : 'raw',
      rowLimit: clampRowLimit(endpoint.rowLimit),
      parameters: normalizeBrowserCustomEndpointParameters(endpoint.parameters ?? [], endpoint.queryText ?? ''),
    }
  })
}

function normalizeBrowserCustomEndpointParameters(
  parameters: NonNullable<DatastoreApiServerCustomEndpointConfig['parameters']>,
  queryText: string,
): DatastoreApiServerCustomEndpointParameterConfig[] {
  const seen = new Set<string>()
  const normalized: DatastoreApiServerCustomEndpointParameterConfig[] = parameters.flatMap((parameter, index) => {
    const name = validBrowserApiParameterName(parameter.name)
      ? parameter.name.trim()
      : `param${index + 1}`
    if (seen.has(name)) return []
    seen.add(name)
    return [{
      name,
      type:
        parameter.type === 'number' ||
        parameter.type === 'boolean' ||
        parameter.type === 'json'
          ? parameter.type
          : 'string',
      required: Boolean(parameter.required),
      defaultValue: parameter.defaultValue,
      description: parameter.description?.trim() || undefined,
      serialization:
        parameter.serialization === 'sql' ||
        parameter.serialization === 'json' ||
        parameter.serialization === 'raw'
          ? parameter.serialization
          : 'auto',
    }]
  })
  for (const name of browserApiParameterNames(queryText)) {
    if (!seen.has(name)) {
      seen.add(name)
      normalized.push({
        name,
        type: 'string',
        required: true,
        serialization: 'auto',
      })
    }
  }
  return normalized
}

function browserApiParameterNames(queryText: string) {
  const names: string[] = []
  const pattern = /\{\{api\.([^}]+)\}\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(queryText)) !== null) {
    const name = match[1]?.trim() ?? ''
    if (validBrowserApiParameterName(name) && !names.includes(name)) {
      names.push(name)
    }
  }
  return names
}

function validBrowserApiParameterName(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim())
}

function normalizeBrowserProtocol(value: DatastoreApiServerConfig['protocol']) {
  return value === 'graphql' || value === 'grpc' ? value : 'rest'
}

function normalizeBrowserBasePath(value: string | undefined) {
  const trimmed = (value ?? '').trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}` : ''
}

function normalizeBrowserKind(value: DatastoreApiServerResourceConfig['kind']) {
  return value === 'collection' || value === 'key' || value === 'item' || value === 'index'
    ? value
    : 'table'
}

function nextAvailableBrowserPort(servers: DatastoreApiServerConfig[]) {
  const used = new Set(servers.map((server) => clampPort(server.port)))
  let port = 17640
  while (used.has(port) && port < 65535) {
    port += 1
  }
  return port
}

function uniqueBrowserSlug(value: string, seen: Map<string, number>) {
  const base = browserSlug(value)
  const count = (seen.get(base) ?? 0) + 1
  seen.set(base, count)
  return count > 1 ? `${base}-${count}` : base
}

function browserSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'resource'
}

function browserExplorerNodeMatchesScope(node: ExplorerNode, scope?: string) {
  if (!scope) return true
  return node.scope === scope || node.path?.includes(scope) || node.id.startsWith(scope)
}

function browserResourceFromExplorerNode(
  node: ExplorerNode,
): DatastoreApiServerResourceConfig | undefined {
  const kind = browserCrudKindForNode(node.kind)
  if (!kind) return undefined
  const slug = browserSlug(node.label)
  return {
    id: `api-resource-${slug}`,
    kind,
    label: node.label,
    nodeId: node.id,
    path: node.path ?? [],
    scope: node.scope,
    endpointSlug: slug,
    enabled: true,
    detail: node.detail,
  }
}

function browserCrudKindForNode(kind: string): DatastoreApiServerResourceConfig['kind'] | undefined {
  if (kind === 'table' || kind === 'view') return 'table'
  if (kind === 'collection') return 'collection'
  if (kind === 'key' || kind === 'known-key') return 'key'
  if (kind === 'item') return 'item'
  if (kind === 'index') return 'index'
  return undefined
}

function defaultBrowserServerName(port: number) {
  const safePort = clampPort(port)
  return safePort === 17640 ? 'Local API Server' : `Local API Server ${safePort}`
}
