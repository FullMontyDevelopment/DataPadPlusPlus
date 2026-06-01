import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'

type JsonRecord = Record<string, unknown>

export function createCosmosExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      cosmosNode(connection, 'cosmos:account', cosmosAccountName(connection), 'account', 'Cosmos DB account overview', 'cosmos:account', true),
      cosmosNode(connection, 'cosmos:databases', 'Databases', 'databases', 'Cosmos DB databases', 'cosmos:databases', true),
      cosmosNode(connection, 'cosmos:regions', 'Regions', 'regions', 'Read and write regions', 'cosmos:regions'),
      cosmosNode(connection, 'cosmos:consistency', 'Consistency', 'consistency', 'Default consistency and session behavior', 'cosmos:consistency'),
      cosmosNode(connection, 'cosmos:security', 'Security', 'security', 'RBAC, keys, networking, and access posture', 'cosmos:security'),
      cosmosNode(connection, 'cosmos:diagnostics', 'Diagnostics', 'diagnostics', 'RU, throttles, latency, and storage signals', 'cosmos:diagnostics'),
    ]
  }

  if (scope === 'cosmos:account') {
    return [
      cosmosNode(connection, 'cosmos:databases', 'Databases', 'databases', 'Cosmos DB databases', 'cosmos:databases', true),
      cosmosNode(connection, 'cosmos:regions', 'Regions', 'regions', 'Read and write regions', 'cosmos:regions'),
      cosmosNode(connection, 'cosmos:consistency', 'Consistency', 'consistency', 'Default consistency and session behavior', 'cosmos:consistency'),
      cosmosNode(connection, 'cosmos:security', 'Security', 'security', 'RBAC, keys, networking, and access posture', 'cosmos:security'),
      cosmosNode(connection, 'cosmos:diagnostics', 'Diagnostics', 'diagnostics', 'RU, throttles, latency, and storage signals', 'cosmos:diagnostics'),
    ]
  }

  if (scope === 'cosmos:databases') {
    return cosmosDatabases(connection).map((database) =>
      cosmosNode(connection, `cosmos:database:${database.name}`, database.name, 'database', `${database.containers} containers | ${database.throughput}`, `cosmos:database:${database.name}`, true),
    )
  }

  if (scope.startsWith('cosmos:database:')) {
    const database = scope.split(':').at(-1) ?? cosmosDefaultDatabase(connection)
    return [
      cosmosNode(connection, `cosmos:containers:${database}`, 'Containers', 'containers', 'Container inventory and partitioning', `cosmos:containers:${database}`, true),
      cosmosNode(connection, `cosmos:throughput:${database}`, 'Throughput', 'throughput', 'Shared database throughput where configured', `cosmos:throughput:${database}`),
      cosmosNode(connection, `cosmos:security:${database}`, 'Security', 'security', 'Database users, roles, and access posture', `cosmos:security:${database}`),
    ]
  }

  if (scope.startsWith('cosmos:containers:')) {
    const database = scope.split(':').at(-1) ?? cosmosDefaultDatabase(connection)
    return cosmosContainers(database).map((container) =>
      cosmosNode(
        connection,
        `cosmos:container:${database}:${container.name}`,
        container.name,
        'container',
        `${container.partitionKey} | ${container.throughput} | ${container.items} items`,
        `cosmos:container:${database}:${container.name}`,
        true,
        cosmosContainerQuery(database, container.name),
      ),
    )
  }

  if (scope.startsWith('cosmos:container:')) {
    const { database, container } = cosmosScopeParts(connection, scope)
    return [
      cosmosNode(connection, `cosmos:items:${database}:${container}`, 'Items', 'items', 'Open a bounded item query', `cosmos:items:${database}:${container}`, false, cosmosContainerQuery(database, container)),
      cosmosNode(connection, `cosmos:partition-key:${database}:${container}`, 'Partition Key', 'partition-key', 'Partition path, routing, and hot key hints', `cosmos:partition-key:${database}:${container}`),
      cosmosNode(connection, `cosmos:indexing-policy:${database}:${container}`, 'Indexing Policy', 'indexing-policy', 'Included, excluded, composite, and spatial paths', `cosmos:indexing-policy:${database}:${container}`),
      cosmosNode(connection, `cosmos:throughput:${database}:${container}`, 'Throughput', 'throughput', 'Manual or autoscale RU/s and throttles', `cosmos:throughput:${database}:${container}`),
      cosmosNode(connection, `cosmos:change-feed:${database}:${container}`, 'Change Feed', 'change-feed', 'Change feed processor readiness', `cosmos:change-feed:${database}:${container}`),
      cosmosNode(connection, `cosmos:stored-procedures:${database}:${container}`, 'Stored Procedures', 'stored-procedures', 'Server-side JavaScript stored procedures', `cosmos:stored-procedures:${database}:${container}`, true),
      cosmosNode(connection, `cosmos:triggers:${database}:${container}`, 'Triggers', 'triggers', 'Pre and post triggers', `cosmos:triggers:${database}:${container}`, true),
      cosmosNode(connection, `cosmos:udfs:${database}:${container}`, 'User Defined Functions', 'udfs', 'Server-side JavaScript UDFs', `cosmos:udfs:${database}:${container}`, true),
      cosmosNode(connection, `cosmos:conflicts:${database}:${container}`, 'Conflict Feed', 'conflicts', 'Multi-region conflict metadata', `cosmos:conflicts:${database}:${container}`, true),
    ]
  }

  if (scope.startsWith('cosmos:stored-procedures:')) {
    const { database, container } = cosmosScopeParts(connection, scope)
    return cosmosScripts(container)
      .filter((script) => script.type === 'stored procedure')
      .map((script) => cosmosNode(connection, `cosmos:stored-procedure:${database}:${container}:${script.name}`, script.name, 'stored-procedure', script.operation, `cosmos:stored-procedure:${database}:${container}:${script.name}`))
  }

  if (scope.startsWith('cosmos:triggers:')) {
    const { database, container } = cosmosScopeParts(connection, scope)
    return cosmosScripts(container)
      .filter((script) => script.type === 'trigger')
      .map((script) => cosmosNode(connection, `cosmos:trigger:${database}:${container}:${script.name}`, script.name, 'trigger', script.operation, `cosmos:trigger:${database}:${container}:${script.name}`))
  }

  if (scope.startsWith('cosmos:udfs:')) {
    const { database, container } = cosmosScopeParts(connection, scope)
    return cosmosScripts(container)
      .filter((script) => script.type === 'udf')
      .map((script) => cosmosNode(connection, `cosmos:udf:${database}:${container}:${script.name}`, script.name, 'udf', script.operation, `cosmos:udf:${database}:${container}:${script.name}`))
  }

  if (scope.startsWith('cosmos:conflicts:')) {
    return []
  }

  return []
}

