import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import {
  cockroachSectionLabel,
  isPostgresSystemSchema,
  parsePostgresObjectScope,
  postgresSectionLabel,
} from './browser-postgres-family-helpers'

export function createCockroachExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
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

export function createPostgresExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      postgresNode(connection, 'schema:public', 'public', 'schema', 'User schema', 'schema:public', ['User Schemas'], true),
      postgresNode(connection, 'schema:observability', 'observability', 'schema', 'User schema', 'schema:observability', ['User Schemas'], true),
      postgresNode(connection, 'schema:pg_catalog', 'pg_catalog', 'schema', 'System schema', 'schema:pg_catalog', ['System Schemas'], true),
      postgresNode(connection, 'postgres:security', 'Security', 'security', 'Roles, grants, and privileges', 'postgres:security', [], true),
      postgresNode(connection, 'postgres:diagnostics', 'Diagnostics', 'diagnostics', 'Sessions, locks, waits, statements, and relation health', 'postgres:diagnostics', [], true),
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
        postgresNode(connection, 'postgres:diagnostics:waits', 'Wait Events', 'waits', 'Wait event categories and pressure', undefined, ['Diagnostics']),
        postgresNode(connection, 'postgres:diagnostics:statements', 'Statement Stats', 'statements', 'pg_stat_statements summaries where available', undefined, ['Diagnostics']),
        postgresNode(connection, 'postgres:diagnostics:statistics', 'Relation Statistics', 'statistics', 'pg_stat relation and database stats', undefined, ['Diagnostics']),
        postgresNode(connection, 'postgres:diagnostics:index-health', 'Index Health', 'index-health', 'Index usage and maintenance signals', undefined, ['Diagnostics']),
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
