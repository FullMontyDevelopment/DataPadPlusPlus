import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'

type JsonRecord = Record<string, unknown>

export function createLiteDbExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      liteDbNode(connection, 'litedb:database', liteDbFileName(connection), 'database', 'Local LiteDB file overview', 'litedb:database', true),
      liteDbNode(connection, 'litedb:diagnostics', 'Diagnostics', 'diagnostics', 'File health, storage pressure, and index coverage', 'litedb:diagnostics'),
    ]
  }

  if (scope === 'litedb:database') {
    return [
      liteDbNode(connection, 'litedb:collections', 'Collections', 'collections', 'Document collections', 'litedb:collections', true),
      liteDbNode(connection, 'litedb:indexes', 'Indexes', 'indexes', 'Collection index definitions', 'litedb:indexes', true),
      liteDbNode(connection, 'litedb:file-storage', 'File Storage', 'file-storage', 'Stored files and chunks', 'litedb:file-storage', true),
      liteDbNode(connection, 'litedb:storage', 'Storage', 'storage', 'Page allocation, file size, and free-space posture', 'litedb:storage'),
      liteDbNode(connection, 'litedb:pragmas', 'Pragmas', 'pragmas', 'LiteDB file options and runtime settings', 'litedb:pragmas'),
      liteDbNode(connection, 'litedb:maintenance', 'Maintenance', 'maintenance', 'Checkpoint, compact, rebuild, and backup workflows', 'litedb:maintenance', true),
    ]
  }

  if (scope === 'litedb:collections') {
    return liteDbCollections().map((collection) =>
      liteDbNode(
        connection,
        `litedb:collection:${collection.name}`,
        collection.name,
        'collection',
        `${collection.documentCount} documents | ${collection.indexes} indexes`,
        `litedb:collection:${collection.name}`,
        true,
        liteDbCollectionQuery(collection.name),
      ),
    )
  }

  if (scope.startsWith('litedb:collection:')) {
    const collection = scope.split(':').at(-1) ?? 'products'
    return [
      liteDbNode(connection, `litedb:documents:${collection}`, 'Documents', 'documents', 'Open a bounded document query', `litedb:documents:${collection}`, false, liteDbCollectionQuery(collection)),
      liteDbNode(connection, `litedb:schema:${collection}`, 'Schema Preview', 'schema', 'Inferred field paths and types', `litedb:schema:${collection}`),
      liteDbNode(connection, `litedb:collection-indexes:${collection}`, 'Indexes', 'indexes', 'Collection index definitions', `litedb:collection-indexes:${collection}`, true),
      liteDbNode(connection, `litedb:collection-statistics:${collection}`, 'Statistics', 'statistics', 'Collection counts, index coverage, and storage signals', `litedb:collection-statistics:${collection}`),
      liteDbNode(connection, `litedb:collection-storage:${collection}`, 'Storage', 'storage', 'Collection page allocation and free-space posture', `litedb:collection-storage:${collection}`),
    ]
  }

  if (scope === 'litedb:indexes' || scope.startsWith('litedb:collection-indexes:')) {
    const collection = scope.startsWith('litedb:collection-indexes:')
      ? scope.split(':').at(-1)
      : undefined
    return liteDbIndexes()
      .filter((index) => !collection || index.collection === collection)
      .map((index) =>
        liteDbNode(
          connection,
          `litedb:index:${index.collection}:${index.name}`,
          `${index.collection}.${index.name}`,
          'index',
          `${index.expression} | ${index.unique ? 'unique' : 'non-unique'}`,
          `litedb:index:${index.collection}:${index.name}`,
        ),
      )
  }

  if (scope === 'litedb:file-storage') {
    return [
      liteDbNode(connection, 'litedb:files', 'Files', 'files', 'File metadata and chunk counts', 'litedb:files'),
      liteDbNode(connection, 'litedb:chunks', 'Chunks', 'chunks', 'Chunk distribution and missing chunks', 'litedb:chunks'),
    ]
  }

  if (scope === 'litedb:maintenance') {
    return [
      liteDbNode(connection, 'litedb:checkpoint', 'Checkpoint', 'maintenance', 'Flush pending pages without changing collection data', 'litedb:checkpoint'),
      liteDbNode(connection, 'litedb:compact', 'Compact Copy', 'maintenance', 'Create a compacted copy after backup validation', 'litedb:compact'),
      liteDbNode(connection, 'litedb:rebuild-indexes', 'Rebuild Indexes', 'maintenance', 'Rebuild collection indexes through guarded maintenance', 'litedb:rebuild-indexes'),
      liteDbNode(connection, 'litedb:backup', 'Backup', 'backup', 'Create a safe local database copy', 'litedb:backup'),
    ]
  }

  return []
}

