import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  postgresSourceInspectPayload,
  postgresSourceInspectQueryTemplate,
} from './browser-relational-source-payloads'
import {
  timescaleInspectPayload,
  timescaleInspectQueryTemplate,
} from './browser-timescale-payloads'
import {
  parseCockroachNodeId,
  parsePostgresNodeId,
  postgresColumns,
} from './browser-postgres-family-helpers'

export function cockroachInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parseCockroachNodeId(connection, nodeId)

  if (['table:', 'view:'].some((prefix) => nodeId.startsWith(prefix)) && objectName) {
    return `select * from "${schema}"."${objectName}" limit 100;`
  }

  if (nodeId.includes('cluster-settings')) {
    return 'show cluster settings;'
  }

  if (nodeId.includes('jobs')) {
    return 'show jobs;'
  }

  if (nodeId.includes('cluster') || nodeId.includes('nodes') || nodeId.includes('ranges') || nodeId.includes('regions')) {
    return 'select * from crdb_internal.gossip_nodes limit 100;'
  }

  if (nodeId.includes('contention') || nodeId.includes('transactions') || nodeId.includes('statements')) {
    return 'select * from crdb_internal.cluster_statement_statistics limit 100;'
  }

  if (nodeId.includes('security') || nodeId.includes('roles') || nodeId.includes('grants')) {
    return 'show roles;'
  }

  if (nodeId.includes('diagnostics') || nodeId.includes('sessions')) {
    return 'show sessions;'
  }

  return `show tables from "${schema}";`
}

export function postgresInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parsePostgresNodeId(connection, nodeId)

  if (connection.engine === 'timescaledb') {
    const timescaleQuery = timescaleInspectQueryTemplate(nodeId, schema, objectName)
    if (timescaleQuery) {
      return timescaleQuery
    }
  }

  if (['table:', 'view:', 'materialized-view:'].some((prefix) => nodeId.startsWith(prefix)) && objectName) {
    return `select * from "${schema}"."${objectName}" limit 100;`
  }

  const sourceQuery = postgresSourceInspectQueryTemplate(nodeId, schema, objectName)
  if (sourceQuery) {
    return sourceQuery
  }

  if (nodeId.includes('locks')) {
    return 'select locktype, mode, granted, relation::regclass::text as relation from pg_locks limit 100;'
  }

  if (nodeId.includes('waits')) {
    return 'select wait_event_type, wait_event, count(*) as sessions from pg_stat_activity where wait_event is not null group by wait_event_type, wait_event order by sessions desc;'
  }

  if (nodeId.includes('statements')) {
    return 'select query, calls, mean_exec_time, rows from pg_stat_statements order by mean_exec_time desc limit 50;'
  }

  if (nodeId.includes('index-health')) {
    return 'select schemaname, relname, indexrelname, idx_scan, idx_tup_read, idx_tup_fetch from pg_stat_user_indexes order by idx_scan asc limit 100;'
  }

  if (nodeId.includes('diagnostics') || nodeId.includes('sessions')) {
    return 'select pid, usename, datname, state, wait_event_type, wait_event from pg_stat_activity order by query_start desc nulls last limit 100;'
  }

  if (nodeId.includes('security') || nodeId.includes('roles')) {
    return 'select rolname, rolcanlogin, rolsuper, rolinherit from pg_roles order by rolname;'
  }

  return `select schemaname, tablename from pg_catalog.pg_tables where schemaname = '${schema.replace(/'/g, "''")}' order by tablename;`
}

