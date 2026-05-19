import { describe, expect, it } from 'vitest'
import {
  buildCqlPartitionQueryText,
  createDefaultCqlPartitionBuilderState,
  parseCqlPartitionQueryText,
} from './cql-partition'
import {
  buildDynamoDbKeyConditionQueryText,
  createDefaultDynamoDbKeyConditionBuilderState,
  parseDynamoDbKeyConditionQueryText,
} from './dynamodb-key-condition'
import {
  buildMongoAggregationQueryText,
  createDefaultMongoAggregationBuilderState,
  parseMongoAggregationQueryText,
} from './mongo-aggregation'
import { buildMongoFindQueryText, createDefaultMongoFindBuilderState } from './mongo-find'
import {
  buildSqlSelectQueryText,
  createDefaultSqlSelectBuilderState,
  parseSqlSelectQueryText,
} from './sql-select'
import {
  buildSearchDslQueryText,
  createDefaultSearchDslBuilderState,
  parseSearchDslQueryText,
} from './search-dsl'

describe('Mongo query builder', () => {
  it('generates basic collection find JSON', () => {
    const query = JSON.parse(buildMongoFindQueryText(createDefaultMongoFindBuilderState('products')))

    expect(query).toEqual({
      collection: 'products',
      filter: {},
      limit: 20,
    })
  })

  it('generates filter operators with typed values', () => {
    const query = JSON.parse(
      buildMongoFindQueryText({
        kind: 'mongo-find',
        collection: 'products',
        filters: [
          {
            id: 'filter-sku',
            field: 'sku',
            operator: 'eq',
            value: 'SKU-001',
            valueType: 'string',
          },
          {
            id: 'filter-price',
            field: 'price',
            operator: 'gte',
            value: '10.5',
            valueType: 'number',
          },
          {
            id: 'filter-active',
            field: 'active',
            operator: 'exists',
            value: 'true',
            valueType: 'boolean',
          },
          {
            id: 'filter-tags',
            field: 'tags',
            operator: 'in',
            value: 'featured, clearance',
            valueType: 'string',
          },
        ],
        projectionMode: 'all',
        projectionFields: [],
        sort: [],
      }),
    )

    expect(query.filter).toEqual({
      sku: 'SKU-001',
      price: { $gte: 10.5 },
      active: { $exists: true },
      tags: { $in: ['featured', 'clearance'] },
    })
  })

  it('generates projection, sort, skip, and limit', () => {
    const query = JSON.parse(
      buildMongoFindQueryText({
        kind: 'mongo-find',
        collection: 'orders',
        filters: [],
        projectionMode: 'include',
        projectionFields: [
          { id: 'field-total', field: 'total' },
          { id: 'field-created', field: 'createdAt' },
        ],
        sort: [{ id: 'sort-created', field: 'createdAt', direction: 'desc' }],
        skip: 20,
        limit: 10,
      }),
    )

    expect(query).toEqual({
      collection: 'orders',
      filter: {},
      projection: {
        total: 1,
        createdAt: 1,
      },
      sort: {
        createdAt: -1,
      },
      skip: 20,
      limit: 10,
    })
  })

  it('keeps JSON values intact when requested', () => {
    const query = JSON.parse(
      buildMongoFindQueryText({
        kind: 'mongo-find',
        collection: 'events',
        filters: [
          {
            id: 'filter-meta',
            field: 'metadata',
            operator: 'eq',
            value: '{"source":"fixture"}',
            valueType: 'json',
          },
        ],
        projectionMode: 'exclude',
        projectionFields: [{ id: 'field-secret', field: 'secret' }],
        sort: [],
      }),
    )

    expect(query.filter.metadata).toEqual({ source: 'fixture' })
    expect(query.projection).toEqual({ secret: 0 })
  })

  it('supports OR filter groups and disabled filters', () => {
    const query = JSON.parse(
      buildMongoFindQueryText({
        kind: 'mongo-find',
        collection: 'orders',
        filterGroups: [{ id: 'group-status', label: 'Status', logic: 'or' }],
        filters: [
          {
            id: 'filter-open',
            enabled: true,
            field: 'status',
            groupId: 'group-status',
            operator: 'eq',
            value: 'open',
            valueType: 'string',
          },
          {
            id: 'filter-paused',
            enabled: true,
            field: 'status',
            groupId: 'group-status',
            operator: 'eq',
            value: 'paused',
            valueType: 'string',
          },
          {
            id: 'filter-archived',
            enabled: false,
            field: 'status',
            groupId: 'group-status',
            operator: 'eq',
            value: 'archived',
            valueType: 'string',
          },
        ],
        projectionMode: 'all',
        projectionFields: [],
        sort: [],
      }),
    )

    expect(query.filter).toEqual({
      $or: [{ status: 'open' }, { status: 'paused' }],
    })
  })

  it('combines separate filter groups with AND', () => {
    const query = JSON.parse(
      buildMongoFindQueryText({
        kind: 'mongo-find',
        collection: 'orders',
        filterGroups: [
          { id: 'group-status', label: 'Status', logic: 'or' },
          { id: 'group-total', label: 'Total', logic: 'and' },
        ],
        filters: [
          {
            id: 'filter-open',
            field: 'status',
            groupId: 'group-status',
            operator: 'eq',
            value: 'open',
            valueType: 'string',
          },
          {
            id: 'filter-paused',
            field: 'status',
            groupId: 'group-status',
            operator: 'eq',
            value: 'paused',
            valueType: 'string',
          },
          {
            id: 'filter-total',
            field: 'total',
            groupId: 'group-total',
            operator: 'gte',
            value: '100',
            valueType: 'number',
          },
        ],
        projectionMode: 'all',
        projectionFields: [],
        sort: [],
      }),
    )

    expect(query.filter).toEqual({
      $and: [
        { $or: [{ status: 'open' }, { status: 'paused' }] },
        { total: { $gte: 100 } },
      ],
    })
  })
})