export function liteDbInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('litedb:collection:') || nodeId.startsWith('litedb:documents:')) {
    const collection = nodeId.split(':').at(-1) ?? 'products'
    return liteDbCollectionQuery(collection)
  }

  if (nodeId.startsWith('litedb:schema:')) {
    const collection = nodeId.split(':').at(-1) ?? 'products'
    return JSON.stringify({ operation: 'Schema', collection, limit: 100 }, null, 2)
  }

  if (nodeId.startsWith('litedb:collection-statistics:')) {
    const collection = nodeId.split(':').at(-1) ?? 'products'
    return JSON.stringify({ operation: 'Statistics', collection }, null, 2)
  }

  if (nodeId === 'litedb:pragmas') {
    return JSON.stringify({ operation: 'Pragmas' }, null, 2)
  }

  if (nodeId === 'litedb:maintenance' || ['litedb:checkpoint', 'litedb:compact', 'litedb:rebuild-indexes', 'litedb:backup'].includes(nodeId)) {
    return JSON.stringify({ operation: 'Maintenance' }, null, 2)
  }

  return JSON.stringify({ operation: 'inspect', target: nodeId }, null, 2)
}

export function liteDbInspectPayload(connection: ConnectionProfile, nodeId: string): JsonRecord {
  const base = liteDbBasePayload(connection)

  if (nodeId === 'litedb:database') {
    return {
      ...base,
      objectView: 'database',
      collections: liteDbCollections(),
      indexes: liteDbIndexes(),
      files: liteDbFiles(),
      storage: liteDbStorage(),
      pragmas: liteDbPragmas(connection),
      maintenance: liteDbMaintenance(),
      settings: liteDbSettings(connection),
      diagnostics: liteDbDiagnostics(),
      warnings: liteDbWarnings(),
    }
  }

  if (nodeId === 'litedb:collections') {
    return { ...base, objectView: 'collections', collections: liteDbCollections(), diagnostics: liteDbDiagnostics() }
  }

  if (nodeId.startsWith('litedb:collection:')) {
    const collection = nodeId.split(':').at(-1) ?? 'products'
    return liteDbCollectionPayload(connection, collection, 'collection')
  }

  if (nodeId.startsWith('litedb:documents:')) {
    const collection = nodeId.split(':').at(-1) ?? 'products'
    return liteDbCollectionPayload(connection, collection, 'documents')
  }

  if (nodeId.startsWith('litedb:schema:')) {
    const collection = nodeId.split(':').at(-1) ?? 'products'
    return liteDbCollectionPayload(connection, collection, 'schema')
  }

  if (nodeId === 'litedb:indexes' || nodeId.startsWith('litedb:collection-indexes:') || nodeId.startsWith('litedb:index:')) {
    const collection = nodeId.startsWith('litedb:collection-indexes:')
      ? nodeId.split(':').at(-1)
      : nodeId.startsWith('litedb:index:')
        ? nodeId.split(':').at(-2)
        : undefined
    const index = nodeId.startsWith('litedb:index:') ? nodeId.split(':').at(-1) : undefined
    return {
      ...base,
      objectView: index ? 'index' : 'indexes',
      indexes: liteDbIndexes().filter((row) =>
        (!collection || row.collection === collection) && (!index || row.name === index),
      ),
      diagnostics: liteDbDiagnostics().filter((row) => row.signal.includes('Index')),
      warnings: liteDbWarnings(),
    }
  }

  if (nodeId === 'litedb:file-storage' || nodeId === 'litedb:files' || nodeId === 'litedb:chunks') {
    return {
      ...base,
      objectView: nodeId === 'litedb:chunks' ? 'chunks' : nodeId === 'litedb:files' ? 'files' : 'file-storage',
      files: liteDbFiles(),
      chunks: liteDbChunks(),
      diagnostics: liteDbDiagnostics().filter((row) => row.signal.includes('File') || row.signal.includes('Storage')),
    }
  }

  if (nodeId === 'litedb:storage' || nodeId.startsWith('litedb:collection-storage:')) {
    return { ...base, objectView: 'storage', storage: liteDbStorage(), diagnostics: liteDbDiagnostics(), warnings: liteDbWarnings() }
  }

  if (nodeId === 'litedb:pragmas') {
    return { ...base, objectView: 'pragmas', pragmas: liteDbPragmas(connection), settings: liteDbSettings(connection), warnings: liteDbWarnings() }
  }

  if (nodeId === 'litedb:maintenance' || ['litedb:checkpoint', 'litedb:compact', 'litedb:rebuild-indexes', 'litedb:backup'].includes(nodeId)) {
    return { ...base, objectView: 'maintenance', maintenance: liteDbMaintenance(), storage: liteDbStorage(), diagnostics: liteDbDiagnostics(), warnings: liteDbWarnings() }
  }

  if (nodeId.startsWith('litedb:collection-statistics:')) {
    const collection = nodeId.split(':').at(-1) ?? 'products'
    return {
      ...liteDbCollectionPayload(connection, collection, 'statistics'),
      statistics: liteDbCollectionStatistics(collection),
    }
  }

  if (nodeId === 'litedb:settings') {
    return { ...base, objectView: 'settings', settings: liteDbSettings(connection), warnings: liteDbWarnings() }
  }

  return { ...base, objectView: 'diagnostics', diagnostics: liteDbDiagnostics(), storage: liteDbStorage(), warnings: liteDbWarnings() }
}

