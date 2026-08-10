import type {
  ConnectionProfile,
  QueryBuilderState,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import {
  buildCqlPartitionQueryText,
  isCqlPartitionBuilderState,
} from '../components/workbench/query-builder/cql-partition'
import {
  buildCosmosSqlQueryText,
  isCosmosSqlBuilderState,
} from '../components/workbench/query-builder/cosmos-sql'
import {
  buildDynamoDbKeyConditionQueryText,
  isDynamoDbKeyConditionBuilderState,
} from '../components/workbench/query-builder/dynamodb-key-condition'
import {
  buildMongoAggregationQueryText,
  isMongoAggregationBuilderState,
} from '../components/workbench/query-builder/mongo-aggregation'
import {
  buildMongoFindQueryText,
  isMongoFindBuilderState,
} from '../components/workbench/query-builder/mongo-find'
import { mongoQueryScopeForTab } from '../components/workbench/query-builder/mongo-query-scope'
import { isRedisKeyBrowserState } from '../components/workbench/query-builder/redis-key-browser'
import {
  buildSearchDslQueryText,
  isSearchDslBuilderState,
} from '../components/workbench/query-builder/search-dsl'
import {
  buildSqlSelectQueryText,
  isSqlSelectBuilderState,
} from '../components/workbench/query-builder/sql-select'
import {
  validateQueryBuilderState,
  type QueryBuilderValidationError,
} from '../components/workbench/query-builder/query-builder-validation'

export type QueryBuilderCompilation =
  | { ok: true; queryText?: string; errors: [] }
  | { ok: false; errors: QueryBuilderValidationError[] }

export function queryScopeForBuilderState(
  builderState: QueryBuilderState | undefined,
  connection: ConnectionProfile | undefined,
  tab?: QueryTabState,
  queryText?: string,
  scriptText?: string,
) {
  return mongoQueryScopeForTab({
    builderState,
    connection,
    queryText,
    scriptText,
    tab,
  })
}

export function buildQueryTextForBuilderState(
  builderState: QueryBuilderState,
  connection: ConnectionProfile | undefined,
  tab?: QueryTabState,
) {
  const compilation = compileQueryBuilderState(builderState, connection, tab)
  return compilation.ok ? compilation.queryText : undefined
}

export function compileQueryBuilderState(
  builderState: QueryBuilderState,
  connection: ConnectionProfile | undefined,
  tab?: QueryTabState,
): QueryBuilderCompilation {
  const errors = validateQueryBuilderState(builderState)
  if (errors.length > 0) return { ok: false, errors }

  try {
    return {
      ok: true,
      queryText: buildUncheckedQueryTextForBuilderState(builderState, connection, tab),
      errors: [],
    }
  } catch (error) {
    return {
      ok: false,
      errors: [{ message: error instanceof Error ? error.message : 'The query builder draft is invalid.' }],
    }
  }
}

export function builderStateWithCompiledQueryText<T extends QueryBuilderState>(
  builderState: T,
  connection: ConnectionProfile | undefined,
  tab?: QueryTabState,
): T {
  const compilation = compileQueryBuilderState(builderState, connection, tab)
  return compilation.ok && compilation.queryText !== undefined
    ? { ...builderState, lastAppliedQueryText: compilation.queryText }
    : builderState
}

function buildUncheckedQueryTextForBuilderState(
  builderState: QueryBuilderState,
  connection: ConnectionProfile | undefined,
  tab?: QueryTabState,
) {
  if (isMongoFindBuilderState(builderState)) {
    return buildMongoFindQueryText(builderState, {
      database: queryScopeForBuilderState(builderState, connection, tab)?.database,
    })
  }

  if (isMongoAggregationBuilderState(builderState)) {
    return buildMongoAggregationQueryText(builderState, {
      database: queryScopeForBuilderState(builderState, connection, tab)?.database,
    })
  }

  if (connection && isSqlSelectBuilderState(builderState)) {
    const scopedState = tab?.sqlScope?.schema
      ? { ...builderState, schema: tab.sqlScope.schema }
      : builderState
    return buildSqlSelectQueryText(scopedState, connection.engine)
  }

  if (isDynamoDbKeyConditionBuilderState(builderState)) {
    return buildDynamoDbKeyConditionQueryText(builderState)
  }

  if (isCqlPartitionBuilderState(builderState)) {
    return buildCqlPartitionQueryText(builderState)
  }

  if (isCosmosSqlBuilderState(builderState)) {
    return buildCosmosSqlQueryText(builderState)
  }

  if (isSearchDslBuilderState(builderState)) {
    return buildSearchDslQueryText(builderState)
  }

  if (isRedisKeyBrowserState(builderState)) {
    return undefined
  }

  return undefined
}
