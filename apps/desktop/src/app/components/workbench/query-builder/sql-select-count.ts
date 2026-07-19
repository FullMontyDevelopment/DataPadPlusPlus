import type { ConnectionProfile, SqlSelectBuilderState } from '@datapadplusplus/shared-types'
import { buildSqlWhereClause, quoteSqlTablePath } from './sql-select'

export function buildSqlSelectCountQueryText(
  state: SqlSelectBuilderState,
  engine: ConnectionProfile['engine'] = 'postgresql',
) {
  if (!state.table.trim()) {
    return 'select count(*) as count;'
  }

  const clauses = ['select count(*) as count', `from ${quoteSqlTablePath(state, engine)}`]
  const whereClause = buildSqlWhereClause(state, engine)
  if (whereClause) {
    clauses.push(whereClause)
  }
  return `${clauses.join(' ')};`
}
