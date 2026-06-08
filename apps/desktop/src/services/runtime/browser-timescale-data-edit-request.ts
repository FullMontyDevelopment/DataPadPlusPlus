import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

export function timescaleDataEditRequest(request: DataEditPlanRequest) {
  const table = timescaleTableName(request)

  if (request.editKind === 'insert-row') {
    const fields = request.changes.map((change) => quoteIdentifier(change.field ?? '<field>'))
    const fieldList = fields.length ? fields : [quoteIdentifier('<field>')]
    const values = fieldList.map((_, index) => `$${index + 1}`)

    return [
      '-- Mutation and after evidence (RETURNING *)',
      `insert into ${table} (${fieldList.join(', ')}) values (${values.join(', ')}) returning *;`,
    ].join('\n')
  }

  if (request.editKind === 'delete-row') {
    const predicate = timescalePrimaryKeyPredicate(request, 0)

    return [
      '-- Before evidence (bounded primary-key prefetch)',
      `select * from ${table} where ${predicate} limit 2;`,
      '',
      '-- Mutation and after evidence (RETURNING *)',
      `delete from ${table} where ${predicate} returning *;`,
    ].join('\n')
  }

  const assignments = request.changes
    .map((change, index) => `${quoteIdentifier(change.field ?? '<field>')} = $${index + 1}`)
    .join(', ')
  const assignmentText = assignments || `${quoteIdentifier('<field>')} = $1`
  const beforePredicate = timescalePrimaryKeyPredicate(request, 0)
  const mutationPredicate = timescalePrimaryKeyPredicate(request, request.changes.length)

  return [
    '-- Before evidence (bounded primary-key prefetch)',
    `select * from ${table} where ${beforePredicate} limit 2;`,
    '',
    '-- Mutation and after evidence (RETURNING *)',
    `update ${table} set ${assignmentText} where ${mutationPredicate} returning *;`,
  ].join('\n')
}

export function timescaleDataEditWarnings(request: DataEditPlanRequest) {
  if (!['insert-row', 'update-row', 'delete-row'].includes(request.editKind)) {
    return []
  }

  return [
    'TimescaleDB row edits use PostgreSQL-wire primary-key prefetches and RETURNING * before/after evidence; chunk, compression, retention, and continuous aggregate policy changes stay in guarded operation previews.',
  ]
}

function timescaleTableName(request: DataEditPlanRequest) {
  const table = quoteIdentifier(request.target.table ?? '<table>')
  return request.target.schema ? `${quoteIdentifier(request.target.schema)}.${table}` : table
}

function timescalePrimaryKeyPredicate(request: DataEditPlanRequest, offset: number) {
  const primaryKey = request.target.primaryKey
  if (!primaryKey || Object.keys(primaryKey).length === 0) {
    return '<primary-key> = <value>'
  }

  return Object.keys(primaryKey)
    .map((key, index) => `${quoteIdentifier(key)} = $${offset + index + 1}`)
    .join(' and ')
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`
}
