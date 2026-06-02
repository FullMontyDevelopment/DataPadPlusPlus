import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { normalizeKind } from './SideBar.connection-tree-manifest-common'
import { mysqlManifestNodeId } from './SideBar.connection-tree-manifest-mysql'

export function sqlManifestNodeId(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  if (connection.engine === 'sqlite') return sqliteManifestNodeId(kind, label, parentPath)
  if (connection.engine === 'duckdb') return duckDbManifestNodeId(kind, label, parentPath)
  if (connection.engine === 'cockroachdb') return cockroachManifestNodeId(connection, kind, label, parentPath)
  if (connection.engine === 'timescaledb') return timescaleManifestNodeId(kind, label, parentPath)
  if (connection.engine === 'postgresql') return postgresManifestNodeId(kind, label, parentPath)
  if (connection.engine === 'sqlserver') return sqlServerManifestNodeId(connection, kind, label, parentPath)
  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return mysqlManifestNodeId(connection, kind, label, parentPath)
  }
  return undefined
}

export function sqlManifestNodeScope(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  if (connection.engine === 'sqlite') return sqliteManifestNodeId(kind, label, parentPath)
  if (connection.engine === 'duckdb') return duckDbManifestNodeId(kind, label, parentPath)
  if (connection.engine === 'cockroachdb') return cockroachManifestNodeScope(connection, kind, label, parentPath)
  if (connection.engine === 'timescaledb') return timescaleManifestNodeScope(kind, label, parentPath)
  if (connection.engine === 'postgresql') return postgresManifestNodeScope(kind, label, parentPath)
  if (connection.engine === 'sqlserver') return sqlServerManifestNodeScope(connection, kind, label, parentPath)
  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return mysqlManifestNodeId(connection, kind, label, parentPath)
  }
  return undefined
}

function sqliteManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)
  const underMainDatabase = parentPath.includes('Main Database')

  if (normalizedKind === 'database' && normalizedLabel === 'main-database') return 'database:main'
  if (normalizedKind === 'attached-databases') {
    return underMainDatabase ? 'folder:main:attached-databases' : 'attached-databases'
  }
  if (normalizedKind === 'maintenance') return 'maintenance:main'
  if (underMainDatabase && ['tables', 'views', 'indexes', 'triggers', 'schema', 'pragmas'].includes(normalizedKind)) {
    return normalizedKind === 'pragmas' ? 'pragmas:main' : `folder:main:${normalizedKind}`
  }
  return `sqlite:${[...parentPath, label, normalizedKind].join('/')}`
}

function duckDbManifestNodeId(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)
  const schema = duckDbSchemaFromPath(label, parentPath)

  if (normalizedKind === 'database' || normalizedKind === 'schemas') return 'duckdb:database'
  if (normalizedKind === 'schema') return `schema:${label}`
  if (schema && ['tables', 'views', 'indexes', 'functions'].includes(normalizedKind)) {
    return `${normalizedKind}:${schema}`
  }
  if (normalizedKind === 'attached-databases') return 'duckdb:attached-databases'
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
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)
  const schema = postgresSchemaFromManifestPath(label, parentPath)
  const underDiagnostics = parentPath.includes('Diagnostics')

  if (normalizedKind === 'diagnostics') return 'postgres:diagnostics'
  if (underDiagnostics) {
    return normalizedKind === 'statistics'
      ? 'postgres:diagnostics:statistics'
      : normalizedKind === 'index-health'
        ? 'postgres:diagnostics:index-health'
        : `postgres:diagnostics:${normalizedKind || normalizedLabel}`
  }
  if (schema && normalizedKind === 'security') return `postgres:${schema}:security`
  if (normalizedKind === 'security') return 'postgres:security'
  if (parentPath.includes('Security') && ['roles', 'permissions'].includes(normalizedKind)) {
    return `postgres:security:${normalizedKind}`
  }
  if (normalizedKind === 'schema') return `schema:${schema || label}`

  const sectionScope = postgresManifestSectionScope(normalizedKind)
  return schema && sectionScope
    ? `postgres:${schema}:${sectionScope}`
    : `postgres:${[...parentPath, label, normalizedKind].join('/')}`
}

