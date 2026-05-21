import { describe, expect, it } from 'vitest'
import type { ConnectionProfile, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import { createExplorerNodes, inspectExplorerNodeLocally } from './browser-explorer'

describe('browser explorer runtime', () => {
  it('mirrors the MongoDB native database and collection hierarchy', () => {
    const connection = mongoConnection('catalog')

    expect(createExplorerNodes(connection)).toEqual([
      expect.objectContaining({
        id: 'database:catalog',
        label: 'catalog',
        kind: 'database',
        scope: 'database:catalog',
      }),
    ])

    expect(createExplorerNodes(connection, 'database:catalog').map((node) => node.label)).toEqual([
      'Collections',
      'Views',
      'Time Series Collections',
      'Capped Collections',
      'GridFS',
      'Search Indexes',
      'Vector Indexes',
      'Users',
      'Roles',
      'Database Statistics',
    ])

    const collectionChildren = createExplorerNodes(connection, 'collection:catalog:products')
    expect(collectionChildren.map((node) => node.label)).toEqual([
      'Documents',
      'Schema Preview',
      'Indexes',
      'Validation Rules',
      'Aggregations',
      'Statistics',
      'Permissions',
      'Scripts',
    ])
    expect(collectionChildren.map((node) => node.label)).not.toContain('Sample documents')
  })

  it('separates Mongo system databases when no database is selected', () => {
    const nodes = createExplorerNodes(mongoConnection(undefined))

    expect(nodes).toEqual([
      expect.objectContaining({
        label: 'Databases',
        scope: 'databases',
      }),
      expect.objectContaining({
        label: 'System Databases',
        scope: 'system-databases',
      }),
    ])

    expect(createExplorerNodes(mongoConnection(undefined), 'databases')).toEqual([
      expect.objectContaining({
        label: 'catalog',
        scope: 'database:catalog',
      }),
    ])

    expect(createExplorerNodes(mongoConnection(undefined), 'system-databases')).toEqual([
      expect.objectContaining({ label: 'admin', path: ['System Databases'] }),
      expect.objectContaining({ label: 'config', path: ['System Databases'] }),
      expect.objectContaining({ label: 'local', path: ['System Databases'] }),
    ])
  })

  it('returns focused Mongo inspection payloads for admin nodes', () => {
    const connection = mongoConnection('catalog')
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'indexes:catalog:products',
    })

    expect(response.queryTemplate).toContain('"listIndexes": "products"')
    expect(response.payload).toMatchObject({
      database: 'catalog',
      collection: 'products',
      indexes: [
        expect.objectContaining({ name: '_id_' }),
        expect.objectContaining({ name: 'sku_1' }),
      ],
    })
  })

  it('mirrors the Oracle enterprise object hierarchy without live dependencies', () => {
    const connection = oracleConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'FREEPDB1',
      'Schemas',
      'Security',
      'Storage',
      'Performance',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'oracle:schemas')).toEqual([
      expect.objectContaining({
        label: 'APP',
        kind: 'schema',
        scope: 'oracle:schema:APP',
      }),
    ])

    const schemaChildren = createExplorerNodes(connection, 'oracle:schema:APP')
    expect(schemaChildren.map((node) => node.label)).toEqual([
      'Tables',
      'Views',
      'Materialized Views',
      'Synonyms',
      'Sequences',
      'Functions',
      'Procedures',
      'Packages',
      'Types',
      'JSON Collections',
      'External Tables',
      'Database Links',
    ])
  })

  it('returns Oracle inspection payloads that purpose-built views can render', () => {
    const connection = oracleConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'oracle-performance',
    })

    expect(response.queryTemplate).toContain('v$session')
    expect(response.payload).toMatchObject({
      engine: 'oracle',
      service: 'FREEPDB1',
      activeSessions: 3,
      sessions: expect.arrayContaining([expect.objectContaining({ status: 'ACTIVE' })]),
    })
    expect(response.payload).not.toHaveProperty('metadataViews')
    expect(response.payload).not.toHaveProperty('permissionSensitiveViews')
    expect(response.payload).not.toHaveProperty('objectViews')
  })
})

function mongoConnection(database: string | undefined): ConnectionProfile {
  return {
    id: 'conn-mongo',
    name: 'Mongo',
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

function oracleConnection(): ConnectionProfile {
  return {
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
}
