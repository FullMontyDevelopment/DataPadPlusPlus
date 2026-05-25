import type { ConnectionProfile, ExplorerInspectRequest, ExplorerInspectResponse, ExplorerNode, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import {
  createDuckDbExplorerNodes,
  duckDbInspectPayload,
  duckDbInspectQueryTemplate,
} from './browser-duckdb-explorer'
import {
  createOracleExplorerNodes,
  oracleInspectPayload,
  oracleInspectQueryTemplate,
} from './browser-oracle-explorer'
import {
  createMemcachedExplorerNodes,
  memcachedInspectPayload,
  memcachedInspectQueryTemplate,
} from './browser-memcached-explorer'
import {
  createLiteDbExplorerNodes,
  liteDbInspectPayload,
  liteDbInspectQueryTemplate,
} from './browser-litedb-explorer'
import {
  cosmosInspectPayload,
  cosmosInspectQueryTemplate,
  createCosmosExplorerNodes,
} from './browser-cosmos-explorer'
import {
  postgresSourceInspectPayload,
  postgresSourceInspectQueryTemplate,
  sqlServerSourceInspectPayload,
  sqlServerSourceInspectQueryTemplate,
} from './browser-relational-source-payloads'
import { findConnection } from './browser-store'

export function createExplorerNodes(
  connection: ConnectionProfile,
  scope?: string,
): ExplorerNode[] {
  if (connection.engine === 'mongodb') {
    return createMongoExplorerNodes(connection, scope)
  }

  if (connection.engine === 'litedb') {
    return createLiteDbExplorerNodes(connection, scope)
  }

  if (connection.engine === 'cosmosdb') {
    return createCosmosExplorerNodes(connection, scope)
  }

  if (connection.engine === 'oracle') {
    return createOracleExplorerNodes(connection, scope)
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return createRedisExplorerNodes(connection, scope)
  }

  if (connection.engine === 'memcached') {
    return createMemcachedExplorerNodes(connection, scope)
  }

  if (connection.engine === 'cockroachdb') {
    return createCockroachExplorerNodes(connection, scope)
  }

  if (isPostgresLike(connection)) {
    return createPostgresExplorerNodes(connection, scope)
  }

  if (connection.engine === 'sqlserver') {
    return createSqlServerExplorerNodes(connection, scope)
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return createMysqlExplorerNodes(connection, scope)
  }

  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return createSearchExplorerNodes(connection, scope)
  }

  if (connection.engine === 'dynamodb') {
    return createDynamoExplorerNodes(connection, scope)
  }

  if (connection.engine === 'cassandra') {
    return createCassandraExplorerNodes(connection, scope)
  }

  if (connection.engine === 'prometheus') {
    return createPrometheusExplorerNodes(scope)
  }

  if (connection.engine === 'influxdb') {
    return createInfluxExplorerNodes(connection, scope)
  }

  if (connection.engine === 'opentsdb') {
    return createOpenTsdbExplorerNodes(scope)
  }

  if (connection.family === 'warehouse') {
    return createWarehouseExplorerNodes(connection, scope)
  }

  if (connection.family === 'graph') {
    return createGraphExplorerNodes(connection, scope)
  }

  if (connection.engine === 'sqlite') {
    return createSqliteExplorerNodes(connection, scope)
  }

  if (connection.engine === 'duckdb') {
    return createDuckDbExplorerNodes(connection, scope)
  }

  return []
}

function isPostgresLike(connection: ConnectionProfile) {
  return ['postgresql', 'cockroachdb', 'timescaledb'].includes(connection.engine)
}

function createCockroachExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const database = connection.database || 'defaultdb'

  if (!scope) {
    return [
      postgresNode(connection, `database:${database}`, database, 'database', 'CockroachDB database', `database:${database}`, ['Databases'], true),
      postgresNode(connection, 'cockroach:cluster', 'Cluster', 'cluster', 'Nodes, ranges, regions, jobs, and cluster settings', 'cockroach:cluster', [], true),
      postgresNode(connection, 'cockroach:security', 'Security', 'security', 'Roles, grants, and certificates', 'cockroach:security', [], true),
      postgresNode(connection, 'cockroach:diagnostics', 'Diagnostics', 'diagnostics', 'Sessions, statement stats, transactions, and contention', 'cockroach:diagnostics', [], true),
    ]
  }

  if (scope.startsWith('database:')) {
    return [
      postgresNode(connection, 'schema:public', 'public', 'schema', 'User schema', 'schema:public', ['Databases', database, 'User Schemas'], true),
      postgresNode(connection, 'schema:crdb_internal', 'crdb_internal', 'schema', 'System schema', 'schema:crdb_internal', ['Databases', database, 'System Schemas'], true),
      postgresNode(connection, 'schema:pg_catalog', 'pg_catalog', 'schema', 'System schema', 'schema:pg_catalog', ['Databases', database, 'System Schemas'], true),
    ]
  }

  if (scope.startsWith('schema:')) {
    const schema = scope.replace('schema:', '') || 'public'
    return cockroachSchemaFolders(connection, database, schema)
  }

  if (scope.startsWith('cockroach:')) {
    const [, section = 'cluster', schema = 'public', subsection = ''] = scope.split(':')

    if (section === 'cluster') {
      return [
        postgresNode(connection, 'cockroach:cluster:nodes', 'Nodes', 'nodes', 'Node liveness, locality, and capacity', undefined, ['Cluster']),
        postgresNode(connection, 'cockroach:cluster:ranges', 'Ranges', 'ranges', 'Range distribution and leaseholders', undefined, ['Cluster']),
        postgresNode(connection, 'cockroach:cluster:regions', 'Regions / Localities', 'regions', 'Regional placement and locality tiers', undefined, ['Cluster']),
        postgresNode(connection, 'cockroach:cluster:jobs', 'Jobs', 'jobs', 'Schema changes, backups, imports, and changefeeds', undefined, ['Cluster']),
        postgresNode(connection, 'cockroach:cluster:cluster-settings', 'Cluster Settings', 'cluster-settings', 'Runtime cluster settings', undefined, ['Cluster']),
      ]
    }

    if (section === 'security') {
      return [
        postgresNode(connection, 'cockroach:security:roles', 'Roles', 'roles', 'Users, roles, and memberships', undefined, ['Security']),
        postgresNode(connection, 'cockroach:security:grants', 'Grants', 'grants', 'Visible privileges and default privileges', undefined, ['Security']),
        postgresNode(connection, 'cockroach:security:certificates', 'Certificates', 'certificates', 'Client and node certificate metadata', undefined, ['Security']),
      ]
    }

    if (section === 'diagnostics') {
      return [
        postgresNode(connection, 'cockroach:diagnostics:sessions', 'Sessions', 'sessions', 'Active SQL sessions', undefined, ['Diagnostics']),
        postgresNode(connection, 'cockroach:diagnostics:statements', 'Statement Stats', 'statements', 'Statement fingerprints, latency, and retries', undefined, ['Diagnostics']),
        postgresNode(connection, 'cockroach:diagnostics:transactions', 'Transactions', 'transactions', 'Transaction state and retry pressure', undefined, ['Diagnostics']),
        postgresNode(connection, 'cockroach:diagnostics:contention', 'Contention', 'contention', 'Waiting keys and blocking transactions', undefined, ['Diagnostics']),
        postgresNode(connection, 'cockroach:diagnostics:locks', 'Locks', 'locks', 'Visible lock waits', undefined, ['Diagnostics']),
        postgresNode(connection, 'cockroach:diagnostics:statistics', 'Statistics', 'statistics', 'Table and database statistics', undefined, ['Diagnostics']),
      ]
    }

    return cockroachObjectsForSection(connection, database, schema, subsection || section)
  }

  if (scope.startsWith('table:')) {
    const { schema, objectName } = parsePostgresObjectScope(scope)
    return postgresTableSections(connection, schema, objectName)
  }

  return []
}

function cockroachSchemaFolders(
  connection: ConnectionProfile,
  database: string,
  schema: string,
): ExplorerNode[] {
  const path = [connection.name, 'Databases', database, isPostgresSystemSchema(schema) ? 'System Schemas' : 'User Schemas', schema]
  const folder = (id: string, label: string, kind: string, detail: string) =>
    postgresNode(connection, `cockroach:${database}:${schema}:${id}`, label, kind, detail, `cockroach:${database}:${schema}:${id}`, path, true)

  return [
    folder('tables', 'Tables', 'tables', 'Base and regional tables'),
    folder('views', 'Views', 'views', 'Stored SELECT definitions'),
    folder('indexes', 'Indexes', 'indexes', 'Schema-level index list'),
    folder('sequences', 'Sequences', 'sequences', 'Sequence generators'),
    folder('types', 'Types', 'types', 'Enum and user-defined types'),
    folder('functions', 'Functions', 'functions', 'User-defined SQL functions'),
    folder('zone-configurations', 'Zone Configurations', 'zone-configurations', 'Replication and placement rules'),
  ]
}

function cockroachObjectsForSection(
  connection: ConnectionProfile,
  database: string,
  schema: string,
  section: string,
): ExplorerNode[] {
  const path = [
    connection.name,
    'Databases',
    database,
    isPostgresSystemSchema(schema) ? 'System Schemas' : 'User Schemas',
    schema,
    cockroachSectionLabel(section),
  ]

  if (section === 'tables') {
    return ['accounts', 'orders', 'products'].map((table) =>
      postgresNode(connection, `table:${schema}.${table}`, table, 'table', 'Regional table', `table:${schema}.${table}`, path, true, `select * from "${schema}"."${table}" limit 100;`),
    )
  }

  if (section === 'views') {
    return [
      postgresNode(connection, `view:${schema}:active_accounts`, 'active_accounts', 'view', 'View definition', undefined, path, false, `select * from "${schema}"."active_accounts" limit 100;`),
    ]
  }

  if (section === 'indexes') {
    return [
      postgresNode(connection, `index:${schema}:accounts_pkey`, 'accounts_pkey', 'index', 'primary / unique', undefined, path),
      postgresNode(connection, `index:${schema}:products_sku_idx`, 'products_sku_idx', 'index', 'secondary index', undefined, path),
    ]
  }

  if (section === 'sequences') {
    return [
      postgresNode(connection, `sequence:${schema}:accounts_id_seq`, 'accounts_id_seq', 'sequence', 'int8 sequence', undefined, path),
    ]
  }

  if (section === 'types') {
    return [
      postgresNode(connection, `type:${schema}:account_status_t`, 'account_status_t', 'type', 'enum type', undefined, path),
    ]
  }

  if (section === 'functions') {
    return [
      postgresNode(connection, `function:${schema}:account_status`, 'account_status', 'function', 'SQL function', undefined, path),
    ]
  }

  if (section === 'zone-configurations') {
    return [
      postgresNode(connection, `zone-config:${schema}:accounts`, 'accounts', 'zone-configuration', 'Replication and lease preferences', undefined, path),
    ]
  }

  return []
}

function createPostgresExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      postgresNode(connection, 'schema:public', 'public', 'schema', 'User schema', 'schema:public', ['User Schemas'], true),
      postgresNode(connection, 'schema:observability', 'observability', 'schema', 'User schema', 'schema:observability', ['User Schemas'], true),
      postgresNode(connection, 'schema:pg_catalog', 'pg_catalog', 'schema', 'System schema', 'schema:pg_catalog', ['System Schemas'], true),
      postgresNode(connection, 'postgres:security', 'Security', 'security', 'Roles, grants, and privileges', 'postgres:security', [], true),
      postgresNode(connection, 'postgres:diagnostics', 'Diagnostics', 'diagnostics', 'Sessions, locks, stats, and health metadata', 'postgres:diagnostics', [], true),
    ]
  }

  if (scope.startsWith('schema:')) {
    const schema = scope.replace('schema:', '') || 'public'
    return postgresSchemaFolders(connection, schema)
  }

  if (scope.startsWith('postgres:')) {
    const [, schemaOrSection = 'public', section = ''] = scope.split(':')
    if (schemaOrSection === 'security') {
      return [
        postgresNode(connection, 'postgres:security:roles', 'Roles', 'roles', 'Login and group roles', undefined, ['Security']),
        postgresNode(connection, 'postgres:security:permissions', 'Permissions', 'permissions', 'Visible grants and privileges', undefined, ['Security']),
      ]
    }
    if (schemaOrSection === 'diagnostics') {
      return [
        postgresNode(connection, 'postgres:diagnostics:sessions', 'Sessions', 'sessions', 'pg_stat_activity sessions', undefined, ['Diagnostics']),
        postgresNode(connection, 'postgres:diagnostics:locks', 'Locks', 'locks', 'pg_locks and blocking hints', undefined, ['Diagnostics']),
        postgresNode(connection, 'postgres:diagnostics:statistics', 'Statistics', 'statistics', 'pg_stat relation and database stats', undefined, ['Diagnostics']),
      ]
    }

    return postgresObjectsForSection(connection, schemaOrSection, section)
  }

  if (scope.startsWith('table:')) {
    const { schema, objectName } = parsePostgresObjectScope(scope)
    return postgresTableSections(connection, schema, objectName)
  }

  return []
}

function postgresSchemaFolders(connection: ConnectionProfile, schema: string): ExplorerNode[] {
  const path = [connection.name, isPostgresSystemSchema(schema) ? 'System Schemas' : 'User Schemas', schema]
  const folder = (id: string, label: string, kind: string, detail: string) =>
    postgresNode(connection, `postgres:${schema}:${id}`, label, kind, detail, `postgres:${schema}:${id}`, path, true)

  return [
    folder('tables', 'Tables', 'tables', 'Base and partitioned tables'),
    folder('views', 'Views', 'views', 'Stored SELECT definitions'),
    folder('materialized-views', 'Materialized Views', 'materialized-views', 'Persisted query projections'),
    folder('indexes', 'Indexes', 'indexes', 'Schema-level index list'),
    folder('functions', 'Functions', 'functions', 'Stored functions'),
    folder('procedures', 'Procedures', 'procedures', 'Stored procedures'),
    folder('sequences', 'Sequences', 'sequences', 'Sequence generators'),
    folder('types', 'Types', 'types', 'Enum, composite, domain, and range types'),
  ]
}

function postgresObjectsForSection(
  connection: ConnectionProfile,
  schema: string,
  section: string,
): ExplorerNode[] {
  const path = [
    connection.name,
    isPostgresSystemSchema(schema) ? 'System Schemas' : 'User Schemas',
    schema,
    postgresSectionLabel(section),
  ]

  if (section === 'tables') {
    return ['accounts', 'orders', 'products'].map((table) =>
      postgresNode(
        connection,
        `table:${schema}.${table}`,
        table,
        'table',
        'Base table',
        `table:${schema}.${table}`,
        path,
        true,
        `select * from "${schema}"."${table}" limit 100;`,
      ),
    )
  }

  if (section === 'views') {
    return [
      postgresNode(connection, `view:${schema}:active_accounts`, 'active_accounts', 'view', 'View definition', undefined, path, false, `select * from "${schema}"."active_accounts" limit 100;`),
    ]
  }

  if (section === 'materialized-views') {
    return [
      postgresNode(connection, `materialized-view:${schema}:daily_product_metrics`, 'daily_product_metrics', 'materialized-view', 'Materialized view', undefined, path, false, `select * from "${schema}"."daily_product_metrics" limit 100;`),
    ]
  }

  if (section === 'indexes') {
    return [
      postgresNode(connection, `index:${schema}:accounts_pkey`, 'accounts_pkey', 'index', 'btree / unique', undefined, path),
      postgresNode(connection, `index:${schema}:products_sku_idx`, 'products_sku_idx', 'index', 'btree', undefined, path),
    ]
  }

  if (section === 'functions') {
    return [
      postgresNode(connection, `function:${schema}:account_status`, 'account_status', 'function', 'stable function', undefined, path),
    ]
  }

  if (section === 'procedures') {
    return [
      postgresNode(connection, `procedure:${schema}:refresh_rollups`, 'refresh_rollups', 'procedure', 'plpgsql procedure', undefined, path),
    ]
  }

  if (section === 'sequences') {
    return [
      postgresNode(connection, `sequence:${schema}:accounts_id_seq`, 'accounts_id_seq', 'sequence', 'bigint sequence', undefined, path),
    ]
  }

  if (section === 'types') {
    return [
      postgresNode(connection, `type:${schema}:account_status_t`, 'account_status_t', 'type', 'enum type', undefined, path),
    ]
  }

  return []
}

function postgresTableSections(
  connection: ConnectionProfile,
  schema: string,
  table: string,
): ExplorerNode[] {
  const path = [connection.name, isPostgresSystemSchema(schema) ? 'System Schemas' : 'User Schemas', schema, 'Tables', table]
  return [
    postgresNode(connection, `columns:${schema}:${table}`, 'Columns', 'columns', 'Column definitions', undefined, path),
    postgresNode(connection, `indexes:${schema}:${table}`, 'Indexes', 'indexes', 'Table indexes', undefined, path),
    postgresNode(connection, `constraints:${schema}:${table}`, 'Constraints', 'constraints', 'Table constraints', undefined, path),
    postgresNode(connection, `triggers:${schema}:${table}`, 'Triggers', 'triggers', 'Table triggers', undefined, path),
    postgresNode(connection, `statistics:${schema}:${table}`, 'Statistics', 'statistics', 'Row estimates and vacuum/analyze health', undefined, path),
    postgresNode(connection, `permissions:${schema}:${table}`, 'Permissions', 'permissions', 'Object grants', undefined, path),
    postgresNode(connection, `ddl:${schema}:${table}`, 'Definition', 'ddl', 'Object definition', undefined, path),
  ]
}

function postgresNode(
  connection: ConnectionProfile,
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  path: string[] = [connection.name],
  expandable = false,
  queryTemplate?: string,
): ExplorerNode {
  return {
    id,
    family: 'sql',
    label,
    kind,
    detail,
    scope,
    path,
    queryTemplate,
    expandable,
  }
}

function createSqlServerExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const database = connection.database || 'datapadplusplus'

  if (!scope) {
    return ['master', 'model', 'msdb', 'tempdb', database]
      .filter((item, index, items) => items.indexOf(item) === index)
      .map((name) =>
        sqlServerNode(
          connection,
          `database:${name}`,
          name,
          isSqlServerSystemDatabase(name) ? 'system-database' : 'database',
          isSqlServerSystemDatabase(name) ? 'ONLINE / system' : 'ONLINE',
          `database:${name}`,
          [connection.name, 'Databases'],
          true,
          `use [${name.replace(/]/g, ']]')}];\nselect db_name() as database_name;`,
        ),
      )
  }

  if (scope.startsWith('database:')) {
    return sqlServerDatabaseFolders(connection, scope.replace('database:', '') || database)
  }

  if (scope.startsWith('sqlserver:')) {
    const [, scopedDatabase = database, section = 'tables'] = scope.split(':')
    return sqlServerObjectsForSection(connection, scopedDatabase, section)
  }

  if (scope.startsWith('table:')) {
    const { database: scopedDatabase, schema, objectName } = parseSqlServerObjectScope(scope)
    return sqlServerTableSections(connection, scopedDatabase, schema, objectName)
  }

  return []
}

function sqlServerDatabaseFolders(connection: ConnectionProfile, database: string): ExplorerNode[] {
  const path = [connection.name, 'Databases', database]
  const folder = (id: string, label: string, kind: string, detail: string) =>
    sqlServerNode(connection, `sqlserver:${database}:${id}`, label, kind, detail, `sqlserver:${database}:${id}`, path, true)

  return [
    folder('tables', 'Tables', 'tables', 'Base, system, external, and graph tables'),
    folder('views', 'Views', 'views', 'Stored query projections'),
    folder('stored-procedures', 'Stored Procedures', 'stored-procedures', 'T-SQL and CLR procedures'),
    folder('functions', 'Functions', 'functions', 'Scalar, table-valued, aggregate, and CLR functions'),
    folder('synonyms', 'Synonyms', 'synonyms', 'Object aliases'),
    folder('sequences', 'Sequences', 'sequences', 'Sequence generators'),
    folder('types', 'Types', 'types', 'User-defined and table types'),
    folder('security', 'Security', 'security', 'Users, roles, schemas, certificates, and credentials'),
    folder('query-store', 'Query Store', 'query-store', 'Runtime stats, plans, and regressed queries'),
    folder('storage', 'Storage', 'storage', 'Files, filegroups, and partitions'),
    folder('extended-events', 'Extended Events', 'extended-events', 'Database-scoped event sessions'),
    folder('agent', 'Agent', 'sql-server-agent', 'Jobs, schedules, alerts, and operators'),
  ]
}

function sqlServerObjectsForSection(
  connection: ConnectionProfile,
  database: string,
  section: string,
): ExplorerNode[] {
  const path = [connection.name, 'Databases', database, sqlServerSectionLabel(section)]

  if (section === 'tables') {
    return ['accounts', 'orders', 'products'].map((table) =>
      sqlServerNode(connection, `table:${database}:dbo:${table}`, `dbo.${table}`, 'table', 'base table', `table:${database}:dbo:${table}`, path, true, `use [${database}];\nselect top 100 * from [dbo].[${table}];`),
    )
  }

  if (section === 'views') {
    return [
      sqlServerNode(connection, `view:${database}:dbo:active_accounts`, 'dbo.active_accounts', 'view', 'view', undefined, path, false, `use [${database}];\nselect top 100 * from [dbo].[active_accounts];`),
    ]
  }

  if (section === 'stored-procedures') {
    return [
      sqlServerNode(connection, `procedure:${database}:dbo:refresh_account_cache`, 'dbo.refresh_account_cache', 'procedure', 'SQL stored procedure', undefined, path),
    ]
  }

  if (section === 'functions') {
    return [
      sqlServerNode(connection, `function:${database}:dbo:account_status`, 'dbo.account_status', 'function', 'Scalar-valued function', undefined, path),
    ]
  }

  if (section === 'security') {
    return [
      sqlServerNode(connection, `users:${database}`, 'Users', 'users', 'Database users', undefined, path),
      sqlServerNode(connection, `roles:${database}`, 'Roles', 'roles', 'Database roles', undefined, path),
      sqlServerNode(connection, `schemas:${database}`, 'Schemas', 'schemas', 'Database schemas', undefined, path),
    ]
  }

  if (section === 'query-store') {
    return [
      sqlServerNode(connection, `query-store:${database}:top`, 'Top Queries', 'query-store-view', 'Runtime stats and plans', undefined, path),
      sqlServerNode(connection, `query-store:${database}:regressed`, 'Regressed Queries', 'query-store-view', 'Queries with worse recent performance', undefined, path),
      sqlServerNode(connection, `query-store:${database}:forced`, 'Forced Plans', 'query-store-view', 'Plan forcing state', undefined, path),
    ]
  }

  if (section === 'storage') {
    return [
      sqlServerNode(connection, `files:${database}`, 'Files', 'files', 'Database files', undefined, path),
      sqlServerNode(connection, `filegroups:${database}`, 'Filegroups', 'filegroups', 'Database filegroups', undefined, path),
    ]
  }

  return []
}

function sqlServerTableSections(
  connection: ConnectionProfile,
  database: string,
  schema: string,
  table: string,
): ExplorerNode[] {
  const path = [connection.name, 'Databases', database, 'Tables', `${schema}.${table}`]
  return [
    sqlServerNode(connection, `columns:${database}:${schema}:${table}`, 'Columns', 'columns', 'Column definitions', undefined, path),
    sqlServerNode(connection, `keys:${database}:${schema}:${table}`, 'Keys', 'keys', 'Primary, foreign, and unique keys', undefined, path),
    sqlServerNode(connection, `constraints:${database}:${schema}:${table}`, 'Constraints', 'constraints', 'Check and default constraints', undefined, path),
    sqlServerNode(connection, `indexes:${database}:${schema}:${table}`, 'Indexes', 'indexes', 'Indexes and included columns', undefined, path),
    sqlServerNode(connection, `triggers:${database}:${schema}:${table}`, 'Triggers', 'triggers', 'DML triggers', undefined, path),
    sqlServerNode(connection, `statistics:${database}:${schema}:${table}`, 'Statistics', 'statistics', 'Statistics objects and histograms', undefined, path),
    sqlServerNode(connection, `permissions:${database}:${schema}:${table}`, 'Permissions', 'permissions', 'Object permissions', undefined, path),
    sqlServerNode(connection, `scripts:${database}:${schema}:${table}`, 'Scripts', 'scripts', 'Create/alter/drop templates', undefined, path),
  ]
}

function sqlServerNode(
  connection: ConnectionProfile,
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  path: string[] = [connection.name],
  expandable = false,
  queryTemplate?: string,
): ExplorerNode {
  return {
    id,
    family: 'sql',
    label,
    kind,
    detail,
    scope,
    path,
    queryTemplate,
    expandable,
  }
}

function createMysqlExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const database = connection.database || 'datapadplusplus'
  const engineLabel = connection.engine === 'mariadb' ? 'MariaDB' : 'MySQL'

  if (!scope) {
    return [
      mysqlNode(connection, `database:${database}`, database, 'database', `${engineLabel} database`, `database:${database}`, ['Databases'], true),
      mysqlNode(connection, 'mysql:system-schemas', 'System Schemas', 'system-schemas', 'information_schema, mysql, performance_schema, and sys', 'mysql:system-schemas', [], true),
      mysqlNode(connection, 'mysql:security', 'Users / Privileges', 'security', 'Users, roles, and grants', 'mysql:security', [], true),
      mysqlNode(connection, 'mysql:diagnostics', 'Diagnostics', 'diagnostics', 'Sessions, replication, and status counters', 'mysql:diagnostics', [], true),
    ]
  }

  if (scope.startsWith('database:')) {
    const scopedDatabase = scope.replace('database:', '') || database
    return [
      mysqlFolder(connection, scopedDatabase, 'tables', 'Tables', 'Base tables and storage engines'),
      mysqlFolder(connection, scopedDatabase, 'views', 'Views', 'Stored SELECT definitions'),
      mysqlFolder(connection, scopedDatabase, 'procedures', 'Stored Procedures', 'Stored procedure routines'),
      mysqlFolder(connection, scopedDatabase, 'functions', 'Functions', 'Stored functions'),
      mysqlFolder(connection, scopedDatabase, 'events', 'Events', 'Scheduled event jobs'),
      mysqlFolder(connection, scopedDatabase, 'triggers', 'Triggers', 'Database and table triggers'),
      mysqlFolder(connection, scopedDatabase, 'indexes', 'Indexes', 'Schema-level index list'),
      mysqlFolder(connection, scopedDatabase, 'storage', 'Storage', 'Engines, table sizes, and fragmentation'),
    ]
  }

  if (scope === 'mysql:system-schemas') {
    return ['information_schema', 'mysql', 'performance_schema', 'sys'].map((schema) =>
      mysqlNode(connection, `database:${schema}`, schema, 'system-schemas', 'System schema', `database:${schema}`, ['System Schemas'], true),
    )
  }

  if (scope === 'mysql:security') {
    return [
      mysqlNode(connection, 'mysql:security:users', 'Users', 'users', 'User accounts and authentication plugins', undefined, ['Users / Privileges']),
      mysqlNode(connection, 'mysql:security:roles', 'Roles', 'roles', 'Role assignments where supported', undefined, ['Users / Privileges']),
      mysqlNode(connection, 'mysql:security:permissions', 'Grants', 'permissions', 'Visible grants and privilege scopes', undefined, ['Users / Privileges']),
    ]
  }

  if (scope === 'mysql:diagnostics') {
    return [
      mysqlNode(connection, 'mysql:diagnostics:sessions', 'Sessions', 'sessions', 'Processlist and active statements', undefined, ['Diagnostics']),
      mysqlNode(connection, 'mysql:diagnostics:statistics', 'Status Counters', 'statistics', 'Server and table counters', undefined, ['Diagnostics']),
      mysqlNode(connection, 'mysql:diagnostics:replication', 'Replication', 'replication', 'Source/replica channel health', undefined, ['Diagnostics']),
    ]
  }

  if (scope.startsWith('mysql:')) {
    const [, scopedDatabase = database, section = 'tables'] = scope.split(':')
    return mysqlObjectsForSection(connection, scopedDatabase, section)
  }

  if (scope.startsWith('table:')) {
    const { database: scopedDatabase, objectName } = parseMysqlObjectScope(scope, database)
    return [
      mysqlSection(connection, scopedDatabase, objectName, 'columns', 'Columns', 'Column types and collation'),
      mysqlSection(connection, scopedDatabase, objectName, 'constraints', 'Constraints', 'Primary, unique, check, and foreign keys'),
      mysqlSection(connection, scopedDatabase, objectName, 'indexes', 'Indexes', 'Table indexes'),
      mysqlSection(connection, scopedDatabase, objectName, 'triggers', 'Triggers', 'Table triggers'),
      mysqlSection(connection, scopedDatabase, objectName, 'foreign-keys', 'Foreign Keys', 'Relationship rules'),
      mysqlSection(connection, scopedDatabase, objectName, 'partitions', 'Partitions', 'Partition metadata'),
      mysqlSection(connection, scopedDatabase, objectName, 'statistics', 'Statistics', 'Row count and storage hints'),
      mysqlSection(connection, scopedDatabase, objectName, 'data', 'Data', 'Browse rows', false, `select * from ${mysqlQualifiedName(scopedDatabase, objectName)} limit 100;`),
      mysqlSection(connection, scopedDatabase, objectName, 'ddl', 'DDL', 'CREATE statement'),
    ]
  }

  return []
}

function mysqlObjectsForSection(
  connection: ConnectionProfile,
  database: string,
  section: string,
) {
  if (section === 'tables') {
    return ['accounts', 'orders', 'products'].map((table) =>
      mysqlObject(connection, database, table, 'table', 'Base table'),
    )
  }

  if (section === 'views') {
    return [
      mysqlObject(connection, database, 'active_accounts', 'view', 'View definition'),
    ]
  }

  if (section === 'procedures') {
    return [
      mysqlObject(connection, database, 'refresh_account_rollup', 'procedure', 'Stored procedure'),
    ]
  }

  if (section === 'functions') {
    return [
      mysqlObject(connection, database, 'account_status_label', 'function', 'Stored function'),
    ]
  }

  if (section === 'events') {
    return [
      mysqlObject(connection, database, 'purge_old_sessions', 'event', 'Scheduled event'),
    ]
  }

  if (section === 'triggers') {
    return [
      mysqlObject(connection, database, 'accounts_updated_at', 'trigger', 'Before update trigger'),
    ]
  }

  if (section === 'indexes') {
    return [
      mysqlNode(connection, `index:${database}:accounts:PRIMARY`, 'accounts.PRIMARY', 'index', 'Primary key index', undefined, ['Databases', database, 'Indexes']),
      mysqlNode(connection, `index:${database}:orders:orders_account_id_idx`, 'orders.orders_account_id_idx', 'index', 'Foreign-key lookup index', undefined, ['Databases', database, 'Indexes']),
    ]
  }

  if (section === 'storage') {
    return [
      mysqlNode(connection, `mysql:${database}:storage:engines`, 'Storage Engines', 'storage', 'Available engines and capabilities', undefined, ['Databases', database, 'Storage']),
      mysqlNode(connection, `mysql:${database}:storage:tables`, 'Table Sizes', 'statistics', 'Data and index sizes', undefined, ['Databases', database, 'Storage']),
    ]
  }

  return []
}

