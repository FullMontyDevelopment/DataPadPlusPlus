import { describe, expect, it } from 'vitest'
import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import {
  relationalOperationActions,
  relationalOperationObjectName,
} from './RelationalObjectViewOperations.helpers'

describe('RelationalObjectViewOperations helpers', () => {
  it('derives SQL Server table operation previews from engine capabilities and object metadata', () => {
    const actions = relationalOperationActions(sqlServerConnection, tableTab, 'table', {
      schema: 'dbo',
      tableName: 'Accounts',
      columns: [{ name: 'account_id', type: 'int' }],
    })

    expect(actions.map((action) => action.label)).toEqual([
      'Explain',
      'Profile',
      'Create Index',
      'Grants',
      'Export',
    ])
    expect(actions.find((action) => action.label === 'Create Index')).toMatchObject({
      operationId: 'sqlserver.index.create',
      objectName: '[dbo].[Accounts]',
      parameters: expect.objectContaining({
        columnName: 'account_id',
        indexName: 'idx_dbo_accounts_account_id',
      }),
    })
  })

  it('uses native identifier quoting for MySQL-compatible object names', () => {
    expect(relationalOperationObjectName(mysqlConnection, tableTab, {
      schema: 'shop',
      tableName: 'orders',
    })).toBe('`shop`.`orders`')
  })

  it('adds DuckDB local analytics operations with schema-qualified object names', () => {
    const duckDbTab = {
      ...tableTab,
      connectionId: duckDbConnection.id,
      family: 'embedded-olap',
      objectViewState: {
        ...tableTab.objectViewState!,
        connectionId: duckDbConnection.id,
        nodeId: 'table:main:orders',
        kind: 'table',
        label: 'orders',
      },
    } as QueryTabState

    const actions = relationalOperationActions(duckDbConnection, duckDbTab, 'table', {
      schema: 'main',
      name: 'orders',
      columns: [{ name: 'created_at', type: 'TIMESTAMP' }],
    })

    expect(actions.map((action) => action.label)).toEqual([
      'Explain',
      'Profile',
      'Analyze',
      'Create Index',
      'Export',
    ])
    expect(actions.find((action) => action.label === 'Analyze')).toMatchObject({
      operationId: 'duckdb.table.analyze',
      objectName: '"main"."orders"',
    })
  })

  it('adds DuckDB extension install and load operations', () => {
    const actions = relationalOperationActions(duckDbConnection, tableTab, 'extension', {
      name: 'httpfs',
    })

    expect(actions.map((action) => action.label)).toEqual([
      'Install',
      'Load',
    ])
    expect(actions[0]).toMatchObject({
      operationId: 'duckdb.extension.install',
      parameters: expect.objectContaining({ extensionName: 'httpfs' }),
    })
  })

  it('adds TimescaleDB policy actions for hypertables and aggregate refresh actions', () => {
    const hypertableTab = {
      ...tableTab,
      connectionId: timescaleConnection.id,
      family: 'timeseries',
      objectViewState: {
        ...tableTab.objectViewState!,
        connectionId: timescaleConnection.id,
        nodeId: 'hypertable:public:order_metrics',
        kind: 'hypertable',
        label: 'order_metrics',
      },
    } as QueryTabState

    const hypertableActions = relationalOperationActions(timescaleConnection, hypertableTab, 'hypertable', {
      schema: 'public',
      tableName: 'order_metrics',
      columns: [{ name: 'time', type: 'timestamptz' }],
    })

    expect(hypertableActions.map((action) => action.label)).toEqual([
      'Explain',
      'Profile',
      'Compression',
      'Retention',
      'Create Index',
      'Grants',
    ])
    expect(hypertableActions.find((action) => action.label === 'Compression')).toMatchObject({
      operationId: 'timescaledb.timescale.compression-policy',
      objectName: '"public"."order_metrics"',
      parameters: expect.objectContaining({ compressAfter: '7 days' }),
    })

    const aggregateTab = {
      ...hypertableTab,
      objectViewState: {
        ...hypertableTab.objectViewState!,
        nodeId: 'continuous-aggregate:observability:hourly_order_metrics',
        kind: 'continuous-aggregate',
        label: 'hourly_order_metrics',
      },
    } as QueryTabState

    const aggregateActions = relationalOperationActions(timescaleConnection, aggregateTab, 'continuous-aggregate', {
      schema: 'observability',
      viewName: 'hourly_order_metrics',
    })

    expect(aggregateActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Refresh',
        operationId: 'timescaledb.timescale.refresh-continuous-aggregate',
      }),
    ]))
  })
})

const tableTab = {
  id: 'tab-table',
  title: 'Accounts',
  tabKind: 'object-view',
  connectionId: 'conn-sqlserver',
  environmentId: 'env-local',
  family: 'sql',
  language: 'sql',
  editorLabel: 'SQL Server / Local',
  queryText: '',
  result: undefined,
  history: [],
  status: 'idle',
  dirty: false,
  objectViewState: {
    connectionId: 'conn-sqlserver',
    environmentId: 'env-local',
    nodeId: 'sqlserver-table:dbo:Accounts',
    kind: 'table',
    label: 'Accounts',
    path: ['datapadplusplus', 'dbo', 'Tables', 'Accounts'],
    queryTemplate: 'select * from [dbo].[Accounts]',
    warnings: [],
  },
} as QueryTabState

const sqlServerConnection: ConnectionProfile = {
  id: 'conn-sqlserver',
  name: 'SQL Server',
  engine: 'sqlserver',
  family: 'sql',
  host: 'localhost',
  environmentIds: [],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'sqlserver',
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const mysqlConnection: ConnectionProfile = {
  ...sqlServerConnection,
  id: 'conn-mysql',
  name: 'MySQL',
  engine: 'mysql',
  icon: 'mysql',
}

const duckDbConnection: ConnectionProfile = {
  ...sqlServerConnection,
  id: 'conn-duckdb',
  name: 'DuckDB',
  engine: 'duckdb',
  family: 'embedded-olap',
  icon: 'duckdb',
}

const timescaleConnection: ConnectionProfile = {
  ...sqlServerConnection,
  id: 'conn-timescale',
  name: 'TimescaleDB',
  engine: 'timescaledb',
  family: 'timeseries',
  icon: 'timescaledb',
}
