import type { ConnectionProfile, NewBuilderQueryLimit, QueryBuilderState, QueryTabState } from '@datapadplusplus/shared-types'
import { compileQueryBuilderState } from './query-builder-routing'
import { createDefaultMongoFindBuilderState, parseMongoFindQueryText } from './mongo-find'
import { parseMongoAggregationQueryText } from './mongo-aggregation'
import { createDefaultLiteDbFindBuilderState, parseLiteDbFindQueryText } from './litedb-find'
import { createDefaultCqlPartitionBuilderState, parseCqlPartitionQueryText } from './cql-partition'
import { parseCosmosSqlQueryText } from './cosmos-sql'
import { parseSqlSelectQueryText } from './sql-select'
import { parseSearchDslQueryText } from './search-dsl'
import { parseDynamoDbKeyConditionQueryText } from './dynamodb-key-condition'

export function supportsUnlimitedQueryLimit(state?: QueryBuilderState): boolean {
  return Boolean(state && ['mongo-find', 'mongo-aggregation', 'litedb-find', 'cosmos-sql', 'sql-select', 'cql-partition'].includes(state.kind))
}

/** Match the codecs: an omitted limit is unlimited except where a native builder supplies a default. */
export function queryLimitValue(state: QueryBuilderState): number | null | undefined {
  if (state.kind === 'redis-key-browser') return undefined
  if (state.kind === 'search-dsl') return state.size ?? 20
  if (state.limit === null) return null
  if (state.kind === 'cosmos-sql') return state.limit ?? 50
  if (state.kind === 'litedb-find' || state.kind === 'dynamodb-key-condition') return state.limit ?? 20
  return state.limit ?? null
}

/** Resolve only the query's own definition; no active-tab or application state is consulted. */
export function queryLimitBuilder(tab: QueryTabState, connection: ConnectionProfile): QueryBuilderState | undefined {
  if (tab.queryViewMode !== 'builder') return undefined
  if (tab.builderState) return tab.builderState
  switch (connection.engine) {
    case 'mongodb': {
      const aggregation = parseMongoAggregationQueryText(tab.queryText)
      if (aggregation) {
        // Settings removes only the outer builder limit, never authored pipeline stages.
        const request = JSON.parse(tab.queryText) as { pipeline: Record<string, unknown>[]; limit?: number }
        if (request.pipeline.some(stage => !stage || Array.isArray(stage) || Object.keys(stage).length !== 1)) return undefined
        return { ...aggregation, limit: request.limit ?? null, stages: request.pipeline.map((stage, index) => {
          const [name, body] = Object.entries(stage)[0]!
          return { id: `stage-${index + 1}`, enabled: true, stage: name, body: JSON.stringify(body) }
        }) }
      }
      return parseMongoFindQueryText(tab.queryText) ?? (!tab.queryText.trim() ? createDefaultMongoFindBuilderState('') : undefined)
    }
    case 'litedb': return parseLiteDbFindQueryText(tab.queryText) ?? (!tab.queryText.trim() ? createDefaultLiteDbFindBuilderState('') : undefined)
    case 'cosmosdb': return parseCosmosSqlQueryText(tab.queryText)
    case 'cassandra': return parseCqlPartitionQueryText(tab.queryText) ?? (!tab.queryText.trim() ? createDefaultCqlPartitionBuilderState('', connection.database ?? '') : undefined)
    case 'elasticsearch': case 'opensearch': return parseSearchDslQueryText(tab.queryText)
    case 'dynamodb': return parseDynamoDbKeyConditionQueryText(tab.queryText)
    case 'redis': case 'valkey': return undefined
    default: return parseSqlSelectQueryText(tab.queryText, connection.engine)
  }
}

/** Called only at creation, never while resolving/reopening an existing builder. */
export function initializeQueryLimit({ tab, connection, policy }: { tab: QueryTabState; connection: ConnectionProfile; policy?: NewBuilderQueryLimit }): QueryTabState {
  if (!policy || policy.mode === 'datastore-default') return tab
  const state = queryLimitBuilder(tab, connection)
  if (!state || (!supportsUnlimitedQueryLimit(state) && (policy.mode === 'unlimited' || !['search-dsl', 'dynamodb-key-condition'].includes(state.kind)))) return tab
  const limit = policy.mode === 'unlimited' ? null : policy.value
  const builderState = state.kind === 'search-dsl' ? { ...state, size: limit as number } : { ...state, limit }
  const compiled = compileQueryBuilderState(builderState, connection, tab)
  return { ...tab, builderState: compiled.ok && compiled.queryText !== undefined
    ? { ...builderState, lastAppliedQueryText: compiled.queryText } : builderState,
    queryText: compiled.ok && compiled.queryText !== undefined ? compiled.queryText : tab.queryText }
}

export function removeQueryLimit({ tab, connection }: { tab: QueryTabState; connection: ConnectionProfile }) {
  const state = queryLimitBuilder(tab, connection)
  if (!state || !supportsUnlimitedQueryLimit(state)) throw new Error('This query does not support removing a builder limit. Raw queries and native limits are unchanged.')
  const builderState = { ...state, limit: null }
  const compiled = compileQueryBuilderState(builderState, connection, tab)
  if (!compiled.ok || compiled.queryText === undefined) throw new Error('Fix the query builder draft before changing its limit in Settings.')
  return { queryText: compiled.queryText, builderState: { ...builderState, lastAppliedQueryText: compiled.queryText } }
}
