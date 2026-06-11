import type { ConnectionProfile, DataEditPlanRequest } from '@datapadplusplus/shared-types'

export function sqlDataEditRequest(
  connection: ConnectionProfile,
  request: DataEditPlanRequest,
) {
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

function isEmptyRecord(value?: Record<string, unknown>) {
  return !value || Object.keys(value).length === 0
}