describe('Mongo aggregation builder', () => {
  it('generates aggregate JSON from enabled pipeline stages', () => {
    const query = JSON.parse(
      buildMongoAggregationQueryText({
        kind: 'mongo-aggregation',
        collection: 'orders',
        limit: 50,
        stages: [
          {
            id: 'stage-match',
            enabled: true,
            stage: '$match',
            body: '{ "status": "open" }',
          },
          {
            id: 'stage-group',
            enabled: true,
            stage: '$group',
            body: '{ "_id": "$customerId", "total": { "$sum": "$total" } }',
          },
          {
            id: 'stage-disabled',
            enabled: false,
            stage: '$sort',
            body: '{ "total": -1 }',
          },
        ],
      }),
    )

    expect(query).toEqual({
      collection: 'orders',
      operation: 'aggregate',
      pipeline: [
        { $match: { status: 'open' } },
        { $group: { _id: '$customerId', total: { $sum: '$total' } } },
      ],
      limit: 50,
    })
  })

  it('creates a default aggregate pipeline with a fetch limit', () => {
    expect(createDefaultMongoAggregationBuilderState('products', 20)).toMatchObject({
      kind: 'mongo-aggregation',
      collection: 'products',
      stages: [{ stage: '$match', body: '{}' }],
      limit: 20,
    })
  })

  it('parses raw aggregate JSON into builder state', () => {
    expect(
      parseMongoAggregationQueryText(`{
        "collection": "orders",
        "pipeline": [
          { "$match": { "status": "open" } },
          { "$limit": 10 }
        ]
      }`),
    ).toMatchObject({
      kind: 'mongo-aggregation',
      collection: 'orders',
      stages: [
        { stage: '$match', body: '{\n  "status": "open"\n}' },
      ],
      limit: 10,
    })
  })
})

describe('SQL SELECT query builder', () => {
  it('generates a quoted PostgreSQL SELECT with filters, sorting, and limit', () => {
    expect(
      buildSqlSelectQueryText({
        kind: 'sql-select',
        schema: 'public',
        table: 'accounts',
        projectionFields: [
          { id: 'field-email', field: 'email' },
          { id: 'field-status', field: 'status' },
        ],
        filters: [
          {
            id: 'filter-status',
            enabled: true,
            field: 'status',
            operator: 'eq',
            value: 'active',
            valueType: 'string',
          },
          {
            id: 'filter-total',
            enabled: true,
            field: 'total',
            operator: 'gte',
            value: '100',
            valueType: 'number',
          },
          {
            id: 'filter-archived',
            enabled: false,
            field: 'archived',
            operator: 'eq',
            value: 'true',
            valueType: 'boolean',
          },
        ],
        filterLogic: 'and',
        sort: [{ id: 'sort-created', field: 'created_at', direction: 'desc' }],
        limit: 25,
      }),
    ).toBe(
      'select "email", "status" from "public"."accounts" where "status" = \'active\' and "total" >= 100 order by "created_at" desc limit 25;',
    )
  })

  it('uses SQL Server TOP syntax and bracket identifiers', () => {
    expect(
      buildSqlSelectQueryText(
        createDefaultSqlSelectBuilderState('orders', 'dbo', 10),
        'sqlserver',
      ),
    ).toBe('select top 10 * from [dbo].[orders];')
  })

  it('uses SQLite main schema and bracket identifiers', () => {
    expect(
      buildSqlSelectQueryText(
        createDefaultSqlSelectBuilderState('accounts', undefined, 100),
        'sqlite',
      ),
    ).toBe('select * from [main].[accounts] limit 100;')
  })

  it('parses simple table SELECTs back into builder state', () => {
    expect(parseSqlSelectQueryText('select top 50 [order_id], [status] from [dbo].[orders] order by [order_id] desc;', 'sqlserver')).toMatchObject({
      kind: 'sql-select',
      schema: 'dbo',
      table: 'orders',
      projectionFields: [
        { field: 'order_id' },
        { field: 'status' },
      ],
      sort: [{ field: 'order_id', direction: 'desc' }],
      limit: 50,
    })
  })
})

