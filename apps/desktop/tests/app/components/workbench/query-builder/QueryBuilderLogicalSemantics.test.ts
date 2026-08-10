import { describe, expect, it } from 'vitest'
import type {
  ConnectionProfile,
  CosmosSqlBuilderState,
  CqlPartitionBuilderState,
  DynamoDbKeyConditionBuilderState,
  MongoFindBuilderState,
  SearchDslBuilderState,
  SqlSelectBuilderState,
} from '@datapadplusplus/shared-types'
import {
  buildCosmosSqlCountQueryText,
  buildCosmosSqlQueryText,
} from '../../../../../src/app/components/workbench/query-builder/cosmos-sql'
import {
  buildCqlPartitionQueryText,
  parseCqlPartitionQueryText,
} from '../../../../../src/app/components/workbench/query-builder/cql-partition'
import { buildDynamoDbKeyConditionQueryText } from '../../../../../src/app/components/workbench/query-builder/dynamodb-key-condition'
import {
  buildMongoFindCountQueryText,
  buildMongoFindQueryText,
  parseMongoFindQueryText,
} from '../../../../../src/app/components/workbench/query-builder/mongo-find'
import { buildSearchDslQueryText } from '../../../../../src/app/components/workbench/query-builder/search-dsl'
import { buildSqlSelectQueryText } from '../../../../../src/app/components/workbench/query-builder/sql-select'

