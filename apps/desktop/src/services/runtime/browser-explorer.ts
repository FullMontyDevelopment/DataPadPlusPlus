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

  if (connection.engine === 'sqlserver') {
    sqlSchemaNodes.push({
      id: 'schema-dbo',
      family: 'sql',
      label: 'dbo',
      kind: 'schema',
      detail: 'Default SQL Server schema',
      scope: 'schema:dbo',
      path: [connection.name],
      expandable: true,
      queryTemplate: sqlTableListQueryForSchema('dbo'),
    })
  }

  return [
    ...sqlSchemaNodes,
  ]
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