describe('DynamoDB key-condition query builder', () => {
  it('generates Query JSON with key condition, filter, projection, and limit', () => {
    const query = JSON.parse(
      buildDynamoDbKeyConditionQueryText({
        kind: 'dynamodb-key-condition',
        table: 'Orders',
        indexName: 'GSI1CustomerOrders',
        partitionKey: {
          id: 'pk',
          field: 'pk',
          operator: 'eq',
          value: 'CUSTOMER#123',
          valueType: 'string',
        },
        sortKey: {
          id: 'sk',
          field: 'sk',
          operator: 'begins-with',
          value: 'ORDER#',
          valueType: 'string',
        },
        filters: [
          {
            id: 'status',
            enabled: true,
            field: 'status',
            operator: 'eq',
            value: 'open',
            valueType: 'string',
          },
        ],
        projectionFields: [
          { id: 'order_id', field: 'order_id' },
          { id: 'total', field: 'total' },
        ],
        limit: 25,
      }),
    )

    expect(query.operation).toBe('Query')
    expect(query.tableName).toBe('Orders')
    expect(query.indexName).toBe('GSI1CustomerOrders')
    expect(query.keyConditionExpression).toBe('#n0 = :v0 and begins_with(#n1, :v1)')
    expect(query.filterExpression).toBe('#n2 = :v2')
    expect(query.projectionExpression).toBe('#n3, #n4')
    expect(query.expressionAttributeNames).toEqual({
      '#n0': 'pk',
      '#n1': 'sk',
      '#n2': 'status',
      '#n3': 'order_id',
      '#n4': 'total',
    })
    expect(query.expressionAttributeValues).toEqual({
      ':v0': { S: 'CUSTOMER#123' },
      ':v1': { S: 'ORDER#' },
      ':v2': { S: 'open' },
    })
    expect(query.limit).toBe(25)
  })

  it('falls back to Scan until a partition key value is supplied', () => {
    const query = JSON.parse(
      buildDynamoDbKeyConditionQueryText(createDefaultDynamoDbKeyConditionBuilderState('Orders')),
    )

    expect(query.operation).toBe('Scan')
    expect(query.keyConditionExpression).toBeUndefined()
  })

  it('parses table, key expression, projection, and limit from raw JSON', () => {
    expect(
      parseDynamoDbKeyConditionQueryText(`{
        "operation": "Query",
        "tableName": "Orders",
        "keyConditionExpression": "#pk = :pk",
        "projectionExpression": "#pk, #total",
        "expressionAttributeNames": { "#pk": "pk", "#total": "total" },
        "expressionAttributeValues": { ":pk": { "S": "CUSTOMER#123" } },
        "limit": 10
      }`),
    ).toMatchObject({
      kind: 'dynamodb-key-condition',
      table: 'Orders',
      partitionKey: { field: 'pk', value: 'CUSTOMER#123' },
      projectionFields: [{ field: 'pk' }, { field: 'total' }],
      limit: 10,
    })
  })
})

