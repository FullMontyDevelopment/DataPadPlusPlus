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
    return buildSqlSelectQueryText(builderState, connection.engine)
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