export function cosmosInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('cosmos:container:') || nodeId.startsWith('cosmos:items:')) {
    const [, , database, container] = nodeId.split(':')
    return cosmosContainerQuery(database || 'catalog', container || 'products')
  }

  return JSON.stringify({ operation: 'inspect', target: nodeId }, null, 2)
}

export function cosmosInspectPayload(connection: ConnectionProfile, nodeId: string): JsonRecord {
  const base = cosmosBasePayload(connection)

  if (nodeId === 'cosmos:account') {
    return {
      ...base,
      objectView: 'account',
      databases: cosmosDatabases(connection),
      containers: cosmosContainers(cosmosDefaultDatabase(connection)),
      regions: cosmosRegions(),
      consistency: cosmosConsistency(),
      security: cosmosSecurity(),
      diagnostics: cosmosDiagnostics(),
      warnings: cosmosWarnings(),
    }
  }

  if (nodeId === 'cosmos:databases') {
    return { ...base, objectView: 'databases', databases: cosmosDatabases(connection), diagnostics: cosmosDiagnostics() }
  }

  if (nodeId.startsWith('cosmos:database:')) {
    const database = nodeId.split(':').at(-1) ?? cosmosDefaultDatabase(connection)
    return {
      ...base,
      objectView: 'database',
      database,
      containers: cosmosContainers(database),
      throughput: cosmosThroughput(database),
      security: cosmosSecurity(database),
      diagnostics: cosmosDiagnostics(database),
    }
  }

  if (nodeId.startsWith('cosmos:containers:')) {
    const database = nodeId.split(':').at(-1) ?? cosmosDefaultDatabase(connection)
    return { ...base, objectView: 'containers', database, containers: cosmosContainers(database), diagnostics: cosmosDiagnostics(database) }
  }

  if (nodeId.startsWith('cosmos:container:') || nodeId.startsWith('cosmos:items:')) {
    const { database, container } = cosmosScopeParts(connection, nodeId)
    return cosmosContainerPayload(connection, database, container, nodeId.startsWith('cosmos:items:') ? 'items' : 'container')
  }

  if (nodeId.includes(':partition-key:')) {
    const { database, container } = cosmosScopeParts(connection, nodeId)
    return cosmosContainerPayload(connection, database, container, 'partition-key')
  }

  if (nodeId.includes(':indexing-policy:')) {
    const { database, container } = cosmosScopeParts(connection, nodeId)
    return cosmosContainerPayload(connection, database, container, 'indexing-policy')
  }

  if (nodeId.includes(':throughput:')) {
    const parts = nodeId.split(':')
    const database = parts.at(-2) ?? cosmosDefaultDatabase(connection)
    const container = parts.length > 3 ? parts.at(-1) : undefined
    return {
      ...base,
      objectView: 'throughput',
      database,
      container,
      throughput: cosmosThroughput(database, container),
      diagnostics: cosmosDiagnostics(database, container),
      warnings: cosmosWarnings(),
    }
  }

  if (nodeId.includes(':change-feed:') || nodeId.includes(':conflicts:')) {
    const { database, container } = cosmosScopeParts(connection, nodeId)
    return cosmosContainerPayload(connection, database, container, nodeId.includes(':conflicts:') ? 'conflicts' : 'change-feed')
  }

  if (
    nodeId.includes(':stored-procedures:') ||
    nodeId.includes(':stored-procedure:') ||
    nodeId.includes(':triggers:') ||
    nodeId.includes(':trigger:') ||
    nodeId.includes(':udfs:') ||
    nodeId.includes(':udf:')
  ) {
    const { database, container } = cosmosScopeParts(connection, nodeId)
    const objectView = nodeId.includes(':trigger:')
      ? 'trigger'
      : nodeId.includes(':triggers:')
        ? 'triggers'
        : nodeId.includes(':udf:')
          ? 'udf'
          : nodeId.includes(':udfs:')
            ? 'udfs'
            : nodeId.includes(':stored-procedure:')
              ? 'stored-procedure'
              : 'stored-procedures'
    return cosmosContainerPayload(connection, database, container, objectView)
  }

  if (nodeId === 'cosmos:regions') {
    return { ...base, objectView: 'regions', regions: cosmosRegions(), diagnostics: cosmosDiagnostics() }
  }

  if (nodeId === 'cosmos:consistency') {
    return { ...base, objectView: 'consistency', consistency: cosmosConsistency(), warnings: cosmosWarnings() }
  }

  if (nodeId.startsWith('cosmos:security')) {
    return { ...base, objectView: 'security', security: cosmosSecurity(), warnings: cosmosWarnings() }
  }

  return { ...base, objectView: 'diagnostics', diagnostics: cosmosDiagnostics(), warnings: cosmosWarnings() }
}

