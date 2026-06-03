import { render, screen, within } from '@testing-library/react'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { normalizeGenericPlanPayload } from './generic-plan-payload'
import { ResultPayloadView } from './ResultPayloadView'
import { normalizeMongoExplainPlan } from './mongo-explain-plan'

describe('MongoExplainPlanView', () => {
  it('normalizes MongoDB find explain metrics and warnings', () => {
    const model = normalizeMongoExplainPlan(findExplain())

    expect(model.summary.namespace).toBe('catalog.products')
    expect(model.summary.winningStage).toBe('FETCH')
    expect(model.summary.indexName).toBe('sku_1')
    expect(model.summary.returned).toBe(2)
    expect(model.summary.docsExamined).toBe(80)
    expect(model.summary.keysExamined).toBe(2)
    expect(model.indexDetails[0]?.name).toBe('sku_1')
    expect(model.rejectedPlans).toHaveLength(1)
    expect(model.warnings.join(' ')).toContain('High scan ratio')
    expect(model.warnings.join(' ')).toContain('rejected plan')
  })

  it('detects collection scans and missing execution stats', () => {
    const model = normalizeMongoExplainPlan({
      queryPlanner: {
        namespace: 'catalog.products',
        winningPlan: { stage: 'COLLSCAN', direction: 'forward' },
      },
    })

    expect(model.summary.verbosity).toBe('queryPlanner')
    expect(model.warnings.join(' ')).toContain('Collection scan')
    expect(model.warnings.join(' ')).toContain('Execution statistics are not present')
  })

  it('handles aggregation cursor explain payloads', () => {
    const model = normalizeMongoExplainPlan({
      stages: [
        {
          $cursor: {
            queryPlanner: {
              namespace: 'catalog.products',
              winningPlan: {
                stage: 'FETCH',
                inputStage: { stage: 'IXSCAN', indexName: 'channels_1' },
              },
            },
            executionStats: {
              nReturned: 12,
              executionTimeMillis: 6,
              totalKeysExamined: 12,
              totalDocsExamined: 12,
              executionStages: {
                stage: 'FETCH',
                inputStage: { stage: 'IXSCAN', indexName: 'channels_1' },
              },
            },
          },
        },
        { $project: { sku: 1 } },
      ],
    })

    expect(model.summary.namespace).toBe('catalog.products')
    expect(model.summary.indexName).toBe('channels_1')
    expect(model.summary.returned).toBe(12)
  })

  it('renders a purpose-built MongoDB explain dashboard from plan payloads', () => {
    render(
      <ResultPayloadView
        connection={connection('mongodb')}
        payload={{
          renderer: 'plan',
          format: 'json',
          value: findExplain(),
          summary: 'MongoDB execution plan',
        }}
      />,
    )

    expect(screen.getByRole('region', { name: 'MongoDB explain plan' })).toBeInTheDocument()
    expect(screen.getByText('MongoDB Explain')).toBeInTheDocument()
    expect(screen.getByText('catalog.products')).toBeInTheDocument()
    expect(screen.getAllByText('sku_1').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Winning Plan')).toBeInTheDocument()
    expect(screen.getByText('Index Usage')).toBeInTheDocument()
    expect(screen.getByText('Rejected Plans')).toBeInTheDocument()

    const warnings = screen.getByRole('note', { name: 'Explain plan warnings' })
    expect(within(warnings).getByText(/High scan ratio/)).toBeInTheDocument()
  })

  it('keeps a generic plan fallback for non-MongoDB plan payloads', () => {
    render(
      <ResultPayloadView
        connection={connection('postgresql')}
        payload={{
          renderer: 'plan',
          format: 'json',
          value: { plan: [{ nodeType: 'Seq Scan' }] },
          summary: 'PostgreSQL plan',
        }}
      />,
    )

    expect(screen.getByRole('region', { name: 'Execution plan' })).toBeInTheDocument()
    expect(screen.getByText('PostgreSQL plan')).toBeInTheDocument()
    expect(screen.queryByText('MongoDB Explain')).not.toBeInTheDocument()
  })

  it('renders PostgreSQL explain plan lines with table fallback', () => {
    render(
      <ResultPayloadView
        connection={connection('postgresql')}
        payload={{
          renderer: 'plan',
          format: 'text',
          value: {
            statement: 'EXPLAIN select * from accounts',
            format: 'text',
            plan: [
              'Seq Scan on accounts',
              '  Filter: active',
            ],
            columns: ['QUERY PLAN'],
            rows: [['Seq Scan on accounts\n  Filter: active']],
          },
          summary: 'PostgreSQL EXPLAIN plan returned.',
        }}
      />,
    )

    expect(screen.getByText('PostgreSQL Plan')).toBeInTheDocument()
    expect(screen.getByText('PostgreSQL EXPLAIN plan returned.')).toBeInTheDocument()
    expect(screen.getAllByText(/Seq Scan on accounts/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Plan Table')).toBeInTheDocument()
    expect(screen.getByRole('note', { name: 'Execution plan warnings' })).toHaveTextContent('broad scan')
  })

  it('renders DuckDB text-shaped plan rows without object string leaks', () => {
    render(
      <ResultPayloadView
        connection={connection('duckdb')}
        payload={{
          renderer: 'plan',
          format: 'text',
          value: [
            ['physical_plan', 'SEQ_SCAN table=orders'],
            ['physical_plan', 'HASH_JOIN customers'],
          ],
          summary: 'DuckDB EXPLAIN plan returned.',
        }}
      />,
    )

    expect(screen.getByText('DuckDB Plan')).toBeInTheDocument()
    expect(screen.getAllByText(/SEQ_SCAN table=orders/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/HASH_JOIN customers/).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText('[object Object]')).not.toBeInTheDocument()
    expect(screen.getByRole('note', { name: 'Execution plan warnings' })).toHaveTextContent('memory-sensitive')
  })

  it('normalizes ClickHouse plan arrays from structured text payloads', () => {
    const model = normalizeGenericPlanPayload({
      plan: [
        'Expression ((Projection + Before ORDER BY))',
        '  ReadFromMergeTree default.orders',
      ],
    })

    expect(model.lines).toEqual([
      'Expression ((Projection + Before ORDER BY))',
      '  ReadFromMergeTree default.orders',
    ])
    expect(model.raw).toBeDefined()
  })

  it('keeps unfamiliar MongoDB explain details behind a disclosure', () => {
    render(
      <ResultPayloadView
        connection={connection('mongodb')}
        payload={{
          renderer: 'plan',
          format: 'json',
          value: { ok: 1, unexpected: { nested: true } },
          summary: 'MongoDB execution plan',
        }}
      />,
    )

    expect(screen.getByText('Explain details')).toBeInTheDocument()
    expect(screen.queryByText('Raw explain payload')).not.toBeInTheDocument()
    expect(screen.getByText('View unparsed details')).toBeInTheDocument()
    expect(screen.queryByText('unexpected')).not.toBeInTheDocument()
  })
})

function findExplain() {
  return {
    queryPlanner: {
      namespace: 'catalog.products',
      parsedQuery: { sku: { $eq: 'luna-lamp' } },
      winningPlan: {
        stage: 'FETCH',
        filter: { 'inventory.available': { $gt: 0 } },
        inputStage: {
          stage: 'IXSCAN',
          indexName: 'sku_1',
          direction: 'forward',
          keyPattern: { sku: 1 },
          indexBounds: { sku: ['["luna-lamp", "luna-lamp"]'] },
          isMultiKey: false,
        },
      },
      rejectedPlans: [
        {
          stage: 'FETCH',
          inputStage: {
            stage: 'IXSCAN',
            indexName: 'inventory_available_1',
            keyPattern: { 'inventory.available': 1 },
          },
        },
      ],
    },
    executionStats: {
      nReturned: 2,
      executionTimeMillis: 4,
      totalKeysExamined: 2,
      totalDocsExamined: 80,
      executionStages: {
        stage: 'FETCH',
        nReturned: 2,
        works: 82,
        advanced: 2,
        docsExamined: 80,
        inputStage: {
          stage: 'IXSCAN',
          nReturned: 2,
          works: 3,
          advanced: 2,
          keysExamined: 2,
          indexName: 'sku_1',
          direction: 'forward',
          keyPattern: { sku: 1 },
          indexBounds: { sku: ['["luna-lamp", "luna-lamp"]'] },
        },
      },
    },
    ok: 1,
  }
}

function connection(engine: ConnectionProfile['engine']): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine,
    engine,
    family: engine === 'mongodb' ? 'document' : 'sql',
    host: 'localhost',
    port: engine === 'mongodb' ? 27017 : 5432,
    database: 'catalog',
    environmentIds: [],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    auth: {},
    createdAt: '2026-05-21T00:00:00.000Z',
    updatedAt: '2026-05-21T00:00:00.000Z',
  }
}
