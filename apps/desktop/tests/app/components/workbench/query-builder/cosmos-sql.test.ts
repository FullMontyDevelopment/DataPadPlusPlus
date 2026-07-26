import { describe, expect, it } from 'vitest'
import {
  buildCosmosSqlRequest,
  cosmosSqlEditorStateFromBuilder,
  createCosmosSqlQueryEditorState,
  createDefaultCosmosSqlBuilderState,
  validateCosmosSqlEditorState,
} from '../../../../../src/app/components/workbench/query-builder/cosmos-sql'

describe('Cosmos SQL query workflow', () => {
  it('builds projection, filters, sort, and paging from the latest builder draft', () => {
    const state = {
      ...createDefaultCosmosSqlBuilderState('orders', 'catalog', 25),
      projectionFields: [{ id: 'projection-1', field: 'customer.name' }],
      filters: [{
        id: 'filter-1',
        enabled: true,
        field: 'status',
        operator: 'eq' as const,
        value: 'open',
        valueType: 'string' as const,
      }],
      sort: [{ id: 'sort-1', field: 'createdAt', direction: 'desc' as const }],
      offset: 10,
      limit: 20,
    }

    expect(buildCosmosSqlRequest(state)).toEqual({
      operation: 'QueryDocuments',
      database: 'catalog',
      container: 'orders',
      query:
        'SELECT c["customer"]["name"] FROM c WHERE c["status"] = @p0 ORDER BY c["createdAt"] DESC OFFSET 10 LIMIT 20',
      parameters: [{ name: '@p0', value: 'open' }],
      enableCrossPartitionQueries: true,
    })
  })

  it('keeps Builder and Query Editor drafts independent until explicitly copied', () => {
    const builder = createDefaultCosmosSqlBuilderState('orders', 'catalog', 25)
    const editor = createCosmosSqlQueryEditorState(
      'SELECT * FROM c WHERE c.status = @status',
      builder,
    )
    const copied = cosmosSqlEditorStateFromBuilder({
      ...builder,
      filters: [{
        id: 'filter-1',
        field: 'status',
        operator: 'eq',
        value: 'open',
        valueType: 'string',
      }],
    })

    expect(editor.sql).toBe('SELECT * FROM c WHERE c.status = @status')
    expect(editor.source).toBe('default')
    expect(copied.sql).toContain('c["status"] = @p0')
    expect(copied.parameters).toEqual([
      expect.objectContaining({ name: '@p0', value: 'open', valueType: 'string' }),
    ])
    expect(copied.source).toBe('builder')
  })

  it('validates typed bindings, statement safety, and partition routing', () => {
    const validation = validateCosmosSqlEditorState({
      kind: 'cosmos-sql',
      sql: 'SELECT * FROM c WHERE c.tenantId = @tenant AND c.score > @score',
      parameters: [
        { id: 'tenant', name: '@tenant', valueType: 'string', value: 'north' },
        { id: 'score', name: '@score', valueType: 'number', value: '42' },
      ],
      partitionKeyEnabled: true,
      partitionKeyValueType: 'string',
      partitionKeyValue: 'north',
      enableCrossPartitionQueries: true,
      source: 'custom',
    }, {
      database: 'catalog',
      container: 'orders',
    })

    expect(validation.errors).toEqual([])
    expect(validation.input).toEqual({
      kind: 'cosmos-sql',
      database: 'catalog',
      container: 'orders',
      sql: 'SELECT * FROM c WHERE c.tenantId = @tenant AND c.score > @score',
      parameters: [
        { name: '@tenant', value: 'north', valueType: 'string' },
        { name: '@score', value: 42, valueType: 'number' },
      ],
      partitionKey: 'north',
      partitionKeyValueType: 'string',
      enableCrossPartitionQueries: false,
    })

    const invalid = validateCosmosSqlEditorState({
      kind: 'cosmos-sql',
      sql: 'SELECT * FROM c; DELETE FROM c',
      parameters: [
        { id: 'duplicate-1', name: '@value', valueType: 'json', value: '{' },
        { id: 'duplicate-2', name: '@value', valueType: 'string', value: 'x' },
      ],
      source: 'custom',
    }, {
      container: 'orders',
    })
    expect(invalid.errors).toEqual(expect.arrayContaining([
      'Cosmos Query Editor accepts one read-only SELECT statement.',
      '@value: enter valid JSON.',
      'Parameter @value is defined more than once.',
    ]))
    expect(invalid.input).toBeUndefined()
  })

  it('normalizes legacy transport envelopes without exposing them as editor text', () => {
    const builder = createDefaultCosmosSqlBuilderState('orders', 'catalog', 25)
    const editor = createCosmosSqlQueryEditorState(JSON.stringify({
      operation: 'QueryDocuments',
      database: 'catalog',
      container: 'orders',
      query: 'SELECT * FROM c WHERE c.status = @status',
      parameters: [{ name: '@status', value: 'open' }],
      enableCrossPartitionQueries: false,
    }), builder)

    expect(editor.sql).toBe('SELECT * FROM c WHERE c.status = @status')
    expect(editor.parameters).toEqual([
      expect.objectContaining({ name: '@status', value: 'open' }),
    ])
  })
})
