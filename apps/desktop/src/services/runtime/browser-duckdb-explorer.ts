import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'

type JsonRecord = Record<string, unknown>

export function createDuckDbExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const database = duckDbDatabaseName(connection)

  if (!scope) {
    return [
      duckDbNode({ id: 'duckdb:database', label: database, kind: 'database', detail: 'Local DuckDB database file', scope: 'duckdb:database', expandable: true }),
      duckDbNode({ id: 'duckdb:attached-databases', label: 'Attached Databases', kind: 'attached-databases', detail: 'Attached DuckDB files', scope: 'duckdb:attached-databases' }),
      duckDbNode({ id: 'duckdb:extensions', label: 'Extensions', kind: 'extensions', detail: 'Installed and loadable extensions', scope: 'duckdb:extensions', expandable: true }),
      duckDbNode({ id: 'duckdb:files', label: 'Files', kind: 'files', detail: 'Parquet, CSV, and JSON sources', scope: 'duckdb:files' }),
      duckDbNode({ id: 'duckdb:pragmas', label: 'Pragmas', kind: 'pragmas', detail: 'Settings and storage checks', scope: 'duckdb:pragmas' }),
      duckDbNode({ id: 'duckdb:diagnostics', label: 'Diagnostics', kind: 'diagnostics', detail: 'Memory, threads, storage, and query risk', scope: 'duckdb:diagnostics' }),
    ]
  }

  if (scope === 'duckdb:database') {
    return [
      duckDbNode({ id: 'schema:main', label: 'main', kind: 'schema', detail: 'Main DuckDB schema', path: [database, 'Schemas'], scope: 'schema:main', expandable: true }),
      duckDbNode({ id: 'schema:temp', label: 'temp', kind: 'schema', detail: 'Temporary schema', path: [database, 'Schemas'], scope: 'schema:temp', expandable: true }),
      duckDbNode({ id: 'duckdb:database:statistics', label: 'Statistics', kind: 'statistics', detail: 'Storage and table statistics', path: [database], scope: 'duckdb:statistics' }),
    ]
  }

  if (scope.startsWith('schema:')) {
    const schema = scope.replace('schema:', '') || 'main'
    return [
      duckDbNode({ id: `tables:${schema}`, label: 'Tables', kind: 'tables', detail: 'Analytical tables', path: [schema], scope: `tables:${schema}`, expandable: true }),
      duckDbNode({ id: `views:${schema}`, label: 'Views', kind: 'views', detail: 'Saved SELECT projections', path: [schema], scope: `views:${schema}`, expandable: true }),
      duckDbNode({ id: `indexes:${schema}`, label: 'Indexes', kind: 'indexes', detail: 'Secondary indexes', path: [schema], scope: `indexes:${schema}`, expandable: true }),
      duckDbNode({ id: `functions:${schema}`, label: 'Functions & Macros', kind: 'functions', detail: 'Scalar/table functions and macros', path: [schema], scope: `functions:${schema}`, expandable: true }),
    ]
  }

  if (scope.startsWith('tables:')) {
    const schema = scope.replace('tables:', '') || 'main'
    return duckDbTables(schema).map((table) =>
      duckDbNode({
        id: `table:${schema}:${table.name}`,
        label: table.name,
        kind: 'table',
        detail: `${table.rows} rows | ${table.size}`,
        path: [schema, 'Tables'],
        scope: `table:${schema}:${table.name}`,
        queryTemplate: duckDbObjectQuery(schema, table.name),
      }),
    )
  }

  if (scope.startsWith('views:')) {
    const schema = scope.replace('views:', '') || 'main'
    return duckDbViews(schema).map((view) =>
      duckDbNode({
        id: `view:${schema}:${view.name}`,
        label: view.name,
        kind: 'view',
        detail: `${view.columns} columns | ${view.dependencies}`,
        path: [schema, 'Views'],
        scope: `view:${schema}:${view.name}`,
        queryTemplate: duckDbObjectQuery(schema, view.name),
      }),
    )
  }

  if (scope.startsWith('indexes:')) {
    return duckDbIndexes().map((index) =>
      duckDbNode({ id: `index:${index.name}`, label: index.name, kind: 'index', detail: `${index.tableName} | ${index.columns}`, path: ['Indexes'], scope: `index:${index.name}` }),
    )
  }

  if (scope.startsWith('functions:')) {
    return duckDbFunctions().map((fn) =>
      duckDbNode({ id: `function:${fn.name}`, label: fn.name, kind: 'function', detail: `${fn.type} | ${fn.returns}`, path: ['Functions & Macros'], scope: `function:${fn.name}` }),
    )
  }

  if (scope === 'duckdb:extensions') {
    return duckDbExtensions().map((extension) =>
      duckDbNode({ id: `extension:${extension.name}`, label: extension.name, kind: 'extension', detail: `${extension.loaded} | ${extension.description}`, path: ['Extensions'], scope: `extension:${extension.name}` }),
    )
  }

  return []
}

