import { fireEvent, render, screen, within } from '@testing-library/react'
import type {
  ConnectionProfile,
  DataEditExecutionResponse,
  EnvironmentProfile,
  OperationPlanResponse,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { ObjectViewWorkspace } from './ObjectViewWorkspace'

describe('ObjectViewWorkspace', () => {
  it('renders a Mongo database overview as a workflow launchpad', () => {
    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'catalog',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'database:catalog',
            label: 'catalog',
            kind: 'database',
            path: ['catalog'],
            warnings: [],
            payload: {
              database: 'catalog',
              collections: [{ name: 'products', documentCount: 100000 }],
              views: [{ name: 'active_products', pipeline: [{ $match: { active: true } }] }],
              gridfsBuckets: [{ name: 'fs', filesCollection: 'fs.files', chunksCollection: 'fs.chunks' }],
              users: [{ user: 'fixture_reader' }],
              roles: [{ role: 'readWrite' }],
              statistics: { objects: 100000 },
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Database Overview').length).toBeGreaterThan(0)
    expect(screen.getByText('Collections')).toBeInTheDocument()
    expect(screen.getByText('GridFS buckets')).toBeInTheDocument()
    expect(screen.getByText('products')).toBeInTheDocument()
    expect(screen.getByText('active_products')).toBeInTheDocument()
    expect(screen.getByText('$match - Filters documents before later stages run.')).toBeInTheDocument()
    expect(screen.queryByText('[{"$match":{"active":true}}]')).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('renders a Mongo collection overview with documents, indexes, validator state, and import/export actions', () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.collection.export'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'products',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'collection:catalog:products',
            label: 'products',
            kind: 'collection',
            path: ['catalog', 'Collections'],
            queryTemplate: '{ "database": "catalog", "collection": "products", "filter": {}, "limit": 20 }',
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              indexes: [{ name: 'sku_1', key: { sku: 1 } }],
              validator: { $jsonSchema: { required: ['sku'] } },
              statistics: { count: 100000, storageSize: 2048 },
              sampleDocuments: [{ _id: 'p1', sku: 'luna-lamp', inventory: { available: 18 } }],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getAllByText('Collection Overview').length).toBeGreaterThan(0)
    expect(screen.getByText('Sample size')).toBeInTheDocument()
    expect(screen.getByText('Validator')).toBeInTheDocument()
    expect(screen.getByText('sku_1')).toBeInTheDocument()
    expect(screen.getByText('p1')).toBeInTheDocument()
    expect(screen.getByText('sku, inventory')).toBeInTheDocument()
    expect(screen.queryByText(/"luna-lamp"/)).not.toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.export',
      objectName: 'products',
      parameters: expect.objectContaining({
        database: 'catalog',
        collection: 'products',
        format: 'extended-json',
        batchSize: 1000,
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.collection.import',
      objectName: 'products',
      parameters: expect.objectContaining({
        database: 'catalog',
        collection: 'products',
        mode: 'insertMany',
        validation: 'validate-before-write',
      }),
    }))
  })

  it('renders a Mongo schema preview as a purpose-built field table', () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.validation.update'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Schema Preview',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'schema-preview:catalog:products',
            label: 'Schema Preview',
            kind: 'schema-preview',
            path: ['catalog', 'Collections', 'products'],
            summary: 'Schema preview ready.',
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              sampleSize: 20,
              fields: [
                { path: '_id', type: 'objectId', typeDistribution: { objectId: 20 }, count: 20, examples: ['64f1e7'] },
                { path: 'sku', type: 'string', typeDistribution: { string: 20 }, count: 20, examples: ['luna-lamp'] },
                { path: 'inventory.available', type: 'int32', typeDistribution: { int32: 18, int64: 2 }, count: 20, examples: [18, 83] },
                { path: 'inventory.reserved', type: 'int32', typeDistribution: { int32: 18 }, count: 18, examples: [4, 1] },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getAllByText('Schema Preview').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Understand document shape/i).length).toBeGreaterThan(0)
    expect(screen.getByText('inventory.available')).toBeInTheDocument()
    expect(screen.getByText('int32 (18), int64 (2)')).toBeInTheDocument()
    expect(screen.getAllByText('20/20 (100%)').length).toBeGreaterThan(0)
    expect(screen.getByText('18/20 (90%)')).toBeInTheDocument()
    expect(screen.getByText('Mixed BSON types')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Prepare Validator' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.validation.update',
      parameters: expect.objectContaining({
        collection: 'products',
        validator: expect.objectContaining({
          $jsonSchema: expect.objectContaining({
            required: expect.arrayContaining(['sku']),
          }),
        }),
      }),
    }))
  })

  it('renders Mongo index metadata and exposes guarded operation guidance', async () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.index.drop'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Indexes',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'indexes:catalog:products',
            label: 'Indexes',
            kind: 'indexes',
            path: ['catalog', 'Collections', 'products'],
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              indexes: [
                { name: '_id_', key: { _id: 1 }, unique: true },
                { name: 'sku_1', key: { sku: 1 }, sparse: false },
                { name: 'legacy_1', key: { legacy: 1 }, hidden: true, expireAfterSeconds: 3600, accesses: { ops: 12 } },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getAllByText('Index Manager').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Create Index' }).length).toBeGreaterThan(0)
    expect(screen.getByText('_id_')).toBeInTheDocument()
    expect(screen.getByText('sku_1')).toBeInTheDocument()
    expect(screen.getByText('legacy_1')).toBeInTheDocument()
    expect(screen.getByText('sku ascending')).toBeInTheDocument()
    expect(screen.queryByText('{"sku":1}')).not.toBeInTheDocument()
    expect(screen.getByText('12 op(s)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide index sku_1' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.index.hide',
      parameters: expect.objectContaining({
        indexName: 'sku_1',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Unhide index legacy_1' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.index.unhide',
      parameters: expect.objectContaining({
        indexName: 'legacy_1',
      }),
    }))

    const dropButtons = screen.getAllByRole('button', { name: /^Drop index / })
    expect(dropButtons).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Drop index sku_1' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.index.drop',
      parameters: expect.objectContaining({
        indexName: 'sku_1',
      }),
    }))
  })

  it('renders a dedicated Mongo create-index workspace', async () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.index.create'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'products - Create Index',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'create-index:catalog:products',
            label: 'Create Index',
            kind: 'create-index',
            path: ['catalog', 'Collections', 'products'],
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getAllByText('Create Index').length).toBeGreaterThan(0)
    expect(screen.queryByText(/ready to review/i)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'sku' } })
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: '-1' } })
    fireEvent.click(screen.getByLabelText('Unique'))
    fireEvent.change(screen.getByLabelText('TTL seconds'), { target: { value: '3600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.index.create',
      objectName: 'products',
      parameters: expect.objectContaining({
        collection: 'products',
        indexName: 'field_1',
        key: { sku: -1 },
        options: expect.objectContaining({
          expireAfterSeconds: 3600,
          name: 'field_1',
          unique: true,
        }),
      }),
    }))
    expect(await screen.findByText('Ready to review.')).toBeInTheDocument()
  })

  it('builds compound Mongo indexes from multiple field rows', () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.index.create'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'products - Create Index',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'create-index:catalog:products',
            label: 'Create Index',
            kind: 'create-index',
            path: ['catalog', 'Collections', 'products'],
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'sku_category' } })
    fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'sku' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Field' }))
    fireEvent.change(screen.getByLabelText('Field 2'), { target: { value: 'category' } })
    fireEvent.change(screen.getByLabelText('Order 2'), { target: { value: '-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))

    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.index.create',
      parameters: expect.objectContaining({
        indexName: 'sku_category',
        key: {
          sku: 1,
          category: -1,
        },
      }),
    }))
  })

  it('renders a dedicated Mongo add-document workspace', () => {
    const onExecuteDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: mongoConnection.id,
      environmentId: environment.id,
      editKind: 'insert-document',
      executionSupport: 'live',
      executed: true,
      plan: operationPlanResponse('mongodb.data-edit.insert-document').plan,
      messages: ['Inserted.'],
      warnings: [],
    }))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'products - Add Document',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'insert-document:catalog:products',
            label: 'Add Document',
            kind: 'insert-document',
            path: ['catalog', 'Collections', 'products'],
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              validator: { $jsonSchema: { required: ['sku'] } },
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onExecuteDataEdit={onExecuteDataEdit}
      />,
    )

    expect(screen.getAllByText('Add Document').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Upload document JSON' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Insert Document' })).toBeInTheDocument()
    expect(screen.getByText('sku')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    expect(screen.getByText('Document is valid for products.')).toBeInTheDocument()
  })

  it('loads dropped Mongo document JSON into the add-document workspace', async () => {
    const file = new File(['{ "sku": "drop-1", "name": "Dropped" }'], 'product.json', {
      type: 'application/json',
    })
    Object.defineProperty(file, 'text', {
      value: vi.fn(async () => '{ "sku": "drop-1", "name": "Dropped" }'),
    })

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'products - Add Document',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'insert-document:catalog:products',
            label: 'Add Document',
            kind: 'insert-document',
            path: ['catalog', 'Collections', 'products'],
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              validator: { $jsonSchema: { required: ['sku', 'name'] } },
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    fireEvent.drop(screen.getByRole('button', { name: 'Upload document JSON' }), {
      dataTransfer: {
        files: [file],
      },
    })

    expect(await screen.findByText('Loaded product.json.')).toBeInTheDocument()
    expect(screen.getByLabelText('Document')).toHaveValue(
      JSON.stringify({ sku: 'drop-1', name: 'Dropped' }, null, 2),
    )
  })

  it('tests Mongo validation rules against a draft document before previewing updates', () => {
    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Validation Rules',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'validation-rules:catalog:products',
            label: 'Validation Rules',
            kind: 'validation-rules',
            path: ['catalog', 'Collections', 'products'],
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              validator: { $jsonSchema: { required: ['sku', 'name'] } },
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByText('Required fields')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Test document'), { target: { value: '{ "sku": "only-sku" }' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test Document' }))
    expect(screen.getByText('Missing required field(s): name')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Test document'), { target: { value: '{ "sku": "nova", "name": "Nova Chair" }' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test Document' }))
    expect(screen.getByText(/Document matches the validator fields/i)).toBeInTheDocument()
  })

  it('reviews Mongo validation required-field changes without exposing JSON first', () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.validation.update'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Validation Rules',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'validation-rules:catalog:products',
            label: 'Validation Rules',
            kind: 'validation-rules',
            path: ['catalog', 'Collections', 'products'],
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              validator: { $jsonSchema: { required: ['sku'], properties: { sku: { bsonType: 'string' } } } },
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getByLabelText('Validator rule')).not.toBeVisible()
    fireEvent.change(screen.getByLabelText('Field'), { target: { value: 'name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add Field' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review Required Fields' }))

    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.validation.update',
      objectName: 'products',
      parameters: expect.objectContaining({
        validator: expect.objectContaining({
          $jsonSchema: expect.objectContaining({
            required: ['sku', 'name'],
            properties: expect.objectContaining({
              sku: expect.objectContaining({ bsonType: 'string' }),
            }),
          }),
        }),
      }),
    }))
  })

  it('refreshes Mongo validation fields when the object-view payload changes', () => {
    const validationTab = (required: string[]): QueryTabState => ({
      ...baseObjectViewTab,
      title: 'Validation Rules',
      objectViewState: {
        connectionId: mongoConnection.id,
        environmentId: environment.id,
        nodeId: 'validation-rules:catalog:products',
        label: 'Validation Rules',
        kind: 'validation-rules',
        path: ['catalog', 'Collections', 'products'],
        warnings: [],
        payload: {
          database: 'catalog',
          collection: 'products',
          validator: { $jsonSchema: { required } },
        },
      },
    })

    const { rerender } = render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={validationTab(['sku'])}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Remove required field sku' })).toBeInTheDocument()

    rerender(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={validationTab(['name'])}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Remove required field sku' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove required field name' })).toBeInTheDocument()
  })

  it('opens query templates from object views without making the object view saveable', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'view-pipeline:catalog:active_products',
            label: 'Pipeline',
            kind: 'pipeline',
            path: ['catalog', 'Views', 'active_products'],
            queryTemplate: '{ "database": "catalog", "collection": "active_products", "filter": {} }',
            warnings: [],
            payload: {
              database: 'catalog',
              view: 'active_products',
              pipeline: [{ $match: { active: true } }],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getByRole('group', { name: 'MongoDB view pipeline stages' })).toBeInTheDocument()
    expect(screen.getByText('$match')).toBeInTheDocument()
    expect(screen.getByText('Filters documents before later stages run.')).toBeInTheDocument()
    expect(screen.getByText('active')).toBeInTheDocument()
    expect(screen.queryByText(/^\[\s*\{\s*"\$match"/)).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Results Preview' })[0] as HTMLElement)

    expect(onOpenQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'pipeline',
        label: 'Pipeline',
        preferredBuilder: 'mongo-aggregation',
      }),
    )
  })

  it('renders Mongo script templates as launch cards and hides script text until requested', () => {
    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Scripts',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'scripts:catalog:products',
            label: 'Scripts',
            kind: 'scripts',
            path: ['catalog', 'Collections', 'products'],
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              scripts: [
                {
                  name: 'Find recent products',
                  description: 'Open a read-only script template for product review.',
                  tags: ['find', 'read-only'],
                  script: 'db.products.find({ updatedAt: { $gte: ISODate("2026-01-01") } }).limit(20)',
                },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Scripts').length).toBeGreaterThan(0)
    expect(screen.getByRole('list', { name: 'MongoDB script templates' })).toBeInTheDocument()
    expect(screen.getByText('Find recent products')).toBeInTheDocument()
    expect(screen.getByText('Open a read-only script template for product review.')).toBeInTheDocument()
    expect(screen.getByText('read-only')).toBeInTheDocument()
    expect(screen.queryByText(/db\.products\.find/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show script' }))
    expect(screen.getByText(/db\.products\.find/)).toBeInTheDocument()
  })

  it('shows permission warnings for users and roles without failing the whole view', () => {
    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Users',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'users:catalog',
            label: 'Users',
            kind: 'users',
            path: ['catalog'],
            warnings: ['not authorized on catalog to execute command usersInfo'],
            payload: {
              database: 'catalog',
              warning: 'usersInfo requires additional privileges',
              users: [],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    const warningList = screen.getByText('not authorized on catalog to execute command usersInfo')
      .closest('.object-view-warning-list')

    expect(screen.queryByText('Review users')).not.toBeInTheDocument()
    expect(warningList).not.toBeNull()
    expect(within(warningList as HTMLElement).getByText('usersInfo requires additional privileges')).toBeInTheDocument()
    expect(screen.getByText('No users were returned')).toBeInTheDocument()
    expect(screen.getByText(/usersInfo privileges/i)).toBeInTheDocument()
  })

  it('previews Mongo user management operations from the users view', () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.user.create'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Users',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'users:catalog',
            label: 'Users',
            kind: 'users',
            path: ['catalog'],
            warnings: [],
            payload: {
              database: 'catalog',
              users: [{ user: 'reporting', roles: [{ role: 'read', db: 'catalog' }] }],
              roles: [{ role: 'readWrite', privileges: [] }],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.queryByText('Role')).not.toBeInTheDocument()
    expect(screen.getByText('read on catalog')).toBeInTheDocument()
    expect(screen.queryByText('[{"role":"read","db":"catalog"}]')).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('reporting_user'), { target: { value: 'analytics' } })
    fireEvent.change(screen.getByPlaceholderText('{{MONGO_USER_PASSWORD}}'), {
      target: { value: '{{MONGO_USER_PASSWORD}}' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.user.create',
      objectName: 'analytics',
      parameters: expect.objectContaining({
        password: '{{MONGO_USER_PASSWORD}}',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Drop user reporting' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.user.drop',
      objectName: 'reporting',
    }))
  })

  it('blocks plaintext Mongo user passwords in the users view', () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.user.create'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Users',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'users:catalog',
            label: 'Users',
            kind: 'users',
            path: ['catalog'],
            warnings: [],
            payload: {
              database: 'catalog',
              users: [],
              roles: [],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText('reporting_user'), { target: { value: 'analytics' } })
    fireEvent.change(screen.getByPlaceholderText('{{MONGO_USER_PASSWORD}}'), {
      target: { value: 'plain-secret' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }))

    expect(screen.getByText('Use an environment secret variable such as {{MONGO_USER_PASSWORD}}.')).toBeInTheDocument()
    expect(onPlanOperation).not.toHaveBeenCalled()
  })

  it('keeps Mongo role management in role mode even when user metadata is present', () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.role.create'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'Roles',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'roles:catalog',
            label: 'Roles',
            kind: 'roles',
            path: ['catalog'],
            warnings: [],
            payload: {
              database: 'catalog',
              users: [{ user: 'reporting', roles: [{ role: 'read', db: 'catalog' }] }],
              roles: [{ role: 'analytics_reader', privileges: [{ resource: { db: 'catalog', collection: 'products' }, actions: ['find'] }] }],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getByText('Role')).toBeInTheDocument()
    expect(screen.queryByText('User')).not.toBeInTheDocument()
    expect(screen.getByText('find on catalog.products')).toBeInTheDocument()
    expect(screen.queryByText(/"actions":/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByPlaceholderText('analytics_reader'), { target: { value: 'inventory_reader' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Role' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.role.create',
      objectName: 'inventory_reader',
    }))
  })

  it('validates and inserts Mongo documents through guarded data edits', () => {
    const onExecuteDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: mongoConnection.id,
      environmentId: environment.id,
      editKind: 'insert-document',
      executionSupport: 'live',
      executed: true,
      plan: operationPlanResponse('mongodb.data-edit.insert-document').plan,
      messages: ['MongoDB inserted 1 document.'],
      warnings: [],
      metadata: { insertedId: 'new-product' },
    }))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'products - Add Document',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'insert-document:catalog:products',
            label: 'Add Document',
            kind: 'insert-document',
            path: ['catalog', 'Collections', 'products'],
            warnings: [],
            payload: {
              database: 'catalog',
              collection: 'products',
              validator: { $jsonSchema: { required: ['sku', 'name'] } },
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onExecuteDataEdit={onExecuteDataEdit}
      />,
    )

    fireEvent.change(screen.getByLabelText('Document'), { target: { value: '{ "sku": "only-sku" }' } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }))
    expect(screen.getByText('Missing required field(s): name')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Document'), { target: { value: '{ "sku": "nova", "name": "Nova Chair" }' } })
    fireEvent.click(screen.getByRole('button', { name: 'Insert Document' }))
    expect(onExecuteDataEdit).toHaveBeenCalledWith(expect.objectContaining({
      editKind: 'insert-document',
      target: expect.objectContaining({
        database: 'catalog',
        collection: 'products',
      }),
      changes: [expect.objectContaining({
        value: { sku: 'nova', name: 'Nova Chair' },
      })],
    }))
  })

  it('renders Mongo GridFS health cards and file metadata without raw payloads', () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse('mongodb.gridfs.export'))

    render(
      <ObjectViewWorkspace
        connection={mongoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          title: 'GridFS',
          objectViewState: {
            connectionId: mongoConnection.id,
            environmentId: environment.id,
            nodeId: 'gridfs-files:catalog:fs.files',
            label: 'fs.files',
            kind: 'gridfs-files',
            path: ['catalog', 'GridFS'],
            queryTemplate: '{ "database": "catalog", "collection": "fs.files", "filter": {}, "limit": 20 }',
            warnings: [],
            payload: {
              database: 'catalog',
              bucket: 'fs',
              filesCollection: 'fs.files',
              chunksCollection: 'fs.chunks',
              missingChunkCount: 1,
              buckets: [{ bucket: 'fs', filesCollection: 'fs.files', chunksCollection: 'fs.chunks' }],
              files: [{ filename: 'invoice.pdf', length: 2048, uploadDate: '2026-05-20T10:00:00Z', metadata: { tenant: 'qa' } }],
              chunks: [{ files_id: 'file-1', n: 0, size: 1024 }],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    expect(screen.getAllByText('GridFS Browser').length).toBeGreaterThan(0)
    expect(screen.getByText('invoice.pdf')).toBeInTheDocument()
    expect(screen.getAllByText(/2(\.0)? KB/).length).toBeGreaterThan(0)
    expect(screen.getByText(/1(\.0)? KB/)).toBeInTheDocument()
    expect(screen.getByText('Missing chunks')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Export Files' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.gridfs.export',
      objectName: 'fs.files',
      parameters: expect.objectContaining({
        database: 'catalog',
        bucket: 'fs',
        filename: 'invoice.pdf',
        filesCollection: 'fs.files',
        chunksCollection: 'fs.chunks',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Upload File' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.gridfs.upload',
      objectName: 'fs.files',
      parameters: expect.objectContaining({
        database: 'catalog',
        bucket: 'fs',
        filename: '<filename>',
        source: '<selected-file>',
        validation: 'validate-before-write',
      }),
    }))

    fireEvent.click(screen.getByRole('button', { name: 'Validate Chunks' }))
    expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'mongodb.gridfs.validate',
      objectName: 'fs.files',
      parameters: expect.objectContaining({
        database: 'catalog',
        bucket: 'fs',
      }),
    }))
  })

  it('renders a Redis database overview with type distribution and key-browser handoff', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'DB 0',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:db:0',
            label: 'DB 0',
            kind: 'database',
            path: ['Databases'],
            summary: 'Inspection ready for redis:db:0.',
            warnings: [],
            payload: {
              database: 0,
              keyCount: 40010,
              scannedKeys: 100,
              typeCounts: [
                { type: 'hash', count: 99, examples: ['perf:session:000143'] },
                { type: 'zset', count: 1, examples: ['products:inventory'] },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('Redis DB Overview').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Inspect the selected logical database/i).length).toBeGreaterThan(0)
    expect(screen.getByText('40010')).toBeInTheDocument()
    expect(screen.getByText('hash')).toBeInTheDocument()
    expect(screen.getByText('products:inventory')).toBeInTheDocument()
    expect(screen.queryByText('["products:inventory"]')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Browse DB Keys' })[0] as HTMLElement)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      preferredBuilder: 'redis-key-browser',
      queryTemplate: expect.stringContaining('"databaseIndex": 0'),
    }))
  })

  it('renders Redis diagnostics as metrics instead of a generic payload dump', () => {
    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'INFO',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:diagnostics:info',
            label: 'INFO',
            kind: 'diagnostics',
            path: ['Diagnostics'],
            warnings: [],
            payload: {
              kind: 'diagnostics',
              metrics: [
                { label: 'Connected Clients', value: 1, section: 'clients' },
                { label: 'Used Memory', value: 7399232, section: 'memory' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Redis Diagnostics').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Connected Clients').length).toBeGreaterThan(0)
    expect(screen.queryByText('used_memory')).not.toBeInTheDocument()
    expect(screen.getAllByText('Used Memory').length).toBeGreaterThan(0)
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('renders empty Redis Pub/Sub metadata without raw command payloads', () => {
    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'Pub/Sub',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:pubsub',
            label: 'Pub/Sub',
            kind: 'pubsub',
            path: ['Pub/Sub'],
            warnings: [],
            payload: {
              kind: 'pubsub',
              channels: [],
              patterns: [],
              subscribers: [],
              activeChannels: 0,
              patternSubscriptions: 0,
              totalSubscribers: 0,
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Redis Pub/Sub').length).toBeGreaterThan(0)
    expect(screen.getByText('No Pub/Sub metadata is available. Refresh channel metadata or use the Redis Console for explicit channel inspection.')).toBeInTheDocument()
    expect(screen.queryByText('PUBSUB CHANNELS')).not.toBeInTheDocument()
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument()
    expect(screen.queryByText(/"value"/)).not.toBeInTheDocument()
  })

  it('renders Redis Pub/Sub command payloads as channel rows', () => {
    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'Channels',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:pubsub:channels',
            label: 'Channels',
            kind: 'pubsub-channel',
            path: ['Pub/Sub'],
            warnings: [],
            payload: {
              command: 'PUBSUB CHANNELS',
              value: ['orders.created', 'inventory.changed'],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByText('orders.created')).toBeInTheDocument()
    expect(screen.getByText('inventory.changed')).toBeInTheDocument()
    expect(screen.queryByText('PUBSUB CHANNELS')).not.toBeInTheDocument()
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument()
  })

  it('renders Redis slow operations from semantic metadata', () => {
    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'Slow Operations',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:diagnostics:slowlog',
            label: 'Slow Operations',
            kind: 'slowlog',
            path: ['Diagnostics'],
            warnings: [],
            payload: {
              kind: 'slowlog',
              entries: [
                {
                  id: 1,
                  durationMicros: 1200,
                  commandName: 'HGETALL',
                  key: 'perf:session:000143',
                },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Slow Operations').length).toBeGreaterThan(0)
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('1.2 ms')).toBeInTheDocument()
    expect(screen.getByText('HGETALL / perf:session:000143')).toBeInTheDocument()
    expect(screen.queryByText('SLOWLOG GET 128')).not.toBeInTheDocument()
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument()
  })

  it('renders Redis cluster nodes without exposing the raw CLUSTER command payload', () => {
    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'Cluster Nodes',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:cluster:nodes',
            label: 'Nodes',
            kind: 'cluster-node',
            path: ['Cluster'],
            warnings: [],
            payload: {
              command: 'CLUSTER NODES',
              value: '07c37dfeb2352e0b1e5 127.0.0.1:6379@16379 master,connected - 0 0 1 connected 0-5460',
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Cluster Nodes').length).toBeGreaterThan(0)
    expect(screen.getByText('07c37dfeb2352e0b1e5')).toBeInTheDocument()
    expect(screen.getByText('master')).toBeInTheDocument()
    expect(screen.getByText('127.0.0.1:6379@16379')).toBeInTheDocument()
    expect(screen.getByText('0-5460')).toBeInTheDocument()
    expect(screen.queryByText('CLUSTER NODES')).not.toBeInTheDocument()
    expect(screen.queryByText(/"value"/)).not.toBeInTheDocument()
  })

  it('renders Redis Sentinel masters as deployment rows instead of raw arrays', () => {
    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'Sentinel Masters',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:sentinel:masters',
            label: 'Masters',
            kind: 'sentinel-masters',
            path: ['Sentinel'],
            warnings: [],
            payload: {
              command: 'SENTINEL MASTERS',
              value: [
                ['name', 'primary', 'ip', '127.0.0.1', 'port', '6379', 'flags', 'master', 'quorum', '2', 'num-slaves', '1'],
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Sentinel Masters').length).toBeGreaterThan(0)
    expect(screen.getByText('primary')).toBeInTheDocument()
    expect(screen.getByText('127.0.0.1:6379')).toBeInTheDocument()
    expect(screen.queryByText('SENTINEL MASTERS')).not.toBeInTheDocument()
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument()
  })

  it('renders Redis function libraries as native library rows', () => {
    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'Functions',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:functions:list',
            label: 'Libraries',
            kind: 'functions',
            path: ['Functions'],
            warnings: [],
            payload: {
              command: 'FUNCTION LIST',
              value: [
                ['library_name', 'inventory', 'engine', 'LUA', 'functions', [['name', 'reserve_stock']]],
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Redis Functions').length).toBeGreaterThan(0)
    expect(screen.getByText('inventory')).toBeInTheDocument()
    expect(screen.getByText('LUA')).toBeInTheDocument()
    expect(screen.getByText('reserve_stock')).toBeInTheDocument()
    expect(screen.queryByText('FUNCTION LIST')).not.toBeInTheDocument()
    expect(screen.queryByText(/"value"/)).not.toBeInTheDocument()
  })

  it('renders Redis ACL users from ACL LIST output without raw command text', () => {
    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'ACL Users',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:acl:users',
            label: 'Users',
            kind: 'users',
            path: ['ACL / Security'],
            warnings: [],
            payload: {
              command: 'ACL LIST',
              value: ['user default on nopass ~* &* +@all'],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('ACL Users').length).toBeGreaterThan(0)
    expect(screen.getByText('default')).toBeInTheDocument()
    expect(screen.getByText('Enabled')).toBeInTheDocument()
    expect(screen.getByText('+@all')).toBeInTheDocument()
    expect(screen.queryByText('ACL LIST')).not.toBeInTheDocument()
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument()
  })

  it('renders Redis key previews as value tables instead of JSON blocks', () => {
    render(
      <ObjectViewWorkspace
        connection={redisConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: redisConnection.id,
          family: 'keyvalue',
          title: 'perf:session:000143',
          objectViewState: {
            connectionId: redisConnection.id,
            environmentId: environment.id,
            nodeId: 'redis:key:perf:session:000143',
            label: 'perf:session:000143',
            kind: 'hash',
            path: ['DB 0', 'Hashes'],
            warnings: [],
            payload: {
              key: 'perf:session:000143',
              type: 'hash',
              ttlSeconds: -1,
              memoryUsageBytes: 144,
              encoding: 'listpack',
              length: 2,
              preview: {
                sku: 'luna-lamp',
                inventory: { available: 18, reserved: 4 },
              },
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('perf:session:000143').length).toBeGreaterThan(0)
    expect(screen.getByText('Sku')).toBeInTheDocument()
    expect(screen.getAllByText('luna-lamp').length).toBeGreaterThan(0)
    expect(screen.getByText('Inventory')).toBeInTheDocument()
    expect(screen.getByText(/2 field\(s\): Available, Reserved/)).toBeInTheDocument()
    expect(screen.queryByText(/"available"/)).not.toBeInTheDocument()
  })

  it('renders Oracle table metadata as a native object workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={oracleConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: oracleConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'ACCOUNTS',
          objectViewState: {
            connectionId: oracleConnection.id,
            environmentId: environment.id,
            nodeId: 'oracle-table:APP:ACCOUNTS',
            label: 'ACCOUNTS',
            kind: 'table',
            path: ['FREEPDB1', 'APP', 'Tables'],
            queryTemplate: 'select * from "APP"."ACCOUNTS" where rownum <= 100',
            warnings: [],
            payload: {
              engine: 'oracle',
              schema: 'APP',
              objectName: 'ACCOUNTS',
              service: 'FREEPDB1',
              rowCount: 128,
              columns: [
                { name: 'ID', type: 'NUMBER(19)', nullable: 'NO' },
                { name: 'STATUS', type: 'VARCHAR2(40)', nullable: 'YES' },
              ],
              indexes: [
                { name: 'ACCOUNTS_PK', uniqueness: 'UNIQUE', status: 'VALID', visibility: 'VISIBLE' },
              ],
              constraints: [
                { name: 'ACCOUNTS_PK', type: 'PRIMARY KEY', status: 'ENABLED', columns: 'ID' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('Oracle Table').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Inspect table data entry points/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText('ID').length).toBeGreaterThan(0)
    expect(screen.getByText('NUMBER(19)')).toBeInTheDocument()
    expect(screen.getAllByText('ACCOUNTS_PK').length).toBeGreaterThan(0)
    expect(screen.queryByText('metadataViews')).not.toBeInTheDocument()
    expect(screen.queryByText('permissionSensitiveViews')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Data Query' })[0] as HTMLElement)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      preferredBuilder: 'sql-select',
      queryTemplate: expect.stringContaining('ACCOUNTS'),
    }))
  })

  it('renders Oracle performance warnings and plan rows without raw payload dumps', () => {
    render(
      <ObjectViewWorkspace
        connection={oracleConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: oracleConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'Execution Plan',
          objectViewState: {
            connectionId: oracleConnection.id,
            environmentId: environment.id,
            nodeId: 'oracle-explain-plan',
            label: 'Execution Plan',
            kind: 'execution-plan',
            path: ['Diagnostics'],
            warnings: ['DBMS_XPLAN output is available only after EXPLAIN PLAN has run.'],
            payload: {
              engine: 'oracle',
              service: 'FREEPDB1',
              elapsedMs: 12,
              planLines: [
                { id: 0, operation: 'SELECT STATEMENT', rows: 100, cost: 4 },
                { id: 1, operation: 'TABLE ACCESS FULL', objectName: 'ACCOUNTS', rows: 100, cost: 4 },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Execution Plan').length).toBeGreaterThan(0)
    expect(screen.getByText('TABLE ACCESS FULL')).toBeInTheDocument()
    expect(screen.getByText('ACCOUNTS')).toBeInTheDocument()
    expect(screen.getByText('DBMS_XPLAN output is available only after EXPLAIN PLAN has run.')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('renders Memcached stats as a native cache workspace without key-prefix noise', () => {
    render(
      <ObjectViewWorkspace
        connection={memcachedConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: memcachedConnection.id,
          family: 'keyvalue',
          title: 'Stats',
          objectViewState: {
            connectionId: memcachedConnection.id,
            environmentId: environment.id,
            nodeId: 'memcached:stats',
            label: 'Stats',
            kind: 'stats',
            path: ['Server'],
            warnings: [],
            payload: {
              engine: 'memcached',
              objectView: 'stats',
              stats: [
                { metric: 'curr_items', value: 12842, unit: 'items', section: 'items' },
                { metric: 'bytes', value: '42.8 MB', unit: 'memory', section: 'memory' },
                { metric: 'evictions', value: 12, unit: 'items', section: 'items' },
                { metric: 'curr_connections', value: 18, unit: 'clients', section: 'connections' },
              ],
              diagnostics: [
                { signal: 'Hit Rate', value: '99.2%', status: 'healthy', guidance: 'Cache is serving most requested keys.' },
              ],
              warnings: [
                'Memcached does not expose safe key enumeration; use application key knowledge or targeted get/set flows.',
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Memcached Stats').length).toBeGreaterThan(0)
    expect(screen.getByText(/Review operational counters/i)).toBeInTheDocument()
    expect(screen.getByText('curr_items')).toBeInTheDocument()
    expect(screen.getAllByText('Hit Rate').length).toBeGreaterThan(0)
    expect(screen.getByText(/does not expose safe key enumeration/i)).toBeInTheDocument()
    expect(screen.queryByText('session:*')).not.toBeInTheDocument()
    expect(screen.queryByText('cache:*')).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('renders Memcached slab and item metadata as allocation tables', () => {
    render(
      <ObjectViewWorkspace
        connection={memcachedConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: memcachedConnection.id,
          family: 'keyvalue',
          title: 'Slabs',
          objectViewState: {
            connectionId: memcachedConnection.id,
            environmentId: environment.id,
            nodeId: 'memcached:slabs',
            label: 'Slabs',
            kind: 'slabs',
            path: ['Server'],
            warnings: [],
            payload: {
              slabs: [
                { classId: '2', chunkSize: '240 B', usedChunks: 48128, freeChunks: 1280, totalPages: 12, memory: '11.0 MB' },
              ],
              diagnostics: [
                { signal: 'Evictions', value: 12, status: 'watch', guidance: 'Review maxbytes if evictions keep rising.' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Memcached Slabs').length).toBeGreaterThan(0)
    expect(screen.getByText('240 B')).toBeInTheDocument()
    expect(screen.getByText(/48\s*128/)).toBeInTheDocument()
    expect(screen.getByText('Allocation')).toBeInTheDocument()
    expect(screen.queryByText('stats slabs')).not.toBeInTheDocument()
  })

  it('keeps Oracle PL/SQL source behind an explicit reveal', () => {
    render(
      <ObjectViewWorkspace
        connection={oracleConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: oracleConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'ACCOUNT_API',
          objectViewState: {
            connectionId: oracleConnection.id,
            environmentId: environment.id,
            nodeId: 'oracle-package:APP:ACCOUNT_API',
            label: 'ACCOUNT_API',
            kind: 'package',
            path: ['FREEPDB1', 'APP', 'Packages'],
            warnings: [],
            payload: {
              engine: 'oracle',
              schema: 'APP',
              objectName: 'ACCOUNT_API',
              packages: [{ owner: 'APP', name: 'ACCOUNT_API', type: 'PACKAGE', status: 'VALID' }],
              sourceLines: [
                { line: 1, text: 'create or replace package account_api as' },
                { line: 2, text: '  procedure refresh_account(p_account_id number);' },
                { line: 3, text: 'end account_api;' },
              ],
              dependencies: [{ owner: 'APP', name: 'ACCOUNT_API', type: 'PACKAGE', referencedName: 'ACCOUNTS' }],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Oracle Package').length).toBeGreaterThan(0)
    expect(screen.getByText('Source Outline')).toBeInTheDocument()
    expect(screen.getByText('Source lines')).toBeInTheDocument()
    expect(screen.getByText('Procedure: refresh_account')).toBeInTheDocument()
    expect(screen.queryByText('procedure refresh_account(p_account_id number);')).not.toBeInTheDocument()
    expect(screen.queryByText('create or replace package account_api as')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show source' }))
    expect(screen.getByText('create or replace package account_api as')).toBeInTheDocument()
  })

  it('renders PostgreSQL table metadata as a purpose-built catalog workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={postgresConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: postgresConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'accounts',
          objectViewState: {
            connectionId: postgresConnection.id,
            environmentId: environment.id,
            nodeId: 'table:public.accounts',
            label: 'accounts',
            kind: 'table',
            path: ['User Schemas', 'public', 'Tables'],
            queryTemplate: 'select * from "public"."accounts" limit 100;',
            warnings: [],
            payload: {
              engine: 'postgresql',
              schema: 'public',
              objectName: 'accounts',
              rowCount: 128,
              size: '96 KB',
              columns: [
                { name: 'id', type: 'bigint', nullable: false },
                { name: 'updated_at', type: 'timestamp with time zone', nullable: false },
              ],
              indexes: [
                { name: 'accounts_pkey', type: 'btree', columns: 'id', unique: true, valid: true },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('PostgreSQL Table').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect table columns, indexes/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Data' })).toBeInTheDocument()
    expect(screen.getAllByText('Columns').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Indexes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Grants').length).toBeGreaterThan(0)
    expect(screen.getByText('updated_at')).toBeInTheDocument()
    expect(screen.getByText('timestamp with time zone')).toBeInTheDocument()
    expect(screen.getByText('accounts_pkey')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Data Query' }))
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryTemplate: expect.stringContaining('accounts'),
    }))
  })

  it('keeps PostgreSQL function source hidden behind an explicit reveal', () => {
    const source = [
      'create or replace function public.account_status(p_account_id bigint)',
      'returns text',
      'language plpgsql',
      'as $$',
      'begin',
      "  return 'active';",
      'end;',
      '$$;',
    ].join('\n')

    render(
      <ObjectViewWorkspace
        connection={postgresConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: postgresConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'account_status',
          objectViewState: {
            connectionId: postgresConnection.id,
            environmentId: environment.id,
            nodeId: 'function:public:account_status',
            label: 'account_status',
            kind: 'function',
            path: ['User Schemas', 'public', 'Functions'],
            warnings: [],
            payload: {
              engine: 'postgresql',
              schema: 'public',
              objectName: 'account_status',
              definition: source,
              functions: [
                {
                  schema: 'public',
                  name: 'account_status',
                  arguments: 'p_account_id bigint',
                  returns: 'text',
                  language: 'plpgsql',
                  definition: source,
                },
              ],
              grants: [
                { principal: 'app_reader', privilege: 'EXECUTE', object: 'public.account_status', state: 'granted' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('PostgreSQL Function').length).toBeGreaterThan(0)
    expect(screen.getByText('Source Outline')).toBeInTheDocument()
    expect(screen.getByText('CREATE statement')).toBeInTheDocument()
    expect(screen.queryByText(/return 'active'/i)).not.toBeInTheDocument()
    expect(screen.getAllByText(/CREATE statement \(\d+ chars\)/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Show source' }))
    expect(screen.getByText(/return 'active'/i)).toBeInTheDocument()
  })

  it('renders SQLite table metadata as a native file-backed workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={sqliteConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: sqliteConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'accounts',
          objectViewState: {
            connectionId: sqliteConnection.id,
            environmentId: environment.id,
            nodeId: 'table:main:accounts',
            label: 'accounts',
            kind: 'table',
            path: ['Main Database', 'Tables'],
            queryTemplate: 'select * from [main].[accounts] limit 100;',
            warnings: [],
            payload: {
              engine: 'sqlite',
              schema: 'main',
              objectName: 'accounts',
              rowCount: 128,
              size: '48 KB',
              columns: [
                { name: 'id', type: 'integer', nullable: false, identity: 'primary key' },
                { name: 'updated_at', type: 'text', nullable: false, default: 'current_timestamp' },
              ],
              indexes: [
                { name: 'accounts_pkey', type: 'btree', columns: 'id', unique: true, valid: true },
              ],
              foreignKeys: [],
              schemaObjects: [{
                type: 'table',
                name: 'accounts',
                tableName: 'accounts',
                definition: 'create table accounts (id integer primary key, updated_at text not null default current_timestamp)',
              }],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('SQLite Table').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect columns, indexes, constraints/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Data' })).toBeInTheDocument()
    expect(screen.getAllByText('Columns').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Indexes').length).toBeGreaterThan(0)
    expect(screen.getByText('updated_at')).toBeInTheDocument()
    expect(screen.getByText('accounts_pkey')).toBeInTheDocument()
    expect(screen.getByText(/CREATE statement \(\d+ chars\)/)).toBeInTheDocument()
    expect(screen.queryByText(/create table accounts/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Data' }))
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryTemplate: expect.stringContaining('[main].[accounts]'),
    }))
  })

  it('renders LiteDB collection metadata as a native local document workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={liteDbConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: liteDbConnection.id,
          family: 'document',
          language: 'json',
          title: 'products',
          objectViewState: {
            connectionId: liteDbConnection.id,
            environmentId: environment.id,
            nodeId: 'litedb:collection:products',
            label: 'products',
            kind: 'collection',
            path: ['catalog.db', 'Collections'],
            queryTemplate: '{ "collection": "products", "filter": {}, "limit": 20 }',
            warnings: [],
            payload: {
              engine: 'litedb',
              database: 'catalog.db',
              objectView: 'collection',
              collection: 'products',
              collectionCount: 3,
              documentCount: 100000,
              indexCount: 3,
              fileSize: '18.4 MB',
              fields: [
                { path: '_id', types: 'ObjectId', presence: '100%', example: '66f1...', warning: '' },
                { path: 'sku', types: 'String', presence: '100%', example: 'luna-lamp', warning: '' },
              ],
              indexes: [
                { collection: 'products', name: '_id', expression: '$._id', unique: true, status: 'ready' },
                { collection: 'products', name: 'sku', expression: '$.sku', unique: true, status: 'ready' },
              ],
              diagnostics: [
                { signal: 'Index Coverage', value: '2 indexes', status: 'healthy', guidance: 'Common lookup fields are indexed.' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('LiteDB Collection').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect documents, inferred schema, indexes/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Open Collection Query' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Schema Preview').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Indexes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('sku').length).toBeGreaterThan(0)
    expect(screen.getByText('$.sku')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Collection Query' })[0] as HTMLElement)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryTemplate: expect.stringContaining('"collection": "products"'),
    }))
  })

  it('renders LiteDB file storage without raw command dumps', () => {
    render(
      <ObjectViewWorkspace
        connection={liteDbConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: liteDbConnection.id,
          family: 'document',
          language: 'json',
          title: 'File Storage',
          objectViewState: {
            connectionId: liteDbConnection.id,
            environmentId: environment.id,
            nodeId: 'litedb:file-storage',
            label: 'File Storage',
            kind: 'file-storage',
            path: ['catalog.db'],
            warnings: [],
            payload: {
              engine: 'litedb',
              objectView: 'file-storage',
              files: [
                { id: 'invoice/2026/001', filename: 'invoice-001.pdf', length: '86 KB', uploadDate: '2026-05-20T10:00:00Z', chunks: 2 },
              ],
              chunks: [
                { fileId: 'invoice/2026/001', chunk: 0, size: '64 KB', status: 'ok' },
              ],
              diagnostics: [
                { signal: 'File Storage', value: '1 file', status: 'healthy', guidance: 'Chunks are complete.' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('LiteDB File Storage').length).toBeGreaterThan(0)
    expect(screen.getByText('invoice-001.pdf')).toBeInTheDocument()
    expect(screen.getByText('64 KB')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
    expect(screen.queryByText(/"operation"/)).not.toBeInTheDocument()
  })

  it('renders Cosmos DB container metadata as a native Azure document workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={cosmosConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: cosmosConnection.id,
          family: 'document',
          language: 'json',
          title: 'products',
          objectViewState: {
            connectionId: cosmosConnection.id,
            environmentId: environment.id,
            nodeId: 'cosmos:container:catalog:products',
            label: 'products',
            kind: 'container',
            path: ['Account', 'Databases', 'catalog', 'Containers'],
            queryTemplate: '{ "database": "catalog", "collection": "products", "filter": {}, "limit": 20 }',
            warnings: [],
            payload: {
              engine: 'cosmosdb',
              api: 'NoSQL',
              accountName: 'datapad-cosmos',
              database: 'catalog',
              container: 'products',
              databaseCount: 1,
              containerCount: 3,
              totalThroughput: '6,000 RU/s',
              writeRegion: 'West Europe',
              containers: [
                { name: 'products', partitionKey: '/tenantId', throughput: 'autoscale 4,000 RU/s', items: 100000, ttl: 'off' },
              ],
              partitionKeys: [
                { path: '/tenantId', kind: 'Hash', hotPartitionRisk: 'low', guidance: 'Tenant-scoped queries route cleanly.' },
              ],
              indexingPolicy: [
                { path: '/*', mode: 'consistent', kind: 'included', precision: -1 },
              ],
              throughput: [
                { scope: 'catalog.products', mode: 'autoscale', ruPerSecond: '4,000 max', throttles: 0 },
              ],
              scripts: [
                { type: 'stored procedure', name: 'bulkUpsert', operation: '/products', status: 'preview management only' },
              ],
              diagnostics: [
                { signal: 'RU Consumption', value: '52%', status: 'healthy', guidance: 'Current workload fits configured RU/s.' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('Cosmos DB Container').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect items, partitioning, indexing/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Open Items Query' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Partition Key').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Indexing Policy').length).toBeGreaterThan(0)
    expect(screen.getAllByText('/tenantId').length).toBeGreaterThan(0)
    expect(screen.getByText('autoscale')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Items Query' })[0] as HTMLElement)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryTemplate: expect.stringContaining('"collection": "products"'),
    }))
  })

  it('renders Cosmos DB account regions and security without raw command dumps', () => {
    render(
      <ObjectViewWorkspace
        connection={cosmosConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: cosmosConnection.id,
          family: 'document',
          language: 'json',
          title: 'Cosmos DB Account',
          objectViewState: {
            connectionId: cosmosConnection.id,
            environmentId: environment.id,
            nodeId: 'cosmos:account',
            label: 'datapad-cosmos',
            kind: 'account',
            path: ['Account'],
            warnings: [],
            payload: {
              engine: 'cosmosdb',
              api: 'NoSQL',
              accountName: 'datapad-cosmos',
              databaseCount: 2,
              containerCount: 4,
              totalThroughput: '6,000 RU/s',
              writeRegion: 'West Europe',
              databases: [{ name: 'catalog', containers: 3, throughput: 'shared 4,000 RU/s', storage: '8.1 GB' }],
              containers: [{ name: 'products', partitionKey: '/tenantId', throughput: 'autoscale 4,000 RU/s', items: 100000, ttl: 'off' }],
              regions: [{ name: 'West Europe', role: 'write', priority: 0, status: 'online' }],
              consistency: [{ setting: 'Default consistency', value: 'Session', guidance: 'Good default.' }],
              security: [{ name: 'ReadOnlyApp', kind: 'role assignment', scope: 'account', status: 'read metadata and items' }],
              diagnostics: [{ signal: 'RU Consumption', value: '38%', status: 'healthy', guidance: 'Current workload fits configured RU/s.' }],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Cosmos DB Account').length).toBeGreaterThan(0)
    expect(screen.getAllByText('West Europe').length).toBeGreaterThan(0)
    expect(screen.getByText('ReadOnlyApp')).toBeInTheDocument()
    expect(screen.getByText('Session')).toBeInTheDocument()
    expect(screen.queryByText(/"operation"/)).not.toBeInTheDocument()
  })

  it('renders MySQL table metadata as a native database workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={mysqlConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: mysqlConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'accounts',
          objectViewState: {
            connectionId: mysqlConnection.id,
            environmentId: environment.id,
            nodeId: 'table:datapadplusplus:accounts',
            label: 'accounts',
            kind: 'table',
            path: ['Databases', 'datapadplusplus', 'Tables'],
            queryTemplate: 'select * from `datapadplusplus`.`accounts` limit 100;',
            warnings: [],
            payload: {
              engine: 'mysql',
              database: 'datapadplusplus',
              schema: 'datapadplusplus',
              objectName: 'accounts',
              rowCount: 128,
              size: '80 KB',
              columns: [
                { name: 'id', type: 'bigint unsigned', nullable: false, identity: 'auto_increment' },
                { name: 'updated_at', type: 'timestamp', nullable: false, default: 'current_timestamp' },
              ],
              indexes: [
                { name: 'PRIMARY', type: 'btree', columns: 'id', unique: true, valid: true, size: '16 KB' },
              ],
              permissions: [
                { principal: 'app@%', privilege: 'SELECT, INSERT, UPDATE, DELETE', object: 'accounts', state: 'granted' },
              ],
              schemaObjects: [{
                type: 'table',
                name: 'accounts',
                tableName: 'accounts',
                definition: 'create table `accounts` (id bigint unsigned primary key auto_increment)',
              }],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('MySQL Table').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect columns, indexes, constraints/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Data' })).toBeInTheDocument()
    expect(screen.getAllByText('Columns').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Indexes').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Grants').length).toBeGreaterThan(0)
    expect(screen.getByText('auto_increment')).toBeInTheDocument()
    expect(screen.getByText('PRIMARY')).toBeInTheDocument()
    expect(screen.getByText('app@%')).toBeInTheDocument()
    expect(screen.getByText(/CREATE statement \(\d+ chars\)/)).toBeInTheDocument()
    expect(screen.queryByText(/create table `accounts`/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Data Query' }))
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryTemplate: expect.stringContaining('`datapadplusplus`.`accounts`'),
    }))
  })

  it('renders Elasticsearch index metadata as a native search workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={searchConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: searchConnection.id,
          family: 'search',
          language: 'json',
          title: 'products-v1',
          objectViewState: {
            connectionId: searchConnection.id,
            environmentId: environment.id,
            nodeId: 'index:products-v1',
            label: 'products-v1',
            kind: 'index',
            path: ['Indices'],
            queryTemplate: '{ "index": "products-v1", "body": { "query": { "match_all": {} }, "size": 20 } }',
            warnings: [],
            payload: {
              engine: 'elasticsearch',
              clusterName: 'elasticsearch-local',
              objectView: 'index',
              index: 'products-v1',
              documentCount: 100000,
              storage: '420 MB',
              primaryShards: 1,
              replicaShards: 1,
              indices: [
                { name: 'products-v1', health: 'green', status: 'open', documents: 100000, primaryShards: 1, replicaShards: 1, storage: '420 MB', lifecycle: 'products-ilm' },
              ],
              fields: [
                { path: 'sku', type: 'keyword', searchable: true, aggregatable: true, analyzer: '-', normalizer: 'lowercase' },
                { path: 'name', type: 'text', searchable: true, aggregatable: false, analyzer: 'standard', normalizer: '-' },
              ],
              aliases: [
                { name: 'products-read', indices: 'products-v1', writeIndex: false, routing: '-', filter: { term: { active: true } } },
              ],
              shards: [
                { index: 'products-v1', shard: 0, primary: true, state: 'STARTED', node: 'node-a', documents: 100000, storage: '210 MB' },
              ],
              settings: [
                { name: 'refresh_interval', value: '1s', scope: 'index' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('Search Index').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect mapping fields, aliases, shards/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getAllByText('Mappings').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Shards').length).toBeGreaterThan(0)
    expect(screen.getByText('sku')).toBeInTheDocument()
    expect(screen.getByText('keyword')).toBeInTheDocument()
    expect(screen.getByText('products-read')).toBeInTheDocument()
    expect(screen.getByText(/JSON object \(1 field\)/)).toBeInTheDocument()
    expect(screen.queryByText(/"term"/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Search' }))
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      preferredBuilder: 'search-dsl',
      queryTemplate: expect.stringContaining('products-v1'),
    }))
  })

  it('renders DynamoDB table metadata as a native key-condition workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={dynamoConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: dynamoConnection.id,
          family: 'widecolumn',
          language: 'json',
          title: 'Orders',
          objectViewState: {
            connectionId: dynamoConnection.id,
            environmentId: environment.id,
            nodeId: 'table:Orders',
            label: 'Orders',
            kind: 'table',
            path: ['Tables'],
            queryTemplate: '{ "operation": "Query", "tableName": "Orders", "limit": 20 }',
            warnings: [],
            payload: {
              engine: 'dynamodb',
              region: 'local',
              objectView: 'table',
              tableName: 'Orders',
              status: 'ACTIVE',
              billingMode: 'PAY_PER_REQUEST',
              itemCount: 482000,
              storage: '1.4 GB',
              keys: [
                { attribute: 'pk', type: 'HASH', keyRole: 'partition', attributeType: 'S' },
                { attribute: 'sk', type: 'RANGE', keyRole: 'sort', attributeType: 'S' },
              ],
              globalSecondaryIndexes: [
                { name: 'customer-status-index', partitionKey: 'customerId', sortKey: 'status', projection: 'INCLUDE total, updatedAt', status: 'ACTIVE', items: 482000, capacity: 'on-demand' },
              ],
              localSecondaryIndexes: [
                { name: 'createdAt-lsi', sortKey: 'createdAt', projection: 'KEYS_ONLY', items: 482000, storage: '94 MB' },
              ],
              streams: [
                { status: 'ENABLED', viewType: 'NEW_AND_OLD_IMAGES', arn: 'arn:aws:dynamodb:local:000000000000:table/Orders/stream/example', shards: 4, consumers: 1 },
              ],
              ttl: [
                { attribute: 'expiresAt', status: 'ENABLED', sampleExpiringItems: 1240, oldestExpiry: '2026-05-24T00:00:00Z' },
              ],
              capacity: [
                { resource: 'Orders', readUnits: 84, writeUnits: 31, readThrottleEvents: 2, writeThrottleEvents: 0, latencyP95: '12 ms' },
              ],
              hotPartitions: [
                { partitionKey: 'CUSTOMER#123', readPercent: '18%', writePercent: '9%', throttles: 2, recommendation: 'Review access pattern.' },
              ],
              permissions: [
                { principal: 'app-writer', action: 'dynamodb:Query, UpdateItem', resource: 'Orders', effect: 'Allow', condition: { environment: 'qa' } },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('DynamoDB Table').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect partition\/sort keys/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Items' })).toBeInTheDocument()
    expect(screen.getAllByText('Keys').length).toBeGreaterThan(0)
    expect(screen.getByText('customer-status-index')).toBeInTheDocument()
    expect(screen.getByText('NEW_AND_OLD_IMAGES')).toBeInTheDocument()
    expect(screen.getByText('CUSTOMER#123')).toBeInTheDocument()
    expect(screen.getByText(/JSON object \(1 field\)/)).toBeInTheDocument()
    expect(screen.queryByText(/"environment"/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open Item Query' }))
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      preferredBuilder: 'dynamodb-key-condition',
      queryTemplate: expect.stringContaining('Orders'),
    }))
  })

  it('renders Cassandra table metadata as a native partition-query workspace', () => {
    const onOpenQuery = vi.fn()
    render(
      <ObjectViewWorkspace
        connection={cassandraConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: cassandraConnection.id,
          family: 'widecolumn',
          language: 'sql',
          title: 'orders_by_customer',
          objectViewState: {
            connectionId: cassandraConnection.id,
            environmentId: environment.id,
            nodeId: 'table:app:orders_by_customer',
            label: 'orders_by_customer',
            kind: 'table',
            path: ['Keyspaces', 'app', 'Tables'],
            queryTemplate: 'select * from "app"."orders_by_customer" where customer_id = ? limit 20;',
            warnings: [],
            payload: {
              engine: 'cassandra',
              keyspace: 'app',
              objectView: 'table',
              tableName: 'orders_by_customer',
              partitionCount: 8400,
              sstableCount: 12,
              indexCount: 1,
              p95ReadMs: 6,
              tombstoneWarningCount: 0,
              tables: [
                { name: 'orders_by_customer', partitionKey: 'customer_id', clusteringKey: 'order_day, order_id', readPath: 'single partition' },
              ],
              columns: [
                { name: 'customer_id', role: 'partition key', type: 'uuid', clusteringOrder: '-' },
                { name: 'order_day', role: 'clustering', type: 'date', clusteringOrder: 'DESC' },
                { name: 'status', role: 'regular', type: 'text', clusteringOrder: '-' },
              ],
              primaryKey: [
                { role: 'partition key', name: 'customer_id', position: 1, type: 'uuid' },
                { role: 'clustering', name: 'order_day', position: 2, type: 'date' },
              ],
              indexes: [
                { name: 'orders_status_sai', kind: 'SAI', target: 'status', options: { mode: 'contains' } },
              ],
              options: [
                { option: 'compaction', value: 'TimeWindowCompactionStrategy', guidance: 'Match TTL patterns.' },
              ],
              diagnostics: [
                { signal: 'Read latency p95', value: '6 ms', status: 'Healthy', guidance: 'Bounded partition reads look healthy.' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('Cassandra Table').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect partition keys/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Query Rows' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Primary Key').length).toBeGreaterThan(0)
    expect(screen.getAllByText('customer_id').length).toBeGreaterThan(0)
    expect(screen.getByText('orders_status_sai')).toBeInTheDocument()
    expect(screen.getByText(/JSON object \(1 field\)/)).toBeInTheDocument()
    expect(screen.queryByText(/"mode"/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Query Rows' })[0]!)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      preferredBuilder: 'cql-partition',
      queryTemplate: expect.stringContaining('customer_id'),
    }))
  })

  it('renders Prometheus metric metadata as a native PromQL workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={prometheusConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: prometheusConnection.id,
          family: 'timeseries',
          language: 'promql',
          title: 'http_requests_total',
          objectViewState: {
            connectionId: prometheusConnection.id,
            environmentId: environment.id,
            nodeId: 'metric:http_requests_total',
            label: 'http_requests_total',
            kind: 'metric',
            path: ['Metrics'],
            queryTemplate: 'http_requests_total',
            warnings: [],
            payload: {
              engine: 'prometheus',
              objectView: 'metric',
              metricCount: 4,
              seriesCount: 12840,
              upTargets: 2,
              downTargets: 1,
              ruleCount: 3,
              alertCount: 2,
              retention: '15 d',
              metrics: [
                { name: 'http_requests_total', type: 'counter', help: 'Total HTTP requests.', series: 840, samples: '8.4k/min', cardinality: 'medium' },
              ],
              series: [
                { metric: 'http_requests_total', labels: { job: 'api', instance: 'api-1:9100' }, lastSample: '248', sampleRate: '1/min', cardinality: 'low' },
              ],
              labels: [
                { name: 'route', valueCount: 128, metricCount: 18, cardinality: 'high', risk: 'expensive' },
              ],
              diagnostics: [
                { signal: 'Metric Cardinality', value: 'medium', status: 'watch', guidance: 'Use label matchers before range aggregations.' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('Prometheus Metric').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect one metric family/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Query Metric' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Series').length).toBeGreaterThan(0)
    expect(screen.getAllByText('http_requests_total').length).toBeGreaterThan(0)
    expect(screen.getByText('counter')).toBeInTheDocument()
    expect(screen.getByText(/JSON object \(2 fields\)/)).toBeInTheDocument()
    expect(screen.queryByText(/"job"/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Query Metric' })[0]!)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryTemplate: 'http_requests_total',
    }))
  })

  it('renders InfluxDB measurement metadata as a native Flux workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={influxConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: influxConnection.id,
          family: 'timeseries',
          language: 'flux',
          title: 'cpu',
          objectViewState: {
            connectionId: influxConnection.id,
            environmentId: environment.id,
            nodeId: 'measurement:telemetry:cpu',
            label: 'cpu',
            kind: 'measurement',
            path: ['Buckets', 'telemetry', 'Measurements'],
            queryTemplate: 'from(bucket: "telemetry")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "cpu")',
            warnings: [],
            payload: {
              engine: 'influxdb',
              objectView: 'measurement',
              bucket: 'telemetry',
              measurementCount: 3,
              seriesCount: 18420,
              retention: '30 d',
              storage: '1.8 GB',
              taskCount: 2,
              measurements: [
                { name: 'cpu', bucket: 'telemetry', tagCount: 3, fieldCount: 2, series: 8400, lastWrite: '12s ago' },
              ],
              tags: [
                { name: 'host', valueCount: 42, series: 18420, cardinality: 'medium', risk: 'watch' },
              ],
              fields: [
                { name: 'usage_user', type: 'float', unit: '%', measurements: 'cpu', lastValue: '27.4' },
              ],
              diagnostics: [
                { signal: 'Measurement Cardinality', value: 'medium', status: 'healthy', guidance: 'Prefer tag filters.' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('Measurement').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect fields, tags, series cardinality/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Query Measurement' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tags').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Fields').length).toBeGreaterThan(0)
    expect(screen.getByText('usage_user')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Query Measurement' })[0]!)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryTemplate: expect.stringContaining('_measurement == "cpu"'),
    }))
  })

  it('renders OpenTSDB metric metadata as a native time-series workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={openTsdbConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: openTsdbConnection.id,
          family: 'timeseries',
          language: 'json',
          title: 'http.requests',
          objectViewState: {
            connectionId: openTsdbConnection.id,
            environmentId: environment.id,
            nodeId: 'metric:http.requests',
            label: 'http.requests',
            kind: 'metric',
            path: ['Metrics'],
            queryTemplate: JSON.stringify({
              start: '1h-ago',
              queries: [{ metric: 'http.requests', aggregator: 'avg', downsample: '1m-avg', tags: {} }],
            }, null, 2),
            warnings: [],
            payload: {
              engine: 'opentsdb',
              objectView: 'metric',
              metricCount: 3,
              tagKeyCount: 4,
              uidCount: 4,
              writesPerSecond: '4.8k/s',
              queriesPerSecond: '12/s',
              storage: 'HBase',
              metrics: [
                { name: 'http.requests', tags: 5, lastWrite: '12s ago', pointsPerMinute: '18k', cardinality: 'high', uid: '000002' },
              ],
              tags: [
                { name: 'endpoint', valueCount: 128, metricCount: 1, cardinality: 'high', risk: 'expensive' },
              ],
              uidMetadata: [
                { kind: 'metric', name: 'http.requests', uid: '000002', displayName: 'HTTP Requests', description: 'Request count by endpoint.', notes: 'High endpoint cardinality.' },
              ],
              diagnostics: [
                { signal: 'Metric Cardinality', value: 'high', status: 'watch', guidance: 'Use explicit tags and downsampling.' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('OpenTSDB Metric').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect one metric, related tag keys/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Query Metric' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Tags').length).toBeGreaterThan(0)
    expect(screen.getAllByText('UID Metadata').length).toBeGreaterThan(0)
    expect(screen.getByText('endpoint')).toBeInTheDocument()
    expect(screen.getByText('HTTP Requests')).toBeInTheDocument()
    expect(screen.queryByText(/"metric"/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Query Metric' })[0]!)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryTemplate: expect.stringContaining('"metric": "http.requests"'),
    }))
  })

  it('renders Neo4j node label metadata as a native graph workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={neo4jConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: neo4jConnection.id,
          family: 'graph',
          language: 'cypher',
          title: 'Account',
          objectViewState: {
            connectionId: neo4jConnection.id,
            environmentId: environment.id,
            nodeId: 'node-label:Account',
            label: 'Account',
            kind: 'node-label',
            path: ['Node Labels'],
            queryTemplate: 'MATCH (n:`Account`) RETURN n LIMIT 25',
            warnings: [],
            payload: {
              engine: 'neo4j',
              objectView: 'node-label',
              graphName: 'neo4j',
              nodeCount: 18420,
              relationshipCount: 39210,
              labelCount: 3,
              relationshipTypeCount: 3,
              indexCount: 3,
              constraintCount: 3,
              nodeLabels: [
                { label: 'Account', count: 2800, properties: 7, indexedProperties: 'id, email', constraints: 'account_id_unique' },
              ],
              relationshipTypes: [
                { type: 'PLACED', count: 12400, from: 'Account', to: 'Order', properties: 'createdAt, channel' },
              ],
              propertyKeys: [
                { name: 'email', types: 'string', labels: ['Account'], relationshipTypes: [], indexed: 'yes' },
              ],
              indexes: [
                { name: 'account_email_lookup', type: 'range', target: 'Account', properties: 'email', state: 'online', provider: 'native-btree' },
              ],
              constraints: [
                { name: 'account_id_unique', type: 'unique', target: 'Account', properties: 'id', state: 'online' },
              ],
              diagnostics: [
                { signal: 'Label Scan Risk', value: 'medium', status: 'watch', guidance: 'Prefer indexed predicates.' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('Node Label').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect one node label/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Query Nodes' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Relationships').length).toBeGreaterThan(0)
    expect(screen.getByText('account_email_lookup')).toBeInTheDocument()
    expect(screen.getByText('PLACED')).toBeInTheDocument()
    expect(screen.getByText(/JSON array \(1 item\)/)).toBeInTheDocument()
    expect(screen.queryByText(/MATCH \(n/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Query Nodes' })[0]!)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryTemplate: 'MATCH (n:`Account`) RETURN n LIMIT 25',
    }))
  })

  it('renders Snowflake table metadata as a native warehouse workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={snowflakeConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: snowflakeConnection.id,
          family: 'warehouse',
          language: 'snowflake-sql',
          title: 'orders',
          objectViewState: {
            connectionId: snowflakeConnection.id,
            environmentId: environment.id,
            nodeId: 'table:ANALYTICS:orders',
            label: 'orders',
            kind: 'table',
            path: ['Databases', 'ANALYTICS', 'Tables'],
            queryTemplate: 'select * from "ANALYTICS"."orders" limit 100;',
            warnings: [],
            payload: {
              engine: 'snowflake',
              objectView: 'table',
              database: 'ANALYTICS',
              tableCount: 3,
              viewCount: 2,
              storageSize: '420 GB',
              jobCount: 3,
              bytesScanned: '1.8 TB',
              tables: [
                { name: 'orders', schema: 'ANALYTICS', rows: '12.4 M', size: '88 GB', partitioning: 'order_date', clustering: 'customer_id, sku', freshness: '8 min ago' },
              ],
              columns: [
                { name: 'id', type: 'STRING', mode: 'required', nullable: 'no', description: 'Stable business key' },
                { name: 'created_at', type: 'TIMESTAMP', mode: 'nullable', nullable: 'yes', description: 'Event creation time' },
              ],
              security: [
                { principal: 'ANALYST_ROLE', role: 'reader', privilege: 'SELECT', object: 'ANALYTICS', effect: 'allow' },
              ],
              diagnostics: [
                { signal: 'Broad Scan Risk', value: 'watch', status: 'watch', guidance: 'Dry-run broad queries before execution.' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('Warehouse Table').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect columns, partitions, clustering/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Query Table' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Columns').length).toBeGreaterThan(0)
    expect(screen.getByText('created_at')).toBeInTheDocument()
    expect(screen.getByText('ANALYST_ROLE')).toBeInTheDocument()
    expect(screen.queryByText(/select \* from/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Query Table' })[0]!)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryTemplate: 'select * from "ANALYTICS"."orders" limit 100;',
    }))
  })

  it('renders DuckDB table metadata as a native embedded analytics workspace', () => {
    const onOpenQuery = vi.fn()

    render(
      <ObjectViewWorkspace
        connection={duckDbConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: duckDbConnection.id,
          family: 'embedded-olap',
          language: 'sql',
          title: 'orders',
          objectViewState: {
            connectionId: duckDbConnection.id,
            environmentId: environment.id,
            nodeId: 'table:main:orders',
            label: 'orders',
            kind: 'table',
            path: ['main', 'Tables'],
            queryTemplate: 'select * from "main"."orders" limit 100;',
            warnings: [],
            payload: {
              engine: 'duckdb',
              objectView: 'table',
              database: 'datapad.duckdb',
              databaseSize: '86 MB',
              tableCount: 3,
              indexCount: 2,
              extensionCount: 2,
              tables: [
                { schema: 'main', name: 'orders', type: 'BASE TABLE', rows: '1200000', size: '58 MB', owner: 'local' },
              ],
              columns: [
                { name: 'id', type: 'VARCHAR', nullable: 'no', default: '-', identity: 'no', collation: '-' },
                { name: 'created_at', type: 'TIMESTAMP', nullable: 'yes', default: '-', identity: 'no', collation: '-' },
              ],
              indexes: [
                { name: 'orders_id_idx', type: 'ART', columns: 'id', unique: 'yes', valid: 'yes', size: '4 MB', usage: 'lookup' },
              ],
              statistics: [
                { name: 'orders', rows: '1200000', scans: '42', lastAnalyze: 'auto', size: '58 MB' },
              ],
              pragmas: [
                { name: 'memory_limit', value: '80% of system memory', status: 'ok', detail: 'Session memory guardrail' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={onOpenQuery}
      />,
    )

    expect(screen.getAllByText('DuckDB Table').length).toBeGreaterThan(0)
    expect(screen.getByText(/Inspect columns, indexes, constraints/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Open Data Query' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Columns').length).toBeGreaterThan(0)
    expect(screen.getByText('orders_id_idx')).toBeInTheDocument()
    expect(screen.getByText('memory_limit')).toBeInTheDocument()
    expect(screen.queryByText(/select \* from/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Open Data Query' })[0]!)
    expect(onOpenQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryTemplate: 'select * from "main"."orders" limit 100;',
    }))
  })

  it('renders SQL Server Query Store and security surfaces without generic inspection text', () => {
    render(
      <ObjectViewWorkspace
        connection={sqlServerConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: sqlServerConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'Query Store',
          objectViewState: {
            connectionId: sqlServerConnection.id,
            environmentId: environment.id,
            nodeId: 'sqlserver:datapadplusplus:query-store',
            label: 'Query Store',
            kind: 'query-store',
            path: ['Databases', 'datapadplusplus'],
            warnings: [],
            payload: {
              engine: 'sqlserver',
              database: 'datapadplusplus',
              queryStore: [
                {
                  name: 'Top Queries',
                  status: 'available',
                  durationMs: 18,
                  executions: 14,
                  planState: 'not forced',
                  query: 'select * from dbo.accounts where status = @status order by updated_at desc',
                },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Query Store').length).toBeGreaterThan(0)
    expect(screen.getByText(/Review top queries, regressed queries/i)).toBeInTheDocument()
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Waits').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Plans').length).toBeGreaterThan(0)
    expect(screen.getByText('Top Queries')).toBeInTheDocument()
    expect(screen.getByText('18')).toBeInTheDocument()
    expect(screen.getByText(/SELECT statement \(\d+ chars\)/)).toBeInTheDocument()
    expect(screen.queryByText(/select \* from dbo\.accounts/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Open View')).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('keeps SQL Server stored procedure source hidden until the user asks for it', () => {
    const source = [
      'create or alter procedure [dbo].[refresh_account_cache]',
      '  @account_id bigint',
      'as',
      'begin',
      '  select @account_id as account_id;',
      'end;',
    ].join('\n')

    render(
      <ObjectViewWorkspace
        connection={sqlServerConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: sqlServerConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'dbo.refresh_account_cache',
          objectViewState: {
            connectionId: sqlServerConnection.id,
            environmentId: environment.id,
            nodeId: 'procedure:datapadplusplus:dbo:refresh_account_cache',
            label: 'dbo.refresh_account_cache',
            kind: 'procedure',
            path: ['Databases', 'datapadplusplus', 'Stored Procedures'],
            warnings: [],
            payload: {
              engine: 'sqlserver',
              database: 'datapadplusplus',
              schema: 'dbo',
              objectName: 'refresh_account_cache',
              definition: source,
              procedures: [
                {
                  schema: 'dbo',
                  name: 'refresh_account_cache',
                  arguments: '@account_id bigint',
                  language: 'T-SQL',
                  definition: source,
                },
              ],
              permissions: [
                { principal: 'app_executor', privilege: 'EXECUTE', object: 'dbo.refresh_account_cache', state: 'granted' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('Stored Procedure').length).toBeGreaterThan(0)
    expect(screen.getAllByText('T-SQL').length).toBeGreaterThan(0)
    expect(screen.getByText('Source Outline')).toBeInTheDocument()
    expect(screen.queryByText(/select @account_id as account_id/i)).not.toBeInTheDocument()
    expect(screen.getAllByText(/CREATE statement \(\d+ chars\)/).length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Show source' }))
    expect(screen.getByText(/select @account_id as account_id/i)).toBeInTheDocument()
  })

  it('renders CockroachDB cluster diagnostics as a native cluster workspace', () => {
    render(
      <ObjectViewWorkspace
        connection={cockroachConnection}
        environment={environment}
        tab={{
          ...baseObjectViewTab,
          connectionId: cockroachConnection.id,
          family: 'sql',
          language: 'sql',
          title: 'Cluster',
          objectViewState: {
            connectionId: cockroachConnection.id,
            environmentId: environment.id,
            nodeId: 'cockroach:cluster',
            label: 'Cluster',
            kind: 'cluster',
            path: ['Cluster'],
            warnings: [],
            payload: {
              engine: 'cockroachdb',
              nodeCount: 3,
              rangeCount: 184,
              jobCount: 2,
              nodes: [
                { nodeId: 1, address: 'n1.local:26257', locality: 'region=us-east', ranges: 68, liveBytes: '1.4 GB', status: 'live' },
              ],
              ranges: [
                { rangeId: 42, table: 'public.accounts', replicas: '1,2,3', leaseholder: 1, qps: 18, size: '64 MB' },
              ],
              jobs: [
                { id: 901, type: 'SCHEMA CHANGE', status: 'succeeded', fractionCompleted: '100%', created: '2026-05-18' },
              ],
              clusterSettings: [
                { name: 'kv.rangefeed.enabled', value: 'true', type: 'b', description: 'rangefeed support' },
              ],
            },
          },
        }}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getAllByText('CockroachDB Cluster').length).toBeGreaterThan(0)
    expect(screen.getByText(/Review nodes, ranges, regions, jobs/i)).toBeInTheDocument()
    expect(screen.getAllByText('Sessions').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Waits').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Jobs').length).toBeGreaterThan(0)
    expect(screen.getByText('n1.local:26257')).toBeInTheDocument()
    expect(screen.getByText('public.accounts')).toBeInTheDocument()
    expect(screen.getByText('kv.rangefeed.enabled')).toBeInTheDocument()
    expect(screen.queryByText('Open View')).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })
})

function operationPlanResponse(operationId: string): OperationPlanResponse {
  return {
    connectionId: mongoConnection.id,
    environmentId: environment.id,
    plan: {
      operationId,
      engine: 'mongodb',
      summary: `Prepared ${operationId}.`,
      generatedRequest: '{ "ok": 1 }',
      requestLanguage: 'json',
      destructive: operationId.includes('.drop'),
      estimatedCost: 'Preview only.',
      estimatedScanImpact: 'Object scoped.',
      requiredPermissions: ['write/admin privilege for the target object'],
      warnings: ['Preview mode.'],
    },
  }
}

const mongoConnection: ConnectionProfile = {
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
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const redisConnection: ConnectionProfile = {
  id: 'conn-redis',
  name: 'Redis',
  engine: 'redis',
  family: 'keyvalue',
  host: 'localhost',
  port: 6379,
  database: '0',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'redis',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
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

const oracleConnection: ConnectionProfile = {
  id: 'conn-oracle',
  name: 'Oracle',
  engine: 'oracle',
  family: 'sql',
  host: 'localhost',
  port: 1521,
  database: 'FREEPDB1',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: true,
  icon: 'oracle',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'APP' },
  oracleOptions: {
    connectMode: 'service-name',
    serviceName: 'FREEPDB1',
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const postgresConnection: ConnectionProfile = {
  id: 'conn-postgres',
  name: 'PostgreSQL',
  engine: 'postgresql',
  family: 'sql',
  host: 'localhost',
  port: 5432,
  database: 'datapadplusplus',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'postgresql',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'app' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const sqliteConnection: ConnectionProfile = {
  id: 'conn-sqlite',
  name: 'SQLite',
  engine: 'sqlite',
  family: 'sql',
  host: 'localhost',
  port: undefined,
  database: 'datapadplusplus.sqlite',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'sqlite',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const liteDbConnection: ConnectionProfile = {
  id: 'conn-litedb',
  name: 'LiteDB',
  engine: 'litedb',
  family: 'document',
  host: 'tests/fixtures/litedb/catalog.db',
  port: undefined,
  database: 'tests/fixtures/litedb/catalog.db',
  connectionString: undefined,
  connectionMode: 'local-file',
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

const cosmosConnection: ConnectionProfile = {
  id: 'conn-cosmos',
  name: 'Cosmos DB',
  engine: 'cosmosdb',
  family: 'document',
  host: 'datapad-cosmos.documents.azure.com',
  port: 443,
  database: 'catalog',
  connectionString: undefined,
  connectionMode: 'connection-string',
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

const mysqlConnection: ConnectionProfile = {
  id: 'conn-mysql',
  name: 'MySQL',
  engine: 'mysql',
  family: 'sql',
  host: 'localhost',
  port: 3306,
  database: 'datapadplusplus',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'mysql',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'app' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

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
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'elastic' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const dynamoConnection: ConnectionProfile = {
  id: 'conn-dynamodb',
  name: 'DynamoDB',
  engine: 'dynamodb',
  family: 'widecolumn',
  host: 'localhost',
  port: 8000,
  database: 'local',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'dynamodb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'local' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const cassandraConnection: ConnectionProfile = {
  id: 'conn-cassandra',
  name: 'Cassandra',
  engine: 'cassandra',
  family: 'widecolumn',
  host: 'localhost',
  port: 9042,
  database: 'app',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cassandra',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'cassandra' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const prometheusConnection: ConnectionProfile = {
  id: 'conn-prometheus',
  name: 'Prometheus',
  engine: 'prometheus',
  family: 'timeseries',
  host: 'localhost',
  port: 9090,
  database: undefined,
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: true,
  icon: 'prometheus',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const influxConnection: ConnectionProfile = {
  id: 'conn-influxdb',
  name: 'InfluxDB',
  engine: 'influxdb',
  family: 'timeseries',
  host: 'localhost',
  port: 8086,
  database: 'telemetry',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: true,
  icon: 'influxdb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const openTsdbConnection: ConnectionProfile = {
  id: 'conn-opentsdb',
  name: 'OpenTSDB',
  engine: 'opentsdb',
  family: 'timeseries',
  host: 'localhost',
  port: 4242,
  database: undefined,
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: true,
  icon: 'opentsdb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const neo4jConnection: ConnectionProfile = {
  id: 'conn-neo4j',
  name: 'Neo4j',
  engine: 'neo4j',
  family: 'graph',
  host: 'localhost',
  port: 7687,
  database: 'neo4j',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: true,
  icon: 'neo4j',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'neo4j' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const snowflakeConnection: ConnectionProfile = {
  id: 'conn-snowflake',
  name: 'Snowflake',
  engine: 'snowflake',
  family: 'warehouse',
  host: 'account.snowflakecomputing.com',
  port: undefined,
  database: 'ANALYTICS',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: true,
  icon: 'snowflake',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'analyst' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const duckDbConnection: ConnectionProfile = {
  id: 'conn-duckdb',
  name: 'DuckDB',
  engine: 'duckdb',
  family: 'embedded-olap',
  host: 'tests/fixtures/duckdb/datapad.duckdb',
  port: undefined,
  database: 'tests/fixtures/duckdb/datapad.duckdb',
  connectionString: undefined,
  connectionMode: 'local-file',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'duckdb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const cockroachConnection: ConnectionProfile = {
  id: 'conn-cockroach',
  name: 'CockroachDB',
  engine: 'cockroachdb',
  family: 'sql',
  host: 'localhost',
  port: 26257,
  database: 'defaultdb',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'cockroachdb',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'root' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const sqlServerConnection: ConnectionProfile = {
  id: 'conn-sqlserver',
  name: 'SQL Server',
  engine: 'sqlserver',
  family: 'sql',
  host: 'localhost',
  port: 1433,
  database: 'datapadplusplus',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'sqlserver',
  color: undefined,
  group: undefined,
  notes: undefined,
  auth: { username: 'sa' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const environment: EnvironmentProfile = {
  id: 'env-local',
  label: 'Local',
  color: '#5dd6b0',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: false,
  safeMode: false,
  exportable: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const baseObjectViewTab: QueryTabState = {
  id: 'tab-object-view',
  title: 'Object View',
  tabKind: 'object-view',
  connectionId: mongoConnection.id,
  environmentId: environment.id,
  family: 'document',
  language: 'json',
  editorLabel: 'Object view',
  queryText: '',
  status: 'success',
  dirty: false,
  history: [],
}
