import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { branch, leaf, type ConnectionTreeNode } from './SideBar.connection-tree-types'

const SQL_SERVER_SERVER_LEVEL_GROUPS = [
  'Security',
  'Server Objects',
  'Management',
]

export function sqlConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'sqlserver') {
    return sqlServerConnectionTree(connection)
  }

  if (connection.engine === 'sqlite') {
    return sqliteConnectionTree()
  }

  if ((connection.engine === 'mysql' || connection.engine === 'mariadb') && !connection.database?.trim()) {
    return mysqlConnectionTreeWithoutSelectedDatabase(connection)
  }

  const schema = defaultSqlSchema(connection)
  const supportsStoredRoutines = !['sqlite', 'duckdb'].includes(connection.engine)
  const userSchema = branch(`schema-${schema}`, schema, 'schema', connection.database ?? 'default schema', [
    branch('tables', 'Tables', 'tables', 'Base tables and table-like relations', []),
    branch('views', 'Views', 'views', 'Saved select projections', []),
    sqlProgrammabilityBranch(supportsStoredRoutines),
    branch('indexes', 'Indexes', 'indexes', 'Secondary access paths', []),
    branch('security', 'Security', 'security', 'Schema roles and grants', []),
  ])
  const systemSchemaName = systemSqlSchemaForConnection(connection)

  return [
    branch('user-schemas', 'User Schemas', 'user-schemas', `${connection.engine} user metadata scopes`, [
      userSchema,
    ]),
    branch('system-schemas', 'System Schemas', 'system-schemas', `${connection.engine} system metadata scopes`, [
      branch(`schema-${systemSchemaName}`, systemSchemaName, 'schema', 'system schema', [
        branch('system-tables', 'System Tables', 'system-tables', 'Engine-maintained tables', []),
        branch('system-views', 'Views', 'views', 'Engine-maintained views', []),
        branch('system-functions', 'Functions', 'functions', 'Engine-maintained functions', []),
      ]),
    ]),
  ]
}

export function sqliteConnectionTree(): ConnectionTreeNode[] {
  const databaseChildren = [
    branch('tables', 'Tables', 'tables', 'Base row-store tables', []),
    branch('views', 'Views', 'views', 'Stored SELECT definitions', []),
    branch('indexes', 'Indexes', 'indexes', 'Standalone and table indexes', []),
    branch('triggers', 'Triggers', 'triggers', 'Database and table triggers', []),
    branch('maintenance', 'Maintenance', 'maintenance', 'Integrity checks, analyze, optimize, vacuum, and backup workflows', []),
  ]

  return [
    branch('main-database', 'Main Database', 'database', 'SQLite main database file', databaseChildren),
    branch('diagnostics', 'Diagnostics', 'diagnostics', 'PRAGMA, explain, integrity, and storage metadata', []),
  ]
}

export function duckDbConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = connection.database || 'local DuckDB file'

  return [
    branch('main-database', 'Main Database', 'database', database, [
      branch('schemas', 'Schemas', 'schemas', 'Attached schemas and namespaces', [
        branch('main-schema', 'main', 'schema', 'Main DuckDB schema', [
          branch('tables', 'Tables', 'tables', 'Analytical row/column tables', []),
          branch('views', 'Views', 'views', 'Saved analytical projections', []),
          branch('indexes', 'Indexes', 'indexes', 'DuckDB secondary indexes', []),
          branch('functions', 'Functions & Macros', 'functions', 'Scalar/table functions and macros', []),
        ]),
        branch('temp-schema', 'temp', 'schema', 'Temporary DuckDB schema', []),
      ]),
      branch('attached-databases', 'Attached Databases', 'attached-databases', 'Other DuckDB files attached to this session', []),
      branch('extensions', 'Extensions', 'extensions', 'Installed and loadable extensions', []),
      branch('files', 'Files', 'files', 'Parquet, CSV, and JSON file sources', []),
      branch('pragmas', 'Pragmas', 'pragmas', 'DuckDB settings and checks', []),
      branch('statistics', 'Statistics', 'statistics', 'Storage and column statistics', []),
    ]),
    branch('diagnostics', 'Diagnostics', 'diagnostics', 'Memory, threads, storage, and extension health', []),
  ]
}

export function defaultSqlSchema(connection: ConnectionProfile) {
  if (connection.engine === 'sqlite' || connection.engine === 'duckdb') {
    return 'main'
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return connection.database?.trim() || ''
  }

  if (connection.engine === 'sqlserver') {
    return 'dbo'
  }

  return 'public'
}

export function isSqlTableLikeKind(kind: string) {
  return [
    'table',
    'base-table',
    'strict-table',
    'virtual-table',
    'fts-table',
    'rtree-table',
  ].includes(kind)
}

function sqlServerConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = connection.database?.trim()
  const selectedDatabaseBranches = database
    ? [
        branch(`database-${database}`, database, 'database', 'user database', [
          branch('tables', 'Tables', 'tables', 'Base tables and table-like relations', []),
          branch('views', 'Views', 'views', 'Saved select projections', []),
          branch('synonyms', 'Synonyms', 'synonyms', 'Object aliases', []),
          sqlServerProgrammabilityBranch(),
          branch('storage', 'Storage', 'storage', 'Files, filegroups, and partitions', []),
          branch('performance', 'Performance', 'performance', 'Sessions, locks, waits, and tuning hints', []),
          branch('security', 'Security', 'security', 'Database users, roles, and schemas', [
            branch('users', 'Users', 'users', 'Database users', []),
            branch('roles', 'Roles', 'roles', 'Database roles', []),
            branch('schemas', 'Schemas', 'schemas', 'Database object namespaces', [
              leaf('schema-dbo', 'dbo', 'schema', 'default user schema', {
                path: [connection.name, 'Databases', database, 'Security', 'Schemas'],
                scope: 'schema:dbo',
              }),
            ]),
          ]),
        ]),
      ]
    : []

  return [
    branch('databases', 'Databases', 'databases', 'SQL Server database catalogs', [
      branch('system-databases', 'System Databases', 'system-databases', 'Engine-maintained databases', []),
      branch('database-snapshots', 'Database Snapshots', 'database-snapshots', 'Point-in-time database snapshots', []),
      ...selectedDatabaseBranches,
    ]),
    ...SQL_SERVER_SERVER_LEVEL_GROUPS.map((label) => sqlServerServerLevelBranch(label)),
  ]
}

function mysqlConnectionTreeWithoutSelectedDatabase(connection: ConnectionProfile): ConnectionTreeNode[] {
  return [
    branch('databases', 'Databases', 'databases', `${connection.engine} schemas`, []),
    branch('system-schemas', 'System Schemas', 'system-schemas', 'information_schema, performance_schema, mysql, and sys', []),
    branch('security', 'Users / Privileges', 'security', 'Users, roles, grants, authentication plugins, and privilege scope', []),
    branch('diagnostics', 'Diagnostics', 'diagnostics', 'Status, performance schema, and slow query metadata', []),
  ]
}

function sqlServerServerLevelBranch(label: string) {
  const kind = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  if (label === 'Server Objects') {
    return branch('server-objects', 'Server Objects', 'server-objects', 'Linked servers, endpoints, and server-level objects', [
      branch('linked-servers', 'Linked Servers', 'linked-servers', 'Remote server definitions and providers', []),
      branch('endpoints', 'Endpoints', 'endpoints', 'Database mirroring, service broker, and TDS endpoints', []),
    ])
  }

  if (label === 'Always On High Availability') {
    return branch('always-on-high-availability', label, 'always-on-high-availability', 'Availability groups and replicas', [
      branch('availability-groups', 'Availability Groups', 'availability-groups', 'Always On availability groups and replicas', []),
    ])
  }

  return branch(kind, label, kind, `SQL Server ${label.toLowerCase()}`, [])
}

function sqlServerProgrammabilityBranch() {
  return branch('programmability', 'Programmability', 'programmability', 'Procedures, functions, and programmable objects', [
    branch('stored-procedures', 'Stored Procedures', 'stored-procedures', 'Callable routines', []),
    branch('functions', 'Functions', 'functions', 'Scalar and table-valued functions', []),
    branch('database-triggers', 'Database Triggers', 'database-triggers', 'Database-scoped triggers', []),
    branch('assemblies', 'Assemblies', 'assemblies', 'CLR assemblies', []),
    branch('types', 'Types', 'types', 'User-defined types', []),
    branch('rules', 'Rules', 'rules', 'Legacy rules', []),
    branch('defaults', 'Defaults', 'defaults', 'Legacy defaults', []),
    branch('sequences', 'Sequences', 'sequences', 'Generated numeric sequences', []),
  ])
}

function sqlProgrammabilityBranch(supportsStoredRoutines: boolean) {
  const routineChildren = supportsStoredRoutines
    ? [
        branch('stored-procedures', 'Stored Procedures', 'stored-procedures', 'Callable routines', []),
        branch('functions', 'Functions', 'functions', 'Scalar and table-valued functions', []),
      ]
    : []

  return branch('programmability', 'Programmability', 'programmability', 'Procedures, functions, and triggers', [
    ...routineChildren,
    branch('triggers', 'Triggers', 'triggers', 'Table triggers', []),
    branch('sequences', 'Sequences', 'sequences', 'Generated numeric sequences', []),
    branch('types', 'Types', 'types', 'User-defined types', []),
    branch('synonyms', 'Synonyms', 'synonyms', 'Object aliases', []),
  ])
}

function systemSqlSchemaForConnection(connection: ConnectionProfile) {
  if (connection.engine === 'sqlserver') {
    return 'sys'
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return 'information_schema'
  }

  if (connection.engine === 'sqlite' || connection.engine === 'duckdb') {
    return 'temp'
  }

  return 'pg_catalog'
}
