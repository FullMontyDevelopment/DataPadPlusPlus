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
      'GridFS',
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

    expect(createExplorerNodes(mongoConnection(undefined), 'databases')).toEqual([])

    expect(createExplorerNodes(mongoConnection(undefined), 'system-databases')).toEqual([
      expect.objectContaining({ label: 'admin', path: ['System Databases'] }),
      expect.objectContaining({ label: 'config', path: ['System Databases'] }),
      expect.objectContaining({ label: 'local', path: ['System Databases'] }),
    ])
  })

  it('does not invent sample nodes for unimplemented preview families', () => {
    const documentNodes = createExplorerNodes(genericPreviewConnection('arango', 'document'))
    const keyValueNodes = createExplorerNodes(genericPreviewConnection('neptune', 'keyvalue'))
    const sqlNodes = createExplorerNodes(genericPreviewConnection('bigquery', 'sql'))

    expect(documentNodes).toEqual([])
    expect(keyValueNodes).toEqual([])
    expect(sqlNodes).toEqual([])
    expect(createExplorerNodes(genericPreviewConnection('bigquery', 'sql'), 'schema:public')).toEqual([])
    expect(createExplorerNodes(genericPreviewConnection('neptune', 'keyvalue'), 'prefix:session:')).toEqual([])
  })

  it('does not invent sample inspection payloads for unimplemented preview families', () => {
    const connection = genericPreviewConnection('arango', 'document')
    const response = inspectExplorerNodeLocally({
      connections: [connection],
    } as WorkspaceSnapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'collection:catalog:products',
    })

    expect(response.queryTemplate).toBeUndefined()
    expect(response.payload).toEqual(expect.objectContaining({
      objectView: 'unavailable',
      warnings: ['Preview metadata is not available for this datastore adapter yet.'],
    }))
    expect(JSON.stringify(response.payload)).not.toContain('sku')
    expect(JSON.stringify(response.payload)).not.toContain('userId')
    expect(JSON.stringify(response.payload)).not.toContain('updated_at')
  })

  it('returns focused Mongo inspection payloads for admin nodes', () => {
    const connection = mongoConnection('catalog')
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const databaseResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'database:catalog',
    })

    expect(databaseResponse.payload).toMatchObject({
      database: 'catalog',
      collections: expect.arrayContaining([expect.objectContaining({ name: 'products' })]),
      views: expect.arrayContaining([expect.objectContaining({ name: 'active_products' })]),
      gridfsBuckets: expect.arrayContaining([expect.objectContaining({ name: 'fs' })]),
    })

    const collectionResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'collection:catalog:products',
    })

    expect(collectionResponse.payload).toMatchObject({
      database: 'catalog',
      collection: 'products',
      indexes: expect.arrayContaining([expect.objectContaining({ name: 'sku_1' })]),
      sampleDocuments: expect.arrayContaining([expect.objectContaining({ sku: 'luna-lamp' })]),
    })

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

    const createIndexResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'create-index:catalog:products',
    })

    expect(createIndexResponse.queryTemplate).toContain('"listIndexes": "products"')
    expect(createIndexResponse.payload).toMatchObject({
      database: 'catalog',
      collection: 'products',
      indexes: expect.arrayContaining([expect.objectContaining({ name: 'sku_1' })]),
    })

    const insertDocumentResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'insert-document:catalog:products',
    })

    expect(insertDocumentResponse.payload).toMatchObject({
      database: 'catalog',
      collection: 'products',
      validator: expect.objectContaining({
        $jsonSchema: expect.objectContaining({
          required: ['sku'],
        }),
      }),
    })

    const schemaResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'schema-preview:catalog:products',
    })

    expect(schemaResponse.payload).toMatchObject({
      database: 'catalog',
      collection: 'products',
      sampleSize: 20,
      fields: expect.arrayContaining([
        expect.objectContaining({
          path: 'inventory.available',
          typeDistribution: expect.objectContaining({ int32: 18, int64: 2 }),
        }),
      ]),
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
      'Extensions',
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

    expect(createExplorerNodes(connection, 'postgres:security').map((node) => node.label)).toEqual([
      'Roles',
      'Permissions',
      'Role Memberships',
      'Default Privileges',
    ])
  })

  it('returns PostgreSQL inspection payloads for table, security, extensions, and diagnostics object views', () => {
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
      permissions: expect.arrayContaining([expect.objectContaining({ objectKind: 'relation', grantable: false })]),
    })

    const securityResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'postgres:security',
    })

    expect(securityResponse.queryTemplate).toContain('pg_auth_members')
    expect(securityResponse.queryTemplate).toContain('pg_default_acl')
    expect(securityResponse.payload).toMatchObject({
      roles: expect.arrayContaining([expect.objectContaining({ name: 'app', createRole: false })]),
      permissions: expect.arrayContaining([expect.objectContaining({ objectKind: 'schema', grantable: true })]),
      roleMemberships: [expect.objectContaining({ role: 'app', memberOf: 'reporting' })],
      defaultPrivileges: [expect.objectContaining({ objectKind: 'tables', privilege: 'SELECT' })],
    })

    const extensionResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'extension:public:uuid-ossp',
    })

    expect(extensionResponse.queryTemplate).toContain('pg_available_extensions')
    expect(extensionResponse.payload).toMatchObject({
      objectView: 'extension',
      extensions: [expect.objectContaining({ name: 'uuid-ossp', updateAvailable: true })],
      extensionObjects: [expect.objectContaining({ object: 'function uuid_generate_v4()' })],
    })

    const diagnosticsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'postgres:diagnostics',
    })

    expect(createExplorerNodes(connection, 'postgres:diagnostics').map((node) => node.label)).toEqual([
      'Sessions',
      'Locks',
      'Wait Events',
      'Statement Stats',
      'Relation Statistics',
      'Index Health',
    ])

    expect(diagnosticsResponse.payload).toMatchObject({
      engine: 'postgresql',
      activeSessions: 4,
      sessions: expect.arrayContaining([expect.objectContaining({ state: 'active' })]),
      waits: expect.arrayContaining([expect.objectContaining({ waitType: 'CPU' })]),
      statements: expect.arrayContaining([expect.objectContaining({ meanMs: 3.4 })]),
      indexHealth: expect.arrayContaining([expect.objectContaining({ index: 'orders_updated_at_idx' })]),
    })

    const statementsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'postgres:diagnostics:statements',
    })
    expect(statementsResponse.queryTemplate).toContain('pg_stat_statements')
  })

  it('returns PostgreSQL routine source payloads for native source previews', () => {
    const connection = postgresConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const functionResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'function:public:account_status',
    })

    expect(functionResponse.queryTemplate).toContain('pg_get_functiondef')
    expect(functionResponse.payload).toMatchObject({
      engine: 'postgresql',
      schema: 'public',
      objectName: 'account_status',
      definition: expect.stringContaining('create or replace function'),
      functions: [
        expect.objectContaining({
          name: 'account_status',
          language: 'plpgsql',
          definition: expect.stringContaining("return 'active'"),
        }),
      ],
      parameters: [expect.objectContaining({ name: 'p_account_id', type: 'bigint' })],
      permissions: [expect.objectContaining({ privilege: 'EXECUTE' })],
    })

    const procedureResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'procedure:public:refresh_rollups',
    })

    expect(procedureResponse.payload).toMatchObject({
      engine: 'postgresql',
      objectName: 'refresh_rollups',
      definition: expect.stringContaining('create or replace procedure'),
      procedures: [
        expect.objectContaining({
          name: 'refresh_rollups',
          definition: expect.stringContaining('refresh materialized view'),
        }),
      ],
    })
  })

  it('mirrors TimescaleDB native time-series branches without live dependencies', () => {
    const connection = timescaleConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'public',
      'observability',
      'pg_catalog',
      'Hypertables',
      'Continuous Aggregates',
      'Jobs',
      'Diagnostics',
      'Security',
    ])

    expect(createExplorerNodes(connection, 'timescale:hypertables')).toEqual([
      expect.objectContaining({
        label: 'public.order_metrics',
        kind: 'hypertable',
        scope: 'hypertable:public:order_metrics',
        queryTemplate: 'select * from "public"."order_metrics" limit 100;',
      }),
      expect.objectContaining({
        label: 'observability.cpu_metrics',
        kind: 'hypertable',
      }),
    ])

    expect(createExplorerNodes(connection, 'hypertable:public:order_metrics').map((node) => node.label)).toEqual([
      'Chunks',
      'Compression',
      'Retention Policy',
      'Indexes',
      'Statistics',
    ])

    expect(createExplorerNodes(connection, 'timescale:continuous-aggregates').map((node) => node.label)).toEqual([
      'observability.hourly_order_metrics',
      'observability.daily_cpu_metrics',
    ])
  })

  it('returns TimescaleDB inspection payloads for hypertables, chunks, policies, and aggregates', () => {
    const connection = timescaleConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const hypertableResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'hypertable:public:order_metrics',
    })

    expect(hypertableResponse.queryTemplate).toBe('select * from "public"."order_metrics" limit 100;')
    expect(hypertableResponse.payload).toMatchObject({
      engine: 'timescaledb',
      tableName: 'order_metrics',
      timescaleProfile: expect.objectContaining({
        deploymentMode: 'self-hosted',
        policyExecution: 'Preview only',
      }),
      hypertables: expect.arrayContaining([expect.objectContaining({ name: 'order_metrics' })]),
      chunks: expect.arrayContaining([expect.objectContaining({ chunk: '_hyper_1_42_chunk' })]),
      compressionPolicies: expect.arrayContaining([expect.objectContaining({ policy: 'compress after 7 days' })]),
      retentionPolicies: expect.arrayContaining([expect.objectContaining({ window: '90 days' })]),
    })

    const aggregateResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'continuous-aggregate:observability:hourly_order_metrics',
    })

    expect(aggregateResponse.payload).toMatchObject({
      engine: 'timescaledb',
      viewName: 'hourly_order_metrics',
      continuousAggregates: expect.arrayContaining([expect.objectContaining({ bucket: '1 hour' })]),
    })

    const diagnosticsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'timescale:diagnostics',
    })

    expect(diagnosticsResponse.queryTemplate).toContain('timescaledb_information.chunks')
    expect(diagnosticsResponse.payload).toMatchObject({
      hypertableCount: 2,
      chunkCount: 3,
      jobs: expect.arrayContaining([expect.objectContaining({ jobType: 'compression policy' })]),
      diagnostics: expect.arrayContaining([expect.objectContaining({ signal: 'Compression Coverage' })]),
    })
  })

  it('returns TimescaleDB restricted payload warnings when profile capabilities are disabled', () => {
    const connection = {
      ...timescaleConnection(),
      postgresOptions: {
        timescaleCapabilities: {
          inspectCompression: false,
          inspectJobs: false,
        },
      },
    }
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const compressionResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'compression:public:order_metrics',
    })
    expect(compressionResponse.payload).toMatchObject({
      objectView: 'restricted',
      disabledReason: expect.stringContaining('compression metadata is hidden'),
      objects: [],
    })

    const jobsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'timescale:jobs',
    })
    expect(jobsResponse.payload).toMatchObject({
      objectView: 'restricted',
      disabledReason: expect.stringContaining('job metadata is hidden'),
      objects: [],
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

  it('hides CockroachDB profile-restricted cluster and diagnostic surfaces', () => {
    const connection: ConnectionProfile = {
      ...cockroachConnection(),
      postgresOptions: {
        cockroachCapabilities: {
          inspectJobs: true,
          inspectRanges: false,
          inspectRegions: true,
          inspectClusterStatus: true,
          inspectClusterSettings: false,
          inspectSessions: true,
          inspectContention: false,
          inspectRolesAndGrants: true,
          inspectCertificates: false,
          inspectZoneConfigurations: true,
          explainAnalyze: false,
        },
      },
    }
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    expect(createExplorerNodes(connection, 'cockroach:cluster').map((node) => node.label)).toEqual([
      'Nodes',
      'Regions / Localities',
      'Jobs',
    ])
    expect(createExplorerNodes(connection, 'cockroach:diagnostics').map((node) => node.label)).toEqual([
      'Sessions',
    ])
    expect(createExplorerNodes(connection, 'cockroach:security').map((node) => node.label)).toEqual([
      'Roles',
      'Grants',
    ])

    const rangesResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cockroach:ranges',
    })

    expect(rangesResponse.queryTemplate).toBeUndefined()
    expect(rangesResponse.payload).toMatchObject({
      engine: 'cockroachdb',
      objectView: 'restricted',
      disabledReason: expect.stringContaining('range metadata'),
      warnings: [expect.stringContaining('range metadata')],
    })

    const clusterResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cockroach:cluster',
    })

    expect(clusterResponse.payload).toMatchObject({
      engine: 'cockroachdb',
      nodeCount: 3,
      regionCount: 2,
      jobCount: 3,
      warnings: expect.arrayContaining([
        expect.stringContaining('range metadata'),
        expect.stringContaining('cluster settings'),
      ]),
    })
    expect(clusterResponse.payload).not.toHaveProperty('ranges')
    expect(clusterResponse.payload).not.toHaveProperty('clusterSettings')
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

  it('returns focused CockroachDB distributed payloads for specific cluster nodes', () => {
    const connection = cockroachConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const rangesResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cockroach:ranges',
    })

    expect(rangesResponse.queryTemplate).toBe('select * from crdb_internal.ranges_no_leases limit 100;')
    expect(rangesResponse.payload).toMatchObject({
      engine: 'cockroachdb',
      rangeCount: 184,
      ranges: expect.arrayContaining([expect.objectContaining({ rangeId: 42 })]),
    })
    expect(rangesResponse.payload).not.toHaveProperty('tables')

    const regionsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cockroach:regions',
    })

    expect(regionsResponse.queryTemplate).toContain('show regions')
    expect(regionsResponse.payload).toMatchObject({
      engine: 'cockroachdb',
      regions: expect.arrayContaining([expect.objectContaining({ region: 'us-east' })]),
      nodes: expect.arrayContaining([expect.objectContaining({ locality: 'region=us-east,az=a' })]),
    })

    const contentionResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cockroach:contention',
    })

    expect(contentionResponse.queryTemplate).toContain('cluster_contention_events')
    expect(contentionResponse.payload).toMatchObject({
      engine: 'cockroachdb',
      blockedSessions: 1,
      locks: expect.arrayContaining([expect.objectContaining({ object: 'public.accounts' })]),
      contention: expect.arrayContaining([expect.objectContaining({ durationMs: 18 })]),
    })

    const securityResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cockroach:security:grants',
    })

    expect(securityResponse.queryTemplate).toBe('show roles;')
    expect(securityResponse.payload).toMatchObject({
      engine: 'cockroachdb',
      roles: expect.arrayContaining([expect.objectContaining({ name: 'root' })]),
      defaultPrivileges: expect.arrayContaining([expect.objectContaining({ state: 'default' })]),
      certificates: expect.arrayContaining([expect.objectContaining({ subject: 'CN=node' })]),
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
      'Performance',
      'Storage',
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

    const performanceResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'performance:datapadplusplus:sessions',
    })

    expect(performanceResponse.payload).toMatchObject({
      engine: 'sqlserver',
      database: 'datapadplusplus',
      sessions: expect.arrayContaining([expect.objectContaining({ sessionId: 52 })]),
      waits: expect.arrayContaining([expect.objectContaining({ waitType: 'PAGEIOLATCH_SH' })]),
      missingIndexes: expect.arrayContaining([expect.objectContaining({ table: 'dbo.orders' })]),
    })
  })

  it('returns SQL Server routine source payloads for native source previews', () => {
    const connection = sqlServerConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const procedureResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'procedure:datapadplusplus:dbo:refresh_account_cache',
    })

    expect(procedureResponse.queryTemplate).toContain('sys.sql_modules')
    expect(procedureResponse.payload).toMatchObject({
      engine: 'sqlserver',
      database: 'datapadplusplus',
      schema: 'dbo',
      objectName: 'refresh_account_cache',
      definition: expect.stringContaining('create or alter procedure'),
      procedures: [
        expect.objectContaining({
          name: 'refresh_account_cache',
          language: 'T-SQL',
          definition: expect.stringContaining('set nocount on'),
        }),
      ],
      permissions: [expect.objectContaining({ privilege: 'EXECUTE' })],
    })

    const functionResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'function:datapadplusplus:dbo:account_status',
    })

    expect(functionResponse.payload).toMatchObject({
      engine: 'sqlserver',
      objectName: 'account_status',
      definition: expect.stringContaining('create or alter function'),
      functions: [
        expect.objectContaining({
          name: 'account_status',
          returns: 'nvarchar(32)',
        }),
      ],
    })
  })

  it('returns SQLite tree and inspection payloads for native object views', () => {
    const connection = sqliteConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'Main Database',
    ])

    expect(createExplorerNodes(connection, 'database:main').map((node) => node.label)).toEqual([
      'Tables',
      'Views',
      'Indexes',
      'Triggers',
      'Maintenance',
    ])

    const tableResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'table:main:accounts',
    })
    expect(tableResponse.queryTemplate).toBe('select * from [main].[accounts] limit 100;')
    expect(tableResponse.payload).toMatchObject({
      engine: 'sqlite',
      schema: 'main',
      objectName: 'accounts',
      columns: expect.arrayContaining([expect.objectContaining({ name: 'id' })]),
      indexes: expect.arrayContaining([expect.objectContaining({ name: 'accounts_pkey' })]),
    })
    expect(tableResponse.payload).not.toHaveProperty('pragmas')

    const pragmaResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'pragma:main:quick_check',
    })
    expect(pragmaResponse.payload).toMatchObject({
      engine: 'sqlite',
      objectView: 'pragma',
      pragmas: [expect.objectContaining({ name: 'quick_check', value: 'ok' })],
      checks: [expect.objectContaining({ status: 'ok' })],
    })
    expect(JSON.stringify(pragmaResponse.payload)).not.toContain('PRAGMA quick_check')

    const maintenanceResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'maintenance:main',
    })
    expect(maintenanceResponse.payload).toMatchObject({
      engine: 'sqlite',
      objectView: 'maintenance',
      quickCheckStatus: 'ok',
      checks: expect.arrayContaining([expect.objectContaining({ name: 'quick_check' })]),
      maintenance: expect.arrayContaining([expect.objectContaining({ name: 'Vacuum', status: 'preview' })]),
    })
  })

  it('returns LiteDB local-file tree and object-view payloads without generic document clutter', () => {
    const connection = liteDbConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'catalog.db',
      'Diagnostics',
    ])
    expect(createExplorerNodes(connection).map((node) => node.label)).not.toContain('Security')

    expect(createExplorerNodes(connection, 'litedb:database').map((node) => node.label)).toEqual([
      'Collections',
      'Indexes',
      'File Storage',
      'Storage',
      'Pragmas',
      'Maintenance',
    ])

    expect(createExplorerNodes(connection, 'litedb:collections')).toEqual([
      expect.objectContaining({
        id: 'litedb:collection:products',
        label: 'products',
        kind: 'collection',
        queryTemplate: expect.stringContaining('"collection": "products"'),
      }),
      expect.objectContaining({ label: 'accounts' }),
      expect.objectContaining({ label: 'auditLog' }),
    ])

    expect(createExplorerNodes(connection, 'litedb:collection:products').map((node) => node.label)).toEqual([
      'Documents',
      'Schema Preview',
      'Indexes',
      'Statistics',
      'Storage',
    ])

    expect(createExplorerNodes(connection, 'litedb:collection-indexes:products')).toEqual([
      expect.objectContaining({
        id: 'litedb:index:products:_id',
        label: 'products._id',
        kind: 'index',
      }),
      expect.objectContaining({ label: 'products.sku' }),
      expect.objectContaining({ label: 'products.inventory_available' }),
    ])

    const collectionResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'litedb:collection:products',
    })

    expect(collectionResponse.queryTemplate).toContain('"collection": "products"')
    expect(collectionResponse.payload).toMatchObject({
      engine: 'litedb',
      objectView: 'collection',
      collection: 'products',
      fields: expect.arrayContaining([expect.objectContaining({ path: 'sku' })]),
      indexes: expect.arrayContaining([expect.objectContaining({ name: 'sku' })]),
      statistics: expect.arrayContaining([expect.objectContaining({ name: 'Documents' })]),
    })
    expect(collectionResponse.payload).not.toHaveProperty('command')
    expect(collectionResponse.payload).not.toHaveProperty('raw')

    const statisticsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'litedb:collection-statistics:products',
    })

    expect(statisticsResponse.queryTemplate).toContain('"operation": "Statistics"')
    expect(statisticsResponse.payload).toMatchObject({
      objectView: 'statistics',
      statistics: expect.arrayContaining([expect.objectContaining({ name: 'Average Document Size' })]),
    })

    const fileStorageResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'litedb:file-storage',
    })

    expect(fileStorageResponse.payload).toMatchObject({
      objectView: 'file-storage',
      files: expect.arrayContaining([expect.objectContaining({ filename: 'invoice-001.pdf' })]),
      chunks: expect.arrayContaining([expect.objectContaining({ status: 'ok' })]),
    })

    const maintenanceResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'litedb:maintenance',
    })

    expect(maintenanceResponse.payload).toMatchObject({
      objectView: 'maintenance',
      maintenance: expect.arrayContaining([expect.objectContaining({ name: 'Compact Copy' })]),
    })
  })

  it('does not invent LiteDB collection metadata for malformed object ids', () => {
    const connection = liteDbConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    expect(createExplorerNodes(connection, 'litedb:collection:')).toEqual([])

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'litedb:collection:',
    })

    expect(response.queryTemplate).toContain('"collection": ""')
    expect(response.payload).toMatchObject({
      objectView: 'collection',
      collection: '',
      collections: [],
      fields: [],
      indexes: [],
      statistics: [],
    })
    expect(JSON.stringify(response.payload)).not.toContain('products')
  })

  it('returns Cosmos DB account, database, and container metadata without generic document fallbacks', () => {
    const connection = cosmosConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'datapad-cosmos',
      'Databases',
      'Regions',
      'Consistency',
      'Security',
      'Diagnostics',
    ])
    expect(createExplorerNodes(connection).map((node) => node.label)).not.toContain('products')

    expect(createExplorerNodes(connection, 'cosmos:databases')).toEqual([
      expect.objectContaining({
        id: 'cosmos:database:catalog',
        label: 'catalog',
        kind: 'database',
      }),
      expect.objectContaining({ label: 'audit' }),
    ])

    expect(createExplorerNodes(connection, 'cosmos:database:catalog').map((node) => node.label)).toEqual([
      'Containers',
      'Throughput',
      'Security',
    ])

    expect(createExplorerNodes(connection, 'cosmos:container:catalog:products').map((node) => node.label)).toEqual([
      'Items',
      'Partition Key',
      'Indexing Policy',
      'Throughput',
      'Change Feed',
      'Stored Procedures',
      'Triggers',
      'User Defined Functions',
      'Conflict Feed',
    ])
    expect(createExplorerNodes(connection, 'cosmos:stored-procedures:catalog:products')).toEqual([
      expect.objectContaining({
        id: 'cosmos:stored-procedure:catalog:products:bulkUpsert',
        label: 'bulkUpsert',
        kind: 'stored-procedure',
      }),
    ])
    expect(createExplorerNodes(connection, 'cosmos:triggers:catalog:products')).toEqual([
      expect.objectContaining({
        id: 'cosmos:trigger:catalog:products:stampUpdatedAt',
        label: 'stampUpdatedAt',
        kind: 'trigger',
      }),
    ])
    expect(createExplorerNodes(connection, 'cosmos:udfs:catalog:products')).toEqual([
      expect.objectContaining({
        id: 'cosmos:udf:catalog:products:normalizeSku',
        label: 'normalizeSku',
        kind: 'udf',
      }),
    ])

    const containerResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cosmos:container:catalog:products',
    })

    expect(containerResponse.queryTemplate).toContain('"collection": "products"')
    expect(containerResponse.payload).toMatchObject({
      engine: 'cosmosdb',
      objectView: 'container',
      database: 'catalog',
      container: 'products',
      partitionKeys: [expect.objectContaining({ path: '/tenantId' })],
      indexingPolicy: expect.arrayContaining([expect.objectContaining({ path: '/*' })]),
      throughput: expect.arrayContaining([expect.objectContaining({ mode: 'autoscale' })]),
    })
    expect(containerResponse.payload).not.toHaveProperty('command')
    expect(containerResponse.payload).not.toHaveProperty('raw')

    const securityResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cosmos:security',
    })

    expect(securityResponse.payload).toMatchObject({
      objectView: 'security',
      security: expect.arrayContaining([expect.objectContaining({ name: 'ReadOnlyApp' })]),
    })
  })

  it('does not invent Cosmos DB containers for malformed object ids', () => {
    const connection = cosmosConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cosmos:container:catalog:',
    })

    expect(response.queryTemplate).toContain('"target": "cosmos:container:catalog:"')
    expect(response.payload).toMatchObject({
      objectView: 'container',
      database: 'catalog',
      container: '',
      containers: [],
      partitionKeys: [],
      indexingPolicy: [],
      throughput: [],
    })
    expect(JSON.stringify(response.payload)).not.toContain('products')
  })

  it('mirrors MySQL and MariaDB database trees without system clutter', () => {
    const connection = mysqlConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'datapadplusplus',
      'System Schemas',
      'Users / Privileges',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'database:datapadplusplus').map((node) => node.label)).toEqual([
      'Tables',
      'Views',
      'Stored Procedures',
      'Functions',
      'Events',
      'Triggers',
      'Indexes',
      'Storage',
    ])

    expect(createExplorerNodes(connection, 'mysql:datapadplusplus:tables')).toEqual([
      expect.objectContaining({
        label: 'accounts',
        kind: 'table',
        scope: 'table:datapadplusplus:accounts',
        queryTemplate: 'select * from `datapadplusplus`.`accounts` limit 100;',
      }),
      expect.objectContaining({ label: 'orders', kind: 'table' }),
      expect.objectContaining({ label: 'products', kind: 'table' }),
    ])

    expect(createExplorerNodes(connection, 'mysql:diagnostics').map((node) => node.label)).toEqual([
      'Sessions',
      'Status Counters',
      'Slow Queries',
      'Performance Schema',
      'Metadata Locks',
      'Optimizer Trace',
      'InnoDB Status',
      'Replication',
    ])

    expect(createExplorerNodes(mysqlConnection('mariadb')).map((node) => node.label)).toEqual([
      'datapadplusplus',
      'System Schemas',
      'Users / Privileges',
      'Diagnostics',
    ])

    expect(createExplorerNodes(mysqlConnection('mariadb'), 'mysql:security').map((node) => node.label)).toEqual([
      'Users',
      'Roles',
      'Role Mappings',
      'Grants',
    ])

    expect(createExplorerNodes(mysqlConnection('mariadb'), 'mysql:diagnostics').map((node) => node.label)).toEqual([
      'Sessions',
      'Status Counters',
      'Slow Queries',
      'Performance Schema',
      'Metadata Locks',
      'Server Variables',
      'Storage Engines',
      'ANALYZE FORMAT=JSON',
      'InnoDB Status',
      'Replication',
    ])
  })

  it('returns MySQL inspection payloads for native object-view workspaces', () => {
    const connection = mysqlConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const tableResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'table:datapadplusplus:accounts',
    })

    expect(tableResponse.queryTemplate).toBe('select * from `datapadplusplus`.`accounts` limit 100;')
    expect(tableResponse.payload).toMatchObject({
      engine: 'mysql',
      database: 'datapadplusplus',
      schema: 'datapadplusplus',
      objectName: 'accounts',
      columns: expect.arrayContaining([expect.objectContaining({ name: 'id', identity: 'auto_increment' })]),
      indexes: expect.arrayContaining([expect.objectContaining({ name: 'PRIMARY' })]),
    })

    const storageResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'mysql:datapadplusplus:storage',
    })

    expect(storageResponse.payload).toMatchObject({
      engine: 'mysql',
      objectView: 'storage',
      engines: expect.arrayContaining([expect.objectContaining({ name: 'InnoDB' })]),
    })
    expect(JSON.stringify(storageResponse.payload)).not.toContain('SHOW')

    const diagnosticsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'mysql:diagnostics',
    })

    expect(diagnosticsResponse.payload).toMatchObject({
      engine: 'mysql',
      sessions: expect.arrayContaining([expect.objectContaining({ state: 'executing' })]),
      slowQueries: expect.arrayContaining([expect.objectContaining({ digest: expect.stringContaining('accounts') })]),
      statementDigests: expect.arrayContaining([expect.objectContaining({ digest: expect.stringContaining('orders') })]),
      tableIo: expect.arrayContaining([expect.objectContaining({ table: 'orders' })]),
      metadataLocks: expect.arrayContaining([expect.objectContaining({ object: 'orders' })]),
      optimizerTrace: expect.arrayContaining([expect.objectContaining({ name: 'optimizer_trace' })]),
      innodbStatus: expect.arrayContaining([expect.objectContaining({ name: 'Buffer pool hit rate' })]),
      replication: expect.arrayContaining([expect.objectContaining({ state: 'not configured' })]),
    })

    const slowQueryResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'mysql:diagnostics:slow-queries',
    })
    expect(slowQueryResponse.queryTemplate).toContain('events_statements_summary_by_digest')

    const innodbResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'mysql:diagnostics:innodb-status',
    })
    expect(innodbResponse.queryTemplate).toBe('show engine innodb status;')

    const performanceSchemaResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'mysql:diagnostics:performance-schema',
    })
    expect(performanceSchemaResponse.queryTemplate).toContain('table_io_waits_summary_by_index_usage')

    const optimizerTraceResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'mysql:diagnostics:optimizer-trace',
    })
    expect(optimizerTraceResponse.queryTemplate).toContain('@@optimizer_trace')

    const mariaDbConnection = mysqlConnection('mariadb')
    const mariaDbSnapshot = {
      connections: [mariaDbConnection],
    } as WorkspaceSnapshot
    const roleMappingsResponse = inspectExplorerNodeLocally(mariaDbSnapshot, {
      connectionId: mariaDbConnection.id,
      environmentId: 'env-local',
      nodeId: 'mysql:security:role-mappings',
    })
    expect(roleMappingsResponse.queryTemplate).toContain('mysql.roles_mapping')

    const mariaDbRolesResponse = inspectExplorerNodeLocally(mariaDbSnapshot, {
      connectionId: mariaDbConnection.id,
      environmentId: 'env-local',
      nodeId: 'mysql:security:roles',
    })
    expect(mariaDbRolesResponse.queryTemplate).toContain("is_role = 'Y'")

    const analyzeResponse = inspectExplorerNodeLocally(mariaDbSnapshot, {
      connectionId: mariaDbConnection.id,
      environmentId: 'env-local',
      nodeId: 'mysql:diagnostics:analyze-profile',
    })
    expect(analyzeResponse.queryTemplate).toBe('analyze format=json select 1;')

    const variablesResponse = inspectExplorerNodeLocally(mariaDbSnapshot, {
      connectionId: mariaDbConnection.id,
      environmentId: 'env-local',
      nodeId: 'mysql:diagnostics:server-variables',
    })
    expect(variablesResponse.queryTemplate).toContain("show variables like 'sql_mode';")
    expect(variablesResponse.queryTemplate).not.toContain('@@optimizer_trace')
    expect(variablesResponse.payload).toMatchObject({
      engine: 'mariadb',
      serverVariables: expect.arrayContaining([
        expect.objectContaining({ name: 'sql_mode' }),
        expect.objectContaining({ name: 'default_storage_engine', value: 'Aria' }),
      ]),
      analyzeProfile: expect.arrayContaining([
        expect.objectContaining({ name: 'ANALYZE FORMAT=JSON', status: 'preview' }),
      ]),
      roleMappings: expect.arrayContaining([
        expect.objectContaining({ member: 'reporting_read' }),
      ]),
    })
  })

  it('returns MySQL and MariaDB routine source payloads for native source previews', () => {
    const connection = mysqlConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const procedureResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'procedure:datapadplusplus:refresh_account_rollups',
    })

    expect(procedureResponse.payload).toMatchObject({
      engine: 'mysql',
      database: 'datapadplusplus',
      objectName: 'refresh_account_rollups',
      definition: expect.stringContaining('create procedure'),
      procedures: [
        expect.objectContaining({
          name: 'refresh_account_rollups',
          language: 'sql',
          definition: expect.stringContaining('select p_account_id as account_id'),
        }),
      ],
    })

    const functionResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'function:datapadplusplus:account_status',
    })

    expect(functionResponse.payload).toMatchObject({
      engine: 'mysql',
      objectName: 'account_status',
      definition: expect.stringContaining('create function'),
      functions: [
        expect.objectContaining({
          name: 'account_status',
          returns: 'varchar(120)',
          definition: expect.stringContaining("return concat('status:', p_status)"),
        }),
      ],
    })
  })

  it('mirrors Elasticsearch and OpenSearch object trees without SQL fallbacks', () => {
    const connection = searchConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'Cluster',
      'Indices',
      'Data Streams',
      'Aliases',
      'Templates',
      'Pipelines',
      'Security',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'search:indices')).toEqual([
      expect.objectContaining({
        label: 'products-v1',
        kind: 'index',
        scope: 'index:products-v1',
        queryTemplate: expect.stringContaining('"index": "products-v1"'),
      }),
      expect.objectContaining({ label: 'orders-v1', kind: 'index' }),
    ])

    expect(createExplorerNodes(connection, 'index:products-v1').map((node) => node.label)).toEqual([
      'Documents',
      'Mappings',
      'Settings',
      'Aliases',
      'Shards',
      'Segments',
    ])

    expect(createExplorerNodes(searchConnection('opensearch')).map((node) => node.label)).toContain('Diagnostics')
  })

  it('returns search inspection payloads for purpose-built object views', () => {
    const connection = searchConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const indexResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'index:products-v1',
    })

    expect(indexResponse.queryTemplate).toContain('"match_all"')
    expect(indexResponse.payload).toMatchObject({
      engine: 'elasticsearch',
      objectView: 'index',
      index: 'products-v1',
      fields: expect.arrayContaining([expect.objectContaining({ path: 'sku', type: 'keyword' })]),
      shards: expect.arrayContaining([expect.objectContaining({ index: 'products-v1' })]),
    })

    const diagnosticsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'search:diagnostics',
    })

    expect(diagnosticsResponse.payload).toMatchObject({
      engine: 'elasticsearch',
      objectView: 'diagnostics',
      nodes: expect.arrayContaining([expect.objectContaining({ name: 'node-a' })]),
      lifecyclePolicies: expect.arrayContaining([expect.objectContaining({ type: 'ILM' })]),
    })
    expect(JSON.stringify(diagnosticsResponse.payload)).not.toContain('_cat')
  })

  it('does not invent search indices for malformed object ids', () => {
    const connection = searchConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    expect(createExplorerNodes(connection, 'index:')).toEqual([])

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'index:',
    })

    expect(response.queryTemplate).toContain('"index": ""')
    expect(response.payload).toMatchObject({
      objectView: 'index',
      index: '',
      indices: [],
      fields: [],
      warnings: expect.arrayContaining([
        'No search index metadata is available. Refresh the Indices node or select another index.',
      ]),
    })
    expect(JSON.stringify(response.payload)).not.toContain('products-v1')
  })

  it('mirrors DynamoDB tables, access, and diagnostics without live AWS dependencies', () => {
    const connection = dynamoConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'Tables',
      'Access',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'dynamodb:tables')).toEqual([
      expect.objectContaining({
        label: 'Orders',
        kind: 'table',
        scope: 'table:Orders',
        queryTemplate: expect.stringContaining('"tableName": "Orders"'),
      }),
      expect.objectContaining({ label: 'Products', kind: 'table' }),
    ])

    expect(createExplorerNodes(connection, 'table:Orders').map((node) => node.label)).toEqual([
      'Items',
      'Keys',
      'Global Secondary Indexes',
      'Local Secondary Indexes',
      'Streams',
      'TTL',
      'Capacity',
      'Permissions',
    ])
  })

  it('returns DynamoDB inspection payloads for table and diagnostics workspaces', () => {
    const connection = dynamoConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const tableResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'table:Orders',
    })

    expect(tableResponse.queryTemplate).toContain('"operation": "Query"')
    expect(tableResponse.payload).toMatchObject({
      engine: 'dynamodb',
      objectView: 'table',
      tableName: 'Orders',
      keys: expect.arrayContaining([expect.objectContaining({ attribute: 'pk', keyRole: 'partition' })]),
      globalSecondaryIndexes: expect.arrayContaining([expect.objectContaining({ name: 'customer-status-index' })]),
      ttl: expect.arrayContaining([expect.objectContaining({ status: 'ENABLED' })]),
    })

    const diagnosticsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'dynamodb:diagnostics',
    })

    expect(diagnosticsResponse.payload).toMatchObject({
      engine: 'dynamodb',
      objectView: 'diagnostics',
      capacity: expect.arrayContaining([expect.objectContaining({ resource: 'Orders' })]),
      hotPartitions: expect.arrayContaining([expect.objectContaining({ partitionKey: 'CUSTOMER#123' })]),
      alarms: expect.arrayContaining([expect.objectContaining({ state: 'ALARM' })]),
    })
  })

  it('does not invent DynamoDB tables for malformed object ids', () => {
    const connection = dynamoConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    expect(createExplorerNodes(connection, 'table:')).toEqual([])

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'table:',
    })

    expect(response.payload).toMatchObject({
      engine: 'dynamodb',
      objectView: 'table',
      tableName: '',
      tables: [],
      items: [],
      keys: [],
    })
    expect(JSON.stringify(response.payload)).not.toContain('Orders')
  })

  it('mirrors Cassandra keyspaces, tables, and diagnostics without live cluster dependencies', () => {
    const connection = cassandraConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'app',
      'System Keyspaces',
      'Cluster',
      'Security',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'keyspace:app').map((node) => node.label)).toEqual([
      'Tables',
      'Materialized Views',
      'Indexes',
      'Types',
      'Functions',
      'Aggregates',
      'Permissions',
    ])

    expect(createExplorerNodes(connection, 'cassandra:app:tables')).toEqual([
      expect.objectContaining({
        label: 'orders_by_customer',
        kind: 'table',
        scope: 'table:app.orders_by_customer',
        queryTemplate: expect.stringContaining('where customer_id = ?'),
      }),
      expect.objectContaining({ label: 'products_by_sku', kind: 'table' }),
    ])

    expect(createExplorerNodes(connection, 'table:app.orders_by_customer').map((node) => node.label)).toEqual([
      'Data',
      'Columns',
      'Primary Key',
      'Indexes',
      'Compaction',
      'Statistics',
      'Permissions',
    ])
  })

  it('returns Cassandra inspection payloads for table and diagnostics workspaces', () => {
    const connection = cassandraConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const tableResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'table:app:orders_by_customer',
    })

    expect(tableResponse.queryTemplate).toContain('where customer_id = ?')
    expect(tableResponse.payload).toMatchObject({
      engine: 'cassandra',
      objectView: 'table',
      tableName: 'orders_by_customer',
      primaryKey: expect.arrayContaining([expect.objectContaining({ name: 'customer_id' })]),
      indexes: expect.arrayContaining([expect.objectContaining({ name: 'orders_status_sai' })]),
      options: expect.arrayContaining([expect.objectContaining({ option: 'compaction' })]),
    })

    const diagnosticsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'cassandra:diagnostics',
    })

    expect(diagnosticsResponse.payload).toMatchObject({
      engine: 'cassandra',
      objectView: 'diagnostics',
      diagnostics: expect.arrayContaining([expect.objectContaining({ signal: 'Read latency p95' })]),
      warningRows: expect.arrayContaining([expect.objectContaining({ scope: 'tracing' })]),
    })
  })

  it('does not invent Cassandra table metadata for malformed object ids', () => {
    const connection = cassandraConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'table:app:',
    })

    expect(response.payload).toMatchObject({
      engine: 'cassandra',
      objectView: 'table',
      tableName: '',
      tables: [],
      columns: [],
      primaryKey: [],
      indexes: [],
    })
    expect(JSON.stringify(response.payload)).not.toContain('orders_by_customer')
  })

  it('mirrors a Prometheus native metrics and operations tree', () => {
    const connection = prometheusConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'Metrics',
      'Labels',
      'Targets',
      'Rules',
      'Alerts',
      'Service Discovery',
      'TSDB / Storage',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'prometheus:metrics')).toEqual([
      expect.objectContaining({
        label: 'up',
        kind: 'metric',
        scope: 'metric:up',
        queryTemplate: 'up',
      }),
      expect.objectContaining({
        label: 'http_requests_total',
        kind: 'metric',
        scope: 'metric:http_requests_total',
      }),
      expect.any(Object),
      expect.any(Object),
    ])

    expect(createExplorerNodes(connection, 'metric:http_requests_total').map((node) => node.label)).toEqual([
      'Series',
      'Labels',
      'Related Alerts',
    ])
  })

  it('returns Prometheus inspection payloads without raw API command dumps', () => {
    const connection = prometheusConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'metric:http_requests_total',
    })

    expect(response.queryTemplate).toBe('http_requests_total')
    expect(response.payload).toMatchObject({
      engine: 'prometheus',
      objectView: 'metric',
      metric: 'http_requests_total',
      metrics: [
        expect.objectContaining({ name: 'http_requests_total', type: 'counter' }),
      ],
      series: expect.arrayContaining([expect.objectContaining({ metric: 'http_requests_total' })]),
    })
    expect(response.payload).not.toHaveProperty('command')
    expect(response.payload).not.toHaveProperty('raw')

    const targetsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'prometheus:targets',
    })

    expect(targetsResponse.payload).toMatchObject({
      targets: expect.arrayContaining([expect.objectContaining({ health: 'down' })]),
      warnings: expect.arrayContaining([expect.stringContaining('target is down')]),
    })
  })

  it('mirrors an InfluxDB bucket and measurement tree', () => {
    const connection = influxConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'Buckets',
      'Tasks',
      'Tokens',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'influx:buckets')).toEqual([
      expect.objectContaining({
        label: 'telemetry',
        kind: 'bucket',
        scope: 'bucket:telemetry',
      }),
      expect.objectContaining({
        label: 'system',
        kind: 'bucket',
        scope: 'bucket:system',
      }),
    ])

    expect(createExplorerNodes(connection, 'bucket:telemetry').map((node) => node.label)).toEqual([
      'Measurements',
      'Tags',
      'Fields',
      'Retention Policies',
    ])

    expect(createExplorerNodes(connection, 'measurements:telemetry')).toEqual([
      expect.objectContaining({
        label: 'cpu',
        kind: 'measurement',
        scope: 'measurement:telemetry:cpu',
        queryTemplate: expect.stringContaining('_measurement == "cpu"'),
      }),
      expect.objectContaining({ label: 'memory', kind: 'measurement' }),
      expect.objectContaining({ label: 'http_requests', kind: 'measurement' }),
    ])
  })

  it('returns InfluxDB inspection payloads without raw API command dumps', () => {
    const connection = influxConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'measurement:telemetry:cpu',
    })

    expect(response.queryTemplate).toContain('_measurement == "cpu"')
    expect(response.payload).toMatchObject({
      engine: 'influxdb',
      objectView: 'measurement',
      measurement: 'cpu',
      measurements: [
        expect.objectContaining({ name: 'cpu', bucket: 'telemetry' }),
      ],
      tags: expect.arrayContaining([expect.objectContaining({ name: 'host' })]),
      fields: expect.arrayContaining([expect.objectContaining({ name: 'usage_user' })]),
    })
    expect(response.payload).not.toHaveProperty('command')
    expect(response.payload).not.toHaveProperty('raw')

    const securityResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'influx:security',
    })

    expect(securityResponse.payload).toMatchObject({
      tokens: expect.arrayContaining([expect.objectContaining({ name: 'read-telemetry' })]),
      permissionWarnings: expect.arrayContaining([expect.objectContaining({ scope: 'tokens' })]),
    })
  })

  it('mirrors an OpenTSDB metric and metadata tree', () => {
    const connection = openTsdbConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'Metrics',
      'Tags',
      'Aggregators',
      'Downsampling',
      'UID Metadata',
      'Trees',
      'Stats',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'opentsdb:metrics')).toEqual([
      expect.objectContaining({
        label: 'sys.cpu.user',
        kind: 'metric',
        scope: 'metric:sys.cpu.user',
        queryTemplate: expect.stringContaining('"metric": "sys.cpu.user"'),
      }),
      expect.objectContaining({ label: 'http.requests', kind: 'metric' }),
      expect.objectContaining({ label: 'jvm.memory.used', kind: 'metric' }),
    ])

    expect(createExplorerNodes(connection, 'metric:http.requests').map((node) => node.label)).toEqual([
      'Tags',
      'UID Metadata',
      'Stats',
    ])
  })

  it('returns OpenTSDB inspection payloads without raw API command dumps', () => {
    const connection = openTsdbConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'metric:http.requests',
    })

    expect(response.queryTemplate).toContain('"metric": "http.requests"')
    expect(response.payload).toMatchObject({
      engine: 'opentsdb',
      objectView: 'metric',
      metric: 'http.requests',
      metrics: [
        expect.objectContaining({ name: 'http.requests', cardinality: 'high' }),
      ],
      tags: expect.arrayContaining([expect.objectContaining({ name: 'endpoint' })]),
      uidMetadata: expect.arrayContaining([expect.objectContaining({ name: 'http.requests' })]),
    })
    expect(response.payload).not.toHaveProperty('command')
    expect(response.payload).not.toHaveProperty('raw')

    const statsResponse = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'opentsdb:stats',
    })

    expect(statsResponse.payload).toMatchObject({
      stats: expect.arrayContaining([expect.objectContaining({ name: 'tsd.http.query.latency_95pct' })]),
      diagnostics: expect.arrayContaining([expect.objectContaining({ signal: 'UID Cache' })]),
    })
  })

  it('mirrors a graph-native schema and diagnostics tree', () => {
    const connection = neo4jConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'Databases',
      'Node Labels',
      'Relationship Types',
      'Property Keys',
      'Indexes',
      'Constraints',
      'Procedures',
      'Security',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'graph:node-labels')).toEqual([
      expect.objectContaining({
        label: 'Account',
        kind: 'node-label',
        scope: 'node-label:Account',
        queryTemplate: 'MATCH (n:`Account`) RETURN n LIMIT 25',
      }),
      expect.objectContaining({ label: 'Order', kind: 'node-label' }),
      expect.objectContaining({ label: 'Product', kind: 'node-label' }),
    ])

    expect(createExplorerNodes(connection, 'graph:relationship-types')).toEqual([
      expect.objectContaining({
        label: 'PLACED',
        kind: 'relationship',
        queryTemplate: 'MATCH ()-[r:`PLACED`]->() RETURN r LIMIT 25',
      }),
      expect.objectContaining({ label: 'CONTAINS', kind: 'relationship' }),
      expect.objectContaining({ label: 'RELATED_TO', kind: 'relationship' }),
    ])
  })

  it('returns graph inspection payloads without raw command dumps', () => {
    const connection = neo4jConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'node-label:Account',
    })

    expect(response.queryTemplate).toBe('MATCH (n:`Account`) RETURN n LIMIT 25')
    expect(response.payload).toMatchObject({
      engine: 'neo4j',
      objectView: 'node-label',
      nodeLabels: [
        expect.objectContaining({ label: 'Account', indexedProperties: 'id, email' }),
      ],
      relationshipTypes: expect.arrayContaining([expect.objectContaining({ type: 'PLACED' })]),
      indexes: expect.arrayContaining([expect.objectContaining({ name: 'account_email_lookup' })]),
    })
    expect(response.payload).not.toHaveProperty('command')
    expect(response.payload).not.toHaveProperty('raw')

    const security = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'graph:security',
    })

    expect(security.payload).toMatchObject({
      security: expect.arrayContaining([expect.objectContaining({ principal: 'reader' })]),
      permissionWarnings: expect.arrayContaining([expect.objectContaining({ scope: 'security' })]),
    })
  })

  it('mirrors a warehouse-native tree for cloud warehouse engines', () => {
    const connection = snowflakeConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'Databases',
      'Tables',
      'Views',
      'Warehouses',
      'Tasks & Query History',
      'Security',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'warehouse:tables')).toEqual([
      expect.objectContaining({
        label: 'orders',
        kind: 'table',
        scope: 'table:ANALYTICS:orders',
        queryTemplate: 'select * from "ANALYTICS"."orders" limit 100;',
      }),
      expect.objectContaining({ label: 'accounts', kind: 'table' }),
      expect.objectContaining({ label: 'products', kind: 'table' }),
    ])

    expect(createExplorerNodes(connection, 'warehouse:warehouses')).toEqual([
      expect.objectContaining({
        label: 'ANALYTICS_XS',
        kind: 'warehouse',
        scope: 'warehouse-compute:ANALYTICS_XS',
      }),
      expect.objectContaining({ label: 'LOAD_WH', kind: 'warehouse' }),
    ])
  })

  it('returns warehouse inspection payloads without raw command dumps', () => {
    const connection = snowflakeConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'table:ANALYTICS:orders',
    })

    expect(response.queryTemplate).toBe('select * from "ANALYTICS"."orders" limit 100;')
    expect(response.payload).toMatchObject({
      engine: 'snowflake',
      objectView: 'table',
      tables: [
        expect.objectContaining({ name: 'orders', partitioning: 'order_date' }),
      ],
      columns: expect.arrayContaining([expect.objectContaining({ name: 'created_at' })]),
      diagnostics: expect.arrayContaining([expect.objectContaining({ signal: 'Broad Scan Risk' })]),
      queryHistory: expect.arrayContaining([expect.objectContaining({ queryId: 'sf-query-1001' })]),
      warehouseLoad: expect.arrayContaining([expect.objectContaining({ warehouse: 'ANALYTICS_XS' })]),
      streams: expect.arrayContaining([expect.objectContaining({ name: 'orders_stream' })]),
    })
    expect(response.payload).not.toHaveProperty('command')
    expect(response.payload).not.toHaveProperty('raw')

    const security = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'warehouse:security',
    })

    expect(security.payload).toMatchObject({
      security: expect.arrayContaining([expect.objectContaining({ principal: 'ANALYST_ROLE' })]),
      permissionWarnings: expect.arrayContaining([expect.objectContaining({ scope: 'security' })]),
    })
  })

  it('mirrors a DuckDB-local analytics tree', () => {
    const connection = duckDbConnection()

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'datapad.duckdb',
      'Attached Databases',
      'Extensions',
      'Files',
      'Pragmas',
      'Diagnostics',
    ])

    expect(createExplorerNodes(connection, 'schema:main')).toEqual([
      expect.objectContaining({ label: 'Tables', kind: 'tables', scope: 'tables:main' }),
      expect.objectContaining({ label: 'Views', kind: 'views', scope: 'views:main' }),
      expect.objectContaining({ label: 'Indexes', kind: 'indexes', scope: 'indexes:main' }),
      expect.objectContaining({ label: 'Functions & Macros', kind: 'functions', scope: 'functions:main' }),
    ])

    expect(createExplorerNodes(connection, 'tables:main')).toEqual([
      expect.objectContaining({
        label: 'orders',
        kind: 'table',
        scope: 'table:main:orders',
        queryTemplate: 'select * from "main"."orders" limit 100;',
      }),
      expect.objectContaining({ label: 'accounts', kind: 'table' }),
      expect.objectContaining({ label: 'products', kind: 'table' }),
    ])
  })

  it('returns DuckDB inspection payloads without raw command dumps', () => {
    const connection = duckDbConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const response = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'table:main:orders',
    })

    expect(response.queryTemplate).toBe('select * from "main"."orders" limit 100;')
    expect(response.payload).toMatchObject({
      engine: 'duckdb',
      objectView: 'table',
      tables: [
        expect.objectContaining({ name: 'orders', type: 'BASE TABLE' }),
      ],
      columns: expect.arrayContaining([expect.objectContaining({ name: 'created_at' })]),
      indexes: expect.arrayContaining([expect.objectContaining({ name: 'orders_id_idx' })]),
    })
    expect(response.payload).not.toHaveProperty('command')
    expect(response.payload).not.toHaveProperty('raw')

    const extensions = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'duckdb:extensions',
    })

    expect(extensions.payload).toMatchObject({
      extensions: expect.arrayContaining([expect.objectContaining({ name: 'parquet' })]),
      diagnostics: expect.arrayContaining([expect.objectContaining({ signal: 'External File Access' })]),
    })
  })

  it('returns Redis object-view metadata without raw command-shaped payloads', () => {
    const connection = redisConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    const pubsubNodes = createExplorerNodes(connection, 'pubsub')
    expect(pubsubNodes.map((node) => node.detail)).toEqual([
      'Active channel names',
      'Pattern subscription count',
      'Channel subscriber counts',
    ])
    expect(pubsubNodes.map((node) => node.detail).join(' ')).not.toContain('PUBSUB')

    const pubsub = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'redis:pubsub',
    })
    expect(pubsub.payload).toMatchObject({
      kind: 'pubsub',
      channels: [],
      patterns: [],
      subscribers: [],
    })
    expect(pubsub.payload).not.toHaveProperty('command')
    expect(pubsub.payload).not.toHaveProperty('value')

    const slowlog = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'redis:diagnostics:slowlog',
    })
    expect(slowlog.payload).toMatchObject({
      kind: 'slowlog',
      entries: [expect.objectContaining({ commandName: 'HGETALL' })],
    })
    expect(JSON.stringify(slowlog.payload)).not.toContain('SLOWLOG GET')

    const security = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'redis:acl:users',
    })
    expect(security.payload).toMatchObject({
      kind: 'security',
      users: [expect.objectContaining({ name: 'default', enabled: true })],
    })
    expect(security.payload).not.toHaveProperty('command')
    expect(security.payload).not.toHaveProperty('value')
  })

  it('returns Memcached native metadata without fake key-prefix browsing', () => {
    const connection = memcachedConnection()
    const snapshot = {
      connections: [connection],
    } as WorkspaceSnapshot

    expect(createExplorerNodes(connection).map((node) => node.label)).toEqual([
      'Server',
      'Diagnostics',
    ])
    expect(createExplorerNodes(connection).map((node) => node.label).join(' ')).not.toContain('session:*')
    expect(createExplorerNodes(connection).map((node) => node.label).join(' ')).not.toContain('cache:*')

    expect(createExplorerNodes(connection, 'memcached:server').map((node) => node.label)).toEqual([
      'Stats',
      'Slabs',
      'Item Classes',
      'Known Key Lookup',
      'Settings',
      'Connections',
    ])
    expect(createExplorerNodes(connection, 'memcached:slabs').map((node) => node.label)).toEqual([
      'Class 1',
      'Class 2',
      'Class 3',
    ])

    const stats = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'memcached:stats',
    })

    expect(stats.queryTemplate).toBe('stats')
    expect(stats.payload).toMatchObject({
      engine: 'memcached',
      objectView: 'stats',
      stats: expect.arrayContaining([expect.objectContaining({ metric: 'curr_items' })]),
      diagnostics: expect.arrayContaining([expect.objectContaining({ signal: 'Hit Rate' })]),
    })
    expect(stats.payload).not.toHaveProperty('command')
    expect(stats.payload).not.toHaveProperty('raw')

    const slabs = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'memcached:slabs',
    })

    expect(slabs.payload).toMatchObject({
      objectView: 'slabs',
      slabs: expect.arrayContaining([expect.objectContaining({ classId: '2' })]),
    })
    expect(JSON.stringify(slabs.payload)).not.toContain('stats slabs')

    const knownKey = inspectExplorerNodeLocally(snapshot, {
      connectionId: connection.id,
      environmentId: 'env-local',
      nodeId: 'memcached:known-key',
    })

    expect(knownKey.queryTemplate).toBe('get <key>')
    expect(knownKey.payload).toMatchObject({
      objectView: 'known-key',
      keyActions: expect.arrayContaining([
        expect.objectContaining({ action: 'Get', command: 'get <key>' }),
        expect.objectContaining({ action: 'Delete', risk: 'destructive' }),
      ]),
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

function genericPreviewConnection(engine: ConnectionProfile['engine'], family: ConnectionProfile['family']): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine,
    engine,
    family,
    host: 'localhost',
    port: undefined,
    database: undefined,
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: true,
    icon: engine,
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

function timescaleConnection(): ConnectionProfile {
  return {
    id: 'conn-timescale',
    name: 'TimescaleDB',
    engine: 'timescaledb',
    family: 'timeseries',
    host: 'localhost',
    port: 5432,
    database: 'datapadplusplus',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'timescaledb',
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

function sqliteConnection(): ConnectionProfile {
  return {
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
}

function mysqlConnection(engine: 'mysql' | 'mariadb' = 'mysql'): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine === 'mariadb' ? 'MariaDB' : 'MySQL',
    engine,
    family: 'sql',
    host: 'localhost',
    port: engine === 'mariadb' ? 3307 : 3306,
    database: 'datapadplusplus',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: { username: 'app' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function searchConnection(engine: 'elasticsearch' | 'opensearch' = 'elasticsearch'): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine === 'opensearch' ? 'OpenSearch' : 'Elasticsearch',
    engine,
    family: 'search',
    host: 'localhost',
    port: engine === 'opensearch' ? 9201 : 9200,
    database: engine === 'opensearch' ? 'opensearch-local' : 'elasticsearch-local',
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: { username: 'elastic' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function dynamoConnection(): ConnectionProfile {
  return {
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
}

function cassandraConnection(): ConnectionProfile {
  return {
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
}

function prometheusConnection(): ConnectionProfile {
  return {
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
}

function influxConnection(): ConnectionProfile {
  return {
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
}

function openTsdbConnection(): ConnectionProfile {
  return {
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
}

function neo4jConnection(): ConnectionProfile {
  return {
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
}

function snowflakeConnection(): ConnectionProfile {
  return {
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
}

function duckDbConnection(): ConnectionProfile {
  return {
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
}

function liteDbConnection(): ConnectionProfile {
  return {
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
}

function cosmosConnection(): ConnectionProfile {
  return {
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
}

function redisConnection(): ConnectionProfile {
  return {
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
}

function memcachedConnection(): ConnectionProfile {
  return {
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
}