function liteDbCollectionPayload(connection: ConnectionProfile, collection: string, objectView: string) {
  return {
    ...liteDbBasePayload(connection),
    objectView,
    collection,
    collections: liteDbCollections().filter((row) => row.name === collection),
    fields: liteDbFields(collection),
    indexes: liteDbIndexes().filter((row) => row.collection === collection),
    statistics: liteDbCollectionStatistics(collection),
    storage: liteDbStorage().filter((row) => row.name === 'Data pages' || row.name === 'Free pages'),
    diagnostics: liteDbDiagnostics().filter((row) => row.signal.includes('Index') || row.signal.includes('Collection')),
  }
}

function liteDbNode(
  connection: ConnectionProfile,
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  expandable?: boolean,
  queryTemplate?: string,
): ExplorerNode {
  return {
    id,
    family: 'document',
    label,
    kind,
    detail,
    scope,
    path: [liteDbFileName(connection)],
    expandable,
    queryTemplate,
  }
}

function liteDbCollectionQuery(collection: string) {
  return JSON.stringify({ collection, filter: {}, limit: 20 }, null, 2)
}

function liteDbBasePayload(connection: ConnectionProfile) {
  return {
    engine: 'litedb',
    database: liteDbFileName(connection),
    collectionCount: liteDbCollections().length,
    documentCount: liteDbCollections().reduce((sum, collection) => sum + collection.documentCount, 0),
    indexCount: liteDbIndexes().length,
    fileSize: '18.4 MB',
  }
}

function liteDbFileName(connection: ConnectionProfile) {
  return (connection.database || connection.host || 'local.db').split(/[\\/]/).filter(Boolean).at(-1) ?? 'local.db'
}

function liteDbCollections() {
  return [
    { name: 'products', documentCount: 100000, indexes: 3, avgDocumentSize: '182 B' },
    { name: 'accounts', documentCount: 428, indexes: 2, avgDocumentSize: '1.4 KB' },
    { name: 'auditLog', documentCount: 12000, indexes: 1, avgDocumentSize: '640 B' },
  ]
}

function liteDbFields(collection: string) {
  const productFields = [
    { path: '_id', types: 'ObjectId', presence: '100%', example: '66f1...', warning: '' },
    { path: 'sku', types: 'String', presence: '100%', example: 'luna-lamp', warning: '' },
    { path: 'inventory.available', types: 'Int32', presence: '97%', example: 18, warning: '' },
    { path: 'tags[]', types: 'String[]', presence: '72%', example: 'lighting', warning: 'array values' },
  ]

  if (collection === 'accounts') {
    return [
      { path: '_id', types: 'Int32', presence: '100%', example: 1, warning: '' },
      { path: 'email', types: 'String', presence: '100%', example: 'user@example.com', warning: '' },
      { path: 'status', types: 'String', presence: '100%', example: 'active', warning: '' },
    ]
  }

  return productFields
}

