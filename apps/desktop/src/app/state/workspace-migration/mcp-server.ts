import type {
  DatastoreMcpServerConfig,
  DatastoreMcpServerScope,
  DatastoreMcpServerTokenConfig,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'

export function normalizeDatastoreMcpServerPreferences(
  preferences: WorkspaceSnapshot['preferences']['datastoreMcpServer'] | undefined,
) {
  const rawServers = Array.isArray(preferences?.servers) ? preferences.servers : []
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
      allowedOrigins: normalizeStringList(server.allowedOrigins),
      connectionIds: normalizeStringList(server.connectionIds),
      environmentIds: normalizeStringList(server.environmentIds),
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
  return port === 17641 ? 'Local MCP Server' : `Local MCP Server ${port}`
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}
