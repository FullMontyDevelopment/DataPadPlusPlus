import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { mongoQueryScopeForTab } from './mongo-query-scope'

describe('mongoQueryScopeForTab', () => {
  it('uses builder collection and scoped database for Mongo find tabs', () => {
    expect(
      mongoQueryScopeForTab({
        builderState: {
          kind: 'mongo-find',
          collection: 'products',
          filters: [],
          projectionMode: 'all',
          projectionFields: [],
          sort: [],
        },
        connection: mongoConnection({ database: '' }),
        tab: mongoTab({
          scopedTarget: {
            kind: 'collection',
            label: 'products',
            scope: 'collection:catalog:products',
          },
        }),
      }),
    ).toEqual({ database: 'catalog', collection: 'products' })
  })

  it('reads database and collection from raw Mongo JSON commands', () => {
    expect(
      mongoQueryScopeForTab({
        connection: mongoConnection({ database: 'fallback' }),
        queryText: JSON.stringify({
          database: 'catalog',
          command: { aggregate: 'orders', pipeline: [] },
        }),
        tab: mongoTab(),
      }),
    ).toEqual({ database: 'catalog', collection: 'orders' })
  })

  it('falls back to connection database and mongosh collection when scripting', () => {
    expect(
      mongoQueryScopeForTab({
        connection: mongoConnection({ database: 'catalog' }),
        scriptText: 'db.getCollection("customers").find({ active: true })',
        tab: mongoTab(),
      }),
    ).toEqual({ database: 'catalog', collection: 'customers' })
  })

  it('does not emit scope for non-Mongo tabs', () => {
    expect(
      mongoQueryScopeForTab({
        connection: { ...mongoConnection({ database: 'catalog' }), engine: 'postgresql', family: 'sql' },
        tab: mongoTab(),
      }),
    ).toBeUndefined()
  })
})

function mongoConnection(overrides: Partial<ConnectionProfile>): ConnectionProfile {
  return {
    id: 'conn-mongo',
    name: 'MongoDB',
    engine: 'mongodb',
    family: 'document',
    host: 'localhost',
    port: 27017,
    database: 'catalog',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'mongodb',
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function mongoTab(overrides: Partial<QueryTabState> = {}): QueryTabState {
  return {
    id: 'tab-mongo',
    title: 'products.find.json',
    connectionId: 'conn-mongo',
    environmentId: 'env-local',
    family: 'document',
    language: 'mongodb',
    editorLabel: 'MongoDB',
    queryText: '{}',
    status: 'idle',
    dirty: false,
    history: [],
    ...overrides,
  }
}
