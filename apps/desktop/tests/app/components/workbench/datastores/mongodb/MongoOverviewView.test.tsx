import { fireEvent, render, screen } from '@testing-library/react'
import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { getMongoObjectViewDescriptor } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoObjectViewDescriptors'
import { MongoOverviewView } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoOverviewView'

describe('MongoOverviewView', () => {
  it('plans database creation from the database root view', () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoOverviewView
        kind="databases"
        descriptor={getMongoObjectViewDescriptor('databases')}
        payload={{
          databases: [{ name: 'catalog', type: 'User' }],
        }}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.change(screen.getByLabelText('Database'), { target: { value: 'analytics' } })
    fireEvent.change(screen.getByLabelText('First collection'), { target: { value: 'events' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Create Database' }))

    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.database.create',
      objectName: 'analytics',
      parameters: {
        database: 'analytics',
        collection: 'events',
        options: {},
      },
    }))
  })

  it('renders database collections, specialized collection types, and view summaries', () => {
    render(
      <MongoOverviewView
        kind="database"
        descriptor={getMongoObjectViewDescriptor('database')}
        payload={{
          database: 'catalog',
          collections: [{ name: 'products', options: { validationLevel: 'strict' } }],
          timeSeriesCollections: [{ name: 'events', timeField: 'createdAt' }],
          cappedCollections: [{ name: 'audit', capped: true }],
          views: [{ name: 'active_products', pipeline: [{ $match: { active: true } }] }],
          gridfsBuckets: [{ bucket: 'fs' }],
          users: [{ user: 'reporting' }],
          roles: [{ role: 'read' }],
          statistics: { objects: 100000 },
        }}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByText('Database Overview')).toBeInTheDocument()
    expect(screen.getByText('GridFS buckets')).toBeInTheDocument()
    expect(screen.getByText('products')).toBeInTheDocument()
    expect(screen.getByText('Time series')).toBeInTheDocument()
    expect(screen.getByText('Capped')).toBeInTheDocument()
    expect(screen.getByText('active_products')).toBeInTheDocument()
    expect(screen.getByText('$match - Filters documents before later stages run.')).toBeInTheDocument()
  })

  it('plans database management operations from a database overview', () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoOverviewView
        kind="database"
        descriptor={getMongoObjectViewDescriptor('database')}
        payload={{
          database: 'catalog',
          collections: [],
          views: [],
          statistics: {},
        }}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.change(screen.getByLabelText('New collection'), { target: { value: 'events' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run Create Collection' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.create',
      objectName: 'events',
      parameters: expect.objectContaining({
        database: 'catalog',
        collection: 'events',
        options: {},
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Run Drop Database' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.database.drop',
      objectName: 'catalog',
      parameters: { database: 'catalog' },
    }))
  })

  it('plans collection import and export through guarded operation requests', () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoOverviewView
        kind="collection"
        descriptor={getMongoObjectViewDescriptor('collection')}
        payload={{
          database: 'catalog',
          collection: 'products',
          indexes: [{ name: 'sku_1', key: { sku: 1 }, sparse: false }],
          sampleDocuments: [{ _id: 'p1', sku: 'luna-lamp', name: 'Luna Lamp' }],
          validator: { $jsonSchema: { required: ['sku'] } },
          statistics: { count: 100000, storageSize: 2048 },
        }}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getByText('sku ascending')).toBeInTheDocument()
    expect(screen.getByText('p1')).toBeInTheDocument()
    expect(screen.getByText('sku, name')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.export',
      objectName: 'products',
      parameters: expect.objectContaining({
        database: 'catalog',
        collection: 'products',
        format: 'extended-json',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.import',
      objectName: 'products',
      parameters: expect.objectContaining({
        mode: 'insertMany',
        validation: 'validate-before-write',
      }),
    }))
  })

  it('plans collection management operations', () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoOverviewView
        kind="collection"
        descriptor={getMongoObjectViewDescriptor('collection')}
        payload={{
          database: 'catalog',
          collection: 'products',
          indexes: [],
          sampleDocuments: [],
        }}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run Rename' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.rename',
      objectName: 'products',
      parameters: expect.objectContaining({
        database: 'catalog',
        collection: 'products',
        newCollection: 'products_renamed',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Run Drop' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.drop',
      objectName: 'products',
      parameters: expect.objectContaining({
        database: 'catalog',
        collection: 'products',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Run Validate' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.validate',
      objectName: 'products',
      parameters: expect.objectContaining({
        full: false,
      }),
    }))
  })

  it('opens query targets without owning tab state', () => {
    const onOpenQuery = vi.fn()
    const queryTarget: ScopedQueryTarget = {
      kind: 'collection',
      label: 'products',
      path: ['catalog', 'Collections', 'products'],
      queryTemplate: '{ "database": "catalog", "collection": "products", "filter": {} }',
      preferredBuilder: 'mongo-find',
    }

    render(
      <MongoOverviewView
        kind="collection"
        descriptor={getMongoObjectViewDescriptor('collection')}
        payload={{ database: 'catalog', collection: 'products' }}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Documents' }))
    expect(onOpenQuery).toHaveBeenCalledWith(queryTarget)
  })
})
