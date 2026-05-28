import type {
  AdapterManifest,
  ConnectionProfile,
  DatastoreTreeManifest,
  DatastoreTreeNodeManifest,
} from '@datapadplusplus/shared-types'
import { normalizeExplorerKind } from './SideBar.datastore-tree-registry'
import { decorateTreeNodes } from './SideBar.connection-tree-decorate'
import { fallbackConnectionTree } from './SideBar.connection-tree-fallbacks'
import type { ConnectionTreeNode } from './SideBar.connection-tree-types'

export type { ConnectionTreeNode } from './SideBar.connection-tree-types'
export { buildConnectionObjectTreeFromExplorerNodes } from './SideBar.connection-tree-explorer'

export function buildConnectionObjectTree(
  connection: ConnectionProfile,
  adapterManifest?: AdapterManifest,
): ConnectionTreeNode[] {
  if (adapterManifest?.tree) {
    const tree = buildConnectionObjectTreeFromManifest(connection, adapterManifest.tree)
    decorateTreeNodes(connection, tree, undefined)
    return tree
  }

  const tree = fallbackConnectionTree(connection)

  decorateTreeNodes(connection, tree, undefined)
  return tree
}

function buildConnectionObjectTreeFromManifest(
  connection: ConnectionProfile,
  treeManifest: DatastoreTreeManifest,
): ConnectionTreeNode[] {
  return treeManifest.roots.flatMap((node) =>
    connectionTreeNodeFromManifestNode(connection, node, []),
  )
}

function connectionTreeNodeFromManifestNode(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
  parentPath: string[],
): ConnectionTreeNode[] {
  if (manifestNode.optionalWhenLiveMetadata) {
    return []
  }

  if (manifestNode.hiddenWhenDatabaseSelected && connection.database?.trim()) {
    return []
  }

  const label = resolveManifestTreeLabel(connection, manifestNode)

  if (!label) {
    return []
  }

  const children = (manifestNode.children ?? []).flatMap((child) =>
    connectionTreeNodeFromManifestNode(connection, child, [...parentPath, label]),
  )

  return [
    {
      id: manifestTreeNodeId(connection, manifestNode, label, parentPath),
      label,
      kind: normalizeExplorerKind(connection, manifestNode.kind),
      detail: manifestNode.detail,
      scope: manifestTreeNodeScope(connection, manifestNode, label, parentPath),
      path: [...parentPath, label],
      category: true,
      expandable: children.length > 0,
      children,
    },
  ]
}

