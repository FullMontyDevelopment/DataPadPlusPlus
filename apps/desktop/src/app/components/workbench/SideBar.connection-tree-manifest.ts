import type {
  ConnectionProfile,
  DatastoreTreeNodeManifest,
} from '@datapadplusplus/shared-types'
import {
  sqlManifestNodeId,
  sqlManifestNodeScope,
} from './SideBar.connection-tree-manifest-sql'

export function manifestTreeNodeId(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
  label: string,
  parentPath: string[],
) {
  const sqlNodeId = sqlManifestNodeId(connection, manifestNode.kind, label, parentPath)
  if (sqlNodeId) return sqlNodeId

  if (connection.engine === 'memcached') return memcachedManifestNodeId(manifestNode.kind, label)
  if (connection.engine === 'litedb') return liteDbManifestNodeId(manifestNode.kind, label)
  if (connection.engine === 'cosmosdb') {
    return cosmosManifestNodeId(connection, manifestNode.kind, label, parentPath)
  }
  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return searchManifestNodeId(manifestNode.kind, label, parentPath)
  }
  if (connection.engine === 'dynamodb') return dynamoManifestNodeId(manifestNode.kind, label, parentPath)
  if (connection.engine === 'cassandra') return cassandraManifestNodeId(manifestNode.kind, label, parentPath)
  if (connection.engine === 'prometheus') return prometheusManifestNodeId(manifestNode.kind)
  if (connection.engine === 'influxdb') return influxManifestNodeId(manifestNode.kind, label, parentPath)
  if (connection.engine === 'opentsdb') return openTsdbManifestNodeId(manifestNode.kind)
  if (connection.family === 'graph') return graphManifestNodeId(manifestNode.kind)
  if (connection.family === 'warehouse') {
    return warehouseManifestNodeId(connection, manifestNode.kind, label)
  }

  return `manifest:${connection.id}:${[...parentPath, label, manifestNode.id].join('/')}`
}

export function manifestTreeNodeScope(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
  label: string,
  parentPath: string[],
) {
  const sqlScope = sqlManifestNodeScope(connection, manifestNode.kind, label, parentPath)
  if (sqlScope) return sqlScope

  if (connection.engine === 'memcached') return memcachedManifestNodeId(manifestNode.kind, label)
  if (connection.engine === 'litedb') return liteDbManifestNodeId(manifestNode.kind, label)
  if (connection.engine === 'cosmosdb') {
    return cosmosManifestNodeId(connection, manifestNode.kind, label, parentPath)
  }
  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return searchManifestNodeId(manifestNode.kind, label, parentPath)
  }
  if (connection.engine === 'dynamodb') return dynamoManifestNodeScope(manifestNode.kind, label, parentPath)
  if (connection.engine === 'cassandra') return cassandraManifestNodeScope(manifestNode.kind, label, parentPath)
  if (connection.engine === 'prometheus') return prometheusManifestNodeId(manifestNode.kind)
  if (connection.engine === 'influxdb') return influxManifestNodeScope(manifestNode.kind, label, parentPath)
  if (connection.engine === 'opentsdb') return openTsdbManifestNodeId(manifestNode.kind)
  if (connection.family === 'graph') return graphManifestNodeId(manifestNode.kind)
  if (connection.family === 'warehouse') {
    return warehouseManifestNodeId(connection, manifestNode.kind, label)
  }

  return undefined
}

export function resolveManifestTreeLabel(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
) {
  const databasePlaceholder = /\{\{database(?::([^}]+))?\}\}/
  const databaseMatch = manifestNode.label.match(databasePlaceholder)

  if (!databaseMatch) return manifestNode.label

  const database =
    connection.database?.trim() ||
    manifestNode.defaultDatabase ||
    databaseMatch[1]?.trim()

  if (!database && manifestNode.requiresDatabase) return undefined

  return manifestNode.label.replace(databasePlaceholder, database || 'default')
}

function searchManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)
  const underCluster = parentPath.includes('Cluster')
  const underTemplates = parentPath.includes('Templates')
  const underSecurity = parentPath.includes('Security')
  const underDiagnostics = parentPath.includes('Diagnostics')

  if (normalizedKind === 'cluster') return 'search:cluster'
  if (underCluster) {
    return normalizedKind === 'shards'
      ? 'search:cluster:allocation'
      : `search:cluster:${normalizedKind || normalizedLabel}`
  }
  if (normalizedKind === 'indices') return 'search:indices'
  if (normalizedKind === 'data-streams') return 'search:data-streams'
  if (normalizedKind === 'aliases') return 'search:aliases'
  if (normalizedKind === 'templates') return 'search:templates'
  if (underTemplates) {
    return normalizedLabel.includes('component')
      ? 'search:templates:component'
      : 'search:templates:index'
  }
  if (normalizedKind === 'pipelines') return 'search:pipelines'
  if (normalizedKind === 'security') return 'search:security'
  if (underSecurity && ['users', 'roles', 'api-keys'].includes(normalizedKind)) {
    return `search:security:${normalizedKind}`
  }
  if (normalizedKind === 'diagnostics') return 'search:diagnostics'
  if (underDiagnostics) {
    return normalizedKind === 'lifecycle-policies'
      ? 'search:diagnostics:lifecycle'
      : `search:diagnostics:${normalizedKind || normalizedLabel}`
  }

  return `search:${normalizedKind || normalizedLabel || 'object'}`
}

function dynamoManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)
  const underSecurity = parentPath.includes('Access') || parentPath.includes('Security')
  const underDiagnostics = parentPath.includes('Diagnostics')

  if (normalizedKind === 'tables') return 'dynamodb:tables'
  if (normalizedKind === 'security') return 'dynamodb:security'
  if (underSecurity && ['permissions', 'policies'].includes(normalizedKind)) {
    return `dynamodb:security:${normalizedKind === 'policies' ? 'policies' : normalizedKind}`
  }
  if (normalizedKind === 'diagnostics') return 'dynamodb:diagnostics'
  if (underDiagnostics) return `dynamodb:diagnostics:${normalizedKind || normalizedLabel}`

  return `dynamodb:${normalizedKind || normalizedLabel || 'object'}`
}

function dynamoManifestNodeScope(kind: string, label: string, parentPath: string[]) {
  const id = dynamoManifestNodeId(kind, label, parentPath)
  return ['tables', 'security', 'diagnostics'].includes(normalizeKind(kind)) ? id : undefined
}

function cassandraManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)
  const keyspace = keyspaceFromCassandraPath(label, parentPath)
  const underCluster = parentPath.includes('Cluster')
  const underSecurity = parentPath.includes('Security')
  const underDiagnostics = parentPath.includes('Diagnostics')

  if (normalizedKind === 'keyspaces') return 'cassandra:keyspaces'
  if (normalizedKind === 'keyspace') return `keyspace:${label}`
  if (normalizedKind === 'system-keyspaces') return 'cassandra:system-keyspaces'
  if (normalizedKind === 'cluster') return 'cassandra:cluster'
  if (underCluster) return `cassandra:cluster:${normalizedKind || normalizedLabel}`
  if (normalizedKind === 'security') return 'cassandra:security'
  if (underSecurity) return `cassandra:security:${normalizedKind || normalizedLabel}`
  if (normalizedKind === 'diagnostics') return 'cassandra:diagnostics'
  if (underDiagnostics) return `cassandra:diagnostics:${normalizedKind || normalizedLabel}`
  if (keyspace && [
    'tables',
    'materialized-views',
    'indexes',
    'types',
    'functions',
    'aggregates',
    'permissions',
  ].includes(normalizedKind)) {
    return `cassandra:${keyspace}:${normalizedKind}`
  }

  return `cassandra:${normalizedKind || normalizedLabel || 'object'}`
}

function cassandraManifestNodeScope(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = normalizeKind(kind)
  const id = cassandraManifestNodeId(kind, label, parentPath)

  if (normalizedKind === 'keyspace') return id
  if (['system-keyspaces', 'cluster', 'security', 'diagnostics'].includes(normalizedKind)) {
    return id
  }
  if ([
    'tables',
    'materialized-views',
    'indexes',
    'types',
    'functions',
    'aggregates',
    'permissions',
  ].includes(normalizedKind) && parentPath.length > 0) {
    return id
  }

  return undefined
}

function keyspaceFromCassandraPath(label: string, parentPath: string[]) {
  if (parentPath.length === 0) return undefined

  const ignoredLabels = new Set(['Keyspaces', 'System Keyspaces', 'Cluster', 'Security', 'Diagnostics'])
  const selected = [...parentPath, label].find((part) => !ignoredLabels.has(part))
  return selected?.trim() || undefined
}

function prometheusManifestNodeId(kind: string) {
  const normalizedKind = normalizeKind(kind)
  return `prometheus:${normalizedKind === 'storage' ? 'tsdb' : normalizedKind || 'object'}`
}

function influxManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = label.trim()
  const bucket = bucketFromInfluxPath(label, parentPath)

  if (normalizedKind === 'buckets') return 'influx:buckets'
  if (normalizedKind === 'bucket') return `bucket:${normalizedLabel}`
  if (bucket && normalizedKind === 'measurements') return `measurements:${bucket}`
  if (bucket && normalizedKind === 'tags') return `tags:${bucket}`
  if (bucket && normalizedKind === 'fields') return `fields:${bucket}`
  if (bucket && normalizedKind === 'retention-policies') return `retention:${bucket}`
  if (normalizedKind === 'tasks') return 'influx:tasks'
  if (normalizedKind === 'security') return 'influx:security'
  if (normalizedKind === 'diagnostics') return 'influx:diagnostics'

  return `influx:${normalizedKind || 'object'}`
}

function influxManifestNodeScope(kind: string, label: string, parentPath: string[]) {
  return influxManifestNodeId(kind, label, parentPath)
}

function bucketFromInfluxPath(label: string, parentPath: string[]) {
  const ignoredLabels = new Set(['Buckets', 'Tasks', 'Tokens', 'Diagnostics'])
  const selected = [...parentPath, label].find((part) => !ignoredLabels.has(part))
  return selected?.trim() || undefined
}

function openTsdbManifestNodeId(kind: string) {
  return `opentsdb:${normalizeKind(kind) || 'object'}`
}

function graphManifestNodeId(kind: string) {
  return `graph:${normalizeKind(kind) || 'graphs'}`
}

function warehouseManifestNodeId(connection: ConnectionProfile, kind: string, label: string) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = label.trim()

  if (['database', 'dataset', 'schema'].includes(normalizedKind)) {
    return `${normalizedKind}:${normalizedLabel}`
  }
  if (normalizedKind === 'tasks') return 'warehouse:jobs'
  if (normalizedKind === 'warehouses') return 'warehouse:warehouses'
  if (normalizedKind === 'reservations' || normalizedKind === 'clusters') return 'warehouse:warehouses'
  if (['databases', 'datasets', 'schemas', 'tables', 'views', 'materialized-views', 'stages', 'jobs', 'security', 'diagnostics'].includes(normalizedKind)) {
    return `warehouse:${normalizedKind}`
  }

  return `warehouse:${connection.engine}:${normalizedKind || 'object'}`
}

function memcachedManifestNodeId(kind: string, label: string) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)

  if (normalizedKind === 'server') return 'memcached:server'
  if (normalizedKind === 'diagnostics') return 'memcached:diagnostics'
  if (['stats', 'slabs', 'items', 'settings', 'connections'].includes(normalizedKind)) {
    return `memcached:${normalizedKind}`
  }
  if (normalizedLabel === 'item-classes') return 'memcached:items'

  return `memcached:${normalizedKind || normalizedLabel || 'object'}`
}

function liteDbManifestNodeId(kind: string, label: string) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)

  if (normalizedKind === 'database') return 'litedb:database'
  if (normalizedKind === 'diagnostics') return 'litedb:diagnostics'
  if (['collections', 'indexes', 'file-storage', 'storage', 'settings', 'pragmas', 'maintenance', 'statistics'].includes(normalizedKind)) {
    return `litedb:${normalizedKind}`
  }
  if (normalizedKind === 'files' || normalizedLabel === 'files') return 'litedb:files'
  if (normalizedKind === 'chunks' || normalizedLabel === 'chunks') return 'litedb:chunks'

  return `litedb:${normalizedKind || normalizedLabel || 'object'}`
}

function cosmosManifestNodeId(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)
  const database =
    parentPath.find((segment) => !isCosmosCategory(segment)) ||
    connection.database?.trim() ||
    'catalog'

  if (normalizedKind === 'account') return 'cosmos:account'
  if (normalizedKind === 'databases') return 'cosmos:databases'
  if (normalizedKind === 'database') return `cosmos:database:${label || database}`
  if (normalizedKind === 'containers') return `cosmos:containers:${database}`
  if (['regions', 'consistency', 'security', 'diagnostics'].includes(normalizedKind)) {
    return `cosmos:${normalizedKind}`
  }
  if ([
    'items',
    'partition-key',
    'indexing-policy',
    'throughput',
    'change-feed',
    'stored-procedures',
    'triggers',
    'udfs',
    'conflicts',
  ].includes(normalizedKind)) {
    return `cosmos:${normalizedKind}:${database}:container`
  }

  return `cosmos:${normalizedKind || normalizedLabel || 'object'}`
}

function isCosmosCategory(label: string) {
  return [
    'Account',
    'Databases',
    'Containers',
    'Items',
    'Partition Key',
    'Indexing Policy',
    'Throughput',
    'Change Feed',
    'Stored Procedures',
    'Triggers',
    'User Defined Functions',
    'Conflict Feed',
    'Regions',
    'Consistency',
    'Security',
    'Diagnostics',
  ].includes(label)
}

function normalizeKind(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
