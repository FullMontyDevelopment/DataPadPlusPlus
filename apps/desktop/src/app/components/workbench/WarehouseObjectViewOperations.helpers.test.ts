import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  warehouseOperationActions,
  warehouseOperationObjectName,
} from './WarehouseObjectViewOperations.helpers'

describe('warehouseOperationActions', () => {
  it('offers Snowflake explain, cost, access, export, and guarded drop previews for tables', () => {
    const tab = objectViewTab('table', 'orders', {
      queryTemplate: 'select * from "ANALYTICS"."orders" limit 100;',
    })

    const actions = warehouseOperationActions(
      connection('snowflake'),
      tab,
      'table',
      { database: 'ANALYTICS', schema: 'PUBLIC', name: 'orders' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Explain', 'Cost', 'Access', 'Export', 'Clone', 'Drop Table'])
    expect(actions[1]).toMatchObject({
      operationId: 'snowflake.query.profile',
      objectName: 'orders',
      parameters: expect.objectContaining({
        database: 'ANALYTICS',
        schema: 'PUBLIC',
        query: 'select * from "ANALYTICS"."orders" limit 100;',
      }),
    })
    expect(actions.find((action) => action.label === 'Clone')).toMatchObject({
      operationId: 'snowflake.table.clone',
      parameters: expect.objectContaining({
        cloneName: 'orders_clone',
      }),
    })
  })

  it('offers BigQuery dataset metrics, access, and export previews', () => {
    const actions = warehouseOperationActions(
      connection('bigquery', 'analytics'),
      objectViewTab('dataset', 'analytics'),
      'dataset',
      { dataset: 'analytics', name: 'analytics' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Metrics', 'Access', 'Export'])
    expect(actions.find((action) => action.operationId === 'bigquery.data.import-export')).toMatchObject({
      parameters: expect.objectContaining({
        format: 'avro',
      }),
    })
  })

  it('offers ClickHouse profile labels and stage loading previews', () => {
    const stageActions = warehouseOperationActions(
      connection('clickhouse', 'default'),
      objectViewTab('stage', 's3_import'),
      'stage',
      { name: 's3_import' },
    )

    expect(stageActions.map((action) => action.label)).toEqual(['Load', 'Drop Stage'])
    expect(stageActions[0]).toMatchObject({
      operationId: 'clickhouse.data.import-export',
      parameters: expect.objectContaining({
        mode: 'import',
        format: 'parquet',
      }),
    })

    expect(warehouseOperationObjectName(connection('clickhouse'), objectViewTab('job', 'ch-job-1001'), { id: 'ch-job-1001' })).toBe('ch-job-1001')
  })

  it('adds table maintenance actions for BigQuery and ClickHouse', () => {
    const bigQueryActions = warehouseOperationActions(
      connection('bigquery', 'analytics'),
      objectViewTab('table', 'orders'),
      'table',
      { dataset: 'analytics', name: 'orders' },
    )
    expect(bigQueryActions.map((action) => action.label)).toContain('Copy')
    expect(bigQueryActions.find((action) => action.label === 'Copy')).toMatchObject({
      operationId: 'bigquery.table.copy',
      parameters: expect.objectContaining({
        destinationTable: 'orders_copy',
      }),
    })

    const clickHouseActions = warehouseOperationActions(
      connection('clickhouse', 'default'),
      objectViewTab('table', 'events'),
      'table',
      { database: 'default', name: 'events' },
    )
    expect(clickHouseActions.map((action) => action.label)).toContain('Optimize')
    expect(clickHouseActions.map((action) => action.label)).toContain('TTL')
    expect(clickHouseActions.map((action) => action.label)).toContain('Freeze')
    expect(clickHouseActions.find((action) => action.label === 'Optimize')).toMatchObject({
      operationId: 'clickhouse.table.optimize',
    })
    expect(clickHouseActions.find((action) => action.label === 'TTL')).toMatchObject({
      operationId: 'clickhouse.table.materialize-ttl',
    })
    expect(clickHouseActions.find((action) => action.label === 'Freeze')).toMatchObject({
      operationId: 'clickhouse.table.freeze',
      parameters: expect.objectContaining({
        snapshotName: 'events_snapshot',
      }),
    })
  })

  it('adds Snowflake warehouse suspend and resume actions', () => {
    const actions = warehouseOperationActions(
      connection('snowflake'),
      objectViewTab('warehouse', 'COMPUTE_WH'),
      'warehouse',
      { name: 'COMPUTE_WH' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Metrics', 'Suspend', 'Resume', 'Drop Warehouse'])
  })
})

function connection(engine: 'snowflake' | 'bigquery' | 'clickhouse', database = 'ANALYTICS'): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine,
    engine,
    family: 'warehouse',
    host: 'localhost',
    port: undefined,
    database,
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function objectViewTab(kind: string, label: string, overrides: Record<string, unknown> = {}): QueryTabState {
  return {
    id: `tab-${kind}`,
    tabKind: 'object-view',
    connectionId: 'conn',
    environmentId: 'env-local',
    title: label,
    family: 'warehouse',
    language: 'sql',
    queryText: '',
    isDirty: false,
    canSave: false,
    objectViewState: {
      connectionId: 'conn',
      environmentId: 'env-local',
      nodeId: `${kind}:${label}`,
      label,
      kind,
      path: ['Warehouse'],
      warnings: [],
      payload: {},
      ...overrides,
    },
  } as unknown as QueryTabState
}
