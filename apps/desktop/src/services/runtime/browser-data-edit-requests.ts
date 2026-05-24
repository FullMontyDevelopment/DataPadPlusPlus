import type { ConnectionProfile, DataEditPlanRequest } from '@datapadplusplus/shared-types'

const SECRET_REPLACEMENT = '********'

export function browserDataEditWarnings(
  connection: ConnectionProfile,
  request: DataEditPlanRequest,
) {
  const warnings: string[] = []
  const target = request.target

  if ((connection.family === 'sql' || connection.family === 'embedded-olap') && !target.table) {
    warnings.push('SQL data edits need a target table.')
  }

  if (
    (connection.family === 'sql' || connection.family === 'embedded-olap') &&
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

  if (connection.family === 'widecolumn' && isEmptyRecord(target.primaryKey ?? target.itemKey)) {
    warnings.push('Wide-column edits require complete key conditions.')
  }

  if (
    request.changes.length === 0 &&
    !['delete-row', 'delete-key', 'delete-item', 'delete-document'].includes(request.editKind)
  ) {
    warnings.push('Data edits need at least one change.')
  }

  return warnings
}

export function browserDataEditPermission(
  connection: ConnectionProfile,
  request: DataEditPlanRequest,
) {
  if (connection.family === 'sql' || connection.family === 'embedded-olap') {
    return `${request.editKind} on table`
  }

  if (connection.family === 'document') {
    return request.editKind === 'insert-document'
      ? 'insert collection document'
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
  if (connection.engine === 'mongodb') {
    return mongoEditRequest(request)
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return keyValueEditRequest(request)
  }

  if (connection.engine === 'dynamodb') {
    return dynamoDbEditRequest(request)
  }

  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return searchEditRequest(request)
  }

  if (connection.engine === 'cassandra') {
    return cassandraEditRequest(request)
  }

  return sqlEditRequest(connection, request)
}

function mongoEditRequest(request: DataEditPlanRequest) {
  if (request.editKind === 'insert-document') {
    return JSON.stringify(
      {
        collection: request.target.collection ?? '<collection>',
        operation: 'insertOne',
        document: request.changes[0]?.value ?? {},
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

function keyValueEditRequest(request: DataEditPlanRequest) {
  const key = request.target.key ?? '<key>'
  const firstChange = request.changes[0]

  if (request.editKind === 'set-ttl') {
    return `EXPIRE ${key} ${valueToCommandArg(firstChange?.value ?? '<seconds>')}`
  }

  if (request.editKind === 'delete-key') {
    return `DEL ${key}`
  }

  if (request.editKind === 'hash-set-field') {
    const field = firstChange?.field ?? '<field>'
    return `HSET ${key} ${field} ${secretAwareCommandValue(field, firstChange?.value ?? '<value>')}`
  }

  if (request.editKind === 'hash-delete-field') {
    return `HDEL ${key} ${firstChange?.field ?? '<field>'}`
  }

  if (request.editKind === 'list-set-index') {
    return `LSET ${key} ${firstChange?.field ?? '<index>'} ${valueToCommandArg(firstChange?.value ?? '<value>')}`
  }

  if (request.editKind === 'set-add-member') {
    return `SADD ${key} ${valueToCommandArg(firstChange?.value ?? '<member>')}`
  }

  if (request.editKind === 'set-remove-member') {
    return `SREM ${key} ${valueToCommandArg(firstChange?.value ?? '<member>')}`
  }

  if (request.editKind === 'zset-add-member') {
    return `ZADD ${key} <score> ${firstChange?.field ?? '<member>'}`
  }

  if (request.editKind === 'zset-remove-member') {
    return `ZREM ${key} ${firstChange?.field ?? '<member>'}`
  }

  return `SET ${key} ${secretAwareCommandValue(key, firstChange?.value ?? '<value>')}`
}

function dynamoDbEditRequest(request: DataEditPlanRequest) {
  if (request.editKind === 'delete-item') {
    return JSON.stringify(
      {
        TableName: request.target.table ?? '<table>',
        Key: request.target.itemKey ?? {},
        ReturnValues: 'ALL_OLD',
      },
      null,
      2,
    )
  }

  if (request.editKind === 'put-item') {
    return JSON.stringify(
      {
        TableName: request.target.table ?? '<table>',
        Item: request.changes[0]?.value ?? {},
        ReturnValues: 'NONE',
      },
      null,
      2,
    )
  }

  return JSON.stringify(
    {
      TableName: request.target.table ?? '<table>',
      Key: request.target.itemKey ?? {},
      UpdateExpression: 'SET #field = :value',
      ExpressionAttributeNames: { '#field': request.changes[0]?.field ?? '<field>' },
      ExpressionAttributeValues: {
        ':value': secretAwareJsonValue(
          request.changes[0]?.field ?? '<field>',
          request.changes[0]?.value ?? '<value>',
        ),
      },
      ReturnValues: 'ALL_NEW',
    },
    null,
    2,
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
  if (engine === 'sqlserver') {
    return ['[', ']'] as const
  }

  if (engine === 'mysql' || engine === 'mariadb') {
    return ['`', '`'] as const
  }

  return ['"', '"'] as const
}

function quoteIdentifier(identifier: string, [start, end]: readonly [string, string]) {
  return `${start}${identifier.replaceAll(end, `${end}${end}`)}${end}`
}

function sqlParameter(engine: ConnectionProfile['engine'], index: number) {
  return engine === 'sqlserver' ? `@p${index}` : '?'
}

function dataEditPath(field?: string, path?: string[]) {
  return path?.length ? path.join('.') : field ?? '<field>'
}

function isEmptyRecord(value?: Record<string, unknown>) {
  return !value || Object.keys(value).length === 0
}

function valueToCommandArg(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function secretAwareCommandValue(name: string, value: unknown) {
  return isSecretLikeName(name) ? SECRET_REPLACEMENT : valueToCommandArg(value)
}

function secretAwareJsonValue(name: string, value: unknown) {
  return isSecretLikeName(name) ? SECRET_REPLACEMENT : value
}

function isSecretLikeName(value: string) {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')
  return /(^|_)(password|pwd|pass|token|secret|secretkey|apikey|api_key|authtoken|auth_token|accesstoken|access_token)($|_)/.test(normalized)
}
