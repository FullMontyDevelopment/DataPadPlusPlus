import { describe, expect, it } from 'vitest'
import type { ConnectionProfile, QueryBuilderState } from '@datapadplusplus/shared-types'
import { createDefaultCqlPartitionBuilderState } from '../../../../../src/app/components/workbench/query-builder/cql-partition'
import { createDefaultCosmosSqlBuilderState } from '../../../../../src/app/components/workbench/query-builder/cosmos-sql'
import { createDefaultDynamoDbKeyConditionBuilderState } from '../../../../../src/app/components/workbench/query-builder/dynamodb-key-condition'
import { createDefaultMongoAggregationBuilderState } from '../../../../../src/app/components/workbench/query-builder/mongo-aggregation'
import { createDefaultMongoFindBuilderState } from '../../../../../src/app/components/workbench/query-builder/mongo-find'
import {
  buildQueryBuilderCountText,
  canCountQueryBuilderState,
} from '../../../../../src/app/components/workbench/query-builder/query-builder-count'
import { createDefaultRedisKeyBrowserState } from '../../../../../src/app/components/workbench/query-builder/redis-key-browser'
import { createDefaultSearchDslBuilderState } from '../../../../../src/app/components/workbench/query-builder/search-dsl'
import { createDefaultSqlSelectBuilderState } from '../../../../../src/app/components/workbench/query-builder/sql-select'

describe('Query Builder Count', () => {
  it('builds an exact MongoDB find count without display controls', () => {
    const state = {
      ...createDefaultMongoFindBuilderState('products'),
      database: 'catalog',
      projectionMode: 'include' as const,
      projectionFields: [{ id: 'projection-1', field: 'name' }],
      sort: [{ id: 'sort-1', field: 'name', direction: 'asc' as const }],
      skip: 50,
      limit: 10,
    }
    const query = JSON.parse(buildQueryBuilderCountText(state))

    expect(query).toMatchObject({
      database: 'catalog',
      collection: 'products',
      operation: 'countDocuments',
      filter: {},
    })
    expect(query).not.toHaveProperty('projection')
    expect(query).not.toHaveProperty('sort')
    expect(query).not.toHaveProperty('skip')
    expect(query).not.toHaveProperty('limit')
  })

  it('preserves MongoDB aggregation stages while dropping the display limit', () => {
    const state = createDefaultMongoAggregationBuilderState('orders', 25)
    state.stages.push({ id: 'stage-limit', stage: '$limit', body: '4', enabled: true })
    const query = JSON.parse(buildQueryBuilderCountText(state))

    expect(query.pipeline).toEqual([{ $match: {} }, { $limit: 4 }])
    expect(query).not.toHaveProperty('limit')
  })

  it.each([
    ['postgresql', '"public"."accounts"'],
    ['cockroachdb', '"public"."accounts"'],
    ['sqlserver', '[public].[accounts]'],
    ['mysql', '`public`.`accounts`'],
    ['mariadb', '`public`.`accounts`'],
    ['sqlite', '[public].[accounts]'],
  ] as const)('builds a dialect-correct %s count', (engine, target) => {
    const state = createDefaultSqlSelectBuilderState('accounts', 'public', 20)
    state.projectionFields = [{ id: 'projection-1', field: 'name' }]
    state.sort = [{ id: 'sort-1', field: 'name', direction: 'desc' }]
    state.filters = [{
      id: 'filter-1',
      field: 'active',
      operator: 'eq',
      value: 'true',
      valueType: 'boolean',
    }]
    const query = buildQueryBuilderCountText(state, {
      connection: { engine } as ConnectionProfile,
    })

    expect(query).toContain(`select count(*) as count from ${target}`)
    expect(query).toContain('where')
    expect(query).not.toContain('order by')
    expect(query).not.toContain('limit 20')
  })

  it('uses DynamoDB Select COUNT without projection or a page limit', () => {
    const state = createDefaultDynamoDbKeyConditionBuilderState('Orders', 20)
    state.projectionFields = [{ id: 'projection-1', field: 'status' }]
    const query = JSON.parse(buildQueryBuilderCountText(state))

    expect(query).toMatchObject({ operation: 'Scan', tableName: 'Orders', select: 'COUNT' })
    expect(query).not.toHaveProperty('projectionExpression')
    expect(query).not.toHaveProperty('limit')
  })

  it('builds a parameterized Cosmos DB exact count without display controls', () => {
    const state = createDefaultCosmosSqlBuilderState('products', 'catalog', 10)
    state.projectionFields = [{ id: 'projection-1', field: 'name' }]
    state.filters = [{
      id: 'filter-1',
      enabled: true,
      field: 'status',
      operator: 'eq',
      value: 'active',
      valueType: 'string',
    }]
    state.sort = [{ id: 'sort-1', field: 'name', direction: 'asc' }]
    state.offset = 50
    state.partitionKeyEnabled = true
    state.partitionKeyValue = 'tenant-1'

    const request = JSON.parse(buildQueryBuilderCountText(state))

    expect(request).toMatchObject({
      operation: 'QueryDocuments',
      database: 'catalog',
      container: 'products',
      query: 'SELECT VALUE COUNT(1) FROM c WHERE c["status"] = @p0',
      parameters: [{ name: '@p0', value: 'active' }],
      partitionKey: 'tenant-1',
      enableCrossPartitionQueries: false,
      populateQueryMetrics: true,
      populateIndexMetrics: true,
    })
    expect(request.query).not.toContain('ORDER BY')
    expect(request.query).not.toContain('OFFSET')
    expect(request.query).not.toContain('LIMIT')
  })

  it('builds Cassandra and search counts from filters without display controls', () => {
    const cql = createDefaultCqlPartitionBuilderState('events', 'app', 20)
    cql.partitionKeys[0] = {
      id: 'pk',
      field: 'tenant_id',
      operator: 'eq',
      value: 'northwind',
      valueType: 'string',
    }
    cql.allowFiltering = true
    expect(buildQueryBuilderCountText(cql)).toBe(
      "select count(*) as count\nfrom app.events\nwhere tenant_id = 'northwind'\nallow filtering;",
    )

    const search = createDefaultSearchDslBuilderState('products', 25)
    search.sourceFields = [{ id: 'source-1', field: 'name' }]
    search.sort = [{ id: 'sort-1', field: 'name', direction: 'asc' }]
    search.aggregations = [{ id: 'agg-1', field: 'category', type: 'terms' }]
    const searchRequest = JSON.parse(buildQueryBuilderCountText(search))
    expect(searchRequest).toEqual({
      index: 'products',
      body: { query: { match_all: {} } },
    })
  })

  it('serializes all concrete builder kinds and validates their targets', () => {
    const states: QueryBuilderState[] = [
      createDefaultMongoFindBuilderState('products'),
      createDefaultMongoAggregationBuilderState('orders'),
      createDefaultCosmosSqlBuilderState('products', 'catalog'),
      createDefaultSqlSelectBuilderState('accounts'),
      createDefaultDynamoDbKeyConditionBuilderState('Orders'),
      createDefaultCqlPartitionBuilderState('events', 'app'),
      createDefaultSearchDslBuilderState('products'),
      createDefaultRedisKeyBrowserState('session:*'),
    ]

    for (const state of states) {
      expect(canCountQueryBuilderState(state)).toBe(true)
      expect(buildQueryBuilderCountText(state).trim()).not.toBe('')
    }

    expect(canCountQueryBuilderState(createDefaultMongoFindBuilderState(''))).toBe(false)
  })
})
