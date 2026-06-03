import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import {
  mysqlInformationSchemaView,
  mysqlQualifiedName,
  parseMysqlObjectScope,
} from './browser-mysql-helpers'

export function createMysqlExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const database = connection.database?.trim() || ''
  const engineLabel = connection.engine === 'mariadb' ? 'MariaDB' : 'MySQL'

  if (!scope) {
    return [
      ...(database
        ? [mysqlNode(connection, `database:${database}`, database, 'database', `${engineLabel} database`, `database:${database}`, ['Databases'], true)]
        : []),
      mysqlNode(connection, 'mysql:system-schemas', 'System Schemas', 'system-schemas', 'information_schema, mysql, performance_schema, and sys', 'mysql:system-schemas', [], true),
      mysqlNode(connection, 'mysql:security', 'Users / Privileges', 'security', 'Users, roles, and grants', 'mysql:security', [], true),
      mysqlNode(connection, 'mysql:diagnostics', 'Diagnostics', 'diagnostics', 'Sessions, replication, and status counters', 'mysql:diagnostics', [], true),
    ]
  }

  if (scope.startsWith('database:')) {
    const scopedDatabase = scope.replace('database:', '').trim() || database
    if (!scopedDatabase) return []
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
      mysqlNode(connection, 'mysql:diagnostics:slow-queries', 'Slow Queries', 'slow-queries', 'Digest latency and slow-query signals', undefined, ['Diagnostics']),
      mysqlNode(connection, 'mysql:diagnostics:innodb-status', 'InnoDB Status', 'innodb-status', 'Buffer pool, lock waits, and engine health', undefined, ['Diagnostics']),
      mysqlNode(connection, 'mysql:diagnostics:replication', 'Replication', 'replication', 'Source/replica channel health', undefined, ['Diagnostics']),
    ]
  }

  if (scope.startsWith('mysql:')) {
    const [, scopedDatabase = database, section = 'tables'] = scope.split(':')
    if (!scopedDatabase) return []
    return mysqlObjectsForSection(connection, scopedDatabase, section)
  }

  if (scope.startsWith('table:')) {
    const { database: scopedDatabase, objectName } = parseMysqlObjectScope(scope, database)
    if (!scopedDatabase || !objectName) return []
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

export function mysqlInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const database = connection.database?.trim() || ''

  if (nodeId.startsWith('table:') || nodeId.startsWith('view:')) {
    const { database: scopedDatabase, objectName } = parseMysqlObjectScope(nodeId, database)
    if (!scopedDatabase || !objectName) return 'select schema_name from information_schema.schemata order by schema_name;'
    return `select * from ${mysqlQualifiedName(scopedDatabase, objectName)} limit 100;`
  }

  if (nodeId.startsWith('table-section:')) {
    const [, scopedDatabase = database, table = '', section = 'columns'] = nodeId.split(':')
    if (!scopedDatabase || !table) return 'select schema_name from information_schema.schemata order by schema_name;'
    if (section === 'data') {
      return `select * from ${mysqlQualifiedName(scopedDatabase, table)} limit 100;`
    }
    if (section === 'indexes') {
      return `show indexes from ${mysqlQualifiedName(scopedDatabase, table)};`
    }
    return `select * from information_schema.${mysqlInformationSchemaView(section)} where table_schema = '${scopedDatabase}' and table_name = '${table}';`
  }

  if (nodeId.startsWith('procedure:') || nodeId.startsWith('function:')) {
    const { database: scopedDatabase, objectName } = parseMysqlObjectScope(nodeId, database)
    if (!scopedDatabase || !objectName) return 'select routine_schema, routine_name, routine_type from information_schema.routines order by routine_schema, routine_name;'
    return `show create ${nodeId.startsWith('function:') ? 'function' : 'procedure'} ${mysqlQualifiedName(scopedDatabase, objectName)};`
  }

  if (nodeId.startsWith('database:')) {
    const scopedDatabase = nodeId.replace('database:', '').trim() || database
    if (!scopedDatabase) return 'select schema_name from information_schema.schemata order by schema_name;'
    return `select table_name, table_type, engine from information_schema.tables where table_schema = '${scopedDatabase}' order by table_name;`
  }

  if (nodeId.includes('security')) {
    return 'select user, host, plugin, account_locked from mysql.user order by user, host;'
  }

  if (nodeId.includes('slow-queries')) {
    return 'select digest_text, count_star, avg_timer_wait, max_timer_wait, sum_rows_examined from performance_schema.events_statements_summary_by_digest order by avg_timer_wait desc limit 50;'
  }

  if (nodeId.includes('innodb-status')) {
    return 'show engine innodb status;'
  }

  if (nodeId.includes('replication')) {
    return 'show replica status;'
  }

  if (nodeId.includes('statistics')) {
    return 'show global status;'
  }

  if (nodeId.includes('diagnostics') || nodeId.includes('sessions')) {
    return 'show full processlist;'
  }

  return 'select 1;'
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