describe('query builder logical semantics', () => {
  it('preserves Mongo standalone AND, grouped OR, and grouped range predicates exactly', () => {
    const state = mongoGroupedState()
    const query = JSON.parse(buildMongoFindQueryText(state)) as Record<string, unknown>

    expect(query.filter).toEqual({
      $and: [
        { tenantId: 'tenant-a' },
        { $or: [{ status: 'open' }, { status: 'paused' }] },
        { total: { $gte: 100, $lt: 200 } },
      ],
    })

    const documents = [
      { id: 'matches-open', tenantId: 'tenant-a', status: 'open', total: 150 },
      { id: 'matches-paused-boundary', tenantId: 'tenant-a', status: 'paused', total: 100 },
      { id: 'wrong-status', tenantId: 'tenant-a', status: 'closed', total: 150 },
      { id: 'wrong-tenant', tenantId: 'tenant-b', status: 'open', total: 150 },
      { id: 'outside-range', tenantId: 'tenant-a', status: 'open', total: 200 },
    ]

    expect(documents.filter((document) => matchesMongoFilter(document, query.filter)).map(({ id }) => id))
      .toEqual(['matches-open', 'matches-paused-boundary'])
  })

  it('never overwrites contradictory Mongo AND predicates on the same field', () => {
    const state: MongoFindBuilderState = {
      kind: 'mongo-find',
      collection: 'orders',
      filterGroups: [{ id: 'status', label: 'Status', logic: 'and' }],
      filters: [
        mongoFilter('open', 'status', 'eq', 'open', 'status'),
        mongoFilter('paused', 'status', 'eq', 'paused', 'status'),
      ],
      projectionMode: 'all',
      projectionFields: [],
      sort: [],
    }
    const filter = (JSON.parse(buildMongoFindQueryText(state)) as { filter: unknown }).filter

    expect(filter).toEqual({ $and: [{ status: 'open' }, { status: 'paused' }] })
    expect([
      { status: 'open' },
      { status: 'paused' },
      { status: 'closed' },
    ].filter((document) => matchesMongoFilter(document, filter))).toEqual([])
  })

  it('does not merge Mongo object equality values as though they were operators', () => {
    const state: MongoFindBuilderState = {
      kind: 'mongo-find',
      collection: 'orders',
      filters: [
        mongoFilter('first', 'metadata', 'eq', '{"kind":"retail"}', undefined, 'json'),
        mongoFilter('second', 'metadata', 'eq', '{"region":"emea"}', undefined, 'json'),
      ],
      filterGroups: [],
      projectionMode: 'all',
      projectionFields: [],
      sort: [],
    }

    expect((JSON.parse(buildMongoFindQueryText(state)) as { filter: unknown }).filter).toEqual({
      $and: [
        { metadata: { kind: 'retail' } },
        { metadata: { region: 'emea' } },
      ],
    })
  })

  it('uses the identical grouped Mongo filter for find and count', () => {
    const state = mongoGroupedState()
    const find = JSON.parse(buildMongoFindQueryText(state)) as { filter: unknown }
    const count = JSON.parse(buildMongoFindCountQueryText(state)) as {
      operation: string
      filter: unknown
    }

    expect(count.operation).toBe('countDocuments')
    expect(count.filter).toEqual(find.filter)
  })

  it('round-trips generated Mongo logical groups without changing the query', () => {
    const queryText = buildMongoFindQueryText(mongoGroupedState())
    const parsed = parseMongoFindQueryText(queryText)

    expect(parsed?.filterGroups.map(({ logic }) => logic)).toEqual(['and', 'or', 'and'])
    expect(parsed && JSON.parse(buildMongoFindQueryText(parsed))).toEqual(JSON.parse(queryText))
  })

  it('refuses a Mongo logical shape that the visual builder cannot represent', () => {
    expect(parseMongoFindQueryText(JSON.stringify({
      collection: 'orders',
      filter: {
        $or: [
          { $and: [{ status: 'open' }, { total: { $gte: 100 } }] },
          { status: 'paused' },
        ],
      },
    }))).toBeUndefined()
  })

  it.each([
    ['unsupported regex options', { filter: { name: { $regex: '^a', $options: 'm' } } }],
    ['mixed projections', { projection: { name: 1, secret: 0 } }],
    ['unsupported sort metadata', { sort: { score: { $meta: 'textScore' } } }],
    ['unsupported request options', { hint: { status: 1 } }],
  ])('keeps Mongo %s out of the visual builder', (_label, request) => {
    expect(parseMongoFindQueryText(JSON.stringify({
      collection: 'orders',
      ...request,
    }))).toBeUndefined()
  })

  it.each([
    ['and', 'and'],
    ['or', 'or'],
  ] as const)('serializes SQL %s logic exactly for every SQL builder engine', (logic, token) => {
    const engines: ConnectionProfile['engine'][] = [
      'postgresql',
      'cockroachdb',
      'mysql',
      'mariadb',
      'sqlite',
      'sqlserver',
      'oracle',
    ]

    for (const engine of engines) {
      const query = buildSqlSelectQueryText(sqlState(logic), engine)
      const quote = engine === 'mysql' || engine === 'mariadb'
        ? (value: string) => `\`${value}\``
        : engine === 'sqlserver' || engine === 'sqlite'
          ? (value: string) => `[${value}]`
          : engine === 'oracle'
            ? (value: string) => `"${value.toUpperCase()}"`
            : (value: string) => `"${value}"`
      const select = engine === 'sqlserver' ? 'select top 25 *' : 'select *'
      const limit = engine === 'sqlserver'
        ? ''
        : engine === 'oracle'
          ? ' fetch first 25 rows only'
          : ' limit 25'
      const expected = `${select} from ${quote('public')}.${quote('orders')} where ${quote('status')} = 'active' ${token} ${quote('priority')} >= 10${limit};`

      expect(query, engine).toBe(expected)
    }
  })

  it.each([
    ['and', 'AND'],
    ['or', 'OR'],
  ] as const)('serializes Cosmos DB %s logic with stable parameter binding', (logic, token) => {
    const state = cosmosState(logic)
    const request = JSON.parse(buildCosmosSqlQueryText(state)) as {
      query: string
      parameters: unknown[]
    }
    const count = JSON.parse(buildCosmosSqlCountQueryText(state)) as { query: string }

    expect(request.query).toBe(
      `SELECT TOP 25 * FROM c WHERE c["status"] = @p0 ${token} c["priority"] >= @p1`,
    )
    expect(request.parameters).toEqual([
      { name: '@p0', value: 'active' },
      { name: '@p1', value: 10 },
    ])
    expect(count.query).toBe(
      `SELECT VALUE COUNT(1) FROM c WHERE c["status"] = @p0 ${token} c["priority"] >= @p1`,
    )
  })

  it('serializes DynamoDB key and filter conjunctions without changing predicate order', () => {
    const request = JSON.parse(buildDynamoDbKeyConditionQueryText(dynamoState())) as Record<string, unknown>

    expect(request.keyConditionExpression).toBe('#n0 = :v0 and #n1 between :v1 and :v2')
    expect(request.filterExpression).toBe(
      '#n2 = :v3 and attribute_type(#n3, :v4) and size(#n3) > :v5',
    )
    expect(request.expressionAttributeNames).toEqual({
      '#n0': 'tenantId',
      '#n1': 'createdAt',
      '#n2': 'status',
      '#n3': 'items',
    })
    expect(request.expressionAttributeValues).toEqual({
      ':v0': { S: 'tenant-a' },
      ':v1': { S: '2026-01-01T00:00:00Z' },
      ':v2': { S: '2026-02-01T00:00:00Z' },
      ':v3': { S: 'active' },
      ':v4': { S: 'L' },
      ':v5': { N: '0' },
    })
  })

  it('serializes Cassandra predicates as native AND conditions', () => {
    expect(buildCqlPartitionQueryText(cqlState())).toBe([
      'select *',
      'from app.events',
      "where tenant_id = 'tenant-a' and created_at >= '2026-01-01T00:00:00.000Z' and category CONTAINS 'rock and roll'",
      'limit 25;',
    ].join('\n'))
  })

  it('parses CQL conjunctions without splitting AND inside strings or IN lists', () => {
    const query = [
      'select * from app.events',
      "where tenant_id = 'tenant-a' and category contains 'rock and roll' and code in ('a and b', 'c')",
      'limit 25;',
    ].join(' ')
    const parsed = parseCqlPartitionQueryText(query)

    expect(parsed).toMatchObject({
      partitionKeys: [{ field: 'tenant_id', value: 'tenant-a' }],
      filters: [
        { field: 'category', operator: 'contains', value: 'rock and roll' },
        { field: 'code', operator: 'in', value: 'a and b, c' },
      ],
    })
    expect(parsed && buildCqlPartitionQueryText(parsed)).toContain(
      "category CONTAINS 'rock and roll' and code IN ('a and b', 'c')",
    )
  })

  it('serializes Search Query DSL main and filter clauses as bool conjunctions', () => {
    const request = JSON.parse(buildSearchDslQueryText(searchState())) as {
      body: { query: unknown }
    }

    expect(request.body.query).toEqual({
      bool: {
        must: [{ match: { name: 'lamp' } }],
        filter: [
          { term: { 'status.keyword': 'active' } },
          { range: { priority: { gte: 10 } } },
        ],
      },
    })
  })
})