export function cockroachInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parseCockroachNodeId(connection, nodeId)
  const database = connection.database || 'defaultdb'
  const base = {
    engine: 'cockroachdb',
    database,
    schema,
    objectName,
  }

  const clusterPayload = {
    nodeCount: 3,
    rangeCount: 184,
    regionCount: 2,
    jobCount: 3,
    nodes: [
      { nodeId: 1, address: 'n1.local:26257', locality: 'region=us-east,az=a', ranges: 68, liveBytes: '1.4 GB', status: 'live' },
      { nodeId: 2, address: 'n2.local:26257', locality: 'region=us-east,az=b', ranges: 61, liveBytes: '1.1 GB', status: 'live' },
      { nodeId: 3, address: 'n3.local:26257', locality: 'region=eu-west,az=a', ranges: 55, liveBytes: '948 MB', status: 'live' },
    ],
    ranges: [
      { rangeId: 42, table: `${schema}.accounts`, replicas: '1,2,3', leaseholder: 1, qps: 18, size: '64 MB' },
      { rangeId: 43, table: `${schema}.orders`, replicas: '1,2,3', leaseholder: 2, qps: 7, size: '91 MB' },
    ],
    regions: [
      { region: 'us-east', locality: 'region=us-east', nodes: 2, survivalGoal: 'zone failure', constraints: '+region=us-east' },
      { region: 'eu-west', locality: 'region=eu-west', nodes: 1, survivalGoal: 'region failure', constraints: '+region=eu-west' },
    ],
    jobs: [
      { id: 101, type: 'SCHEMA CHANGE', status: 'succeeded', fraction: 1, description: 'CREATE INDEX products_sku_idx' },
      { id: 102, type: 'BACKUP', status: 'paused', fraction: 0.42, description: 'BACKUP DATABASE datapadplusplus' },
    ],
    clusterSettings: [
      { name: 'kv.rangefeed.enabled', value: 'true', type: 'b', description: 'rangefeed support' },
      { name: 'sql.defaults.results_buffer.size', value: '16KiB', type: 'z', description: 'SQL result buffering' },
    ],
  }

  if (nodeId.includes('cluster')) {
    return { ...base, ...clusterPayload }
  }

  if (nodeId.includes('security')) {
    return {
      ...base,
      roles: [
        { name: 'root', login: true, superuser: true, inherit: true, memberships: '' },
        { name: 'app_reader', login: false, superuser: false, inherit: true, memberships: '' },
      ],
      permissions: [
        { principal: 'app_reader', privilege: 'SELECT', object: `${schema}.accounts`, state: 'granted', grantor: 'root' },
      ],
    }
  }

  if (nodeId.includes('diagnostics')) {
    return {
      ...base,
      activeSessions: 5,
      blockedSessions: 1,
      retryCount: 2,
      sessions: [
        { sessionId: 's1', user: 'app', database, state: 'active', wait: 'CPU', blockedBy: '' },
        { sessionId: 's2', user: 'reporting', database, state: 'idle', wait: 'Client', blockedBy: '' },
      ],
      statements: [
        { query: 'select * from public.accounts', count: 42, meanMs: 12, p99Ms: 44, rows: 128, retries: 1 },
      ],
      transactions: [
        { id: 'txn-01', state: 'active', age: '2.1s', priority: 'normal', retries: 1 },
      ],
      contention: [
        { key: '/Table/104/1', table: `${schema}.accounts`, waiter: 'txn-01', durationMs: 18, blockingTxn: 'txn-00' },
      ],
      locks: [
        { sessionId: 's1', object: `${schema}.accounts`, mode: 'shared', granted: true, blocking: 'No' },
      ],
      statistics: [
        { name: `${schema}.accounts`, rows: 128, scans: 9, size: '96 KB' },
      ],
    }
  }

  if (nodeId.startsWith('table:')) {
    return {
      ...base,
      rowCount: 128,
      size: '96 KB',
      columns: postgresColumns(),
      indexes: [
        { name: `${objectName}_pkey`, type: 'primary', columns: 'id', unique: true, valid: true, size: '16 KB' },
        { name: `${objectName}_updated_at_idx`, type: 'secondary', columns: 'updated_at', unique: false, valid: true, size: '16 KB' },
      ],
      constraints: [
        { name: `${objectName}_pkey`, type: 'PRIMARY KEY', columns: 'id', status: 'validated' },
      ],
      statistics: [
        { name: objectName, rows: 128, scans: 6, lastAnalyze: '2026-05-16', size: '96 KB' },
      ],
      zoneConfigurations: [
        { target: `${schema}.${objectName}`, numReplicas: 3, constraints: '+region=us-east', leasePreferences: '+region=us-east', gcTtlSeconds: 90000 },
      ],
    }
  }

  if (nodeId.startsWith('schema:') || nodeId.startsWith('cockroach:')) {
    return {
      ...base,
      tableCount: 3,
      indexCount: 8,
      tables: [
        { schema, name: 'accounts', type: 'regional table', rows: 128, size: '96 KB', owner: 'app' },
        { schema, name: 'orders', type: 'regional table', rows: 348, size: '184 KB', owner: 'app' },
        { schema, name: 'products', type: 'global table', rows: 3, size: '48 KB', owner: 'app' },
      ],
      views: [
        { schema, name: 'active_accounts', status: 'valid', definition: 'Visible in view definition.' },
      ],
      sequences: [
        { schema, name: 'accounts_id_seq', dataType: 'INT8', increment: 1, cache: 1, cycles: false },
      ],
      types: [
        { schema, name: 'account_status_t', type: 'enum', owner: 'app' },
      ],
      functions: [
        { schema, name: 'account_status', arguments: 'account_id INT8', returns: 'STRING', language: 'SQL', volatility: 'stable' },
      ],
      zoneConfigurations: [
        { target: `${schema}.accounts`, numReplicas: 3, constraints: '+region=us-east', leasePreferences: '+region=us-east', gcTtlSeconds: 90000 },
      ],
    }
  }

  return {
    ...base,
    objects: objectName
      ? [{ schema, name: objectName, type: nodeId.split(':')[0] || 'object', status: 'visible' }]
      : [],
  }
}

