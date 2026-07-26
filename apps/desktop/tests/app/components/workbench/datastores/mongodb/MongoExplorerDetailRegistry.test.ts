import { describe, expect, it } from 'vitest'
import {
  MONGO_EXPLORER_DETAIL_KINDS,
  mongoExplorerDetailProvider,
} from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoExplorerDetailRegistry'

describe('MongoExplorerDetailRegistry', () => {
  it('registers every declared MongoDB Explorer kind exactly once', () => {
    expect(new Set(MONGO_EXPLORER_DETAIL_KINDS).size).toBe(
      MONGO_EXPLORER_DETAIL_KINDS.length,
    )
    expect(MONGO_EXPLORER_DETAIL_KINDS).toEqual(expect.arrayContaining([
      'databases',
      'system-databases',
      'database',
      'collections',
      'views',
      'time-series-collections',
      'capped-collections',
      'gridfs',
      'search-indexes',
      'vector-indexes',
      'users',
      'roles',
      'database-statistics',
      'collection',
      'view',
      'documents',
      'schema-preview',
      'indexes',
      'index',
      'validation-rules',
      'aggregations',
      'collection-statistics',
      'permissions',
      'scripts',
      'pipeline',
      'sample-results',
      'view-results',
      'gridfs-buckets',
      'gridfs-bucket',
      'gridfs-files',
      'gridfs-chunks',
      'gridfs-collection',
      'user',
      'role',
      'permission',
      'unavailable',
      'database-name-fallback',
    ]))
  })

  it('keeps structural nodes on cached scopes and leaf objects on inspection', () => {
    expect(mongoExplorerDetailProvider('collections').mode).toBe('scope')
    expect(mongoExplorerDetailProvider('indexes').mode).toBe('scope')
    expect(mongoExplorerDetailProvider('users').mode).toBe('scope')
    expect(mongoExplorerDetailProvider('collection').mode).toBe('inspection')
    expect(mongoExplorerDetailProvider('index').mode).toBe('inspection')
    expect(mongoExplorerDetailProvider('user').mode).toBe('inspection')
    expect(mongoExplorerDetailProvider('documents').mode).toBe('launch')
    expect(mongoExplorerDetailProvider('unavailable').mode).toBe('state')
  })

  it('uses a safe purpose-built fallback for unknown kinds', () => {
    const provider = mongoExplorerDetailProvider('future-mongodb-object')
    expect(provider.mode).toBe('state')
    expect(provider.kind).toBe('future-mongodb-object')
  })
})