function mysqlFolder(
  connection: ConnectionProfile,
  database: string,
  folder: string,
  label: string,
  detail: string,
) {
  return mysqlNode(connection, `mysql:${database}:${folder}`, label, folder, detail, `mysql:${database}:${folder}`, ['Databases', database], true)
}

function mysqlObject(
  connection: ConnectionProfile,
  database: string,
  label: string,
  kind: string,
  detail: string,
) {
  const queryTemplate = kind === 'table' || kind === 'view'
    ? `select * from ${mysqlQualifiedName(database, label)} limit 100;`
    : undefined
  return mysqlNode(
    connection,
    `${kind}:${database}:${label}`,
    label,
    kind,
    detail,
    `${kind}:${database}:${label}`,
    ['Databases', database, mysqlFolderLabel(kind)],
    kind === 'table',
    queryTemplate,
  )
}

function mysqlSection(
  connection: ConnectionProfile,
  database: string,
  table: string,
  section: string,
  label: string,
  detail: string,
  expandable = true,
  queryTemplate?: string,
) {
  return mysqlNode(
    connection,
    `table-section:${database}:${table}:${section}`,
    label,
    section,
    detail,
    `table-section:${database}:${table}:${section}`,
    ['Databases', database, 'Tables', table],
    expandable,
    queryTemplate,
  )
}

function mysqlNode(
  _connection: ConnectionProfile,
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  path: string[] = [],
  expandable?: boolean,
  queryTemplate?: string,
): ExplorerNode {
  return {
    id,
    family: 'sql',
    label,
    kind,
    detail,
    scope,
    path,
    queryTemplate,
    expandable,
  }
}

function mysqlFolderLabel(kind: string) {
  switch (kind) {
    case 'view':
      return 'Views'
    case 'procedure':
      return 'Stored Procedures'
    case 'function':
      return 'Functions'
    case 'event':
      return 'Events'
    case 'trigger':
      return 'Triggers'
    default:
      return 'Tables'
  }
}

function createSqliteExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      sqliteNode(connection, {
        id: 'database:main',
        label: 'Main Database',
        kind: 'database',
        detail: connection.database || 'SQLite main database file',
        scope: 'database:main',
        path: [connection.name],
        expandable: true,
        queryTemplate: 'pragma database_list;',
      }),
      sqliteNode(connection, {
        id: 'attached-databases',
        label: 'Attached Databases',
        kind: 'attached-databases',
        detail: 'Database files attached to this connection',
        scope: 'attached-databases',
        path: [connection.name],
        expandable: true,
      }),
    ]
  }

  if (scope === 'database:main' || scope === 'schema:main') {
    return [
      sqliteFolder(connection, 'main', 'tables', 'Tables', 'Base row-store tables'),
      sqliteFolder(connection, 'main', 'views', 'Views', 'Stored SELECT definitions'),
      sqliteFolder(connection, 'main', 'indexes', 'Indexes', 'Standalone and table indexes'),
      sqliteFolder(connection, 'main', 'triggers', 'Triggers', 'Database and table triggers'),
      sqliteFolder(connection, 'main', 'virtual-tables', 'Virtual Tables', 'Extension-backed virtual tables'),
      sqliteFolder(connection, 'main', 'fts-tables', 'FTS Tables', 'Full-text search virtual tables'),
      sqliteFolder(connection, 'main', 'rtree-tables', 'RTree Tables', 'Spatial RTree virtual tables'),
      sqliteFolder(connection, 'main', 'generated-columns', 'Generated Columns', 'Generated and hidden columns'),
      sqliteFolder(connection, 'main', 'attached-databases', 'Attached Databases', 'Other database files'),
      sqliteFolder(connection, 'main', 'pragmas', 'Pragmas', 'SQLite PRAGMA settings and checks', 'pragmas:main'),
      sqliteFolder(connection, 'main', 'schema', 'Schema', 'sqlite_schema definitions'),
    ]
  }

  if (scope === 'folder:main:tables') {
    return [
      sqliteObject(connection, 'main', 'accounts', 'table', 'SQLite table'),
      sqliteObject(connection, 'main', 'orders', 'table', 'SQLite table'),
    ]
  }

  if (scope === 'folder:main:views') {
    return [
      sqliteObject(connection, 'main', 'active_accounts', 'view', 'SQLite view'),
    ]
  }

  if (scope.startsWith('table:main:')) {
    const table = scope.replace('table:main:', '')
    return [
      sqliteSection(connection, table, 'columns', 'Columns', 'Declared columns and affinity'),
      sqliteSection(connection, table, 'constraints', 'Constraints', 'Primary, foreign, not-null, check, and defaults'),
      sqliteSection(connection, table, 'indexes', 'Indexes', 'Table indexes'),
      sqliteSection(connection, table, 'triggers', 'Triggers', 'Table triggers'),
      sqliteSection(connection, table, 'foreign-keys', 'Foreign Keys', 'Foreign key relationships'),
      sqliteSection(connection, table, 'statistics', 'Statistics', 'Row count and storage hints'),
      sqliteSection(connection, table, 'data', 'Data', 'Browse rows', false, `select * from [main].[${table}] limit 100;`),
      sqliteSection(connection, table, 'ddl', 'DDL', 'CREATE statement'),
    ]
  }

  if (scope === 'pragmas:main') {
    return ['database_list', 'table_list', 'foreign_keys', 'journal_mode', 'synchronous', 'quick_check'].map((pragma) =>
      sqliteNode(connection, {
        id: `pragma:main:${pragma}`,
        label: pragma,
        kind: 'pragma',
        detail: `PRAGMA ${pragma}`,
        path: [connection.name, 'Main Database', 'Pragmas'],
        queryTemplate: `pragma ${pragma};`,
      }),
    )
  }

  return []
}

function sqliteFolder(
  connection: ConnectionProfile,
  schema: string,
  folder: string,
  label: string,
  detail: string,
  scope = `folder:${schema}:${folder}`,
) {
  return sqliteNode(connection, {
    id: `folder:${schema}:${folder}`,
    label,
    kind: folder,
    detail,
    scope,
    path: [connection.name, schema === 'main' ? 'Main Database' : schema],
    expandable: true,
  })
}

function sqliteObject(
  connection: ConnectionProfile,
  schema: string,
  label: string,
  kind: string,
  detail: string,
) {
  return sqliteNode(connection, {
    id: `${kind}:${schema}:${label}`,
    label,
    kind,
    detail,
    scope: `${kind}:${schema}:${label}`,
    path: [connection.name, schema === 'main' ? 'Main Database' : schema, kind === 'view' ? 'Views' : 'Tables'],
    expandable: true,
    queryTemplate: `select * from [${schema}].[${label}] limit 100;`,
  })
}

function sqliteSection(
  connection: ConnectionProfile,
  table: string,
  section: string,
  label: string,
  detail: string,
  expandable = true,
  queryTemplate?: string,
) {
  return sqliteNode(connection, {
    id: `table-section:main:${table}:${section}`,
    label,
    kind: section,
    detail,
    scope: `table-section:main:${table}:${section}`,
    path: [connection.name, 'Main Database', 'Tables', table],
    expandable,
    queryTemplate,
  })
}

function sqliteNode(
  connection: ConnectionProfile,
  node: Omit<ExplorerNode, 'family'>,
): ExplorerNode {
  return {
    family: 'sql',
    ...node,
    path: node.path ?? [connection.name],
  }
}



export function inspectExplorerNodeLocally(
  snapshot: WorkspaceSnapshot,
  request: ExplorerInspectRequest,
): ExplorerInspectResponse {
  const connection = findConnection(snapshot, request.connectionId)

  if (!connection) {
    return {
      nodeId: request.nodeId,
      summary: 'Explorer node is not available in the current workspace.',
    }
  }

  const queryTemplate = connection.engine === 'mongodb'
    ? mongoInspectQueryTemplate(connection, request.nodeId)
    : connection.engine === 'oracle'
      ? oracleInspectQueryTemplate(request.nodeId)
      : connection.engine === 'litedb'
      ? liteDbInspectQueryTemplate(request.nodeId)
      : connection.engine === 'cosmosdb'
      ? cosmosInspectQueryTemplate(request.nodeId)
      : connection.engine === 'redis' || connection.engine === 'valkey'
      ? redisInspectQueryTemplate(request.nodeId)
      : connection.engine === 'memcached'
      ? memcachedInspectQueryTemplate(request.nodeId)
      : connection.engine === 'cockroachdb'
      ? cockroachInspectQueryTemplate(connection, request.nodeId)
      : isPostgresLike(connection)
      ? postgresInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'sqlserver'
      ? sqlServerInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'mysql' || connection.engine === 'mariadb'
      ? mysqlInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'elasticsearch' || connection.engine === 'opensearch'
      ? searchInspectQueryTemplate(request.nodeId)
      : connection.engine === 'dynamodb'
      ? dynamoInspectQueryTemplate(request.nodeId)
      : connection.engine === 'cassandra'
      ? cassandraInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'prometheus'
      ? prometheusInspectQueryTemplate(request.nodeId)
      : connection.engine === 'influxdb'
      ? influxInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'opentsdb'
      ? openTsdbInspectQueryTemplate(request.nodeId)
      : connection.family === 'warehouse'
      ? warehouseInspectQueryTemplate(connection, request.nodeId)
      : connection.family === 'graph'
      ? graphInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'sqlite'
      ? sqliteInspectQueryTemplate(request.nodeId)
      : connection.engine === 'duckdb'
      ? duckDbInspectQueryTemplate(request.nodeId)
      : undefined

  return {
    nodeId: request.nodeId,
    summary: `Inspection ready for ${request.nodeId} on ${connection.name}.`,
    queryTemplate,
    payload:
      connection.engine === 'mongodb'
        ? mongoInspectPayload(connection, request.nodeId)
        : connection.engine === 'oracle'
          ? oracleInspectPayload(connection, request.nodeId)
        : connection.engine === 'litedb'
          ? liteDbInspectPayload(connection, request.nodeId)
        : connection.engine === 'cosmosdb'
          ? cosmosInspectPayload(connection, request.nodeId)
        : connection.engine === 'redis' || connection.engine === 'valkey'
          ? redisInspectPayload(request.nodeId)
        : connection.engine === 'memcached'
          ? memcachedInspectPayload(connection, request.nodeId)
        : connection.engine === 'cockroachdb'
          ? cockroachInspectPayload(connection, request.nodeId)
        : isPostgresLike(connection)
          ? postgresInspectPayload(connection, request.nodeId)
        : connection.engine === 'sqlserver'
          ? sqlServerInspectPayload(connection, request.nodeId)
        : connection.engine === 'mysql' || connection.engine === 'mariadb'
          ? mysqlInspectPayload(connection, request.nodeId)
        : connection.engine === 'elasticsearch' || connection.engine === 'opensearch'
          ? searchInspectPayload(connection, request.nodeId)
        : connection.engine === 'dynamodb'
          ? dynamoInspectPayload(connection, request.nodeId)
        : connection.engine === 'cassandra'
          ? cassandraInspectPayload(connection, request.nodeId)
        : connection.engine === 'prometheus'
          ? prometheusInspectPayload(connection, request.nodeId)
        : connection.engine === 'influxdb'
          ? influxInspectPayload(connection, request.nodeId)
        : connection.engine === 'opentsdb'
          ? openTsdbInspectPayload(request.nodeId)
        : connection.family === 'warehouse'
          ? warehouseInspectPayload(connection, request.nodeId)
        : connection.family === 'graph'
          ? graphInspectPayload(connection, request.nodeId)
        : connection.engine === 'sqlite'
          ? sqliteInspectPayload(request.nodeId)
        : connection.engine === 'duckdb'
          ? duckDbInspectPayload(connection, request.nodeId)
        : {
            engine: connection.engine,
            objectName: request.nodeId,
            objectView: 'unavailable',
            warnings: [
              'Preview metadata is not available for this datastore adapter yet.',
            ],
          },
  }
}

function sqliteInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('table:')) {
    const [, schema = 'main', table = 'table_name'] = nodeId.split(':')
    return `select * from [${schema}].[${table}] limit 100;`
  }
  if (nodeId.startsWith('view:')) {
    const [, schema = 'main', view = 'view_name'] = nodeId.split(':')
    return `select * from [${schema}].[${view}] limit 100;`
  }
  if (nodeId.startsWith('pragma:')) {
    return `pragma ${nodeId.split(':').at(-1) ?? 'database_list'};`
  }
  return 'pragma database_list;'
}

function sqliteInspectPayload(nodeId: string) {
  if (nodeId === 'database:main') {
    return sqliteDatabasePayload()
  }

  if (nodeId === 'attached-databases' || nodeId === 'folder:main:attached-databases') {
    return {
      engine: 'sqlite',
      schema: 'main',
      objectName: 'attached-databases',
      objectView: 'attached-databases',
      attachedDatabases: sqliteAttachedDatabases(),
    }
  }

  if (nodeId.startsWith('folder:main:')) {
    return sqliteFolderPayload(nodeId.split(':').at(-1) ?? 'schema')
  }

  if (nodeId.startsWith('table-section:')) {
    const [, schema = 'main', table = 'accounts', section = 'columns'] = nodeId.split(':')
    return sqliteTablePayload(schema, table, section)
  }

  if (nodeId.startsWith('table:')) {
    const [, schema = 'main', table = 'accounts'] = nodeId.split(':')
    return sqliteTablePayload(schema, table, 'table')
  }

  if (nodeId.startsWith('view:')) {
    const [, schema = 'main', view = 'active_accounts'] = nodeId.split(':')
    return {
      engine: 'sqlite',
      schema,
      objectName: view,
      objectView: 'view',
      views: [{
        schema,
        name: view,
        definition: "create view active_accounts as select id, name, status from accounts where status = 'active'",
        status: 'valid',
      }],
      columns: [
        { name: 'id', type: 'integer', nullable: false },
        { name: 'name', type: 'text', nullable: true },
        { name: 'status', type: 'text', nullable: true },
      ],
      dependencies: [{ name: 'accounts', type: 'table', direction: 'reads from' }],
    }
  }

  if (nodeId.startsWith('pragma:')) {
    const pragma = nodeId.split(':').at(-1) ?? 'database_list'
    return {
      engine: 'sqlite',
      schema: 'main',
      objectName: pragma,
      objectView: 'pragma',
      pragmas: sqlitePragmaRows().filter((row) => row.name === pragma),
      checks: pragma.includes('check')
        ? [{ name: pragma, status: 'ok', detail: 'No corruption was reported by the preview check.' }]
        : [],
      attachedDatabases: pragma === 'database_list' ? sqliteAttachedDatabases() : [],
    }
  }

  const [, schema = 'main', objectName = nodeId] = nodeId.split(':')
  return {
    engine: 'sqlite',
    schema,
    objectName,
    objectView: nodeId.startsWith('table:')
      ? 'table'
      : nodeId.startsWith('view:')
        ? 'view'
        : nodeId.startsWith('pragma:')
          ? 'pragma'
          : 'database',
  }
}

function mysqlInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const database = connection.database || 'datapadplusplus'

  if (nodeId.startsWith('table:') || nodeId.startsWith('view:')) {
    const { database: scopedDatabase, objectName } = parseMysqlObjectScope(nodeId, database)
    return `select * from ${mysqlQualifiedName(scopedDatabase, objectName)} limit 100;`
  }

  if (nodeId.startsWith('table-section:')) {
    const [, scopedDatabase = database, table = 'accounts', section = 'columns'] = nodeId.split(':')
    if (section === 'data') {
      return `select * from ${mysqlQualifiedName(scopedDatabase, table)} limit 100;`
    }
    if (section === 'indexes') {
      return `show indexes from ${mysqlQualifiedName(scopedDatabase, table)};`
    }
    return `select * from information_schema.${mysqlInformationSchemaView(section)} where table_schema = '${scopedDatabase}' and table_name = '${table}';`
  }

  if (nodeId.startsWith('database:')) {
    const scopedDatabase = nodeId.replace('database:', '') || database
    return `select table_name, table_type, engine from information_schema.tables where table_schema = '${scopedDatabase}' order by table_name;`
  }

  if (nodeId.includes('diagnostics')) {
    return 'show full processlist;'
  }

  if (nodeId.includes('security')) {
    return 'select user, host, plugin, account_locked from mysql.user order by user, host;'
  }

  return 'select 1;'
}

function mysqlInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const database = connection.database || 'datapadplusplus'

  if (nodeId.startsWith('database:')) {
    return mysqlDatabasePayload(connection, nodeId.replace('database:', '') || database)
  }

  if (nodeId === 'mysql:system-schemas') {
    return {
      engine: connection.engine,
      database,
      objectView: 'system-schemas',
      schemas: [
        { name: 'information_schema', type: 'system', objectCount: 64 },
        { name: 'mysql', type: 'system', objectCount: 38 },
        { name: 'performance_schema', type: 'system', objectCount: 112 },
        { name: 'sys', type: 'system', objectCount: 100 },
      ],
    }
  }

  if (nodeId.startsWith('mysql:security')) {
    return mysqlSecurityPayload(connection)
  }

  if (nodeId.startsWith('mysql:diagnostics')) {
    return mysqlDiagnosticsPayload(connection)
  }

  if (nodeId.startsWith('mysql:')) {
    const [, scopedDatabase = database, section = 'tables'] = nodeId.split(':')
    return mysqlFolderPayload(connection, scopedDatabase, section)
  }

  if (nodeId.startsWith('table-section:')) {
    const [, scopedDatabase = database, table = 'accounts', section = 'columns'] = nodeId.split(':')
    return mysqlTablePayload(connection, scopedDatabase, table, section)
  }

  if (nodeId.startsWith('table:')) {
    const { database: scopedDatabase, objectName } = parseMysqlObjectScope(nodeId, database)
    return mysqlTablePayload(connection, scopedDatabase, objectName, 'table')
  }

  if (nodeId.startsWith('view:')) {
    const { database: scopedDatabase, objectName } = parseMysqlObjectScope(nodeId, database)
    return {
      engine: connection.engine,
      database: scopedDatabase,
      schema: scopedDatabase,
      objectName,
      objectView: 'view',
      views: [{
        schema: scopedDatabase,
        name: objectName,
        definition: "create view active_accounts as select id, name, status from accounts where status = 'active'",
        status: 'valid',
      }],
      columns: [
        { name: 'id', type: 'bigint', nullable: false },
        { name: 'name', type: 'varchar(160)', nullable: true },
        { name: 'status', type: 'varchar(40)', nullable: true },
      ],
      dependencies: [{ name: 'accounts', type: 'table', direction: 'reads from' }],
    }
  }

  if (nodeId.startsWith('procedure:') || nodeId.startsWith('function:') || nodeId.startsWith('event:') || nodeId.startsWith('trigger:')) {
    return mysqlRoutinePayload(connection, nodeId, database)
  }

  if (nodeId.startsWith('index:')) {
    const [, scopedDatabase = database, table = 'accounts', index = 'PRIMARY'] = nodeId.split(':')
    return {
      engine: connection.engine,
      database: scopedDatabase,
      schema: scopedDatabase,
      objectName: index,
      objectView: 'index',
      indexes: mysqlIndexes(table).filter((row) => row.name === index || row.name === 'PRIMARY'),
    }
  }

  return mysqlDatabasePayload(connection, database)
}

function mysqlDatabasePayload(connection: ConnectionProfile, database: string) {
  return {
    engine: connection.engine,
    database,
    schema: database,
    objectName: database,
    objectView: 'database',
    tableCount: 3,
    indexCount: 4,
    rowCount: 428,
    tables: mysqlTables(database),
    views: [{
      schema: database,
      name: 'active_accounts',
      definition: "create view active_accounts as select id, name, status from accounts where status = 'active'",
      status: 'valid',
    }],
    indexes: [
      ...mysqlIndexes('accounts'),
      ...mysqlIndexes('orders'),
    ],
    procedures: [
      { schema: database, name: 'refresh_account_rollup', arguments: 'in p_account_id bigint', language: 'sql', security: 'definer' },
    ],
    functions: [
      { schema: database, name: 'account_status_label', arguments: 'p_status varchar(40)', returns: 'varchar(120)', language: 'sql' },
    ],
    events: [
      { schema: database, name: 'purge_old_sessions', status: 'enabled', schedule: 'every 1 day', lastExecuted: '2026-05-20T02:00:00Z', definer: 'app@%' },
    ],
    triggers: [
      { name: 'accounts_updated_at', timing: 'before', event: 'update', enabled: true, function: 'sets updated_at' },
    ],
    permissions: mysqlGrants(database),
    statistics: mysqlStatistics(database),
  }
}

