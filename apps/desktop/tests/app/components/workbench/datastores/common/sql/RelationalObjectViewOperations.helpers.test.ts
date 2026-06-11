import { describe, expect, it } from 'vitest'
import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import {
  relationalOperationActions,
  relationalOperationObjectName,
} from '../../../../../../../src/app/components/workbench/datastores/common/sql/RelationalObjectViewOperations.helpers'

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
      'Update Stats',
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
    expect(actions.find((action) => action.label === 'Update Stats')).toMatchObject({
      operationId: 'sqlserver.statistics.update',
      objectName: '[dbo].[Accounts]',
    })
  })

  it('adds SQL Server index maintenance and Query Store operation previews', () => {
    const indexActions = relationalOperationActions(sqlServerConnection, tableTab, 'index', {
      schema: 'dbo',
      tableName: 'Accounts',
      indexName: 'IX_Accounts_status',
    })

    expect(indexActions.map((action) => action.label)).toEqual([
      'Reorganize',
      'Rebuild',
      'Disable',
      'Enable',
      'Drop Index',
    ])
    expect(indexActions.find((action) => action.label === 'Rebuild')).toMatchObject({
      operationId: 'sqlserver.index.rebuild',
      objectName: '[dbo].[Accounts]',
      parameters: expect.objectContaining({
        indexName: 'IX_Accounts_status',
      }),
    })

    const queryStoreActions = relationalOperationActions(sqlServerConnection, tableTab, 'query-store', {
      database: 'datapadplusplus',
      objectName: 'Query Store',
    })

    expect(queryStoreActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Top Queries',
        operationId: 'sqlserver.query-store.top-queries',
      }),
    ]))
  })

  it('adds CockroachDB cluster, security, and placement operation previews', () => {
    const clusterActions = relationalOperationActions(cockroachConnection, tableTab, 'cluster', {
      database: 'datapadplusplus',
      objectName: 'Cluster',
    })

    expect(clusterActions.map((action) => action.label)).toEqual([
      'Jobs',
      'Ranges',
      'Regions',
      'Backup',
      'Restore',
    ])
    expect(clusterActions.find((action) => action.label === 'Ranges')).toMatchObject({
      operationId: 'cockroachdb.cockroach.ranges',
      objectName: '"Cluster"',
    })

    const securityActions = relationalOperationActions(cockroachConnection, tableTab, 'security', {
      objectName: 'Security',
    })

    expect(securityActions.map((action) => action.label)).toEqual(['Grants'])
    expect(securityActions[0]).toMatchObject({
      operationId: 'cockroachdb.cockroach.roles-grants',
    })

    const zoneActions = relationalOperationActions(cockroachConnection, tableTab, 'zone-configurations', {
      schema: 'public',
      tableName: 'accounts',
    })

    expect(zoneActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Zones',
        operationId: 'cockroachdb.cockroach.zone-configs',
      }),
    ]))

    const tableActions = relationalOperationActions(cockroachConnection, tableTab, 'table', {
      schema: 'public',
      tableName: 'accounts',
    })

    expect(tableActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Import',
        operationId: 'cockroachdb.cockroach.import',
      }),
      expect.objectContaining({
        label: 'Export',
        operationId: 'cockroachdb.cockroach.export',
      }),
    ]))
  })

  it('hides CockroachDB operation previews for disabled profile capabilities', () => {
    const connection: ConnectionProfile = {
      ...cockroachConnection,
      postgresOptions: {
        cockroachCapabilities: {
          inspectJobs: true,
          inspectRanges: false,
          inspectRegions: true,
          inspectClusterStatus: true,
          inspectClusterSettings: true,
          inspectSessions: true,
          inspectContention: false,
          inspectRolesAndGrants: false,
          inspectCertificates: false,
          inspectZoneConfigurations: false,
          explainAnalyze: false,
        },
      },
    }

    expect(
      relationalOperationActions(connection, tableTab, 'cluster', {
        database: 'datapadplusplus',
        objectName: 'Cluster',
      }).map((action) => action.label),
    ).toEqual(['Jobs', 'Regions', 'Backup', 'Restore'])
    expect(
      relationalOperationActions(connection, tableTab, 'security', {
        objectName: 'Security',
      }),
    ).toEqual([])
    expect(
      relationalOperationActions(connection, tableTab, 'zone-configurations', {
        schema: 'public',
        tableName: 'accounts',
      }),
    ).toEqual([
      expect.objectContaining({
        label: 'Regions',
      }),
    ])
  })

  it('uses native identifier quoting for MySQL-compatible object names', () => {
    expect(relationalOperationObjectName(mysqlConnection, tableTab, {
      schema: 'shop',
      tableName: 'orders',
    })).toBe('`shop`.`orders`')
  })

  it('adds MySQL table maintenance and event operation previews', () => {
    const tableActions = relationalOperationActions(mysqlConnection, tableTab, 'table', {
      schema: 'shop',
      tableName: 'orders',
      columns: [{ name: 'order_id', type: 'bigint' }],
    })

    expect(tableActions.map((action) => action.label)).toEqual([
      'Explain',
      'Profile',
      'Check',
      'Analyze',
      'Optimize',
      'Repair',
    ])
    expect(tableActions.find((action) => action.label === 'Check')).toMatchObject({
      operationId: 'mysql.table.check',
      objectName: '`shop`.`orders`',
    })

    const eventActions = relationalOperationActions(mysqlConnection, tableTab, 'event', {
      schema: 'shop',
      name: 'refresh_rollups',
    })

    expect(eventActions.map((action) => action.label)).toEqual(['Enable', 'Disable'])
    expect(eventActions[0]).toMatchObject({
      operationId: 'mysql.event.enable',
      objectName: '`shop`.`refresh_rollups`',
    })

    const routineActions = relationalOperationActions(mysqlConnection, tableTab, 'procedure', {
      schema: 'shop',
      objectName: 'refresh_rollups',
      procedures: [{
        arguments: 'IN account_id bigint, IN force_refresh tinyint(1)',
        name: 'refresh_rollups',
        type: 'procedure',
      }],
    })

    expect(routineActions.map((action) => action.label)).toEqual(['Run'])
    expect(routineActions[0]).toMatchObject({
      operationId: 'mysql.routine.execute',
      objectName: '`shop`.`refresh_rollups`',
      parameters: expect.objectContaining({
        arguments: 'IN account_id bigint, IN force_refresh tinyint(1)',
        routineKind: 'procedure',
        routineName: 'refresh_rollups',
      }),
    })

    const securityActions = relationalOperationActions(mysqlConnection, tableTab, 'users', {
      objectName: 'Users',
      users: [{ name: 'reporting', host: '%' }],
    })

    expect(securityActions.map((action) => action.label)).toEqual([
      'Lock User',
      'Unlock User',
      'Grants',
    ])
    expect(securityActions[0]).toMatchObject({
      operationId: 'mysql.user.lock',
      parameters: expect.objectContaining({ userName: 'reporting', userHost: '%' }),
    })
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

  it('adds SQLite local maintenance and index operations', () => {
    const sqliteTab = {
      ...tableTab,
      connectionId: sqliteConnection.id,
      objectViewState: {
        ...tableTab.objectViewState!,
        connectionId: sqliteConnection.id,
        nodeId: 'database:main',
        kind: 'database',
        label: 'main',
      },
    } as QueryTabState

    const databaseActions = relationalOperationActions(sqliteConnection, sqliteTab, 'maintenance', {
      objectName: 'main',
      pragmas: [{ name: 'quick_check', value: 'ok' }],
    })

    expect(databaseActions.map((action) => action.label)).toEqual([
      'Check',
      'Analyze',
      'Optimize',
      'Vacuum',
      'Backup',
      'Export',
    ])
    expect(databaseActions.find((action) => action.label === 'Vacuum')).toMatchObject({
      operationId: 'sqlite.database.vacuum',
      objectName: '[main]',
    })
    expect(databaseActions.find((action) => action.label === 'Backup')).toMatchObject({
      operationId: 'sqlite.database.backup',
      objectName: '[main]',
    })

    const indexActions = relationalOperationActions(sqliteConnection, sqliteTab, 'index', {
      indexName: 'accounts_name_idx',
    })
    expect(indexActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Reindex',
        operationId: 'sqlite.index.reindex',
        objectName: '[accounts_name_idx]',
      }),
    ]))
  })

  it('adds PostgreSQL vacuum, analyze, reindex, role, and extension previews', () => {
    const postgresTab = {
      ...tableTab,
      connectionId: postgresConnection.id,
      objectViewState: {
        ...tableTab.objectViewState!,
        connectionId: postgresConnection.id,
        nodeId: 'table:public.accounts',
        kind: 'table',
        label: 'accounts',
      },
    } as QueryTabState

    const tableActions = relationalOperationActions(postgresConnection, postgresTab, 'table', {
      schema: 'public',
      tableName: 'accounts',
      columns: [{ name: 'account_id', type: 'bigint' }],
    })

    expect(tableActions.map((action) => action.label)).toEqual([
      'Explain',
      'Profile',
      'Analyze',
      'Vacuum',
      'Create Index',
      'Grants',
    ])
    expect(tableActions.find((action) => action.label === 'Vacuum')).toMatchObject({
      operationId: 'postgresql.table.vacuum',
      objectName: '"public"."accounts"',
    })

    const indexActions = relationalOperationActions(postgresConnection, postgresTab, 'index', {
      schema: 'public',
      indexName: 'accounts_name_idx',
    })

    expect(indexActions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Reindex',
        operationId: 'postgresql.index.reindex',
      }),
    ]))

    const securityActions = relationalOperationActions(postgresConnection, postgresTab, 'security', {
      objectName: 'Security',
      roles: [{ name: 'app' }],
      roleMemberships: [{ role: 'app', memberOf: 'reporting' }],
    })

    expect(securityActions.map((action) => action.label)).toEqual([
      'Grant Role',
      'Revoke Role',
      'Grants',
    ])
    expect(securityActions[0]).toMatchObject({
      operationId: 'postgresql.role.grant',
      parameters: expect.objectContaining({ roleName: 'app', memberOf: 'reporting' }),
    })

    const extensionActions = relationalOperationActions(postgresConnection, postgresTab, 'extension', {
      schema: 'public',
      objectName: 'uuid-ossp',
      extensions: [{ name: 'uuid-ossp', updateAvailable: true }],
    })

    expect(extensionActions.map((action) => action.label)).toEqual(['Update Ext', 'Drop Ext'])
    expect(extensionActions[0]).toMatchObject({
      operationId: 'postgresql.extension.update',
      parameters: expect.objectContaining({ extensionName: 'uuid-ossp' }),
    })

    const routineTab = {
      ...postgresTab,
      objectViewState: {
        ...postgresTab.objectViewState!,
        kind: 'function',
        label: 'lookup_account',
        nodeId: 'function:public:lookup_account',
      },
    } as QueryTabState
    const routineActions = relationalOperationActions(postgresConnection, routineTab, 'function', {
      schema: 'public',
      objectName: 'lookup_account',
      routines: [{
        arguments: 'account_id integer, include_inactive boolean DEFAULT false',
        name: 'lookup_account',
        returns: 'jsonb',
        type: 'function',
      }],
    })

    expect(routineActions.map((action) => action.label)).toEqual(['Run'])
    expect(routineActions[0]).toMatchObject({
      operationId: 'postgresql.routine.execute',
      objectName: '"public"."lookup_account"',
      parameters: expect.objectContaining({
        arguments: 'account_id integer, include_inactive boolean DEFAULT false',
        returns: 'jsonb',
        routineKind: 'function',
        routineName: 'lookup_account',
      }),
    })

    const sessionActions = relationalOperationActions(postgresConnection, postgresTab, 'sessions', {
      schema: 'public',
      objectName: 'Diagnostics',
      sessions: [{
        database: 'datapadplusplus',
        pid: 101,
        state: 'active',
        user: 'app',
        wait: 'CPU',
      }],
    })

    expect(sessionActions.map((action) => action.label)).toEqual(['Cancel', 'Terminate'])
    expect(sessionActions[0]).toMatchObject({
      operationId: 'postgresql.session.cancel',
      parameters: expect.objectContaining({
        sessionDatabase: 'datapadplusplus',
        sessionPid: '101',
        sessionState: 'active',
        sessionUser: 'app',
      }),
    })
    expect(sessionActions[1]).toMatchObject({
      operationId: 'postgresql.session.terminate',
      parameters: expect.objectContaining({ sessionPid: '101' }),
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

const sqliteConnection: ConnectionProfile = {
  ...sqlServerConnection,
  id: 'conn-sqlite',
  name: 'SQLite',
  engine: 'sqlite',
  family: 'sql',
  icon: 'sqlite',
}

const postgresConnection: ConnectionProfile = {
  ...sqlServerConnection,
  id: 'conn-postgres',
  name: 'PostgreSQL',
  engine: 'postgresql',
  family: 'sql',
  icon: 'postgresql',
}

const cockroachConnection: ConnectionProfile = {
  id: 'conn-cockroach',
  name: 'CockroachDB',
  engine: 'cockroachdb',
  family: 'sql',
  host: 'localhost',
  port: 26257,
  database: 'datapadplusplus',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cockroachdb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const timescaleConnection: ConnectionProfile = {
  ...sqlServerConnection,
  id: 'conn-timescale',
  name: 'TimescaleDB',
  engine: 'timescaledb',
  family: 'timeseries',
  icon: 'timescaledb',
}
