import type { ConnectionProfile, DataEditPlanRequest } from '@datapadplusplus/shared-types'
import {
  dynamoDbDataEditRequest,
  dynamoDbDataEditWarnings,
} from './browser-dynamodb-data-edit-request'
import { keyValueEditRequest } from './browser-keyvalue-edit-request'
import { liteDbEditRequest } from './browser-litedb-data-edit-request'
import { oracleDataEditRequest } from './browser-oracle-data-edit-request'
import {
  timescaleDataEditRequest,
  timescaleDataEditWarnings,
} from './browser-timescale-data-edit-request'

export function browserDataEditWarnings(
  connection: ConnectionProfile,
  request: DataEditPlanRequest,
) {
  const warnings: string[] = []
  const target = request.target

  if (isSqlRowEditConnection(connection) && !target.table) {
    warnings.push('SQL data edits need a target table.')
  }

  if (connection.engine === 'timescaledb') {
    warnings.push(...timescaleDataEditWarnings(request))
  }

  if (
    isSqlRowEditConnection(connection) &&
    ['update-row', 'delete-row'].includes(request.editKind) &&
    isEmptyRecord(target.primaryKey)
  ) {
    warnings.push('SQL update/delete edits require a complete primary key predicate.')
  }

  if (connection.family === 'document') {
    if (!target.collection) {
      warnings.push('Document edits need a target collection.')
    }
    if (request.editKind !== 'insert-document' && target.documentId === undefined) {
      warnings.push('Document edits require a stable document id.')
    }
  }

  if (connection.family === 'keyvalue' && !target.key) {
    warnings.push('Key/value edits need a single concrete key.')
  }

  if (
    connection.family === 'keyvalue' &&
    request.editKind === 'stream-delete-entry' &&
    target.documentId === undefined &&
    request.changes.every((change) => !(change.field?.trim() || change.path?.[0]?.trim()))
  ) {
    warnings.push('Stream entry deletes need a concrete entry id.')
  }

  if (
    connection.family === 'keyvalue' &&
    request.editKind === 'timeseries-delete-sample' &&
    target.documentId === undefined &&
    request.changes.every((change) => !(change.field?.trim() || change.path?.[0]?.trim() || change.value !== undefined))
  ) {
    warnings.push('TimeSeries sample deletes need a concrete timestamp or range.')
  }

  if (
    connection.family === 'keyvalue' &&
    request.editKind === 'vector-remove-member' &&
    target.documentId === undefined &&
    request.changes.every((change) => !(change.field?.trim() || change.path?.[0]?.trim()))
  ) {
    warnings.push('Vector member removal needs a concrete element name.')
  }

  if (connection.family === 'widecolumn' && isEmptyRecord(target.primaryKey ?? target.itemKey)) {
    warnings.push('Wide-column edits require complete key conditions.')
  }

  if (connection.engine === 'dynamodb') {
    warnings.push(...dynamoDbDataEditWarnings(request))
  }

  if (
    request.changes.length === 0 &&
    !['delete-row', 'delete-key', 'stream-delete-entry', 'timeseries-delete-sample', 'vector-remove-member', 'delete-item', 'delete-document', 'persist-ttl'].includes(request.editKind)
  ) {
    warnings.push('Data edits need at least one change.')
  }

  return warnings
}

export function browserDataEditPermission(
  connection: ConnectionProfile,
  request: DataEditPlanRequest,
) {
  if (isSqlRowEditConnection(connection)) {
    return `${request.editKind} on table`
  }

  if (connection.family === 'document') {
    return request.editKind === 'insert-document'
      ? 'insert collection document'
      : request.editKind === 'delete-document'
        ? 'delete collection document'
      : 'update collection document'
  }

  if (connection.family === 'keyvalue') {
    return 'write concrete key'
  }

  if (connection.family === 'widecolumn') {
    return 'write item/row with complete key'
  }

  return 'adapter-specific write permission'
}

export function browserDataEditRequest(
  connection: ConnectionProfile,
  request: DataEditPlanRequest,
) {
  if (connection.engine === 'litedb') {
    return liteDbEditRequest(request)
  }

  if (connection.engine === 'mongodb') {
    return mongoEditRequest(request)
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return keyValueEditRequest(request)
  }

  if (connection.engine === 'dynamodb') {
    return dynamoDbDataEditRequest(request)
  }

  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return searchEditRequest(request)
  }

  if (connection.engine === 'cassandra') {
    return cassandraEditRequest(request)
  }

  if (connection.engine === 'timescaledb') {
    return timescaleDataEditRequest(request)
  }

  if (connection.engine === 'oracle') {
    return oracleDataEditRequest(request)
  }

  return sqlEditRequest(connection, request)
}

function mongoEditRequest(request: DataEditPlanRequest) {
  if (request.editKind === 'insert-document') {
    return JSON.stringify(
      {
        database: request.target.database ?? '<database>',
        collection: request.target.collection ?? '<collection>',
        operation: 'insertOne',
        document: request.changes[0]?.value ?? {},
      },
      null,
      2,
    )
  }

  if (request.editKind === 'delete-document') {
    return JSON.stringify(
      {
        database: request.target.database ?? '<database>',
        collection: request.target.collection ?? '<collection>',
        operation: 'deleteOne',
        filter: { _id: request.target.documentId ?? '<_id>' },
      },
      null,
      2,
    )
  }

  if (request.editKind === 'update-document') {
    return JSON.stringify(
      {
        database: request.target.database ?? '<database>',
        collection: request.target.collection ?? '<collection>',
        operation: 'replaceOne',
        filter: { _id: request.target.documentId ?? '<_id>' },
        replacement: request.changes[0]?.value ?? {},
      },
      null,
      2,
    )
  }

  const update =
    request.editKind === 'unset-field'
      ? { $unset: documentPathObject(request, '') }
      : request.editKind === 'rename-field'
        ? { $rename: documentRenameObject(request) }
        : { $set: documentValueObject(request) }

  return JSON.stringify(
    {
      database: request.target.database ?? '<database>',
      collection: request.target.collection ?? '<collection>',
      filter: { _id: request.target.documentId ?? '<_id>' },
      update,
      multi: false,
    },
    null,
    2,
  )
}

