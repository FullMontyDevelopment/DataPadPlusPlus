import type {
  ConnectionProfile,
  DatastoreMcpServerConfig,
  DatastoreMcpServerScope,
  LibraryNode,
  DatastoreMcpServerTokenConfig,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'

export function normalizeDatastoreMcpServerPreferences(
  preferences: WorkspaceSnapshot['preferences']['datastoreMcpServer'] | undefined,
) {
  const rawServers = Array.isArray(preferences?.servers) && preferences.servers.length > 0
    ? preferences.servers
    : [{
        id: preferences?.activeServerId || 'mcp-server-default',
        name: 'MCP Server',
        host: '127.0.0.1' as const,
        port: preferences?.port ?? 17641,
        autoStart: Boolean(preferences?.autoStart),
        requestTimeoutMs: undefined,
        allowedOrigins: [],
        connectionIds: [],
        environmentIds: [],
        allowNoEnvironment: false,
        tokens: [],
      }]
  const servers: DatastoreMcpServerConfig[] = rawServers.map((server, index) => {
    const port = clampNumber(server.port, 17641, 1024, 65535)
    return {
      id: typeof server.id === 'string' && server.id ? server.id : `mcp-server-${index + 1}`,
      name:
        typeof server.name === 'string' && server.name.trim()
          ? server.name.trim()
          : defaultMcpServerName(port),
      description:
        typeof server.description === 'string' && server.description.trim()
          ? server.description.trim()
          : undefined,
      host: '127.0.0.1' as const,
      port,
      autoStart: Boolean(server.autoStart),
      requestTimeoutMs: normalizeRequestTimeout(server.requestTimeoutMs),
      allowedOrigins: normalizeStringList(server.allowedOrigins),
      connectionIds: normalizeStringList(server.connectionIds),
      environmentIds: normalizeStringList(server.environmentIds),
      allowNoEnvironment: Boolean(server.allowNoEnvironment),
      tokens: normalizeDatastoreMcpServerTokens(server.tokens),
    }
  })
  const activeServerId =
    typeof preferences?.activeServerId === 'string' &&
    servers.some((server) => server.id === preferences.activeServerId)
      ? preferences.activeServerId
      : servers[0]?.id
  const active = servers.find((server) => server.id === activeServerId) ?? servers[0]

  return {
    port: active?.port ?? 17641,
    autoStart: Boolean(active?.autoStart),
    activeServerId,
    servers,
  }
}

function normalizeDatastoreMcpServerTokens(tokens: unknown): DatastoreMcpServerTokenConfig[] {
  if (!Array.isArray(tokens)) {
    return []
  }

  return tokens
    .filter((token): token is Record<string, unknown> => Boolean(token && typeof token === 'object'))
    .filter((token) => Boolean(token.verifierSecretRef && typeof token.verifierSecretRef === 'object'))
    .map((token, index) => ({
      id: typeof token.id === 'string' && token.id ? token.id : `mcp-token-${index + 1}`,
      label:
        typeof token.label === 'string' && token.label.trim()
          ? token.label.trim()
          : `MCP client ${index + 1}`,
      enabled: token.enabled !== false,
      scopes: normalizeDatastoreMcpServerScopes(token.scopes),
      verifierSecretRef: token.verifierSecretRef as DatastoreMcpServerTokenConfig['verifierSecretRef'],
      createdAt: typeof token.createdAt === 'string' ? token.createdAt : new Date().toISOString(),
      lastUsedAt: typeof token.lastUsedAt === 'string' ? token.lastUsedAt : undefined,
    }))
}

function normalizeDatastoreMcpServerScopes(scopes: unknown): DatastoreMcpServerScope[] {
  const allowed = new Set<DatastoreMcpServerScope>([
    'plugin:read',
    'workspace:search',
    'workspaces:read',
    'security:read',
    'api-server:read',
    'mcp-server:read',
    'workspace:read',
    'workspace:switch',
    'datastore:list',
    'datastore:explore',
    'query:read',
    'operation:diagnostic',
  ])
  const values = Array.isArray(scopes) ? scopes : []
  const normalized = values.filter((scope): scope is DatastoreMcpServerScope =>
    typeof scope === 'string' && allowed.has(scope as DatastoreMcpServerScope),
  )
  return normalized.length > 0 ? [...new Set(normalized)] : ['workspace:read', 'datastore:list']
}

function normalizeStringList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).map((value) => value.trim()))]
}

function defaultMcpServerName(port: number) {
  return port === 17641 ? 'MCP Server' : `MCP Server ${port}`
}

function normalizeRequestTimeout(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.min(86_400_000, Math.max(1_000, Math.round(value)))
}

export function normalizeMcpEffectiveAccess(
  preferences: WorkspaceSnapshot['preferences']['datastoreMcpServer'],
  connections: ConnectionProfile[],
  libraryNodes: LibraryNode[],
) {
  if (!preferences?.servers) return
  for (const server of preferences.servers) {
    const selectedEnvironmentIds = new Set(server.environmentIds)
    server.connectionIds = server.connectionIds.filter((connectionId) => {
      const connection = connections.find((item) => item.id === connectionId)
      const assignedEnvironmentIds = connection
        ? effectiveConnectionEnvironmentIds(connection, libraryNodes)
        : []
      return Boolean(connection && (
        assignedEnvironmentIds.some((environmentId) => selectedEnvironmentIds.has(environmentId)) ||
        (server.allowNoEnvironment && assignedEnvironmentIds.length === 0)
      ))
    })
  }
}

function effectiveConnectionEnvironmentIds(
  connection: ConnectionProfile,
  libraryNodes: LibraryNode[],
) {
  const environmentIds = new Set(connection.environmentIds)
  const nodeById = new Map(libraryNodes.map((node) => [node.id, node]))
  for (const node of libraryNodes) {
    if (node.kind !== 'connection' || node.connectionId !== connection.id) continue
    let current: LibraryNode | undefined = node
    const visited = new Set<string>()
    while (current && !visited.has(current.id)) {
      visited.add(current.id)
      if (current.environmentId) {
        environmentIds.add(current.environmentId)
        break
      }
      current = current.parentId ? nodeById.get(current.parentId) : undefined
    }
  }
  return [...environmentIds]
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}