export function postgresInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parsePostgresNodeId(connection, nodeId)
  const base = {
    engine: connection.engine,
    database: connection.database || 'datapadplusplus',
    schema,
    objectName,
  }

  if (connection.engine === 'timescaledb') {
    const payload = timescaleInspectPayload(base, nodeId, schema, objectName, postgresColumns())
    if (payload) {
      return payload
    }
  }

  if (nodeId.startsWith('table:')) {
    return {
      ...base,
      rowCount: 128,
      size: '96 KB',
      columns: postgresColumns(),
      indexes: [
        { name: `${objectName}_pkey`, type: 'btree', columns: 'id', unique: true, valid: true, size: '16 KB' },
        { name: `${objectName}_updated_at_idx`, type: 'btree', columns: 'updated_at', unique: false, valid: true, size: '16 KB' },
      ],
      constraints: [
        { name: `${objectName}_pkey`, type: 'PRIMARY KEY', columns: 'id', status: 'validated' },
      ],
      triggers: [
        { name: `${objectName}_updated_at_trg`, timing: 'BEFORE', event: 'UPDATE', enabled: true, function: 'set_updated_at()' },
      ],
      statistics: [
        { name: objectName, rows: 128, scans: 6, lastVacuum: '2026-05-10', lastAnalyze: '2026-05-16', size: '96 KB' },
      ],
      permissions: [
        { principal: 'reporting', privilege: 'SELECT', object: `${schema}.${objectName}`, state: 'granted', grantor: schema },
      ],
    }
  }

  const sourcePayload = postgresSourceInspectPayload(base, nodeId, schema, objectName)
  if (sourcePayload) {
    return sourcePayload
  }

  if (nodeId.startsWith('schema:') || nodeId.startsWith('postgres:') && !nodeId.includes(':diagnostics') && !nodeId.includes(':security')) {
    return {
      ...base,
      tableCount: 3,
      indexCount: 8,
      tables: [
        { schema, name: 'accounts', type: 'base table', rows: 128, size: '96 KB', owner: 'app' },
        { schema, name: 'orders', type: 'base table', rows: 348, size: '184 KB', owner: 'app' },
        { schema, name: 'products', type: 'base table', rows: 3, size: '48 KB', owner: 'app' },
      ],
      views: [
        { schema, name: 'active_accounts', status: 'valid', definition: 'Visible in view definition.' },
      ],
      functions: [
        { schema, name: 'account_status', arguments: 'account_id bigint', returns: 'text', language: 'plpgsql', volatility: 'stable' },
      ],
      extensions: [
        { name: 'pg_stat_statements', version: '1.10', schema: 'public', description: 'Track planning and execution statistics.' },
      ],
    }
  }

  if (nodeId.includes('security') || nodeId.includes('roles')) {
    return {
      ...base,
      roles: [
        { name: 'app', login: true, superuser: false, inherit: true, memberships: 'reporting' },
        { name: 'reporting', login: false, superuser: false, inherit: true, memberships: '' },
      ],
      permissions: [
        { principal: 'reporting', privilege: 'SELECT', object: `${schema}.accounts`, state: 'granted', grantor: 'app' },
      ],
    }
  }

  if (
    nodeId.includes('diagnostics') ||
    nodeId.includes('sessions') ||
    nodeId.includes('locks') ||
    nodeId.includes('waits') ||
    nodeId.includes('statements') ||
    nodeId.includes('index-health')
  ) {
    return {
      ...base,
      activeSessions: 4,
      blockedSessions: 0,
      sessions: [
        { pid: 101, user: 'app', database: base.database, state: 'active', wait: 'CPU', blockedBy: '' },
        { pid: 102, user: 'reporting', database: base.database, state: 'idle', wait: 'Client', blockedBy: '' },
      ],
      locks: [
        { pid: 101, object: `${schema}.accounts`, mode: 'AccessShareLock', granted: true, blocking: 'No' },
      ],
      waits: [
        { waitType: 'CPU', waitingTasks: 1, waitMs: 42, signalWaitMs: 0, resource: 'active query work' },
        { waitType: 'ClientRead', waitingTasks: 1, waitMs: 8, signalWaitMs: 0, resource: 'client socket' },
      ],
      statements: [
        { query: 'select * from public.accounts where status = $1', count: 128, meanMs: 3.4, p99Ms: 12.8, rows: 1280, retries: 0 },
        { query: 'select * from public.orders where updated_at > $1', count: 42, meanMs: 8.9, p99Ms: 31.4, rows: 4200, retries: 0 },
      ],
      statistics: [
        { name: `${schema}.accounts`, rows: 128, scans: 9, lastAnalyze: '2026-05-16', size: '96 KB' },
        { name: `${schema}.orders`, rows: 348, scans: 14, lastVacuum: '2026-05-10', lastAnalyze: '2026-05-16', size: '184 KB' },
      ],
      indexHealth: [
        { table: `${schema}.accounts`, index: 'accounts_pkey', scans: 96, tuplesRead: 96, tuplesFetched: 96, bloatRisk: 'low', lastVacuum: '2026-05-10' },
        { table: `${schema}.orders`, index: 'orders_updated_at_idx', scans: 0, tuplesRead: 0, tuplesFetched: 0, bloatRisk: 'review', lastVacuum: '2026-05-10' },
      ],
      warnings: ['Diagnostics are limited to catalog views available to the current role.'],
    }
  }

  return {
    ...base,
    objects: [
      { schema, name: objectName || 'accounts', type: 'table', status: 'visible' },
    ],
  }
}
