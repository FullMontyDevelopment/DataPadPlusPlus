import { describe, expect, it } from 'vitest'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { createMongoExplorerNodes } from '../../../../../src/services/runtime/datastores/mongodb/browser-mongo-explorer'
import { mongoInspectPayload } from '../../../../../src/services/runtime/datastores/mongodb/browser-mongo-payloads'
import { mongoInspectQueryTemplate } from '../../../../../src/services/runtime/datastores/mongodb/browser-mongo-query-templates'

describe('browser Mongo explorer slice', () => {
  it('renders native database roots without forcing a selected database', () => {
    const connection = mongoConnection(undefined)

    expect(createMongoExplorerNodes(connection)).toEqual([
      expect.objectContaining({ label: 'Databases', scope: 'databases' }),
      expect.objectContaining({ label: 'System Databases', scope: 'system-databases' }),
    ])

    expect(createMongoExplorerNodes(connection, 'system-databases')).toEqual([
      expect.objectContaining({ label: 'admin', path: ['System Databases'] }),
      expect.objectContaining({ label: 'config', path: ['System Databases'] }),
      expect.objectContaining({ label: 'local', path: ['System Databases'] }),
    ])
    expect(mongoInspectPayload(mongoConnection('catalog'), 'databases')).toMatchObject({
      objectView: 'databases',
      databases: [expect.objectContaining({ name: 'catalog', type: 'User' })],
    })
    expect(mongoInspectQueryTemplate(connection, 'databases')).toContain('"listDatabases": 1')
  })

  it('renders only available database sections and collection management children', () => {
    expect(createMongoExplorerNodes(mongoConnection('catalog'), 'database:catalog').map((node) => node.label)).toEqual([
      'Collections',
      'Views',
      'GridFS',
      'Users',
      'Roles',
      'Database Statistics',
    ])

    const children = createMongoExplorerNodes(mongoConnection('catalog'), 'collection:catalog:products')

    expect(children.map((node) => node.label)).toEqual([
      'Documents',
      'Schema Preview',
      'Indexes',
      'Validation Rules',
      'Aggregations',
      'Statistics',
      'Permissions',
      'Scripts',
    ])
    expect(children.map((node) => node.label)).not.toContain('Sample Documents')
    expect(children.map((node) => node.label)).not.toContain('Search Indexes')
    expect(children.find((node) => node.label === 'Documents')).toEqual(expect.objectContaining({
      queryTemplate: expect.stringContaining('"collection": "products"'),
    }))
  })

  it('does not create fake Mongo object children for incomplete scopes', () => {
    const connection = mongoConnection(undefined)

    expect(createMongoExplorerNodes(connection, 'databases')).toEqual([])
    expect(createMongoExplorerNodes(connection, 'collection:')).toEqual([])
    expect(createMongoExplorerNodes(connection, 'view:')).toEqual([])
    expect(createMongoExplorerNodes(connection, 'indexes:')).toEqual([])
  })

  it('uses production view result labels instead of sample result nodes', () => {
    const nodes = createMongoExplorerNodes(mongoConnection('catalog'), 'view:catalog:active_products')

    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'view-results:catalog:active_products',
        label: 'Results Preview',
        kind: 'view-results',
      }),
    ]))
    expect(nodes.map((node) => node.kind)).not.toContain('sample-results')
    expect(nodes.map((node) => node.label)).not.toContain('Sample Results')
  })

  it('generates focused Mongo query templates for object views', () => {
    const connection = mongoConnection('catalog')

    expect(mongoInspectQueryTemplate(connection, 'indexes:catalog:products')).toContain('"listIndexes": "products"')
    expect(mongoInspectQueryTemplate(connection, 'collection-statistics:catalog:products')).toContain('"collStats": "products"')
    expect(mongoInspectQueryTemplate(connection, 'schema-preview:catalog:products')).toContain('"limit": 20')
    expect(mongoInspectQueryTemplate(connection, 'collection-scripts:catalog:products')).toBe('db.products.find({}).limit(20)')
  })

  it('returns purpose-built payloads for schema, index, insert, users, and stats views', () => {
    const connection = mongoConnection('catalog')

    expect(mongoInspectPayload(connection, 'schema-preview:catalog:products')).toMatchObject({
      database: 'catalog',
      collection: 'products',
      fields: expect.arrayContaining([
        expect.objectContaining({ path: 'inventory.available' }),
      ]),
    })

    expect(mongoInspectPayload(connection, 'indexes:catalog:products')).toMatchObject({
      indexes: expect.arrayContaining([expect.objectContaining({ name: 'sku_1' })]),
    })

    expect(mongoInspectPayload(connection, 'insert-document:catalog:products')).toMatchObject({
      validator: expect.objectContaining({
        $jsonSchema: expect.objectContaining({ required: ['sku'] }),
      }),
    })

    expect(mongoInspectPayload(connection, 'users:catalog')).toMatchObject({
      users: expect.arrayContaining([expect.objectContaining({ user: 'fixture_reader' })]),
    })

    expect(mongoInspectPayload(connection, 'database-statistics:catalog')).toMatchObject({
      collections: 4,
      indexes: 11,
    })
  })

  it('returns empty Mongo payloads for malformed object scopes', () => {
    const payload = mongoInspectPayload(mongoConnection(undefined), 'indexes:')

    expect(payload).toMatchObject({
      database: '',
      objectView: 'indexes',
      indexes: [],
      warnings: expect.arrayContaining([
        'Select a MongoDB object or refresh metadata to inspect this view.',
      ]),
    })
    expect(JSON.stringify(payload)).not.toContain('products')
    expect(mongoInspectQueryTemplate(mongoConnection(undefined), 'indexes:')).not.toContain('products')
  })
})

function mongoConnection(database: string | undefined): ConnectionProfile {
  return {
    id: 'conn-mongo',
    name: 'MongoDB',
    engine: 'mongodb',
    family: 'document',
    host: 'localhost',
    port: 27017,
    database,
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
}
