import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { normalizeKind } from './SideBar.connection-tree-manifest-common'

export function mysqlManifestNodeId(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  const normalizedKind = normalizeKind(kind)
  const normalizedLabel = normalizeKind(label)
  const database = mysqlDatabaseFromManifestPath(connection, label, parentPath)
  const underDiagnostics = parentPath.includes('Diagnostics')
  const underSecurity = parentPath.includes('Security') || parentPath.includes('Users / Privileges')
  const underSelectedDatabase = Boolean(database) && parentPath.includes(database)

  if (normalizedKind === 'databases') return 'mysql:databases'
  if (normalizedKind === 'database') return `database:${database}`
  if (normalizedKind === 'system-schemas') return 'mysql:system-schemas'
  if (normalizedKind === 'diagnostics') return 'mysql:diagnostics'
  if (underDiagnostics) {
    return normalizedKind === 'statistics'
      ? 'mysql:diagnostics:statistics'
      : `mysql:diagnostics:${normalizedKind || normalizedLabel}`
  }
  if (normalizedKind === 'security' && !underSelectedDatabase) return 'mysql:security'
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

function mysqlDatabaseFromManifestPath(
  connection: ConnectionProfile,
  label: string,
  parentPath: string[],
) {
  const path = [...parentPath, label]
  const databasesIndex = path.indexOf('Databases')
  const pathDatabase = databasesIndex >= 0 ? path[databasesIndex + 1] : undefined

  return pathDatabase && !isMysqlManifestCategory(pathDatabase)
    ? pathDatabase
    : connection.database?.trim() || ''
}

function isMysqlManifestCategory(label: string) {
  return [
    'Databases',
    'System Schemas',
    'Tables',
    'Views',
    'Stored Procedures',
    'Functions',
    'Events',
    'Triggers',
    'Indexes',
    'Storage',
    'Users / Privileges',
    'Security',
    'Diagnostics',
  ].includes(label)
}