function liteDbIndexes() {
  return [
    { collection: 'products', name: '_id', expression: '$._id', unique: true, status: 'ready' },
    { collection: 'products', name: 'sku', expression: '$.sku', unique: true, status: 'ready' },
    { collection: 'products', name: 'inventory_available', expression: '$.inventory.available', unique: false, status: 'ready' },
    { collection: 'accounts', name: '_id', expression: '$._id', unique: true, status: 'ready' },
    { collection: 'accounts', name: 'email', expression: '$.email', unique: true, status: 'ready' },
  ]
}

function liteDbFiles() {
  return [
    { id: 'invoice/2026/001', filename: 'invoice-001.pdf', length: '86 KB', uploadDate: '2026-05-20T10:00:00Z', chunks: 2 },
    { id: 'catalog/import/products', filename: 'products.ndjson', length: '1.2 MB', uploadDate: '2026-05-21T08:00:00Z', chunks: 18 },
  ]
}

function liteDbChunks() {
  return [
    { fileId: 'invoice/2026/001', chunk: 0, size: '64 KB', status: 'ok' },
    { fileId: 'invoice/2026/001', chunk: 1, size: '22 KB', status: 'ok' },
    { fileId: 'catalog/import/products', chunk: 17, size: '48 KB', status: 'ok' },
  ]
}

function liteDbStorage() {
  return [
    { name: 'Data pages', value: 312, status: 'healthy', guidance: 'Collections fit within expected page use.' },
    { name: 'Index pages', value: 42, status: 'healthy', guidance: 'Index footprint is moderate.' },
    { name: 'Free pages', value: 18, status: 'watch', guidance: 'Consider shrink/rebuild preview after large deletes.' },
    { name: 'Journal', value: 'enabled', status: 'healthy', guidance: 'Local durability guard is enabled.' },
  ]
}

function liteDbPragmas(connection: ConnectionProfile) {
  return [
    { name: 'USER_VERSION', value: '3', source: 'database file', status: 'ready' },
    { name: 'TIMEOUT', value: '60s', source: 'database file', status: 'ready' },
    { name: 'UTC_DATE', value: 'enabled', source: 'database file', status: 'ready' },
    { name: 'COLLATION', value: 'OrdinalIgnoreCase', source: 'database file', status: 'ready' },
    { name: 'Read Only', value: Boolean(connection.readOnly), source: 'connection', status: connection.readOnly ? 'enabled' : 'writable' },
  ]
}

function liteDbMaintenance() {
  return [
    { name: 'Checkpoint', effect: 'Flush pending pages', risk: 'low', status: 'available' },
    { name: 'Compact Copy', effect: 'Write a compacted database copy', risk: 'medium', status: 'guarded' },
    { name: 'Rebuild Indexes', effect: 'Rebuild collection index structures', risk: 'medium', status: 'guarded' },
    { name: 'Backup', effect: 'Copy database file after checkpoint', risk: 'low', status: 'available' },
  ]
}

function liteDbCollectionStatistics(collection: string) {
  const row = liteDbCollections().find((candidate) => candidate.name === collection)

  return [
    { name: 'Documents', value: row?.documentCount ?? 0, scope: collection },
    { name: 'Indexes', value: row?.indexes ?? 0, scope: collection },
    { name: 'Average Document Size', value: row?.avgDocumentSize ?? '-', scope: collection },
    { name: 'Storage Pages', value: collection === 'products' ? 312 : 24, scope: collection },
  ]
}

function liteDbSettings(connection: ConnectionProfile) {
  return [
    { name: 'File', value: connection.database || connection.host || 'local.db', scope: 'local file' },
    { name: 'Mode', value: connection.connectionMode || 'local-file', scope: 'connection' },
    { name: 'Password', value: connection.auth?.secretRef ? 'stored secret' : 'not configured', scope: 'secret store' },
    { name: 'Read Only', value: connection.readOnly, scope: 'safety' },
  ]
}

function liteDbDiagnostics() {
  return [
    { signal: 'Collection Count', value: 3, status: 'healthy', guidance: 'User collections are visible.' },
    { signal: 'Index Coverage', value: '5 indexes', status: 'healthy', guidance: 'Frequently queried fields have indexes in preview metadata.' },
    { signal: 'Storage Free Pages', value: 18, status: 'watch', guidance: 'Shrink/rebuild preview may be useful after bulk deletes.' },
    { signal: 'File Storage', value: '2 files', status: 'healthy', guidance: 'File chunks are complete in preview metadata.' },
  ]
}

function liteDbWarnings() {
  return [
    'LiteDB is an embedded local file; write operations should stay guarded because they modify the file directly.',
  ]
}
