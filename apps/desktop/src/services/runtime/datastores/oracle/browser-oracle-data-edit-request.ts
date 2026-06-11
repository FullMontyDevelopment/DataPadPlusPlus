import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

export function oracleDataEditRequest(request: DataEditPlanRequest) {
  const table = oracleTableName(request)

  if (request.editKind === 'insert-row') {
    const fields = request.changes.map((change) => quoteOracleIdentifier(change.field ?? '<field>'))
    const fieldList = fields.length ? fields : [quoteOracleIdentifier('<field>')]
    const values = fieldList.map((_, index) => oracleParameter(index + 1))

    if (!isEmptyRecord(request.target.primaryKey)) {
      const predicate = oraclePrimaryKeyPredicate(request, 0)
      return [
        '-- Mutation',
        `insert into ${table} (${fieldList.join(', ')}) values (${values.join(', ')});`,
        '',
        '-- After evidence (bounded primary-key fetch)',
        `select * from ${table}${predicate} fetch first 2 rows only;`,
      ].join('\n')
    }

    return [
      '-- Mutation and ROWID evidence',
      'variable datapad_rowid varchar2(32)',
      `insert into ${table} (${fieldList.join(', ')}) values (${values.join(', ')}) returning rowid into :datapad_rowid;`,
      '',
      '-- After evidence (bounded ROWID fetch)',
      `select * from ${table} where rowid = chartorowid(:datapad_rowid) fetch first 2 rows only;`,
    ].join('\n')
  }

  if (request.editKind === 'delete-row') {
    const predicate = oraclePrimaryKeyPredicate(request, 0)
    return [
      '-- Before evidence (bounded primary-key or ROWID prefetch)',
      `select * from ${table}${predicate} fetch first 2 rows only;`,
      '',
      '-- Mutation',
      `delete from ${table}${predicate};`,
      '',
      '-- After evidence (bounded primary-key or ROWID fetch)',
      `select * from ${table}${predicate} fetch first 2 rows only;`,
    ].join('\n')
  }

  const assignments = request.changes
    .map((change, index) => `${quoteOracleIdentifier(change.field ?? '<field>')} = ${oracleParameter(index + 1)}`)
    .join(', ')
  const assignmentText = assignments || `${quoteOracleIdentifier('<field>')} = :p1`
  const beforePredicate = oraclePrimaryKeyPredicate(request, 0)
  const mutationPredicate = oraclePrimaryKeyPredicate(request, request.changes.length)

  return [
    '-- Before evidence (bounded primary-key or ROWID prefetch)',
    `select * from ${table}${beforePredicate} fetch first 2 rows only;`,
    '',
    '-- Mutation',
    `update ${table} set ${assignmentText}${mutationPredicate};`,
    '',
    '-- After evidence (bounded primary-key or ROWID fetch)',
    `select * from ${table}${beforePredicate} fetch first 2 rows only;`,
  ].join('\n')
}

function oracleTableName(request: DataEditPlanRequest) {
  const table = quoteOracleIdentifier(request.target.table ?? '<table>')
  return request.target.schema ? `${quoteOracleIdentifier(request.target.schema)}.${table}` : table
}

function oraclePrimaryKeyPredicate(request: DataEditPlanRequest, offset: number) {
  const primaryKey = request.target.primaryKey

  if (isEmptyRecord(primaryKey)) {
    return ' where <primary-key-or-rowid> = <value>'
  }

  const predicates = Object.keys(primaryKey ?? {})
    .sort()
    .map((key, index) =>
      key.toLowerCase() === 'rowid'
        ? `rowid = chartorowid(${oracleParameter(offset + index + 1)})`
        : `${quoteOracleIdentifier(key)} = ${oracleParameter(offset + index + 1)}`,
    )
    .join(' and ')

  return ` where ${predicates}`
}

function quoteOracleIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}

function oracleParameter(index: number) {
  return `:p${index}`
}

function isEmptyRecord(value?: Record<string, unknown>) {
  return !value || Object.keys(value).length === 0
}