function postgresManifestNodeScope(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = normalizeKind(kind)
  const schema = postgresSchemaFromManifestPath(label, parentPath)

  if (normalizedKind === 'schema' && schema) return `schema:${schema}`

  const sectionScope = postgresManifestSectionScope(normalizedKind)
  if (schema && sectionScope) return `postgres:${schema}:${sectionScope}`
  if (normalizedKind === 'security' && !schema) return 'postgres:security'
  if (normalizedKind === 'diagnostics') return 'postgres:diagnostics'

  return undefined
}

function postgresSchemaFromManifestPath(label: string, parentPath: string[]) {
  const path = [...parentPath, label]
  const schemaRoots = [path.indexOf('User Schemas'), path.indexOf('System Schemas')]
  const schemaIndex = schemaRoots.find((index) => index >= 0)
  const schema = schemaIndex === undefined ? undefined : path[schemaIndex + 1]

  if (!schema || ['Tables', 'Views', 'Materialized Views', 'Hypertables', 'Indexes', 'Functions', 'Procedures', 'Sequences', 'Types', 'Extensions', 'Security'].includes(schema)) {
    return undefined
  }
  return schema
}

function postgresManifestSectionScope(kind: string) {
  const scopes: Record<string, string> = {
    tables: 'tables',
    hypertables: 'hypertables',
    views: 'views',
    'materialized-views': 'materialized-views',
    indexes: 'indexes',
    functions: 'functions',
    procedures: 'procedures',
    sequences: 'sequences',
    types: 'types',
    extensions: 'extensions',
  }

  return scopes[kind]
}

function timescaleManifestNodeId(kind: string, label: string, parentPath: string[]) {
  return timescaleManifestNodeScope(kind, label, parentPath) ?? postgresManifestNodeId(kind, label, parentPath)
}

function timescaleManifestNodeScope(kind: string, label: string, parentPath: string[]) {
  const normalizedKind = normalizeKind(kind)
  const schema = postgresSchemaFromManifestPath(label, parentPath)
  const timescaleSection = timescaleManifestSectionScope(normalizedKind)

  if (schema && timescaleSection) return `timescale:${schema}:${timescaleSection}`
  if (!schema && timescaleSection) return `timescale:${timescaleSection}`

  return postgresManifestNodeScope(kind, label, parentPath)
}

function timescaleManifestSectionScope(kind: string) {
  const scopes: Record<string, string> = {
    hypertables: 'hypertables',
    'continuous-aggregates': 'continuous-aggregates',
    chunks: 'chunks',
    compression: 'compression',
    retention: 'retention',
    jobs: 'jobs',
  }

  return scopes[kind]
}

function cockroachManifestNodeId(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  const scope = cockroachManifestNodeScope(connection, kind, label, parentPath)
  if (scope) return scope

  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)
  const database = cockroachDatabaseFromManifestPath(connection, label, parentPath)

  if (normalizedKind === 'databases') return 'cockroach:databases'
  if (normalizedKind === 'database') return `database:${database}`

  return `cockroach:${[...parentPath, label, normalizedKind || normalizedLabel].join('/')}`
}

function cockroachManifestNodeScope(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  const normalizedKind = normalizeKind(kind)
  const schema = postgresSchemaFromManifestPath(label, parentPath)

  if (normalizedKind === 'schema') return schema ? `schema:${schema}` : undefined

  const sectionScope = postgresManifestSectionScope(normalizedKind)
  if (schema && sectionScope) return `postgres:${schema}:${sectionScope}`
  if (schema && normalizedKind === 'zone-configurations') return 'cockroach:zone-configurations'

  const clusterScope = cockroachManifestClusterScope(normalizedKind)
  if (clusterScope) return clusterScope

  const database = cockroachDatabaseFromManifestPath(connection, label, parentPath)
  return normalizedKind === 'database' ? `database:${database}` : undefined
}

