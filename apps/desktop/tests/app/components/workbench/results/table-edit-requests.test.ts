import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  buildTableCellEditRequest,
  buildTableRowInsertRequest,
  buildTableRowDeleteRequest,
  coerceSqlCellValue,
  inferPrimaryKeyColumn,
  parseSqlTableTarget,
} from '../../../../../src/app/components/workbench/results/table-edit-requests'

describe('table-edit-requests', () => {
  it('parses conservative SQL table targets across common identifier styles', () => {
    expect(parseSqlTableTarget('select * from public.accounts limit 20')).toEqual({
      schema: 'public',
      table: 'accounts',
    })
    expect(parseSqlTableTarget('select * from [dbo].[orders] where order_id = 101')).toEqual({
      schema: 'dbo',
      table: 'orders',
    })
    expect(parseSqlTableTarget('select * from `commerce`.`inventory_items` as i')).toEqual({
      schema: 'commerce',
      table: 'inventory_items',
    })
    expect(parseSqlTableTarget('select * from "Reporting"."Order Items" oi')).toEqual({
      schema: 'Reporting',
      table: 'Order Items',
    })
  })

  it('does not infer a target from subqueries or queries without from clauses', () => {
    expect(parseSqlTableTarget('select 1')).toBeUndefined()
    expect(parseSqlTableTarget('select * from (select * from accounts) nested')).toBeUndefined()
  })

  it('infers primary keys without inventing ambiguous predicates', () => {
    expect(inferPrimaryKeyColumn(['order_id', 'status'], 'orders')).toBe('order_id')
    expect(inferPrimaryKeyColumn(['id', 'status'], 'accounts')).toBe('id')
    expect(inferPrimaryKeyColumn(['account_id', 'product_id', 'status'], 'orders')).toBeUndefined()
  })

  it('coerces simple scalar cell edits for parameterized SQL requests', () => {
    expect(coerceSqlCellValue('42')).toBe(42)
    expect(coerceSqlCellValue('12.5')).toBe(12.5)
    expect(coerceSqlCellValue('true')).toBe(true)
    expect(coerceSqlCellValue('NULL')).toBeNull()
    expect(coerceSqlCellValue('SKU-001')).toBe('SKU-001')
  })

  it('builds a safe update-row request when a table and primary key are available', () => {
    expect(
      buildTableCellEditRequest({
        connection: sqlConnection(),
        editContext: {
          connectionId: 'conn-sql',
          environmentId: 'env-dev',
          queryText: 'select order_id, status from dbo.orders',
        },
        columns: ['order_id', 'status'],
        row: ['101', 'processing'],
        columnIndex: 1,
        value: 'fulfilled',
      }),
    ).toEqual({
      connectionId: 'conn-sql',
      environmentId: 'env-dev',
      editKind: 'update-row',
      target: {
        objectKind: 'row',
        path: [],
        schema: 'dbo',
        table: 'orders',
        primaryKey: {
          order_id: 101,
        },
      },
      changes: [
        {
          field: 'status',
          value: 'fulfilled',
          valueType: 'string',
        },
      ],
    })
  })

  it('builds a guarded delete-row request with confirmation text', () => {
    expect(
      buildTableRowDeleteRequest({
        connection: sqlConnection(),
        editContext: {
          connectionId: 'conn-sql',
          environmentId: 'env-dev',
          queryText: 'select order_id, status from dbo.orders',
        },
        columns: ['order_id', 'status'],
        row: ['101', 'processing'],
      }),
    ).toEqual({
      connectionId: 'conn-sql',
      environmentId: 'env-dev',
      editKind: 'delete-row',
      confirmationText: 'CONFIRM SQLSERVER DELETE-ROW',
      target: {
        objectKind: 'row',
        path: [],
        schema: 'dbo',
        table: 'orders',
        primaryKey: {
          order_id: 101,
        },
      },
      changes: [],
    })
  })

  it('builds an insert-row request with non-empty values only', () => {
    expect(
      buildTableRowInsertRequest({
        connection: sqlConnection(),
        editContext: {
          connectionId: 'conn-sql',
          environmentId: 'env-dev',
          queryText: 'select order_id, status, note from dbo.orders',
        },
        columns: ['order_id', 'status', 'note'],
        row: ['103', 'queued', ''],
      }),
    ).toEqual({
      connectionId: 'conn-sql',
      environmentId: 'env-dev',
      editKind: 'insert-row',
      target: {
        objectKind: 'row',
        path: [],
        schema: 'dbo',
        table: 'orders',
      },
      changes: [
        {
          field: 'order_id',
          value: 103,
          valueType: 'number',
        },
        {
          field: 'status',
          value: 'queued',
          valueType: 'string',
        },
      ],
    })
  })

  it('blocks edits for read-only profiles, missing keys, and primary key cells', () => {
    const connection = sqlConnection()
    const editContext = {
      connectionId: 'conn-sql',
      environmentId: 'env-dev',
      queryText: 'select order_id, status from dbo.orders',
    }

    expect(
      buildTableCellEditRequest({
        connection: { ...connection, readOnly: true },
        editContext,
        columns: ['order_id', 'status'],
        row: ['101', 'processing'],
        columnIndex: 1,
        value: 'fulfilled',
      }),
    ).toBeUndefined()

    expect(
      buildTableCellEditRequest({
        connection,
        editContext,
        columns: ['order_id', 'status'],
        row: ['101', 'processing'],
        columnIndex: 0,
        value: '102',
      }),
    ).toBeUndefined()

    expect(
      buildTableCellEditRequest({
        connection,
        editContext,
        columns: ['status'],
        row: ['processing'],
        columnIndex: 0,
        value: 'fulfilled',
      }),
    ).toBeUndefined()
  })
})

function sqlConnection(): ConnectionProfile {
  return {
    id: 'conn-sql',
    name: 'Fixture SQL Server',
    engine: 'sqlserver',
    family: 'sql',
    host: '127.0.0.1',
    port: 1433,
    database: 'datapadplusplus',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'sqlserver',
    auth: {
      username: 'sa',
      secretRef: {
        id: 'secret-sql',
        provider: 'manual',
        service: 'DataPad++',
        account: 'conn-sql',
        label: 'SQL credential',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
