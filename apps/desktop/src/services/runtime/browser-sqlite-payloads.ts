import {
  sqliteAttachedDatabases,
  sqlitePragmaRows,
  sqliteSchemaRows,
} from './browser-sqlite-fixtures'

export function sqliteInspectPayload(nodeId: string) {
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

  if (nodeId === 'maintenance:main') {
    return sqliteMaintenancePayload()
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

function sqliteMaintenancePayload() {
  return {
    engine: 'sqlite',
    schema: 'main',
    objectName: 'maintenance',
    objectView: 'maintenance',
    pageCount: 256,
    freelistCount: 0,
    quickCheckStatus: 'ok',
    checks: [
      { name: 'quick_check', status: 'ok', detail: 'No corruption was reported by the preview check.' },
      { name: 'foreign_key_check', status: 'ok', detail: 'No foreign-key violations were reported by the preview check.' },
    ],
    pragmas: sqlitePragmaRows().filter((row) =>
      ['quick_check', 'journal_mode', 'synchronous', 'page_size', 'freelist_count'].includes(row.name),
    ),
    maintenance: [
      { name: 'Optimize', scope: 'database', status: 'available', risk: 'low' },
      { name: 'Analyze', scope: 'database', status: 'available', risk: 'low' },
      { name: 'Vacuum', scope: 'database', status: 'preview', risk: 'medium' },
      { name: 'Backup', scope: 'file', status: 'preview', risk: 'medium' },
    ],
  }
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