function documentValueObject(request: DataEditPlanRequest) {
  return Object.fromEntries(
    request.changes.map((change) => [
      dataEditPath(change.field, change.path),
      change.value ?? null,
    ]),
  )
}

function documentPathObject(request: DataEditPlanRequest, value: string) {
  return Object.fromEntries(request.changes.map((change) => [dataEditPath(change.field, change.path), value]))
}

function documentRenameObject(request: DataEditPlanRequest) {
  return Object.fromEntries(
    request.changes.map((change) => {
      const path = dataEditPath(change.field, change.path)
      return [path, change.newName ?? path]
    }),
  )
}

function searchEditRequest(request: DataEditPlanRequest) {
  const index = request.target.table ?? '<index>'
  const documentId = request.target.documentId ?? '<document-id>'

  if (request.editKind === 'delete-document') {
    return `DELETE /${index}/_doc/${documentId}?refresh=true`
  }

  const document = request.changes[0]?.value ?? Object.fromEntries(
    request.changes.map((change) => [change.field ?? dataEditPath(change.field, change.path), change.value ?? null]),
  )

  if (request.editKind === 'update-document') {
    return JSON.stringify(
      {
        method: 'POST',
        path: `/${index}/_update/${documentId}?refresh=true`,
        body: { doc: document },
      },
      null,
      2,
    )
  }

  return JSON.stringify(
    {
      method: 'PUT',
      path: `/${index}/_doc/${documentId}?refresh=true`,
      body: document,
    },
    null,
    2,
  )
}

function cassandraEditRequest(request: DataEditPlanRequest) {
  const assignments = request.changes
    .map((change) => `${change.field ?? '<field>'} = ?`)
    .join(', ')
  const predicates = Object.keys(request.target.primaryKey ?? {})
    .map((key) => `${key} = ?`)
    .join(' and ')

  return `update ${request.target.schema ?? '<keyspace>'}.${request.target.table ?? '<table>'} set ${assignments || '<field> = ?'} where ${predicates || '<complete_primary_key> = ?'};`
}

function sqlEditRequest(connection: ConnectionProfile, request: DataEditPlanRequest) {
  const quote = sqlQuotePair(connection.engine)
  const table = request.target.schema
    ? `${quoteIdentifier(request.target.schema, quote)}.${quoteIdentifier(request.target.table ?? '<table>', quote)}`
    : quoteIdentifier(request.target.table ?? '<table>', quote)
  const whereClause = sqlPrimaryKeyPredicate(connection, request)

  if (request.editKind === 'insert-row') {
    const fields = request.changes.map((change) => quoteIdentifier(change.field ?? '<field>', quote))
    const values = fields.map((_, index) => sqlParameter(connection.engine, index + 1))
    return `insert into ${table} (${fields.join(', ')}) values (${values.join(', ')});`
  }

  if (request.editKind === 'delete-row') {
    return `delete from ${table}${whereClause};`
  }

  const assignments = request.changes
    .map((change, index) => `${quoteIdentifier(change.field ?? '<field>', quote)} = ${sqlParameter(connection.engine, index + 1)}`)
    .join(', ')

  return `update ${table} set ${assignments || `${quoteIdentifier('<field>', quote)} = ${sqlParameter(connection.engine, 1)}`}${whereClause};`
}

function sqlPrimaryKeyPredicate(connection: ConnectionProfile, request: DataEditPlanRequest) {
  const quote = sqlQuotePair(connection.engine)
  const primaryKey = request.target.primaryKey

  if (isEmptyRecord(primaryKey)) {
    return ' where <primary-key> = <value>'
  }

  const offset = request.changes.length
  const predicates = Object.keys(primaryKey ?? {})
    .map((key, index) => `${quoteIdentifier(key, quote)} = ${sqlParameter(connection.engine, offset + index + 1)}`)
    .join(' and ')

  return ` where ${predicates}`
}

function sqlQuotePair(engine: ConnectionProfile['engine']) {
  if (engine === 'sqlserver') return ['[', ']'] as const
  if (engine === 'mysql' || engine === 'mariadb') return ['`', '`'] as const
  return ['"', '"'] as const
}

function quoteIdentifier(identifier: string, [start, end]: readonly [string, string]) {
  return `${start}${identifier.replaceAll(end, `${end}${end}`)}${end}`
}

function sqlParameter(engine: ConnectionProfile['engine'], index: number) {
  return engine === 'sqlserver' ? `@p${index}` : '?'
}

function isSqlRowEditConnection(connection: ConnectionProfile) {
  return connection.family === 'sql' || connection.family === 'embedded-olap' || connection.engine === 'timescaledb'
}

function dataEditPath(field?: string, path?: string[]) {
  return path?.length ? path.join('.') : field ?? '<field>'
}

function isEmptyRecord(value?: Record<string, unknown>) {
  return !value || Object.keys(value).length === 0
}
