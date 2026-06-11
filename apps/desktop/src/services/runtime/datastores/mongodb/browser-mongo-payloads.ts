import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  parseMongoDatabaseScope,
  parseMongoObjectScopeStrict,
} from './browser-mongo-helpers'

export function mongoInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const database = connection.database?.trim()

  if (nodeId.startsWith('database:')) {
    const databaseName = parseMongoDatabaseScope(nodeId, 'database:', database)
    if (!databaseName) {
      return emptyMongoPayload(database, nodeId, 'database')
    }
    return {
      database: databaseName,
      collections: [
        { name: 'products', type: 'collection', documentCount: 100000 },
        { name: 'orders', type: 'collection', documentCount: 25000 },
      ],
      views: [
        { name: 'active_products', pipeline: [{ $match: { active: true } }] },
      ],
      timeSeriesCollections: [],
      cappedCollections: [],
      gridfsBuckets: [{ name: 'fs', filesCollection: 'fs.files', chunksCollection: 'fs.chunks' }],
      users: [{ user: 'fixture_reader', roles: ['read'] }],
      roles: [{ role: 'readWrite', inheritedRoles: [] }],
      statistics: {
        collections: 4,
        objects: 100000,
        storageSize: 5283840,
      },
    }
  }

  if (nodeId.startsWith('collection:') || nodeId.startsWith('documents:')) {
    const prefix = nodeId.startsWith('documents:') ? 'documents:' : 'collection:'
    const scope = parseMongoObjectScopeStrict(nodeId, prefix, database)
    if (!scope) {
      return emptyMongoPayload(database, nodeId, 'collection')
    }
    const { databaseName, objectName } = scope
    return {
      database: databaseName,
      collection: objectName,
      indexes: [
        { name: '_id_', key: { _id: 1 }, unique: true },
        { name: 'sku_1', key: { sku: 1 }, accesses: { ops: 128 } },
      ],
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['sku'],
        },
      },
      statistics: {
        count: 100000,
        storageSize: 5283840,
      },
      sampleDocuments: [
        { _id: { $oid: '64f1e7a35b6f5e1c2a917001' }, sku: 'luna-lamp', inventory: { available: 18 } },
        { _id: { $oid: '64f1e7a35b6f5e1c2a917002' }, sku: 'aurora-desk', inventory: { available: 83 } },
      ],
    }
  }

  if (nodeId.startsWith('view:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'view:', database)
    if (!scope) {
      return emptyMongoPayload(database, nodeId, 'view')
    }
    const { databaseName, objectName } = scope
    return {
      database: databaseName,
      view: objectName,
      pipeline: [{ $match: { active: true } }],
      dependencies: [{ collection: 'products' }],
    }
  }

  if (nodeId.startsWith('schema-preview:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'schema-preview:', database)
    if (!scope) {
      return emptyMongoPayload(database, nodeId, 'schema')
    }
    const { databaseName, objectName } = scope
    return {
      database: databaseName,
      collection: objectName,
      sampleSize: 20,
      fields: [
        { path: '_id', type: 'objectId', typeDistribution: { objectId: 20 }, count: 20, examples: ['64f1e7a35b6f5e1c2a917001'] },
        { path: 'sku', type: 'string', typeDistribution: { string: 20 }, count: 20, examples: ['luna-lamp'] },
        { path: 'inventory.available', type: 'int32', typeDistribution: { int32: 18, int64: 2 }, count: 20, examples: [18, 83] },
        { path: 'inventory.reserved', type: 'int32', typeDistribution: { int32: 18 }, count: 18, examples: [4, 1] },
      ],
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['sku'],
        },
      },
    }
  }

  if (nodeId.startsWith('database-statistics:')) {
    const databaseName = parseMongoDatabaseScope(nodeId, 'database-statistics:', database)
    if (!databaseName) {
      return emptyMongoPayload(database, nodeId, 'database-statistics')
    }

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
    const scope = parseMongoObjectScopeStrict(nodeId, 'collection-statistics:', database)
    if (!scope) {
      return emptyMongoPayload(database, nodeId, 'collection-statistics')
    }
    const { databaseName, objectName } = scope

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
    const scope = parseMongoObjectScopeStrict(nodeId, 'collection-permissions:', database)
    if (!scope) {
      return emptyMongoPayload(database, nodeId, 'permissions')
    }
    const { databaseName, objectName } = scope

    return {
      database: databaseName,
      collection: objectName,
      warning: 'Effective collection-level privileges depend on the connected user permissions.',
      users: [{ user: 'fixture_reader', roles: ['read'] }],
    }
  }

  if (nodeId.startsWith('collection-scripts:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'collection-scripts:', database)
    if (!scope) {
      return emptyMongoPayload(database, nodeId, 'scripts')
    }
    const { databaseName, objectName } = scope

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
    const scope = parseMongoObjectScopeStrict(nodeId, 'indexes:', database)
    if (!scope) {
      return emptyMongoPayload(database, nodeId, 'indexes')
    }
    const { databaseName, objectName } = scope
    return {
      database: databaseName,
      collection: objectName,
      indexes: [
        { name: '_id_', key: { _id: 1 } },
        { name: 'sku_1', key: { sku: 1 } },
      ],
    }
  }

  if (nodeId.startsWith('create-index:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'create-index:', database)
    if (!scope) {
      return emptyMongoPayload(database, nodeId, 'create-index')
    }
    const { databaseName, objectName } = scope
    return {
      database: databaseName,
      collection: objectName,
      indexes: [
        { name: '_id_', key: { _id: 1 } },
        { name: 'sku_1', key: { sku: 1 } },
      ],
    }
  }

  if (nodeId.startsWith('insert-document:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'insert-document:', database)
    if (!scope) {
      return emptyMongoPayload(database, nodeId, 'insert-document')
    }
    const { databaseName, objectName } = scope
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

  if (nodeId.startsWith('validation-rules:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'validation-rules:', database)
    if (!scope) {
      return emptyMongoPayload(database, nodeId, 'validation-rules')
    }
    const { databaseName, objectName } = scope
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
    const scope = parseMongoObjectScopeStrict(nodeId, 'view-pipeline:', database)
    if (!scope) {
      return emptyMongoPayload(database, nodeId, 'pipeline')
    }
    const { databaseName, objectName } = scope
    return {
      database: databaseName,
      view: objectName,
      pipeline: [{ $match: { status: 'active' } }],
    }
  }

  if (nodeId.startsWith('users:')) {
    const databaseName = parseMongoDatabaseScope(nodeId, 'users:', database)
    if (!databaseName) {
      return emptyMongoPayload(database, nodeId, 'users')
    }
    return {
      database: databaseName,
      users: [{ user: 'fixture_reader', roles: ['read'] }],
    }
  }

  if (nodeId.startsWith('roles:')) {
    const databaseName = parseMongoDatabaseScope(nodeId, 'roles:', database)
    if (!databaseName) {
      return emptyMongoPayload(database, nodeId, 'roles')
    }
    return {
      database: databaseName,
      roles: [{ role: 'readWrite', inheritedRoles: [] }],
    }
  }

  return emptyMongoPayload(database, nodeId, 'metadata')
}

function emptyMongoPayload(database: string | undefined, nodeId: string, objectView: string) {
  return {
    database: database ?? '',
    object: nodeId,
    objectView,
    collections: [],
    views: [],
    indexes: [],
    users: [],
    roles: [],
    fields: [],
    warnings: ['Select a MongoDB object or refresh metadata to inspect this view.'],
  }
}
