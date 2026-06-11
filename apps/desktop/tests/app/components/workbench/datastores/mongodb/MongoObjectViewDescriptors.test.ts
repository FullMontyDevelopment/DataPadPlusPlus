import { describe, expect, it } from 'vitest'
import {
  MONGO_OBJECT_VIEW_KINDS,
  MONGO_QUERYABLE_OBJECT_KINDS,
  getMongoObjectViewDescriptor,
  isMongoObjectViewKind,
  isMongoQueryableObjectKind,
  mongoObjectViewMenuLabel,
  mongoScopedQueryMenuLabel,
} from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoObjectViewDescriptors'

describe('MongoObjectViewDescriptors', () => {
  it('covers Mongo object-view node kinds with specific labels', () => {
    expect(MONGO_OBJECT_VIEW_KINDS).toEqual(expect.arrayContaining([
      'database',
      'collection',
      'insert-document',
      'create-index',
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
    expect(mongoObjectViewMenuLabel('insert-document')).toBe('Add Document')
    expect(mongoObjectViewMenuLabel('create-index')).toBe('Create Index')
    expect(mongoObjectViewMenuLabel('schema-preview')).toBe('Open Schema Preview')
    expect(mongoObjectViewMenuLabel('gridfs')).toBe('Browse GridFS')
    expect(mongoObjectViewMenuLabel('unknown')).toBe('Inspect Mongo Metadata')
    expect(isMongoObjectViewKind('validation-rules')).toBe(true)
    expect(isMongoObjectViewKind('documents')).toBe(false)
  })

  it('provides purpose and empty-state copy for implemented views', () => {
    const users = getMongoObjectViewDescriptor('users')
    const indexes = getMongoObjectViewDescriptor('indexes')

    expect(users.purpose).toContain('Review database users')
    expect(users.emptyDescription).toContain('usersInfo')
    expect(users.primaryActions).toEqual(expect.arrayContaining(['Create user']))
    expect(indexes.purpose).toContain('access paths')
    expect(indexes.emptyTitle).toBe('No index metadata is available')
    expect(indexes.primaryActions).toEqual(expect.arrayContaining(['Create index']))
  })

  it('uses Mongo-specific query labels for queryable tree nodes', () => {
    expect(mongoScopedQueryMenuLabel('collection')).toBe('Open Documents')
    expect(mongoScopedQueryMenuLabel('documents')).toBe('Open Documents')
    expect(mongoScopedQueryMenuLabel('aggregations')).toBe('Open Aggregation Builder')
    expect(mongoScopedQueryMenuLabel('pipeline')).toBe('Open Results Preview')
    expect(mongoScopedQueryMenuLabel('gridfs-files')).toBe('Query GridFS Collection')
    expect(mongoScopedQueryMenuLabel('schema-preview')).toBe('Open Query')
    expect(MONGO_QUERYABLE_OBJECT_KINDS).toEqual(expect.arrayContaining([
      'collection',
      'documents',
      'aggregations',
      'view-results',
      'gridfs-files',
      'gridfs-chunks',
    ]))
    expect(isMongoQueryableObjectKind('sample-results')).toBe(true)
    expect(isMongoQueryableObjectKind('gridfs-chunks')).toBe(true)
    expect(isMongoQueryableObjectKind('indexes')).toBe(false)
  })
})