function mongoGroupedState(): MongoFindBuilderState {
  return {
    kind: 'mongo-find',
    collection: 'orders',
    filters: [
      mongoFilter('tenant', 'tenantId', 'eq', 'tenant-a'),
      mongoFilter('open', 'status', 'eq', 'open', 'status'),
      mongoFilter('paused', 'status', 'eq', 'paused', 'status'),
      mongoFilter('min', 'total', 'gte', '100', 'range', 'number'),
      mongoFilter('max', 'total', 'lt', '200', 'range', 'number'),
    ],
    filterGroups: [
      { id: 'status', label: 'Status', logic: 'or' },
      { id: 'range', label: 'Range', logic: 'and' },
    ],
    projectionMode: 'all',
    projectionFields: [],
    sort: [],
    limit: 25,
  }
}

function mongoFilter(
  id: string,
  field: string,
  operator: MongoFindBuilderState['filters'][number]['operator'],
  value: string,
  groupId?: string,
  valueType: MongoFindBuilderState['filters'][number]['valueType'] = 'string',
) {
  return { id, field, operator, value, valueType, ...(groupId ? { groupId } : {}) }
}

function sqlState(filterLogic: 'and' | 'or'): SqlSelectBuilderState {
  return {
    kind: 'sql-select',
    schema: 'public',
    table: 'orders',
    projectionFields: [],
    filters: [
      { id: 'status', field: 'status', operator: 'eq', value: 'active', valueType: 'string' },
      { id: 'priority', field: 'priority', operator: 'gte', value: '10', valueType: 'number' },
    ],
    filterLogic,
    sort: [],
    limit: 25,
  }
}