function cosmosContainerPayload(
  connection: ConnectionProfile,
  database: string,
  container: string,
  objectView: string,
) {
  return {
    ...cosmosBasePayload(connection),
    objectView,
    database,
    container,
    containers: cosmosContainers(database).filter((row) => row.name === container),
    partitionKeys: cosmosPartitionKeys(container),
    indexingPolicy: cosmosIndexingPolicy(container),
    throughput: cosmosThroughput(database, container),
    scripts: cosmosScripts(container),
    security: cosmosSecurity(database, container),
    diagnostics: cosmosDiagnostics(database, container),
    warnings: cosmosWarnings(),
  }
}

function cosmosNode(
  connection: ConnectionProfile,
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  expandable?: boolean,
  queryTemplate?: string,
): ExplorerNode {
  return {
    id,
    family: 'document',
    label,
    kind,
    detail,
    scope,
    path: [cosmosAccountName(connection)],
    expandable,
    queryTemplate,
  }
}

function cosmosContainerQuery(database: string, container: string) {
  return JSON.stringify(
    {
      database,
      collection: container,
      filter: {},
      limit: 20,
    },
    null,
    2,
  )
}

function cosmosBasePayload(connection: ConnectionProfile) {
  return {
    engine: 'cosmosdb',
    api: 'NoSQL',
    accountName: cosmosAccountName(connection),
    databaseCount: cosmosDatabases(connection).length,
    containerCount: cosmosDatabases(connection).reduce((sum, database) => sum + database.containers, 0),
    totalThroughput: '6,000 RU/s',
    writeRegion: 'West Europe',
  }
}

function cosmosAccountName(connection: ConnectionProfile) {
  return connection.host?.split('.').at(0) || connection.name || 'cosmos-account'
}

function cosmosDefaultDatabase(connection: ConnectionProfile) {
  return connection.database?.trim() || 'catalog'
}

function cosmosDatabases(connection: ConnectionProfile) {
  const selected = cosmosDefaultDatabase(connection)
  return [
    { name: selected, containers: 3, throughput: 'shared 4,000 RU/s', storage: '8.1 GB' },
    { name: 'audit', containers: 1, throughput: 'serverless', storage: '620 MB' },
  ]
}

function cosmosContainers(database: string) {
  if (database === 'audit') {
    return [
      { name: 'events', partitionKey: '/tenantId', throughput: 'serverless', items: 1200000, ttl: 'off' },
    ]
  }

  return [
    { name: 'products', partitionKey: '/tenantId', throughput: 'autoscale 4,000 RU/s', items: 100000, ttl: 'off' },
    { name: 'orders', partitionKey: '/accountId', throughput: 'shared database', items: 42000, ttl: '30 days' },
    { name: 'inventory', partitionKey: '/sku', throughput: 'manual 1,000 RU/s', items: 18000, ttl: 'off' },
  ]
}

