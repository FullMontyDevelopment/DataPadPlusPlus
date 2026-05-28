import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import { sqlServerSourceInspectQueryTemplate } from './browser-relational-source-payloads'
import {
  isSqlServerSystemDatabase,
  parseSqlServerNodeId,
  parseSqlServerObjectScope,
  sqlServerSectionLabel,
} from './browser-sqlserver-helpers'

export function createSqlServerExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
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

export function sqlServerInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
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

  if (nodeId.includes('performance') || nodeId.includes('sessions')) {
    return `use [${database}];\nselect session_id, status, command, wait_type, blocking_session_id from sys.dm_exec_requests;`
  }

  if (nodeId.includes('locks')) {
    return `use [${database}];\nselect request_session_id, resource_type, request_mode, request_status from sys.dm_tran_locks;`
  }

  if (nodeId.includes('waits')) {
    return 'select wait_type, waiting_tasks_count, wait_time_ms, signal_wait_time_ms from sys.dm_os_wait_stats;'
  }

  if (nodeId.includes('missing-indexes')) {
    return `use [${database}];\nselect top 50 * from sys.dm_db_missing_index_details;`
  }

  if (nodeId.includes('security') || nodeId.includes('users') || nodeId.includes('roles')) {
    return `use [${database}];\nselect name, type_desc from sys.database_principals order by name;`
  }

  return `use [${database}];\nselect db_name() as database_name;`
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
    folder('performance', 'Performance', 'performance', 'Sessions, locks, waits, and tuning hints'),
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

  if (section === 'performance') {
    return [
      sqlServerNode(connection, `performance:${database}:sessions`, 'Sessions', 'sessions', 'Active sessions and requests', undefined, path),
      sqlServerNode(connection, `performance:${database}:locks`, 'Locks', 'locks', 'Locks and blocking chains', undefined, path),
      sqlServerNode(connection, `performance:${database}:waits`, 'Wait Stats', 'waits', 'Wait categories and pressure', undefined, path),
      sqlServerNode(connection, `performance:${database}:missing-indexes`, 'Missing Indexes', 'missing-indexes', 'Optimizer missing-index hints', undefined, path),
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
