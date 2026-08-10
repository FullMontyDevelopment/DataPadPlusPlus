import { describe, expect, it } from 'vitest'
import type {
  CosmosSqlBuilderState,
  DynamoDbKeyConditionBuilderState,
  MongoFindBuilderState,
  SqlSelectBuilderState,
} from '@datapadplusplus/shared-types'
import {
  builderStateWithCompiledQueryText,
  compileQueryBuilderState,
} from '../../../../../src/app/controllers/query-builder-routing'
import {
  normalizeIsoDate,
  normalizeUuid,
  parseQueryBuilderValue,
} from '../../../../../src/app/components/workbench/query-builder/query-value-codec'
import {
  buildMongoFindQueryText,
  createDefaultMongoFindBuilderState,
  parseMongoFindQueryText,
} from '../../../../../src/app/components/workbench/query-builder/mongo-find'
import {
  buildCosmosSqlQueryText,
  createDefaultCosmosSqlBuilderState,
} from '../../../../../src/app/components/workbench/query-builder/cosmos-sql'
import {
  buildDynamoDbKeyConditionQueryText,
  createDefaultDynamoDbKeyConditionBuilderState,
} from '../../../../../src/app/components/workbench/query-builder/dynamodb-key-condition'
import {
  buildSqlSelectQueryText,
  createDefaultSqlSelectBuilderState,
} from '../../../../../src/app/components/workbench/query-builder/sql-select'
import {
  buildCqlPartitionQueryText,
  createDefaultCqlPartitionBuilderState,
} from '../../../../../src/app/components/workbench/query-builder/cql-partition'
import {
  buildSearchDslQueryText,
  createDefaultSearchDslBuilderState,
} from '../../../../../src/app/components/workbench/query-builder/search-dsl'