function cosmosState(filterLogic: 'and' | 'or'): CosmosSqlBuilderState {
  return {
    kind: 'cosmos-sql',
    database: 'catalog',
    container: 'orders',
    projectionFields: [],
    filters: [
      { id: 'status', field: 'status', operator: 'eq', value: 'active', valueType: 'string' },
      { id: 'priority', field: 'priority', operator: 'gte', value: '10', valueType: 'number' },
    ],
    filterLogic,
    sort: [],
    offset: 0,
    limit: 25,
    partitionKeyEnabled: false,
    partitionKeyValue: '',
    partitionKeyValueType: 'string',
    enableCrossPartitionQueries: true,
  }
}

function dynamoState(): DynamoDbKeyConditionBuilderState {
  return {
    kind: 'dynamodb-key-condition',
    table: 'orders',
    partitionKey: {
      id: 'tenant',
      field: 'tenantId',
      operator: 'eq',
      value: 'tenant-a',
      valueType: 'string',
    },
    sortKey: {
      id: 'created',
      field: 'createdAt',
      operator: 'between',
      value: '2026-01-01T00:00:00Z',
      secondValue: '2026-02-01T00:00:00Z',
      valueType: 'string',
    },
    filters: [
      { id: 'status', field: 'status', operator: 'eq', value: 'active', valueType: 'string' },
      { id: 'items', field: 'items', operator: 'has-items', value: '', valueType: 'number' },
    ],
    projectionFields: [],
    consistentRead: false,
    limit: 25,
  }
}

function cqlState(): CqlPartitionBuilderState {
  return {
    kind: 'cql-partition',
    keyspace: 'app',
    table: 'events',
    projectionFields: [],
    partitionKeys: [
      { id: 'tenant', field: 'tenant_id', operator: 'eq', value: 'tenant-a', valueType: 'string' },
    ],
    clusteringKeys: [
      { id: 'created', field: 'created_at', operator: 'gte', value: '2026-01-01T00:00:00Z', valueType: 'date' },
    ],
    filters: [
      { id: 'category', field: 'category', operator: 'contains', value: 'rock and roll', valueType: 'string' },
    ],
    allowFiltering: false,
    limit: 25,
  }
}

function searchState(): SearchDslBuilderState {
  return {
    kind: 'search-dsl',
    index: 'products',
    queryMode: 'match',
    field: 'name',
    value: 'lamp',
    valueType: 'string',
    filters: [
      { id: 'status', field: 'status.keyword', operator: 'term', value: 'active', valueType: 'string' },
      { id: 'priority', field: 'priority', operator: 'range-gte', value: '10', valueType: 'number' },
    ],
    sourceFields: [],
    sort: [],
    aggregations: [],
    size: 25,
  }
}

function matchesMongoFilter(document: Record<string, unknown>, filter: unknown): boolean {
  if (!isObject(filter)) {
    return false
  }
  return Object.entries(filter).every(([field, expected]) => {
    if (field === '$and') {
      return Array.isArray(expected) && expected.every((entry) => matchesMongoFilter(document, entry))
    }
    if (field === '$or') {
      return Array.isArray(expected) && expected.some((entry) => matchesMongoFilter(document, entry))
    }
    const actual = document[field]
    if (!isObject(expected)) {
      return actual === expected
    }
    return Object.entries(expected).every(([operator, operand]) => {
      if (operator === '$gte') return typeof actual === 'number' && actual >= Number(operand)
      if (operator === '$gt') return typeof actual === 'number' && actual > Number(operand)
      if (operator === '$lte') return typeof actual === 'number' && actual <= Number(operand)
      if (operator === '$lt') return typeof actual === 'number' && actual < Number(operand)
      if (operator === '$ne') return actual !== operand
      return false
    })
  })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
