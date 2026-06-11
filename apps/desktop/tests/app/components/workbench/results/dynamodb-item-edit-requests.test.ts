import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  buildDynamoDbItemCellEditRequest,
  buildDynamoDbItemDeleteRequest,
  buildDynamoDbItemPutRequest,
  coerceDynamoDbCellValue,
  inferDynamoDbItemKey,
  parseDynamoDbTableName,
} from '../../../../../src/app/components/workbench/results/dynamodb-item-edit-requests'

describe('dynamodb-item-edit-requests', () => {
  it('parses table names from native request JSON', () => {
    expect(parseDynamoDbTableName('{ "operation": "Query", "TableName": "Orders" }')).toBe(
      'Orders',
    )
    expect(parseDynamoDbTableName('{ "operation": "Scan", "tableName": "Inventory" }')).toBe(
      'Inventory',
    )
  })

  it('infers common partition and sort key column names conservatively', () => {
    expect(
      inferDynamoDbItemKey(
        ['partition_key', 'sort_key', 'status'],
        ['CUSTOMER#123', 'ORDER#1001', 'open'],
      ),
    ).toEqual({
      partition_key: 'CUSTOMER#123',
      sort_key: 'ORDER#1001',
    })
    expect(inferDynamoDbItemKey(['status'], ['open'])).toBeUndefined()
  })

  it('coerces scalar and JSON-looking DynamoDB cell edits', () => {
    expect(coerceDynamoDbCellValue('42')).toBe(42)
    expect(coerceDynamoDbCellValue('true')).toBe(true)
    expect(coerceDynamoDbCellValue('null')).toBeNull()
    expect(coerceDynamoDbCellValue('["a","b"]')).toEqual(['a', 'b'])
  })

  it('builds update-item requests for non-key cells', () => {
    expect(
      buildDynamoDbItemCellEditRequest({
        connection: dynamoConnection(),
        editContext: {
          connectionId: 'conn-dynamodb',
          environmentId: 'env-dev',
          queryText: '{ "operation": "Query", "TableName": "Orders" }',
        },
        columns: ['pk', 'sk', 'status'],
        row: ['CUSTOMER#123', 'ORDER#1001', 'open'],
        columnIndex: 2,
        value: 'closed',
      }),
    ).toEqual({
      connectionId: 'conn-dynamodb',
      environmentId: 'env-dev',
      editKind: 'update-item',
      target: {
        objectKind: 'item',
        path: [],
        table: 'Orders',
        itemKey: {
          pk: 'CUSTOMER#123',
          sk: 'ORDER#1001',
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

  it('blocks key-cell updates and builds guarded item deletes', () => {
    const input = {
      connection: dynamoConnection(),
      editContext: {
        connectionId: 'conn-dynamodb',
        environmentId: 'env-dev',
        queryText: '{ "operation": "Query", "TableName": "Orders" }',
      },
      columns: ['pk', 'sk', 'status'],
      row: ['CUSTOMER#123', 'ORDER#1001', 'open'],
    }

    expect(
      buildDynamoDbItemCellEditRequest({
        ...input,
        columnIndex: 0,
        value: 'CUSTOMER#124',
      }),
    ).toBeUndefined()
    expect(buildDynamoDbItemDeleteRequest(input)).toEqual({
      connectionId: 'conn-dynamodb',
      environmentId: 'env-dev',
      editKind: 'delete-item',
      confirmationText: 'CONFIRM DYNAMODB DELETE-ITEM',
      target: {
        objectKind: 'item',
        path: [],
        table: 'Orders',
        itemKey: {
          pk: 'CUSTOMER#123',
          sk: 'ORDER#1001',
        },
      },
      changes: [],
    })
  })

  it('builds put-item requests from new rows when a complete item key is present', () => {
    expect(
      buildDynamoDbItemPutRequest({
        connection: dynamoConnection(),
        editContext: {
          connectionId: 'conn-dynamodb',
          environmentId: 'env-dev',
          queryText: '{ "operation": "Query", "TableName": "Orders" }',
        },
        columns: ['pk', 'sk', 'status', 'total'],
        row: ['CUSTOMER#123', 'ORDER#1003', 'open', '42'],
      }),
    ).toEqual({
      connectionId: 'conn-dynamodb',
      environmentId: 'env-dev',
      editKind: 'put-item',
      target: {
        objectKind: 'item',
        path: [],
        table: 'Orders',
        itemKey: {
          pk: 'CUSTOMER#123',
          sk: 'ORDER#1003',
        },
      },
      changes: [
        {
          field: 'pk',
          value: 'CUSTOMER#123',
          valueType: 'string',
        },
        {
          field: 'sk',
          value: 'ORDER#1003',
          valueType: 'string',
        },
        {
          field: 'status',
          value: 'open',
          valueType: 'string',
        },
        {
          field: 'total',
          value: 42,
          valueType: 'number',
        },
      ],
    })
  })
})

function dynamoConnection(): ConnectionProfile {
  return {
    id: 'conn-dynamodb',
    name: 'Fixture DynamoDB',
    engine: 'dynamodb',
    family: 'widecolumn',
    host: '127.0.0.1',
    port: 8001,
    database: 'local',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'dynamodb',
    auth: {
      username: 'local',
      secretRef: {
        id: 'secret-dynamodb',
        provider: 'manual',
        service: 'DataPad++',
        account: 'conn-dynamodb',
        label: 'DynamoDB credential',
      },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
