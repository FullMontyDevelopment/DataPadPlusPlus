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

    fireEvent.click(screen.getByRole('button', { name: 'New database' }))
    fireEvent.change(screen.getByLabelText('Database name'), { target: { value: 'analytics' } })
    fireEvent.change(screen.getByLabelText('First collection'), { target: { value: 'events' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review database creation' }))

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

  it('renders a single database overview with collections, specialized types, and views in one inventory', () => {
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

    expect(screen.getByText('MongoDB database')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Collections' })).toBeInTheDocument()
    expect(screen.getByText('GridFS buckets')).toBeInTheDocument()
    expect(screen.getByText('products')).toBeInTheDocument()
    expect(screen.getByText('Time series')).toBeInTheDocument()
    expect(screen.getByText('Capped')).toBeInTheDocument()
    expect(screen.getByText('active_products')).toBeInTheDocument()
    expect(screen.getByText('$match - Filters documents before later stages run.')).toBeInTheDocument()
    expect(screen.queryByText('No MongoDB views were returned for this database.')).not.toBeInTheDocument()
    expect(screen.queryByText('Database Management')).not.toBeInTheDocument()
  })

  it('creates collections from the collection inventory and separates guarded database administration', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'New collection' }))
    expect(screen.getByRole('heading', { name: 'Create a collection' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'events' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review collection creation' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.create',
      objectName: 'events',
      parameters: expect.objectContaining({
        database: 'catalog',
        collection: 'events',
        options: {},
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Review drop database' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.database.drop',
      objectName: 'catalog',
      parameters: { database: 'catalog' },
    }))
  })

  it('plans native time-series, validation, collation, and change-stream collection options', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'New collection' }))
    fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'events' } })
    fireEvent.change(screen.getByLabelText('Collection type'), { target: { value: 'time-series' } })
    fireEvent.change(screen.getByLabelText('Time field'), { target: { value: 'recordedAt' } })
    fireEvent.change(screen.getByLabelText('Metadata field'), { target: { value: 'sensor' } })
    fireEvent.change(screen.getByLabelText('Granularity'), { target: { value: 'minutes' } })
    fireEvent.change(screen.getByLabelText('Expire after (seconds)'), { target: { value: '86400' } })
    fireEvent.change(screen.getByLabelText('Validator JSON'), {
      target: { value: '{ "$jsonSchema": { "required": ["recordedAt"] } }' },
    })
    fireEvent.change(screen.getByLabelText('Validation level'), { target: { value: 'moderate' } })
    fireEvent.change(screen.getByLabelText('Validation action'), { target: { value: 'warn' } })
    fireEvent.change(screen.getByLabelText('Default collation JSON'), {
      target: { value: '{ "locale": "en" }' },
    })
    fireEvent.click(screen.getByLabelText('Store pre-images and post-images for change streams'))
    fireEvent.click(screen.getByRole('button', { name: 'Review collection creation' }))

    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.create',
      objectName: 'events',
      parameters: {
        database: 'catalog',
        collection: 'events',
        options: {
          timeseries: {
            timeField: 'recordedAt',
            metaField: 'sensor',
            granularity: 'minutes',
          },
          expireAfterSeconds: 86400,
          validator: {
            $jsonSchema: {
              required: ['recordedAt'],
            },
          },
          validationLevel: 'moderate',
          validationAction: 'warn',
          collation: { locale: 'en' },
          changeStreamPreAndPostImages: { enabled: true },
        },
      },
    }))
  })

  it('validates capped collection options before planning', () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoOverviewView
        kind="database"
        descriptor={getMongoObjectViewDescriptor('database')}
        payload={{ database: 'catalog', collections: [], views: [] }}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'New collection' }))
    fireEvent.change(screen.getByLabelText('Collection name'), { target: { value: 'audit' } })
    fireEvent.change(screen.getByLabelText('Collection type'), { target: { value: 'capped' } })
    fireEvent.change(screen.getByLabelText('Capped size (bytes)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review collection creation' }))

    expect(screen.getByText('Capped size must be a positive whole number.')).toBeInTheDocument()
    expect(onPlanOperation).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Capped size (bytes)'), { target: { value: '4096' } })
    fireEvent.change(screen.getByLabelText('Maximum documents'), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review collection creation' }))

    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      parameters: expect.objectContaining({
        options: {
          capped: true,
          size: 4096,
          max: 100,
        },
      }),
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

    fireEvent.click(screen.getByRole('button', { name: 'Review export' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.export',
      objectName: 'products',
      parameters: expect.objectContaining({
        database: 'catalog',
        collection: 'products',
        format: 'extended-json',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Review import' }))
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

    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(screen.getByRole('dialog', { name: 'Rename' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review Rename' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.rename',
      objectName: 'products',
      parameters: expect.objectContaining({
        database: 'catalog',
        collection: 'products',
        newCollection: 'products_renamed',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Drop' }))
    expect(screen.getByRole('dialog', { name: 'Drop' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review Drop' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.drop',
      objectName: 'products',
      parameters: expect.objectContaining({
        database: 'catalog',
        collection: 'products',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    expect(screen.getByRole('dialog', { name: 'Validate' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review Validate' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.validate',
      objectName: 'products',
      parameters: expect.objectContaining({
        full: false,
      }),
    }))
  })

  it('opens a specific collection management modal from an admin node id', () => {
    const onPlanOperation = vi.fn()

    render(
      <MongoOverviewView
        kind="collection"
        descriptor={getMongoObjectViewDescriptor('collection')}
        payload={{
          nodeId: 'collection-admin:clone-as-capped:catalog:products',
          database: 'catalog',
          collection: 'products',
          indexes: [],
          sampleDocuments: [],
        }}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Clone As Capped' })).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Target collection'), {
      target: { value: 'products_archive' },
    })
    fireEvent.change(screen.getByLabelText('Size bytes'), {
      target: { value: '2048' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review Clone' }))

    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.clone-as-capped',
      objectName: 'products',
      parameters: expect.objectContaining({
        database: 'catalog',
        collection: 'products',
        targetCollection: 'products_archive',
        size: 2048,
      }),
    }))
  })

  it('leaves the primary query action to the workspace shell', () => {
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

    expect(screen.queryByRole('button', { name: 'Open Documents' })).not.toBeInTheDocument()
    expect(onOpenQuery).not.toHaveBeenCalled()
  })
})