describe('query builder typed value codec', () => {
  it('strictly validates numbers, booleans, dates, UUIDs, JSON lists, and array lengths', () => {
    expect(parseQueryBuilderValue('42.5', 'number')).toBe(42.5)
    expect(() => parseQueryBuilderValue('not-a-number', 'number')).toThrow('finite number')
    expect(parseQueryBuilderValue('false', 'boolean')).toBe(false)
    expect(() => parseQueryBuilderValue('yes', 'boolean')).toThrow('true or false')
    expect(normalizeIsoDate('2026-08-09')).toBe('2026-08-09T00:00:00.000Z')
    expect(() => normalizeIsoDate('2026-08-09T10:30:00')).toThrow('timezone')
    expect(normalizeUuid('00000000-0000-0000-0000-000000000000')).toBe('00000000-0000-0000-0000-000000000000')
    expect(normalizeUuid('550E8400-E29B-41D4-A716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000')
    expect(() => normalizeUuid('not-a-guid')).toThrow('canonical')
    expect(parseQueryBuilderValue('[1,2]', 'json', { operator: 'in' })).toEqual([1, 2])
    expect(() => parseQueryBuilderValue('{"one":1}', 'json', { operator: 'in' })).toThrow('JSON array')
    expect(parseQueryBuilderValue('0', 'number', { operator: 'has-length' })).toBe(0)
    expect(() => parseQueryBuilderValue('-1', 'number', { operator: 'has-length' })).toThrow('non-negative')
  })

  it('retains the last valid generated query while an invalid draft is edited', () => {
    const state: MongoFindBuilderState = {
      ...createDefaultMongoFindBuilderState('products'),
      lastAppliedQueryText: 'last-valid-query',
      filters: [{
        id: 'price',
        field: 'price',
        operator: 'gte',
        value: 'not-a-number',
        valueType: 'number',
      }],
    }
    const compilation = compileQueryBuilderState(state, undefined)
    expect(compilation.ok).toBe(false)
    if (!compilation.ok) expect(compilation.errors[0]).toMatchObject({ rowId: 'price', field: 'price' })
    expect(builderStateWithCompiledQueryText(state, undefined).lastAppliedQueryText).toBe('last-valid-query')

    const corrected = builderStateWithCompiledQueryText({
      ...state,
      filters: [{ ...state.filters[0]!, value: '42' }],
    }, undefined)
    expect(corrected.lastAppliedQueryText).not.toBe('last-valid-query')
  })
})

describe('native array predicates', () => {
  it('serializes and parses MongoDB array predicates without matching non-arrays', () => {
    const state = createDefaultMongoFindBuilderState('products')
    const query = JSON.parse(buildMongoFindQueryText({
      ...state,
      filters: [
        { id: 'items', field: 'tags', operator: 'has-items', value: '', valueType: 'string' },
        { id: 'empty', field: 'history', operator: 'has-no-items', value: '', valueType: 'string' },
        { id: 'length', field: 'owners', operator: 'has-length', value: '2', valueType: 'string' },
      ],
    }))
    expect(query.filter).toEqual({
      tags: { $type: 'array', $not: { $size: 0 } },
      history: { $size: 0 },
      owners: { $size: 2 },
    })

    const parsedItems = parseMongoFindQueryText(JSON.stringify({
      collection: 'products',
      filter: { tags: { $type: 'array', $not: { $size: 0 } } },
    }))
    expect(parsedItems?.filters[0]?.operator).toBe('has-items')
    const parsedEmpty = parseMongoFindQueryText(JSON.stringify({
      collection: 'products',
      filter: { tags: { $size: 0 } },
    }))
    expect(parsedEmpty?.filters[0]?.operator).toBe('has-no-items')
  })

  it('uses IS_ARRAY and ARRAY_LENGTH for Cosmos DB', () => {
    const state: CosmosSqlBuilderState = {
      ...createDefaultCosmosSqlBuilderState('products'),
      filters: [
        { id: 'items', field: 'tags', operator: 'has-items', value: '', valueType: 'string' },
        { id: 'empty', field: 'history', operator: 'has-no-items', value: '', valueType: 'string' },
        { id: 'length', field: 'owners', operator: 'has-length', value: '3', valueType: 'string' },
      ],
    }
    const request = JSON.parse(buildCosmosSqlQueryText(state))
    expect(request.query).toContain('IS_ARRAY(c["tags"]) AND ARRAY_LENGTH(c["tags"]) > 0')
    expect(request.query).toContain('IS_ARRAY(c["history"]) AND ARRAY_LENGTH(c["history"]) = 0')
    expect(request.query).toContain('IS_ARRAY(c["owners"]) AND ARRAY_LENGTH(c["owners"]) = 3')
  })

  it('uses list type guards and size expressions for DynamoDB filters', () => {
    const base = createDefaultDynamoDbKeyConditionBuilderState('Orders')
    const state: DynamoDbKeyConditionBuilderState = {
      ...base,
      partitionKey: { ...base.partitionKey, value: 'CUSTOMER#1' },
      filters: [
        { id: 'items', field: 'lines', operator: 'has-items', value: '', valueType: 'string' },
        { id: 'length', field: 'tags', operator: 'has-length', value: '2', valueType: 'number' },
      ],
    }
    const request = JSON.parse(buildDynamoDbKeyConditionQueryText(state))
    expect(request.filterExpression).toMatch(/attribute_type\(#n\d+, :v\d+\) and size\(#n\d+\) > :v\d+/)
    expect(request.filterExpression).toMatch(/attribute_type\(#n\d+, :v\d+\) and size\(#n\d+\) = :v\d+/)
    expect(Object.values(request.expressionAttributeValues)).toContainEqual({ S: 'L' })
    expect(Object.values(request.expressionAttributeValues)).toContainEqual({ N: '2' })
  })

  it.each([
    ['postgresql', 'cardinality("tags") > 0'],
    ['cockroachdb', 'coalesce(array_length("tags", 1), 0) > 0'],
    ['mysql', "json_type(`tags`) = 'ARRAY'"],
    ['mariadb', "json_length(`tags`)"],
    ['sqlite', "json_array_length([tags])"],
    ['sqlserver', 'select count_big(*) from openjson(cast([tags] as nvarchar(max)))'],
  ] as const)('uses the %s native SQL array mechanism', (engine, expected) => {
    const base = createDefaultSqlSelectBuilderState('products')
    const state: SqlSelectBuilderState = {
      ...base,
      filters: [{ id: 'items', field: 'tags', operator: 'has-items', value: '', valueType: 'string' }],
    }
    expect(buildSqlSelectQueryText(state, engine)).toContain(expected)
  })
})

describe('native and validated date/UUID serialization', () => {
  it('uses MongoDB Extended JSON wrappers', () => {
    const state = createDefaultMongoFindBuilderState('events')
    const request = JSON.parse(buildMongoFindQueryText({
      ...state,
      filters: [
        { id: 'date', field: 'createdAt', operator: 'gte', value: '2026-08-09', valueType: 'date' },
        { id: 'uuid', field: 'ownerId', operator: 'eq', value: '550E8400-E29B-41D4-A716-446655440000', valueType: 'uuid' },
      ],
    }))
    expect(request.filter.createdAt).toEqual({ $gte: { $date: '2026-08-09T00:00:00.000Z' } })
    expect(request.filter.ownerId).toEqual({ $uuid: '550e8400-e29b-41d4-a716-446655440000' })
  })

  it('emits native CQL literals and validated Search strings', () => {
    const cql = createDefaultCqlPartitionBuilderState('events', 'app')
    expect(buildCqlPartitionQueryText({
      ...cql,
      partitionKeys: [{ id: 'tenant', field: 'tenant_id', operator: 'eq', value: '550e8400-e29b-41d4-a716-446655440000', valueType: 'uuid' }],
      filters: [{ id: 'date', field: 'created_at', operator: 'gte', value: '2026-08-09', valueType: 'date' }],
    })).toContain("tenant_id = 550e8400-e29b-41d4-a716-446655440000")

    const search = createDefaultSearchDslBuilderState('events')
    const request = JSON.parse(buildSearchDslQueryText({
      ...search,
      queryMode: 'term',
      field: 'ownerId',
      value: '550E8400-E29B-41D4-A716-446655440000',
      valueType: 'uuid',
    }))
    expect(request.body.query.term.ownerId).toBe('550e8400-e29b-41d4-a716-446655440000')
  })
})