function mysqlFolderPayload(connection: ConnectionProfile, database: string, section: string) {
  const base = mysqlDatabasePayload(connection, database)

  if (section === 'tables') {
    return { ...base, objectView: 'tables', views: [], indexes: [], procedures: [], functions: [], events: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'views') {
    return { ...base, objectView: 'views', tables: [], indexes: [], procedures: [], functions: [], events: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'procedures') {
    return { ...base, objectView: 'procedures', tables: [], views: [], indexes: [], functions: [], events: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'functions') {
    return { ...base, objectView: 'functions', tables: [], views: [], indexes: [], procedures: [], events: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'events') {
    return { ...base, objectView: 'events', tables: [], views: [], indexes: [], procedures: [], functions: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'triggers') {
    return { ...base, objectView: 'triggers', tables: [], views: [], indexes: [], procedures: [], functions: [], events: [], permissions: [], statistics: [] }
  }

  if (section === 'indexes') {
    return { ...base, objectView: 'indexes', tables: [], views: [], procedures: [], functions: [], events: [], triggers: [], permissions: [], statistics: [] }
  }

  if (section === 'storage') {
    return {
      ...base,
      objectView: 'storage',
      tables: [],
      views: [],
      indexes: [],
      procedures: [],
      functions: [],
      events: [],
      triggers: [],
      permissions: [],
      engines: [
        { name: 'InnoDB', support: 'default', transactions: 'yes', xa: 'yes', savepoints: 'yes' },
        { name: 'MEMORY', support: 'yes', transactions: 'no', xa: 'no', savepoints: 'no' },
      ],
    }
  }

  return base
}

function mysqlTablePayload(connection: ConnectionProfile, database: string, table: string, section: string) {
  const payload = {
    engine: connection.engine,
    database,
    schema: database,
    objectName: table,
    objectView: section === 'table' ? 'table' : section,
    rowCount: table === 'orders' ? 256 : 128,
    size: table === 'orders' ? '144 KB' : '80 KB',
    tables: mysqlTables(database).filter((row) => row.name === table),
    columns: [
      { name: 'id', type: 'bigint unsigned', nullable: false, default: '', identity: 'auto_increment', collation: '' },
      { name: 'name', type: 'varchar(160)', nullable: true, default: '', collation: 'utf8mb4_0900_ai_ci' },
      { name: 'updated_at', type: 'timestamp', nullable: false, default: 'current_timestamp', collation: '' },
    ],
    indexes: mysqlIndexes(table),
    constraints: [
      { name: 'PRIMARY', type: 'primary key', columns: 'id', status: 'enforced' },
    ],
    foreignKeys: table === 'orders'
      ? [{ id: 1, from: 'account_id', table: 'accounts', to: 'id', onUpdate: 'RESTRICT', onDelete: 'CASCADE' }]
      : [],
    triggers: [
      { name: `${table}_updated_at`, timing: 'before', event: 'update', enabled: true, function: 'sets updated_at' },
    ],
    partitions: [],
    statistics: mysqlStatistics(database).filter((row) => row.name === table),
    permissions: mysqlGrants(database).filter((row) => row.object === table),
    schemaObjects: [{
      type: 'table',
      name: table,
      tableName: table,
      definition: `create table ${mysqlIdentifier(table)} (id bigint unsigned primary key auto_increment, name varchar(160), updated_at timestamp not null default current_timestamp) engine=InnoDB`,
    }],
  }

  if (section === 'columns') {
    return { ...payload, tables: [], indexes: [], constraints: [], foreignKeys: [], triggers: [], partitions: [], statistics: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'indexes') {
    return { ...payload, tables: [], columns: [], constraints: [], foreignKeys: [], triggers: [], partitions: [], statistics: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'constraints') {
    return { ...payload, tables: [], columns: [], indexes: [], foreignKeys: [], triggers: [], partitions: [], statistics: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'foreign-keys') {
    return { ...payload, tables: [], columns: [], indexes: [], constraints: [], triggers: [], partitions: [], statistics: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'triggers') {
    return { ...payload, tables: [], columns: [], indexes: [], constraints: [], foreignKeys: [], partitions: [], statistics: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'statistics') {
    return { ...payload, tables: [], columns: [], indexes: [], constraints: [], foreignKeys: [], triggers: [], partitions: [], permissions: [], schemaObjects: [] }
  }

  if (section === 'ddl') {
    return { ...payload, tables: [], columns: [], indexes: [], constraints: [], foreignKeys: [], triggers: [], partitions: [], statistics: [], permissions: [] }
  }

  return payload
}

function mysqlRoutinePayload(connection: ConnectionProfile, nodeId: string, fallbackDatabase: string) {
  const [kind = 'procedure', database = fallbackDatabase, objectName = 'routine'] = nodeId.split(':')
  const definition = mysqlRoutineDefinition(kind, database, objectName)
  const routine = {
    schema: database,
    name: objectName,
    arguments: kind === 'function' ? 'p_status varchar(40)' : 'in p_account_id bigint',
    returns: kind === 'function' ? 'varchar(120)' : '',
    language: 'sql',
    security: 'definer',
    definition,
  }

  return {
    engine: connection.engine,
    database,
    schema: database,
    objectName,
    objectView: kind,
    definition,
    ...(kind === 'function' ? { functions: [routine] } : {}),
    ...(kind === 'procedure' ? { procedures: [routine] } : {}),
    ...(kind === 'event' ? { events: [{ schema: database, name: objectName, status: 'enabled', schedule: 'every 1 day', definer: 'app@%' }] } : {}),
    ...(kind === 'trigger' ? { triggers: [{ name: objectName, timing: 'before', event: 'update', enabled: true, function: 'sets updated_at' }] } : {}),
    parameters: kind === 'event' || kind === 'trigger'
      ? []
      : [{ name: kind === 'function' ? 'p_status' : 'p_account_id', type: kind === 'function' ? 'varchar(40)' : 'bigint', mode: kind === 'function' ? 'in' : 'in', ordinal: 1 }],
    permissions: mysqlGrants(database).filter((row) => row.object === objectName),
  }
}

function mysqlRoutineDefinition(kind: string, database: string, objectName: string) {
  if (kind === 'function') {
    return [
      `create function ${mysqlIdentifier(database)}.${mysqlIdentifier(objectName)}(p_status varchar(40))`,
      'returns varchar(120)',
      'deterministic',
      'begin',
      "  return concat('status:', p_status);",
      'end',
    ].join('\n')
  }

  if (kind === 'trigger') {
    return [
      `create trigger ${mysqlIdentifier(database)}.${mysqlIdentifier(objectName)}`,
      'before update on accounts',
      'for each row',
      'set new.updated_at = current_timestamp;',
    ].join('\n')
  }

  if (kind === 'event') {
    return [
      `create event ${mysqlIdentifier(database)}.${mysqlIdentifier(objectName)}`,
      'on schedule every 1 day',
      'do call refresh_account_rollups();',
    ].join('\n')
  }

  return [
    `create procedure ${mysqlIdentifier(database)}.${mysqlIdentifier(objectName)}(in p_account_id bigint)`,
    'begin',
    '  select p_account_id as account_id;',
    'end',
  ].join('\n')
}

function mysqlSecurityPayload(connection: ConnectionProfile) {
  return {
    engine: connection.engine,
    objectView: 'security',
    users: [
      { name: 'app', type: 'user', defaultSchema: connection.database || 'datapadplusplus', authenticationType: 'caching_sha2_password' },
      { name: 'reporting', type: 'user', defaultSchema: connection.database || 'datapadplusplus', authenticationType: 'mysql_native_password' },
    ],
    roles: [
      { name: 'readonly', login: 'no', inherit: 'yes', memberships: 'reporting' },
    ],
    permissions: mysqlGrants(connection.database || 'datapadplusplus'),
  }
}

function mysqlDiagnosticsPayload(connection: ConnectionProfile) {
  return {
    engine: connection.engine,
    objectView: 'diagnostics',
    activeSessions: 3,
    sessions: [
      { sessionId: 11, user: 'app', database: connection.database || 'datapadplusplus', state: 'executing', wait: 'none', blockedBy: '' },
      { sessionId: 12, user: 'reporting', database: connection.database || 'datapadplusplus', state: 'sleep', wait: 'idle', blockedBy: '' },
    ],
    statistics: [
      { name: 'Questions', rows: 1200, scans: 0, size: '' },
      { name: 'Slow_queries', rows: 2, scans: 0, size: '' },
    ],
    replication: [
      { channel: 'default', role: 'replica', state: 'not configured', lagSeconds: 0, sourceHost: '', gtid: '' },
    ],
  }
}

function mysqlTables(database: string) {
  return [
    { schema: database, name: 'accounts', type: 'BASE TABLE', rows: 128, size: '80 KB', owner: 'app' },
    { schema: database, name: 'orders', type: 'BASE TABLE', rows: 256, size: '144 KB', owner: 'app' },
    { schema: database, name: 'products', type: 'BASE TABLE', rows: 44, size: '64 KB', owner: 'app' },
  ]
}

function mysqlIndexes(table: string) {
  return [
    { name: 'PRIMARY', type: 'btree', columns: 'id', unique: true, valid: true, size: '16 KB', usage: table },
    ...(table === 'orders'
      ? [{ name: 'orders_account_id_idx', type: 'btree', columns: 'account_id', unique: false, valid: true, size: '24 KB', usage: 'foreign key lookup' }]
      : []),
  ]
}

function mysqlStatistics(database: string) {
  return mysqlTables(database).map((table) => ({
    name: table.name,
    rows: table.rows,
    scans: 0,
    size: table.size,
  }))
}

function mysqlGrants(database: string) {
  return [
    { principal: 'app@%', privilege: 'SELECT, INSERT, UPDATE, DELETE', object: database, state: 'granted', grantor: 'root@%' },
    { principal: 'reporting@%', privilege: 'SELECT', object: 'accounts', state: 'granted', grantor: 'root@%' },
  ]
}

function parseMysqlObjectScope(scope: string, fallbackDatabase: string) {
  const parts = scope.split(':')
  if (parts.length >= 3) {
    return {
      database: parts[1] || fallbackDatabase,
      objectName: parts[2] || 'accounts',
    }
  }

  const [, qualified = ''] = scope.split(':')
  const [database, objectName] = qualified.includes('.')
    ? qualified.split('.', 2)
    : [fallbackDatabase, qualified]
  return {
    database: database || fallbackDatabase,
    objectName: objectName || 'accounts',
  }
}

function mysqlInformationSchemaView(section: string) {
  switch (section) {
    case 'indexes':
      return 'statistics'
    case 'constraints':
    case 'foreign-keys':
      return 'table_constraints'
    case 'triggers':
      return 'triggers'
    default:
      return 'columns'
  }
}

function mysqlQualifiedName(database: string, objectName: string) {
  return `${mysqlIdentifier(database)}.${mysqlIdentifier(objectName)}`
}

function mysqlIdentifier(value: string) {
  return `\`${value.replace(/`/g, '``')}\``
}

function createDynamoExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      dynamoNode(connection, 'dynamodb:tables', 'Tables', 'tables', 'DynamoDB tables and item counts', 'dynamodb:tables', [], true),
      dynamoNode(connection, 'dynamodb:security', 'Access', 'security', 'IAM-style access and table policies', 'dynamodb:security', [], true),
      dynamoNode(connection, 'dynamodb:diagnostics', 'Diagnostics', 'diagnostics', 'Capacity, throttles, hot partitions, and alarms', 'dynamodb:diagnostics', [], true),
    ]
  }

  if (scope === 'dynamodb:tables') {
    return dynamoTables().map((table) =>
      dynamoNode(
        connection,
        `table:${table.name}`,
        table.name,
        'table',
        `${table.status} / ${table.billingMode} / ${table.items.toLocaleString()} items`,
        `table:${table.name}`,
        ['Tables'],
        true,
        dynamoQueryTemplate(table.name),
      ),
    )
  }

  if (scope.startsWith('table:')) {
    const table = scope.replace('table:', '') || 'Orders'
    return [
      dynamoNode(connection, `items:${table}`, 'Items', 'items', 'Partition-key query and bounded scan', undefined, ['Tables', table], false, dynamoQueryTemplate(table)),
      dynamoNode(connection, `keys:${table}`, 'Keys', 'keys', 'Partition and sort key schema', undefined, ['Tables', table]),
      dynamoNode(connection, `gsi:${table}`, 'Global Secondary Indexes', 'global-secondary-indexes', 'GSIs and projected attributes', undefined, ['Tables', table]),
      dynamoNode(connection, `lsi:${table}`, 'Local Secondary Indexes', 'local-secondary-indexes', 'LSIs and alternate sort keys', undefined, ['Tables', table]),
      dynamoNode(connection, `streams:${table}`, 'Streams', 'streams', 'Stream status and view type', undefined, ['Tables', table]),
      dynamoNode(connection, `ttl:${table}`, 'TTL', 'ttl', 'Time-to-live attribute and status', undefined, ['Tables', table]),
      dynamoNode(connection, `capacity:${table}`, 'Capacity', 'capacity', 'Consumed capacity and throttles', undefined, ['Tables', table]),
      dynamoNode(connection, `permissions:${table}`, 'Permissions', 'permissions', 'Visible table and index permissions', undefined, ['Tables', table]),
    ]
  }

  if (scope === 'dynamodb:security') {
    return [
      dynamoNode(connection, 'dynamodb:security:permissions', 'Permissions', 'permissions', 'Visible table, stream, and index privileges', undefined, ['Access']),
      dynamoNode(connection, 'dynamodb:security:policies', 'Table Policies', 'security', 'Resource policies and disabled action reasons', undefined, ['Access']),
    ]
  }

  if (scope === 'dynamodb:diagnostics') {
    return [
      dynamoNode(connection, 'dynamodb:diagnostics:capacity', 'Capacity', 'capacity', 'Read/write usage, throttles, and latency', undefined, ['Diagnostics']),
      dynamoNode(connection, 'dynamodb:diagnostics:hot-partitions', 'Hot Partitions', 'hot-partitions', 'High-traffic partition keys', undefined, ['Diagnostics']),
      dynamoNode(connection, 'dynamodb:diagnostics:alarms', 'Alarms', 'alarms', 'Capacity, latency, and stream alarms', undefined, ['Diagnostics']),
      dynamoNode(connection, 'dynamodb:diagnostics:backups', 'Backups', 'backups', 'PITR and on-demand backups', undefined, ['Diagnostics']),
    ]
  }

  return []
}

function dynamoNode(
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

function dynamoInspectQueryTemplate(nodeId: string) {
  const tableName = dynamoTableNameFromNodeId(nodeId)

  if (tableName) {
    return dynamoQueryTemplate(tableName)
  }

  return JSON.stringify({ operation: 'ListTables', limit: 20 }, null, 2)
}

function dynamoInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const region = dynamoRegion(connection)

  if (nodeId === 'dynamodb:tables') {
    return {
      engine: 'dynamodb',
      region,
      objectView: 'tables',
      tables: dynamoTables(),
    }
  }

  if (nodeId.startsWith('table:')) {
    return dynamoTablePayload(connection, nodeId.replace('table:', '') || 'Orders', 'table')
  }

  if (nodeId.startsWith('items:')) {
    return dynamoTablePayload(connection, nodeId.replace('items:', '') || 'Orders', 'items')
  }

  if (nodeId.startsWith('keys:')) {
    return dynamoTablePayload(connection, nodeId.replace('keys:', '') || 'Orders', 'keys')
  }

  if (nodeId.startsWith('gsi:')) {
    return dynamoTablePayload(connection, nodeId.replace('gsi:', '') || 'Orders', 'global-secondary-indexes')
  }

  if (nodeId.startsWith('lsi:')) {
    return dynamoTablePayload(connection, nodeId.replace('lsi:', '') || 'Orders', 'local-secondary-indexes')
  }

  if (nodeId.startsWith('streams:')) {
    return dynamoTablePayload(connection, nodeId.replace('streams:', '') || 'Orders', 'streams')
  }

  if (nodeId.startsWith('ttl:')) {
    return dynamoTablePayload(connection, nodeId.replace('ttl:', '') || 'Orders', 'ttl')
  }

  if (nodeId.startsWith('capacity:')) {
    return dynamoTablePayload(connection, nodeId.replace('capacity:', '') || 'Orders', 'capacity')
  }

  if (nodeId.startsWith('permissions:')) {
    return dynamoTablePayload(connection, nodeId.replace('permissions:', '') || 'Orders', 'permissions')
  }

  if (nodeId.startsWith('dynamodb:security')) {
    return {
      engine: 'dynamodb',
      region,
      objectView: nodeId.endsWith(':permissions') ? 'permissions' : 'security',
      permissions: dynamoPermissions(),
      warnings: nodeId.endsWith(':policies')
        ? ['Resource policy preview is deterministic in browser mode; live policy inspection depends on IAM permissions.']
        : [],
    }
  }

  if (nodeId.startsWith('dynamodb:diagnostics')) {
    return dynamoDiagnosticsPayload(connection, nodeId)
  }

  return {
    engine: 'dynamodb',
    region,
    objectView: 'tables',
    tables: dynamoTables(),
  }
}

function dynamoTablePayload(connection: ConnectionProfile, tableName: string, objectView: string) {
  const table = dynamoTables().find((candidate) => candidate.name === tableName) ?? dynamoTables()[0]!
  const payload = {
    engine: 'dynamodb',
    region: dynamoRegion(connection),
    objectView,
    tableName: table.name,
    objectName: table.name,
    status: table.status,
    billingMode: table.billingMode,
    itemCount: table.items,
    storage: table.storage,
    readCapacity: table.readCapacity,
    writeCapacity: table.writeCapacity,
    tables: [table],
    items: dynamoItems(table.name),
    keys: dynamoKeys(table.name),
    globalSecondaryIndexes: dynamoGlobalSecondaryIndexes(table.name),
    localSecondaryIndexes: dynamoLocalSecondaryIndexes(table.name),
    streams: dynamoStreams(table.name),
    ttl: dynamoTtl(table.name),
    capacity: dynamoCapacity(table.name),
    hotPartitions: dynamoHotPartitions(table.name),
    alarms: dynamoAlarms(table.name),
    backups: dynamoBackups(table.name),
    permissions: dynamoPermissions().filter((permission) => permission.resource.includes(table.name) || permission.resource === '*'),
  }

  if (objectView === 'items') {
    return { ...payload, tables: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], streams: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'keys') {
    return { ...payload, tables: [], items: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], streams: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'global-secondary-indexes') {
    return { ...payload, tables: [], items: [], keys: [], localSecondaryIndexes: [], streams: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'local-secondary-indexes') {
    return { ...payload, tables: [], items: [], keys: [], globalSecondaryIndexes: [], streams: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'streams') {
    return { ...payload, tables: [], items: [], keys: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'ttl') {
    return { ...payload, tables: [], items: [], keys: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], streams: [], capacity: [], hotPartitions: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'capacity') {
    return { ...payload, tables: [], items: [], keys: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], streams: [], ttl: [], alarms: [], backups: [], permissions: [] }
  }

  if (objectView === 'permissions') {
    return { ...payload, tables: [], items: [], keys: [], globalSecondaryIndexes: [], localSecondaryIndexes: [], streams: [], ttl: [], capacity: [], hotPartitions: [], alarms: [], backups: [] }
  }

  return payload
}

function dynamoDiagnosticsPayload(connection: ConnectionProfile, nodeId: string) {
  const region = dynamoRegion(connection)
  const base = {
    engine: 'dynamodb',
    region,
    objectView: 'diagnostics',
    capacity: dynamoTables().flatMap((table) => dynamoCapacity(table.name)),
    hotPartitions: dynamoTables().flatMap((table) => dynamoHotPartitions(table.name)),
    alarms: dynamoTables().flatMap((table) => dynamoAlarms(table.name)),
    backups: dynamoTables().flatMap((table) => dynamoBackups(table.name)),
    streams: dynamoTables().flatMap((table) => dynamoStreams(table.name)),
  }

  if (nodeId.endsWith(':capacity')) {
    return { ...base, objectView: 'capacity', hotPartitions: [], alarms: [], backups: [], streams: [] }
  }

  if (nodeId.endsWith(':hot-partitions')) {
    return { ...base, objectView: 'hot-partitions', capacity: [], alarms: [], backups: [], streams: [] }
  }

  if (nodeId.endsWith(':alarms')) {
    return { ...base, objectView: 'alarms', capacity: [], hotPartitions: [], backups: [], streams: [] }
  }

  if (nodeId.endsWith(':backups')) {
    return { ...base, objectView: 'backups', capacity: [], hotPartitions: [], alarms: [], streams: [] }
  }

  return base
}

function dynamoQueryTemplate(tableName: string) {
  return JSON.stringify({
    operation: 'Query',
    tableName,
    keyConditionExpression: '#pk = :pk',
    expressionAttributeNames: { '#pk': 'pk' },
    expressionAttributeValues: { ':pk': { S: 'CUSTOMER#123' } },
    limit: 20,
  }, null, 2)
}

function dynamoTableNameFromNodeId(nodeId: string) {
  if (nodeId.startsWith('table:')) {
    return nodeId.replace('table:', '')
  }

  if (/^(items|keys|gsi|lsi|streams|ttl|capacity|permissions):/.test(nodeId)) {
    return nodeId.split(':')[1]
  }

  return undefined
}

function dynamoRegion(connection: ConnectionProfile) {
  return connection.database || 'local'
}

function dynamoTables() {
  return [
    { name: 'Orders', status: 'ACTIVE', billingMode: 'PAY_PER_REQUEST', items: 482000, storage: '1.4 GB', partitionKey: 'pk', sortKey: 'sk', readCapacity: 'on-demand', writeCapacity: 'on-demand' },
    { name: 'Products', status: 'ACTIVE', billingMode: 'PROVISIONED', items: 100000, storage: '420 MB', partitionKey: 'sku', sortKey: '-', readCapacity: 120, writeCapacity: 40 },
  ]
}

function dynamoItems(tableName: string) {
  return tableName === 'Products'
    ? [
        { partitionKey: 'SKU#luna-lamp', sortKey: 'PROFILE', status: 'active', total: 18, updatedAt: '2026-05-21T11:29:08Z' },
        { partitionKey: 'SKU#aurora-desk', sortKey: 'PROFILE', status: 'active', total: 8, updatedAt: '2026-05-21T11:29:08Z' },
      ]
    : [
        { partitionKey: 'CUSTOMER#123', sortKey: 'ORDER#2026-0001', status: 'paid', total: 49.99, updatedAt: '2026-05-20T09:12:00Z' },
        { partitionKey: 'CUSTOMER#123', sortKey: 'ORDER#2026-0002', status: 'processing', total: 129.5, updatedAt: '2026-05-21T10:00:00Z' },
      ]
}

function dynamoKeys(tableName: string) {
  return tableName === 'Products'
    ? [
        { attribute: 'sku', type: 'HASH', keyRole: 'partition', attributeType: 'S' },
      ]
    : [
        { attribute: 'pk', type: 'HASH', keyRole: 'partition', attributeType: 'S' },
        { attribute: 'sk', type: 'RANGE', keyRole: 'sort', attributeType: 'S' },
      ]
}

function dynamoGlobalSecondaryIndexes(tableName: string) {
  return tableName === 'Products'
    ? [
        { name: 'category-updatedAt-index', partitionKey: 'category', sortKey: 'updatedAt', projection: 'ALL', status: 'ACTIVE', items: 100000, capacity: 'shared provisioned' },
      ]
    : [
        { name: 'customer-status-index', partitionKey: 'customerId', sortKey: 'status', projection: 'INCLUDE total, updatedAt', status: 'ACTIVE', items: 482000, capacity: 'on-demand' },
      ]
}

function dynamoLocalSecondaryIndexes(tableName: string) {
  return tableName === 'Orders'
    ? [{ name: 'createdAt-lsi', sortKey: 'createdAt', projection: 'KEYS_ONLY', items: 482000, storage: '94 MB' }]
    : []
}

function dynamoStreams(tableName: string) {
  return [
    { status: tableName === 'Orders' ? 'ENABLED' : 'DISABLED', viewType: tableName === 'Orders' ? 'NEW_AND_OLD_IMAGES' : '-', arn: tableName === 'Orders' ? `arn:aws:dynamodb:local:000000000000:table/${tableName}/stream/2026-05-20T00:00:00.000` : '-', shards: tableName === 'Orders' ? 4 : 0, consumers: tableName === 'Orders' ? 1 : 0 },
  ]
}

function dynamoTtl(tableName: string) {
  return [
    { attribute: tableName === 'Orders' ? 'expiresAt' : '-', status: tableName === 'Orders' ? 'ENABLED' : 'DISABLED', sampleExpiringItems: tableName === 'Orders' ? 1240 : 0, oldestExpiry: tableName === 'Orders' ? '2026-05-24T00:00:00Z' : '-' },
  ]
}

function dynamoCapacity(tableName: string) {
  return [
    { resource: tableName, readUnits: tableName === 'Orders' ? 84 : 22, writeUnits: tableName === 'Orders' ? 31 : 6, readThrottleEvents: tableName === 'Orders' ? 2 : 0, writeThrottleEvents: 0, latencyP95: tableName === 'Orders' ? '12 ms' : '7 ms' },
    ...dynamoGlobalSecondaryIndexes(tableName).map((index) => ({ resource: `${tableName}/${index.name}`, readUnits: 18, writeUnits: 4, readThrottleEvents: 0, writeThrottleEvents: 0, latencyP95: '8 ms' })),
  ]
}

function dynamoHotPartitions(tableName: string) {
  return [
    { partitionKey: tableName === 'Orders' ? 'CUSTOMER#123' : 'CATEGORY#lighting', readPercent: tableName === 'Orders' ? '18%' : '11%', writePercent: tableName === 'Orders' ? '9%' : '4%', throttles: tableName === 'Orders' ? 2 : 0, recommendation: tableName === 'Orders' ? 'Review access pattern or add write sharding if sustained.' : 'Healthy.' },
  ]
}

function dynamoAlarms(tableName: string) {
  return [
    { name: `${tableName}-read-throttle`, state: tableName === 'Orders' ? 'ALARM' : 'OK', metric: 'ReadThrottleEvents', threshold: '> 0 for 5m', updatedAt: '2026-05-21T09:00:00Z' },
    { name: `${tableName}-latency-p95`, state: 'OK', metric: 'SuccessfulRequestLatency', threshold: '> 100ms p95', updatedAt: '2026-05-21T09:00:00Z' },
  ]
}

function dynamoBackups(tableName: string) {
  return [
    { name: `${tableName}-daily`, type: 'PITR', status: 'ENABLED', createdAt: 'continuous', size: tableName === 'Orders' ? '1.4 GB' : '420 MB' },
  ]
}

function dynamoPermissions() {
  return [
    { principal: 'app-writer', action: 'dynamodb:GetItem, Query, PutItem, UpdateItem', resource: 'Orders', effect: 'Allow', condition: 'environment = qa' },
    { principal: 'reporting-role', action: 'dynamodb:Query', resource: 'Products', effect: 'Allow', condition: '-' },
    { principal: 'admin-preview', action: 'dynamodb:*', resource: '*', effect: 'Deny in safe mode', condition: 'requires confirmation' },
  ]
}

function createCassandraExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
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

function cassandraInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const { keyspace, table } = cassandraTableNameFromNodeId(connection, nodeId)

  if (table) {
    return cassandraQueryTemplate(keyspace, table)
  }

  return 'select keyspace_name, table_name from system_schema.tables;'
}

function cassandraInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const { keyspace, table } = cassandraTableNameFromNodeId(connection, nodeId)

  if (nodeId.startsWith('keyspace:')) {
    return cassandraKeyspacePayload(connection, nodeId.replace('keyspace:', '') || keyspace)
  }

  if (table) {
    return cassandraTablePayload(keyspace, table, cassandraObjectViewFromNodeId(nodeId))
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

function createPrometheusExplorerNodes(scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      prometheusNode({
        id: 'prometheus:metrics',
        label: 'Metrics',
        kind: 'metrics',
        detail: 'Metric families and cardinality signals',
        scope: 'prometheus:metrics',
        expandable: true,
      }),
      prometheusNode({
        id: 'prometheus:labels',
        label: 'Labels',
        kind: 'labels',
        detail: 'Label names and high-cardinality dimensions',
        scope: 'prometheus:labels',
        expandable: true,
      }),
      prometheusNode({
        id: 'prometheus:targets',
        label: 'Targets',
        kind: 'targets',
        detail: 'Scrape health and target labels',
        scope: 'prometheus:targets',
        expandable: true,
      }),
      prometheusNode({
        id: 'prometheus:rules',
        label: 'Rules',
        kind: 'rules',
        detail: 'Recording and alerting rule groups',
        scope: 'prometheus:rules',
        expandable: true,
      }),
      prometheusNode({
        id: 'prometheus:alerts',
        label: 'Alerts',
        kind: 'alerts',
        detail: 'Firing and pending alerts',
        scope: 'prometheus:alerts',
        expandable: true,
      }),
      prometheusNode({
        id: 'prometheus:service-discovery',
        label: 'Service Discovery',
        kind: 'service-discovery',
        detail: 'Discovered and dropped targets',
        scope: 'prometheus:service-discovery',
      }),
      prometheusNode({
        id: 'prometheus:tsdb',
        label: 'TSDB / Storage',
        kind: 'tsdb',
        detail: 'Head series, chunks, blocks, and retention',
        scope: 'prometheus:tsdb',
      }),
      prometheusNode({
        id: 'prometheus:diagnostics',
        label: 'Diagnostics',
        kind: 'diagnostics',
        detail: 'Runtime status and query-risk signals',
        scope: 'prometheus:diagnostics',
      }),
    ]
  }

  if (scope === 'prometheus:metrics') {
    return prometheusMetrics().map((metric) =>
      prometheusNode({
        id: `metric:${metric.name}`,
        label: metric.name,
        kind: 'metric',
        detail: `${metric.type} | ${metric.series} series`,
        path: ['Metrics'],
        scope: `metric:${metric.name}`,
        expandable: true,
        queryTemplate: metric.name,
      }),
    )
  }

  if (scope.startsWith('metric:')) {
    const metric = scope.replace('metric:', '')
    return [
      prometheusNode({
        id: `series:${metric}`,
        label: 'Series',
        kind: 'series',
        detail: 'Bounded label combinations',
        path: ['Metrics', metric],
        scope: `series:${metric}`,
        queryTemplate: `${metric}{job=~".+"}`,
      }),
      prometheusNode({
        id: `labels:${metric}`,
        label: 'Labels',
        kind: 'labels',
        detail: 'Dimensions on this metric',
        path: ['Metrics', metric],
        scope: `labels:${metric}`,
      }),
      prometheusNode({
        id: `alerts:${metric}`,
        label: 'Related Alerts',
        kind: 'alerts',
        detail: 'Alerting rules referencing this metric',
        path: ['Metrics', metric],
        scope: `alerts:${metric}`,
      }),
    ]
  }

  if (scope === 'prometheus:labels') {
    return prometheusLabels().map((label) =>
      prometheusNode({
        id: `label:${label.name}`,
        label: label.name,
        kind: 'label',
        detail: `${label.valueCount} value(s) | ${label.risk}`,
        path: ['Labels'],
        scope: `label:${label.name}`,
        expandable: true,
      }),
    )
  }

  if (scope.startsWith('label:')) {
    const label = scope.replace('label:', '')
    return prometheusLabelValues(label).map((value) =>
      prometheusNode({
        id: `label-value:${label}:${value.value}`,
        label: value.value,
        kind: 'series',
        detail: `${value.series} series`,
        path: ['Labels', label],
        scope: `series-by-label:${label}:${value.value}`,
        queryTemplate: `{${label}="${value.value}"}`,
      }),
    )
  }

  if (scope === 'prometheus:targets') {
    return prometheusTargets().map((target) =>
      prometheusNode({
        id: `target:${target.job}:${target.instance}`,
        label: `${target.job} / ${target.instance}`,
        kind: 'target',
        detail: `${target.health} | ${target.lastScrape}`,
        path: ['Targets'],
        scope: `target:${target.job}:${target.instance}`,
      }),
    )
  }

  if (scope === 'prometheus:rules') {
    return prometheusRuleGroups().map((group) =>
      prometheusNode({
        id: `rule-group:${group.name}`,
        label: group.name,
        kind: 'rule-group',
        detail: `${group.rules} rule(s) | ${group.health}`,
        path: ['Rules'],
        scope: `rule-group:${group.name}`,
        expandable: true,
      }),
    )
  }

  if (scope.startsWith('rule-group:')) {
    const group = scope.replace('rule-group:', '')
    return prometheusRules().filter((rule) => rule.group === group).map((rule) =>
      prometheusNode({
        id: `rule:${rule.group}:${rule.name}`,
        label: rule.name,
        kind: 'rule',
        detail: `${rule.type} | ${rule.health}`,
        path: ['Rules', group],
        scope: `rule:${rule.group}:${rule.name}`,
        queryTemplate: rule.expression,
      }),
    )
  }

  if (scope === 'prometheus:alerts') {
    return prometheusAlerts().map((alert) =>
      prometheusNode({
        id: `alert:${alert.name}`,
        label: alert.name,
        kind: 'alert',
        detail: `${alert.state} | ${alert.severity}`,
        path: ['Alerts'],
        scope: `alert:${alert.name}`,
      }),
    )
  }

  return []
}

function prometheusInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('metric:')) {
    return nodeId.replace('metric:', '')
  }

  if (nodeId.startsWith('series:')) {
    const metric = nodeId.replace('series:', '')
    return `${metric}{job=~".+"}`
  }

  if (nodeId.startsWith('label-value:')) {
    const [, label = 'job', value = 'app'] = nodeId.split(':')
    return `{${label}="${value}"}`
  }

  if (nodeId.startsWith('rule:')) {
    const [, group = '', name = ''] = nodeId.split(':')
    return prometheusRules().find((rule) => rule.group === group && rule.name === name)?.expression ?? 'up'
  }

  if (nodeId === 'prometheus:alerts') {
    return 'ALERTS'
  }

  return 'up'
}

function prometheusInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const base = prometheusBasePayload(connection)

  if (nodeId === 'prometheus:metrics') {
    return {
      ...base,
      objectView: 'metrics',
      metrics: prometheusMetrics(),
      labels: prometheusLabels(),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId.startsWith('metric:')) {
    const metricName = nodeId.replace('metric:', '')
    const metric = prometheusMetrics().find((item) => item.name === metricName)
    return {
      ...base,
      objectView: 'metric',
      metric: metricName,
      metrics: metric ? [metric] : [],
      series: prometheusSeries(metricName),
      labels: prometheusMetricLabels(metricName),
      diagnostics: prometheusMetricDiagnostics(metricName),
    }
  }

  if (nodeId === 'prometheus:labels' || nodeId.startsWith('label:')) {
    const label = nodeId.startsWith('label:') ? nodeId.replace('label:', '') : undefined
    return {
      ...base,
      objectView: label ? 'label' : 'labels',
      label,
      labels: prometheusLabels().filter((item) => !label || item.name === label),
      labelValues: label ? prometheusLabelValues(label) : prometheusLabelValues('job'),
      metrics: label ? prometheusMetrics().filter((metric) => metric.labels.includes(label)) : prometheusMetrics(),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId.startsWith('series:') || nodeId.startsWith('label-value:')) {
    const metric = nodeId.startsWith('series:') ? nodeId.replace('series:', '') : undefined
    return {
      ...base,
      objectView: 'series',
      series: prometheusSeries(metric),
      labels: prometheusLabels(),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId === 'prometheus:targets' || nodeId.startsWith('target:')) {
    return {
      ...base,
      objectView: 'targets',
      targets: prometheusTargets(),
      serviceDiscovery: prometheusServiceDiscovery(),
      diagnostics: prometheusDiagnostics(),
      warnings: prometheusTargets().some((target) => target.health !== 'up')
        ? ['One scrape target is down. Review last error before trusting missing series.']
        : [],
    }
  }

  if (nodeId === 'prometheus:rules' || nodeId.startsWith('rule-group:') || nodeId.startsWith('rule:')) {
    const [, groupName] = nodeId.split(':')
    return {
      ...base,
      objectView: 'rules',
      rules: prometheusRules().filter((rule) => !groupName || rule.group === groupName),
      alerts: prometheusAlerts(),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId === 'prometheus:alerts' || nodeId.startsWith('alert:')) {
    return {
      ...base,
      objectView: 'alerts',
      alerts: prometheusAlerts(),
      rules: prometheusRules().filter((rule) => rule.type === 'alerting'),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId === 'prometheus:service-discovery') {
    return {
      ...base,
      objectView: 'service-discovery',
      serviceDiscovery: prometheusServiceDiscovery(),
      targets: prometheusTargets(),
      diagnostics: prometheusDiagnostics(),
    }
  }

  if (nodeId === 'prometheus:tsdb' || nodeId === 'prometheus:storage') {
    return {
      ...base,
      objectView: 'tsdb',
      tsdb: prometheusTsdbStats(),
      storage: prometheusStorageBlocks(),
      diagnostics: prometheusDiagnostics(),
      warnings: ['High-cardinality labels can make broad series and label APIs expensive.'],
    }
  }

  return {
    ...base,
    objectView: 'diagnostics',
    metrics: prometheusMetrics(),
    targets: prometheusTargets(),
    rules: prometheusRules(),
    alerts: prometheusAlerts(),
    tsdb: prometheusTsdbStats(),
    storage: prometheusStorageBlocks(),
    diagnostics: prometheusDiagnostics(),
  }
}

function prometheusNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return {
    family: 'timeseries',
    ...node,
  }
}

function prometheusBasePayload(connection: ConnectionProfile) {
  return {
    engine: 'prometheus',
    endpoint: connection.connectionString || `${connection.host ?? 'localhost'}:${connection.port ?? 9090}`,
    metricCount: prometheusMetrics().length,
    seriesCount: 12840,
    sampleCount: '2.4 M',
    upTargets: prometheusTargets().filter((target) => target.health === 'up').length,
    downTargets: prometheusTargets().filter((target) => target.health !== 'up').length,
    ruleCount: prometheusRules().length,
    alertCount: prometheusAlerts().length,
    retention: '15 d',
  }
}

function prometheusMetrics() {
  return [
    { name: 'up', type: 'gauge', help: 'Whether the last scrape of a target succeeded.', series: 42, samples: '42/min', cardinality: 'low', labels: ['job', 'instance'] },
    { name: 'http_requests_total', type: 'counter', help: 'Total HTTP requests processed by application handlers.', series: 840, samples: '8.4k/min', cardinality: 'medium', labels: ['job', 'instance', 'method', 'route', 'status'] },
    { name: 'process_cpu_seconds_total', type: 'counter', help: 'Total user and system CPU time spent in seconds.', series: 42, samples: '42/min', cardinality: 'low', labels: ['job', 'instance'] },
    { name: 'prometheus_tsdb_head_series', type: 'gauge', help: 'Current number of series in the head block.', series: 1, samples: '1/min', cardinality: 'low', labels: ['instance'] },
  ]
}

function prometheusLabels() {
  return [
    { name: 'job', valueCount: 6, metricCount: 421, cardinality: 'low', risk: 'safe' },
    { name: 'instance', valueCount: 42, metricCount: 421, cardinality: 'medium', risk: 'watch' },
    { name: 'route', valueCount: 128, metricCount: 18, cardinality: 'high', risk: 'expensive' },
    { name: 'status', valueCount: 6, metricCount: 18, cardinality: 'low', risk: 'safe' },
  ]
}

function prometheusLabelValues(label: string) {
  const values: Record<string, Array<{ label: string; value: string; series: number; exampleMetric: string }>> = {
    job: [
      { label, value: 'api', series: 412, exampleMetric: 'http_requests_total' },
      { label, value: 'prometheus', series: 86, exampleMetric: 'prometheus_tsdb_head_series' },
      { label, value: 'node', series: 940, exampleMetric: 'up' },
    ],
    instance: [
      { label, value: 'api-1:9100', series: 320, exampleMetric: 'up' },
      { label, value: 'api-2:9100', series: 318, exampleMetric: 'http_requests_total' },
    ],
    route: [
      { label, value: '/api/query', series: 54, exampleMetric: 'http_requests_total' },
      { label, value: '/api/write', series: 47, exampleMetric: 'http_requests_total' },
    ],
  }

  return values[label] ?? [
    { label, value: 'default', series: 12, exampleMetric: 'up' },
  ]
}

function prometheusMetricLabels(metricName: string) {
  const metric = prometheusMetrics().find((item) => item.name === metricName)
  return prometheusLabels().filter((label) => metric?.labels.includes(label.name))
}

function prometheusSeries(metricName?: string) {
  const metric = metricName ?? 'up'
  return [
    { metric, labels: { job: 'api', instance: 'api-1:9100' }, lastSample: '1', sampleRate: '1/min', cardinality: 'low' },
    { metric, labels: { job: 'api', instance: 'api-2:9100' }, lastSample: metric === 'up' ? '0' : '248', sampleRate: '1/min', cardinality: 'low' },
    { metric, labels: { job: 'prometheus', instance: 'prometheus:9090' }, lastSample: '1', sampleRate: '1/min', cardinality: 'low' },
  ]
}

function prometheusTargets() {
  return [
    { job: 'api', instance: 'api-1:9100', health: 'up', lastScrape: '7s ago', scrapeDuration: '18 ms', lastError: '-' },
    { job: 'api', instance: 'api-2:9100', health: 'down', lastScrape: '18s ago', scrapeDuration: '30s', lastError: 'context deadline exceeded' },
    { job: 'prometheus', instance: 'prometheus:9090', health: 'up', lastScrape: '5s ago', scrapeDuration: '8 ms', lastError: '-' },
  ]
}

function prometheusRuleGroups() {
  return [
    { name: 'api.rules', rules: 4, health: 'ok', evaluationTime: '4 ms' },
    { name: 'platform.alerts', rules: 3, health: 'ok', evaluationTime: '9 ms' },
  ]
}

function prometheusRules() {
  return [
    { group: 'api.rules', name: 'job:http_requests:rate5m', type: 'recording', expression: 'sum by (job) (rate(http_requests_total[5m]))', health: 'ok', evaluationTime: '2 ms', lastError: '-' },
    { group: 'platform.alerts', name: 'InstanceDown', type: 'alerting', expression: 'up == 0', health: 'ok', evaluationTime: '4 ms', lastError: '-' },
    { group: 'platform.alerts', name: 'HighRouteCardinality', type: 'alerting', expression: 'count by (route) (http_requests_total) > 100', health: 'ok', evaluationTime: '5 ms', lastError: '-' },
  ]
}

function prometheusAlerts() {
  return [
    { name: 'InstanceDown', state: 'firing', severity: 'warning', activeAt: '2026-05-23T11:56:00Z', summary: 'api-2 scrape is failing' },
    { name: 'HighRouteCardinality', state: 'pending', severity: 'info', activeAt: '2026-05-23T12:04:00Z', summary: 'Route label cardinality is elevated' },
  ]
}

function prometheusServiceDiscovery() {
  return [
    { job: 'api', discovered: 4, active: 2, dropped: 2, lastSync: '22s ago' },
    { job: 'node', discovered: 12, active: 12, dropped: 0, lastSync: '19s ago' },
    { job: 'prometheus', discovered: 1, active: 1, dropped: 0, lastSync: '18s ago' },
  ]
}

function prometheusTsdbStats() {
  return [
    { name: 'Head Series', value: 12840, unit: 'series', status: 'watch' },
    { name: 'Head Chunks', value: 45620, unit: 'chunks', status: 'healthy' },
    { name: 'WAL Segments', value: 9, unit: 'files', status: 'healthy' },
    { name: 'Label Pairs', value: 1640, unit: 'pairs', status: 'watch' },
  ]
}

function prometheusStorageBlocks() {
  return [
    { block: '01HZYQ7Q6N', mint: '2026-05-23T08:00:00Z', maxt: '2026-05-23T10:00:00Z', samples: '1.2 M', series: 12840, size: '72 MB' },
    { block: '01HZYX3E2R', mint: '2026-05-23T10:00:00Z', maxt: '2026-05-23T12:00:00Z', samples: '1.1 M', series: 12690, size: '69 MB' },
  ]
}

function prometheusDiagnostics() {
  return [
    { signal: 'Scrape Health', value: '2 / 3 up', status: 'warning', guidance: 'Investigate down target api-2 before relying on absent series.' },
    { signal: 'Route Cardinality', value: '128 values', status: 'watch', guidance: 'Avoid broad route label aggregations without a time bound.' },
    { signal: 'Rule Evaluation', value: '9 ms max', status: 'healthy', guidance: 'Rule groups are evaluating within expected bounds.' },
  ]
}

function prometheusMetricDiagnostics(metricName: string) {
  return [
    { signal: 'Metric Cardinality', value: prometheusMetrics().find((metric) => metric.name === metricName)?.cardinality ?? 'unknown', status: metricName === 'http_requests_total' ? 'watch' : 'healthy', guidance: 'Use label matchers before range aggregations on high-cardinality metrics.' },
  ]
}

function createWarehouseExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const namespace = warehouseDefaultNamespace(connection)
  const namespaceRoot = warehouseNamespaceRoot(connection)

  if (!scope) {
    return [
      warehouseNode({ id: `warehouse:${namespaceRoot.kind}`, label: namespaceRoot.label, kind: namespaceRoot.kind, detail: namespaceRoot.detail, scope: `warehouse:${namespaceRoot.kind}`, expandable: true }),
      warehouseNode({ id: 'warehouse:tables', label: 'Tables', kind: 'tables', detail: 'Columnar tables and partitions', scope: 'warehouse:tables', expandable: true }),
      warehouseNode({ id: 'warehouse:views', label: 'Views', kind: 'views', detail: 'Saved analytical projections', scope: 'warehouse:views', expandable: true }),
      warehouseNode({ id: 'warehouse:warehouses', label: warehouseComputeLabel(connection), kind: 'warehouses', detail: warehouseComputeDetail(connection), scope: 'warehouse:warehouses', expandable: true }),
      warehouseNode({ id: 'warehouse:jobs', label: warehouseJobsLabel(connection), kind: 'jobs', detail: 'Query history, scheduled work, and load jobs', scope: 'warehouse:jobs', expandable: true }),
      warehouseNode({ id: 'warehouse:security', label: 'Security', kind: 'security', detail: warehouseSecurityDetail(connection), scope: 'warehouse:security' }),
      warehouseNode({ id: 'warehouse:diagnostics', label: 'Diagnostics', kind: 'diagnostics', detail: 'Cost, runtime, queueing, and storage health', scope: 'warehouse:diagnostics' }),
    ]
  }

  if (scope === 'warehouse:databases' || scope === 'warehouse:datasets') {
    return warehouseNamespaces(connection).map((item) =>
      warehouseNode({
        id: `${namespaceRoot.singleKind}:${item.name}`,
        label: item.name,
        kind: namespaceRoot.singleKind,
        detail: `${item.tables} tables | ${warehouseNamespaceLocation(item) ?? item.owner}`,
        path: [namespaceRoot.label],
        scope: `${namespaceRoot.singleKind}:${item.name}`,
        expandable: true,
      }),
    )
  }

  if (isWarehouseNamespaceScope(scope)) {
    return [
      warehouseNode({ id: `tables:${namespace}`, label: 'Tables', kind: 'tables', detail: 'Tables in this namespace', path: [namespace], scope: 'warehouse:tables', expandable: true }),
      warehouseNode({ id: `views:${namespace}`, label: 'Views', kind: 'views', detail: 'Views in this namespace', path: [namespace], scope: 'warehouse:views', expandable: true }),
      warehouseNode({ id: `materialized-views:${namespace}`, label: 'Materialized Views', kind: 'materialized-views', detail: 'Persisted analytical views', path: [namespace], scope: 'warehouse:materialized-views', expandable: true }),
      warehouseNode({ id: `stages:${namespace}`, label: warehouseStageLabel(connection), kind: 'stages', detail: 'Load and unload locations', path: [namespace], scope: 'warehouse:stages', expandable: true }),
      warehouseNode({ id: `jobs:${namespace}`, label: warehouseJobsLabel(connection), kind: 'jobs', detail: 'Recent jobs and scheduled work', path: [namespace], scope: 'warehouse:jobs', expandable: true }),
    ]
  }

  if (scope === 'warehouse:tables') {
    return warehouseTables(connection).map((table) =>
      warehouseNode({
        id: `table:${table.schema}:${table.name}`,
        label: table.name,
        kind: 'table',
        detail: `${table.rows} rows | ${table.size} | ${table.partitioning}`,
        path: [table.schema],
        scope: `table:${table.schema}:${table.name}`,
        queryTemplate: warehouseObjectQueryTemplate(connection, table.schema, table.name),
      }),
    )
  }

  if (scope === 'warehouse:views') {
    return warehouseViews().map((view) =>
      warehouseNode({
        id: `view:${view.schema}:${view.name}`,
        label: view.name,
        kind: 'view',
        detail: `${view.dependencies} dependencies | stale ${view.stale}`,
        path: [view.schema],
        scope: `view:${view.schema}:${view.name}`,
        queryTemplate: warehouseObjectQueryTemplate(connection, view.schema, view.name),
      }),
    )
  }

  if (scope === 'warehouse:materialized-views') {
    return warehouseMaterializedViews().map((view) =>
      warehouseNode({
        id: `materialized-view:${view.schema}:${view.name}`,
        label: view.name,
        kind: 'materialized-view',
        detail: `${view.refreshStatus} | ${view.size}`,
        path: [view.schema],
        scope: `materialized-view:${view.schema}:${view.name}`,
        queryTemplate: warehouseObjectQueryTemplate(connection, view.schema, view.name),
      }),
    )
  }

  if (scope === 'warehouse:stages') {
    return warehouseStages(connection).map((stage) =>
      warehouseNode({ id: `stage:${stage.name}`, label: stage.name, kind: 'stage', detail: `${stage.type} | ${stage.fileFormat}`, path: ['Stages'], scope: `stage:${stage.name}` }),
    )
  }

  if (scope === 'warehouse:warehouses') {
    return warehouseCompute(connection).map((item) =>
      warehouseNode({ id: `warehouse-compute:${item.name}`, label: item.name, kind: 'warehouse', detail: `${item.size} | ${item.state} | ${item.credits} credits`, path: [warehouseComputeLabel(connection)], scope: `warehouse-compute:${item.name}` }),
    )
  }

  if (scope === 'warehouse:jobs') {
    return warehouseJobs(connection).map((job) =>
      warehouseNode({ id: `job:${job.id}`, label: job.id, kind: 'job', detail: `${job.status} | ${job.duration} | ${job.bytesScanned}`, path: [warehouseJobsLabel(connection)], scope: `job:${job.id}` }),
    )
  }

  return []
}

function warehouseInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  if (nodeId.startsWith('table:') || nodeId.startsWith('view:') || nodeId.startsWith('materialized-view:')) {
    const [, schema = warehouseDefaultNamespace(connection), objectName = 'table_name'] = nodeId.split(':')
    return warehouseObjectQueryTemplate(connection, schema, objectName)
  }

  if (nodeId.startsWith('job:')) {
    return warehouseJobQueryTemplate(connection, nodeId.replace('job:', ''))
  }

  return warehouseDiagnosticsQueryTemplate(connection)
}

function warehouseInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const base = warehouseBasePayload(connection)

  if (nodeId === 'warehouse:databases' || nodeId === 'warehouse:datasets' || isWarehouseNamespaceScope(nodeId)) {
    return {
      ...base,
      objectView: connection.engine === 'bigquery' ? 'datasets' : 'databases',
      databases: connection.engine === 'bigquery' ? [] : warehouseNamespaces(connection),
      datasets: connection.engine === 'bigquery' ? warehouseNamespaces(connection) : [],
      tables: warehouseTables(connection),
      views: warehouseViews(),
      warehouses: warehouseCompute(connection),
      jobs: warehouseJobs(connection),
      diagnostics: warehouseDiagnostics(connection),
    }
  }

  if (nodeId === 'warehouse:tables' || nodeId.startsWith('table:')) {
    const table = nodeId.startsWith('table:') ? nodeId.split(':').at(-1) : undefined
    return {
      ...base,
      objectView: table ? 'table' : 'tables',
      tables: warehouseTables(connection).filter((row) => !table || row.name === table),
      columns: warehouseColumns(),
      security: warehouseSecurity(connection),
      diagnostics: warehouseDiagnostics(connection),
    }
  }

  if (nodeId === 'warehouse:views' || nodeId.startsWith('view:')) {
    const view = nodeId.startsWith('view:') ? nodeId.split(':').at(-1) : undefined
    return {
      ...base,
      objectView: view ? 'view' : 'views',
      views: warehouseViews().filter((row) => !view || row.name === view),
      columns: warehouseColumns(),
      security: warehouseSecurity(connection),
      diagnostics: warehouseDiagnostics(connection),
    }
  }

  if (nodeId === 'warehouse:materialized-views' || nodeId.startsWith('materialized-view:')) {
    const view = nodeId.startsWith('materialized-view:') ? nodeId.split(':').at(-1) : undefined
    return {
      ...base,
      objectView: view ? 'materialized-view' : 'materialized-views',
      materializedViews: warehouseMaterializedViews().filter((row) => !view || row.name === view),
      columns: warehouseColumns(),
      diagnostics: warehouseDiagnostics(connection),
    }
  }

  if (nodeId === 'warehouse:stages' || nodeId.startsWith('stage:')) {
    const stage = nodeId.startsWith('stage:') ? nodeId.replace('stage:', '') : undefined
    return { ...base, objectView: stage ? 'stage' : 'stages', stages: warehouseStages(connection).filter((row) => !stage || row.name === stage), jobs: warehouseJobs(connection), diagnostics: warehouseDiagnostics(connection) }
  }

  if (nodeId === 'warehouse:warehouses' || nodeId.startsWith('warehouse-compute:')) {
    const warehouse = nodeId.startsWith('warehouse-compute:') ? nodeId.replace('warehouse-compute:', '') : undefined
    return { ...base, objectView: warehouse ? 'warehouse' : 'warehouses', warehouses: warehouseCompute(connection).filter((row) => !warehouse || row.name === warehouse), jobs: warehouseJobs(connection), diagnostics: warehouseDiagnostics(connection) }
  }

  if (nodeId === 'warehouse:jobs' || nodeId.startsWith('job:')) {
    const job = nodeId.startsWith('job:') ? nodeId.replace('job:', '') : undefined
    return { ...base, objectView: job ? 'job' : 'jobs', jobs: warehouseJobs(connection).filter((row) => !job || row.id === job), diagnostics: warehouseDiagnostics(connection) }
  }

  if (nodeId === 'warehouse:security') {
    return {
      ...base,
      objectView: 'security',
      security: warehouseSecurity(connection),
      permissionWarnings: [{ scope: 'security', reason: 'Access metadata depends on the active warehouse role or IAM principal.' }],
    }
  }

  return { ...base, objectView: 'diagnostics', diagnostics: warehouseDiagnostics(connection), jobs: warehouseJobs(connection), warehouses: warehouseCompute(connection) }
}

function warehouseNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return { family: 'warehouse', ...node }
}

function warehouseNamespaceRoot(connection: ConnectionProfile) {
  return connection.engine === 'bigquery'
    ? { label: 'Datasets', kind: 'datasets', singleKind: 'dataset', detail: 'BigQuery datasets and access controls' }
    : { label: 'Databases', kind: 'databases', singleKind: 'database', detail: 'Warehouse database namespaces' }
}

function isWarehouseNamespaceScope(scope: string) {
  return scope.startsWith('database:') || scope.startsWith('dataset:')
}

function warehouseDefaultNamespace(connection: ConnectionProfile) {
  return connection.database?.trim() || (connection.engine === 'bigquery' ? 'analytics' : 'DATAPAD')
}

function warehouseComputeLabel(connection: ConnectionProfile) {
  return connection.engine === 'bigquery' ? 'Reservations' : connection.engine === 'clickhouse' ? 'Clusters' : 'Warehouses'
}

function warehouseComputeDetail(connection: ConnectionProfile) {
  return connection.engine === 'bigquery' ? 'Slots, reservations, and assignments' : connection.engine === 'clickhouse' ? 'Cluster nodes and shards' : 'Compute warehouses'
}

function warehouseJobsLabel(connection: ConnectionProfile) {
  return connection.engine === 'snowflake' ? 'Tasks & Query History' : 'Jobs'
}

function warehouseStageLabel(connection: ConnectionProfile) {
  return connection.engine === 'bigquery' ? 'External Tables' : 'Stages'
}

function warehouseSecurityDetail(connection: ConnectionProfile) {
  return connection.engine === 'bigquery' ? 'IAM bindings and dataset access' : 'Roles, grants, policies, and permissions'
}

function warehouseObjectQueryTemplate(connection: ConnectionProfile, schema: string, objectName: string) {
  const objectPath =
    connection.engine === 'bigquery'
      ? `\`${schema}.${objectName}\``
      : connection.engine === 'snowflake'
        ? `${quoteWarehouseIdentifier(schema)}.${quoteWarehouseIdentifier(objectName)}`
        : connection.engine === 'clickhouse'
          ? `\`${schema}\`.\`${objectName}\``
          : `${schema}.${objectName}`

  return `select * from ${objectPath} limit 100;`
}

function warehouseJobQueryTemplate(connection: ConnectionProfile, jobId: string) {
  if (connection.engine === 'bigquery') {
    return `select * from \`region-us\`.INFORMATION_SCHEMA.JOBS_BY_PROJECT where job_id = '${jobId}' limit 100;`
  }
  if (connection.engine === 'snowflake') {
    return `select * from table(information_schema.query_history()) where query_id = '${jobId}' limit 100;`
  }
  return `select * from system.query_log where query_id = '${jobId}' limit 100;`
}

function warehouseDiagnosticsQueryTemplate(connection: ConnectionProfile) {
  if (connection.engine === 'bigquery') {
    return 'select * from `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT order by creation_time desc limit 100;'
  }
  if (connection.engine === 'snowflake') {
    return 'select * from table(information_schema.query_history()) order by start_time desc limit 100;'
  }
  return 'select * from system.query_log order by event_time desc limit 100;'
}

function quoteWarehouseIdentifier(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`
}

function warehouseBasePayload(connection: ConnectionProfile) {
  return {
    engine: connection.engine,
    database: warehouseDefaultNamespace(connection),
    tableCount: warehouseTables(connection).length,
    viewCount: warehouseViews().length,
    jobCount: warehouseJobs(connection).length,
    failedJobCount: warehouseJobs(connection).filter((job) => job.status !== 'succeeded').length,
    bytesScanned: '1.8 TB',
    storageSize: '420 GB',
  }
}

function warehouseNamespaces(connection: ConnectionProfile) {
  const name = warehouseDefaultNamespace(connection)
  if (connection.engine === 'bigquery') {
    return [
      { name, location: 'US', tables: 4, views: 2, defaultTtl: 'none', owner: 'analytics-team' },
      { name: 'finance', location: 'EU', tables: 9, views: 3, defaultTtl: '90 days', owner: 'finance-ops' },
    ]
  }

  return [
    { name, schemas: 2, tables: 6, owner: 'ACCOUNTADMIN', retention: '1 day', region: connection.engine === 'snowflake' ? 'AWS us-east-1' : 'cluster-local' },
  ]
}

function warehouseNamespaceLocation(namespace: ReturnType<typeof warehouseNamespaces>[number]) {
  return 'location' in namespace ? namespace.location : namespace.region
}

function warehouseTables(connection: ConnectionProfile) {
  const schema = warehouseDefaultNamespace(connection)
  return [
    { name: 'orders', schema, rows: '12.4 M', size: '88 GB', partitioning: connection.engine === 'bigquery' ? 'DATE(order_date)' : 'order_date', clustering: 'customer_id, sku', freshness: '8 min ago' },
    { name: 'accounts', schema, rows: '84 K', size: '640 MB', partitioning: 'none', clustering: 'region', freshness: '12 min ago' },
    { name: 'products', schema, rows: '3.2 K', size: '42 MB', partitioning: 'none', clustering: 'category', freshness: '1 h ago' },
  ]
}

function warehouseViews() {
  return [
    { name: 'daily_revenue', schema: 'analytics', owner: 'analytics-team', dependencies: 'orders, products', stale: 'no' },
    { name: 'active_accounts', schema: 'analytics', owner: 'analytics-team', dependencies: 'accounts', stale: 'no' },
  ]
}

function warehouseMaterializedViews() {
  return [
    { name: 'revenue_by_sku_mv', schema: 'analytics', refreshStatus: 'fresh', lastRefresh: '15 min ago', size: '2.4 GB' },
  ]
}

function warehouseColumns() {
  return [
    { name: 'id', type: 'STRING', mode: 'required', nullable: 'no', description: 'Stable business key' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'nullable', nullable: 'yes', description: 'Event creation time' },
    { name: 'amount', type: 'NUMERIC', mode: 'nullable', nullable: 'yes', description: 'Order or revenue amount' },
  ]
}

function warehouseStages(connection: ConnectionProfile) {
  if (connection.engine === 'bigquery') {
    return [{ name: 'external_sales_csv', type: 'external table', url: 'gs://datapad-samples/sales', fileFormat: 'CSV', encryption: 'Google-managed', owner: 'analytics-team' }]
  }
  return [
    { name: 'raw_import_stage', type: 'external', url: 's3://datapad-samples/raw', fileFormat: 'CSV', encryption: 'SSE-KMS', owner: 'loader' },
    { name: 'export_stage', type: 'internal', url: '@export_stage', fileFormat: 'PARQUET', encryption: 'managed', owner: 'analytics-team' },
  ]
}

function warehouseCompute(connection: ConnectionProfile) {
  if (connection.engine === 'bigquery') {
    return [{ name: 'default-reservation', size: '500 slots', state: 'active', queued: 0, running: 3, credits: 'slot-based' }]
  }
  if (connection.engine === 'clickhouse') {
    return [{ name: 'default-cluster', size: '3 shards', state: 'healthy', queued: 0, running: 5, credits: 'n/a' }]
  }
  return [
    { name: 'ANALYTICS_XS', size: 'X-Small', state: 'running', queued: 0, running: 4, credits: '0.24' },
    { name: 'LOAD_WH', size: 'Small', state: 'suspended', queued: 0, running: 0, credits: '0.00' },
  ]
}

function warehouseJobs(connection: ConnectionProfile) {
  const suffix = connection.engine === 'bigquery' ? 'bq' : connection.engine === 'snowflake' ? 'sf' : 'ch'
  return [
    { id: `${suffix}-job-1001`, type: 'query', status: 'succeeded', duration: '1.8s', bytesScanned: '128 MB', cost: connection.engine === 'bigquery' ? '$0.001' : 'low' },
    { id: `${suffix}-job-1002`, type: 'load', status: 'succeeded', duration: '12s', bytesScanned: '3.4 GB', cost: 'medium' },
    { id: `${suffix}-job-1003`, type: 'query', status: 'failed', duration: '480 ms', bytesScanned: '0 B', cost: 'none' },
  ]
}

function warehouseSecurity(connection: ConnectionProfile) {
  if (connection.engine === 'bigquery') {
    return [
      { principal: 'group:analytics@example.com', role: 'roles/bigquery.dataViewer', privilege: 'read', object: warehouseDefaultNamespace(connection), effect: 'allow' },
      { principal: 'serviceAccount:loader@example.com', role: 'roles/bigquery.jobUser', privilege: 'jobs.create', object: 'project', effect: 'allow' },
    ]
  }

  return [
    { principal: 'ANALYST_ROLE', role: 'reader', privilege: 'SELECT', object: warehouseDefaultNamespace(connection), effect: 'allow' },
    { principal: 'LOAD_ROLE', role: 'loader', privilege: 'INSERT', object: 'raw_import_stage', effect: 'guarded' },
  ]
}

function warehouseDiagnostics(connection: ConnectionProfile) {
  return [
    { signal: 'Broad Scan Risk', value: 'watch', status: 'watch', guidance: 'Dry-run broad queries before executing them against large warehouse tables.' },
    { signal: connection.engine === 'bigquery' ? 'Slot Pressure' : 'Queue Pressure', value: 'low', status: 'healthy', guidance: 'No simulated queue pressure detected.' },
    { signal: 'Failed Jobs', value: warehouseJobs(connection).filter((job) => job.status === 'failed').length, status: 'watch', guidance: 'Review recent failures before scheduling dependent work.' },
  ]
}

function createGraphExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const graphName = graphDefaultName(connection)

  if (!scope) {
    return [
      graphNode({ id: 'graph:graphs', label: graphRootLabel(connection), kind: 'graphs', detail: 'Graph databases and named graph scopes', scope: 'graph:graphs', expandable: true }),
      graphNode({ id: 'graph:node-labels', label: 'Node Labels', kind: 'node-labels', detail: 'Node categories and counts', scope: 'graph:node-labels', expandable: true }),
      graphNode({ id: 'graph:relationship-types', label: 'Relationship Types', kind: 'relationship-types', detail: 'Edge types and direction', scope: 'graph:relationship-types', expandable: true }),
      graphNode({ id: 'graph:property-keys', label: 'Property Keys', kind: 'property-keys', detail: 'Graph property metadata', scope: 'graph:property-keys', expandable: true }),
      graphNode({ id: 'graph:indexes', label: 'Indexes', kind: 'indexes', detail: 'Graph schema indexes', scope: 'graph:indexes', expandable: true }),
      graphNode({ id: 'graph:constraints', label: 'Constraints', kind: 'constraints', detail: 'Uniqueness and existence constraints', scope: 'graph:constraints', expandable: true }),
      graphNode({ id: 'graph:procedures', label: graphProceduresLabel(connection), kind: 'procedures', detail: graphProceduresDetail(connection), scope: 'graph:procedures' }),
      graphNode({ id: 'graph:security', label: 'Security', kind: 'security', detail: 'Roles, privileges, IAM, or users', scope: 'graph:security' }),
      graphNode({ id: 'graph:diagnostics', label: 'Diagnostics', kind: 'diagnostics', detail: 'Query, transaction, storage, and schema health', scope: 'graph:diagnostics' }),
    ]
  }

  if (scope === 'graph:graphs') {
    return graphGraphs(connection).map((graph) =>
      graphNode({
        id: `graph:${graph.name}`,
        label: graph.name,
        kind: 'graph',
        detail: `${graph.nodes} nodes | ${graph.relationships} relationships`,
        path: [graphRootLabel(connection)],
        scope: `graph:${graph.name}`,
        expandable: true,
        queryTemplate: graphQueryTemplate(connection, graph.name),
      }),
    )
  }

  if (isGraphDatabaseScope(scope)) {
    return [
      graphNode({ id: `node-labels:${graphName}`, label: 'Node Labels', kind: 'node-labels', detail: 'Labels in this graph', path: [graphRootLabel(connection), graphName], scope: 'graph:node-labels', expandable: true }),
      graphNode({ id: `relationships:${graphName}`, label: 'Relationship Types', kind: 'relationship-types', detail: 'Relationship types in this graph', path: [graphRootLabel(connection), graphName], scope: 'graph:relationship-types', expandable: true }),
      graphNode({ id: `indexes:${graphName}`, label: 'Indexes', kind: 'indexes', detail: 'Schema indexes', path: [graphRootLabel(connection), graphName], scope: 'graph:indexes', expandable: true }),
      graphNode({ id: `constraints:${graphName}`, label: 'Constraints', kind: 'constraints', detail: 'Schema constraints', path: [graphRootLabel(connection), graphName], scope: 'graph:constraints', expandable: true }),
    ]
  }

  if (scope === 'graph:node-labels') {
    return graphNodeLabels(connection).map((label) =>
      graphNode({
        id: `node-label:${label.label}`,
        label: label.label,
        kind: 'node-label',
        detail: `${label.count} nodes | ${label.properties} properties`,
        path: ['Node Labels'],
        scope: `node-label:${label.label}`,
        expandable: true,
        queryTemplate: graphNodeLabelQueryTemplate(connection, label.label),
      }),
    )
  }

  if (scope.startsWith('node-label:')) {
    const label = scope.replace('node-label:', '')
    return [
      graphNode({ id: `properties:${label}`, label: 'Properties', kind: 'property-keys', detail: 'Properties found on this label', path: ['Node Labels', label], scope: `property-keys:${label}`, expandable: true }),
      graphNode({ id: `relationships:${label}`, label: 'Relationships', kind: 'relationship-types', detail: 'Relationship types connected to this label', path: ['Node Labels', label], scope: 'graph:relationship-types', expandable: true }),
    ]
  }

  if (scope === 'graph:relationship-types') {
    return graphRelationships(connection).map((relationship) =>
      graphNode({
        id: `relationship:${relationship.type}`,
        label: relationship.type,
        kind: 'relationship',
        detail: `${relationship.count} relationships | ${relationship.from} -> ${relationship.to}`,
        path: ['Relationship Types'],
        scope: `relationship:${relationship.type}`,
        queryTemplate: graphRelationshipQueryTemplate(connection, relationship.type),
      }),
    )
  }

  if (scope === 'graph:property-keys' || scope.startsWith('property-keys:')) {
    return graphPropertyKeys().map((property) =>
      graphNode({ id: `property-key:${property.name}`, label: property.name, kind: 'property-key', detail: `${property.types} | indexed: ${property.indexed}`, path: ['Property Keys'], scope: `property-key:${property.name}` }),
    )
  }

  if (scope === 'graph:indexes') {
    return graphIndexes().map((index) =>
      graphNode({ id: `index:${index.name}`, label: index.name, kind: 'index', detail: `${index.type} | ${index.state}`, path: ['Indexes'], scope: `index:${index.name}` }),
    )
  }

  if (scope === 'graph:constraints') {
    return graphConstraints().map((constraint) =>
      graphNode({ id: `constraint:${constraint.name}`, label: constraint.name, kind: 'constraint', detail: `${constraint.type} | ${constraint.state}`, path: ['Constraints'], scope: `constraint:${constraint.name}` }),
    )
  }

  return []
}

function graphInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  if (nodeId.startsWith('node-label:')) {
    return graphNodeLabelQueryTemplate(connection, nodeId.replace('node-label:', ''))
  }
  if (nodeId.startsWith('relationship:')) {
    return graphRelationshipQueryTemplate(connection, nodeId.replace('relationship:', ''))
  }
  return graphQueryTemplate(connection, graphDefaultName(connection))
}

function graphInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const base = graphBasePayload(connection)

  if (nodeId === 'graph:graphs' || isGraphDatabaseScope(nodeId)) {
    const graphName = isGraphDatabaseScope(nodeId) ? nodeId.replace('graph:', '') : undefined
    return {
      ...base,
      objectView: graphName ? 'graph' : 'graphs',
      graphs: graphGraphs(connection).filter((graph) => !graphName || graph.name === graphName),
      nodeLabels: graphNodeLabels(connection),
      relationshipTypes: graphRelationships(connection),
      indexes: graphIndexes(),
      constraints: graphConstraints(),
      diagnostics: graphDiagnostics(connection),
    }
  }

  if (nodeId === 'graph:node-labels' || nodeId.startsWith('node-label:')) {
    const label = nodeId.startsWith('node-label:') ? nodeId.replace('node-label:', '') : undefined
    return {
      ...base,
      objectView: label ? 'node-label' : 'node-labels',
      nodeLabels: graphNodeLabels(connection).filter((row) => !label || row.label === label),
      propertyKeys: graphPropertyKeys().filter((property) => !label || property.labels.includes(label)),
      relationshipTypes: graphRelationships(connection).filter((relationship) => !label || relationship.from === label || relationship.to === label),
      indexes: graphIndexes().filter((index) => !label || index.target.includes(label)),
      constraints: graphConstraints().filter((constraint) => !label || constraint.target.includes(label)),
      diagnostics: graphDiagnostics(connection),
    }
  }

  if (nodeId === 'graph:relationship-types' || nodeId.startsWith('relationship:')) {
    const type = nodeId.startsWith('relationship:') ? nodeId.replace('relationship:', '') : undefined
    return {
      ...base,
      objectView: type ? 'relationship' : 'relationship-types',
      relationshipTypes: graphRelationships(connection).filter((row) => !type || row.type === type),
      propertyKeys: graphPropertyKeys().filter((property) => !type || property.relationshipTypes.includes(type)),
      diagnostics: graphDiagnostics(connection),
    }
  }

  if (nodeId === 'graph:property-keys' || nodeId.startsWith('property-key:') || nodeId.startsWith('property-keys:')) {
    const property = nodeId.startsWith('property-key:') ? nodeId.replace('property-key:', '') : undefined
    return {
      ...base,
      objectView: property ? 'property-key' : 'property-keys',
      propertyKeys: graphPropertyKeys().filter((row) => !property || row.name === property),
      nodeLabels: graphNodeLabels(connection),
      relationshipTypes: graphRelationships(connection),
      indexes: graphIndexes().filter((index) => !property || index.properties.includes(property)),
    }
  }

  if (nodeId === 'graph:indexes' || nodeId.startsWith('index:')) {
    const index = nodeId.startsWith('index:') ? nodeId.replace('index:', '') : undefined
    return { ...base, objectView: index ? 'index' : 'indexes', indexes: graphIndexes().filter((row) => !index || row.name === index), diagnostics: graphDiagnostics(connection), warnings: ['Graph schema changes should be previewed before execution.'] }
  }

  if (nodeId === 'graph:constraints' || nodeId.startsWith('constraint:')) {
    const constraint = nodeId.startsWith('constraint:') ? nodeId.replace('constraint:', '') : undefined
    return { ...base, objectView: constraint ? 'constraint' : 'constraints', constraints: graphConstraints().filter((row) => !constraint || row.name === constraint), diagnostics: graphDiagnostics(connection), warnings: ['Constraint changes can scan existing graph data and should be previewed before execution.'] }
  }

  if (nodeId === 'graph:procedures') {
    return { ...base, objectView: 'procedures', procedures: graphProcedures(connection), diagnostics: graphDiagnostics(connection) }
  }

  if (nodeId === 'graph:security') {
    return {
      ...base,
      objectView: 'security',
      security: graphSecurity(connection),
      permissionWarnings: [{ scope: 'security', reason: 'Security metadata depends on graph engine permissions.' }],
    }
  }

  return { ...base, objectView: 'diagnostics', procedures: graphProcedures(connection), diagnostics: graphDiagnostics(connection) }
}

function graphNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return { family: 'graph', ...node }
}

const GRAPH_SECTION_SCOPES = new Set([
  'graph:graphs',
  'graph:node-labels',
  'graph:relationship-types',
  'graph:property-keys',
  'graph:indexes',
  'graph:constraints',
  'graph:procedures',
  'graph:security',
  'graph:diagnostics',
])

function isGraphDatabaseScope(scope: string) {
  return scope.startsWith('graph:') && !GRAPH_SECTION_SCOPES.has(scope)
}

function graphRootLabel(connection: ConnectionProfile) {
  return connection.engine === 'arango' ? 'Graphs' : 'Databases'
}

function graphDefaultName(connection: ConnectionProfile) {
  return connection.database || (connection.engine === 'neo4j' ? 'neo4j' : connection.name)
}

function graphProceduresLabel(connection: ConnectionProfile) {
  if (connection.engine === 'arango') return 'Services'
  if (connection.engine === 'neptune') return 'Loader Jobs'
  return 'Procedures'
}

function graphProceduresDetail(connection: ConnectionProfile) {
  if (connection.engine === 'arango') return 'Foxx services and graph helpers'
  if (connection.engine === 'neptune') return 'Bulk loader jobs and query status'
  return 'Procedures, algorithms, and signatures'
}

function graphQueryTemplate(connection: ConnectionProfile, graphName: string) {
  if (connection.engine === 'arango') return `FOR vertex IN ${graphName}\n  LIMIT 25\n  RETURN vertex`
  if (connection.engine === 'neptune' || connection.engine === 'janusgraph') return 'g.V().limit(25)'
  return 'MATCH (n) RETURN n LIMIT 25'
}

function graphNodeLabelQueryTemplate(connection: ConnectionProfile, label: string) {
  if (connection.engine === 'arango') return `FOR doc IN ${label}\n  LIMIT 25\n  RETURN doc`
  if (connection.engine === 'neptune' || connection.engine === 'janusgraph') return `g.V().hasLabel('${label}').limit(25)`
  return `MATCH (n:\`${label}\`) RETURN n LIMIT 25`
}

function graphRelationshipQueryTemplate(connection: ConnectionProfile, relationship: string) {
  if (connection.engine === 'arango') return `FOR edge IN ${relationship}\n  LIMIT 25\n  RETURN edge`
  if (connection.engine === 'neptune' || connection.engine === 'janusgraph') return `g.E().hasLabel('${relationship}').limit(25)`
  return `MATCH ()-[r:\`${relationship}\`]->() RETURN r LIMIT 25`
}

function graphBasePayload(connection: ConnectionProfile) {
  return {
    engine: connection.engine,
    graphName: graphDefaultName(connection),
    nodeCount: 18420,
    relationshipCount: 39210,
    labelCount: graphNodeLabels(connection).length,
    relationshipTypeCount: graphRelationships(connection).length,
    indexCount: graphIndexes().length,
    constraintCount: graphConstraints().length,
  }
}

function graphGraphs(connection: ConnectionProfile) {
  const database = graphDefaultName(connection)
  return [{ name: database, database, nodes: 18420, relationships: 39210, labels: graphNodeLabels(connection).length, relationshipTypes: graphRelationships(connection).length }]
}

function graphNodeLabels(connection: ConnectionProfile) {
  const productLabel = connection.engine === 'arango' ? 'products' : 'Product'
  return [
    { label: 'Account', count: 2800, properties: 7, indexedProperties: 'id, email', constraints: 'account_id_unique' },
    { label: 'Order', count: 12400, properties: 9, indexedProperties: 'id, createdAt', constraints: 'order_id_unique' },
    { label: productLabel, count: 3220, properties: 6, indexedProperties: 'sku', constraints: 'product_sku_unique' },
  ]
}

function graphRelationships(connection: ConnectionProfile) {
  const productLabel = connection.engine === 'arango' ? 'products' : 'Product'
  return [
    { type: 'PLACED', count: 12400, from: 'Account', to: 'Order', properties: 'createdAt, channel' },
    { type: 'CONTAINS', count: 28650, from: 'Order', to: productLabel, properties: 'quantity, price' },
    { type: 'RELATED_TO', count: 810, from: productLabel, to: productLabel, properties: 'score' },
  ]
}

function graphPropertyKeys() {
  return [
    { name: 'id', types: 'string', labels: ['Account', 'Order'], relationshipTypes: [], indexed: 'yes' },
    { name: 'email', types: 'string', labels: ['Account'], relationshipTypes: [], indexed: 'yes' },
    { name: 'createdAt', types: 'datetime', labels: ['Order'], relationshipTypes: ['PLACED'], indexed: 'yes' },
    { name: 'sku', types: 'string', labels: ['Product', 'products'], relationshipTypes: [], indexed: 'yes' },
    { name: 'score', types: 'float', labels: [], relationshipTypes: ['RELATED_TO'], indexed: 'no' },
  ]
}

function graphIndexes() {
  return [
    { name: 'account_email_lookup', type: 'range', target: 'Account', properties: 'email', state: 'online', provider: 'native-btree' },
    { name: 'order_created_at_lookup', type: 'range', target: 'Order', properties: 'createdAt', state: 'online', provider: 'native-btree' },
    { name: 'product_sku_lookup', type: 'range', target: 'Product', properties: 'sku', state: 'online', provider: 'native-btree' },
  ]
}

function graphConstraints() {
  return [
    { name: 'account_id_unique', type: 'unique', target: 'Account', properties: 'id', state: 'online' },
    { name: 'order_id_unique', type: 'unique', target: 'Order', properties: 'id', state: 'online' },
    { name: 'product_sku_unique', type: 'unique', target: 'Product', properties: 'sku', state: 'online' },
  ]
}

function graphProcedures(connection: ConnectionProfile) {
  if (connection.engine === 'neptune') {
    return [{ name: 'loader.status', mode: 'read', signature: 'GET /loader/{loadId}', description: 'Review bulk loader job status.', requiresAdmin: 'no' }]
  }
  if (connection.engine === 'arango') {
    return [{ name: 'foxx.list', mode: 'read', signature: 'GET /_api/foxx', description: 'List installed Foxx services.', requiresAdmin: 'yes' }]
  }
  return [
    { name: 'db.schema.nodeTypeProperties', mode: 'read', signature: '() :: label, propertyName, propertyTypes', description: 'Inspect node property types.', requiresAdmin: 'no' },
    { name: 'db.indexes', mode: 'read', signature: '() :: name, type, labelsOrTypes, properties', description: 'Inspect schema indexes.', requiresAdmin: 'no' },
  ]
}

function graphSecurity(connection: ConnectionProfile) {
  if (connection.engine === 'neptune') {
    return [{ principal: 'iam-role/datapad-readonly', role: 'IAM', privilege: 'read', scope: 'cluster', effect: 'allow' }]
  }
  return [
    { principal: 'reader', role: 'reader', privilege: 'MATCH', scope: graphDefaultName(connection), effect: 'allow' },
    { principal: 'publisher', role: 'publisher', privilege: 'WRITE', scope: graphDefaultName(connection), effect: 'guarded' },
  ]
}

function graphDiagnostics(connection: ConnectionProfile) {
  return [
    { signal: 'Label Scan Risk', value: 'medium', status: 'watch', guidance: 'Prefer indexed predicates before broad traversals.' },
    { signal: 'Index Coverage', value: `${graphIndexes().length} online`, status: 'healthy', guidance: 'Primary lookup paths are indexed.' },
    { signal: connection.engine === 'neo4j' ? 'Transaction Pool' : 'Query Runtime', value: 'healthy', status: 'healthy', guidance: 'No simulated runtime pressure detected.' },
  ]
}

function createOpenTsdbExplorerNodes(scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      openTsdbNode({
        id: 'opentsdb:metrics',
        label: 'Metrics',
        kind: 'metrics',
        detail: 'Metric names and tag coverage',
        scope: 'opentsdb:metrics',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:tags',
        label: 'Tags',
        kind: 'tags',
        detail: 'Tag keys and values',
        scope: 'opentsdb:tags',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:aggregators',
        label: 'Aggregators',
        kind: 'aggregators',
        detail: 'Supported aggregation functions',
        scope: 'opentsdb:aggregators',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:downsampling',
        label: 'Downsampling',
        kind: 'downsampling',
        detail: 'Downsample windows and fill policies',
        scope: 'opentsdb:downsampling',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:uid-metadata',
        label: 'UID Metadata',
        kind: 'uid-metadata',
        detail: 'Metric and tag metadata records',
        scope: 'opentsdb:uid-metadata',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:trees',
        label: 'Trees',
        kind: 'trees',
        detail: 'Tree rules and hierarchy health',
        scope: 'opentsdb:trees',
        expandable: true,
      }),
      openTsdbNode({
        id: 'opentsdb:stats',
        label: 'Stats',
        kind: 'stats',
        detail: 'Runtime counters and storage signals',
        scope: 'opentsdb:stats',
      }),
      openTsdbNode({
        id: 'opentsdb:diagnostics',
        label: 'Diagnostics',
        kind: 'diagnostics',
        detail: 'Backend health and query risk',
        scope: 'opentsdb:diagnostics',
      }),
    ]
  }

  if (scope === 'opentsdb:metrics') {
    return openTsdbMetrics().map((metric) =>
      openTsdbNode({
        id: `metric:${metric.name}`,
        label: metric.name,
        kind: 'metric',
        detail: `${metric.tags} tag(s) | ${metric.cardinality} cardinality`,
        path: ['Metrics'],
        scope: `metric:${metric.name}`,
        expandable: true,
        queryTemplate: openTsdbMetricQuery(metric.name),
      }),
    )
  }

  if (scope.startsWith('metric:')) {
    const metric = scope.replace('metric:', '')
    return [
      openTsdbNode({
        id: `metric-tags:${metric}`,
        label: 'Tags',
        kind: 'tags',
        detail: 'Tag keys used by this metric',
        path: ['Metrics', metric],
        scope: `metric-tags:${metric}`,
        expandable: true,
      }),
      openTsdbNode({
        id: `metric-uid:${metric}`,
        label: 'UID Metadata',
        kind: 'uid-metadata',
        detail: 'Metric UID and description',
        path: ['Metrics', metric],
        scope: `metric-uid:${metric}`,
      }),
      openTsdbNode({
        id: `metric-stats:${metric}`,
        label: 'Stats',
        kind: 'stats',
        detail: 'Recent write and query shape',
        path: ['Metrics', metric],
        scope: `metric-stats:${metric}`,
      }),
    ]
  }

  if (scope === 'opentsdb:tags' || scope.startsWith('metric-tags:')) {
    const metric = scope.startsWith('metric-tags:') ? scope.replace('metric-tags:', '') : undefined
    return openTsdbTags(metric).map((tag) =>
      openTsdbNode({
        id: `tag:${tag.name}`,
        label: tag.name,
        kind: 'tag',
        detail: `${tag.valueCount} values | ${tag.risk}`,
        path: metric ? ['Metrics', metric, 'Tags'] : ['Tags'],
        scope: `tag:${tag.name}`,
        expandable: true,
      }),
    )
  }

  if (scope.startsWith('tag:')) {
    const tag = scope.replace('tag:', '')
    return openTsdbTagValues(tag).map((value) =>
      openTsdbNode({
        id: `tag-value:${tag}:${value.value}`,
        label: String(value.value),
        kind: 'tag',
        detail: `${value.series} series | ${value.exampleMetric}`,
        path: ['Tags', tag],
        scope: `tag:${tag}`,
      }),
    )
  }

  if (scope === 'opentsdb:aggregators') {
    return openTsdbAggregators().map((aggregator) =>
      openTsdbNode({
        id: `aggregator:${aggregator.name}`,
        label: aggregator.name,
        kind: 'aggregator',
        detail: aggregator.bestFor,
        path: ['Aggregators'],
        scope: `aggregator:${aggregator.name}`,
      }),
    )
  }

  if (scope === 'opentsdb:downsampling') {
    return openTsdbDownsampling().map((downsampler) =>
      openTsdbNode({
        id: `downsampler:${downsampler.expression}`,
        label: downsampler.expression,
        kind: 'downsampler',
        detail: downsampler.bestFor,
        path: ['Downsampling'],
        scope: `downsampler:${downsampler.expression}`,
      }),
    )
  }

  if (scope === 'opentsdb:uid-metadata') {
    return openTsdbUidMetadata().map((uid) =>
      openTsdbNode({
        id: `uid:${uid.kind}:${uid.name}`,
        label: uid.name,
        kind: 'uid',
        detail: `${uid.kind} | ${uid.uid}`,
        path: ['UID Metadata'],
        scope: `uid:${uid.kind}:${uid.name}`,
      }),
    )
  }

  if (scope === 'opentsdb:trees') {
    return openTsdbTrees().map((tree) =>
      openTsdbNode({
        id: `tree:${tree.name}`,
        label: tree.name,
        kind: 'tree',
        detail: tree.enabled ? `${tree.rules} rule(s)` : 'disabled',
        path: ['Trees'],
        scope: `tree:${tree.name}`,
      }),
    )
  }

  return []
}

function openTsdbInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('metric:')) {
    return openTsdbMetricQuery(nodeId.replace('metric:', ''))
  }

  return openTsdbMetricQuery('sys.cpu.user')
}

