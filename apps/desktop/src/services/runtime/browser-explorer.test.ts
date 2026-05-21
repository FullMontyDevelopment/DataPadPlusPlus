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

  it('mirrors a PostgreSQL schema-first tree without live dependencies', () => {
    const connection = postgresConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'public',
      'observability',
      'pg_catalog',
      'Security',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'schema:public').map((node) => node.label)).toEqual([
      'Tables',
      'Views',
      'Materialized Views',
      'Indexes',
      'Functions',
      'Procedures',
      'Sequences',
      'Types',
    ])

    expect(createExplorerNodes(connection, 'postgres:public:tables')).toEqual([
      expect.objectContaining({
        label: 'accounts',
        kind: 'table',
        scope: 'table:public.accounts',
        queryTemplate: 'select * from "public"."accounts" limit 100;',
      }),
      expect.objectContaining({
        label: 'orders',
        kind: 'table',
        scope: 'table:public.orders',
      }),
      expect.objectContaining({
        label: 'products',
        kind: 'table',
        scope: 'table:public.products',
      }),
    ])

    expect(createExplorerNodes(connection, 'table:public.accounts').map((node) => node.label)).toEqual([
      'Columns',
      'Indexes',
      'Constraints',
      'Triggers',
      'Statistics',
      'Permissions',
      'Definition',
    ])
  })

  it('returns PostgreSQL inspection payloads for table and diagnostics object views', () => {
    const connection = postgresConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const tableResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'table:public.accounts',
    })

    expect(tableResponse.queryTemplate).toBe('select * from "public"."accounts" limit 100;')
    expect(tableResponse.payload).toMatchObject({
      engine: 'postgresql',
      schema: 'public',
      objectName: 'accounts',
      columns: expect.arrayContaining([expect.objectContaining({ name: 'id' })]),
      indexes: expect.arrayContaining([expect.objectContaining({ name: 'accounts_pkey' })]),
    })

    const diagnosticsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'postgres:diagnostics',
    })

    expect(diagnosticsResponse.payload).toMatchObject({
      engine: 'postgresql',
      activeSessions: 4,
      sessions: expect.arrayContaining([expect.objectContaining({ state: 'active' })]),
    })
  })

  it('mirrors a CockroachDB database and cluster tree without live dependencies', () => {
    const connection = cockroachConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'defaultdb',
      'Cluster',
      'Security',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'database:defaultdb').map((node) => node.label)).toEqual([
      'public',
      'crdb_internal',
      'pg_catalog',
    ])

    expect(createExplorerNodes(connection, 'schema:public').map((node) => node.label)).toEqual([
      'Tables',
      'Views',
      'Indexes',
      'Sequences',
      'Types',
      'Functions',
      'Zone Configurations',
    ])

    expect(createExplorerNodes(connection, 'cockroach:cluster').map((node) => node.label)).toEqual([
      'Nodes',
      'Ranges',
      'Regions / Localities',
      'Jobs',
      'Cluster Settings',
    ])

    expect(createExplorerNodes(connection, 'cockroach:diagnostics').map((node) => node.label)).toEqual([
      'Sessions',
      'Statement Stats',
      'Transactions',
      'Contention',
      'Locks',
      'Statistics',
    ])
  })

  it('returns CockroachDB inspection payloads for cluster object views', () => {
    const connection = cockroachConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const clusterResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cockroach:cluster',
    })

    expect(clusterResponse.queryTemplate).toBe('select * from crdb_internal.gossip_nodes limit 100;')
    expect(clusterResponse.payload).toMatchObject({
      engine: 'cockroachdb',
      nodeCount: 3,
      rangeCount: 184,
      nodes: expect.arrayContaining([expect.objectContaining({ nodeId: 1 })]),
      ranges: expect.arrayContaining([expect.objectContaining({ rangeId: 42 })]),
      clusterSettings: expect.arrayContaining([expect.objectContaining({ name: 'kv.rangefeed.enabled' })]),
    })

    const diagnosticsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cockroach:diagnostics',
    })

    expect(diagnosticsResponse.payload).toMatchObject({
      engine: 'cockroachdb',
      activeSessions: 5,
      statements: expect.arrayContaining([expect.objectContaining({ retries: 1 })]),
      contention: expect.arrayContaining([expect.objectContaining({ durationMs: 18 })]),
    })
  })

  it('mirrors an SSMS-style SQL Server tree without live dependencies', () => {
    const connection = sqlServerConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'master',
      'model',
      'msdb',
      'tempdb',
      'datapadplusplus',
    ])

    expect(createExplorerNodes(connection, 'database:datapadplusplus').map((node) => node.label)).toEqual([
      'Tables',
      'Views',
      'Stored Procedures',
      'Functions',
      'Synonyms',
      'Sequences',
      'Types',
      'Security',
      'Query Store',
      'Storage',
      'Extended Events',
      'Agent',
    ])

    expect(createExplorerNodes(connection, 'sqlserver:datapadplusplus:tables')).toEqual([
      expect.objectContaining({
        label: 'dbo.accounts',
        kind: 'table',
        scope: 'table:datapadplusplus:dbo:accounts',
        queryTemplate: 'use [datapadplusplus];\nselect top 100 * from [dbo].[accounts];',
      }),
      expect.objectContaining({ label: 'dbo.orders', kind: 'table' }),
      expect.objectContaining({ label: 'dbo.products', kind: 'table' }),
    ])
  })

  it('returns SQL Server inspection payloads for object-view workspaces', () => {
    const connection = sqlServerConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const tableResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'table:datapadplusplus:dbo:accounts',
    })

    expect(tableResponse.queryTemplate).toBe('use [datapadplusplus];\nselect top 100 * from [dbo].[accounts];')
    expect(tableResponse.payload).toMatchObject({
      engine: 'sqlserver',
      database: 'datapadplusplus',
      schema: 'dbo',
      objectName: 'accounts',
      columns: expect.arrayContaining([expect.objectContaining({ name: 'id' })]),
    })

    const queryStoreResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'query-store:datapadplusplus:top',
    })

    expect(queryStoreResponse.payload).toMatchObject({
      engine: 'sqlserver',
      database: 'datapadplusplus',
      queryStore: expect.arrayContaining([expect.objectContaining({ name: 'Top Queries' })]),
    })
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

function postgresConnection(): ConnectionProfile {
  return {
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
}

function cockroachConnection(): ConnectionProfile {
  return {
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
}

function sqlServerConnection(): ConnectionProfile {
  return {
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
}
