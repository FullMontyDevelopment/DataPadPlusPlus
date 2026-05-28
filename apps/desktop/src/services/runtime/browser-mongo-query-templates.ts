import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  documentFindTemplate,
  mongoCommandTemplate,
  parseMongoObjectScope,
} from './browser-mongo-helpers'

export function mongoInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
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

  if (nodeId.startsWith('create-index:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'create-index:', database)
    return mongoCommandTemplate(databaseName, { listIndexes: objectName })
  }

  if (nodeId.startsWith('insert-document:')) {
    const { databaseName, objectName } = parseMongoObjectScope(nodeId, 'insert-document:', database)
    return documentFindTemplate(databaseName, objectName)
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