function manifestTreeNodeId(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
  label: string,
  parentPath: string[],
) {
  if (connection.engine === 'memcached') {
    return memcachedManifestNodeId(manifestNode.kind, label)
  }

  if (connection.engine === 'litedb') {
    return liteDbManifestNodeId(manifestNode.kind, label)
  }

  if (connection.engine === 'cosmosdb') {
    return cosmosManifestNodeId(connection, manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'sqlite') {
    return sqliteManifestNodeId(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'duckdb') {
    return duckDbManifestNodeId(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'postgresql' || connection.engine === 'timescaledb') {
    return postgresManifestNodeId(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return mysqlManifestNodeId(connection, manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return searchManifestNodeId(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'dynamodb') {
    return dynamoManifestNodeId(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'cassandra') {
    return cassandraManifestNodeId(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'prometheus') {
    return prometheusManifestNodeId(manifestNode.kind)
  }

  if (connection.engine === 'influxdb') {
    return influxManifestNodeId(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'opentsdb') {
    return openTsdbManifestNodeId(manifestNode.kind)
  }

  if (connection.family === 'graph') {
    return graphManifestNodeId(manifestNode.kind)
  }

  if (connection.family === 'warehouse') {
    return warehouseManifestNodeId(connection, manifestNode.kind, label)
  }

  return `manifest:${connection.id}:${[...parentPath, label, manifestNode.id].join('/')}`
}

function manifestTreeNodeScope(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
  label: string,
  parentPath: string[],
) {
  if (connection.engine === 'memcached') {
    return memcachedManifestNodeId(manifestNode.kind, label)
  }

  if (connection.engine === 'litedb') {
    return liteDbManifestNodeId(manifestNode.kind, label)
  }

  if (connection.engine === 'cosmosdb') {
    return cosmosManifestNodeId(connection, manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'sqlite') {
    return sqliteManifestNodeId(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'duckdb') {
    return duckDbManifestNodeId(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'postgresql' || connection.engine === 'timescaledb') {
    return postgresManifestNodeId(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return mysqlManifestNodeId(connection, manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return searchManifestNodeId(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'dynamodb') {
    return dynamoManifestNodeScope(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'cassandra') {
    return cassandraManifestNodeScope(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'prometheus') {
    return prometheusManifestNodeId(manifestNode.kind)
  }

  if (connection.engine === 'influxdb') {
    return influxManifestNodeScope(manifestNode.kind, label, parentPath)
  }

  if (connection.engine === 'opentsdb') {
    return openTsdbManifestNodeId(manifestNode.kind)
  }

  if (connection.family === 'graph') {
    return graphManifestNodeId(manifestNode.kind)
  }

  if (connection.family === 'warehouse') {
    return warehouseManifestNodeId(connection, manifestNode.kind, label)
  }

  return undefined
}

function sqliteManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const underMainDatabase = parentPath.includes('Main Database')

  if (normalizedKind === 'database' && normalizedLabel === 'main-database') {
    return 'database:main'
  }

  if (normalizedKind === 'attached-databases') {
    return underMainDatabase ? 'folder:main:attached-databases' : 'attached-databases'
  }

  if (normalizedKind === 'maintenance') {
    return 'maintenance:main'
  }

  if (underMainDatabase && ['tables', 'views', 'indexes', 'triggers', 'schema', 'pragmas'].includes(normalizedKind)) {
    return normalizedKind === 'pragmas' ? 'pragmas:main' : `folder:main:${normalizedKind}`
  }

  return `sqlite:${[...parentPath, label, normalizedKind].join('/')}`
}

function duckDbManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const schema = duckDbSchemaFromPath(label, parentPath)

  if (normalizedKind === 'database') {
    return 'duckdb:database'
  }

  if (normalizedKind === 'schemas') {
    return 'duckdb:database'
  }

  if (normalizedKind === 'schema') {
    return `schema:${label}`
  }

  if (schema && ['tables', 'views', 'indexes', 'functions'].includes(normalizedKind)) {
    return `${normalizedKind}:${schema}`
  }

  if (normalizedKind === 'attached-databases') {
    return 'duckdb:attached-databases'
  }

  if (['extensions', 'files', 'pragmas', 'statistics', 'diagnostics'].includes(normalizedKind)) {
    return `duckdb:${normalizedKind}`
  }

  return `duckdb:${normalizedKind || normalizedLabel || 'object'}`
}

function duckDbSchemaFromPath(label: string, parentPath: string[]) {
  const ignoredLabels = new Set(['Main Database', 'Schemas'])
  const selected = [...parentPath, label].find((part) => !ignoredLabels.has(part))
  return selected?.trim() || undefined
}

function postgresManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const underDiagnostics = parentPath.includes('Diagnostics')

  if (normalizedKind === 'diagnostics') {
    return 'postgres:diagnostics'
  }

  if (underDiagnostics) {
    if (normalizedKind === 'statistics') {
      return 'postgres:diagnostics:statistics'
    }
    if (normalizedKind === 'index-health') {
      return 'postgres:diagnostics:index-health'
    }
    return `postgres:diagnostics:${normalizedKind || normalizedLabel}`
  }

  if (normalizedKind === 'security') {
    return 'postgres:security'
  }

  if (parentPath.includes('Security') && ['roles', 'permissions'].includes(normalizedKind)) {
    return `postgres:security:${normalizedKind}`
  }

  return `postgres:${[...parentPath, label, normalizedKind].join('/')}`
}

function mysqlManifestNodeId(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const database = connection.database?.trim() || 'datapadplusplus'
  const underDiagnostics = parentPath.includes('Diagnostics')
  const underSecurity = parentPath.includes('Security') || parentPath.includes('Users / Privileges')
  const underSelectedDatabase = parentPath.includes(database) || parentPath.includes('Databases')

  if (normalizedKind === 'databases') {
    return 'mysql:databases'
  }

  if (normalizedKind === 'database') {
    return `database:${database}`
  }

  if (normalizedKind === 'system-schemas') {
    return 'mysql:system-schemas'
  }

  if (normalizedKind === 'diagnostics') {
    return 'mysql:diagnostics'
  }

  if (underDiagnostics) {
    if (normalizedKind === 'statistics') {
      return 'mysql:diagnostics:statistics'
    }
    return `mysql:diagnostics:${normalizedKind || normalizedLabel}`
  }

  if (normalizedKind === 'security' && !underSelectedDatabase) {
    return 'mysql:security'
  }

  if (underSecurity && ['users', 'roles', 'permissions'].includes(normalizedKind)) {
    return `mysql:security:${normalizedKind}`
  }

  if (underSelectedDatabase && [
    'tables',
    'views',
    'procedures',
    'functions',
    'events',
    'triggers',
    'indexes',
    'storage',
    'security',
  ].includes(normalizedKind)) {
    return normalizedKind === 'security'
      ? 'mysql:security'
      : `mysql:${database}:${normalizedKind}`
  }

  return `mysql:${[...parentPath, label, normalizedKind].join('/')}`
}

function searchManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const underCluster = parentPath.includes('Cluster')
  const underTemplates = parentPath.includes('Templates')
  const underSecurity = parentPath.includes('Security')
  const underDiagnostics = parentPath.includes('Diagnostics')

  if (normalizedKind === 'cluster') {
    return 'search:cluster'
  }

  if (underCluster) {
    if (normalizedKind === 'shards') {
      return 'search:cluster:allocation'
    }
    return `search:cluster:${normalizedKind || normalizedLabel}`
  }

  if (normalizedKind === 'indices') {
    return 'search:indices'
  }

  if (normalizedKind === 'data-streams') {
    return 'search:data-streams'
  }

  if (normalizedKind === 'aliases') {
    return 'search:aliases'
  }

  if (normalizedKind === 'templates') {
    return 'search:templates'
  }

  if (underTemplates) {
    return normalizedLabel.includes('component')
      ? 'search:templates:component'
      : 'search:templates:index'
  }

  if (normalizedKind === 'pipelines') {
    return 'search:pipelines'
  }

  if (normalizedKind === 'security') {
    return 'search:security'
  }

  if (underSecurity && ['users', 'roles', 'api-keys'].includes(normalizedKind)) {
    return `search:security:${normalizedKind}`
  }

  if (normalizedKind === 'diagnostics') {
    return 'search:diagnostics'
  }

  if (underDiagnostics) {
    if (normalizedKind === 'lifecycle-policies') {
      return 'search:diagnostics:lifecycle'
    }
    return `search:diagnostics:${normalizedKind || normalizedLabel}`
  }

  return `search:${normalizedKind || normalizedLabel || 'object'}`
}

function dynamoManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const underSecurity = parentPath.includes('Access') || parentPath.includes('Security')
  const underDiagnostics = parentPath.includes('Diagnostics')

  if (normalizedKind === 'tables') {
    return 'dynamodb:tables'
  }

  if (normalizedKind === 'security') {
    return 'dynamodb:security'
  }

  if (underSecurity && ['permissions', 'policies'].includes(normalizedKind)) {
    return `dynamodb:security:${normalizedKind === 'policies' ? 'policies' : normalizedKind}`
  }

  if (normalizedKind === 'diagnostics') {
    return 'dynamodb:diagnostics'
  }

  if (underDiagnostics) {
    return `dynamodb:diagnostics:${normalizedKind || normalizedLabel}`
  }

  return `dynamodb:${normalizedKind || normalizedLabel || 'object'}`
}

function dynamoManifestNodeScope(kind: string, label: string, parentPath: string[]) {
  const id = dynamoManifestNodeId(kind, label, parentPath)
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')

  if (['tables', 'security', 'diagnostics'].includes(normalizedKind)) {
    return id
  }

  return undefined
}

function cassandraManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const keyspace = keyspaceFromCassandraPath(label, parentPath)
  const underCluster = parentPath.includes('Cluster')
  const underSecurity = parentPath.includes('Security')
  const underDiagnostics = parentPath.includes('Diagnostics')

  if (normalizedKind === 'keyspaces') {
    return 'cassandra:keyspaces'
  }

  if (normalizedKind === 'keyspace') {
    return `keyspace:${label}`
  }

  if (normalizedKind === 'system-keyspaces') {
    return 'cassandra:system-keyspaces'
  }

  if (normalizedKind === 'cluster') {
    return 'cassandra:cluster'
  }

  if (underCluster) {
    return `cassandra:cluster:${normalizedKind || normalizedLabel}`
  }

  if (normalizedKind === 'security') {
    return 'cassandra:security'
  }

  if (underSecurity) {
    return `cassandra:security:${normalizedKind || normalizedLabel}`
  }

  if (normalizedKind === 'diagnostics') {
    return 'cassandra:diagnostics'
  }

  if (underDiagnostics) {
    return `cassandra:diagnostics:${normalizedKind || normalizedLabel}`
  }

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
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const id = cassandraManifestNodeId(kind, label, parentPath)

  if (normalizedKind === 'keyspace') {
    return id
  }

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
  if (parentPath.length === 0) {
    return undefined
  }

  const ignoredLabels = new Set([
    'Keyspaces',
    'System Keyspaces',
    'Cluster',
    'Security',
    'Diagnostics',
  ])
  const selected = [...parentPath, label].find((part) => !ignoredLabels.has(part))
  return selected?.trim() || undefined
}

function prometheusManifestNodeId(kind: string) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')

  if (normalizedKind === 'storage') {
    return 'prometheus:tsdb'
  }

  return `prometheus:${normalizedKind || 'object'}`
}

function influxManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim()
  const bucket = bucketFromInfluxPath(label, parentPath)

  if (normalizedKind === 'buckets') {
    return 'influx:buckets'
  }

  if (normalizedKind === 'bucket') {
    return `bucket:${normalizedLabel}`
  }

  if (bucket && normalizedKind === 'measurements') {
    return `measurements:${bucket}`
  }

  if (bucket && normalizedKind === 'tags') {
    return `tags:${bucket}`
  }

  if (bucket && normalizedKind === 'fields') {
    return `fields:${bucket}`
  }

  if (bucket && normalizedKind === 'retention-policies') {
    return `retention:${bucket}`
  }

  if (normalizedKind === 'tasks') {
    return 'influx:tasks'
  }

  if (normalizedKind === 'security') {
    return 'influx:security'
  }

  if (normalizedKind === 'diagnostics') {
    return 'influx:diagnostics'
  }

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
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  return `opentsdb:${normalizedKind || 'object'}`
}

function graphManifestNodeId(kind: string) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  return `graph:${normalizedKind || 'graphs'}`
}

function warehouseManifestNodeId(connection: ConnectionProfile, kind: string, label: string) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim()

  if (['database', 'dataset', 'schema'].includes(normalizedKind)) {
    return `${normalizedKind}:${normalizedLabel}`
  }

  if (normalizedKind === 'tasks') {
    return 'warehouse:jobs'
  }

  if (normalizedKind === 'warehouses') {
    return 'warehouse:warehouses'
  }

  if (normalizedKind === 'reservations' || normalizedKind === 'clusters') {
    return 'warehouse:warehouses'
  }

  if (['databases', 'datasets', 'schemas', 'tables', 'views', 'materialized-views', 'stages', 'jobs', 'security', 'diagnostics'].includes(normalizedKind)) {
    return `warehouse:${normalizedKind}`
  }

  return `warehouse:${connection.engine}:${normalizedKind || 'object'}`
}

function memcachedManifestNodeId(kind: string, label: string) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')

  if (normalizedKind === 'server') {
    return 'memcached:server'
  }

  if (normalizedKind === 'diagnostics') {
    return 'memcached:diagnostics'
  }

  if (['stats', 'slabs', 'items', 'settings', 'connections'].includes(normalizedKind)) {
    return `memcached:${normalizedKind}`
  }

  if (normalizedLabel === 'item-classes') {
    return 'memcached:items'
  }

  return `memcached:${normalizedKind || normalizedLabel || 'object'}`
}

function liteDbManifestNodeId(kind: string, label: string) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')

  if (normalizedKind === 'database') {
    return 'litedb:database'
  }

  if (normalizedKind === 'diagnostics') {
    return 'litedb:diagnostics'
  }

  if (['collections', 'indexes', 'file-storage', 'storage', 'settings'].includes(normalizedKind)) {
    return `litedb:${normalizedKind}`
  }

  if (normalizedKind === 'files' || normalizedLabel === 'files') {
    return 'litedb:files'
  }

  if (normalizedKind === 'chunks' || normalizedLabel === 'chunks') {
    return 'litedb:chunks'
  }

  return `litedb:${normalizedKind || normalizedLabel || 'object'}`
}

function cosmosManifestNodeId(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const database =
    parentPath.find((segment) => !isCosmosCategory(segment)) ||
    connection.database?.trim() ||
    'catalog'

  if (normalizedKind === 'account') {
    return 'cosmos:account'
  }

  if (normalizedKind === 'databases') {
    return 'cosmos:databases'
  }

  if (normalizedKind === 'database') {
    return `cosmos:database:${label || database}`
  }

  if (normalizedKind === 'containers') {
    return `cosmos:containers:${database}`
  }

  if ([
    'regions',
    'consistency',
    'security',
    'diagnostics',
  ].includes(normalizedKind)) {
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

function resolveManifestTreeLabel(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
) {
  const databasePlaceholder = /\{\{database(?::([^}]+))?\}\}/
  const databaseMatch = manifestNode.label.match(databasePlaceholder)

  if (!databaseMatch) {
    return manifestNode.label
  }

  const database =
    connection.database?.trim() ||
    manifestNode.defaultDatabase ||
    databaseMatch[1]?.trim()

  if (!database && manifestNode.requiresDatabase) {
    return undefined
  }

  if (!database) {
    return manifestNode.label.replace(databasePlaceholder, 'default')
  }

  return manifestNode.label.replace(databasePlaceholder, database)
}
