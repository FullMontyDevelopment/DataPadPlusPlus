import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import { cassandraIndexes, cassandraTables } from './browser-cassandra-fixtures'
import {
  cassandraInspectQueryTemplate,
  cassandraKeyspace,
  cassandraQueryTemplate,
  cassandraSectionLabel,
  parseCassandraTableScope,
} from './browser-cassandra-helpers'

export { cassandraInspectQueryTemplate }

export function createCassandraExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const keyspace = cassandraKeyspace(connection)

  if (!scope) {
    return [
      cassandraNode(connection, `keyspace:${keyspace}`, keyspace, 'keyspace', 'Application keyspace', `keyspace:${keyspace}`, ['Keyspaces'], true),
      cassandraNode(connection, 'cassandra:system-keyspaces', 'System Keyspaces', 'system-keyspaces', 'system_schema, system, and tracing metadata', 'cassandra:system-keyspaces', [], true),
      cassandraNode(connection, 'cassandra:cluster', 'Cluster', 'cluster', 'Nodes, datacenters, token ownership, and replication', 'cassandra:cluster', [], true),
      cassandraNode(connection, 'cassandra:security', 'Security', 'security', 'Roles, grants, and permission visibility', 'cassandra:security', [], true),
      cassandraNode(connection, 'cassandra:diagnostics', 'Diagnostics', 'diagnostics', 'Tracing, repairs, compaction, and latency signals', 'cassandra:diagnostics', [], true),
    ]
  }

  if (scope.startsWith('keyspace:')) {
    const scopedKeyspace = scope.replace('keyspace:', '') || keyspace
    return cassandraKeyspaceFolders(connection, scopedKeyspace)
  }

  if (scope === 'cassandra:system-keyspaces') {
    return ['system_schema', 'system', 'system_traces'].map((systemKeyspace) =>
      cassandraNode(connection, `keyspace:${systemKeyspace}`, systemKeyspace, 'keyspace', 'System metadata keyspace', `keyspace:${systemKeyspace}`, ['System Keyspaces'], true),
    )
  }

  if (scope.startsWith('cassandra:')) {
    const [, scopedKeyspace = keyspace, section = 'tables'] = scope.split(':')

    if (scopedKeyspace === 'cluster') {
      return [
        cassandraNode(connection, 'cassandra:cluster:nodes', 'Nodes', 'nodes', 'Node status, datacenter, rack, and token ownership', undefined, ['Cluster']),
        cassandraNode(connection, 'cassandra:cluster:replication', 'Replication', 'statistics', 'Replication strategy and factor by keyspace', undefined, ['Cluster']),
        cassandraNode(connection, 'cassandra:cluster:repairs', 'Repairs', 'repairs', 'Repair and anti-entropy posture', undefined, ['Cluster']),
      ]
    }

    if (scopedKeyspace === 'security') {
      return [
        cassandraNode(connection, 'cassandra:security:roles', 'Roles', 'security', 'Role hierarchy and login state', undefined, ['Security']),
        cassandraNode(connection, 'cassandra:security:permissions', 'Permissions', 'permissions', 'Visible grants and resource permissions', undefined, ['Security']),
      ]
    }

    if (scopedKeyspace === 'diagnostics') {
      return [
        cassandraNode(connection, 'cassandra:diagnostics:tracing', 'Tracing', 'tracing', 'Trace sessions and latency detail', undefined, ['Diagnostics']),
        cassandraNode(connection, 'cassandra:diagnostics:compaction', 'Compaction', 'compaction', 'Pending compactions and compaction throughput', undefined, ['Diagnostics']),
        cassandraNode(connection, 'cassandra:diagnostics:statistics', 'Statistics', 'statistics', 'Read/write latency, tombstones, and dropped messages', undefined, ['Diagnostics']),
        cassandraNode(connection, 'cassandra:diagnostics:repairs', 'Repairs', 'repairs', 'Repair schedules and pending ranges', undefined, ['Diagnostics']),
      ]
    }

    return cassandraObjectsForSection(connection, scopedKeyspace, section)
  }

  if (scope.startsWith('table:')) {
    const { keyspace: scopedKeyspace, table } = parseCassandraTableScope(scope, keyspace)
    if (!table) return []
    return cassandraTableSections(connection, scopedKeyspace, table)
  }

  return []
}