describe('CQL partition query builder', () => {
  it('generates partition-key-first CQL with clustering, filters, projection, and limit', () => {
    expect(
      buildCqlPartitionQueryText({
        kind: 'cql-partition',
        keyspace: 'app',
        table: 'events_by_customer',
        projectionFields: [
          { id: 'field-event-id', field: 'event_id' },
          { id: 'field-status', field: 'status' },
        ],
        partitionKeys: [
          {
            id: 'pk',
            field: 'customer_id',
            operator: 'eq',
            value: 'CUSTOMER#123',
            valueType: 'string',
          },
        ],
        clusteringKeys: [
          {
            id: 'created',
            field: 'created_at',
            operator: 'gte',
            value: '1700000000',
            valueType: 'number',
          },
        ],
        filters: [
          {
            id: 'status',
            enabled: true,
            field: 'status',
            operator: 'in',
            value: 'open, paused',
            valueType: 'string',
          },
        ],
        allowFiltering: true,
        limit: 25,
      }),
    ).toBe(
      [
        'select event_id, status',
        'from app.events_by_customer',
        "where customer_id = 'CUSTOMER#123' and created_at >= 1700000000 and status IN ('open', 'paused')",
        'limit 25',
        'allow filtering;',
      ].join('\n'),
    )
  })

  it('parses simple CQL SELECTs into builder state', () => {
    expect(
      parseCqlPartitionQueryText(
        "select event_id, status from app.events_by_customer where customer_id = 'CUSTOMER#123' and status = 'open' limit 10;",
      ),
    ).toMatchObject({
      kind: 'cql-partition',
      keyspace: 'app',
      table: 'events_by_customer',
      projectionFields: [{ field: 'event_id' }, { field: 'status' }],
      partitionKeys: [{ field: 'customer_id', value: 'CUSTOMER#123' }],
      filters: [{ field: 'status', value: 'open' }],
      limit: 10,
    })
  })

  it('creates a default partition-key state with generated CQL', () => {
    expect(createDefaultCqlPartitionBuilderState('orders_by_day', 'app', 20)).toMatchObject({
      kind: 'cql-partition',
      keyspace: 'app',
      table: 'orders_by_day',
      partitionKeys: [{ field: 'customer_id' }],
      limit: 20,
    })
  })
})

describe('Search Query DSL builder', () => {
  it('generates wrapped Query DSL with query, filters, source, sort, and aggregations', () => {
    const query = JSON.parse(
      buildSearchDslQueryText({
        kind: 'search-dsl',
        index: 'products',
        queryMode: 'match',
        field: 'name',
        value: 'lamp',
        valueType: 'string',
        filters: [
          {
            id: 'status',
            enabled: true,
            field: 'status.keyword',
            operator: 'term',
            value: 'active',
            valueType: 'string',
          },
          {
            id: 'archived',
            enabled: false,
            field: 'archived',
            operator: 'term',
            value: 'true',
            valueType: 'boolean',
          },
        ],
        sourceFields: [{ id: 'sku', field: 'sku' }],
        sort: [{ id: 'sort-created', field: 'created_at', direction: 'desc' }],
        aggregations: [{ id: 'agg-status', field: 'status.keyword', name: 'status', size: 5 }],
        size: 25,
      }),
    )

    expect(query.index).toBe('products')
    expect(query.body.query).toEqual({
      bool: {
        must: [{ match: { name: 'lamp' } }],
        filter: [{ term: { 'status.keyword': 'active' } }],
      },
    })
    expect(query.body._source).toEqual(['sku'])
    expect(query.body.sort).toEqual([{ created_at: { order: 'desc' } }])
    expect(query.body.aggs.status).toEqual({
      terms: { field: 'status.keyword', size: 5 },
    })
  })

  it('parses wrapped Query DSL into builder state', () => {
    expect(
      parseSearchDslQueryText(`{
        "index": "products",
        "body": {
          "query": {
            "bool": {
              "must": [{ "match": { "name": "lamp" } }],
              "filter": [{ "term": { "status.keyword": "active" } }]
            }
          },
          "_source": ["sku"],
          "sort": [{ "created_at": { "order": "desc" } }],
          "aggs": { "status": { "terms": { "field": "status.keyword", "size": 5 } } },
          "size": 25
        }
      }`),
    ).toMatchObject({
      kind: 'search-dsl',
      index: 'products',
      queryMode: 'match',
      field: 'name',
      value: 'lamp',
      filters: [{ field: 'status.keyword', value: 'active' }],
      sourceFields: [{ field: 'sku' }],
      sort: [{ field: 'created_at', direction: 'desc' }],
      aggregations: [{ field: 'status.keyword', name: 'status', size: 5 }],
      size: 25,
    })
  })

  it('creates a default match-all search builder', () => {
    expect(createDefaultSearchDslBuilderState('events-*', 20)).toMatchObject({
      kind: 'search-dsl',
      index: 'events-*',
      queryMode: 'match-all',
      size: 20,
    })
  })
})
