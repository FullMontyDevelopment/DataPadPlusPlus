type PostgresPayloadBase = {
  engine: string
  database: string
  schema: string
  objectName: string
}

export function postgresSchemaBrowserPayload(base: PostgresPayloadBase, schema: string) {
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
      { name: 'pg_stat_statements', version: '1.10', defaultVersion: '1.10', schema: 'public', status: 'installed', updateAvailable: false, description: 'Track planning and execution statistics.' },
      { name: 'uuid-ossp', version: '1.1', defaultVersion: '1.2', schema: 'public', status: 'update available', updateAvailable: true, description: 'Generate universally unique identifiers.' },
    ],
    extensionObjects: [
      { extension: 'pg_stat_statements', catalog: 'pg_proc', object: 'function pg_stat_statements(boolean)', dependency: 'extension member' },
      { extension: 'uuid-ossp', catalog: 'pg_proc', object: 'function uuid_generate_v4()', dependency: 'extension member' },
    ],
  }
}

export function postgresExtensionBrowserPayload(
  base: PostgresPayloadBase,
  schema: string,
  objectName: string,
) {
  const extension = objectName || 'pg_stat_statements'

  return {
    ...base,
    objectView: 'extension',
    extensions: [
      {
        name: extension,
        version: extension === 'uuid-ossp' ? '1.1' : '1.10',
        defaultVersion: extension === 'uuid-ossp' ? '1.2' : '1.10',
        schema,
        status: extension === 'uuid-ossp' ? 'update available' : 'installed',
        updateAvailable: extension === 'uuid-ossp',
        description: extension === 'uuid-ossp'
          ? 'Generate universally unique identifiers.'
          : 'Track planning and execution statistics.',
      },
    ],
    extensionObjects: [
      {
        extension,
        catalog: 'pg_proc',
        object: extension === 'uuid-ossp' ? 'function uuid_generate_v4()' : 'function pg_stat_statements(boolean)',
        dependency: 'extension member',
      },
    ],
  }
}

export function postgresSecurityBrowserPayload(base: PostgresPayloadBase, schema: string) {
  return {
    ...base,
    roles: [
      { name: 'app', login: true, superuser: false, inherit: true, createRole: false, createDb: false, replication: false, bypassRls: false, memberships: 'reporting', memberCount: 0 },
      { name: 'reporting', login: false, superuser: false, inherit: true, createRole: false, createDb: false, replication: false, bypassRls: false, memberships: '', memberCount: 1 },
    ],
    permissions: [
      { principal: 'reporting', privilege: 'SELECT', object: `${schema}.accounts`, objectKind: 'relation', state: 'granted', grantor: 'app', grantable: false },
      { principal: 'app', privilege: 'USAGE', object: schema, objectKind: 'schema', state: 'grantable', grantor: 'postgres', grantable: true },
    ],
    roleMemberships: [
      { role: 'app', memberOf: 'reporting', grantor: 'postgres', adminOption: false },
    ],
    defaultPrivileges: [
      { schema, owner: 'app', objectKind: 'tables', principal: 'reporting', privilege: 'SELECT', state: 'granted', grantor: 'app', grantable: false },
    ],
  }
}

export function postgresDiagnosticsBrowserPayload(base: PostgresPayloadBase, schema: string) {
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
