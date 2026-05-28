import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { cassandraPartitionKeyForTable } from './browser-cassandra-fixtures'

export function cassandraInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const { keyspace, table } = cassandraTableNameFromNodeId(connection, nodeId)

  if (table) {
    return cassandraQueryTemplate(keyspace, table)
  }

  return 'select keyspace_name, table_name from system_schema.tables;'
}

export function cassandraQueryTemplate(keyspace: string, tableName: string) {
  return `select * from "${keyspace}"."${tableName}" where ${cassandraPartitionKeyForTable(tableName)} = ? limit 20;`
}

export function parseCassandraTableScope(scope: string, fallbackKeyspace: string) {
  const value = scope.replace('table:', '')
  const [keyspaceAndMaybeTable, maybeTable] = value.split('.')

  return maybeTable
    ? { keyspace: keyspaceAndMaybeTable || fallbackKeyspace, table: maybeTable }
    : { keyspace: fallbackKeyspace, table: value || 'orders_by_customer' }
}

export function cassandraTableNameFromNodeId(connection: ConnectionProfile, nodeId: string) {
  const fallbackKeyspace = cassandraKeyspace(connection)

  if (nodeId.startsWith('table:')) {
    const [, keyspace = fallbackKeyspace, table = 'orders_by_customer'] = nodeId.split(':')
    return { keyspace, table }
  }

  if (/^(data|columns|primary-key|indexes|compaction|statistics|permissions):/.test(nodeId)) {
    const [, keyspace = fallbackKeyspace, table = 'orders_by_customer'] = nodeId.split(':')
    return { keyspace, table }
  }

  if (nodeId.startsWith('materialized-view:')) {
    const [, keyspace = fallbackKeyspace, table = 'orders_by_status'] = nodeId.split(':')
    return { keyspace, table }
  }

  return { keyspace: fallbackKeyspace, table: undefined }
}

export function cassandraObjectViewFromNodeId(nodeId: string) {
  if (nodeId.startsWith('data:')) return 'data'
  if (nodeId.startsWith('columns:')) return 'columns'
  if (nodeId.startsWith('primary-key:')) return 'primary-key'
  if (nodeId.startsWith('indexes:')) return 'indexes'
  if (nodeId.startsWith('compaction:')) return 'compaction'
  if (nodeId.startsWith('statistics:')) return 'statistics'
  if (nodeId.startsWith('permissions:')) return 'permissions'
  if (nodeId.startsWith('materialized-view:')) return 'materialized-view'
  return 'table'
}

export function cassandraKeyspace(connection: ConnectionProfile) {
  return connection.database || 'app'
}

export function cassandraSectionLabel(section: string) {
  return section
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}
