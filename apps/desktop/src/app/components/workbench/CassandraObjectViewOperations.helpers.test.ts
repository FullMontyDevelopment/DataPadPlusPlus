import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  cassandraOperationActions,
  cassandraOperationTarget,
} from './CassandraObjectViewOperations.helpers'

describe('CassandraObjectViewOperations helpers', () => {
  it('exposes trace, index, permission, metrics, and drop previews for table views', () => {
    const actions = cassandraOperationActions(cassandraConnection, tab('table', 'orders_by_customer'), 'table', {
      keyspace: 'app',
      tableName: 'orders_by_customer',
      columns: [{ name: 'status', role: 'regular' }],
      indexes: [{ name: 'orders_status_sai' }],
    })

    expect(actions.map((action) => action.label)).toEqual([
      'Trace',
      'Create Index',
      'Permissions',
      'Drop Object',
    ])
    expect(actions.find((action) => action.label === 'Create Index')).toMatchObject({
      operationId: 'cassandra.index.create',
      objectName: '"app"."orders_by_customer"',
      parameters: expect.objectContaining({
        keyspace: 'app',
        tableName: 'orders_by_customer',
        indexName: 'orders_status_sai',
        columnName: 'status',
      }),
    })
  })

  it('uses index drop previews for index object views', () => {
    const actions = cassandraOperationActions(cassandraConnection, tab('index', 'orders_status_sai'), 'index', {
      keyspace: 'app',
      indexes: [{ name: 'orders_status_sai' }],
    })

    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Drop Index',
        operationId: 'cassandra.index.drop',
        objectName: 'orders_status_sai',
        parameters: expect.objectContaining({
          indexName: 'orders_status_sai',
        }),
      }),
    ]))
  })

  it('derives keyspace and table from Cassandra node ids', () => {
    expect(cassandraOperationTarget(tab('table', 'orders_by_customer'), {})).toMatchObject({
      keyspace: 'app',
      tableName: 'orders_by_customer',
      objectName: '"app"."orders_by_customer"',
    })
  })
})

function tab(kind: string, label: string): QueryTabState {
  return {
    id: 'tab-1',
    title: label,
    tabKind: 'object-view',
    connectionId: cassandraConnection.id,
    environmentId: 'env-local',
    family: 'widecolumn',
    language: 'cql',
    queryText: '',
    isDirty: false,
    objectViewState: {
      connectionId: cassandraConnection.id,
      environmentId: 'env-local',
      nodeId: `${kind}:app:${label}`,
      label,
      kind,
      path: ['Keyspaces', 'app', 'Tables'],
      warnings: [],
      payload: {},
    },
  } as unknown as QueryTabState
}

const cassandraConnection: ConnectionProfile = {
  id: 'conn-cassandra',
  name: 'Cassandra',
  engine: 'cassandra',
  family: 'widecolumn',
  host: 'localhost',
  port: 9042,
  database: 'app',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cassandra',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'cassandra' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
