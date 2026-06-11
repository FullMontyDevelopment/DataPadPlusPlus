import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import { sqliteAttachedDatabases } from './browser-sqlite-fixtures'

export function createSqliteExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    const nodes = [
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
    ]

    if (sqliteAttachedDatabases().some((database) => database.name !== 'main')) {
      nodes.push(
        sqliteNode(connection, {
          id: 'attached-databases',
          label: 'Attached Databases',
          kind: 'attached-databases',
          detail: 'Database files attached to this connection',
          scope: 'attached-databases',
          path: [connection.name],
          expandable: true,
        }),
      )
    }

    return nodes
  }

  if (scope === 'database:main' || scope === 'schema:main') {
    return [
      sqliteFolder(connection, 'main', 'tables', 'Tables', 'Base row-store tables'),
      sqliteFolder(connection, 'main', 'views', 'Views', 'Stored SELECT definitions'),
      sqliteFolder(connection, 'main', 'indexes', 'Indexes', 'Standalone and table indexes'),
      sqliteFolder(connection, 'main', 'triggers', 'Triggers', 'Database and table triggers'),
      sqliteNode(connection, {
        id: 'maintenance:main',
        label: 'Maintenance',
        kind: 'maintenance',
        detail: 'Integrity checks, analyze, optimize, vacuum, and backup workflows',
        path: [connection.name, 'Main Database'],
      }),
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

export function sqliteInspectQueryTemplate(nodeId: string) {
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