function cockroachDatabaseFromManifestPath(
  connection: ConnectionProfile,
  label: string,
  parentPath: string[],
) {
  const path = [...parentPath, label]
  const databasesIndex = path.indexOf('Databases')
  const database = databasesIndex >= 0 ? path[databasesIndex + 1] : undefined

  return database && !['User Schemas', 'System Schemas'].includes(database)
    ? database
    : connection.database?.trim() || ''
}

function cockroachManifestClusterScope(kind: string) {
  const scopes: Record<string, string> = {
    nodes: 'cockroach:cluster-status',
    ranges: 'cockroach:ranges',
    regions: 'cockroach:regions',
    jobs: 'cockroach:jobs',
    'cluster-settings': 'cockroach:cluster-settings',
    roles: 'cockroach:roles',
    grants: 'cockroach:roles',
    certificates: 'cockroach:certificates',
    sessions: 'cockroach:sessions',
    statements: 'cockroach:statements',
    transactions: 'cockroach:transactions',
    contention: 'cockroach:contention',
    locks: 'cockroach:locks',
    statistics: 'cockroach:statistics',
  }

  return scopes[kind]
}

function sqlServerManifestNodeId(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)
  const database = sqlServerDatabaseFromManifestPath(connection, label, parentPath)

  if (normalizedKind === 'databases') return 'sqlserver:databases'
  if (normalizedKind === 'database') return `database:${database}`

  const categoryScope = sqlServerManifestCategoryScope(normalizedKind)
  if (categoryScope && parentPath.includes(database)) return `sqlserver:${database}:${categoryScope}`

  return `sqlserver:${[...parentPath, label, normalizedKind || normalizedLabel].join('/')}`
}

function sqlServerManifestNodeScope(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  const normalizedKind = normalizeKind(kind)

  if (normalizedKind === 'database') return sqlServerManifestNodeId(connection, kind, label, parentPath)

  const database = sqlServerDatabaseFromManifestPath(connection, label, parentPath)
  const categoryScope = sqlServerManifestCategoryScope(normalizedKind)
  return categoryScope && parentPath.includes(database)
    ? `sqlserver:${database}:${categoryScope}`
    : undefined
}

function sqlServerDatabaseFromManifestPath(
  connection: ConnectionProfile,
  label: string,
  parentPath: string[],
) {
  const path = [...parentPath, label]
  const databasesIndex = path.indexOf('Databases')
  const pathDatabase = databasesIndex >= 0 ? path[databasesIndex + 1] : undefined

  return pathDatabase && !isSqlServerManifestCategory(pathDatabase)
    ? pathDatabase
    : connection.database?.trim() || ''
}

function sqlServerManifestCategoryScope(kind: string) {
  const scopes: Record<string, string> = {
    tables: 'tables',
    views: 'views',
    'stored-procedures': 'stored-procedures',
    functions: 'functions',
    'scalar-functions': 'functions.scalar',
    'table-valued-functions': 'functions.table-valued',
    'aggregate-functions': 'functions.aggregate',
    'clr-functions': 'functions.clr',
    synonyms: 'synonyms',
    sequences: 'sequences',
    types: 'types',
    security: 'security',
    users: 'security.users',
    roles: 'security.roles',
    schemas: 'security.schemas',
    storage: 'storage',
    files: 'storage.files',
    filegroups: 'storage.filegroups',
    'query-store': 'query-store',
    performance: 'performance',
    sessions: 'performance.sessions',
    locks: 'performance.locks',
    waits: 'performance.waits',
    'missing-indexes': 'performance.missing-indexes',
  }

  return scopes[kind]
}

function isSqlServerManifestCategory(label: string) {
  return [
    'Databases',
    'System Databases',
    'Database Snapshots',
    'Tables',
    'Views',
    'Stored Procedures',
    'Functions',
    'Synonyms',
    'Sequences',
    'Types',
    'Security',
    'Storage',
    'Query Store',
    'Performance',
  ].includes(label)
}
