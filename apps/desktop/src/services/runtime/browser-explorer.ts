import type { ConnectionProfile, ExplorerInspectRequest, ExplorerInspectResponse, ExplorerNode, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import {
  createOracleExplorerNodes,
  oracleInspectPayload,
  oracleInspectQueryTemplate,
} from './browser-oracle-explorer'
import { findConnection } from './browser-store'

export function createExplorerNodes(
  connection: ConnectionProfile,
  scope?: string,
): ExplorerNode[] {
  const sqlTableListQueryForSchema = (schema: string) =>
    connection.engine === 'sqlite'
      ? `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name;`
      : `select table_name from information_schema.tables where table_schema = '${schema}' order by table_name;`

  if (connection.engine === 'mongodb') {
    return createMongoExplorerNodes(connection, scope)
  }

  if (connection.engine === 'oracle') {
    return createOracleExplorerNodes(connection, scope)
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return createRedisExplorerNodes(connection, scope)
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

  if (connection.family === 'document') {
    const database = connection.database || connection.name

    if (scope?.startsWith('collection:')) {
      const collection = scope.replace('collection:', '')

      return [
        documentExplorerNode({
          id: `indexes:${database}:${collection}`,
          label: 'Indexes',
          kind: 'indexes',
          detail: `Index definitions for ${collection}`,
          path: [database, collection],
        }),
      ]
    }

    return [
      documentExplorerNode({
        id: `collection:${database}:products`,
        label: 'products',
        kind: 'collection',
        detail: 'Documents, validators, and indexes',
        scope: `collection:${database}:products`,
        path: [database],
        expandable: true,
        queryTemplate: documentFindTemplate(database, 'products'),
      }),
    ]
  }

  if (connection.family === 'keyvalue') {
    if (scope?.startsWith('prefix:')) {
      const prefix = scope.replace('prefix:', '')

      return [
        {
          id: `${prefix}:session:9f2d7e1a`,
          family: 'keyvalue',
          label: `${prefix}9f2d7e1a`,
          kind: 'hash',
          detail: 'TTL 23m | 4.8 KB',
          path: [connection.name, prefix],
          queryTemplate: `HGETALL ${prefix}9f2d7e1a`,
        },
        {
          id: `${prefix}:session:7cc1a6f2`,
          family: 'keyvalue',
          label: `${prefix}7cc1a6f2`,
          kind: 'hash',
          detail: 'TTL 8m | 3.1 KB',
          path: [connection.name, prefix],
          queryTemplate: `HGETALL ${prefix}7cc1a6f2`,
        },
      ]
    }

    return [
      {
        id: 'prefix-session',
        family: 'keyvalue',
        label: 'session:*',
        kind: 'prefix',
        detail: 'Read-heavy session hashes',
        scope: 'prefix:session:',
        path: [connection.name],
        expandable: true,
        queryTemplate: 'SCAN 0 MATCH session:* COUNT 50',
      },
      {
        id: 'prefix-cache',
        family: 'keyvalue',
        label: 'cache:*',
        kind: 'prefix',
        detail: 'Transient cache keys',
        scope: 'prefix:cache:',
        path: [connection.name],
        expandable: true,
        queryTemplate: 'SCAN 0 MATCH cache:* COUNT 50',
      },
    ]
  }

  if (connection.engine === 'sqlite') {
    return createSqliteExplorerNodes(connection, scope)
  }

  if (scope?.startsWith('schema:')) {
    const schema = scope.replace('schema:', '')

    return [
      {
        id: `${schema}.accounts`,
        family: 'sql',
        label: 'accounts',
        kind: 'table',
        detail: 'Open a query to verify this table exists.',
        scope: `table:${schema}.accounts`,
        path: [connection.name, schema],
        expandable: true,
      },
      {
        id: `${schema}.transactions`,
        family: 'sql',
        label: 'transactions',
        kind: 'table',
        detail: 'Open a query to verify this table exists.',
        scope: `table:${schema}.transactions`,
        path: [connection.name, schema],
        expandable: true,
      },
    ]
  }

  if (scope?.startsWith('table:')) {
    const table = scope.replace('table:', '')

    return [
      {
        id: `${table}:id`,
        family: 'sql',
        label: 'id',
        kind: 'column',
        detail: 'uuid / primary key',
        path: [connection.name, table],
      },
      {
        id: `${table}:updated_at`,
        family: 'sql',
        label: 'updated_at',
        kind: 'column',
        detail: 'timestamp with timezone',
        path: [connection.name, table],
      },
    ]
  }

  const sqlSchemaNodes: ExplorerNode[] = [
    {
      id: 'schema-public',
      family: 'sql',
      label: 'public',
      kind: 'schema',
      detail: 'Core application objects',
      scope: 'schema:public',
      path: [connection.name],
      expandable: true,
      queryTemplate: sqlTableListQueryForSchema('public'),
    },
    {
      id: 'schema-observability',
      family: 'sql',
      label: 'observability',
      kind: 'schema',
      detail: 'Health and support views',
      scope: 'schema:observability',
      path: [connection.name],
      expandable: true,
      queryTemplate: sqlTableListQueryForSchema('observability'),
    },
  ]

  return [
    ...sqlSchemaNodes,
  ]
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
      : connection.engine === 'redis' || connection.engine === 'valkey'
      ? redisInspectQueryTemplate(request.nodeId)
      : connection.engine === 'cockroachdb'
      ? cockroachInspectQueryTemplate(connection, request.nodeId)
      : isPostgresLike(connection)
      ? postgresInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'sqlserver'
      ? sqlServerInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'sqlite'
      ? sqliteInspectQueryTemplate(request.nodeId)
      : request.nodeId.includes('collection')
      ? documentFindTemplate(connection.database || connection.name, 'products')
      : request.nodeId.includes('prefix') || request.nodeId.includes('session')
      ? 'SCAN 0 MATCH session:* COUNT 50'
      : 'select 1;'

  return {
    nodeId: request.nodeId,
    summary: `Inspection ready for ${request.nodeId} on ${connection.name}.`,
    queryTemplate,
    payload:
      connection.engine === 'mongodb'
        ? mongoInspectPayload(connection, request.nodeId)
        : connection.engine === 'oracle'
          ? oracleInspectPayload(connection, request.nodeId)
        : connection.engine === 'redis' || connection.engine === 'valkey'
          ? redisInspectPayload(request.nodeId)
        : connection.engine === 'cockroachdb'
          ? cockroachInspectPayload(connection, request.nodeId)
        : isPostgresLike(connection)
          ? postgresInspectPayload(connection, request.nodeId)
        : connection.engine === 'sqlserver'
          ? sqlServerInspectPayload(connection, request.nodeId)
        : connection.engine === 'sqlite'
          ? sqliteInspectPayload(request.nodeId)
        : connection.family === 'document'
          ? {
              collection: request.nodeId,
              fields: ['_id', 'sku', 'status'],
            }
        : connection.family === 'keyvalue'
          ? {
              key: request.nodeId,
              type: 'hash',
              ttl: '23m 11s',
              memoryUsage: '4.8 KB',
              preview: {
                userId: 'a1b2c3',
                region: 'eu-west-1',
              },
            }
          : {
              object: request.nodeId,
              columns: [
                { name: 'id', type: 'uuid' },
                { name: 'updated_at', type: 'timestamp with time zone' },
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
      redisNode(connection, 'redis:cluster:info', 'Cluster Info', 'cluster', 'CLUSTER INFO'),
      redisNode(connection, 'redis:cluster:nodes', 'Nodes', 'cluster-node', 'CLUSTER NODES'),
      redisNode(connection, 'redis:cluster:slots', 'Slots', 'cluster-slots', 'Hash slot allocation'),
      redisNode(connection, 'redis:cluster:failover', 'Failover Status', 'cluster-failover', 'Failover metadata'),
    ]
  }

  if (scope === 'sentinel') {
    return [
      redisNode(connection, 'redis:sentinel:masters', 'Masters', 'sentinel-masters', 'SENTINEL MASTERS'),
      redisNode(connection, 'redis:sentinel:replicas', 'Replicas', 'sentinel-replicas', 'SENTINEL REPLICAS'),
      redisNode(connection, 'redis:sentinel:sentinels', 'Sentinels', 'sentinel-peers', 'SENTINEL SENTINELS'),
      redisNode(connection, 'redis:sentinel:failover', 'Failover Status', 'sentinel-failover', 'Failover metadata'),
    ]
  }

  if (scope === 'pubsub') {
    return [
      redisNode(connection, 'redis:pubsub:channels', 'Channels', 'pubsub-channel', 'PUBSUB CHANNELS'),
      redisNode(connection, 'redis:pubsub:patterns', 'Patterns', 'pubsub-pattern', 'PUBSUB NUMPAT'),
      redisNode(connection, 'redis:pubsub:subscribers', 'Subscribers', 'pubsub-subscriber', 'PUBSUB NUMSUB'),
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
      redisNode(connection, 'redis:functions:list', 'Libraries', 'functions', 'FUNCTION LIST'),
    ]
  }

  if (scope === 'acl') {
    return [
      redisNode(connection, 'redis:acl:users', 'Users', 'users', 'ACL LIST'),
      redisNode(connection, 'redis:acl:categories', 'Categories', 'permissions', 'ACL CAT'),
      redisNode(connection, 'redis:acl:whoami', 'Current User', 'user', 'ACL WHOAMI'),
    ]
  }

  if (scope === 'diagnostics') {
    return [
      redisNode(connection, 'redis:diagnostics:info', 'INFO', 'diagnostics', 'Server INFO sections'),
      redisNode(connection, 'redis:diagnostics:slowlog', 'SLOWLOG', 'slowlog', 'Slow command log'),
      redisNode(connection, 'redis:diagnostics:commandstats', 'Command Stats', 'metrics', 'INFO commandstats'),
      redisNode(connection, 'redis:diagnostics:latency', 'Latency', 'latency', 'LATENCY LATEST'),
      redisNode(connection, 'redis:diagnostics:memory', 'Memory Analysis', 'memory', 'MEMORY STATS'),
      redisNode(connection, 'redis:diagnostics:clients', 'Clients', 'clients', 'CLIENT LIST'),
      redisNode(connection, 'redis:diagnostics:persistence', 'Persistence', 'persistence', 'INFO persistence'),
      redisNode(connection, 'redis:diagnostics:replication', 'Replication', 'replication', 'INFO replication'),
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

  if (nodeId.includes('diagnostics:info')) {
    return {
      command: 'INFO',
      text: '# Server\nredis_version:7.2.5\nuptime_in_seconds:3600\n# Clients\nconnected_clients:1\n# Memory\nused_memory:7399232\nmem_fragmentation_ratio:2.35\n# Stats\ninstantaneous_ops_per_sec:0\nkeyspace_hits:31449\nkeyspace_misses:0\n# Keyspace\ndb0:keys=40010,expires=39992,avg_ttl=720000',
    }
  }

  if (nodeId.includes('slowlog')) {
    return {
      command: 'SLOWLOG GET 128',
      value: [
        { id: 1, durationMicros: 1200, command: 'HGETALL perf:session:000143' },
      ],
    }
  }

  if (nodeId.includes('acl')) {
    return {
      command: 'ACL LIST',
      value: ['user default on nopass ~* &* +@all'],
    }
  }

  if (nodeId.includes('cluster')) {
    return {
      command: 'CLUSTER INFO',
      warning: 'Cluster commands are unavailable on this standalone preview server.',
      value: 'cluster_enabled:0',
    }
  }

  return {
    command: redisInspectQueryTemplate(nodeId),
    warning: 'Preview metadata is deterministic. Refresh against a live connection for server-specific details.',
    value: [],
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
        label: 'Sample Results',
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

  if (nodeId.startsWith('schema-preview:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'schema-preview:', database)
    return {
      database: databaseName,
      collection: objectName,
      fields: [
        { path: '_id', type: 'objectId', count: 20 },
        { path: 'sku', type: 'string', count: 20 },
        { path: 'inventory.available', type: 'int32', count: 20 },
      ],
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
