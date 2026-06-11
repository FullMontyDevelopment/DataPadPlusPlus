import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { cosmosOperationActions } from '../../../../../../src/app/components/workbench/datastores/cosmosdb/CosmosObjectViewOperations.helpers'

describe('cosmosOperationActions', () => {
  it('offers container-native profile, indexing, access, export, and drop previews', () => {
    const actions = cosmosOperationActions(
      cosmosConnection,
      tab('container', 'products', 'cosmos:container:catalog:products'),
      'container',
      { accountName: 'catalog-account', database: 'catalog', container: 'products' },
    )

    expect(actions.map((action) => action.label)).toEqual([
      'Metrics',
      'Update RU/s',
      'Profile',
      'Indexing',
      'Access',
      'Export',
      'Drop',
    ])
    expect(actions.find((action) => action.label === 'Profile')).toMatchObject({
      operationId: 'cosmosdb.query.profile',
      objectName: 'catalog/products',
      parameters: expect.objectContaining({
        database: 'catalog',
        container: 'products',
      }),
    })
    expect(actions.find((action) => action.label === 'Update RU/s')).toMatchObject({
      operationId: 'cosmosdb.throughput.update',
      parameters: expect.objectContaining({
        database: 'catalog',
        container: 'products',
      }),
    })
  })

  it('keeps account-level actions away from destructive container work', () => {
    const actions = cosmosOperationActions(
      cosmosConnection,
      tab('account', 'account', 'cosmos:account'),
      'account',
      { accountName: 'catalog-account', database: 'catalog' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Metrics', 'Access', 'Update Consistency', 'Failover', 'Export'])
  })
})

function tab(kind: string, label: string, nodeId: string): QueryTabState {
  return {
    id: `tab-${kind}`,
    title: label,
    tabKind: 'object-view',
    connectionId: cosmosConnection.id,
    environmentId: 'env-local',
    family: 'document',
    language: 'json',
    queryText: '',
    isDirty: false,
    canSave: false,
    objectViewState: {
      connectionId: cosmosConnection.id,
      environmentId: 'env-local',
      nodeId,
      label,
      kind,
      path: ['catalog-account', 'catalog'],
      warnings: [],
      payload: {},
    },
  } as unknown as QueryTabState
}

const cosmosConnection: ConnectionProfile = {
  id: 'conn-cosmos',
  name: 'Cosmos DB',
  engine: 'cosmosdb',
  family: 'document',
  host: 'catalog-account.documents.azure.com',
  port: undefined,
  database: 'catalog',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cosmosdb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
