import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  documentFindTemplate,
  mongoCommandTemplate,
  parseMongoDatabaseScope,
  parseMongoObjectScopeStrict,
} from './browser-mongo-helpers'

export function mongoInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  const database = connection.database?.trim()
  const inspectFallback = () => JSON.stringify({ operation: 'inspect', target: nodeId }, null, 2)

  if (nodeId.startsWith('database-statistics:')) {
    const scopedDatabase = parseMongoDatabaseScope(nodeId, 'database-statistics:', database)
    return scopedDatabase ? mongoCommandTemplate(scopedDatabase, { dbStats: 1 }) : inspectFallback()
  }

  if (nodeId.startsWith('collection-statistics:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'collection-statistics:', database)
    return scope ? mongoCommandTemplate(scope.databaseName, { collStats: scope.objectName }) : inspectFallback()
  }

  if (nodeId.startsWith('collection-permissions:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'collection-permissions:', database)
    return scope ? mongoCommandTemplate(scope.databaseName, { usersInfo: 1 }) : inspectFallback()
  }

  if (nodeId.startsWith('collection-scripts:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'collection-scripts:', database)
    return scope ? `db.${scope.objectName}.find({}).limit(20)` : ''
  }

  if (nodeId.startsWith('indexes:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'indexes:', database)
    return scope ? mongoCommandTemplate(scope.databaseName, { listIndexes: scope.objectName }) : inspectFallback()
  }

  if (nodeId.startsWith('create-index:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'create-index:', database)
    return scope ? mongoCommandTemplate(scope.databaseName, { listIndexes: scope.objectName }) : inspectFallback()
  }

  if (nodeId.startsWith('insert-document:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'insert-document:', database)
    return scope ? documentFindTemplate(scope.databaseName, scope.objectName) : inspectFallback()
  }

  if (nodeId.startsWith('validation-rules:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'validation-rules:', database)
    return scope
      ? mongoCommandTemplate(scope.databaseName, { listCollections: 1, filter: { name: scope.objectName } })
      : inspectFallback()
  }

  if (nodeId.startsWith('view-pipeline:')) {
    const scope = parseMongoObjectScopeStrict(nodeId, 'view-pipeline:', database)
    return scope
      ? mongoCommandTemplate(scope.databaseName, { listCollections: 1, filter: { name: scope.objectName } })
      : inspectFallback()
  }

  if (nodeId.startsWith('users:')) {
    const scopedDatabase = parseMongoDatabaseScope(nodeId, 'users:', database)
    return scopedDatabase ? mongoCommandTemplate(scopedDatabase, { usersInfo: 1 }) : inspectFallback()
  }

  if (nodeId.startsWith('roles:')) {
    const scopedDatabase = parseMongoDatabaseScope(nodeId, 'roles:', database)
    return scopedDatabase ? mongoCommandTemplate(scopedDatabase, { rolesInfo: 1 }) : inspectFallback()
  }

  if (nodeId.startsWith('schema-preview:') || nodeId.startsWith('documents:') || nodeId.startsWith('collection:')) {
    const prefix = nodeId.startsWith('schema-preview:')
      ? 'schema-preview:'
      : nodeId.startsWith('documents:')
        ? 'documents:'
        : 'collection:'
    const scope = parseMongoObjectScopeStrict(nodeId, prefix, database)
    return scope ? documentFindTemplate(scope.databaseName, scope.objectName) : inspectFallback()
  }

  return database ? mongoCommandTemplate(database, { dbStats: 1 }) : inspectFallback()
}
