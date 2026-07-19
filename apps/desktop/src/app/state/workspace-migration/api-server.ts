import type {
  DatastoreApiServerConfig,
  DatastoreApiServerCustomEndpointConfig,
  DatastoreApiServerCustomEndpointParameterConfig,
  DatastoreApiServerProtocol,
  DatastoreApiServerResourceConfig,
  WorkspaceSnapshot,
} from '@datapadplusplus/shared-types'

export function normalizeDatastoreApiServerPreferences(
  preferences: WorkspaceSnapshot['preferences']['datastoreApiServer'] | undefined,
) {
  const rawServers = Array.isArray(preferences?.servers) ? preferences.servers : []
  const hasLegacyServer = rawServers.length === 0 && Boolean(preferences) && (
    typeof preferences?.connectionId === 'string' ||
    typeof preferences?.environmentId === 'string' ||
    Boolean(preferences?.autoStart) ||
    (typeof preferences?.port === 'number' && preferences.port !== 17640) ||
    (typeof preferences?.activeServerId === 'string' &&
      preferences.activeServerId !== 'api-server-default')
  )
  const serverSource: Partial<DatastoreApiServerConfig>[] = rawServers.length > 0
    ? rawServers
    : hasLegacyServer
      ? [{
        id: preferences?.activeServerId || 'api-server-default',
        name: 'Local API Server',
        description: undefined,
        host: '127.0.0.1' as const,
        port: preferences?.port,
        autoStart: preferences?.autoStart,
        connectionId: preferences?.connectionId,
        environmentId: preferences?.environmentId,
        protocol: 'rest' as const,
        basePath: '',
        resources: [],
        customEndpoints: [],
      }]
      : []
  const servers: DatastoreApiServerConfig[] = serverSource.map((server, index) => {
    const port = clampNumber(server.port, 17640, 1024, 65535)
    const resources = normalizeDatastoreApiServerResources(server.resources)
    const customEndpoints = normalizeDatastoreApiServerCustomEndpoints(
      server.customEndpoints,
      resources,
    )
    return {
      id: typeof server.id === 'string' && server.id ? server.id : `api-server-${index + 1}`,
      name:
        typeof server.name === 'string' && server.name.trim()
          ? server.name.trim()
          : defaultApiServerName(port),
      description:
        typeof server.description === 'string' && server.description.trim()
          ? server.description.trim()
          : undefined,
      host: '127.0.0.1' as const,
      port,
      autoStart: Boolean(server.autoStart),
      protocol: normalizeApiServerProtocol(server.protocol),
      basePath: normalizeApiServerBasePath(server.basePath),
      connectionId: typeof server.connectionId === 'string' ? server.connectionId : undefined,
      environmentId:
        typeof server.environmentId === 'string' ? server.environmentId : undefined,
      resources,
      customEndpoints,
    }
  })
  const activeServerId =
    typeof preferences?.activeServerId === 'string' &&
    servers.some((server) => server.id === preferences.activeServerId)
      ? preferences.activeServerId
      : servers[0]?.id
  const active = servers.find((server) => server.id === activeServerId) ?? servers[0]

  return {
    port: active?.port ?? 17640,
    autoStart: Boolean(active?.autoStart),
    connectionId: active?.connectionId,
    environmentId: active?.environmentId,
    activeServerId,
    servers,
  }
}

function defaultApiServerName(port: number) {
  return port === 17640 ? 'Local API Server' : `Local API Server ${port}`
}

function normalizeDatastoreApiServerResources(resources: unknown): DatastoreApiServerResourceConfig[] {
  if (!Array.isArray(resources)) {
    return []
  }

  const seen = new Map<string, number>()
  return resources
    .filter((resource): resource is Record<string, unknown> => Boolean(resource && typeof resource === 'object'))
    .map((resource, index) => {
      const label = typeof resource.label === 'string' && resource.label.trim()
        ? resource.label.trim()
        : typeof resource.nodeId === 'string'
          ? resource.nodeId
          : `Resource ${index + 1}`
      const slug = uniqueApiServerSlug(
        typeof resource.endpointSlug === 'string' ? resource.endpointSlug : label,
        seen,
      )
      return {
        id: typeof resource.id === 'string' && resource.id ? resource.id : `api-resource-${index + 1}`,
        kind: normalizeCrudResourceKind(resource.kind),
        label,
        nodeId: typeof resource.nodeId === 'string' ? resource.nodeId : label,
        path: Array.isArray(resource.path)
          ? resource.path.filter((part): part is string => typeof part === 'string' && part.length > 0)
          : [],
        scope: typeof resource.scope === 'string' ? resource.scope : undefined,
        endpointSlug: slug,
        enabled: resource.enabled !== false,
        detail: typeof resource.detail === 'string' ? resource.detail : undefined,
        metadata: resource.metadata && typeof resource.metadata === 'object'
          ? resource.metadata as Record<string, unknown>
          : undefined,
      }
    })
}

