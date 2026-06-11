import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import {
  documentExplorerNode,
  documentFindTemplate,
  mongoAggregationTemplate,
  mongoCommandTemplate,
  parseMongoObjectScope,
} from './browser-mongo-helpers'

export function createMongoExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const database = connection.database?.trim()

  if (!scope) {
    return database
      ? [mongoDatabaseNode(database)]
      : [
          mongoRootSectionNode('databases', 'Databases', 'User MongoDB databases'),
          mongoRootSectionNode('system-databases', 'System Databases', 'admin, config, and local'),
        ]
  }

  if (scope === 'databases') {
    return database ? [mongoDatabaseNode(database)] : []
  }

  if (scope === 'system-databases') {
    return [
      mongoDatabaseNode('admin', ['System Databases'], 'System database'),
      mongoDatabaseNode('config', ['System Databases'], 'System database'),
      mongoDatabaseNode('local', ['System Databases'], 'System database'),
    ]
  }

  if (scope.startsWith('database:')) {
    const databaseName = scope.replace('database:', '').trim() || database
    if (!databaseName) return []

    return [
      mongoSectionNode(databaseName, 'Collections', 'collections', 'Document collections'),
      mongoSectionNode(databaseName, 'Views', 'views', 'Read-only collection views'),
      mongoSectionNode(databaseName, 'GridFS', 'gridfs', 'GridFS buckets, files, and chunks'),
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
    const databaseName = scope.replace('collections:', '').trim() || database
    if (!databaseName) return []

    return [
      mongoCollectionNode(databaseName, 'products'),
      mongoCollectionNode(databaseName, 'orders'),
    ]
  }

  if (scope.startsWith('views:')) {
    const databaseName = scope.replace('views:', '').trim() || database
    if (!databaseName) return []

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

  if (scope.startsWith('view:')) {
    const { databaseName, objectName } = parseMongoObjectScope(scope, 'view:', database ?? '')
    if (!databaseName || !objectName) return []

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
        id: `view-results:${databaseName}:${objectName}`,
        label: 'Results Preview',
        kind: 'view-results',
        detail: 'Open a query against this view',
        scope: `collection:${databaseName}:${objectName}`,
        path: [databaseName, 'Views', objectName],
        queryTemplate: documentFindTemplate(databaseName, objectName),
      }),
    ]
  }

  if (scope.startsWith('collection:')) {
    const { databaseName, objectName } = parseMongoObjectScope(scope, 'collection:', database ?? '')
    if (!databaseName || !objectName) return []

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
    const { databaseName, objectName } = parseMongoObjectScope(scope, 'indexes:', database ?? '')
    if (!databaseName || !objectName) return []

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
    const databaseName = scope.replace('gridfs:', '').trim() || database
    if (!databaseName) return []

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
    const databaseName = scope.replace('gridfs-buckets:', '').trim() || database
    if (!databaseName) return []

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
    const databaseName = scope.replace('users:', '').trim() || database
    if (!databaseName) return []

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
    const databaseName = scope.replace('roles:', '').trim() || database
    if (!databaseName) return []

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