function openTsdbInspectPayload(nodeId: string) {
  const base = openTsdbBasePayload()

  if (nodeId === 'opentsdb:metrics') {
    return {
      ...base,
      objectView: 'metrics',
      metrics: openTsdbMetrics(),
      tags: openTsdbTags(),
      diagnostics: openTsdbDiagnostics(),
    }
  }

  if (nodeId.startsWith('metric:')) {
    const metric = nodeId.replace('metric:', '')
    return {
      ...base,
      objectView: 'metric',
      metric,
      metrics: openTsdbMetrics().filter((item) => item.name === metric),
      tags: openTsdbTags(metric),
      uidMetadata: openTsdbUidMetadata().filter((uid) => uid.name === metric || uid.kind === 'metric'),
      stats: openTsdbStats().filter((stat) => stat.name.includes('query') || stat.name.includes('write')),
      diagnostics: openTsdbMetricDiagnostics(metric),
    }
  }

  if (nodeId === 'opentsdb:tags' || nodeId.startsWith('tag:') || nodeId.startsWith('metric-tags:')) {
    const tag = nodeId.startsWith('tag:') ? nodeId.split(':')[1] : undefined
    return {
      ...base,
      objectView: tag ? 'tag' : 'tags',
      tags: openTsdbTags().filter((item) => !tag || item.name === tag),
      tagValues: tag ? openTsdbTagValues(tag) : openTsdbTagValues('host'),
      metrics: openTsdbMetrics(),
      diagnostics: openTsdbDiagnostics(),
    }
  }

  if (nodeId === 'opentsdb:aggregators' || nodeId.startsWith('aggregator:')) {
    const aggregator = nodeId.startsWith('aggregator:') ? nodeId.replace('aggregator:', '') : undefined
    return {
      ...base,
      objectView: aggregator ? 'aggregator' : 'aggregators',
      aggregators: openTsdbAggregators().filter((item) => !aggregator || item.name === aggregator),
      diagnostics: openTsdbDiagnostics(),
    }
  }

  if (nodeId === 'opentsdb:downsampling' || nodeId.startsWith('downsampler:')) {
    const expression = nodeId.startsWith('downsampler:') ? nodeId.replace('downsampler:', '') : undefined
    return {
      ...base,
      objectView: expression ? 'downsampler' : 'downsampling',
      downsampling: openTsdbDownsampling().filter((item) => !expression || item.expression === expression),
      aggregators: openTsdbAggregators(),
      diagnostics: openTsdbDiagnostics(),
    }
  }

  if (nodeId === 'opentsdb:uid-metadata' || nodeId.startsWith('uid:') || nodeId.startsWith('metric-uid:')) {
    const [, kind, name] = nodeId.split(':')
    return {
      ...base,
      objectView: name ? 'uid' : 'uid-metadata',
      uidMetadata: openTsdbUidMetadata().filter((uid) => !name || (uid.kind === kind && uid.name === name)),
      metrics: openTsdbMetrics(),
      tags: openTsdbTags(),
      diagnostics: openTsdbDiagnostics(),
    }
  }

  if (nodeId === 'opentsdb:trees' || nodeId.startsWith('tree:')) {
    const tree = nodeId.startsWith('tree:') ? nodeId.replace('tree:', '') : undefined
    return {
      ...base,
      objectView: tree ? 'tree' : 'trees',
      trees: openTsdbTrees().filter((item) => !tree || item.name === tree),
      diagnostics: openTsdbDiagnostics(),
      warnings: ['Tree changes are metadata operations and should be previewed before execution.'],
    }
  }

  return {
    ...base,
    objectView: nodeId === 'opentsdb:stats' ? 'stats' : 'diagnostics',
    stats: openTsdbStats(),
    diagnostics: openTsdbDiagnostics(),
  }
}

function openTsdbNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return {
    family: 'timeseries',
    ...node,
  }
}

function openTsdbMetricQuery(metric: string) {
  return JSON.stringify(
    {
      start: '1h-ago',
      queries: [
        {
          metric,
          aggregator: 'avg',
          downsample: '1m-avg',
          tags: {},
        },
      ],
    },
    null,
    2,
  )
}

function openTsdbBasePayload() {
  return {
    engine: 'opentsdb',
    version: '2.x compatible',
    metricCount: openTsdbMetrics().length,
    tagKeyCount: openTsdbTags().length,
    uidCount: openTsdbUidMetadata().length,
    writesPerSecond: '4.8k/s',
    queriesPerSecond: '12/s',
    storage: 'HBase',
  }
}

function openTsdbMetrics() {
  return [
    { name: 'sys.cpu.user', tags: 3, lastWrite: '8s ago', pointsPerMinute: '42k', cardinality: 'medium', uid: '000001' },
    { name: 'http.requests', tags: 5, lastWrite: '12s ago', pointsPerMinute: '18k', cardinality: 'high', uid: '000002' },
    { name: 'jvm.memory.used', tags: 4, lastWrite: '15s ago', pointsPerMinute: '6k', cardinality: 'low', uid: '000003' },
  ]
}

function openTsdbTags(metric?: string) {
  const rows = [
    { name: 'host', valueCount: 42, metricCount: 3, cardinality: 'medium', risk: 'watch' },
    { name: 'region', valueCount: 3, metricCount: 3, cardinality: 'low', risk: 'safe' },
    { name: 'endpoint', valueCount: 128, metricCount: 1, cardinality: 'high', risk: 'expensive' },
    { name: 'pool', valueCount: 6, metricCount: 1, cardinality: 'low', risk: 'safe' },
  ]

  if (metric === 'http.requests') {
    return rows.filter((tag) => ['host', 'region', 'endpoint'].includes(tag.name))
  }

  if (metric === 'jvm.memory.used') {
    return rows.filter((tag) => ['host', 'region', 'pool'].includes(tag.name))
  }

  return rows.filter((tag) => tag.name !== 'pool')
}

function openTsdbTagValues(tag: string) {
  const values: Record<string, Array<Record<string, string | number>>> = {
    host: [
      { tag, value: 'api-1', metrics: 3, series: 120, exampleMetric: 'sys.cpu.user' },
      { tag, value: 'api-2', metrics: 3, series: 118, exampleMetric: 'http.requests' },
    ],
    region: [
      { tag, value: 'us-east', metrics: 3, series: 184, exampleMetric: 'sys.cpu.user' },
      { tag, value: 'eu-west', metrics: 3, series: 168, exampleMetric: 'jvm.memory.used' },
    ],
    endpoint: [
      { tag, value: '/catalog', metrics: 1, series: 44, exampleMetric: 'http.requests' },
      { tag, value: '/checkout', metrics: 1, series: 37, exampleMetric: 'http.requests' },
    ],
  }

  return values[tag] ?? [
    { tag, value: 'default', metrics: 1, series: 1, exampleMetric: 'sys.cpu.user' },
  ]
}

function openTsdbAggregators() {
  return [
    { name: 'avg', description: 'Average values across matching series.', interpolation: 'linear', bestFor: 'CPU, latency, and rate averages' },
    { name: 'sum', description: 'Sum values across matching series.', interpolation: 'linear', bestFor: 'Counters and total throughput' },
    { name: 'max', description: 'Maximum value across matching series.', interpolation: 'linear', bestFor: 'Peak usage and saturation checks' },
    { name: 'min', description: 'Minimum value across matching series.', interpolation: 'linear', bestFor: 'Floor or availability checks' },
  ]
}

function openTsdbDownsampling() {
  return [
    { expression: '1m-avg', interval: '1 minute', aggregator: 'avg', fillPolicy: 'none', bestFor: 'Interactive charts' },
    { expression: '5m-sum', interval: '5 minutes', aggregator: 'sum', fillPolicy: 'none', bestFor: 'Traffic rollups' },
    { expression: '1h-max', interval: '1 hour', aggregator: 'max', fillPolicy: 'nan', bestFor: 'Long-range saturation review' },
  ]
}

function openTsdbUidMetadata() {
  return [
    { kind: 'metric', name: 'sys.cpu.user', uid: '000001', displayName: 'CPU User Time', description: 'CPU time spent in user space.', notes: 'Safe for dashboard rollups.' },
    { kind: 'metric', name: 'http.requests', uid: '000002', displayName: 'HTTP Requests', description: 'Request count by endpoint.', notes: 'High endpoint cardinality.' },
    { kind: 'tagk', name: 'host', uid: '000010', displayName: 'Host', description: 'Source host name.', notes: 'Required for most queries.' },
    { kind: 'tagk', name: 'region', uid: '000011', displayName: 'Region', description: 'Deployment region.', notes: 'Low cardinality.' },
  ]
}

function openTsdbTrees() {
  return [
    { name: 'service-latency', enabled: true, rules: 4, collisions: 0, description: 'Groups request metrics by service and endpoint.' },
    { name: 'host-inventory', enabled: true, rules: 3, collisions: 1, description: 'Groups host metrics by region and role.' },
  ]
}

function openTsdbStats() {
  return [
    { name: 'tsd.rpc.received', value: '12/s', unit: 'requests', status: 'healthy' },
    { name: 'tsd.http.query.latency_95pct', value: '84 ms', unit: 'latency', status: 'healthy' },
    { name: 'tsd.uid.cache-hit-rate', value: '99.2%', unit: 'ratio', status: 'healthy' },
    { name: 'hbase.flushQueueLength', value: '0', unit: 'items', status: 'healthy' },
  ]
}

function openTsdbDiagnostics() {
  return [
    { signal: 'Endpoint Cardinality', value: '128 values', status: 'watch', guidance: 'Use endpoint filters and downsampling before long-range queries.' },
    { signal: 'UID Cache', value: '99.2%', status: 'healthy', guidance: 'UID cache hit rate is healthy.' },
    { signal: 'Storage Queue', value: '0', status: 'healthy', guidance: 'No HBase write queue pressure detected.' },
  ]
}

function openTsdbMetricDiagnostics(metric: string) {
  return [
    {
      signal: 'Metric Cardinality',
      value: openTsdbMetrics().find((item) => item.name === metric)?.cardinality ?? 'unknown',
      status: metric === 'http.requests' ? 'watch' : 'healthy',
      guidance: 'Prefer explicit tag filters and downsampling for long time ranges.',
    },
  ]
}

function createInfluxExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const defaultBucket = influxDefaultBucket(connection)

  if (!scope) {
    return [
      influxNode({
        id: 'influx:buckets',
        label: 'Buckets',
        kind: 'buckets',
        detail: 'Buckets, databases, and retention scopes',
        scope: 'influx:buckets',
        expandable: true,
      }),
      influxNode({
        id: 'influx:tasks',
        label: 'Tasks',
        kind: 'tasks',
        detail: 'Scheduled Flux tasks',
        scope: 'influx:tasks',
        expandable: true,
      }),
      influxNode({
        id: 'influx:security',
        label: 'Tokens',
        kind: 'security',
        detail: 'Authorizations and bucket scopes',
        scope: 'influx:security',
      }),
      influxNode({
        id: 'influx:diagnostics',
        label: 'Diagnostics',
        kind: 'diagnostics',
        detail: 'Cardinality, storage, and query health',
        scope: 'influx:diagnostics',
      }),
    ]
  }

  if (scope === 'influx:buckets') {
    return influxBuckets(defaultBucket).map((bucket) =>
      influxNode({
        id: `bucket:${bucket.name}`,
        label: bucket.name,
        kind: 'bucket',
        detail: `${bucket.retention} | ${bucket.series} series`,
        path: ['Buckets'],
        scope: `bucket:${bucket.name}`,
        expandable: true,
      }),
    )
  }

  if (scope.startsWith('bucket:')) {
    const bucket = scope.replace('bucket:', '')
    return [
      influxNode({
        id: `measurements:${bucket}`,
        label: 'Measurements',
        kind: 'measurements',
        detail: 'Measurement schema',
        path: ['Buckets', bucket],
        scope: `measurements:${bucket}`,
        expandable: true,
      }),
      influxNode({
        id: `tags:${bucket}`,
        label: 'Tags',
        kind: 'tags',
        detail: 'Indexed dimensions',
        path: ['Buckets', bucket],
        scope: `tags:${bucket}`,
        expandable: true,
      }),
      influxNode({
        id: `fields:${bucket}`,
        label: 'Fields',
        kind: 'fields',
        detail: 'Value fields',
        path: ['Buckets', bucket],
        scope: `fields:${bucket}`,
        expandable: true,
      }),
      influxNode({
        id: `retention:${bucket}`,
        label: 'Retention Policies',
        kind: 'retention-policies',
        detail: 'Retention and shard groups',
        path: ['Buckets', bucket],
        scope: `retention:${bucket}`,
      }),
    ]
  }

  if (scope.startsWith('measurements:')) {
    const bucket = scope.replace('measurements:', '')
    return influxMeasurements(bucket).map((measurement) =>
      influxNode({
        id: `measurement:${bucket}:${measurement.name}`,
        label: measurement.name,
        kind: 'measurement',
        detail: `${measurement.series} series | ${measurement.lastWrite}`,
        path: ['Buckets', bucket, 'Measurements'],
        scope: `measurement:${bucket}:${measurement.name}`,
        expandable: true,
        queryTemplate: influxMeasurementQuery(bucket, measurement.name),
      }),
    )
  }

  if (scope.startsWith('measurement:')) {
    const [, bucket = defaultBucket, measurement = 'measurement'] = scope.split(':')
    return [
      influxNode({
        id: `tags:${bucket}:${measurement}`,
        label: 'Tags',
        kind: 'tags',
        detail: 'Tag keys used by this measurement',
        path: ['Buckets', bucket, 'Measurements', measurement],
        scope: `tags:${bucket}:${measurement}`,
      }),
      influxNode({
        id: `fields:${bucket}:${measurement}`,
        label: 'Fields',
        kind: 'fields',
        detail: 'Fields used by this measurement',
        path: ['Buckets', bucket, 'Measurements', measurement],
        scope: `fields:${bucket}:${measurement}`,
      }),
    ]
  }

  if (scope.startsWith('tags:')) {
    const [, bucket = defaultBucket] = scope.split(':')
    return influxTags(bucket).map((tag) =>
      influxNode({
        id: `tag:${bucket}:${tag.name}`,
        label: tag.name,
        kind: 'tag',
        detail: `${tag.valueCount} value(s) | ${tag.risk}`,
        path: ['Buckets', bucket, 'Tags'],
        scope: `tag:${bucket}:${tag.name}`,
        expandable: true,
      }),
    )
  }

  if (scope.startsWith('fields:')) {
    const [, bucket = defaultBucket] = scope.split(':')
    return influxFields(bucket).map((field) =>
      influxNode({
        id: `field:${bucket}:${field.name}`,
        label: field.name,
        kind: 'field',
        detail: `${field.type} | ${field.unit}`,
        path: ['Buckets', bucket, 'Fields'],
        scope: `field:${bucket}:${field.name}`,
      }),
    )
  }

  if (scope === 'influx:tasks') {
    return influxTasks().map((task) =>
      influxNode({
        id: `task:${task.name}`,
        label: task.name,
        kind: 'task',
        detail: `${task.status} | ${task.schedule}`,
        path: ['Tasks'],
        scope: `task:${task.name}`,
      }),
    )
  }

  return []
}

function influxInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  if (nodeId.startsWith('measurement:')) {
    const [, bucket = influxDefaultBucket(connection), measurement = 'measurement'] = nodeId.split(':')
    return influxMeasurementQuery(bucket, measurement)
  }

  if (nodeId.startsWith('field:')) {
    const [, bucket = influxDefaultBucket(connection), field = 'value'] = nodeId.split(':')
    return `from(bucket: "${bucket}")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._field == "${field}")`
  }

  return `from(bucket: "${influxDefaultBucket(connection)}")\n  |> range(start: -1h)\n  |> limit(n: 100)`
}

function influxInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const bucket = influxBucketFromNodeId(connection, nodeId)
  const base = influxBasePayload(bucket)

  if (nodeId === 'influx:buckets') {
    return {
      ...base,
      objectView: 'buckets',
      buckets: influxBuckets(bucket),
      diagnostics: influxDiagnostics(),
    }
  }

  if (nodeId.startsWith('bucket:')) {
    return influxBucketPayload(nodeId.replace('bucket:', '') || bucket)
  }

  if (nodeId.startsWith('measurement:')) {
    const [, bucketName = bucket, measurement = 'cpu'] = nodeId.split(':')
    return {
      ...influxBucketPayload(bucketName),
      objectView: 'measurement',
      measurement,
      measurements: influxMeasurements(bucketName).filter((item) => item.name === measurement),
      tags: influxTags(bucketName),
      fields: influxFields(bucketName),
      diagnostics: influxMeasurementDiagnostics(measurement),
    }
  }

  if (nodeId.startsWith('measurements:')) {
    return {
      ...base,
      objectView: 'measurements',
      measurements: influxMeasurements(bucket),
      tags: influxTags(bucket),
      fields: influxFields(bucket),
      diagnostics: influxDiagnostics(),
    }
  }

  if (nodeId.startsWith('tags:') || nodeId.startsWith('tag:')) {
    const tagName = nodeId.startsWith('tag:') ? nodeId.split(':')[2] : undefined
    return {
      ...base,
      objectView: tagName ? 'tag' : 'tags',
      tags: influxTags(bucket).filter((tag) => !tagName || tag.name === tagName),
      tagValues: tagName ? influxTagValues(tagName) : influxTagValues('host'),
      measurements: influxMeasurements(bucket),
      diagnostics: influxDiagnostics(),
    }
  }

  if (nodeId.startsWith('fields:') || nodeId.startsWith('field:')) {
    const fieldName = nodeId.startsWith('field:') ? nodeId.split(':')[2] : undefined
    return {
      ...base,
      objectView: fieldName ? 'field' : 'fields',
      fields: influxFields(bucket).filter((field) => !fieldName || field.name === fieldName),
      measurements: influxMeasurements(bucket),
      diagnostics: influxDiagnostics(),
    }
  }

  if (nodeId.startsWith('retention:')) {
    return {
      ...base,
      objectView: 'retention-policies',
      buckets: influxBuckets(bucket).filter((item) => item.name === bucket),
      retentionPolicies: influxRetentionPolicies(bucket),
      diagnostics: influxDiagnostics(),
      warnings: ['Retention changes are admin operations and should be previewed before execution.'],
    }
  }

  if (nodeId === 'influx:tasks' || nodeId.startsWith('task:')) {
    const taskName = nodeId.startsWith('task:') ? nodeId.replace('task:', '') : undefined
    return {
      ...base,
      objectView: taskName ? 'task' : 'tasks',
      tasks: influxTasks().filter((task) => !taskName || task.name === taskName),
      diagnostics: influxDiagnostics(),
    }
  }

  if (nodeId === 'influx:security') {
    return {
      ...base,
      objectView: 'security',
      tokens: influxTokens(),
      diagnostics: influxDiagnostics(),
      permissionWarnings: [
        { scope: 'tokens', reason: 'Token values are write-only and never displayed after creation.' },
      ],
    }
  }

  return {
    ...base,
    objectView: 'diagnostics',
    buckets: influxBuckets(bucket),
    measurements: influxMeasurements(bucket),
    tasks: influxTasks(),
    retentionPolicies: influxRetentionPolicies(bucket),
    diagnostics: influxDiagnostics(),
  }
}

function influxBucketPayload(bucket: string) {
  return {
    ...influxBasePayload(bucket),
    objectView: 'bucket',
    buckets: influxBuckets(bucket).filter((item) => item.name === bucket),
    measurements: influxMeasurements(bucket),
    tags: influxTags(bucket),
    fields: influxFields(bucket),
    retentionPolicies: influxRetentionPolicies(bucket),
    tasks: influxTasks(),
    diagnostics: influxDiagnostics(),
  }
}

function influxNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return {
    family: 'timeseries',
    ...node,
  }
}

function influxDefaultBucket(connection: ConnectionProfile) {
  return connection.database || 'telemetry'
}

function influxBucketFromNodeId(connection: ConnectionProfile, nodeId: string) {
  const parts = nodeId.split(':')
  if (parts[0] === 'bucket' || parts[0] === 'measurement' || parts[0] === 'measurements' || parts[0] === 'tags' || parts[0] === 'tag' || parts[0] === 'fields' || parts[0] === 'field' || parts[0] === 'retention') {
    return parts[1] || influxDefaultBucket(connection)
  }

  return influxDefaultBucket(connection)
}

function influxBasePayload(bucket: string) {
  return {
    engine: 'influxdb',
    version: '2.x compatible',
    bucket,
    measurementCount: influxMeasurements(bucket).length,
    seriesCount: 18420,
    retention: '30 d',
    storage: '1.8 GB',
    taskCount: influxTasks().length,
  }
}

function influxBuckets(defaultBucket: string) {
  return [
    { name: defaultBucket, org: 'datapad', retention: '30 d', measurements: 3, series: 18420, storage: '1.8 GB' },
    { name: 'system', org: 'datapad', retention: '7 d', measurements: 5, series: 820, storage: '210 MB' },
  ]
}

function influxMeasurements(bucket: string) {
  return [
    { name: 'cpu', bucket, tagCount: 3, fieldCount: 2, series: 8400, lastWrite: '12s ago' },
    { name: 'memory', bucket, tagCount: 3, fieldCount: 3, series: 6210, lastWrite: '12s ago' },
    { name: 'http_requests', bucket, tagCount: 5, fieldCount: 2, series: 3810, lastWrite: '18s ago' },
  ]
}

function influxTags(bucket: string) {
  void bucket
  return [
    { name: 'host', valueCount: 42, series: 18420, cardinality: 'medium', risk: 'watch' },
    { name: 'region', valueCount: 3, series: 18420, cardinality: 'low', risk: 'safe' },
    { name: 'route', valueCount: 128, series: 3810, cardinality: 'high', risk: 'expensive' },
  ]
}

function influxTagValues(tag: string) {
  return [
    { tag, value: tag === 'region' ? 'eu-west-1' : 'api-1', series: 420, measurement: 'cpu' },
    { tag, value: tag === 'region' ? 'us-east-1' : 'api-2', series: 390, measurement: 'memory' },
  ]
}

function influxFields(bucket: string) {
  void bucket
  return [
    { name: 'usage_user', type: 'float', unit: '%', measurements: 'cpu', lastValue: '27.4' },
    { name: 'usage_system', type: 'float', unit: '%', measurements: 'cpu', lastValue: '8.2' },
    { name: 'request_count', type: 'integer', unit: 'count', measurements: 'http_requests', lastValue: '248' },
  ]
}

function influxRetentionPolicies(bucket: string) {
  return [
    { name: `${bucket}/default`, duration: '30 d', shardGroupDuration: '1 d', replication: 1, status: 'active' },
  ]
}

function influxTasks() {
  return [
    { name: 'downsample_cpu_5m', status: 'active', schedule: 'every 5m', lastRun: '2m ago', lastError: '-' },
    { name: 'rollup_http_hourly', status: 'paused', schedule: 'every 1h', lastRun: '3h ago', lastError: 'token scope missing write permission' },
  ]
}

function influxTokens() {
  return [
    { name: 'read-telemetry', scopes: ['read:orgs', 'read:buckets/telemetry'], status: 'active', expiresAt: 'never' },
    { name: 'task-runner', scopes: ['read:buckets/telemetry', 'write:buckets/telemetry'], status: 'active', expiresAt: '2026-12-31' },
  ]
}

function influxDiagnostics() {
  return [
    { signal: 'Series Cardinality', value: '18.4 K', status: 'watch', guidance: 'Filter by host or region before broad field scans.' },
    { signal: 'Task Failures', value: '1 paused', status: 'warning', guidance: 'Review task token scopes before enabling the task.' },
    { signal: 'Retention', value: '30 d', status: 'healthy', guidance: 'Retention matches the QA workspace expectation.' },
  ]
}

function influxMeasurementDiagnostics(measurement: string) {
  return [
    { signal: 'Measurement Cardinality', value: measurement === 'http_requests' ? 'high' : 'medium', status: measurement === 'http_requests' ? 'watch' : 'healthy', guidance: 'Prefer tag filters and bounded ranges in chart queries.' },
  ]
}

function influxMeasurementQuery(bucket: string, measurement: string) {
  return `from(bucket: "${bucket}")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "${measurement}")`
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
  const table = cassandraTables().find((candidate) => candidate.name === tableName) ?? cassandraTables()[0]!
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

function cassandraQueryTemplate(keyspace: string, tableName: string) {
  return `select * from "${keyspace}"."${tableName}" where ${cassandraPartitionKeyForTable(tableName)} = ? limit 20;`
}

function parseCassandraTableScope(scope: string, fallbackKeyspace: string) {
  const value = scope.replace('table:', '')
  const [keyspaceAndMaybeTable, maybeTable] = value.split('.')

  return maybeTable
    ? { keyspace: keyspaceAndMaybeTable || fallbackKeyspace, table: maybeTable }
    : { keyspace: fallbackKeyspace, table: value || 'orders_by_customer' }
}

function cassandraTableNameFromNodeId(connection: ConnectionProfile, nodeId: string) {
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

function cassandraObjectViewFromNodeId(nodeId: string) {
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

function cassandraKeyspace(connection: ConnectionProfile) {
  return connection.database || 'app'
}

function cassandraSectionLabel(section: string) {
  return section
    .split('-')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ')
}

function cassandraTables() {
  return [
    { name: 'orders_by_customer', partitionKey: 'customer_id', clusteringKey: 'order_day, order_id', rows: 125000, partitions: 8400, sstables: 12, indexes: 1, p95ReadMs: 6, tombstoneWarnings: 0, readPath: 'single partition' },
    { name: 'products_by_sku', partitionKey: 'sku', clusteringKey: '-', rows: 100000, partitions: 100000, sstables: 8, indexes: 1, p95ReadMs: 4, tombstoneWarnings: 1, readPath: 'point lookup' },
  ]
}

function cassandraColumns(tableName: string) {
  return tableName === 'products_by_sku'
    ? [
        { name: 'sku', role: 'partition key', type: 'text', clusteringOrder: '-' },
        { name: 'name', role: 'regular', type: 'text', clusteringOrder: '-' },
        { name: 'inventory', role: 'regular', type: 'map<text,int>', clusteringOrder: '-' },
        { name: 'updated_at', role: 'regular', type: 'timestamp', clusteringOrder: '-' },
      ]
    : [
        { name: 'customer_id', role: 'partition key', type: 'uuid', clusteringOrder: '-' },
        { name: 'order_day', role: 'clustering', type: 'date', clusteringOrder: 'DESC' },
        { name: 'order_id', role: 'clustering', type: 'timeuuid', clusteringOrder: 'DESC' },
        { name: 'status', role: 'regular', type: 'text', clusteringOrder: '-' },
        { name: 'total', role: 'regular', type: 'decimal', clusteringOrder: '-' },
      ]
}

function cassandraPrimaryKey(tableName: string) {
  return cassandraColumns(tableName)
    .filter((column) => column.role.includes('key') || column.role === 'clustering')
    .map((column, index) => ({ role: column.role, name: column.name, position: index + 1, type: column.type }))
}

function cassandraIndexes() {
  return [
    { name: 'orders_status_sai', table: 'orders_by_customer', kind: 'SAI', target: 'status', options: 'case_sensitive=false' },
    { name: 'products_name_idx', table: 'products_by_sku', kind: 'secondary', target: 'name', options: 'default analyzer' },
  ]
}

function cassandraTableOptions(tableName: string) {
  return [
    { option: 'compaction', value: tableName === 'orders_by_customer' ? 'TimeWindowCompactionStrategy' : 'SizeTieredCompactionStrategy', guidance: 'Match compaction to write/read and TTL patterns.' },
    { option: 'compression', value: 'LZ4Compressor', guidance: 'Default lightweight block compression.' },
    { option: 'bloom_filter_fp_chance', value: 0.01, guidance: 'Lower values use more memory and reduce false positives.' },
    { option: 'gc_grace_seconds', value: 864000, guidance: 'Review before lowering in replicated clusters.' },
  ]
}

function cassandraTableDiagnostics(tableName: string) {
  return [
    { signal: 'Read latency p95', value: tableName === 'orders_by_customer' ? '6 ms' : '4 ms', status: 'Healthy', guidance: 'Bounded partition reads look healthy.' },
    { signal: 'Estimated partition size', value: tableName === 'orders_by_customer' ? '14 KB' : '2 KB', status: 'Healthy', guidance: 'No oversized partition warning in preview.' },
    { signal: 'Tombstones per read', value: tableName === 'products_by_sku' ? 120 : 4, status: tableName === 'products_by_sku' ? 'Watch' : 'Healthy', guidance: 'High tombstone reads can slow queries.' },
  ]
}

function cassandraPermissions(keyspace: string) {
  return [
    { role: 'app_reader', resource: `keyspace/${keyspace}`, permission: 'SELECT' },
    { role: 'app_writer', resource: `keyspace/${keyspace}/orders_by_customer`, permission: 'SELECT, MODIFY' },
    { role: 'admin_preview', resource: `keyspace/${keyspace}`, permission: 'ALTER requires confirmation' },
  ]
}

function cassandraPartitionKeyForTable(tableName: string) {
  return tableName === 'products_by_sku' ? 'sku' : 'customer_id'
}

function createSearchExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const engineLabel = connection.engine === 'opensearch' ? 'OpenSearch' : 'Elasticsearch'

  if (!scope) {
    return [
      searchNode(connection, 'search:cluster', 'Cluster', 'cluster', `${engineLabel} health, nodes, and allocation`, 'search:cluster', [], true),
      searchNode(connection, 'search:indices', 'Indices', 'indices', 'Searchable indices and lifecycle state', 'search:indices', [], true),
      searchNode(connection, 'search:data-streams', 'Data Streams', 'data-streams', 'Append-oriented data streams', 'search:data-streams', [], true),
      searchNode(connection, 'search:aliases', 'Aliases', 'aliases', 'Read/write aliases and routing', 'search:aliases', [], true),
      searchNode(connection, 'search:templates', 'Templates', 'templates', 'Index and component templates', 'search:templates', [], true),
      searchNode(connection, 'search:pipelines', 'Pipelines', 'pipelines', 'Ingest pipelines and processors', 'search:pipelines', [], true),
      searchNode(connection, 'search:security', 'Security', 'security', 'Users, roles, API keys, and privileges', 'search:security', [], true),
      searchNode(connection, 'search:diagnostics', 'Diagnostics', 'diagnostics', 'Shards, segments, tasks, snapshots, and lifecycle', 'search:diagnostics', [], true),
    ]
  }

  if (scope === 'search:cluster') {
    return [
      searchNode(connection, 'search:cluster:health', 'Health', 'health', 'Cluster health and shard allocation', undefined, ['Cluster']),
      searchNode(connection, 'search:cluster:nodes', 'Nodes', 'nodes', 'Node roles, heap, disk, and CPU', undefined, ['Cluster']),
      searchNode(connection, 'search:cluster:allocation', 'Shard Allocation', 'shards', 'Shard routing and node placement', undefined, ['Cluster']),
    ]
  }

  if (scope === 'search:indices') {
    return searchIndices(connection).map((index) =>
      searchNode(
        connection,
        `index:${index.name}`,
        index.name,
        'index',
        `${index.health} / ${index.documents.toLocaleString()} docs / ${index.storage}`,
        `index:${index.name}`,
        ['Indices'],
        true,
        searchQueryTemplate(index.name),
      ),
    )
  }

  if (scope.startsWith('index:')) {
    const index = scope.replace('index:', '') || 'products-v1'
    return [
      searchNode(connection, `documents:${index}`, 'Documents', 'documents', 'Bounded Query DSL search', undefined, ['Indices', index], false, searchQueryTemplate(index)),
      searchNode(connection, `mapping:${index}`, 'Mappings', 'mappings', 'Fields, analyzers, and doc values', undefined, ['Indices', index]),
      searchNode(connection, `settings:${index}`, 'Settings', 'settings', 'Shard, refresh, lifecycle, and analyzer settings', undefined, ['Indices', index]),
      searchNode(connection, `aliases:${index}`, 'Aliases', 'aliases', 'Aliases targeting this index', undefined, ['Indices', index]),
      searchNode(connection, `shards:${index}`, 'Shards', 'shards', 'Shard placement and state', undefined, ['Indices', index]),
      searchNode(connection, `segments:${index}`, 'Segments', 'segments', 'Lucene segment health', undefined, ['Indices', index]),
    ]
  }

  if (scope === 'search:data-streams') {
    return searchDataStreams().map((stream) =>
      searchNode(
        connection,
        `data-stream:${stream.name}`,
        stream.name,
        'data-stream',
        `${stream.status} / generation ${stream.generation} / ${stream.documents.toLocaleString()} docs`,
        `data-stream:${stream.name}`,
        ['Data Streams'],
        true,
        searchQueryTemplate(stream.name),
      ),
    )
  }

  if (scope.startsWith('data-stream:')) {
    const stream = scope.replace('data-stream:', '') || 'logs-generic-default'
    return [
      searchNode(connection, `documents:${stream}`, 'Documents', 'documents', 'Bounded Query DSL search', undefined, ['Data Streams', stream], false, searchQueryTemplate(stream)),
      searchNode(connection, `backing-indices:${stream}`, 'Backing Indices', 'backing-indices', 'Concrete backing indices', undefined, ['Data Streams', stream]),
      searchNode(connection, `lifecycle:${stream}`, 'Lifecycle', 'lifecycle-policies', 'ILM or ISM policy state', undefined, ['Data Streams', stream]),
      searchNode(connection, `stream-stats:${stream}`, 'Statistics', 'statistics', 'Document and storage counters', undefined, ['Data Streams', stream]),
    ]
  }

  if (scope === 'search:aliases') {
    return searchAliases().map((alias) =>
      searchNode(connection, `alias:${alias.name}`, alias.name, 'alias', `${alias.indices} / write ${alias.writeIndex}`, undefined, ['Aliases'], false, searchQueryTemplate(alias.name)),
    )
  }

  if (scope === 'search:templates') {
    return [
      searchNode(connection, 'search:templates:index', 'Index Templates', 'templates', 'Composable index templates', 'search:templates:index', ['Templates'], true),
      searchNode(connection, 'search:templates:component', 'Component Templates', 'templates', 'Reusable template components', 'search:templates:component', ['Templates'], true),
    ]
  }

  if (scope === 'search:templates:index') {
    return searchTemplates().filter((template) => template.type === 'index').map((template) =>
      searchNode(connection, `index-template:${template.name}`, template.name, 'index-template', `${template.patterns} / priority ${template.priority}`, undefined, ['Templates', 'Index Templates']),
    )
  }

  if (scope === 'search:templates:component') {
    return searchTemplates().filter((template) => template.type === 'component').map((template) =>
      searchNode(connection, `component-template:${template.name}`, template.name, 'component-template', template.components || 'Reusable settings and mappings', undefined, ['Templates', 'Component Templates']),
    )
  }

  if (scope === 'search:pipelines') {
    return searchPipelines().map((pipeline) =>
      searchNode(connection, `pipeline:${pipeline.name}`, pipeline.name, 'pipeline', `${pipeline.processors} processor(s)`, undefined, ['Pipelines']),
    )
  }

  if (scope === 'search:security') {
    return [
      searchNode(connection, 'search:security:users', 'Users', 'users', 'Visible users and realms', undefined, ['Security']),
      searchNode(connection, 'search:security:roles', 'Roles', 'roles', 'Cluster and index privileges', undefined, ['Security']),
      searchNode(connection, 'search:security:api-keys', 'API Keys', 'api-keys', 'API keys and expiry state', undefined, ['Security']),
    ]
  }

  if (scope === 'search:diagnostics') {
    return [
      searchNode(connection, 'search:diagnostics:shards', 'Shards', 'shards', 'Shard routing and state', undefined, ['Diagnostics']),
      searchNode(connection, 'search:diagnostics:segments', 'Segments', 'segments', 'Segment counts and deleted docs', undefined, ['Diagnostics']),
      searchNode(connection, 'search:diagnostics:tasks', 'Tasks', 'tasks', 'Active task list', undefined, ['Diagnostics']),
      searchNode(connection, 'search:diagnostics:snapshots', 'Snapshots', 'snapshots', 'Snapshot repositories and states', undefined, ['Diagnostics']),
      searchNode(connection, 'search:diagnostics:lifecycle', 'Lifecycle Policies', 'lifecycle-policies', 'ILM or ISM policy status', undefined, ['Diagnostics']),
    ]
  }

  return []
}

function searchNode(
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
    family: 'search',
    label,
    kind,
    detail,
    scope,
    path,
    queryTemplate,
    expandable,
  }
}

function searchInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('index:')) {
    return searchQueryTemplate(nodeId.replace('index:', '') || 'products-v1')
  }

  if (nodeId.startsWith('data-stream:')) {
    return searchQueryTemplate(nodeId.replace('data-stream:', '') || 'logs-generic-default')
  }

  if (nodeId.startsWith('documents:')) {
    return searchQueryTemplate(nodeId.replace('documents:', '') || 'products-v1')
  }

  if (nodeId.startsWith('mapping:')) {
    return JSON.stringify({ method: 'GET', path: `/${nodeId.replace('mapping:', '')}/_mapping` }, null, 2)
  }

  if (nodeId.startsWith('settings:')) {
    return JSON.stringify({ method: 'GET', path: `/${nodeId.replace('settings:', '')}/_settings` }, null, 2)
  }

  if (nodeId.includes('diagnostics') || nodeId.includes('cluster')) {
    return JSON.stringify({ method: 'GET', path: '/_cluster/health' }, null, 2)
  }

  return JSON.stringify({ method: 'GET', path: '/_cat/indices?format=json' }, null, 2)
}

function searchInspectPayload(connection: ConnectionProfile, nodeId: string) {
  if (nodeId === 'search:cluster' || nodeId.startsWith('search:cluster')) {
    return searchClusterPayload(connection)
  }

  if (nodeId === 'search:indices') {
    return {
      ...searchClusterPayload(connection),
      objectView: 'indices',
      indices: searchIndices(connection),
      dataStreams: [],
      nodes: [],
      shards: [],
      statistics: [],
    }
  }

  if (nodeId.startsWith('index:')) {
    return searchIndexPayload(connection, nodeId.replace('index:', '') || 'products-v1')
  }

  if (nodeId.startsWith('documents:')) {
    return {
      ...searchIndexPayload(connection, nodeId.replace('documents:', '') || 'products-v1'),
      objectView: 'documents',
    }
  }

  if (nodeId.startsWith('mapping:')) {
    return {
      ...searchIndexPayload(connection, nodeId.replace('mapping:', '') || 'products-v1'),
      objectView: 'mappings',
      indices: [],
      aliases: [],
      shards: [],
      segments: [],
      settings: [],
      statistics: [],
    }
  }

  if (nodeId.startsWith('settings:')) {
    return {
      ...searchIndexPayload(connection, nodeId.replace('settings:', '') || 'products-v1'),
      objectView: 'settings',
      indices: [],
      fields: [],
      aliases: [],
      shards: [],
      segments: [],
      statistics: [],
    }
  }

  if (nodeId === 'search:data-streams') {
    return {
      ...searchClusterPayload(connection),
      objectView: 'data-streams',
      dataStreams: searchDataStreams(),
      indices: [],
      nodes: [],
      shards: [],
      statistics: [],
    }
  }

  if (nodeId.startsWith('data-stream:')) {
    return searchDataStreamPayload(connection, nodeId.replace('data-stream:', '') || 'logs-generic-default')
  }

  if (nodeId === 'search:aliases' || nodeId.startsWith('alias:') || nodeId.startsWith('aliases:')) {
    return {
      engine: connection.engine,
      clusterName: searchClusterName(connection),
      objectView: nodeId.startsWith('alias:') ? 'alias' : 'aliases',
      objectName: nodeId.replace(/^alias:/, '') || 'aliases',
      aliases: nodeId.startsWith('alias:')
        ? searchAliases().filter((alias) => alias.name === nodeId.replace('alias:', ''))
        : searchAliases(),
    }
  }

  if (nodeId === 'search:templates' || nodeId.startsWith('search:templates') || nodeId.includes('template:')) {
    const templateName = nodeId.split(':').at(-1)
    const templates = nodeId.includes('template:') && templateName
      ? searchTemplates().filter((template) => template.name === templateName)
      : searchTemplates()
    return {
      engine: connection.engine,
      clusterName: searchClusterName(connection),
      objectView: nodeId.includes('component-template') ? 'component-template' : nodeId.includes('index-template') ? 'index-template' : 'templates',
      objectName: templateName,
      templates,
    }
  }

  if (nodeId === 'search:pipelines' || nodeId.startsWith('pipeline:')) {
    const pipelineName = nodeId.replace('pipeline:', '')
    return {
      engine: connection.engine,
      clusterName: searchClusterName(connection),
      objectView: nodeId.startsWith('pipeline:') ? 'pipeline' : 'pipelines',
      objectName: pipelineName || 'pipelines',
      pipelines: pipelineName
        ? searchPipelines().filter((pipeline) => pipeline.name === pipelineName)
        : searchPipelines(),
    }
  }

  if (nodeId.startsWith('search:security')) {
    return searchSecurityPayload(connection, nodeId)
  }

  if (nodeId.startsWith('search:diagnostics')) {
    return searchDiagnosticsPayload(connection, nodeId)
  }

  return searchClusterPayload(connection)
}

function searchClusterPayload(connection: ConnectionProfile) {
  const indices = searchIndices(connection)
  const documentCount = indices.reduce((total, index) => total + index.documents, 0)
  return {
    engine: connection.engine,
    clusterName: searchClusterName(connection),
    objectView: 'cluster',
    status: 'green',
    health: 'green',
    nodeCount: 3,
    indexCount: indices.length,
    documentCount,
    storage: '1.7 GB',
    shardCount: 12,
    nodes: searchNodes(),
    indices,
    shards: searchShards(),
    statistics: [
      { name: 'Search rate', value: 42, unit: 'req/s', source: 'nodes.stats.indices.search' },
      { name: 'Indexing rate', value: 12, unit: 'docs/s', source: 'nodes.stats.indices.indexing' },
      { name: 'Query latency p95', value: 18, unit: 'ms', source: 'search slowlog sample' },
    ],
  }
}

function searchIndexPayload(connection: ConnectionProfile, indexName: string) {
  const index = searchIndices(connection).find((candidate) => candidate.name === indexName) ?? searchIndices(connection)[0]!
  return {
    engine: connection.engine,
    clusterName: searchClusterName(connection),
    objectView: 'index',
    index: index.name,
    objectName: index.name,
    status: index.health,
    documentCount: index.documents,
    storage: index.storage,
    primaryShards: index.primaryShards,
    replicaShards: index.replicaShards,
    indices: [index],
    fields: searchFields(),
    aliases: searchAliases().filter((alias) => alias.indices.includes(index.name)),
    shards: searchShards().filter((shard) => shard.index === index.name),
    segments: searchSegments().filter((segment) => segment.index === index.name),
    settings: searchSettings(index.name),
    statistics: [
      { name: 'Refresh interval', value: '1s', unit: '', source: 'index settings' },
      { name: 'Deleted docs', value: index.name === 'orders-v1' ? 18 : 3, unit: 'docs', source: 'segments' },
    ],
  }
}

function searchDataStreamPayload(connection: ConnectionProfile, streamName: string) {
  const stream = searchDataStreams().find((candidate) => candidate.name === streamName) ?? searchDataStreams()[0]!
  const backingIndices = stream.backingIndices.split(', ')
  return {
    engine: connection.engine,
    clusterName: searchClusterName(connection),
    objectView: 'data-stream',
    objectName: stream.name,
    status: stream.status,
    documentCount: stream.documents,
    storage: stream.storage,
    dataStreams: [stream],
    indices: backingIndices.map((name, index) => ({
      name,
      health: 'green',
      status: 'open',
      documents: Math.round(stream.documents / backingIndices.length),
      primaryShards: 1,
      replicaShards: 1,
      storage: index === 0 ? '180 MB' : '96 MB',
      lifecycle: stream.template,
    })),
    shards: searchShards().filter((shard) => backingIndices.includes(shard.index)),
    statistics: [{ name: 'Generation', value: stream.generation, unit: '', source: 'data_streams' }],
  }
}

function searchSecurityPayload(connection: ConnectionProfile, nodeId: string) {
  const base = {
    engine: connection.engine,
    clusterName: searchClusterName(connection),
    objectView: 'security',
    users: [
      { name: 'app-search', realm: 'native', roles: 'search_writer', enabled: true },
      { name: 'reporting', realm: 'native', roles: 'search_reader', enabled: true },
    ],
    roles: [
      { name: 'search_reader', clusterPrivileges: 'monitor', indexPrivileges: 'read on products-*', applicationPrivileges: '-' },
      { name: 'search_writer', clusterPrivileges: 'monitor', indexPrivileges: 'read/write on products-*', applicationPrivileges: '-' },
    ],
    apiKeys: [
      { name: 'ingest-pipeline-key', owner: 'app-search', status: 'active', expiresAt: '2026-06-30' },
    ],
  }

  if (nodeId.endsWith(':users')) {
    return { ...base, objectView: 'users', roles: [], apiKeys: [] }
  }

  if (nodeId.endsWith(':roles')) {
    return { ...base, objectView: 'roles', users: [], apiKeys: [] }
  }

  if (nodeId.endsWith(':api-keys')) {
    return { ...base, objectView: 'api-keys', users: [], roles: [] }
  }

  return base
}

function searchDiagnosticsPayload(connection: ConnectionProfile, nodeId: string) {
  const base = {
    engine: connection.engine,
    clusterName: searchClusterName(connection),
    objectView: 'diagnostics',
    nodes: searchNodes(),
    shards: searchShards(),
    segments: searchSegments(),
    tasks: [
      { action: 'indices:data/read/search', description: 'dashboard query', runningTime: '42ms', cancellable: true, node: 'node-a' },
    ],
    snapshots: [
      { repository: 'daily', snapshot: 'snap-2026-05-22', state: 'SUCCESS', indices: 'products-v1, orders-v1', startedAt: '2026-05-22T02:00:00Z' },
    ],
    lifecyclePolicies: [
      { name: connection.engine === 'opensearch' ? 'hot-warm-delete' : 'products-ilm', type: connection.engine === 'opensearch' ? 'ISM' : 'ILM', phase: 'hot', managedIndices: 2, status: 'active' },
    ],
    statistics: [
      { name: 'Open scroll contexts', value: 0, unit: 'contexts', source: 'nodes.stats.search' },
      { name: 'Pending tasks', value: 1, unit: 'tasks', source: 'cluster.pending_tasks' },
    ],
  }

  if (nodeId.endsWith(':shards')) {
    return { ...base, objectView: 'shards', nodes: [], segments: [], tasks: [], snapshots: [], lifecyclePolicies: [], statistics: [] }
  }

  if (nodeId.endsWith(':segments')) {
    return { ...base, objectView: 'segments', nodes: [], shards: [], tasks: [], snapshots: [], lifecyclePolicies: [], statistics: [] }
  }

  if (nodeId.endsWith(':tasks')) {
    return { ...base, objectView: 'tasks', nodes: [], shards: [], segments: [], snapshots: [], lifecyclePolicies: [], statistics: [] }
  }

  if (nodeId.endsWith(':snapshots')) {
    return { ...base, objectView: 'snapshots', nodes: [], shards: [], segments: [], tasks: [], lifecyclePolicies: [], statistics: [] }
  }

  if (nodeId.endsWith(':lifecycle')) {
    return { ...base, objectView: 'lifecycle-policies', nodes: [], shards: [], segments: [], tasks: [], snapshots: [], statistics: [] }
  }

  return base
}

function searchQueryTemplate(index: string) {
  return JSON.stringify({
    index,
    body: {
      query: {
        match_all: {},
      },
      size: 20,
    },
  }, null, 2)
}

function searchClusterName(connection: ConnectionProfile) {
  return connection.database || (connection.engine === 'opensearch' ? 'opensearch-local' : 'elasticsearch-local')
}

function searchIndices(connection: ConnectionProfile) {
  const lifecycle = connection.engine === 'opensearch' ? 'hot-warm-delete' : 'products-ilm'
  return [
    { name: 'products-v1', health: 'green', status: 'open', documents: 100000, primaryShards: 1, replicaShards: 1, storage: '420 MB', lifecycle },
    { name: 'orders-v1', health: 'green', status: 'open', documents: 482000, primaryShards: 3, replicaShards: 1, storage: '1.2 GB', lifecycle },
  ]
}

function searchDataStreams() {
  return [
    { name: 'logs-generic-default', generation: 3, status: 'green', template: 'logs-template', backingIndices: '.ds-logs-generic-default-000001, .ds-logs-generic-default-000002', documents: 250000, storage: '276 MB' },
  ]
}

