import { describe, expect, it } from 'vitest'
import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import {
  searchOperationActions,
  searchOperationObjectName,
} from './SearchObjectViewOperations.helpers'

describe('SearchObjectViewOperations helpers', () => {
  it('derives Elasticsearch index operation previews from native capabilities', () => {
    const actions = searchOperationActions(searchConnection, indexTab, 'index', {
      index: 'products-v1',
      query: { term: { active: true } },
    })

    expect(actions.map((action) => action.label)).toEqual([
      'Explain',
      'Profile',
      'Create Index',
      'Refresh Index',
      'Update Mapping',
      'Update Settings',
      'Delete Index',
      'Add Alias',
      'Lifecycle',
      'Bulk',
    ])
    expect(actions.find((action) => action.label === 'Profile')).toMatchObject({
      operationId: 'elasticsearch.query.profile',
      objectName: 'products-v1',
      parameters: expect.objectContaining({
        query: { term: { active: true } },
        size: 20,
      }),
    })
  })

  it('uses object payload names before tab labels', () => {
    expect(searchOperationObjectName(indexTab, {
      name: 'catalog-search',
    })).toBe('catalog-search')
  })
})

const searchConnection: ConnectionProfile = {
  id: 'conn-search',
  name: 'Elasticsearch',
  engine: 'elasticsearch',
  family: 'search',
  host: 'localhost',
  port: 9200,
  database: 'elasticsearch-local',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'elasticsearch',
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const indexTab = {
  id: 'tab-search-index',
  title: 'products-v1',
  tabKind: 'object-view',
  connectionId: searchConnection.id,
  environmentId: 'env-local',
  family: 'search',
  language: 'json',
  editorLabel: 'Elasticsearch / Local',
  queryText: '',
  result: undefined,
  history: [],
  status: 'idle',
  dirty: false,
  objectViewState: {
    connectionId: searchConnection.id,
    environmentId: 'env-local',
    nodeId: 'index:products-v1',
    kind: 'index',
    label: 'products-v1',
    path: ['Indices', 'products-v1'],
    queryTemplate: '{ "index": "products-v1", "body": { "query": { "match_all": {} }, "size": 20 } }',
    warnings: [],
  },
} as QueryTabState