function cosmosPartitionKeys(container: string) {
  return [
    {
      path: container === 'orders' ? '/accountId' : container === 'inventory' ? '/sku' : '/tenantId',
      kind: 'Hash',
      hotPartitionRisk: container === 'inventory' ? 'watch' : 'low',
      guidance: container === 'inventory' ? 'Review high-cardinality SKU distribution.' : 'Partition key is suitable for tenant-scoped queries.',
    },
  ]
}

function cosmosIndexingPolicy(container: string) {
  return [
    { path: '/*', mode: 'consistent', kind: 'included', precision: -1 },
    { path: '/"_etag"/?', mode: 'consistent', kind: 'excluded', precision: '-' },
    { path: container === 'products' ? '/sku/?' : '/createdAt/?', mode: 'composite', kind: 'range', precision: -1 },
  ]
}

function cosmosThroughput(database: string, container?: string) {
  return [
    {
      scope: container ? `${database}.${container}` : database,
      mode: container === 'products' ? 'autoscale' : container ? 'manual' : 'shared',
      ruPerSecond: container === 'products' ? '4,000 max' : container ? 1000 : 4000,
      throttles: container === 'inventory' ? 12 : 0,
    },
  ]
}

function cosmosRegions() {
  return [
    { name: 'West Europe', role: 'write', priority: 0, status: 'online' },
    { name: 'North Europe', role: 'read', priority: 1, status: 'online' },
  ]
}

function cosmosConsistency() {
  return [
    { setting: 'Default consistency', value: 'Session', guidance: 'Good default for user-facing apps.' },
    { setting: 'Bounded staleness', value: 'not configured', guidance: 'Only applies when selected as default consistency.' },
    { setting: 'Multiple write regions', value: 'disabled', guidance: 'Conflict feed remains quiet unless multi-write is enabled.' },
  ]
}

function cosmosScripts(container: string) {
  return [
    { type: 'stored procedure', name: 'bulkUpsert', operation: `/${container}`, status: 'preview management only' },
    { type: 'trigger', name: 'stampUpdatedAt', operation: 'pre create', status: 'enabled' },
    { type: 'udf', name: 'normalizeSku', operation: 'query helper', status: 'enabled' },
  ]
}

function cosmosSecurity(database?: string, container?: string) {
  const scope = [database, container].filter(Boolean).join('/') || 'account'
  return [
    { name: 'ReadOnlyApp', kind: 'role assignment', scope, status: 'read metadata and items' },
    { name: 'Primary key auth', kind: 'key', scope: 'account', status: 'avoid exporting key material' },
    { name: 'Public network', kind: 'network', scope: 'account', status: 'restricted by firewall rules' },
  ]
}

function cosmosDiagnostics(database?: string, container?: string) {
  const scope = [database, container].filter(Boolean).join('.') || 'account'
  return [
    { signal: 'RU Consumption', value: scope === 'account' ? '38%' : '52%', status: 'healthy', guidance: 'Current workload fits configured RU/s.' },
    { signal: 'Throttled Requests', value: container === 'inventory' ? 12 : 0, status: container === 'inventory' ? 'watch' : 'healthy', guidance: container === 'inventory' ? 'Consider partition or RU review.' : 'No throttling in preview sample.' },
    { signal: 'Index Utilization', value: '94%', status: 'healthy', guidance: 'Most sample queries use indexed paths.' },
    { signal: 'Change Feed Lag', value: '0 seconds', status: 'healthy', guidance: 'No processor lag detected in preview sample.' },
  ]
}

function cosmosWarnings() {
  return [
    'Cosmos DB throughput and indexing changes affect cost and latency; management actions stay guarded preview-first.',
  ]
}

function cosmosScopeParts(connection: ConnectionProfile, scope: string) {
  const parts = scope.split(':')
  const kind = parts.at(1) ?? ''
  if (
    [
      'container',
      'items',
      'partition-key',
      'indexing-policy',
      'throughput',
      'change-feed',
      'stored-procedures',
      'stored-procedure',
      'triggers',
      'trigger',
      'udfs',
      'udf',
      'conflicts',
      'conflict',
    ].includes(kind)
  ) {
    return {
      database: parts.at(2) ?? cosmosDefaultDatabase(connection),
      container: parts.at(3) ?? 'products',
    }
  }
  return {
    database: parts.at(-2) ?? cosmosDefaultDatabase(connection),
    container: parts.at(-1) ?? 'products',
  }
}
