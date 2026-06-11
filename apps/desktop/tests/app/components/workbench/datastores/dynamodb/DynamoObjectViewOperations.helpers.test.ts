import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import {
  dynamoOperationActions,
  dynamoOperationObjectName,
} from '../../../../../../src/app/components/workbench/datastores/dynamodb/DynamoObjectViewOperations.helpers'

describe('DynamoObjectViewOperations helpers', () => {
  it('exposes native table actions for table object views', () => {
    const actions = dynamoOperationActions(dynamoConnection, tab('table', 'Orders'), 'table', {
      tableName: 'Orders',
      region: 'local',
      keys: [{ attribute: 'pk' }],
      globalSecondaryIndexes: [{ name: 'customer-status-index' }],
    })

    expect(actions.map((action) => action.label)).toEqual([
      'Metrics',
      'Update Capacity',
      'Create GSI',
      'Update TTL',
      'Update Streams',
      'Access',
      'Export',
      'Create Backup',
      'Delete Table',
    ])
    expect(actions.find((action) => action.label === 'Create GSI')).toMatchObject({
      operationId: 'dynamodb.index.create',
      objectName: 'Orders',
      parameters: expect.objectContaining({
        tableName: 'Orders',
        indexName: 'customer-status-index',
        partitionKey: 'pk',
      }),
    })
    expect(actions.find((action) => action.label === 'Update TTL')).toMatchObject({
      operationId: 'dynamodb.ttl.update',
      parameters: expect.objectContaining({
        ttlAttribute: 'expiresAt',
      }),
    })
    expect(actions.find((action) => action.label === 'Update Streams')).toMatchObject({
      operationId: 'dynamodb.streams.update',
      parameters: expect.objectContaining({
        streamViewType: 'NEW_AND_OLD_IMAGES',
      }),
    })
  })

  it('keeps destructive index actions scoped to index sections with a known index', () => {
    const actions = dynamoOperationActions(dynamoConnection, tab('global-secondary-indexes', 'Orders'), 'global-secondary-indexes', {
      tableName: 'Orders',
      globalSecondaryIndexes: [{ name: 'customer-status-index' }],
    })

    expect(actions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        label: 'Delete Index',
        operationId: 'dynamodb.index.drop',
        objectName: 'Orders',
        parameters: expect.objectContaining({
          indexName: 'customer-status-index',
        }),
      }),
    ]))
  })

  it('prefers tableName over tab label for the operation object name', () => {
    expect(dynamoOperationObjectName(tab('table', 'Fallback'), {
      tableName: 'Orders',
    })).toBe('Orders')
  })
})

function tab(kind: string, label: string): QueryTabState {
  return {
    id: 'tab-1',
    title: label,
    tabKind: 'object-view',
    connectionId: dynamoConnection.id,
    environmentId: 'env-local',
    family: 'widecolumn',
    language: 'json',
    queryText: '',
    isDirty: false,
    objectViewState: {
      connectionId: dynamoConnection.id,
      environmentId: 'env-local',
      nodeId: `${kind}:${label}`,
      label,
      kind,
      path: ['Tables'],
      warnings: [],
      payload: {},
    },
  } as unknown as QueryTabState
}

const dynamoConnection: ConnectionProfile = {
  id: 'conn-dynamodb',
  name: 'DynamoDB',
  engine: 'dynamodb',
  family: 'widecolumn',
  host: 'localhost',
  port: 8000,
  database: 'local',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'dynamodb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'local' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
