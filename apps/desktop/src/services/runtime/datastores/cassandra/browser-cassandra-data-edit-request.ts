import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

export function cassandraDataEditRequest(request: DataEditPlanRequest) {
  const assignments = request.changes
    .map((change) => `${change.field ?? '<field>'} = ?`)
    .join(', ')
  const predicates = Object.keys(request.target.primaryKey ?? {})
    .map((key) => `${key} = ?`)
    .join(' and ')

  return `update ${request.target.schema ?? '<keyspace>'}.${request.target.table ?? '<table>'} set ${assignments || '<field> = ?'} where ${predicates || '<complete_primary_key> = ?'};`
}
