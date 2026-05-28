import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { liteDbOperationActions } from './LiteDbObjectViewOperations.helpers'

describe('liteDbOperationActions', () => {
  it('offers collection index, export, backup, and drop previews where supported', () => {
    const actions = liteDbOperationActions(
      liteDbConnection,
      tab('collection', 'products', 'litedb:collection:products'),
      'collection',
      { database: 'catalog.db', collection: 'products' },
    )

    expect(actions.map((action) => action.label)).toEqual([
      'Create Index',
      'Export',
      'Drop',
    ])
    expect(actions[0]).toMatchObject({
      operationId: 'litedb.index.create',
      objectName: 'products',
      parameters: expect.objectContaining({
        databaseFile: 'catalog.db',
        collection: 'products',
      }),
    })
  })

  it('offers local database health, export, and backup previews at file scope', () => {
    const actions = liteDbOperationActions(
      liteDbConnection,
      tab('database', 'catalog.db', 'litedb:database'),
      'database',
      { database: 'catalog.db' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Health', 'Checkpoint', 'Compact', 'Export', 'Backup'])
    expect(actions.find((action) => action.label === 'Compact')).toMatchObject({
      operationId: 'litedb.storage.compact',
      parameters: expect.objectContaining({
        databaseFile: 'catalog.db',
        outputFile: '<selected-folder>/compacted.db',
      }),
    })
  })
})

function tab(kind: string, label: string, nodeId: string): QueryTabState {
  return {
    id: `tab-${kind}`,
    title: label,
    tabKind: 'object-view',
    connectionId: liteDbConnection.id,
    environmentId: 'env-local',
    family: 'document',
    language: 'json',
    queryText: '',
    isDirty: false,
    canSave: false,
    objectViewState: {
      connectionId: liteDbConnection.id,
      environmentId: 'env-local',
      nodeId,
      label,
      kind,
      path: ['catalog.db'],
      warnings: [],
      payload: {},
    },
  } as unknown as QueryTabState
}

const liteDbConnection: ConnectionProfile = {
  id: 'conn-litedb',
  name: 'LiteDB',
  engine: 'litedb',
  family: 'document',
  host: 'C:\\data\\catalog.db',
  port: undefined,
  database: 'C:\\data\\catalog.db',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'litedb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
