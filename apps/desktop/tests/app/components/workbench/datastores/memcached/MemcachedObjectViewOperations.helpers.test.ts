import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { memcachedOperationActions } from '../../../../../../src/app/components/workbench/datastores/memcached/MemcachedObjectViewOperations.helpers'

describe('memcachedOperationActions', () => {
  it('offers stats and metadata dump previews for item classes', () => {
    const actions = memcachedOperationActions(
      memcachedConnection,
      tab('item-class', 'Class 2', 'memcached:item-class:2'),
      'item-class',
      { host: 'localhost', port: 11211 },
    )

    expect(actions.map((action) => action.label)).toEqual(['Stats', 'Dump'])
    expect(actions.find((action) => action.label === 'Dump')).toMatchObject({
      operationId: 'memcached.data.import-export',
      objectName: 'class:2',
      parameters: expect.objectContaining({
        classId: '2',
        command: 'lru_crawler metadump',
      }),
    })
  })

  it('keeps settings work to refreshable native stats without destructive buttons', () => {
    const actions = memcachedOperationActions(
      memcachedConnection,
      tab('settings', 'Settings', 'memcached:settings'),
      'settings',
      { host: 'localhost', port: 11211 },
    )

    expect(actions.map((action) => action.label)).toEqual(['Refresh'])
  })

  it('offers guarded server reset and flush previews only at server-like scopes', () => {
    const actions = memcachedOperationActions(
      memcachedConnection,
      tab('server', 'Server', 'memcached:server'),
      'server',
      { host: 'localhost', port: 11211 },
    )

    expect(actions.map((action) => action.label)).toEqual(['Stats', 'Reset Stats', 'Flush'])
    expect(actions.find((action) => action.label === 'Flush')).toMatchObject({
      operationId: 'memcached.cache.flush',
      objectName: 'server',
      parameters: expect.objectContaining({
        delaySeconds: 0,
      }),
    })
  })

  it('offers known-key actions without pretending keys can be browsed', () => {
    const actions = memcachedOperationActions(
      memcachedConnection,
      tab('known-key', 'Known Key Lookup', 'memcached:known-key'),
      'known-key',
      { host: 'localhost', port: 11211 },
    )

    expect(actions.map((action) => action.label)).toEqual(['Get', 'CAS', 'Set', 'Touch', 'Incr', 'Decr', 'Delete'])
    expect(actions.find((action) => action.label === 'Decr')).toMatchObject({
      operationId: 'memcached.key.decrement',
      objectName: '<key>',
      parameters: expect.objectContaining({
        key: '<key>',
        delta: 1,
      }),
    })
    expect(actions.find((action) => action.label === 'Delete')).toMatchObject({
      operationId: 'memcached.key.delete',
      objectName: '<key>',
      parameters: expect.objectContaining({
        key: '<key>',
      }),
    })
  })
})

function tab(kind: string, label: string, nodeId: string): QueryTabState {
  return {
    id: `tab-${kind}`,
    title: label,
    tabKind: 'object-view',
    connectionId: memcachedConnection.id,
    environmentId: 'env-local',
    family: 'keyvalue',
    language: 'text',
    queryText: '',
    isDirty: false,
    canSave: false,
    objectViewState: {
      connectionId: memcachedConnection.id,
      environmentId: 'env-local',
      nodeId,
      label,
      kind,
      path: ['Memcached'],
      warnings: [],
      payload: {},
    },
  } as unknown as QueryTabState
}

const memcachedConnection: ConnectionProfile = {
  id: 'conn-memcached',
  name: 'Memcached',
  engine: 'memcached',
  family: 'keyvalue',
  host: 'localhost',
  port: 11211,
  database: undefined,
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'memcached',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