function normalizeDatastoreApiServerCustomEndpoints(
  endpoints: unknown,
  resources: DatastoreApiServerResourceConfig[],
): DatastoreApiServerCustomEndpointConfig[] {
  if (!Array.isArray(endpoints)) {
    return []
  }

  const seen = new Map(resources.map((resource) => [resource.endpointSlug, 1]))
  return endpoints
    .filter((endpoint): endpoint is Record<string, unknown> => Boolean(endpoint && typeof endpoint === 'object'))
    .map((endpoint, index) => {
      const sourceName = typeof endpoint.sourceName === 'string' && endpoint.sourceName.trim()
        ? endpoint.sourceName.trim()
        : `Custom Endpoint ${index + 1}`
      const label = typeof endpoint.label === 'string' && endpoint.label.trim()
        ? endpoint.label.trim()
        : sourceName
      const slug = uniqueApiServerSlug(
        typeof endpoint.endpointSlug === 'string' ? endpoint.endpointSlug : label,
        seen,
      )
      const queryText = typeof endpoint.queryText === 'string' ? endpoint.queryText : ''
      return {
        id: typeof endpoint.id === 'string' && endpoint.id ? endpoint.id : `api-endpoint-${index + 1}`,
        label,
        description:
          typeof endpoint.description === 'string' && endpoint.description.trim()
            ? endpoint.description.trim()
            : undefined,
        endpointSlug: slug,
        enabled: endpoint.enabled !== false,
        method: endpoint.method === 'POST' ? 'POST' : 'GET',
        sourceLibraryNodeId:
          typeof endpoint.sourceLibraryNodeId === 'string'
            ? endpoint.sourceLibraryNodeId
            : '',
        sourceName,
        queryText,
        language:
          typeof endpoint.language === 'string' && endpoint.language.trim()
            ? endpoint.language as DatastoreApiServerCustomEndpointConfig['language']
            : 'sql',
        queryViewMode:
          endpoint.queryViewMode === 'builder' ||
          endpoint.queryViewMode === 'raw' ||
          endpoint.queryViewMode === 'script'
            ? endpoint.queryViewMode
            : 'raw',
        rowLimit: clampNumber(endpoint.rowLimit, 100, 1, 500),
        parameters: normalizeCustomEndpointParameters(endpoint.parameters, queryText),
      }
    })
}

function normalizeCustomEndpointParameters(
  parameters: unknown,
  queryText: string,
): DatastoreApiServerCustomEndpointParameterConfig[] {
  const seen = new Set<string>()
  const normalized: DatastoreApiServerCustomEndpointParameterConfig[] = Array.isArray(parameters)
    ? parameters
        .filter((parameter): parameter is Record<string, unknown> => Boolean(parameter && typeof parameter === 'object'))
        .flatMap((parameter, index) => {
          const name =
            typeof parameter.name === 'string' && validApiParameterName(parameter.name)
              ? parameter.name.trim()
              : `param${index + 1}`
          if (seen.has(name)) {
            return []
          }
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
            description:
              typeof parameter.description === 'string' && parameter.description.trim()
                ? parameter.description.trim()
                : undefined,
            serialization:
              parameter.serialization === 'sql' ||
              parameter.serialization === 'json' ||
              parameter.serialization === 'raw'
                ? parameter.serialization
                : 'auto',
          }]
        })
    : []

  for (const name of apiParameterNames(queryText)) {
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

function apiParameterNames(queryText: string) {
  const names: string[] = []
  const pattern = /\{\{api\.([^}]+)\}\}/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(queryText)) !== null) {
    const name = match[1]?.trim() ?? ''
    if (validApiParameterName(name) && !names.includes(name)) {
      names.push(name)
    }
  }
  return names
}

function validApiParameterName(value: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.trim())
}

function normalizeCrudResourceKind(value: unknown): DatastoreApiServerResourceConfig['kind'] {
  return value === 'collection' || value === 'key' || value === 'item' || value === 'index'
    ? value
    : 'table'
}

function normalizeApiServerProtocol(value: unknown): DatastoreApiServerProtocol {
  return value === 'graphql' || value === 'grpc' ? value : 'rest'
}

function normalizeApiServerBasePath(value: unknown) {
  if (typeof value !== 'string') {
    return ''
  }
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '')
  return trimmed ? `/${trimmed}` : ''
}

function uniqueApiServerSlug(value: string, seen: Map<string, number>) {
  const base = apiServerSlug(value)
  const count = (seen.get(base) ?? 0) + 1
  seen.set(base, count)
  return count > 1 ? `${base}-${count}` : base
}

function apiServerSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'resource'
}

function clampNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback
}