function cassandraKeyspaceFolders(connection: ConnectionProfile, keyspace: string): ExplorerNode[] {
  const path = ['Keyspaces', keyspace]
  const folder = (id: string, label: string, kind: string, detail: string) =>
    cassandraNode(connection, `cassandra:${keyspace}:${id}`, label, kind, detail, `cassandra:${keyspace}:${id}`, path, true)

  return [
    folder('tables', 'Tables', 'tables', 'Partition-key-first tables'),
    folder('materialized-views', 'Materialized Views', 'materialized-views', 'Derived query tables'),
    folder('indexes', 'Indexes', 'indexes', 'SAI and secondary indexes'),
    folder('types', 'Types', 'types', 'User-defined types'),
    folder('functions', 'Functions', 'functions', 'User-defined functions'),
    folder('aggregates', 'Aggregates', 'aggregates', 'User-defined aggregates'),
    folder('permissions', 'Permissions', 'permissions', 'Visible grants for this keyspace'),
  ]
}

function cassandraObjectsForSection(
  connection: ConnectionProfile,
  keyspace: string,
  section: string,
): ExplorerNode[] {
  const path = ['Keyspaces', keyspace, cassandraSectionLabel(section)]

  if (section === 'tables') {
    return cassandraTables().map((table) =>
      cassandraNode(
        connection,
        `table:${keyspace}:${table.name}`,
        table.name,
        'table',
        `${table.partitionKey} partition key / ${table.rows.toLocaleString()} estimated rows`,
        `table:${keyspace}.${table.name}`,
        path,
        true,
        cassandraQueryTemplate(keyspace, table.name),
      ),
    )
  }

  if (section === 'materialized-views') {
    return [
      cassandraNode(connection, `materialized-view:${keyspace}:orders_by_status`, 'orders_by_status', 'materialized-view', 'Base table orders_by_customer', undefined, path, false, cassandraQueryTemplate(keyspace, 'orders_by_status')),
    ]
  }

  if (section === 'indexes') {
    return cassandraIndexes().map((index) =>
      cassandraNode(connection, `index:${keyspace}:${index.name}`, index.name, 'index', `${index.kind} on ${index.target}`, undefined, path),
    )
  }

  if (section === 'types') {
    return [
      cassandraNode(connection, `type:${keyspace}:money`, 'money', 'type', 'amount decimal, currency text', undefined, path),
    ]
  }

  if (section === 'functions') {
    return [
      cassandraNode(connection, `function:${keyspace}:normalize_sku`, 'normalize_sku', 'function', 'text -> text', undefined, path),
    ]
  }

  if (section === 'aggregates') {
    return [
      cassandraNode(connection, `aggregate:${keyspace}:sum_money`, 'sum_money', 'aggregate', 'money accumulator aggregate', undefined, path),
    ]
  }

  if (section === 'permissions') {
    return [
      cassandraNode(connection, `permissions:${keyspace}`, 'Keyspace Grants', 'permissions', 'Roles and permissions for this keyspace', undefined, path),
    ]
  }

  return []
}

function cassandraTableSections(
  connection: ConnectionProfile,
  keyspace: string,
  table: string,
): ExplorerNode[] {
  const path = ['Keyspaces', keyspace, 'Tables', table]

  return [
    cassandraNode(connection, `data:${keyspace}:${table}`, 'Data', 'data', 'Partition-key-first row query', undefined, path, false, cassandraQueryTemplate(keyspace, table)),
    cassandraNode(connection, `columns:${keyspace}:${table}`, 'Columns', 'columns', 'Column roles and CQL types', undefined, path),
    cassandraNode(connection, `primary-key:${keyspace}:${table}`, 'Primary Key', 'primary-key', 'Partition and clustering key order', undefined, path),
    cassandraNode(connection, `indexes:${keyspace}:${table}`, 'Indexes', 'indexes', 'Table indexes and read-path tradeoffs', undefined, path),
    cassandraNode(connection, `compaction:${keyspace}:${table}`, 'Compaction', 'compaction', 'Compaction, compression, and tombstone settings', undefined, path),
    cassandraNode(connection, `statistics:${keyspace}:${table}`, 'Statistics', 'statistics', 'Estimated partitions, SSTables, and latency', undefined, path),
    cassandraNode(connection, `permissions:${keyspace}:${table}`, 'Permissions', 'permissions', 'Visible table grants', undefined, path),
  ]
}

function cassandraNode(
  _connection: ConnectionProfile,
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  path: string[] = [],
  expandable = false,
  queryTemplate?: string,
): ExplorerNode {
  return {
    id,
    family: 'widecolumn',
    label,
    kind,
    detail,
    scope,
    path,
    queryTemplate,
    expandable,
  }
}
