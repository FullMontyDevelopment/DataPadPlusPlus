import { describe, expect, it } from 'vitest'
import type {
  CqlBuilderValueType,
  CqlConditionOperator,
  DynamoDbBuilderValueType,
  DynamoDbConditionOperator,
  MongoBuilderValueType,
  MongoFilterOperator,
  SearchDslFilterOperator,
  SqlBuilderValueType,
  SqlSelectFilterOperator,
} from '@datapadplusplus/shared-types'
import {
  buildCqlPartitionQueryText,
  createDefaultCqlPartitionBuilderState,
  parseCqlPartitionQueryText,
} from '../../../../../src/app/components/workbench/query-builder/cql-partition'
import {
  buildDynamoDbKeyConditionQueryText,
  createDefaultDynamoDbKeyConditionBuilderState,
  parseDynamoDbKeyConditionQueryText,
} from '../../../../../src/app/components/workbench/query-builder/dynamodb-key-condition'
import {
  buildMongoAggregationQueryText,
  createDefaultMongoAggregationBuilderState,
  parseMongoAggregationQueryText,
} from '../../../../../src/app/components/workbench/query-builder/mongo-aggregation'
import {
  buildMongoFindQueryText,
  createDefaultMongoFindBuilderState,
  parseMongoFindQueryText,
} from '../../../../../src/app/components/workbench/query-builder/mongo-find'
import {
  buildSqlSelectQueryText,
  createDefaultSqlSelectBuilderState,
  parseSqlSelectQueryText,
} from '../../../../../src/app/components/workbench/query-builder/sql-select'
import {
  buildSearchDslQueryText,
  createDefaultSearchDslBuilderState,
  parseSearchDslQueryText,
} from '../../../../../src/app/components/workbench/query-builder/search-dsl'