function searchAliases() {
  return [
    { name: 'products-read', indices: 'products-v1', writeIndex: false, routing: '-', filter: { term: { active: true } } },
    { name: 'orders-write', indices: 'orders-v1', writeIndex: true, routing: 'tenant_id', filter: '-' },
  ]
}

function searchFields() {
  return [
    { path: 'sku', type: 'keyword', searchable: true, aggregatable: true, analyzer: '-', normalizer: 'lowercase' },
    { path: 'name', type: 'text', searchable: true, aggregatable: false, analyzer: 'standard', normalizer: '-' },
    { path: 'category', type: 'keyword', searchable: true, aggregatable: true, analyzer: '-', normalizer: '-' },
    { path: 'inventory.available', type: 'integer', searchable: true, aggregatable: true, analyzer: '-', normalizer: '-' },
    { path: 'updated_at', type: 'date', searchable: true, aggregatable: true, analyzer: '-', normalizer: '-' },
  ]
}

function searchSettings(index: string) {
  return [
    { name: 'number_of_shards', value: index === 'orders-v1' ? 3 : 1, scope: 'index' },
    { name: 'number_of_replicas', value: 1, scope: 'index' },
    { name: 'refresh_interval', value: '1s', scope: 'index' },
    { name: 'lifecycle.name', value: 'products-ilm', scope: 'index' },
  ]
}

function searchTemplates() {
  return [
    { name: 'products-template', type: 'index', patterns: 'products-*', priority: 100, components: 'common-settings, product-mappings', lifecycle: 'products-ilm' },
    { name: 'common-settings', type: 'component', patterns: '-', priority: '-', components: 'settings', lifecycle: '-' },
    { name: 'product-mappings', type: 'component', patterns: '-', priority: '-', components: 'mappings', lifecycle: '-' },
  ]
}

function searchPipelines() {
  return [
    { name: 'normalize-products', description: 'Normalize product names and tags before indexing', processors: 3, onFailure: 'dead-letter-index', usedBy: 'products-template' },
    { name: 'enrich-orders', description: 'Attach account metadata to order documents', processors: 2, onFailure: '-', usedBy: 'orders-v1' },
  ]
}

function searchNodes() {
  return [
    { name: 'node-a', roles: 'master,data_hot,ingest', heapUsed: '41%', diskUsed: '33%', cpu: '12%', status: 'online' },
    { name: 'node-b', roles: 'data_hot,ingest', heapUsed: '38%', diskUsed: '29%', cpu: '8%', status: 'online' },
    { name: 'node-c', roles: 'data_warm', heapUsed: '24%', diskUsed: '45%', cpu: '4%', status: 'online' },
  ]
}

function searchShards() {
  return [
    { index: 'products-v1', shard: 0, primary: true, state: 'STARTED', node: 'node-a', documents: 100000, storage: '210 MB' },
    { index: 'products-v1', shard: 0, primary: false, state: 'STARTED', node: 'node-b', documents: 100000, storage: '210 MB' },
    { index: 'orders-v1', shard: 0, primary: true, state: 'STARTED', node: 'node-a', documents: 162000, storage: '410 MB' },
    { index: 'orders-v1', shard: 1, primary: true, state: 'STARTED', node: 'node-b', documents: 160000, storage: '405 MB' },
    { index: 'orders-v1', shard: 2, primary: true, state: 'STARTED', node: 'node-c', documents: 160000, storage: '385 MB' },
  ]
}

function searchSegments() {
  return [
    { index: 'products-v1', shard: 0, segments: 8, deletedDocs: 3, memory: '12 MB' },
    { index: 'orders-v1', shard: 0, segments: 14, deletedDocs: 18, memory: '31 MB' },
  ]
}

function sqliteDatabasePayload() {
  return {
    engine: 'sqlite',
    schema: 'main',
    objectName: 'main',
    objectView: 'database',
    database: 'main',
    tableCount: 2,
    indexCount: 2,
    rowCount: 384,
    attachedDatabases: sqliteAttachedDatabases(),
    tables: [
      { schema: 'main', name: 'accounts', type: 'table', rows: 128, size: '48 KB' },
      { schema: 'main', name: 'orders', type: 'table', rows: 256, size: '96 KB' },
    ],
    views: [
      {
        schema: 'main',
        name: 'active_accounts',
        definition: "create view active_accounts as select id, name, status from accounts where status = 'active'",
        status: 'valid',
      },
    ],
    indexes: [
      { name: 'accounts_pkey', type: 'btree', columns: 'id', unique: true, valid: true, size: '16 KB' },
      { name: 'orders_account_id_idx', type: 'btree', columns: 'account_id', unique: false, valid: true, size: '24 KB' },
    ],
    pragmas: sqlitePragmaRows(),
    schemaObjects: sqliteSchemaRows(),
  }
}

function sqliteFolderPayload(folder: string) {
  const payload = sqliteDatabasePayload()
  const folderKind = folder.replace(/_/g, '-')

  if (folderKind === 'tables') {
    return { ...payload, objectView: 'tables', views: [], indexes: [], pragmas: [], schemaObjects: [] }
  }

  if (folderKind === 'views') {
    return { ...payload, objectView: 'views', tables: [], indexes: [], pragmas: [], schemaObjects: [] }
  }

  if (folderKind === 'indexes') {
    return { ...payload, objectView: 'indexes', tables: [], views: [], pragmas: [], schemaObjects: [] }
  }

  if (folderKind === 'pragmas') {
    return {
      engine: 'sqlite',
      schema: 'main',
      objectName: 'pragmas',
      objectView: 'pragmas',
      pragmas: sqlitePragmaRows(),
      attachedDatabases: sqliteAttachedDatabases(),
      checks: [{ name: 'quick_check', status: 'ok', detail: 'No corruption was reported by the preview check.' }],
    }
  }

  if (folderKind === 'schema') {
    return {
      engine: 'sqlite',
      schema: 'main',
      objectName: 'schema',
      objectView: 'schema',
      schemaObjects: sqliteSchemaRows(),
    }
  }

  if (folderKind === 'virtual-tables' || folderKind === 'fts-tables' || folderKind === 'rtree-tables') {
    return {
      engine: 'sqlite',
      schema: 'main',
      objectName: folderKind,
      objectView: folderKind,
      virtualTables: folderKind === 'fts-tables'
        ? [{ schema: 'main', name: 'account_search', module: 'fts5', detail: 'Full-text account search' }]
        : [],
    }
  }

  if (folderKind === 'generated-columns') {
    return {
      engine: 'sqlite',
      schema: 'main',
      objectName: folderKind,
      objectView: folderKind,
      generatedColumns: [{ table: 'orders', name: 'order_month', type: 'text', generated: 'stored', hidden: false }],
    }
  }

  return payload
}

function sqliteTablePayload(schema: string, table: string, section: string) {
  const payload = {
    engine: 'sqlite',
    schema,
    objectName: table,
    objectView: section === 'table' ? 'table' : section,
    rowCount: table === 'orders' ? 256 : 128,
    size: table === 'orders' ? '96 KB' : '48 KB',
    columns: [
      { name: 'id', type: 'integer', nullable: false, default: '', identity: 'primary key' },
      { name: 'name', type: 'text', nullable: true, default: '' },
      { name: 'updated_at', type: 'text', nullable: false, default: 'current_timestamp' },
    ],
    indexes: [
      { name: `${table}_pkey`, type: 'btree', columns: 'id', unique: true, valid: true, usage: 'primary key' },
    ],
    constraints: [
      { name: `${table}_pk`, type: 'primary key', columns: 'id', status: 'active' },
      { name: `${table}_updated_at_nn`, type: 'not null', columns: 'updated_at', status: 'active' },
    ],
    foreignKeys: table === 'orders'
      ? [{ id: 0, from: 'account_id', table: 'accounts', to: 'id', onUpdate: 'NO ACTION', onDelete: 'CASCADE' }]
      : [],
    triggers: [
      { name: `${table}_updated_at`, timing: 'after', event: 'update', enabled: true, function: 'sets updated_at' },
    ],
    statistics: [
      { name: table, rows: table === 'orders' ? 256 : 128, size: table === 'orders' ? '96 KB' : '48 KB' },
    ],
    schemaObjects: [{
      type: 'table',
      name: table,
      tableName: table,
      definition: `create table ${table} (id integer primary key, name text, updated_at text not null default current_timestamp)`,
    }],
  }

  if (section === 'columns') {
    return { ...payload, indexes: [], constraints: [], foreignKeys: [], triggers: [], statistics: [], schemaObjects: [] }
  }

  if (section === 'indexes') {
    return { ...payload, columns: [], constraints: [], foreignKeys: [], triggers: [], statistics: [], schemaObjects: [] }
  }

  if (section === 'constraints') {
    return { ...payload, columns: [], indexes: [], foreignKeys: [], triggers: [], statistics: [], schemaObjects: [] }
  }

  if (section === 'foreign-keys') {
    return { ...payload, columns: [], indexes: [], constraints: [], triggers: [], statistics: [], schemaObjects: [] }
  }

  if (section === 'triggers') {
    return { ...payload, columns: [], indexes: [], constraints: [], foreignKeys: [], statistics: [], schemaObjects: [] }
  }

  if (section === 'statistics') {
    return { ...payload, columns: [], indexes: [], constraints: [], foreignKeys: [], triggers: [], schemaObjects: [] }
  }

  if (section === 'ddl') {
    return { ...payload, columns: [], indexes: [], constraints: [], foreignKeys: [], triggers: [], statistics: [] }
  }

  return payload
}

function sqliteAttachedDatabases() {
  return [
    { seq: 0, name: 'main', file: 'datapadplusplus.sqlite', status: 'open' },
  ]
}

function sqlitePragmaRows() {
  return [
    { name: 'foreign_keys', value: 'ON', status: 'enabled', detail: 'Foreign-key enforcement is enabled.' },
    { name: 'journal_mode', value: 'wal', status: 'configured', detail: 'Write-ahead logging mode.' },
    { name: 'synchronous', value: 'normal', status: 'configured', detail: 'Balanced durability and performance.' },
    { name: 'quick_check', value: 'ok', status: 'ok', detail: 'No corruption was reported by the preview check.' },
  ]
}

function sqliteSchemaRows() {
  return [
    {
      type: 'table',
      name: 'accounts',
      tableName: 'accounts',
      definition: 'create table accounts (id integer primary key, name text, updated_at text not null default current_timestamp)',
    },
    {
      type: 'view',
      name: 'active_accounts',
      tableName: 'active_accounts',
      definition: "create view active_accounts as select id, name, status from accounts where status = 'active'",
    },
  ]
}

function cockroachInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
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

function cockroachInspectPayload(connection: ConnectionProfile, nodeId: string) {
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
      { id: 901, type: 'SCHEMA CHANGE', status: 'succeeded', fractionCompleted: '100%', created: '2026-05-18', modified: '2026-05-18' },
      { id: 902, type: 'BACKUP', status: 'running', fractionCompleted: '42%', created: '2026-05-21', modified: '2026-05-21' },
    ],
    clusterSettings: [
      { name: 'kv.rangefeed.enabled', value: 'true', type: 'b', description: 'rangefeed support' },
      { name: 'sql.defaults.results_buffer.size', value: '16KiB', type: 'z', description: 'SQL result buffering' },
    ],
  }

  if (nodeId.includes('cluster') || nodeId.includes('nodes') || nodeId.includes('ranges') || nodeId.includes('regions') || nodeId.includes('jobs') || nodeId.includes('cluster-settings')) {
    return {
      ...base,
      ...clusterPayload,
      warnings: ['CockroachDB browser-preview metadata is deterministic and does not contact a live cluster.'],
    }
  }

  if (nodeId.startsWith('table:')) {
    return {
      ...base,
      rowCount: 128,
      size: '96 KB',
      rangeCount: 4,
      columns: postgresColumns(),
      indexes: [
        { name: `${objectName}_pkey`, type: 'primary', columns: 'id', unique: true, valid: true, size: '16 KB' },
        { name: `${objectName}_updated_at_idx`, type: 'secondary', columns: 'updated_at', unique: false, valid: true, size: '16 KB' },
      ],
      constraints: [
        { name: `${objectName}_pkey`, type: 'PRIMARY KEY', columns: 'id', status: 'validated' },
      ],
      statistics: [
        { name: objectName, rows: 128, scans: 6, size: '96 KB' },
      ],
      permissions: [
        { principal: 'reporting', privilege: 'SELECT', object: `${schema}.${objectName}`, state: 'granted', grantor: 'app' },
      ],
      ranges: [
        { rangeId: 42, table: `${schema}.${objectName}`, replicas: '1,2,3', leaseholder: 1, qps: 18, size: '64 MB' },
      ],
    }
  }

  if (nodeId.includes('security') || nodeId.includes('roles') || nodeId.includes('grants')) {
    return {
      ...base,
      roles: [
        { name: 'root', login: true, superuser: true, inherit: true, memberships: 'admin' },
        { name: 'app', login: true, superuser: false, inherit: true, memberships: 'reporting' },
      ],
      permissions: [
        { principal: 'reporting', privilege: 'SELECT', object: `${schema}.accounts`, state: 'granted', grantor: 'admin' },
      ],
    }
  }

  if (nodeId.includes('diagnostics') || nodeId.includes('sessions') || nodeId.includes('locks') || nodeId.includes('statements') || nodeId.includes('transactions') || nodeId.includes('contention')) {
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
    objects: [
      { schema, name: objectName || 'accounts', type: nodeId.split(':')[0] || 'object', status: 'visible' },
    ],
  }
}

function postgresInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parsePostgresNodeId(connection, nodeId)

  if (['table:', 'view:', 'materialized-view:'].some((prefix) => nodeId.startsWith(prefix)) && objectName) {
    return `select * from "${schema}"."${objectName}" limit 100;`
  }

  const sourceQuery = postgresSourceInspectQueryTemplate(nodeId, schema, objectName)
  if (sourceQuery) {
    return sourceQuery
  }

  if (nodeId.includes('diagnostics') || nodeId.includes('sessions')) {
    return 'select pid, usename, datname, state, wait_event_type, wait_event from pg_stat_activity order by query_start desc nulls last limit 100;'
  }

  if (nodeId.includes('locks')) {
    return 'select locktype, mode, granted, relation::regclass::text as relation from pg_locks limit 100;'
  }

  if (nodeId.includes('security') || nodeId.includes('roles')) {
    return 'select rolname, rolcanlogin, rolsuper, rolinherit from pg_roles order by rolname;'
  }

  return `select schemaname, tablename from pg_catalog.pg_tables where schemaname = '${schema.replace(/'/g, "''")}' order by tablename;`
}

function postgresInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const { schema, objectName } = parsePostgresNodeId(connection, nodeId)
  const base = {
    engine: connection.engine,
    database: connection.database || 'datapadplusplus',
    schema,
    objectName,
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

  if (nodeId.includes('diagnostics') || nodeId.includes('sessions') || nodeId.includes('locks')) {
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
      statistics: [
        { name: `${schema}.accounts`, rows: 128, scans: 9, lastAnalyze: '2026-05-16', size: '96 KB' },
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

function sqlServerInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const { database, schema, objectName } = parseSqlServerNodeId(connection, nodeId)

  if (['table:', 'view:'].some((prefix) => nodeId.startsWith(prefix)) && objectName) {
    return `use [${database}];\nselect top 100 * from [${schema}].[${objectName}];`
  }

  const sourceQuery = sqlServerSourceInspectQueryTemplate(nodeId, database, schema, objectName)
  if (sourceQuery) {
    return sourceQuery
  }

  if (nodeId.includes('query-store')) {
    return `use [${database}];\nselect top 50 * from sys.query_store_runtime_stats order by last_execution_time desc;`
  }

  if (nodeId.includes('security') || nodeId.includes('users') || nodeId.includes('roles')) {
    return `use [${database}];\nselect name, type_desc from sys.database_principals order by name;`
  }

  return `use [${database}];\nselect db_name() as database_name;`
}

function sqlServerInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const { database, schema, objectName } = parseSqlServerNodeId(connection, nodeId)
  const base = {
    engine: 'sqlserver',
    database,
    schema,
    objectName,
  }

  if (nodeId.startsWith('table:')) {
    return {
      ...base,
      rowCount: 128,
      size: '160 KB',
      columns: [
        { name: 'id', type: 'bigint', nullable: false, identity: true },
        { name: 'sku', type: 'nvarchar(80)', nullable: false, collation: 'database default' },
        { name: 'updated_at', type: 'datetimeoffset', nullable: false },
      ],
      indexes: [
        { name: `PK_${objectName}`, type: 'CLUSTERED', columns: 'id', unique: true, usage: 'seek 14 / scan 1' },
        { name: `IX_${objectName}_sku`, type: 'NONCLUSTERED', columns: 'sku', unique: false, usage: 'seek 8 / scan 0' },
      ],
      constraints: [
        { name: `PK_${objectName}`, type: 'PRIMARY KEY', columns: 'id', status: 'enabled' },
      ],
      triggers: [
        { name: `TR_${objectName}_audit`, event: 'INSERT, UPDATE', enabled: true, timing: 'AFTER' },
      ],
      statistics: [
        { name: objectName, rows: 128, scans: 6, size: '160 KB' },
      ],
      permissions: [
        { principal: 'reporting', privilege: 'SELECT', object: `${schema}.${objectName}`, state: 'GRANT', grantor: 'dbo' },
      ],
    }
  }

  const sourcePayload = sqlServerSourceInspectPayload(base, nodeId, schema, objectName)
  if (sourcePayload) {
    return sourcePayload
  }

  if (nodeId.startsWith('database:') || nodeId.includes(':tables') || nodeId.includes(':views')) {
    return {
      ...base,
      databaseSize: '32 MB',
      tableCount: 3,
      indexCount: 7,
      tables: [
        { schema: 'dbo', name: 'accounts', type: 'base table', rows: 128, size: '160 KB', owner: 'dbo' },
        { schema: 'dbo', name: 'orders', type: 'base table', rows: 348, size: '240 KB', owner: 'dbo' },
        { schema: 'dbo', name: 'products', type: 'base table', rows: 3, size: '80 KB', owner: 'dbo' },
      ],
      views: [
        { schema: 'dbo', name: 'active_accounts', status: 'valid', definition: 'Visible in sys.sql_modules.' },
      ],
      queryStore: [
        { name: 'Top Queries', status: 'available', durationMs: 18, executions: 14, planState: 'not forced' },
      ],
    }
  }

  if (nodeId.includes('security') || nodeId.includes('users') || nodeId.includes('roles')) {
    return {
      ...base,
      users: [
        { name: 'dbo', type: 'SQL_USER', defaultSchema: 'dbo', authenticationType: 'INSTANCE' },
        { name: 'reporting', type: 'DATABASE_ROLE', defaultSchema: '', authenticationType: '' },
      ],
      roles: [
        { name: 'db_datareader', type: 'DATABASE_ROLE', defaultSchema: '', authenticationType: '' },
      ],
      permissions: [
        { principal: 'reporting', privilege: 'SELECT', object: 'dbo.accounts', state: 'GRANT', grantor: 'dbo' },
      ],
    }
  }

  if (nodeId.includes('query-store')) {
    return {
      ...base,
      queryStore: [
        { name: 'Top Queries', status: 'available', durationMs: 18, executions: 14, planState: 'not forced' },
        { name: 'Regressed Queries', status: 'no regressions', durationMs: 0, executions: 0, planState: '' },
      ],
    }
  }

  if (nodeId.includes('storage') || nodeId.includes('files') || nodeId.includes('filegroups')) {
    return {
      ...base,
      files: [
        { name: `${database}`, type: 'ROWS', size: '32 MB', growth: '64 MB', state: 'ONLINE' },
        { name: `${database}_log`, type: 'LOG', size: '16 MB', growth: '64 MB', state: 'ONLINE' },
      ],
      filegroups: [
        { name: 'PRIMARY', type: 'ROWS_FILEGROUP', default: true, readOnly: false },
      ],
    }
  }

  return {
    ...base,
    objects: [
      { schema, name: objectName || database, type: nodeId.split(':')[0] || 'object', status: 'visible' },
    ],
  }
}

function parsePostgresObjectScope(scope: string) {
  const value = scope.replace(/^table:/, '')
  const [schema = 'public', objectName = 'object'] = value.includes('.')
    ? value.split('.', 2)
    : ['public', value]

  return { schema, objectName }
}

function parsePostgresNodeId(connection: ConnectionProfile, nodeId: string) {
  if (nodeId.startsWith('table:')) {
    return parsePostgresObjectScope(nodeId)
  }

  if (nodeId.startsWith('schema:')) {
    return { schema: nodeId.replace('schema:', '') || 'public', objectName: '' }
  }

  const parts = nodeId.split(':')
  if (parts.length >= 3) {
    return { schema: parts[1] || 'public', objectName: parts[2] || '' }
  }

  return { schema: connection.database || 'public', objectName: '' }
}

function parseCockroachNodeId(connection: ConnectionProfile, nodeId: string) {
  if (nodeId.startsWith('cockroach:')) {
    const [, maybeDatabase = connection.database || 'defaultdb', maybeSchema = 'public', maybeObject = ''] = nodeId.split(':')
    if (['cluster', 'security', 'diagnostics'].includes(maybeDatabase)) {
      return { schema: 'public', objectName: maybeSchema || '' }
    }
    return { schema: maybeSchema || 'public', objectName: maybeObject || '' }
  }

  return parsePostgresNodeId(connection, nodeId)
}

function isPostgresSystemSchema(schema: string) {
  const normalized = schema.trim().toLowerCase()
  return normalized === 'information_schema' || normalized.startsWith('pg_')
}

function postgresSectionLabel(section: string) {
  switch (section) {
    case 'materialized-views':
      return 'Materialized Views'
    case 'functions':
      return 'Functions'
    case 'procedures':
      return 'Procedures'
    case 'sequences':
      return 'Sequences'
    case 'types':
      return 'Types'
    case 'indexes':
      return 'Indexes'
    case 'views':
      return 'Views'
    default:
      return 'Tables'
  }
}

function cockroachSectionLabel(section: string) {
  switch (section) {
    case 'zone-configurations':
      return 'Zone Configurations'
    case 'cluster-settings':
      return 'Cluster Settings'
    case 'statements':
      return 'Statement Stats'
    default:
      return postgresSectionLabel(section)
  }
}

function postgresColumns() {
  return [
    { name: 'id', type: 'bigint', nullable: false, default: "nextval('id_seq')" },
    { name: 'sku', type: 'text', nullable: false, default: '' },
    { name: 'updated_at', type: 'timestamp with time zone', nullable: false, default: 'now()' },
  ]
}

function parseSqlServerObjectScope(scope: string) {
  const value = scope.replace(/^table:/, '')
  const [database = 'datapadplusplus', schema = 'dbo', objectName = 'object'] = value.split(':')
  return { database, schema, objectName }
}

function parseSqlServerNodeId(connection: ConnectionProfile, nodeId: string) {
  if (nodeId.startsWith('table:') || nodeId.startsWith('view:') || nodeId.startsWith('procedure:') || nodeId.startsWith('function:')) {
    const [, database = connection.database || 'datapadplusplus', schema = 'dbo', objectName = 'object'] = nodeId.split(':')
    return { database, schema, objectName }
  }

  if (nodeId.startsWith('database:')) {
    return { database: nodeId.replace('database:', '') || connection.database || 'datapadplusplus', schema: 'dbo', objectName: '' }
  }

  const parts = nodeId.split(':')
  return {
    database: parts[1] || connection.database || 'datapadplusplus',
    schema: parts[2] || 'dbo',
    objectName: parts[3] || '',
  }
}

function isSqlServerSystemDatabase(database: string) {
  return ['master', 'model', 'msdb', 'tempdb'].includes(database.trim().toLowerCase())
}

function sqlServerSectionLabel(section: string) {
  switch (section) {
    case 'stored-procedures':
      return 'Stored Procedures'
    case 'query-store':
      return 'Query Store'
    case 'extended-events':
      return 'Extended Events'
    case 'security':
      return 'Security'
    case 'storage':
      return 'Storage'
    case 'agent':
      return 'Agent'
    case 'functions':
      return 'Functions'
    case 'views':
      return 'Views'
    default:
      return 'Tables'
  }
}

function createRedisExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      redisNode(connection, 'redis:databases', 'Databases', 'databases', 'Logical Redis databases', 'databases', true),
      redisNode(connection, 'redis:cluster', 'Cluster', 'cluster', 'Cluster status and nodes', 'cluster', true),
      redisNode(connection, 'redis:sentinel', 'Sentinel', 'sentinel', 'Sentinel masters and failover status', 'sentinel', true),
      redisNode(connection, 'redis:pubsub', 'Pub/Sub', 'pubsub', 'Channels and patterns', 'pubsub', true),
      redisNode(connection, 'redis:lua-scripts', 'Lua Scripts', 'lua-scripts', 'Script workflow surfaces', 'lua-scripts', true),
      redisNode(connection, 'redis:functions', 'Functions', 'functions', 'Redis function libraries', 'functions', true),
      redisNode(connection, 'redis:acl', 'ACL / Security', 'security', 'ACL users and categories', 'acl', true),
      redisNode(connection, 'redis:diagnostics', 'Diagnostics', 'diagnostics', 'INFO, SLOWLOG, memory, latency, clients', 'diagnostics', true),
    ]
  }

  if (scope === 'databases') {
    return [
      redisNode(connection, 'redis:db:0', 'DB 0', 'database', '40,010 keys', 'db:0', true),
      redisNode(connection, 'redis:db:1', 'DB 1', 'database', '0 keys', 'db:1', true),
    ]
  }

  if (scope.startsWith('db:') && !scope.includes(':type:')) {
    const database = redisDatabaseFromScope(scope)
    return REDIS_BROWSER_TYPES.map((type) =>
      redisNode(
        connection,
        `redis:db:${database}:${type.kind}`,
        type.label,
        type.kind,
        type.detail,
        `db:${database}:type:${type.kind}`,
        type.kind !== 'pubsub' && type.kind !== 'search-index',
      ),
    )
  }

  if (scope.startsWith('db:') && scope.includes(':type:')) {
    const database = redisDatabaseFromScope(scope)
    const type = scope.split(':type:')[1] ?? 'keys'
    return previewRedisKeysForType(type).map((key) => ({
      id: `key:${database}:${key.key}`,
      family: 'keyvalue',
      label: key.key,
      kind: key.type,
      detail: `${key.type} / ${key.length} item(s)`,
      path: [connection.name, `DB ${database}`, redisTypeFolderLabel(type)],
      queryTemplate: `TYPE ${key.key}\nTTL ${key.key}`,
    }))
  }

  if (scope === 'cluster') {
    return [
      redisNode(connection, 'redis:cluster:info', 'Cluster Info', 'cluster', 'Mode and health'),
      redisNode(connection, 'redis:cluster:nodes', 'Nodes', 'cluster-node', 'Cluster nodes'),
      redisNode(connection, 'redis:cluster:slots', 'Slots', 'cluster-slots', 'Hash slot allocation'),
      redisNode(connection, 'redis:cluster:failover', 'Failover Status', 'cluster-failover', 'Failover metadata'),
    ]
  }

  if (scope === 'sentinel') {
    return [
      redisNode(connection, 'redis:sentinel:masters', 'Masters', 'sentinel-masters', 'Monitored masters'),
      redisNode(connection, 'redis:sentinel:replicas', 'Replicas', 'sentinel-replicas', 'Replica status'),
      redisNode(connection, 'redis:sentinel:sentinels', 'Sentinels', 'sentinel-peers', 'Peer sentinels'),
      redisNode(connection, 'redis:sentinel:failover', 'Failover Status', 'sentinel-failover', 'Failover metadata'),
    ]
  }

  if (scope === 'pubsub') {
    return [
      redisNode(connection, 'redis:pubsub:channels', 'Channels', 'pubsub-channel', 'Active channel names'),
      redisNode(connection, 'redis:pubsub:patterns', 'Patterns', 'pubsub-pattern', 'Pattern subscription count'),
      redisNode(connection, 'redis:pubsub:subscribers', 'Subscribers', 'pubsub-subscriber', 'Channel subscriber counts'),
    ]
  }

  if (scope === 'lua-scripts') {
    return [
      redisNode(connection, 'redis:lua:scripts', 'Loaded Scripts', 'lua-script', 'Script SHA workflow'),
      redisNode(connection, 'redis:lua:history', 'Script History', 'history', 'Saved script history lives in Library'),
    ]
  }

  if (scope === 'functions') {
    return [
      redisNode(connection, 'redis:functions:list', 'Libraries', 'functions', 'Function libraries'),
    ]
  }

  if (scope === 'acl') {
    return [
      redisNode(connection, 'redis:acl:users', 'Users', 'users', 'ACL users'),
      redisNode(connection, 'redis:acl:categories', 'Categories', 'permissions', 'Command categories'),
      redisNode(connection, 'redis:acl:whoami', 'Current User', 'user', 'Authenticated principal'),
    ]
  }

  if (scope === 'diagnostics') {
    return [
      redisNode(connection, 'redis:diagnostics:info', 'Overview', 'diagnostics', 'Server health sections'),
      redisNode(connection, 'redis:diagnostics:slowlog', 'Slow Operations', 'slowlog', 'Slow operation history'),
      redisNode(connection, 'redis:diagnostics:commandstats', 'Command Stats', 'metrics', 'Command usage counters'),
      redisNode(connection, 'redis:diagnostics:latency', 'Latency', 'latency', 'Latency samples'),
      redisNode(connection, 'redis:diagnostics:memory', 'Memory Analysis', 'memory', 'Memory usage and allocator facts'),
      redisNode(connection, 'redis:diagnostics:clients', 'Clients', 'clients', 'Connected client metadata'),
      redisNode(connection, 'redis:diagnostics:persistence', 'Persistence', 'persistence', 'Persistence health'),
      redisNode(connection, 'redis:diagnostics:replication', 'Replication', 'replication', 'Replication health'),
    ]
  }

  return []
}

const REDIS_BROWSER_TYPES = [
  { kind: 'keys', label: 'Keys', detail: 'All key types' },
  { kind: 'string', label: 'Strings', detail: 'String, bitmap, and HyperLogLog values' },
  { kind: 'hash', label: 'Hashes', detail: 'Hash maps' },
  { kind: 'list', label: 'Lists', detail: 'Ordered list values' },
  { kind: 'set', label: 'Sets', detail: 'Set values' },
  { kind: 'zset', label: 'Sorted Sets', detail: 'Scored set values' },
  { kind: 'stream', label: 'Streams', detail: 'Append-only stream values' },
  { kind: 'json', label: 'JSON', detail: 'RedisJSON values when the module is installed' },
  { kind: 'timeseries', label: 'Time Series', detail: 'RedisTimeSeries values when available' },
  { kind: 'bloom', label: 'Bloom Filters', detail: 'RedisBloom probabilistic values when available' },
  { kind: 'search-index', label: 'Search Indexes', detail: 'RediSearch indexes' },
  { kind: 'vectorset', label: 'Vector Indexes', detail: 'Vector search structures' },
  { kind: 'pubsub', label: 'Pub/Sub', detail: 'Channels, patterns, and subscribers' },
] as const

function redisInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('key:')) {
    const key = nodeId.split(':').slice(2).join(':')
    return `TYPE ${key}\nTTL ${key}`
  }

  if (nodeId.includes(':slowlog')) {
    return 'SLOWLOG GET 128'
  }

  if (nodeId.includes(':memory')) {
    return 'MEMORY STATS'
  }

  if (nodeId.includes(':clients')) {
    return 'CLIENT LIST'
  }

  if (nodeId.includes(':replication')) {
    return 'INFO replication'
  }

  if (nodeId.includes(':persistence')) {
    return 'INFO persistence'
  }

  if (nodeId.includes(':latency')) {
    return 'LATENCY LATEST'
  }

  if (nodeId.includes(':acl')) {
    return 'ACL LIST'
  }

  if (nodeId.includes(':cluster')) {
    return 'CLUSTER INFO'
  }

  return 'INFO'
}

function redisInspectPayload(nodeId: string) {
  if (nodeId === 'redis:databases') {
    return {
      databases: [
        { database: 0, keys: 40010, expires: 39992, avgTtl: '12m' },
        { database: 1, keys: 0, expires: 0, avgTtl: 'n/a' },
      ],
      configuredDatabase: 0,
    }
  }

  if (nodeId.startsWith('redis:db:')) {
    const [, , database = '0', type] = nodeId.split(':')
    const typeCounts = [
      { type: 'hash', count: 39992, examples: ['perf:session:000143'] },
      { type: 'zset', count: 1, examples: ['products:inventory'] },
      { type: 'string', count: 17, examples: ['account:1'] },
    ]

    if (type) {
      const keys = previewRedisKeysForType(type)
      return {
        database: Number.parseInt(database, 10),
        type,
        pattern: '*',
        scannedKeys: keys.length,
        keys,
      }
    }

    return {
      database: Number.parseInt(database, 10),
      keyCount: 40010,
      scannedKeys: 100,
      typeCounts,
    }
  }

  if (nodeId.startsWith('key:')) {
    const [, database = '0', ...keyParts] = nodeId.split(':')
    const key = keyParts.join(':')
    return {
      database: Number.parseInt(database, 10),
      key,
      type: key.includes('inventory') ? 'zset' : key.includes('orders') ? 'list' : 'hash',
      ttlSeconds: key.startsWith('perf:') ? -1 : 600,
      memoryUsageBytes: 144,
      length: 4,
      preview: {
        status: 'active',
        updatedAt: '2026-05-20T12:00:00.000Z',
      },
    }
  }

  if (nodeId.includes('pubsub')) {
    return {
      kind: 'pubsub',
      channels: [],
      patterns: [],
      subscribers: [],
      activeChannels: 0,
      patternSubscriptions: 0,
      totalSubscribers: 0,
    }
  }

  if (nodeId.includes('sentinel')) {
    if (nodeId.includes('masters')) {
      return {
        kind: 'sentinel',
        masters: [
          { name: 'preview-primary', ip: '127.0.0.1', port: 6379, flags: 'master', quorum: 2, numSlaves: 1 },
        ],
        replicas: [],
        sentinels: [],
      }
    }

    if (nodeId.includes('replicas')) {
      return {
        kind: 'sentinel',
        masters: [],
        replicas: [
          { name: 'preview-replica-1', ip: '127.0.0.1', port: 6380, flags: 'slave', masterName: 'preview-primary' },
        ],
        sentinels: [],
      }
    }

    if (nodeId.includes('sentinels')) {
      return {
        kind: 'sentinel',
        masters: [],
        replicas: [],
        sentinels: [
          { name: 'sentinel-a', ip: '127.0.0.1', port: 26379, flags: 'sentinel', runid: 'preview-sentinel' },
        ],
      }
    }

    return {
      kind: 'sentinel',
      masters: [
        { name: 'preview-primary', ip: '127.0.0.1', port: 6379, flags: 'master', quorum: 2, numSlaves: 1 },
      ],
      replicas: [
        { name: 'preview-replica-1', ip: '127.0.0.1', port: 6380, flags: 'slave', masterName: 'preview-primary' },
      ],
      sentinels: [
        { name: 'sentinel-a', ip: '127.0.0.1', port: 26379, flags: 'sentinel', runid: 'preview-sentinel' },
      ],
    }
  }

  if (nodeId.includes('lua')) {
    return {
      kind: 'lua-scripts',
      scripts: [
        { sha: '9f2c-preview', name: 'reserve-stock', lastUsedAt: '2026-05-20T12:00:00.000Z' },
      ],
      history: [
        { name: 'reserve-stock.lua', scope: 'DB 0', lastRunAt: '2026-05-20T12:00:00.000Z' },
      ],
    }
  }

  if (nodeId.includes('functions')) {
    return {
      kind: 'functions',
      libraries: [
        {
          name: 'inventory',
          engine: 'LUA',
          functions: [{ name: 'reserve_stock' }, { name: 'release_stock' }],
          flags: ['no-writes'],
        },
      ],
    }
  }

  if (nodeId.includes('diagnostics:info')) {
    return {
      kind: 'diagnostics',
      server: { version: '7.2.5', uptimeSeconds: 3600 },
      keyspace: [{ database: 0, keys: 40010, expires: 39992, avgTtlMs: 720000 }],
      metrics: [
        { label: 'Connected Clients', value: 1, unit: 'clients', section: 'clients' },
        { label: 'Used Memory', value: 7399232, unit: 'bytes', section: 'memory' },
        { label: 'Memory Fragmentation', value: 2.35, unit: 'ratio', section: 'memory' },
        { label: 'Ops Per Sec', value: 0, unit: 'ops/s', section: 'stats' },
        { label: 'Keyspace Hits', value: 31449, unit: 'hits', section: 'stats' },
        { label: 'Keyspace Misses', value: 0, unit: 'misses', section: 'stats' },
      ],
    }
  }

  if (nodeId.includes('slowlog')) {
    return {
      kind: 'slowlog',
      entries: [
        { id: 1, durationMicros: 1200, commandName: 'HGETALL', key: 'perf:session:000143', recordedAt: '2026-05-20T12:00:00.000Z' },
      ],
    }
  }

  if (nodeId.includes('commandstats')) {
    return {
      kind: 'metrics',
      metrics: [
        { label: 'GET Calls', value: 31449, unit: 'calls', section: 'commandstats' },
        { label: 'HGETALL Calls', value: 120, unit: 'calls', section: 'commandstats' },
        { label: 'Average GET Time', value: 1.2, unit: 'usec/call', section: 'commandstats' },
      ],
    }
  }

  if (nodeId.includes('latency')) {
    return {
      kind: 'latency',
      samples: [
        { event: 'command', latestMs: 1, maxMs: 4 },
        { event: 'fork', latestMs: 0, maxMs: 0 },
      ],
    }
  }

  if (nodeId.includes('memory')) {
    return {
      kind: 'memory',
      metrics: [
        { label: 'Used Memory', value: 7399232, unit: 'bytes', section: 'memory' },
        { label: 'Peak Memory', value: 8501248, unit: 'bytes', section: 'memory' },
        { label: 'Fragmentation Ratio', value: 2.35, unit: 'ratio', section: 'memory' },
      ],
    }
  }

  if (nodeId.includes('clients')) {
    return {
      kind: 'clients',
      clients: [
        { id: 1, address: '127.0.0.1:55622', name: 'DataPad++ preview', ageSeconds: 120, idleSeconds: 0 },
      ],
    }
  }

  if (nodeId.includes('persistence')) {
    return {
      kind: 'persistence',
      metrics: [
        { label: 'RDB Last Save', value: '2026-05-20T12:00:00.000Z', unit: '', section: 'rdb' },
        { label: 'AOF Enabled', value: false, unit: '', section: 'aof' },
      ],
    }
  }

  if (nodeId.includes('replication')) {
    return {
      kind: 'replication',
      role: 'master',
      replicas: [],
      metrics: [
        { label: 'Connected Replicas', value: 0, unit: 'replicas', section: 'replication' },
        { label: 'Replication Offset', value: 0, unit: 'bytes', section: 'replication' },
      ],
    }
  }

  if (nodeId.includes('acl')) {
    return {
      kind: 'security',
      users: [
        {
          name: 'default',
          enabled: true,
          authentication: 'nopass',
          keyPatterns: ['*'],
          channelPatterns: ['*'],
          categories: ['@all'],
        },
      ],
      categories: [
        { name: '@all', description: 'All command categories are enabled for the default preview user.' },
      ],
    }
  }

  if (nodeId.includes('cluster')) {
    if (nodeId.includes('nodes')) {
      return {
        kind: 'cluster',
        nodes: [
          { id: '07c37dfeb2352e0b1e5', address: '127.0.0.1:6379@16379', role: 'master', linkState: 'connected', slots: ['0-5460'] },
          { id: '2a2b-preview', address: '127.0.0.1:6380@16380', role: 'replica', linkState: 'connected', slots: [] },
        ],
      }
    }

    if (nodeId.includes('slots')) {
      return {
        kind: 'cluster',
        slots: [
          { range: '0-5460', master: '127.0.0.1:6379', replicas: ['127.0.0.1:6380'], detail: '1 replica' },
        ],
      }
    }

    return {
      kind: 'cluster',
      state: 'ok',
      knownNodes: 2,
      slotsAssigned: 5461,
      nodes: [
        { id: '07c37dfeb2352e0b1e5', address: '127.0.0.1:6379@16379', role: 'master', linkState: 'connected', slots: ['0-5460'] },
      ],
      slots: [
        { range: '0-5460', master: '127.0.0.1:6379', replicas: ['127.0.0.1:6380'], detail: '1 replica' },
      ],
    }
  }

  return {
    kind: 'metadata',
    facts: [],
    warning: 'Preview metadata is deterministic. Refresh against a live connection for server-specific details.',
  }
}

function redisNode(
  connection: ConnectionProfile,
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  expandable?: boolean,
): ExplorerNode {
  return {
    id,
    family: 'keyvalue',
    label,
    kind,
    detail,
    scope,
    path: [connection.name],
    expandable,
  }
}

function redisDatabaseFromScope(scope: string) {
  const match = /^db:(\d+)/.exec(scope)
  return match?.[1] ?? '0'
}

function previewRedisKeysForType(type: string) {
  switch (type) {
    case 'hash':
      return [
        { key: 'perf:session:000143', type: 'hash', ttlSeconds: -1, memoryUsageBytes: 144, length: 4 },
        { key: 'perf:session:000561', type: 'hash', ttlSeconds: -1, memoryUsageBytes: 128, length: 4 },
      ]
    case 'zset':
      return [
        { key: 'products:inventory', type: 'zset', ttlSeconds: -1, memoryUsageBytes: 120, length: 3 },
      ]
    case 'list':
      return [
        { key: 'orders:recent', type: 'list', ttlSeconds: 600, memoryUsageBytes: 512, length: 20 },
      ]
    case 'string':
      return [
        { key: 'account:1', type: 'string', ttlSeconds: -1, memoryUsageBytes: 48, length: 1 },
      ]
    case 'keys':
      return [
        { key: 'perf:session:000143', type: 'hash', ttlSeconds: -1, memoryUsageBytes: 144, length: 4 },
        { key: 'products:inventory', type: 'zset', ttlSeconds: -1, memoryUsageBytes: 120, length: 3 },
        { key: 'account:1', type: 'string', ttlSeconds: -1, memoryUsageBytes: 48, length: 1 },
      ]
    default:
      return []
  }
}

function redisTypeFolderLabel(type: string) {
  return REDIS_BROWSER_TYPES.find((entry) => entry.kind === type)?.label ?? 'Keys'
}

function createMongoExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const database = connection.database || 'catalog'

  if (!scope) {
    return connection.database
      ? [mongoDatabaseNode(database)]
      : [
          mongoRootSectionNode('databases', 'Databases', 'User MongoDB databases'),
          mongoRootSectionNode('system-databases', 'System Databases', 'admin, config, and local'),
        ]
  }

  if (scope === 'databases') {
    return [mongoDatabaseNode(database)]
  }

  if (scope === 'system-databases') {
    return [
      mongoDatabaseNode('admin', ['System Databases'], 'System database'),
      mongoDatabaseNode('config', ['System Databases'], 'System database'),
      mongoDatabaseNode('local', ['System Databases'], 'System database'),
    ]
  }

  if (scope.startsWith('database:')) {
    const databaseName = scope.replace('database:', '') || database

    return [
      mongoSectionNode(databaseName, 'Collections', 'collections', 'Document collections'),
      mongoSectionNode(databaseName, 'Views', 'views', 'Read-only collection views'),
      mongoSectionNode(databaseName, 'Time Series Collections', 'time-series-collections', 'Time-series collections'),
      mongoSectionNode(databaseName, 'Capped Collections', 'capped-collections', 'Fixed-size capped collections'),
      mongoSectionNode(databaseName, 'GridFS', 'gridfs', 'GridFS buckets, files, and chunks'),
      mongoSectionNode(databaseName, 'Search Indexes', 'search-indexes', 'Atlas Search indexes'),
      mongoSectionNode(databaseName, 'Vector Indexes', 'vector-indexes', 'Vector search indexes'),
      mongoSectionNode(databaseName, 'Users', 'users', 'Database users'),
      mongoSectionNode(databaseName, 'Roles', 'roles', 'Database roles'),
      documentExplorerNode({
        id: `database-statistics:${databaseName}`,
        label: 'Database Statistics',
        kind: 'database-statistics',
        detail: 'Database storage and object statistics',
        path: [databaseName],
        queryTemplate: mongoCommandTemplate(databaseName, { dbStats: 1 }),
      }),
    ]
  }

  if (scope.startsWith('collections:')) {
    const databaseName = scope.replace('collections:', '') || database

    return [
      mongoCollectionNode(databaseName, 'products'),
      mongoCollectionNode(databaseName, 'orders'),
    ]
  }

  if (scope.startsWith('views:')) {
    const databaseName = scope.replace('views:', '') || database

    return [
      documentExplorerNode({
        id: `view:${databaseName}:active_products`,
        label: 'active_products',
        kind: 'view',
        detail: 'View',
        scope: `view:${databaseName}:active_products`,
        path: [databaseName, 'Views'],
        expandable: true,
        queryTemplate: documentFindTemplate(databaseName, 'active_products'),
      }),
    ]
  }

  if (scope.startsWith('time-series-collections:') || scope.startsWith('capped-collections:')) {
    return []
  }

  if (scope.startsWith('search-indexes:') || scope.startsWith('vector-indexes:')) {
    const databaseName = scope.replace(/^(search-indexes|vector-indexes):/, '') || database
    const label = scope.startsWith('search-indexes:') ? 'Search metadata unavailable' : 'Vector metadata unavailable'

    return [
      documentExplorerNode({
        id: `${scope}:unavailable`,
        label,
        kind: 'warning',
        detail: 'This metadata is available only when the connected MongoDB deployment exposes the required admin APIs.',
        path: [databaseName],
      }),
    ]
  }

  if (scope.startsWith('view:')) {
    const { databaseName, objectName } = parseMongoObjectScope(scope, 'view:', database)

    return [
      documentExplorerNode({
        id: `view-pipeline:${databaseName}:${objectName}`,
        label: 'Pipeline',
        kind: 'pipeline',
        detail: 'View pipeline',
        scope: `view-pipeline:${databaseName}:${objectName}`,
        path: [databaseName, 'Views', objectName],
        queryTemplate: mongoCommandTemplate(databaseName, { listCollections: 1, filter: { name: objectName } }),
      }),
      documentExplorerNode({
        id: `view-sample:${databaseName}:${objectName}`,
        label: 'Results Preview',
        kind: 'sample-results',
        detail: 'Open a query against this view',
        scope: `collection:${databaseName}:${objectName}`,
        path: [databaseName, 'Views', objectName],
        queryTemplate: documentFindTemplate(databaseName, objectName),
      }),
    ]
  }

  if (scope.startsWith('collection:')) {
    const { databaseName, objectName } = parseMongoObjectScope(scope, 'collection:', database)

    return [
      documentExplorerNode({
        id: `documents:${databaseName}:${objectName}`,
        label: 'Documents',
        kind: 'documents',
        detail: 'Collection documents',
        scope: `collection:${databaseName}:${objectName}`,
        path: [databaseName, 'Collections', objectName],
        queryTemplate: documentFindTemplate(databaseName, objectName),
      }),
      documentExplorerNode({
        id: `schema-preview:${databaseName}:${objectName}`,
        label: 'Schema Preview',
        kind: 'schema-preview',
        detail: 'Inferred BSON field paths',
        scope: `schema-preview:${databaseName}:${objectName}`,
        path: [databaseName, 'Collections', objectName],
        queryTemplate: documentFindTemplate(databaseName, objectName),
      }),
      documentExplorerNode({
        id: `indexes:${databaseName}:${objectName}`,
        label: 'Indexes',
        kind: 'indexes',
        detail: 'Collection indexes',
        scope: `indexes:${databaseName}:${objectName}`,
        path: [databaseName, 'Collections', objectName],
        expandable: true,
        queryTemplate: mongoCommandTemplate(databaseName, { listIndexes: objectName }),
      }),
      documentExplorerNode({
        id: `validation-rules:${databaseName}:${objectName}`,
        label: 'Validation Rules',
        kind: 'validation-rules',
        detail: 'Collection validator',
        scope: `validation-rules:${databaseName}:${objectName}`,
        path: [databaseName, 'Collections', objectName],
        queryTemplate: mongoCommandTemplate(databaseName, { listCollections: 1, filter: { name: objectName } }),
      }),
      documentExplorerNode({
        id: `aggregations:${databaseName}:${objectName}`,
        label: 'Aggregations',
        kind: 'aggregations',
        detail: 'Aggregation pipeline template',
        scope: `aggregation:${databaseName}:${objectName}`,
        path: [databaseName, 'Collections', objectName],
        queryTemplate: mongoAggregationTemplate(databaseName, objectName),
      }),
      documentExplorerNode({
        id: `collection-statistics:${databaseName}:${objectName}`,
        label: 'Statistics',
        kind: 'collection-statistics',
        detail: 'Collection stats and storage metrics',
        path: [databaseName, 'Collections', objectName],
        queryTemplate: mongoCommandTemplate(databaseName, { collStats: objectName }),
      }),
      documentExplorerNode({
        id: `collection-permissions:${databaseName}:${objectName}`,
        label: 'Permissions',
        kind: 'permissions',
        detail: 'Effective privileges when available',
        path: [databaseName, 'Collections', objectName],
        queryTemplate: mongoCommandTemplate(databaseName, { usersInfo: 1 }),
      }),
      documentExplorerNode({
        id: `collection-scripts:${databaseName}:${objectName}`,
        label: 'Scripts',
        kind: 'scripts',
        detail: 'Collection-scoped MongoDB script templates',
        path: [databaseName, 'Collections', objectName],
        queryTemplate: `db.${objectName}.find({}).limit(20)`,
      }),
    ]
  }

  if (scope.startsWith('indexes:')) {
    const { databaseName, objectName } = parseMongoObjectScope(scope, 'indexes:', database)

    return ['_id_', 'sku_1'].map((indexName) =>
      documentExplorerNode({
        id: `index:${databaseName}:${objectName}:${indexName}`,
        label: indexName,
        kind: 'index',
        detail: `Index on ${objectName}`,
        path: [databaseName, 'Collections', objectName, 'Indexes'],
        queryTemplate: mongoCommandTemplate(databaseName, { listIndexes: objectName }),
      }),
    )
  }

  if (scope.startsWith('gridfs:')) {
    const databaseName = scope.replace('gridfs:', '') || database

    return [
      mongoSectionNode(databaseName, 'Buckets', 'gridfs-buckets', 'GridFS bucket collections'),
      ...['fs.files', 'fs.chunks'].map((collection) =>
        documentExplorerNode({
          id: `gridfs:${databaseName}:${collection}`,
          label: collection === 'fs.files' ? 'Files' : 'Chunks',
          kind: 'gridfs-collection',
          detail: collection,
          scope: `collection:${databaseName}:${collection}`,
          path: [databaseName, 'GridFS'],
          queryTemplate: documentFindTemplate(databaseName, collection),
        }),
      ),
    ]
  }

  if (scope.startsWith('gridfs-buckets:')) {
    const databaseName = scope.replace('gridfs-buckets:', '') || database

    return ['fs'].map((bucket) =>
      documentExplorerNode({
        id: `gridfs-bucket:${databaseName}:${bucket}`,
        label: bucket,
        kind: 'gridfs-bucket',
        detail: 'GridFS bucket',
        path: [databaseName, 'GridFS', 'Buckets'],
        expandable: false,
      }),
    )
  }

  if (scope.startsWith('users:')) {
    const databaseName = scope.replace('users:', '') || database

    return [
      documentExplorerNode({
        id: `user:${databaseName}:fixture_reader`,
        label: 'fixture_reader',
        kind: 'user',
        detail: 'read role',
        path: [databaseName, 'Users'],
        queryTemplate: mongoCommandTemplate(databaseName, { usersInfo: 1 }),
      }),
    ]
  }

  if (scope.startsWith('roles:')) {
    const databaseName = scope.replace('roles:', '') || database

    return [
      documentExplorerNode({
        id: `role:${databaseName}:readWrite`,
        label: 'readWrite',
        kind: 'role',
        detail: 'built-in role',
        path: [databaseName, 'Roles'],
        queryTemplate: mongoCommandTemplate(databaseName, { rolesInfo: 1 }),
      }),
    ]
  }

  return []
}

function mongoDatabaseNode(label: string, path?: string[], detail = 'MongoDB database') {
  return documentExplorerNode({
    id: `database:${label}`,
    label,
    kind: 'database',
    detail,
    scope: `database:${label}`,
    path,
    expandable: true,
    queryTemplate: mongoCommandTemplate(label, { dbStats: 1 }),
  })
}

function mongoRootSectionNode(kind: 'databases' | 'system-databases', label: string, detail: string) {
  return documentExplorerNode({
    id: kind,
    label,
    kind,
    detail,
    scope: kind,
    path: undefined,
    expandable: true,
  })
}

function mongoSectionNode(database: string, label: string, kind: string, detail: string) {
  return documentExplorerNode({
    id: `${kind}:${database}`,
    label,
    kind,
    detail,
    scope: `${kind}:${database}`,
    path: [database],
    expandable: true,
  })
}

function mongoCollectionNode(database: string, collection: string) {
  return documentExplorerNode({
    id: `collection:${database}:${collection}`,
    label: collection,
    kind: 'collection',
    detail: 'Collection',
    scope: `collection:${database}:${collection}`,
    path: [database, 'Collections'],
    expandable: true,
    queryTemplate: documentFindTemplate(database, collection),
  })
}

function documentExplorerNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return {
    family: 'document',
    ...node,
  }
}

function parseMongoObjectScope(scope: string, prefix: string, fallbackDatabase: string) {
  const rest = scope.replace(prefix, '')
  const [databasePart, ...objectParts] = rest.split(':')
  const firstPart = databasePart || fallbackDatabase

  if (!objectParts.length) {
    return {
      databaseName: fallbackDatabase,
      objectName: firstPart,
    }
  }

  return {
    databaseName: databasePart || fallbackDatabase,
    objectName: objectParts.join(':') || firstPart,
  }
}

function documentFindTemplate(database: string | undefined, collection: string, limit = 20) {
  return JSON.stringify(
    {
      ...(database ? { database } : {}),
      collection,
      filter: {},
      limit,
    },
    null,
    2,
  )
}

function mongoAggregationTemplate(database: string | undefined, collection: string) {
  return JSON.stringify(
    {
      ...(database ? { database } : {}),
      collection,
      pipeline: [{ $match: {} }, { $limit: 20 }],
    },
    null,
    2,
  )
}

function mongoCommandTemplate(database: string | undefined, command: Record<string, unknown>) {
  return JSON.stringify(
    {
      ...(database ? { database } : {}),
      command,
    },
    null,
    2,
  )
}

function mongoInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const database = connection.database || 'catalog'

  if (nodeId.startsWith('database-statistics:')) {
    return mongoCommandTemplate(nodeId.replace('database-statistics:', '') || database, { dbStats: 1 })
  }

  if (nodeId.startsWith('collection-statistics:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'collection-statistics:', database)
    return mongoCommandTemplate(databaseName, { collStats: objectName })
  }

  if (nodeId.startsWith('collection-permissions:')) {
    const { databaseName } = parseMongoObjectScope(nodeId, 'collection-permissions:', database)
    return mongoCommandTemplate(databaseName, { usersInfo: 1 })
  }

  if (nodeId.startsWith('collection-scripts:')) {
    const { objectName } = parseMongoObjectScope(nodeId, 'collection-scripts:', database)
    return `db.${objectName}.find({}).limit(20)`
  }

  if (nodeId.startsWith('indexes:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'indexes:', database)
    return mongoCommandTemplate(databaseName, { listIndexes: objectName })
  }

  if (nodeId.startsWith('create-index:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'create-index:', database)
    return mongoCommandTemplate(databaseName, { listIndexes: objectName })
  }

  if (nodeId.startsWith('insert-document:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'insert-document:', database)
    return documentFindTemplate(databaseName, objectName)
  }

  if (nodeId.startsWith('validation-rules:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'validation-rules:', database)
    return mongoCommandTemplate(databaseName, { listCollections: 1, filter: { name: objectName } })
  }

  if (nodeId.startsWith('view-pipeline:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'view-pipeline:', database)
    return mongoCommandTemplate(databaseName, { listCollections: 1, filter: { name: objectName } })
  }

  if (nodeId.startsWith('users:')) {
    return mongoCommandTemplate(nodeId.replace('users:', '') || database, { usersInfo: 1 })
  }

  if (nodeId.startsWith('roles:')) {
    return mongoCommandTemplate(nodeId.replace('roles:', '') || database, { rolesInfo: 1 })
  }

  if (nodeId.startsWith('schema-preview:') || nodeId.startsWith('documents:') || nodeId.startsWith('collection:')) {
    const prefix = nodeId.startsWith('schema-preview:')
      ? 'schema-preview:'
      : nodeId.startsWith('documents:')
        ? 'documents:'
        : 'collection:'
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, prefix, database)
    return documentFindTemplate(databaseName, objectName)
  }

  return mongoCommandTemplate(database, { dbStats: 1 })
}

function mongoInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const database = connection.database || 'catalog'

  if (nodeId.startsWith('database:')) {
    const databaseName = nodeId.replace('database:', '') || database
    return {
      database: databaseName,
      collections: [
        { name: 'products', type: 'collection', documentCount: 100000 },
        { name: 'orders', type: 'collection', documentCount: 25000 },
      ],
      views: [
        { name: 'active_products', pipeline: [{ $match: { active: true } }] },
      ],
      timeSeriesCollections: [],
      cappedCollections: [],
      gridfsBuckets: [{ name: 'fs', filesCollection: 'fs.files', chunksCollection: 'fs.chunks' }],
      users: [{ user: 'fixture_reader', roles: ['read'] }],
      roles: [{ role: 'readWrite', inheritedRoles: [] }],
      statistics: {
        collections: 4,
        objects: 100000,
        storageSize: 5283840,
      },
    }
  }

  if (nodeId.startsWith('collection:') || nodeId.startsWith('documents:')) {
    const prefix = nodeId.startsWith('documents:') ? 'documents:' : 'collection:'
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, prefix, database)
    return {
      database: databaseName,
      collection: objectName,
      indexes: [
        { name: '_id_', key: { _id: 1 }, unique: true },
        { name: 'sku_1', key: { sku: 1 }, accesses: { ops: 128 } },
      ],
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['sku'],
        },
      },
      statistics: {
        count: 100000,
        storageSize: 5283840,
      },
      sampleDocuments: [
        { _id: { $oid: '64f1e7a35b6f5e1c2a917001' }, sku: 'luna-lamp', inventory: { available: 18 } },
        { _id: { $oid: '64f1e7a35b6f5e1c2a917002' }, sku: 'aurora-desk', inventory: { available: 83 } },
      ],
    }
  }

  if (nodeId.startsWith('view:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'view:', database)
    return {
      database: databaseName,
      view: objectName,
      pipeline: [{ $match: { active: true } }],
      dependencies: [{ collection: 'products' }],
    }
  }

  if (nodeId.startsWith('schema-preview:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'schema-preview:', database)
    return {
      database: databaseName,
      collection: objectName,
      sampleSize: 20,
      fields: [
        { path: '_id', type: 'objectId', typeDistribution: { objectId: 20 }, count: 20, examples: ['64f1e7a35b6f5e1c2a917001'] },
        { path: 'sku', type: 'string', typeDistribution: { string: 20 }, count: 20, examples: ['luna-lamp'] },
        { path: 'inventory.available', type: 'int32', typeDistribution: { int32: 18, int64: 2 }, count: 20, examples: [18, 83] },
        { path: 'inventory.reserved', type: 'int32', typeDistribution: { int32: 18 }, count: 18, examples: [4, 1] },
      ],
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['sku'],
        },
      },
    }
  }

  if (nodeId.startsWith('database-statistics:')) {
    const databaseName = nodeId.replace('database-statistics:', '') || database

    return {
      database: databaseName,
      collections: 4,
      objects: 100000,
      dataSize: 20583030,
      storageSize: 5283840,
      indexes: 11,
    }
  }

  if (nodeId.startsWith('collection-statistics:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'collection-statistics:', database)

    return {
      database: databaseName,
      collection: objectName,
      count: 100000,
      size: 20583030,
      avgObjSize: 205.8,
      storageSize: 5283840,
      totalIndexSize: 3436544,
    }
  }

  if (nodeId.startsWith('collection-permissions:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'collection-permissions:', database)

    return {
      database: databaseName,
      collection: objectName,
      warning: 'Effective collection-level privileges depend on the connected user permissions.',
      users: [{ user: 'fixture_reader', roles: ['read'] }],
    }
  }

  if (nodeId.startsWith('collection-scripts:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'collection-scripts:', database)

    return {
      database: databaseName,
      collection: objectName,
      scripts: [
        `db.${objectName}.find({}).limit(20)`,
        `db.${objectName}.aggregate([{ $match: {} }, { $limit: 20 }])`,
      ],
    }
  }

  if (nodeId.startsWith('indexes:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'indexes:', database)
    return {
      database: databaseName,
      collection: objectName,
      indexes: [
        { name: '_id_', key: { _id: 1 } },
        { name: 'sku_1', key: { sku: 1 } },
      ],
    }
  }

  if (nodeId.startsWith('create-index:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'create-index:', database)
    return {
      database: databaseName,
      collection: objectName,
      indexes: [
        { name: '_id_', key: { _id: 1 } },
        { name: 'sku_1', key: { sku: 1 } },
      ],
    }
  }

  if (nodeId.startsWith('insert-document:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'insert-document:', database)
    return {
      database: databaseName,
      collection: objectName,
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['sku'],
        },
      },
    }
  }

  if (nodeId.startsWith('validation-rules:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'validation-rules:', database)
    return {
      database: databaseName,
      collection: objectName,
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['sku'],
        },
      },
    }
  }

  if (nodeId.startsWith('view-pipeline:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'view-pipeline:', database)
    return {
      database: databaseName,
      view: objectName,
      pipeline: [{ $match: { status: 'active' } }],
    }
  }

  if (nodeId.startsWith('users:')) {
    return {
      database: nodeId.replace('users:', '') || database,
      users: [{ user: 'fixture_reader', roles: ['read'] }],
    }
  }

  if (nodeId.startsWith('roles:')) {
    return {
      database: nodeId.replace('roles:', '') || database,
      roles: [{ role: 'readWrite', inheritedRoles: [] }],
    }
  }

  return {
    database,
    object: nodeId,
  }
}
