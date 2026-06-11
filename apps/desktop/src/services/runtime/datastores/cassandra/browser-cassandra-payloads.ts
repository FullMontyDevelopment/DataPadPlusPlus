import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  cassandraColumns,
  cassandraIndexes,
  cassandraPermissions,
  cassandraPrimaryKey,
  cassandraTableDiagnostics,
  cassandraTableOptions,
  cassandraTables,
} from './browser-cassandra-fixtures'
import {
  cassandraKeyspace,
  cassandraObjectViewFromNodeId,
  cassandraTableNameFromNodeId,
} from './browser-cassandra-helpers'

export function cassandraInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const { keyspace, table } = cassandraTableNameFromNodeId(connection, nodeId)
  const objectView = cassandraObjectViewFromNodeId(nodeId)
  const tableLikeNode = /^(table|data|columns|primary-key|indexes|compaction|statistics|permissions|materialized-view):/.test(nodeId)

  if (nodeId.startsWith('keyspace:')) {
    return cassandraKeyspacePayload(connection, nodeId.replace('keyspace:', '') || keyspace)
  }

  if (table) {
    return cassandraTablePayload(keyspace, table, objectView)
  }

  if (tableLikeNode) {
    return cassandraTablePayload(keyspace, '', objectView)
  }

  if (nodeId.startsWith('cassandra:cluster')) {
    return cassandraClusterPayload(connection)
  }

  if (nodeId.startsWith('cassandra:security')) {
    return cassandraSecurityPayload(connection)
  }

  if (nodeId.startsWith('cassandra:diagnostics')) {
    return cassandraDiagnosticsPayload(connection, nodeId)
  }

  if (nodeId.startsWith('index:')) {
    return {
      engine: 'cassandra',
      keyspace,
      objectView: 'index',
      indexes: cassandraIndexes(),
      warnings: ['Index previews are deterministic in browser mode; live metadata comes from system_schema.indexes.'],
    }
  }

  return cassandraKeyspacePayload(connection, keyspace)
}

function cassandraKeyspacePayload(connection: ConnectionProfile, keyspace: string) {
  return {
    engine: 'cassandra',
    keyspace,
    objectView: 'keyspace',
    tableCount: cassandraTables().length,
    indexCount: cassandraIndexes().length,
    replication: connection.database ? 'NetworkTopologyStrategy / local DC' : 'SimpleStrategy / rf=1',
    tables: cassandraTables(),
    materializedViews: [{ name: 'orders_by_status', baseTable: 'orders_by_customer', primaryKey: 'status, order_day, order_id', includedColumns: 'customer_id, total' }],
    indexes: cassandraIndexes(),
    types: [{ name: 'money', fields: 'amount decimal, currency text' }],
    functions: [{ name: 'normalize_sku', signature: 'text', language: 'java', returnType: 'text' }],
    aggregates: [{ name: 'sum_money', stateFunction: 'sum_money_state', finalFunction: '-', returnType: 'money' }],
    permissions: cassandraPermissions(keyspace),
  }
}