describe('Mongo query builder', () => {
  it('generates basic collection find JSON', () => {
    const query = JSON.parse(buildMongoFindQueryText(createDefaultMongoFindBuilderState('products')))

    expect(query).toEqual({
      collection: 'products',
      filter: {},
      limit: 20,
    })
  })

  it('includes scoped database context in generated Mongo find JSON', () => {
    const query = JSON.parse(
      buildMongoFindQueryText(createDefaultMongoFindBuilderState('embedded_movies'), {
        database: ' sample_mflix ',
      }),
    )

    expect(query).toMatchObject({
      database: 'sample_mflix',
      collection: 'embedded_movies',
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
            id: 'filter-name',
            field: 'name',
            operator: 'contains',
            value: 'Lamp (warm)',
            valueType: 'string',
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
      name: { $regex: '.*Lamp \\(warm\\).*', $options: 'i' },
      tags: { $in: ['featured', 'clearance'] },
    })
  })

  it('generates requested Mongo operators and bare UTC date shorthand', () => {
    const query = JSON.parse(
      buildMongoFindQueryText({
        kind: 'mongo-find',
        collection: 'products',
        filters: [
          {
            id: 'filter-null',
            field: 'archivedAt',
            operator: 'is-null',
            value: 'ignored',
            valueType: 'string',
          },
          {
            id: 'filter-not-null',
            field: 'publishedAt',
            operator: 'is-not-null',
            value: '',
            valueType: 'null',
          },
          {
            id: 'filter-missing',
            field: 'legacyCode',
            operator: 'does-not-exist',
            value: 'ignored',
            valueType: 'string',
          },
          {
            id: 'filter-type',
            field: 'metadata.kind',
            operator: 'type',
            value: 'object',
            valueType: 'string',
          },
          {
            id: 'filter-not-type',
            field: 'score',
            operator: 'not-type',
            value: '2',
            valueType: 'number',
          },
          {
            id: 'filter-starts',
            field: 'sku',
            operator: 'starts-with',
            value: 'PRD-',
            valueType: 'string',
          },
          {
            id: 'filter-not-starts',
            field: 'slug',
            operator: 'not-starts-with',
            value: 'tmp-',
            valueType: 'string',
          },
          {
            id: 'filter-ends',
            field: 'filename',
            operator: 'ends-with',
            value: '.json',
            valueType: 'string',
          },
          {
            id: 'filter-not-ends',
            field: 'name',
            operator: 'not-ends-with',
            value: 'draft',
            valueType: 'string',
          },
          {
            id: 'filter-not-in',
            field: 'status',
            operator: 'not-in',
            value: 'archived, deleted',
            valueType: 'string',
          },
          {
            id: 'filter-date',
            field: 'createdAt',
            operator: 'gte',
            value: '2023-10-05',
            valueType: 'date',
          },
        ],
        projectionMode: 'all',
        projectionFields: [],
        sort: [],
      }),
    )

    expect(query.filter).toEqual({
      archivedAt: null,
      publishedAt: { $ne: null },
      legacyCode: { $exists: false },
      'metadata.kind': { $type: 'object' },
      score: { $not: { $type: 2 } },
      sku: { $regex: '^PRD-', $options: 'i' },
      slug: { $not: { $regex: '^tmp-', $options: 'i' } },
      filename: { $regex: '\\.json$', $options: 'i' },
      name: { $not: { $regex: 'draft$', $options: 'i' } },
      status: { $nin: ['archived', 'deleted'] },
      createdAt: { $gte: { $date: '2023-10-05T00:00:00.000Z' } },
    })
  })

  it('serializes every Mongo filter condition operator', () => {
    const cases = [
      { operator: 'eq', value: 'SKU-001', expected: 'SKU-001' },
      { operator: 'ne', value: 'draft', expected: { $ne: 'draft' } },
      { operator: 'gt', value: '10', valueType: 'number', expected: { $gt: 10 } },
      { operator: 'gte', value: '10.5', valueType: 'number', expected: { $gte: 10.5 } },
      { operator: 'lt', value: '99', valueType: 'number', expected: { $lt: 99 } },
      { operator: 'lte', value: '100', valueType: 'number', expected: { $lte: 100 } },
      { operator: 'contains', value: 'Lamp (warm)', expected: { $regex: '.*Lamp \\(warm\\).*', $options: 'i' } },
      { operator: 'not-contains', value: 'Lamp (warm)', expected: { $not: { $regex: '.*Lamp \\(warm\\).*', $options: 'i' } } },
      { operator: 'regex', value: '^SKU-[0-9]+$', expected: { $regex: '^SKU-[0-9]+$' } },
      { operator: 'exists', value: 'ignored', expected: { $exists: true } },
      { operator: 'does-not-exist', value: 'ignored', expected: { $exists: false } },
      { operator: 'in', value: 'featured, clearance', expected: { $in: ['featured', 'clearance'] } },
      { operator: 'not-in', value: '1, 2', valueType: 'number', expected: { $nin: [1, 2] } },
      { operator: 'is-null', value: 'ignored', expected: null },
      { operator: 'is-not-null', value: 'ignored', expected: { $ne: null } },
      { operator: 'type', value: 'object', expected: { $type: 'object' } },
      { operator: 'not-type', value: '2', expected: { $not: { $type: 2 } } },
      { operator: 'starts-with', value: 'PRD-', expected: { $regex: '^PRD-', $options: 'i' } },
      { operator: 'not-starts-with', value: 'tmp-', expected: { $not: { $regex: '^tmp-', $options: 'i' } } },
      { operator: 'ends-with', value: '.json', expected: { $regex: '\\.json$', $options: 'i' } },
      { operator: 'not-ends-with', value: 'draft', expected: { $not: { $regex: 'draft$', $options: 'i' } } },
      {
        operator: 'eq',
        field: 'createdAt',
        value: '2023-10-05',
        valueType: 'date',
        expected: { $date: '2023-10-05T00:00:00.000Z' },
      },
      {
        operator: 'eq',
        field: '_id',
        value: 'ObjectId("507f1f77bcf86cd799439011")',
        valueType: 'objectId',
        expected: { $oid: '507f1f77bcf86cd799439011' },
      },
    ] satisfies Array<{
      field?: string
      operator: MongoFilterOperator
      value: string
      valueType?: MongoBuilderValueType
      expected: unknown
    }>

    expect(new Set(cases.map((entry) => entry.operator))).toEqual(new Set([
      'eq',
      'ne',
      'gt',
      'gte',
      'lt',
      'lte',
      'contains',
      'not-contains',
      'regex',
      'exists',
      'does-not-exist',
      'in',
      'not-in',
      'is-null',
      'is-not-null',
      'type',
      'not-type',
      'starts-with',
      'not-starts-with',
      'ends-with',
      'not-ends-with',
    ] satisfies MongoFilterOperator[]))

    for (const testCase of cases) {
      const field = testCase.field ?? 'field'
      const query = JSON.parse(
        buildMongoFindQueryText({
          kind: 'mongo-find',
          collection: 'products',
          filters: [{
            id: `filter-${testCase.operator}-${field}`,
            field,
            operator: testCase.operator,
            value: testCase.value,
            valueType: testCase.valueType ?? 'string',
          }],
          projectionMode: 'all',
          projectionFields: [],
          sort: [],
        }),
      )

      expect(query.filter).toEqual({ [field]: testCase.expected })
    }
  })

  it('parses new Mongo operators back into builder rows', () => {
    expect(
      parseMongoFindQueryText(`{
        "collection": "products",
        "filter": {
          "archivedAt": null,
          "publishedAt": { "$ne": null },
          "legacyCode": { "$exists": false },
          "metadata.kind": { "$type": "object" },
          "score": { "$not": { "$type": 2 } },
          "name": { "$regex": ".*Lamp \\\\(warm\\\\).*", "$options": "i" },
          "description": { "$not": { "$regex": ".*Lamp.*", "$options": "i" } },
          "sku": { "$regex": "^PRD-", "$options": "i" },
          "slug": { "$not": { "$regex": "^tmp-", "$options": "i" } },
          "filename": { "$regex": "\\\\.json$", "$options": "i" },
          "legacyFilename": { "$not": { "$regex": "\\\\.tmp$", "$options": "i" } },
          "status": { "$nin": ["archived", "deleted"] }
        }
      }`),
    ).toMatchObject({
      filters: [
        { field: 'archivedAt', operator: 'is-null', value: '', valueType: 'null' },
        { field: 'publishedAt', operator: 'is-not-null', value: '' },
        { field: 'legacyCode', operator: 'does-not-exist', value: '' },
        { field: 'metadata.kind', operator: 'type', value: 'object' },
        { field: 'score', operator: 'not-type', value: '2' },
        { field: 'name', operator: 'contains', value: 'Lamp (warm)' },
        { field: 'description', operator: 'not-contains', value: 'Lamp' },
        { field: 'sku', operator: 'starts-with', value: 'PRD-' },
        { field: 'slug', operator: 'not-starts-with', value: 'tmp-' },
        { field: 'filename', operator: 'ends-with', value: '.json' },
        { field: 'legacyFilename', operator: 'not-ends-with', value: '.tmp' },
        { field: 'status', operator: 'not-in', value: 'archived, deleted' },
      ],
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

  it('generates native Mongo scalar filters for dates and object ids', () => {
    const query = JSON.parse(
      buildMongoFindQueryText({
        kind: 'mongo-find',
        collection: 'events',
        filters: [
          {
            id: 'filter-created',
            field: 'createdAt',
            operator: 'gte',
            value: '2026-05-16T10:02:21.369Z',
            valueType: 'date',
          },
          {
            id: 'filter-id',
            field: '_id',
            operator: 'eq',
            value: '507f1f77bcf86cd799439011',
            valueType: 'objectId',
          },
        ],
        projectionMode: 'all',
        projectionFields: [],
        sort: [],
      }),
    )

    expect(query.filter).toEqual({
      createdAt: { $gte: { $date: '2026-05-16T10:02:21.369Z' } },
      _id: { $oid: '507f1f77bcf86cd799439011' },
    })
  })

  it('parses native Mongo scalar filters back into builder rows', () => {
    expect(
      parseMongoFindQueryText(`{
        "collection": "events",
        "filter": {
          "createdAt": { "$gte": { "$date": { "$numberLong": "1778925741369" } } },
          "_id": { "$oid": "507f1f77bcf86cd799439011" }
        }
      }`),
    ).toMatchObject({
      filters: [
        {
          field: 'createdAt',
          operator: 'gte',
          value: '2026-05-16T10:02:21.369Z',
          valueType: 'date',
        },
        {
          field: '_id',
          operator: 'eq',
          value: '507f1f77bcf86cd799439011',
          valueType: 'objectId',
        },
      ],
    })
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

  it('keeps ungrouped Mongo filters standalone when explicit groups exist', () => {
    const query = JSON.parse(
      buildMongoFindQueryText({
        kind: 'mongo-find',
        collection: 'orders',
        filterGroups: [{ id: 'group-region', label: 'Region', logic: 'or' }],
        filters: [
          {
            id: 'filter-status',
            field: 'status',
            operator: 'eq',
            value: 'open',
            valueType: 'string',
          },
          {
            id: 'filter-us',
            field: 'region',
            groupId: 'group-region',
            operator: 'eq',
            value: 'us-east-1',
            valueType: 'string',
          },
          {
            id: 'filter-eu',
            field: 'region',
            groupId: 'group-region',
            operator: 'eq',
            value: 'eu-west-1',
            valueType: 'string',
          },
        ],
        projectionMode: 'all',
        projectionFields: [],
        sort: [],
      }),
    )

    expect(query.filter).toEqual({
      $and: [
        { status: 'open' },
        { $or: [{ region: 'us-east-1' }, { region: 'eu-west-1' }] },
      ],
    })
  })

  it('ignores disabled Mongo filter groups while preserving active filters', () => {
    const query = JSON.parse(
      buildMongoFindQueryText({
        kind: 'mongo-find',
        collection: 'orders',
        filterGroups: [
          { id: 'group-region', enabled: false, label: 'Region', logic: 'or' },
          { id: 'group-total', enabled: true, label: 'Total', logic: 'and' },
        ],
        filters: [
          {
            id: 'filter-status',
            field: 'status',
            operator: 'eq',
            value: 'open',
            valueType: 'string',
          },
          {
            id: 'filter-region',
            field: 'region',
            groupId: 'group-region',
            operator: 'eq',
            value: 'us-east-1',
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
        { status: 'open' },
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

  it('includes scoped database context in generated Mongo aggregation JSON', () => {
    const query = JSON.parse(
      buildMongoAggregationQueryText(createDefaultMongoAggregationBuilderState('orders', 20), {
        database: ' catalog ',
      }),
    )

    expect(query).toMatchObject({
      database: 'catalog',
      collection: 'orders',
      operation: 'aggregate',
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
            id: 'filter-name',
            enabled: true,
            field: 'display_name',
            operator: 'contains',
            value: 'A_%',
            valueType: 'string',
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
      'select "email", "status" from "public"."accounts" where "status" = \'active\' and "total" >= 100 and "display_name" like \'%A\\_\\%%\' escape \'\\\' order by "created_at" desc limit 25;',
    )
  })

  it('generates SQL-compatible negated and anchored string filters', () => {
    expect(
      buildSqlSelectQueryText({
        kind: 'sql-select',
        schema: 'public',
        table: 'accounts',
        projectionFields: [],
        filters: [
          {
            id: 'filter-domain',
            enabled: true,
            field: 'email',
            operator: 'ends-with',
            value: '@example.com',
            valueType: 'string',
          },
          {
            id: 'filter-name',
            enabled: true,
            field: 'display_name',
            operator: 'not-starts-with',
            value: 'Test',
            valueType: 'string',
          },
          {
            id: 'filter-status',
            enabled: true,
            field: 'status',
            operator: 'not-in',
            value: 'archived, deleted',
            valueType: 'string',
          },
        ],
        filterLogic: 'and',
        sort: [],
        limit: 20,
      }),
    ).toBe(
      'select * from "public"."accounts" where "email" like \'%@example.com\' escape \'\\\' and "display_name" not like \'Test%\' escape \'\\\' and "status" not in (\'archived\', \'deleted\') limit 20;',
    )
  })

  it('serializes every SQL filter condition operator', () => {
    const cases = [
      { operator: 'eq', value: 'active', expectedWhere: `"field" = 'active'` },
      { operator: 'ne', value: 'archived', expectedWhere: `"field" <> 'archived'` },
      { operator: 'gt', value: '10', valueType: 'number', expectedWhere: `"field" > 10` },
      { operator: 'gte', value: '10.5', valueType: 'number', expectedWhere: `"field" >= 10.5` },
      { operator: 'lt', value: '99', valueType: 'number', expectedWhere: `"field" < 99` },
      { operator: 'lte', value: '100', valueType: 'number', expectedWhere: `"field" <= 100` },
      { operator: 'contains', value: 'A_%', expectedWhere: `"field" like '%A\\_\\%%' escape '\\'` },
      { operator: 'not-contains', value: 'A_%', expectedWhere: `"field" not like '%A\\_\\%%' escape '\\'` },
      { operator: 'like', value: 'A%', expectedWhere: `"field" like 'A%'` },
      { operator: 'in', value: 'open, paused', expectedWhere: `"field" in ('open', 'paused')` },
      { operator: 'not-in', value: 'archived, deleted', expectedWhere: `"field" not in ('archived', 'deleted')` },
      { operator: 'is-null', value: 'ignored', expectedWhere: `"field" is null` },
      { operator: 'is-not-null', value: 'ignored', expectedWhere: `"field" is not null` },
      { operator: 'starts-with', value: 'Test', expectedWhere: `"field" like 'Test%' escape '\\'` },
      { operator: 'not-starts-with', value: 'Test', expectedWhere: `"field" not like 'Test%' escape '\\'` },
      { operator: 'ends-with', value: '@example.com', expectedWhere: `"field" like '%@example.com' escape '\\'` },
      { operator: 'not-ends-with', value: '@example.com', expectedWhere: `"field" not like '%@example.com' escape '\\'` },
    ] satisfies Array<{
      operator: SqlSelectFilterOperator
      value: string
      valueType?: CqlBuilderValueType
      expectedWhere: string
    }>

    expect(new Set(cases.map((entry) => entry.operator))).toEqual(new Set([
      'eq',
      'ne',
      'gt',
      'gte',
      'lt',
      'lte',
      'contains',
      'not-contains',
      'like',
      'in',
      'not-in',
      'is-null',
      'is-not-null',
      'starts-with',
      'not-starts-with',
      'ends-with',
      'not-ends-with',
    ] satisfies SqlSelectFilterOperator[]))

    for (const testCase of cases) {
      expect(
        buildSqlSelectQueryText({
          kind: 'sql-select',
          schema: 'public',
          table: 'accounts',
          projectionFields: [],
          filters: [{
            id: `filter-${testCase.operator}`,
            enabled: true,
            field: 'field',
            operator: testCase.operator,
            value: testCase.value,
            valueType: testCase.valueType ?? 'string',
          }],
          filterLogic: 'and',
          sort: [],
          limit: 20,
        }),
      ).toBe(`select * from "public"."accounts" where ${testCase.expectedWhere} limit 20;`)
    }
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

  it('uses MySQL backtick identifiers and numeric boolean literals', () => {
    expect(
      buildSqlSelectQueryText(
        {
          kind: 'sql-select',
          schema: 'Sales DB',
          table: 'Order Items',
          projectionFields: [{ id: 'field-order-id', field: 'order id' }],
          filters: [
            {
              id: 'filter-active',
              enabled: true,
              field: 'active',
              operator: 'eq',
              value: 'true',
              valueType: 'boolean',
            },
          ],
          filterLogic: 'and',
          sort: [],
          limit: 10,
        },
        'mysql',
      ),
    ).toBe(
      'select `order id` from `Sales DB`.`Order Items` where `active` = 1 limit 10;',
    )
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

    expect(
      parseSqlSelectQueryText(
        'select `order id`, status from `Sales DB`.`Order Items` limit 30;',
        'mysql',
      ),
    ).toMatchObject({
      kind: 'sql-select',
      schema: 'Sales DB',
      table: 'Order Items',
      projectionFields: [
        { field: 'order id' },
        { field: 'status' },
      ],
      limit: 30,
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

  it('generates DynamoDB-native absence and negated contains filters', () => {
    const query = JSON.parse(
      buildDynamoDbKeyConditionQueryText({
        kind: 'dynamodb-key-condition',
        table: 'Orders',
        partitionKey: {
          id: 'pk',
          field: 'pk',
          operator: 'eq',
          value: 'CUSTOMER#123',
          valueType: 'string',
        },
        filters: [
          {
            id: 'filter-missing',
            enabled: true,
            field: 'legacyCode',
            operator: 'does-not-exist',
            value: '',
            valueType: 'string',
          },
          {
            id: 'filter-tags',
            enabled: true,
            field: 'tags',
            operator: 'not-contains',
            value: 'archived',
            valueType: 'string',
          },
        ],
        projectionFields: [],
        limit: 25,
      }),
    )

    expect(query.filterExpression).toBe('attribute_not_exists(#n1) and not contains(#n2, :v1)')
  })

  it('serializes every DynamoDB filter condition operator', () => {
    const cases = [
      { operator: 'eq', expected: '#n1 = :v1' },
      { operator: 'ne', expected: '#n1 <> :v1' },
      { operator: 'gt', value: '10', valueType: 'number', expected: '#n1 > :v1' },
      { operator: 'gte', value: '10', valueType: 'number', expected: '#n1 >= :v1' },
      { operator: 'lt', value: '20', valueType: 'number', expected: '#n1 < :v1' },
      { operator: 'lte', value: '20', valueType: 'number', expected: '#n1 <= :v1' },
      { operator: 'between', value: '10', secondValue: '20', valueType: 'number', expected: '#n1 between :v1 and :v2' },
      { operator: 'begins-with', value: 'ORDER#', expected: 'begins_with(#n1, :v1)' },
      { operator: 'contains', value: 'fragile', expected: 'contains(#n1, :v1)' },
      { operator: 'not-contains', value: 'archived', expected: 'not contains(#n1, :v1)' },
      { operator: 'exists', value: '', expected: 'attribute_exists(#n1)' },
      { operator: 'does-not-exist', value: '', expected: 'attribute_not_exists(#n1)' },
    ] satisfies Array<{
      operator: DynamoDbConditionOperator
      value?: string
      secondValue?: string
      valueType?: DynamoDbBuilderValueType
      expected: string
    }>

    expect(new Set(cases.map((entry) => entry.operator))).toEqual(new Set([
      'eq',
      'ne',
      'gt',
      'gte',
      'lt',
      'lte',
      'between',
      'begins-with',
      'contains',
      'not-contains',
      'exists',
      'does-not-exist',
    ] satisfies DynamoDbConditionOperator[]))

    for (const testCase of cases) {
      const query = JSON.parse(
        buildDynamoDbKeyConditionQueryText({
          kind: 'dynamodb-key-condition',
          table: 'Orders',
          partitionKey: {
            id: 'pk',
            field: 'pk',
            operator: 'eq',
            value: 'CUSTOMER#123',
            valueType: 'string',
          },
          filters: [{
            id: `filter-${testCase.operator}`,
            enabled: true,
            field: 'field',
            operator: testCase.operator,
            value: testCase.value ?? 'value',
            secondValue: testCase.secondValue,
            valueType: testCase.valueType ?? 'string',
          }],
          projectionFields: [],
          limit: 25,
        }),
      )

      expect(query.filterExpression).toBe(testCase.expected)
    }
  })

  it('serializes DynamoDB condition value types as AttributeValue payloads', () => {
    const query = JSON.parse(
      buildDynamoDbKeyConditionQueryText({
        kind: 'dynamodb-key-condition',
        table: 'Orders',
        partitionKey: {
          id: 'pk',
          field: 'pk',
          operator: 'eq',
          value: 'CUSTOMER#123',
          valueType: 'string',
        },
        filters: [
          { id: 'string', enabled: true, field: 'stringValue', operator: 'eq', value: 'open', valueType: 'string' },
          { id: 'number', enabled: true, field: 'numberValue', operator: 'eq', value: '42.5', valueType: 'number' },
          { id: 'boolean', enabled: true, field: 'booleanValue', operator: 'eq', value: 'yes', valueType: 'boolean' },
          { id: 'null', enabled: true, field: 'nullValue', operator: 'eq', value: '', valueType: 'null' },
          {
            id: 'json',
            enabled: true,
            field: 'jsonValue',
            operator: 'eq',
            value: '{"tags":["new"],"count":2}',
            valueType: 'json',
          },
        ],
        projectionFields: [],
        limit: 25,
      }),
    )

    expect(query.expressionAttributeValues).toEqual({
      ':v0': { S: 'CUSTOMER#123' },
      ':v1': { S: 'open' },
      ':v2': { N: '42.5' },
      ':v3': { BOOL: true },
      ':v4': { NULL: true },
      ':v5': {
        M: {
          tags: { L: [{ S: 'new' }] },
          count: { N: '2' },
        },
      },
    })
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

  it('serializes every currently supported CQL condition operator', () => {
    const cases = [
      { operator: 'eq', value: 'open', expected: "field = 'open'" },
      { operator: 'gt', value: '10', valueType: 'number', expected: 'field > 10' },
      { operator: 'gte', value: '10', valueType: 'number', expected: 'field >= 10' },
      { operator: 'lt', value: '20', valueType: 'number', expected: 'field < 20' },
      { operator: 'lte', value: '20', valueType: 'number', expected: 'field <= 20' },
      { operator: 'in', value: 'open, paused', expected: "field IN ('open', 'paused')" },
      { operator: 'contains', value: 'tagged', expected: "field CONTAINS 'tagged'" },
    ] satisfies Array<{
      operator: CqlConditionOperator
      value: string
      valueType?: SqlBuilderValueType
      expected: string
    }>

    expect(new Set(cases.map((entry) => entry.operator))).toEqual(new Set([
      'eq',
      'gt',
      'gte',
      'lt',
      'lte',
      'in',
      'contains',
    ] satisfies CqlConditionOperator[]))

    for (const testCase of cases) {
      expect(
        buildCqlPartitionQueryText({
          kind: 'cql-partition',
          keyspace: 'app',
          table: 'events',
          projectionFields: [],
          partitionKeys: [],
          clusteringKeys: [],
          filters: [{
            id: `filter-${testCase.operator}`,
            enabled: true,
            field: 'field',
            operator: testCase.operator,
            value: testCase.value,
            valueType: testCase.valueType ?? 'string',
          }],
          allowFiltering: false,
          limit: 20,
        }),
      ).toBe([
        'select *',
        'from app.events',
        `where ${testCase.expected}`,
        'limit 20;',
      ].join('\n'))
    }
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
      partitionKeys: [{ field: '' }],
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
        aggregations: [
          {
            id: 'agg-status',
            field: 'status.keyword',
            name: 'status',
            type: 'terms',
            size: 5,
          },
          {
            id: 'agg-day',
            field: 'created_at',
            name: 'orders_by_day',
            type: 'date-histogram',
            interval: '1d',
          },
          {
            id: 'agg-revenue',
            field: 'total_amount',
            name: 'avg_revenue',
            type: 'avg',
          },
        ],
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
    expect(query.body.aggs.orders_by_day).toEqual({
      date_histogram: { field: 'created_at', calendar_interval: '1d' },
    })
    expect(query.body.aggs.avg_revenue).toEqual({
      avg: { field: 'total_amount' },
    })
  })

  it('generates search-native negated and prefix filters', () => {
    const query = JSON.parse(
      buildSearchDslQueryText({
        kind: 'search-dsl',
        index: 'products',
        queryMode: 'match-all',
        field: '',
        value: '',
        valueType: 'string',
        filters: [
          {
            id: 'missing',
            enabled: true,
            field: 'legacyCode',
            operator: 'does-not-exist',
            value: '',
            valueType: 'string',
          },
          {
            id: 'prefix',
            enabled: true,
            field: 'sku.keyword',
            operator: 'starts-with',
            value: 'PRD-',
            valueType: 'string',
          },
          {
            id: 'suffix',
            enabled: true,
            field: 'filename.keyword',
            operator: 'not-ends-with',
            value: '.tmp',
            valueType: 'string',
          },
          {
            id: 'status',
            enabled: true,
            field: 'status.keyword',
            operator: 'not-in',
            value: 'archived, deleted',
            valueType: 'string',
          },
        ],
        sourceFields: [],
        sort: [],
        aggregations: [],
        size: 20,
      }),
    )

    expect(query.body.query.bool.filter).toEqual([
      { bool: { must_not: [{ exists: { field: 'legacyCode' } }] } },
      { prefix: { 'sku.keyword': 'PRD-' } },
      { bool: { must_not: [{ wildcard: { 'filename.keyword': '*.tmp' } }] } },
      {
        bool: {
          must_not: [{ terms: { 'status.keyword': ['archived', 'deleted'] } }],
        },
      },
    ])
  })

  it('serializes every Search Query DSL filter condition operator', () => {
    const cases = [
      { operator: 'term', value: 'active', expected: { term: { field: 'active' } } },
      { operator: 'match', value: 'lamp', expected: { match: { field: 'lamp' } } },
      { operator: 'exists', value: '', expected: { exists: { field: 'field' } } },
      { operator: 'does-not-exist', value: '', expected: { bool: { must_not: [{ exists: { field: 'field' } }] } } },
      { operator: 'starts-with', value: 'PRD-', expected: { prefix: { field: 'PRD-' } } },
      { operator: 'not-starts-with', value: 'tmp-', expected: { bool: { must_not: [{ prefix: { field: 'tmp-' } }] } } },
      { operator: 'ends-with', value: '.json', expected: { wildcard: { field: '*.json' } } },
      { operator: 'not-ends-with', value: '.tmp', expected: { bool: { must_not: [{ wildcard: { field: '*.tmp' } }] } } },
      { operator: 'not-contains', value: 'draft', expected: { bool: { must_not: [{ wildcard: { field: '*draft*' } }] } } },
      {
        operator: 'not-in',
        value: 'archived, deleted',
        expected: { bool: { must_not: [{ terms: { field: ['archived', 'deleted'] } }] } },
      },
      { operator: 'range-gte', value: '10', valueType: 'number', expected: { range: { field: { gte: 10 } } } },
      { operator: 'range-lte', value: '20', valueType: 'number', expected: { range: { field: { lte: 20 } } } },
    ] satisfies Array<{
      operator: SearchDslFilterOperator
      value: string
      valueType?: 'string' | 'number' | 'boolean'
      expected: unknown
    }>

    expect(new Set(cases.map((entry) => entry.operator))).toEqual(new Set([
      'term',
      'match',
      'exists',
      'does-not-exist',
      'starts-with',
      'not-starts-with',
      'ends-with',
      'not-ends-with',
      'not-contains',
      'not-in',
      'range-gte',
      'range-lte',
    ] satisfies SearchDslFilterOperator[]))

    for (const testCase of cases) {
      const query = JSON.parse(
        buildSearchDslQueryText({
          kind: 'search-dsl',
          index: 'products',
          queryMode: 'match-all',
          field: '',
          value: '',
          valueType: 'string',
          filters: [{
            id: `filter-${testCase.operator}`,
            enabled: true,
            field: 'field',
            operator: testCase.operator,
            value: testCase.value,
            valueType: testCase.valueType ?? 'string',
          }],
          sourceFields: [],
          sort: [],
          aggregations: [],
          size: 20,
        }),
      )

      expect(query.body.query.bool.filter).toEqual([testCase.expected])
    }
  })

  it('parses search negated contains and anchored filters back into builder rows', () => {
    expect(
      parseSearchDslQueryText(`{
        "index": "products",
        "body": {
          "query": {
            "bool": {
              "must": [{ "match_all": {} }],
              "filter": [
                { "bool": { "must_not": [{ "wildcard": { "name.keyword": "*draft*" } }] } },
                { "bool": { "must_not": [{ "prefix": { "sku.keyword": "tmp-" } }] } },
                { "bool": { "must_not": [{ "wildcard": { "filename.keyword": "*.tmp" } }] } }
              ]
            }
          }
        }
      }`),
    ).toMatchObject({
      filters: [
        { field: 'name.keyword', operator: 'not-contains', value: 'draft' },
        { field: 'sku.keyword', operator: 'not-starts-with', value: 'tmp-' },
        { field: 'filename.keyword', operator: 'not-ends-with', value: '.tmp' },
      ],
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
          "aggs": {
            "status": { "terms": { "field": "status.keyword", "size": 5 } },
            "orders_by_day": { "date_histogram": { "field": "created_at", "calendar_interval": "1d" } },
            "avg_revenue": { "avg": { "field": "total_amount" } }
          },
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
      aggregations: [
        { field: 'status.keyword', name: 'status', type: 'terms', size: 5 },
        {
          field: 'created_at',
          name: 'orders_by_day',
          type: 'date-histogram',
          interval: '1d',
        },
        {
          field: 'total_amount',
          name: 'avg_revenue',
          type: 'avg',
        },
      ],
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

describe('Query builder condition serialization guardrails', () => {
  it('skips disabled and empty condition rows without malformed output', () => {
    const mongo = JSON.parse(
      buildMongoFindQueryText({
        kind: 'mongo-find',
        collection: 'products',
        filters: [
          { id: 'empty', field: '', operator: 'contains', value: 'ignored', valueType: 'string' },
          { id: 'disabled', enabled: false, field: 'disabled', operator: 'contains', value: 'ignored', valueType: 'string' },
          { id: 'active', field: 'name', operator: 'not-contains', value: 'draft', valueType: 'string' },
        ],
        projectionMode: 'all',
        projectionFields: [],
        sort: [],
      }),
    )
    expect(mongo.filter).toEqual({ name: { $not: { $regex: '.*draft.*', $options: 'i' } } })

    expect(
      buildSqlSelectQueryText({
        kind: 'sql-select',
        schema: 'public',
        table: 'accounts',
        projectionFields: [],
        filters: [
          { id: 'empty', field: '', operator: 'contains', value: 'ignored', valueType: 'string' },
          { id: 'disabled', enabled: false, field: 'disabled', operator: 'contains', value: 'ignored', valueType: 'string' },
          { id: 'active', enabled: true, field: 'name', operator: 'not-contains', value: 'draft', valueType: 'string' },
        ],
        filterLogic: 'and',
        sort: [],
        limit: 20,
      }),
    ).toBe('select * from "public"."accounts" where "name" not like \'%draft%\' escape \'\\\' limit 20;')

    const dynamo = JSON.parse(
      buildDynamoDbKeyConditionQueryText({
        kind: 'dynamodb-key-condition',
        table: 'Orders',
        partitionKey: { id: 'pk', field: 'pk', operator: 'eq', value: 'CUSTOMER#123', valueType: 'string' },
        filters: [
          { id: 'empty', field: '', operator: 'contains', value: 'ignored', valueType: 'string' },
          { id: 'disabled', enabled: false, field: 'disabled', operator: 'contains', value: 'ignored', valueType: 'string' },
          { id: 'active', enabled: true, field: 'tags', operator: 'not-contains', value: 'draft', valueType: 'string' },
        ],
        projectionFields: [],
        limit: 20,
      }),
    )
    expect(dynamo.filterExpression).toBe('not contains(#n1, :v1)')
    expect(dynamo.expressionAttributeNames).toEqual({ '#n0': 'pk', '#n1': 'tags' })

    expect(
      buildCqlPartitionQueryText({
        kind: 'cql-partition',
        keyspace: 'app',
        table: 'events',
        projectionFields: [],
        partitionKeys: [],
        clusteringKeys: [],
        filters: [
          { id: 'empty', field: '', operator: 'contains', value: 'ignored', valueType: 'string' },
          { id: 'disabled', enabled: false, field: 'disabled', operator: 'contains', value: 'ignored', valueType: 'string' },
          { id: 'active', enabled: true, field: 'tags', operator: 'contains', value: 'draft', valueType: 'string' },
        ],
        allowFiltering: false,
        limit: 20,
      }),
    ).toBe([
      'select *',
      'from app.events',
      "where tags CONTAINS 'draft'",
      'limit 20;',
    ].join('\n'))

    const search = JSON.parse(
      buildSearchDslQueryText({
        kind: 'search-dsl',
        index: 'products',
        queryMode: 'match-all',
        field: '',
        value: '',
        valueType: 'string',
        filters: [
          { id: 'empty', field: '', operator: 'term', value: 'ignored', valueType: 'string' },
          { id: 'disabled', enabled: false, field: 'disabled', operator: 'term', value: 'ignored', valueType: 'string' },
          { id: 'active', enabled: true, field: 'name.keyword', operator: 'not-contains', value: 'draft', valueType: 'string' },
        ],
        sourceFields: [],
        sort: [],
        aggregations: [],
        size: 20,
      }),
    )
    expect(search.body.query.bool.filter).toEqual([
      { bool: { must_not: [{ wildcard: { 'name.keyword': '*draft*' } }] } },
    ])
  })
})