export function duckDbInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('table:') || nodeId.startsWith('view:')) {
    const [, schema = 'main', objectName = 'table_name'] = nodeId.split(':')
    return duckDbObjectQuery(schema, objectName)
  }

  if (nodeId.startsWith('extension:')) {
    return 'select extension_name, loaded, installed, description from duckdb_extensions();'
  }

  if (nodeId.includes('pragma') || nodeId.includes('diagnostics')) {
    return 'select name, value from duckdb_settings();'
  }

  return 'select table_schema, table_name, table_type from information_schema.tables order by table_schema, table_name;'
}

export function duckDbInspectPayload(connection: ConnectionProfile, nodeId: string): JsonRecord {
  const base = duckDbBasePayload(connection)

  if (nodeId === 'duckdb:database' || nodeId.startsWith('schema:')) {
    return {
      ...base,
      objectView: nodeId.startsWith('schema:') ? 'schema' : 'database',
      schemas: duckDbSchemas(),
      tables: duckDbTables('main'),
      views: duckDbViews('main'),
      extensions: duckDbExtensions(),
      attachedDatabases: duckDbAttachedDatabases(connection),
      statistics: duckDbStatistics(),
      pragmas: duckDbPragmas(),
    }
  }

  if (nodeId.startsWith('table:') || nodeId === 'tables:main') {
    const table = nodeId.startsWith('table:') ? nodeId.split(':').at(-1) : undefined
    return {
      ...base,
      objectView: table ? 'table' : 'tables',
      tables: duckDbTables('main').filter((row) => !table || row.name === table),
      columns: duckDbColumns(),
      indexes: duckDbIndexes().filter((row) => !table || row.tableName === table),
      statistics: duckDbStatistics().filter((row) => !table || row.name === table),
      pragmas: duckDbPragmas(),
    }
  }

  if (nodeId.startsWith('view:') || nodeId === 'views:main') {
    const view = nodeId.startsWith('view:') ? nodeId.split(':').at(-1) : undefined
    return {
      ...base,
      objectView: view ? 'view' : 'views',
      views: duckDbViews('main').filter((row) => !view || row.name === view),
      columns: duckDbColumns(),
      dependencies: duckDbDependencies(view),
    }
  }

  if (nodeId.startsWith('index:') || nodeId === 'indexes:main') {
    const index = nodeId.startsWith('index:') ? nodeId.replace('index:', '') : undefined
    return {
      ...base,
      objectView: index ? 'index' : 'indexes',
      indexes: duckDbIndexes().filter((row) => !index || row.name === index),
      statistics: duckDbStatistics(),
    }
  }

  if (nodeId.startsWith('function:') || nodeId === 'functions:main') {
    const fn = nodeId.startsWith('function:') ? nodeId.replace('function:', '') : undefined
    return {
      ...base,
      objectView: fn ? 'function' : 'functions',
      functions: duckDbFunctions().filter((row) => !fn || row.name === fn),
      extensions: duckDbExtensions(),
    }
  }

  if (nodeId === 'duckdb:attached-databases') {
    return { ...base, objectView: 'attached-databases', attachedDatabases: duckDbAttachedDatabases(connection) }
  }

  if (nodeId === 'duckdb:extensions' || nodeId.startsWith('extension:')) {
    const extension = nodeId.startsWith('extension:') ? nodeId.replace('extension:', '') : undefined
    return {
      ...base,
      objectView: extension ? 'extension' : 'extensions',
      extensions: duckDbExtensions().filter((row) => !extension || row.name === extension),
      diagnostics: duckDbDiagnostics(),
    }
  }

  if (nodeId === 'duckdb:files') {
    return { ...base, objectView: 'files', files: duckDbFiles(), tables: duckDbTables('main'), diagnostics: duckDbDiagnostics() }
  }

  if (nodeId === 'duckdb:pragmas') {
    return { ...base, objectView: 'pragmas', pragmas: duckDbPragmas(), checks: duckDbChecks(), attachedDatabases: duckDbAttachedDatabases(connection) }
  }

  return { ...base, objectView: 'diagnostics', diagnostics: duckDbDiagnostics(), pragmas: duckDbPragmas(), statistics: duckDbStatistics() }
}

function duckDbNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return { family: 'embedded-olap', ...node }
}

function duckDbObjectQuery(schema: string, objectName: string) {
  return `select * from "${schema.replace(/"/g, '""')}"."${objectName.replace(/"/g, '""')}" limit 100;`
}

function duckDbDatabaseName(connection: ConnectionProfile) {
  return connection.database?.split(/[\\/]/).at(-1) || 'main.duckdb'
}

function duckDbBasePayload(connection: ConnectionProfile) {
  return {
    engine: 'duckdb',
    database: duckDbDatabaseName(connection),
    databaseSize: '86 MB',
    tableCount: duckDbTables('main').length,
    indexCount: duckDbIndexes().length,
    extensionCount: duckDbExtensions().filter((extension) => extension.loaded === 'loaded').length,
  }
}

