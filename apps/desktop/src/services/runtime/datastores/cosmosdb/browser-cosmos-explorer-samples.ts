import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export function cosmosAccountName(connection: ConnectionProfile) {
  return connection.host?.split('.').at(0) || connection.name || 'cosmos-account'
}

export function cosmosDefaultDatabase(connection: ConnectionProfile) {
  return connection.database?.trim() || 'catalog'
}

export function cosmosDatabases(connection: ConnectionProfile) {
  const selected = cosmosDefaultDatabase(connection)
  return [
    { name: selected, containers: 3, throughput: 'shared 4,000 RU/s', storage: '8.1 GB' },
    { name: 'audit', containers: 1, throughput: 'serverless', storage: '620 MB' },
  ]
}

export function cosmosContainers(database: string) {
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

export function cosmosPartitionKeys(container: string) {
  return [
    {
      path: container === 'orders' ? '/accountId' : container === 'inventory' ? '/sku' : '/tenantId',
      kind: 'Hash',
      hotPartitionRisk: container === 'inventory' ? 'watch' : 'low',
      guidance: container === 'inventory'
        ? 'Review high-cardinality SKU distribution.'
        : 'Partition key is suitable for tenant-scoped queries.',
    },
  ]
}

export function cosmosIndexingPolicy(container: string) {
  return [
    { path: '/*', mode: 'consistent', kind: 'included', precision: -1 },
    { path: '/"_etag"/?', mode: 'consistent', kind: 'excluded', precision: '-' },
    { path: container === 'products' ? '/sku/?' : '/createdAt/?', mode: 'composite', kind: 'range', precision: -1 },
  ]
}

export function cosmosThroughput(database: string, container?: string) {
  return [
    {
      scope: container ? `${database}.${container}` : database,
      mode: container === 'products' ? 'autoscale' : container ? 'manual' : 'shared',
      ruPerSecond: container === 'products' ? '4,000 max' : container ? 1000 : 4000,
      throttles: container === 'inventory' ? 12 : 0,
    },
  ]
}

export function cosmosRegions() {
  return [
    { name: 'West Europe', role: 'write', priority: 0, status: 'online' },
    { name: 'North Europe', role: 'read', priority: 1, status: 'online' },
  ]
}

export function cosmosConsistency() {
  return [
    { setting: 'Default consistency', value: 'Session', guidance: 'Good default for user-facing apps.' },
    { setting: 'Bounded staleness', value: 'not configured', guidance: 'Only applies when selected as default consistency.' },
    { setting: 'Multiple write regions', value: 'disabled', guidance: 'Conflict feed remains quiet unless multi-write is enabled.' },
  ]
}

export function cosmosScripts(container: string) {
  return [
    { type: 'stored procedure', name: 'bulkUpsert', operation: `/${container}`, status: 'preview management only' },
    { type: 'trigger', name: 'stampUpdatedAt', operation: 'pre create', status: 'enabled' },
    { type: 'udf', name: 'normalizeSku', operation: 'query helper', status: 'enabled' },
  ]
}

export function cosmosSecurity(database?: string, container?: string) {
  const scope = [database, container].filter(Boolean).join('/') || 'account'
  return [
    { name: 'ReadOnlyApp', kind: 'role assignment', scope, status: 'read metadata and items' },
    { name: 'Primary key auth', kind: 'key', scope: 'account', status: 'avoid exporting key material' },
    { name: 'Public network', kind: 'network', scope: 'account', status: 'restricted by firewall rules' },
  ]
}

export function cosmosDiagnostics(database?: string, container?: string) {
  const scope = [database, container].filter(Boolean).join('.') || 'account'
  return [
    { signal: 'RU Consumption', value: scope === 'account' ? '38%' : '52%', status: 'healthy', guidance: 'Current workload fits configured RU/s.' },
    { signal: 'Throttled Requests', value: container === 'inventory' ? 12 : 0, status: container === 'inventory' ? 'watch' : 'healthy', guidance: container === 'inventory' ? 'Consider partition or RU review.' : 'No throttling was reported for the current scope.' },
    { signal: 'Index Utilization', value: '94%', status: 'healthy', guidance: 'Recent indexed operations are using available index paths.' },
    { signal: 'Change Feed Lag', value: '0 seconds', status: 'healthy', guidance: 'No processor lag is reported for the current scope.' },
  ]
}

export function cosmosWarnings() {
  return [
    'Cosmos DB throughput and indexing changes affect cost and latency; management actions stay guarded preview-first.',
  ]
}
