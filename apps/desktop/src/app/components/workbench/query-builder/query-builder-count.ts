import type {
  ConnectionProfile,
  QueryBuilderState,
} from '@datapadplusplus/shared-types'
import { buildCqlPartitionCountQueryText } from './cql-partition'
import { buildDynamoDbCountQueryText } from './dynamodb-key-condition'
import { buildMongoAggregationCountQueryText } from './mongo-aggregation'
import { buildMongoFindCountQueryText } from './mongo-find'
import { buildSearchDslCountQueryText } from './search-dsl'
import { buildSqlSelectCountQueryText } from './sql-select-count'

interface QueryBuilderCountContext {
  connection?: ConnectionProfile
  database?: string
}

export function buildQueryBuilderCountText(
  state: QueryBuilderState,
  context: QueryBuilderCountContext = {},
) {
  switch (state.kind) {
    case 'mongo-find':
      return buildMongoFindCountQueryText(state, { database: context.database })
    case 'mongo-aggregation':
      return buildMongoAggregationCountQueryText(state, { database: context.database })
    case 'sql-select':
      return buildSqlSelectCountQueryText(state, context.connection?.engine)
    case 'dynamodb-key-condition':
      return buildDynamoDbCountQueryText(state)
    case 'cql-partition':
      return buildCqlPartitionCountQueryText(state)
    case 'search-dsl':
      return buildSearchDslCountQueryText(state)
    case 'redis-key-browser':
      return JSON.stringify({
        operation: 'countKeys',
        databaseIndex: state.databaseIndex,
        pattern: state.pattern.trim() || '*',
        typeFilter: state.typeFilter,
        filters: state.filters,
      }, null, 2)
  }
}

export function queryBuilderCountTarget(state: QueryBuilderState) {
  switch (state.kind) {
    case 'mongo-find':
    case 'mongo-aggregation':
      return state.collection.trim()
    case 'sql-select':
    case 'cql-partition':
      return state.table.trim()
    case 'dynamodb-key-condition':
      return state.table.trim()
    case 'search-dsl':
      return state.index.trim()
    case 'redis-key-browser':
      return `database ${state.databaseIndex ?? 0}`
  }
}

export function canCountQueryBuilderState(state: QueryBuilderState) {
  return Boolean(queryBuilderCountTarget(state))
}

export function queryBuilderStateWithDatabase(
  state: QueryBuilderState,
  database: string | undefined,
): QueryBuilderState {
  if ((state.kind === 'mongo-find' || state.kind === 'mongo-aggregation') && database) {
    return { ...state, database }
  }
  return state
}
