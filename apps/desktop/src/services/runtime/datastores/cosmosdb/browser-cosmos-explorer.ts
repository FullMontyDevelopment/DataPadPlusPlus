import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import {
  cosmosAccountName,
  cosmosConsistency,
  cosmosContainers,
  cosmosDatabases,
  cosmosDefaultDatabase,
  cosmosDiagnostics,
  cosmosIndexingPolicy,
  cosmosPartitionKeys,
  cosmosRegions,
  cosmosScripts,
  cosmosSecurity,
  cosmosThroughput,
  cosmosWarnings,
} from './browser-cosmos-explorer-samples'

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
    const databaseName = database?.trim()
    const containerName = container?.trim()
    return databaseName && containerName
      ? cosmosContainerQuery(databaseName, containerName)
      : JSON.stringify({ operation: 'inspect', target: nodeId }, null, 2)
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
  if (!container.trim()) {
    return {
      ...cosmosBasePayload(connection),
      objectView,
      database,
      container: '',
      containers: [],
      partitionKeys: [],
      indexingPolicy: [],
      throughput: [],
      scripts: [],
      security: [],
      diagnostics: [],
      warnings: ['Select a container to inspect this Cosmos DB surface.'],
    }
  }

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
      container: parts.at(3)?.trim() ?? '',
    }
  }
  return {
    database: parts.at(-2) ?? cosmosDefaultDatabase(connection),
    container: parts.at(-1)?.trim() ?? '',
  }
}
