import { describe, expect, it } from 'vitest'
import {
  MONGO_OBJECT_VIEW_KINDS,
  getMongoObjectViewDescriptor,
  mongoObjectViewMenuLabel,
  mongoScopedQueryMenuLabel,
} from './MongoObjectViewDescriptors'

describe('MongoObjectViewDescriptors', () => {
  it('covers Mongo object-view node kinds with specific labels', () => {
    expect(MONGO_OBJECT_VIEW_KINDS).toEqual(expect.arrayContaining([
      'database',
      'collection',
      'schema-preview',
      'indexes',
      'validation-rules',
      'collection-statistics',
      'database-statistics',
      'gridfs',
      'users',
      'roles',
      'pipeline',
    ]))
    expect(mongoObjectViewMenuLabel('users')).toBe('Manage Users')
    expect(mongoObjectViewMenuLabel('indexes')).toBe('Manage Indexes')
    expect(mongoObjectViewMenuLabel('schema-preview')).toBe('Open Schema Preview')
    expect(mongoObjectViewMenuLabel('gridfs')).toBe('Browse GridFS')
    expect(mongoObjectViewMenuLabel('unknown')).toBe('Inspect Mongo Metadata')
  })

  it('provides purpose and empty-state copy for implemented views', () => {
    const users = getMongoObjectViewDescriptor('users')
    const indexes = getMongoObjectViewDescriptor('indexes')

    expect(users.purpose).toContain('Review database users')
    expect(users.emptyDescription).toContain('usersInfo')
    expect(indexes.purpose).toContain('access paths')
    expect(indexes.emptyTitle).toBe('No index metadata is available')
  })

  it('uses Mongo-specific query labels for queryable tree nodes', () => {
    expect(mongoScopedQueryMenuLabel('collection')).toBe('Open Documents')
    expect(mongoScopedQueryMenuLabel('documents')).toBe('Open Documents')
    expect(mongoScopedQueryMenuLabel('aggregations')).toBe('Open Aggregation Builder')
    expect(mongoScopedQueryMenuLabel('pipeline')).toBe('Open Sample Results')
    expect(mongoScopedQueryMenuLabel('schema-preview')).toBe('Open Query')
  })
})