function duckDbSchemas() {
  return [
    { name: 'main', owner: 'local', type: 'persistent', objectCount: 8 },
    { name: 'temp', owner: 'session', type: 'temporary', objectCount: 1 },
  ]
}

function duckDbTables(schema: string) {
  return [
    { schema, name: 'orders', type: 'BASE TABLE', rows: '1200000', size: '58 MB', owner: 'local' },
    { schema, name: 'accounts', type: 'BASE TABLE', rows: '84000', size: '12 MB', owner: 'local' },
    { schema, name: 'products', type: 'BASE TABLE', rows: '3200', size: '3 MB', owner: 'local' },
  ]
}

function duckDbViews(schema: string) {
  return [
    { schema, name: 'daily_revenue', definition: 'summarized revenue by day', status: 'valid', columns: 4, dependencies: 'orders' },
  ]
}

function duckDbColumns() {
  return [
    { name: 'id', type: 'VARCHAR', nullable: 'no', default: '-', identity: 'no', collation: '-' },
    { name: 'created_at', type: 'TIMESTAMP', nullable: 'yes', default: '-', identity: 'no', collation: '-' },
    { name: 'amount', type: 'DECIMAL(18,2)', nullable: 'yes', default: '0', identity: 'no', collation: '-' },
  ]
}

function duckDbIndexes() {
  return [
    { name: 'orders_id_idx', type: 'ART', tableName: 'orders', columns: 'id', unique: 'yes', valid: 'yes', size: '4 MB', usage: 'lookup' },
    { name: 'accounts_email_idx', type: 'ART', tableName: 'accounts', columns: 'email', unique: 'yes', valid: 'yes', size: '1 MB', usage: 'lookup' },
  ]
}

function duckDbExtensions() {
  return [
    { name: 'parquet', version: 'built-in', schema: 'system', loaded: 'loaded', installed: 'yes', description: 'Parquet scan and copy support' },
    { name: 'json', version: 'built-in', schema: 'system', loaded: 'loaded', installed: 'yes', description: 'JSON read/write support' },
    { name: 'httpfs', version: '1.0', schema: 'system', loaded: 'available', installed: 'no', description: 'HTTP/S3 file access' },
  ]
}

function duckDbAttachedDatabases(connection: ConnectionProfile) {
  return [
    { seq: 0, name: 'main', file: connection.database || ':memory:', status: 'read-write' },
    { seq: 1, name: 'temp', file: ':memory:', status: 'temporary' },
  ]
}

function duckDbFunctions() {
  return [
    { schema: 'main', name: 'normalize_sku', type: 'macro', arguments: 'sku VARCHAR', returns: 'VARCHAR', language: 'SQL' },
    { schema: 'system', name: 'read_parquet', type: 'table function', arguments: 'path VARCHAR', returns: 'TABLE', language: 'C++ extension' },
  ]
}

function duckDbFiles() {
  return [
    { name: 'orders_2026.parquet', type: 'parquet', path: './data/orders_2026.parquet', format: 'parquet', rows: '1.2 M', size: '58 MB' },
    { name: 'products.csv', type: 'csv', path: './data/products.csv', format: 'csv', rows: '3.2 K', size: '820 KB' },
  ]
}

function duckDbPragmas() {
  return [
    { name: 'memory_limit', value: '80% of system memory', status: 'ok', detail: 'Session memory guardrail' },
    { name: 'threads', value: 'auto', status: 'ok', detail: 'Parallel execution threads' },
    { name: 'enable_progress_bar', value: 'false', status: 'ok', detail: 'CLI progress display disabled' },
  ]
}

function duckDbChecks() {
  return [
    { name: 'database_check', status: 'ok', detail: 'Deterministic preview check passed' },
  ]
}

function duckDbStatistics() {
  return [
    { name: 'orders', rows: '1200000', scans: '42', lastVacuum: 'n/a', lastAnalyze: 'auto', size: '58 MB' },
    { name: 'accounts', rows: '84000', scans: '17', lastVacuum: 'n/a', lastAnalyze: 'auto', size: '12 MB' },
  ]
}

function duckDbDependencies(view?: string) {
  return view ? [{ name: view, type: 'view', referencedName: 'orders', referencedType: 'table', direction: 'depends on' }] : []
}

function duckDbDiagnostics() {
  return [
    { signal: 'Memory Limit', value: '80%', status: 'healthy', guidance: 'Adjust per session for large local joins.' },
    { signal: 'External File Access', value: 'httpfs available', status: 'watch', guidance: 'Load httpfs only when remote file access is needed.' },
    { signal: 'Broad Scan Risk', value: 'medium', status: 'watch', guidance: 'Use LIMIT, sampling, or predicates before scanning large local files.' },
  ]
}