function cassandraTablePayload(
  keyspace: string,
  tableName: string,
  objectView: string,
) {
  const tables = cassandraTables()
  const table = tables.find((candidate) => candidate.name === tableName)
  if (!table) {
    return {
      engine: 'cassandra',
      keyspace,
      objectView,
      tableName,
      tables: [],
      columns: [],
      primaryKey: [],
      indexes: [],
      options: [],
      permissions: [],
      diagnostics: [],
      warningRows: [
        {
          warning: 'No table metadata is available.',
          scope: tableName || keyspace,
          guidance: 'Refresh the keyspace metadata or select another table.',
        },
      ],
    }
  }
  const base = {
    engine: 'cassandra',
    keyspace,
    objectView,
    tableName: table.name,
    tableCount: cassandraTables().length,
    partitionCount: table.partitions,
    sstableCount: table.sstables,
    indexCount: table.indexes,
    p95ReadMs: table.p95ReadMs,
    tombstoneWarningCount: table.tombstoneWarnings,
    tables: [table],
    columns: cassandraColumns(table.name),
    primaryKey: cassandraPrimaryKey(table.name),
    indexes: cassandraIndexes().filter((index) => index.table === table.name),
    options: cassandraTableOptions(table.name),
    permissions: cassandraPermissions(keyspace).filter((permission) => permission.resource.includes(table.name) || permission.resource.endsWith(keyspace)),
    diagnostics: cassandraTableDiagnostics(table.name),
    warningRows: table.tombstoneWarnings
      ? [{ warning: 'High tombstone reads', scope: table.name, guidance: 'Review TTL/delete patterns and compaction windows.' }]
      : [],
  }

  if (objectView === 'data') {
    return { ...base, columns: [], primaryKey: [], indexes: [], options: [], permissions: [], diagnostics: [], warningRows: [] }
  }

  if (objectView === 'columns') {
    return { ...base, tables: [], indexes: [], options: [], permissions: [], diagnostics: [], warningRows: [] }
  }

  if (objectView === 'primary-key') {
    return { ...base, tables: [], columns: [], indexes: [], options: [], permissions: [], diagnostics: [], warningRows: [] }
  }

  if (objectView === 'indexes') {
    return { ...base, tables: [], columns: [], primaryKey: [], options: [], permissions: [], diagnostics: [], warningRows: [] }
  }

  if (objectView === 'compaction') {
    return { ...base, tables: [], columns: [], primaryKey: [], indexes: [], permissions: [], diagnostics: [], warningRows: [] }
  }

  if (objectView === 'statistics') {
    return { ...base, tables: [], columns: [], primaryKey: [], indexes: [], options: [], permissions: [] }
  }

  if (objectView === 'permissions') {
    return { ...base, tables: [], columns: [], primaryKey: [], indexes: [], options: [], diagnostics: [], warningRows: [] }
  }

  return base
}

function cassandraClusterPayload(connection: ConnectionProfile) {
  return {
    engine: 'cassandra',
    keyspace: cassandraKeyspace(connection),
    objectView: 'cluster',
    nodes: [
      { node: '127.0.0.1', datacenter: 'datacenter1', status: 'UN', tokens: 16, load: '128 MB' },
      { node: '127.0.0.2', datacenter: 'datacenter1', status: 'UN', tokens: 16, load: '132 MB' },
    ],
    diagnostics: [
      { signal: 'Replication', value: 'rf=1 preview', status: 'Info', guidance: 'Use NetworkTopologyStrategy for multi-node production keyspaces.' },
      { signal: 'Repair freshness', value: 'preview', status: 'Unknown', guidance: 'Live repair metadata depends on nodetool or virtual table access.' },
    ],
  }
}

function cassandraSecurityPayload(connection: ConnectionProfile) {
  const keyspace = cassandraKeyspace(connection)
  return {
    engine: 'cassandra',
    keyspace,
    objectView: 'security',
    permissions: cassandraPermissions(keyspace),
    warningRows: [
      { warning: 'Role metadata may be permission-limited', scope: 'system_auth', guidance: 'Use a role with DESCRIBE permissions to inspect every grant.' },
    ],
  }
}

function cassandraDiagnosticsPayload(connection: ConnectionProfile, nodeId: string) {
  const keyspace = cassandraKeyspace(connection)
  const base = {
    engine: 'cassandra',
    keyspace,
    objectView: 'diagnostics',
    diagnostics: [
      { signal: 'Read latency p95', value: '6 ms', status: 'Healthy', guidance: 'Partition reads are within expected bounds.' },
      { signal: 'Dropped mutations', value: 0, status: 'Healthy', guidance: 'No dropped mutation pressure in preview diagnostics.' },
      { signal: 'Pending compactions', value: 2, status: 'Watch', guidance: 'Monitor compaction backlog if write throughput increases.' },
    ],
    warningRows: [
      { warning: 'Live tracing requires explicit user action', scope: 'tracing', guidance: 'Open tracing after running a query with tracing enabled.' },
    ],
  }

  if (nodeId.endsWith(':tracing')) {
    return { ...base, objectView: 'tracing', diagnostics: [{ signal: 'Recent traces', value: 0, status: 'Idle', guidance: 'Run a traced CQL query to collect session events.' }] }
  }

  if (nodeId.endsWith(':repairs')) {
    return { ...base, objectView: 'repairs', diagnostics: [{ signal: 'Repair tasks', value: 'none active', status: 'Idle', guidance: 'Schedule regular repairs for multi-node clusters.' }] }
  }

  return base
}
