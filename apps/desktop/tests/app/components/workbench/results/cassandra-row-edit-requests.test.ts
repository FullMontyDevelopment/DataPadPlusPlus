import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  buildCassandraRowCellEditRequest,
  coerceCassandraCellValue,
  inferCassandraPrimaryKey,
  parseCassandraTableTarget,
} from '../../../../../src/app/components/workbench/results/cassandra-row-edit-requests'

describe('cassandra-row-edit-requests', () => {
  it('parses CQL table targets with keyspace and quoted identifiers', () => {
    expect(parseCassandraTableTarget('select * from commerce.orders limit 20;')).toEqual({
      keyspace: 'commerce',
      table: 'orders',
    })
    expect(
      parseCassandraTableTarget('select * from "App Space"."Order Events" where id = 1;'),
    ).toEqual({
      keyspace: 'App Space',
      table: 'Order Events',
    })
    expect(parseCassandraTableTarget('select now()')).toBeUndefined()
  })

  it('infers compound keys from equality conditions in the CQL where clause', () => {
    expect(
      inferCassandraPrimaryKey(
        ['account_id', 'order_id', 'status'],
        ['acct-1', 'order-1', 'open'],
        'orders',
        "select * from commerce.orders where account_id = 'acct-1' and order_id = 'order-1'",
      ),
    ).toEqual({
      account_id: 'acct-1',
      order_id: 'order-1',
    })
  })

  it('coerces simple CQL scalar edits', () => {
    expect(coerceCassandraCellValue('42')).toBe(42)
    expect(coerceCassandraCellValue('false')).toBe(false)
    expect(coerceCassandraCellValue('null')).toBeNull()
    expect(coerceCassandraCellValue('{"region":"emea"}')).toEqual({ region: 'emea' })
  })

  it('builds update-row requests only when a keyed target is available', () => {
    expect(
      buildCassandraRowCellEditRequest({
        connection: cassandraConnection(),
        editContext: {
          connectionId: 'conn-cassandra',
          environmentId: 'env-dev',
          queryText:
            "select account_id, order_id, status from commerce.orders where account_id = 'acct-1' and order_id = 'order-1';",
        },
        columns: ['account_id', 'order_id', 'status'],
        row: ['acct-1', 'order-1', 'open'],
        columnIndex: 2,
        value: 'closed',
      }),
    ).toEqual({
      connectionId: 'conn-cassandra',
      environmentId: 'env-dev',
      editKind: 'update-row',
      target: {
        objectKind: 'row',
        path: [],
        schema: 'commerce',
        table: 'orders',
        primaryKey: {
          account_id: 'acct-1',
          order_id: 'order-1',
        },
      },
      changes: [
        {
          field: 'status',
          value: 'closed',
          valueType: 'string',
        },
      ],
    })
  })

  it('blocks read-only profiles, key columns, and unkeyed broad CQL results', () => {
    const connection = cassandraConnection()
    const editContext = {
      connectionId: 'conn-cassandra',
      environmentId: 'env-dev',
      queryText:
        "select account_id, order_id, status from commerce.orders where account_id = 'acct-1'",
    }

    expect(
      buildCassandraRowCellEditRequest({
        connection: { ...connection, readOnly: true },
        editContext,
        columns: ['account_id', 'order_id', 'status'],
        row: ['acct-1', 'order-1', 'open'],
        columnIndex: 2,
        value: 'closed',
      }),
    ).toBeUndefined()

    expect(
      buildCassandraRowCellEditRequest({
        connection,
        editContext,
        columns: ['account_id', 'order_id', 'status'],
        row: ['acct-1', 'order-1', 'open'],
        columnIndex: 0,
        value: 'acct-2',
      }),
    ).toBeUndefined()

    expect(
      buildCassandraRowCellEditRequest({
        connection,
        editContext: {
          ...editContext,
          queryText: 'select status from commerce.orders',
        },
        columns: ['status'],
        row: ['open'],
        columnIndex: 0,
        value: 'closed',
      }),
    ).toBeUndefined()
  })
})

function cassandraConnection(): ConnectionProfile {
  return {
    id: 'conn-cassandra',
    name: 'Fixture Cassandra',
    engine: 'cassandra',
    family: 'widecolumn',
    host: '127.0.0.1',
    port: 9042,
    database: 'commerce',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'cassandra',
    auth: {
      username: 'cassandra',
      secretRef: {
        id: 'secret-cassandra',
        provider: 'manual',
        service: 'DataPad++',
        account: 'conn-cassandra',
        label: 'Cassandra credential',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
