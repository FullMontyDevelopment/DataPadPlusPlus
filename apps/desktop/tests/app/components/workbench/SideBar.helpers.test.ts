import { describe, expect, it } from 'vitest'
import type { AdapterManifest, ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import { datastoreTreeForEngine } from '@datapadplusplus/shared-types'
import { createSeedSnapshot } from '../../../fixtures/seed-workspace'
import {
  buildConnectionObjectTree,
  buildConnectionObjectTreeFromExplorerNodes,
  connectionGroupLabel,
  connectionTreeNodeTarget,
  environmentAccentVariables,
  explorerNodeTarget,
  isExplorerNodeQueryable,
  isScopedQueryable,
  sidebarSectionId,
} from '../../../../src/app/components/workbench/SideBar.helpers'
import { connectionTreeNodeForAction } from '../../../../src/app/components/workbench/SideBar.connection-object-actions'
import type { ConnectionTreeNode } from '../../../../src/app/components/workbench/SideBar.helpers'

describe('sidebar connection tree helpers', () => {
  it('builds SQL structural folders without invented table leaves', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-analytics')

    expect(connection).toBeDefined()

    const tree = buildConnectionObjectTree(connection!)

    expect(findNode(tree, 'user-schemas')).toMatchObject({ label: 'User Schemas' })
    expect(findNode(tree, 'schema-public')).toMatchObject({
      kind: 'schema',
      label: 'public',
    })
    expect(findNode(tree, 'tables')).toMatchObject({ label: 'Tables' })
    expect(findNode(tree, 'table-accounts')).toBeUndefined()
  })

  it('builds SQL Server structural folders without invented table leaves', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-orders')

    const tree = buildConnectionObjectTree(connection!)

    expect(findNode(tree, 'databases')).toMatchObject({ label: 'Databases' })
    expect(findNode(tree, 'database-orders')).toMatchObject({ label: 'orders' })
    expect(findNode(tree, 'tables')).toMatchObject({ label: 'Tables' })
    expect(findNode(tree, 'table-dbo-accounts')).toBeUndefined()
  })

  it('builds SQLite structural folders with the main database', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-local-sqlite')

    const tree = buildConnectionObjectTree(connection!)

    expect(findNodeByLabel(tree, 'Main Database')).toMatchObject({
      label: 'Main Database',
      kind: 'database',
    })
    expect(findNode(tree, 'tables')).toMatchObject({ label: 'Tables' })
    expect(findNodeByLabel(tree, 'Virtual Tables')).toBeUndefined()
    expect(findNodeByLabel(tree, 'FTS Tables')).toBeUndefined()
    expect(findNodeByLabel(tree, 'Pragmas')).toBeUndefined()
    expect(findNodeByLabel(tree, 'Schema')).toBeUndefined()
    expect(findNode(tree, 'table-accounts')).toBeUndefined()
  })

  it('builds Oracle structural folders for the selected service, schemas, and PL/SQL objects', () => {
    const connection = oracleConnection()
    const tree = buildConnectionObjectTree(connection, adapterManifestFor(connection))

    expect(findNodeByLabel(tree, 'FREEPDB1')).toMatchObject({ label: 'FREEPDB1' })
    expect(findNodeByLabel(tree, 'Schemas')).toMatchObject({ label: 'Schemas' })
    expect(findNodeByLabel(tree, 'Tables')).toMatchObject({ label: 'Tables' })
    expect(findNodeByLabel(tree, 'Packages')).toMatchObject({ label: 'Packages' })
    expect(findNodeByLabel(tree, 'Procedures')).toMatchObject({ label: 'Procedures' })
    expect(findNodeByLabel(tree, 'Data Guard')).toBeUndefined()

    const packages = findNodeByLabel(tree, 'Packages')
    expect(packages?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Create Package...',
          queryTemplate: expect.stringContaining('create or replace package'),
        }),
      ]),
    )
  })

  it('builds CockroachDB structural folders for databases and cluster diagnostics', () => {
    const connection = cockroachConnection()
    const tree = buildConnectionObjectTree(connection, adapterManifestFor(connection))

    expect(findNodeByLabel(tree, 'Databases')).toMatchObject({ label: 'Databases' })
    expect(findNodeByLabel(tree, 'defaultdb')).toMatchObject({ label: 'defaultdb' })
    expect(findNodeByLabel(tree, 'User Schemas')).toMatchObject({ label: 'User Schemas' })
    expect(findNodeByLabel(tree, 'public')).toMatchObject({
      kind: 'schema',
      scope: 'schema:public',
    })
    expect(findNodeByLabel(tree, 'Zone Configurations')).toMatchObject({ label: 'Zone Configurations' })
    expect(findNodeByLabel(tree, 'Cluster')).toMatchObject({ label: 'Cluster' })
    expect(findNodeByLabel(tree, 'Ranges')).toMatchObject({ label: 'Ranges' })
    expect(findNodeByLabel(tree, 'Regions / Localities')).toMatchObject({ label: 'Regions / Localities' })
    expect(findNodeByLabel(tree, 'Cluster Settings')).toMatchObject({ label: 'Cluster Settings' })
    expect(findNodeByLabel(tree, 'Contention')).toMatchObject({ label: 'Contention' })
  })

  it('does not invent selected SQL database names when the profile has none', () => {
    const connections = [
      {
        connection: {
          ...cockroachConnection(),
          id: 'conn-sqlserver-empty',
          name: 'SQL Server',
          engine: 'sqlserver' as const,
          icon: 'sqlserver',
          port: 1433,
          database: undefined,
          auth: {},
        },
        forbiddenLabel: 'master',
      },
      {
        connection: { ...cockroachConnection(), database: undefined },
        forbiddenLabel: 'defaultdb',
      },
      {
        connection: { ...mysqlConnection(), database: undefined },
        forbiddenLabel: 'datapadplusplus',
      },
      {
        connection: { ...oracleConnection(), database: undefined, oracleOptions: undefined },
        forbiddenLabel: 'ORCLPDB1',
      },
    ]

    for (const { connection, forbiddenLabel } of connections) {
      const tree = buildConnectionObjectTree(connection, adapterManifestFor(connection))

      expect(findNodeByLabel(tree, forbiddenLabel)).toBeUndefined()
    }
  })

  it('builds PostgreSQL structural folders without a generic programmability bucket', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-analytics')!
    const tree = buildConnectionObjectTree(connection, adapterManifestFor(connection))
    const userSchemas = findNodeByLabel(tree, 'User Schemas')
    const publicSchema = findNodeByLabel(tree, 'public')

    expect(userSchemas?.children?.map((node) => node.label)).toEqual(['public'])
    expect(publicSchema?.children?.map((node) => node.label)).toEqual([
      'Tables',
      'Views',
      'Materialized Views',
      'Indexes',
      'Functions',
      'Procedures',
      'Sequences',
      'Types',
      'Extensions',
      'Security',
    ])
    expect(publicSchema).toMatchObject({
      kind: 'schema',
      scope: 'schema:public',
    })
    expect(findNodeByLabel(tree, 'Programmability')).toBeUndefined()
  })

  it('assigns adapter scopes to PostgreSQL and CockroachDB manifest folders', () => {
    const snapshot = createSeedSnapshot()
    const postgres = snapshot.connections.find((item) => item.id === 'conn-analytics')!
    const postgresTree = buildConnectionObjectTree(postgres, adapterManifestFor(postgres))
    const cockroach = cockroachConnection()
    const cockroachTree = buildConnectionObjectTree(cockroach, adapterManifestFor(cockroach))

    expect(findNode(postgresTree, 'postgres:public:tables')).toMatchObject({
      label: 'Tables',
      scope: 'postgres:public:tables',
    })
    expect(findNode(postgresTree, 'postgres:public:functions')).toMatchObject({
      label: 'Functions',
      scope: 'postgres:public:functions',
    })
    expect(findNode(cockroachTree, 'postgres:public:tables')).toMatchObject({
      label: 'Tables',
      scope: 'postgres:public:tables',
    })
    expect(findNode(cockroachTree, 'cockroach:jobs')).toMatchObject({
      label: 'Jobs',
      scope: 'cockroach:jobs',
    })
    expect(findNode(cockroachTree, 'cockroach:contention')).toMatchObject({
      label: 'Contention',
      scope: 'cockroach:contention',
    })
  })

  it('assigns TimescaleDB-native scopes to hypertable and policy folders', () => {
    const connection = timescaleConnection()
    const tree = buildConnectionObjectTree(connection, adapterManifestFor(connection))
    const publicSchema = findNodeByLabel(tree, 'public')

    expect(publicSchema?.children?.map((node) => node.label)).toEqual([
      'Tables',
      'Hypertables',
      'Continuous Aggregates',
      'Chunks',
      'Compression',
      'Retention',
      'Jobs',
      'Views',
      'Materialized Views',
      'Indexes',
      'Functions',
      'Procedures',
      'Sequences',
      'Types',
      'Extensions',
      'Security',
    ])
    expect(findNode(tree, 'timescale:public:hypertables')).toMatchObject({
      label: 'Hypertables',
      scope: 'timescale:public:hypertables',
    })
    expect(findNode(tree, 'timescale:public:continuous-aggregates')).toMatchObject({
      label: 'Continuous Aggregates',
      scope: 'timescale:public:continuous-aggregates',
    })
    expect(findNode(tree, 'timescale:public:jobs')).toMatchObject({
      label: 'Jobs',
      scope: 'timescale:public:jobs',
    })
  })

  it('builds MySQL structural folders in a native workbench shape', () => {
    const connection = mysqlConnection()
    const tree = buildConnectionObjectTree(connection, adapterManifestFor(connection))

    const database = findNodeByLabel(tree, 'datapadplusplus')

    expect(findNodeByLabel(tree, 'Databases')).toMatchObject({ label: 'Databases' })
    expect(database).toMatchObject({ kind: 'database' })
    expect(database?.children?.map((node) => node.label)).toEqual([
      'Tables',
      'Views',
      'Stored Procedures',
      'Functions',
      'Events',
      'Triggers',
      'Indexes',
      'Storage',
    ])
    expect(findNodeByLabel(tree, 'Users / Privileges')).toMatchObject({ kind: 'security' })
    expect(findNodeByLabel(tree, 'System Schemas')).toMatchObject({ label: 'System Schemas' })
    expect(findNodeByLabel(tree, 'Programmability')).toBeUndefined()
  })

  it('builds Mongo structural folders without invented collection leaves', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')

    const tree = buildConnectionObjectTree(connection!)

    expect(findNode(tree, 'database-catalog')).toMatchObject({ label: 'catalog' })
    expect(findNode(tree, 'collections')).toMatchObject({ label: 'Collections' })
    expect(findNode(tree, 'views')).toMatchObject({ label: 'Views' })
    expect(findNode(tree, 'gridfs')).toMatchObject({ label: 'GridFS' })
    expect(findNode(tree, 'users')).toMatchObject({ label: 'Users' })
    expect(findNode(tree, 'roles')).toMatchObject({ label: 'Roles' })
    expect(findNode(tree, 'collection-products')).toBeUndefined()
  })

  it('derives stable section ids and group labels', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')

    expect(sidebarSectionId('connections', 'database-type', 'NoSQL / Document')).toBe(
      'connections:database-type:nosql-document',
    )
    expect(connectionGroupLabel(connection!, 'none', snapshot.environments)).toBe('Connections')
    expect(connectionGroupLabel(connection!, 'database-type', snapshot.environments)).toBe(
      'NoSQL / Document',
    )
    expect(connectionGroupLabel(connection!, 'environment', snapshot.environments)).toBe('Dev')
  })

  it('normalizes environment accent colors into custom CSS variables', () => {
    const style = environmentAccentVariables({
      ...createSeedSnapshot().environments[0]!,
      color: '#2db',
    }) as Record<string, string>

    expect(style['--connection-env-color']).toBe('#22ddbb')
    expect(style['--connection-env-tint']).toBe('rgba(34, 221, 187, 0.09)')
    expect(style['--connection-env-border']).toBe('rgba(34, 221, 187, 0.5)')
  })

  it('maps explorer collection nodes to Mongo builder targets', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')
    const node: ExplorerNode = {
      id: 'collection-products',
      label: 'products',
      kind: 'collection',
      detail: 'collection',
      family: 'document',
      path: ['catalog', 'Collections'],
      scope: 'collection:catalog:products',
    }

    expect(isExplorerNodeQueryable(node)).toBe(true)
    expect(explorerNodeTarget(node, connection)).toMatchObject({
      kind: 'collection',
      label: 'products',
      preferredBuilder: 'mongo-find',
      scope: 'collection:catalog:products',
    })
  })

  it('maps Mongo aggregation nodes to the aggregation builder target', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')
    const node: ExplorerNode = {
      id: 'aggregations:catalog:products',
      label: 'Aggregations',
      kind: 'aggregations',
      detail: 'Aggregation pipeline template',
      family: 'document',
      path: ['catalog', 'Collections', 'products'],
      scope: 'aggregation:catalog:products',
    }

    expect(isExplorerNodeQueryable(node)).toBe(true)
    expect(explorerNodeTarget(node, connection)).toMatchObject({
      kind: 'aggregations',
      label: 'Aggregations',
      preferredBuilder: 'mongo-aggregation',
      scope: 'aggregation:catalog:products',
    })
  })

  it('maps explorer Redis prefixes to key-browser scoped targets', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-cache')
    const node: ExplorerNode = {
      id: 'prefix-perf',
      label: 'perf:*',
      kind: 'prefix',
      detail: '51 key(s)',
      family: 'keyvalue',
      path: ['Session Redis'],
      scope: 'prefix:perf:',
      queryTemplate: 'SCAN 0 MATCH perf:* COUNT 50',
      expandable: true,
    }

    expect(isExplorerNodeQueryable(node)).toBe(true)
    expect(explorerNodeTarget(node, connection)).toMatchObject({
      kind: 'prefix',
      label: 'perf:*',
      preferredBuilder: 'redis-key-browser',
      queryTemplate: expect.stringContaining('"mode": "redis-key-browser"'),
      scope: 'prefix:perf:',
    })
  })

  it('assigns Redis manifest scopes and treats databases as key-browser targets', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-cache')!
    const tree = buildConnectionObjectTree(connection, adapterManifestFor(connection))

    expect(findNode(tree, 'redis:databases')).toMatchObject({
      label: 'Databases',
      scope: 'databases',
    })
    expect(findNode(tree, 'redis:db:0')).toMatchObject({
      label: 'DB 0',
      kind: 'database',
      scope: 'db:0',
      queryable: true,
      builderKind: 'redis-key-browser',
      queryTemplate: expect.stringContaining('"database": 0'),
    })
    expect(findNode(tree, 'redis:db:0:keys')).toMatchObject({
      label: 'Keys',
      scope: 'db:0:type:keys',
    })
  })

  it('uses Valkey-specific manifest copy without Redis Stack claims', () => {
    const connection: ConnectionProfile = {
      ...createSeedSnapshot().connections.find((item) => item.id === 'conn-cache')!,
      id: 'conn-valkey',
      name: 'Valkey',
      engine: 'valkey',
      icon: 'valkey',
    }
    const tree = buildConnectionObjectTree(connection, adapterManifestFor(connection))

    expect(findNode(tree, 'redis:databases')).toMatchObject({
      detail: 'Logical Valkey databases',
    })
    expect(findNode(tree, 'redis:db:0')).toMatchObject({
      detail: 'Valkey logical database',
      builderKind: 'redis-key-browser',
    })
    expect(findNode(tree, 'redis:functions')).toBeUndefined()
    expect(JSON.stringify(datastoreTreeForEngine('valkey', 'keyvalue'))).not.toContain('Redis Stack')
  })

  it('maps Redis database explorer nodes to DB-scoped key-browser targets', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-cache')!
    const tree = buildConnectionObjectTreeFromExplorerNodes(connection, [
      {
        id: 'redis:db:1',
        label: 'DB 1',
        kind: 'database',
        detail: '25 keys',
        family: 'keyvalue',
        path: [connection.name],
        scope: 'db:1',
        expandable: true,
      },
    ])
    const database = findNode(tree, 'redis:db:1')

    expect(database).toMatchObject({
      label: 'DB 1',
      kind: 'database',
      queryable: true,
      builderKind: 'redis-key-browser',
      queryTemplate: expect.stringContaining('"database": 1'),
    })
    expect(connectionTreeNodeTarget(database!)).toMatchObject({
      preferredBuilder: 'redis-key-browser',
      scope: 'db:1',
      queryTemplate: expect.stringContaining('"pattern": "*"'),
    })
  })

  it('maps Redis prefix nodes to the Redis key browser instead of a raw console template', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-cache')!
    const tree = buildConnectionObjectTreeFromExplorerNodes(connection, [
      {
        id: 'prefix-perf',
        label: 'perf:*',
        kind: 'prefix',
        detail: '51 key(s)',
        family: 'keyvalue',
        path: [connection.name],
        scope: 'prefix:perf:',
        queryTemplate: 'SCAN 0 MATCH perf:* COUNT 50',
        expandable: true,
      },
    ])

    const prefix = findNode(tree, 'prefix-perf')

    expect(prefix).toMatchObject({
      label: 'perf:*',
      kind: 'prefix',
      queryable: true,
      builderKind: 'redis-key-browser',
      queryTemplate: expect.stringContaining('"pattern": "perf:*"'),
    })
    expect(connectionTreeNodeTarget(prefix!)).toMatchObject({
      preferredBuilder: 'redis-key-browser',
      queryTemplate: expect.stringContaining('"mode": "redis-key-browser"'),
    })
  })

  it('does not treat internal metadata templates as scoped user queries', () => {
    const node: ConnectionTreeNode = {
      id: 'schema-public',
      label: 'public',
      kind: 'schema',
      detail: 'schema',
      queryTemplate: 'select table_name from information_schema.tables',
    }

    expect(isScopedQueryable(node)).toBe(false)
  })

  it('builds connection object nodes from live explorer metadata', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')!
    const tree = buildConnectionObjectTreeFromExplorerNodes(connection, [
      {
        id: 'database:catalog',
        label: 'catalog',
        kind: 'database',
        detail: 'MongoDB database',
        family: 'document',
        scope: 'database:catalog',
        expandable: true,
      },
      {
        id: 'collection:catalog:products',
        label: 'products',
        kind: 'collection',
        detail: 'Documents, indexes, and validators',
        family: 'document',
        path: ['catalog', 'Collections'],
        scope: 'collection:catalog:products',
        queryTemplate: '{ "database": "catalog", "collection": "products", "filter": {} }',
        expandable: true,
      },
      {
        id: 'indexes:catalog:products',
        label: 'Indexes',
        kind: 'indexes',
        detail: '2 index(es)',
        family: 'document',
        path: ['catalog', 'Collections', 'products'],
      },
      {
        id: 'index:catalog:products:sku_1',
        label: 'sku_1',
        kind: 'index',
        detail: '1 field',
        family: 'document',
        path: ['catalog', 'Collections', 'products', 'Indexes'],
      },
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({
      label: 'Databases',
      kind: 'databases',
    })
    expect(tree[0]?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'create-database',
          command: 'open-object-view',
          objectViewKind: 'databases',
          objectViewNodeId: 'databases',
          objectViewPath: [],
        }),
      ]),
    )
    const createDatabaseAction = tree[0]?.actions?.find((action) => action.id === 'create-database')
    expect(createDatabaseAction).toBeDefined()
    expect(connectionTreeNodeForAction(tree[0]!, createDatabaseAction!)).toMatchObject({
      id: 'databases',
      label: 'Create Database',
      kind: 'databases',
      path: [],
      queryTemplate: undefined,
      queryable: false,
    })
    expect(tree[0]?.children?.[0]).toMatchObject({
      label: 'catalog',
      kind: 'database',
    })

    const catalog = findNode(tree, 'database:catalog')
    expect(catalog?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'create-collection',
          command: 'open-object-view',
          objectViewKind: 'database',
          objectViewNodeId: 'database:catalog',
        }),
        expect.objectContaining({
          id: 'drop-database',
          command: 'open-object-view',
          objectViewKind: 'database',
          objectViewNodeId: 'database:catalog',
          separatorBefore: true,
        }),
      ]),
    )

    const collections = findNodeByLabel(tree, 'Collections')
    expect(collections?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'create-collection',
          command: 'open-object-view',
          objectViewKind: 'database',
          objectViewNodeId: 'database:catalog',
        }),
      ]),
    )

    const products = findNode(tree, 'collection:catalog:products')
    expect(products).toMatchObject({
      id: 'collection:catalog:products',
      label: 'products',
      builderKind: 'mongo-find',
      queryable: true,
      expandable: true,
    })
    expect(products?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'update-validator',
          command: 'open-object-view',
          objectViewKind: 'validation-rules',
          objectViewNodeId: 'validation-rules:catalog:products',
        }),
        expect.objectContaining({
          id: 'rename-collection',
          command: 'open-object-view',
          objectViewKind: 'collection',
          objectViewNodeId: 'collection:catalog:products',
        }),
        expect.objectContaining({
          id: 'modify-collection',
          command: 'open-object-view',
          objectViewKind: 'collection',
          objectViewNodeId: 'collection:catalog:products',
        }),
        expect.objectContaining({
          id: 'convert-to-capped',
          command: 'open-object-view',
          objectViewKind: 'collection',
          objectViewNodeId: 'collection:catalog:products',
        }),
        expect.objectContaining({
          id: 'clone-as-capped',
          command: 'open-object-view',
          objectViewKind: 'collection',
          objectViewNodeId: 'collection:catalog:products',
        }),
        expect.objectContaining({
          id: 'compact-collection',
          command: 'open-object-view',
          objectViewKind: 'collection',
          objectViewNodeId: 'collection:catalog:products',
        }),
        expect.objectContaining({
          id: 'validate-collection',
          command: 'open-object-view',
          objectViewKind: 'collection',
          objectViewNodeId: 'collection:catalog:products',
        }),
        expect.objectContaining({
          id: 'drop-collection',
          command: 'open-object-view',
          objectViewKind: 'collection',
          objectViewNodeId: 'collection:catalog:products',
          separatorBefore: true,
        }),
      ]),
    )

    const renameAction = products?.actions?.find((action) => action.id === 'rename-collection')
    expect(renameAction).toBeDefined()
    expect(connectionTreeNodeForAction(products!, renameAction!)).toMatchObject({
      id: 'collection:catalog:products',
      label: 'Rename Collection',
      kind: 'collection',
      queryTemplate: undefined,
      queryable: false,
    })

    const indexes = findNode(tree, 'indexes:catalog:products')
    expect(indexes).toMatchObject({
      id: 'indexes:catalog:products',
      label: 'Indexes',
    })
    expect(indexes?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'create-index',
          command: 'open-object-view',
          objectViewKind: 'create-index',
          objectViewNodeId: 'create-index:catalog:products',
        }),
      ]),
    )

    const index = findNode(tree, 'index:catalog:products:sku_1')
    expect(index?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'drop-index',
          command: 'open-object-view',
          objectViewKind: 'indexes',
          objectViewNodeId: 'indexes:catalog:products',
          separatorBefore: true,
        }),
      ]),
    )
  })

  it('keeps Redis stream drilldowns under the selected stream key', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-cache')!
    const tree = buildConnectionObjectTreeFromExplorerNodes(connection, [
      {
        id: 'redis:stream:0:orders%3Aevents:groups',
        label: 'Consumer Groups',
        kind: 'stream-groups',
        detail: 'XINFO GROUPS',
        family: 'keyvalue',
        path: [connection.name, 'Databases', 'DB 0', 'Streams', 'orders:events'],
        expandable: true,
      },
    ])

    const stream = findNodeByLabel(tree, 'orders:events')
    const groups = findNode(tree, 'redis:stream:0:orders%3Aevents:groups')

    expect(stream?.children?.map((child) => child.id)).toContain('redis:stream:0:orders%3Aevents:groups')
    expect(groups).toMatchObject({
      label: 'Consumer Groups',
      kind: 'stream-groups',
      queryable: false,
    })
  })

  it('organizes live SQL metadata into expected schema object groups', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-analytics')!
    const tree = buildConnectionObjectTreeFromExplorerNodes(connection, [
      {
        id: 'schema-public',
        label: 'public',
        kind: 'schema',
        family: 'sql',
        path: [connection.name],
        scope: 'schema:public',
        detail: 'schema',
        expandable: true,
      },
      {
        id: 'public.accounts',
        label: 'accounts',
        kind: 'BASE TABLE',
        family: 'sql',
        path: [connection.name, 'public'],
        scope: 'table:public.accounts',
        detail: 'table',
      },
      {
        id: 'public.active_accounts',
        label: 'active_accounts',
        kind: 'view',
        family: 'sql',
        path: [connection.name, 'public'],
        scope: 'view:public.active_accounts',
        detail: 'view',
      },
    ])

    expect(tree[0]).toMatchObject({ label: 'User Schemas' })
    expect(findNode(tree, 'schema-public')).toMatchObject({
      label: 'public',
      kind: 'schema',
      expandable: true,
    })
    expect(findNode(tree, 'category:conn-analytics:User Schemas/public/Tables')).toMatchObject({
      label: 'Tables',
    })
    expect(findNode(tree, 'public.accounts')).toMatchObject({
      label: 'accounts',
      kind: 'table',
      queryTemplate: 'select * from public.accounts limit 100;',
    })
    expect(findNode(tree, 'public.active_accounts')).toMatchObject({
      label: 'active_accounts',
      kind: 'view',
    })
  })

  it('separates SQL system schemas and exposes management actions on object folders', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-analytics')!
    const tree = buildConnectionObjectTreeFromExplorerNodes(connection, [
      {
        id: 'schema-public',
        label: 'public',
        kind: 'schema',
        family: 'sql',
        path: [connection.name],
        scope: 'schema:public',
        detail: 'schema',
        expandable: true,
      },
      {
        id: 'schema-pg-catalog',
        label: 'pg_catalog',
        kind: 'schema',
        family: 'sql',
        path: [connection.name],
        scope: 'schema:pg_catalog',
        detail: 'schema',
        expandable: true,
      },
      {
        id: 'pg_catalog.pg_class',
        label: 'pg_class',
        kind: 'BASE TABLE',
        family: 'sql',
        path: [connection.name, 'pg_catalog'],
        scope: 'table:pg_catalog.pg_class',
        detail: 'system table',
      },
    ])

    expect(findNode(tree, 'category:conn-analytics:User Schemas')).toMatchObject({
      label: 'User Schemas',
    })
    expect(findNode(tree, 'category:conn-analytics:System Schemas')).toMatchObject({
      label: 'System Schemas',
    })
    expect(findNode(tree, 'category:conn-analytics:System Schemas/pg_catalog/System Tables')).toMatchObject({
      label: 'System Tables',
    })
  })

  it('adds SQL Server-style programmability folders with create procedure actions', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-orders')!
    const tree = buildConnectionObjectTree(connection)
    const databases = findNode(tree, 'databases')
    const database = findNode(tree, 'database-orders')
    const tables = findNode(tree, 'tables')
    const storedProcedures = findNode(tree, 'stored-procedures')

    expect(databases).toMatchObject({ label: 'Databases' })
    expect(database).toMatchObject({ label: 'orders', kind: 'database' })
    expect(tables).toMatchObject({ label: 'Tables', kind: 'tables' })
    expect(findNode(tree, 'system-tables')).toBeUndefined()
    expect(findNode(tree, 'filetables')).toBeUndefined()
    expect(findNode(tree, 'external-tables')).toBeUndefined()
    expect(findNode(tree, 'graph-tables')).toBeUndefined()
    expect(storedProcedures).toMatchObject({
      label: 'Stored Procedures',
      kind: 'stored-procedures',
    })
    expect(storedProcedures?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'Create Stored Procedure...',
          queryTemplate: expect.stringContaining('create procedure'),
        }),
      ]),
    )
    const serverObjects = findNode(tree, 'server-objects')
    expect(serverObjects).toMatchObject({ label: 'Server Objects' })
    expect(serverObjects?.children?.map((node) => node.label)).toEqual([
      'Linked Servers',
      'Endpoints',
    ])
    expect(findNode(tree, 'always-on-high-availability')).toBeUndefined()
    expect(tree.some((node) => node.label === 'Linked Servers')).toBe(false)
    expect(tree.some((node) => node.label === 'Availability Groups')).toBe(false)
  })

  it('assigns adapter scopes to SQL Server manifest folders so branches load directly', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-orders')!
    const tree = buildConnectionObjectTree(connection, adapterManifestFor(connection))

    expect(findNode(tree, 'database:orders')).toMatchObject({
      label: 'orders',
      scope: 'database:orders',
    })
    expect(findNode(tree, 'sqlserver:orders:tables')).toMatchObject({
      label: 'Tables',
      scope: 'sqlserver:orders:tables',
    })
    expect(findNode(tree, 'sqlserver:orders:security.users')).toMatchObject({
      label: 'Users',
      scope: 'sqlserver:orders:security.users',
    })
    expect(findNode(tree, 'sqlserver:orders:performance')).toMatchObject({
      label: 'Performance',
      scope: 'sqlserver:orders:performance',
    })
    expect(findNode(tree, 'system-tables')).toBeUndefined()
    expect(findNodeByLabel(tree, 'Agent')).toBeUndefined()
  })

  it('organizes live SQL Server metadata into SSMS-style database folders', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-orders')!
    const tree = buildConnectionObjectTreeFromExplorerNodes(connection, [
      {
        id: 'dbo.accounts',
        label: 'accounts',
        kind: 'BASE TABLE',
        family: 'sql',
        path: [connection.name, 'dbo'],
        scope: 'table:dbo.accounts',
        detail: 'table',
      },
      {
        id: 'dbo.active_accounts',
        label: 'active_accounts',
        kind: 'view',
        family: 'sql',
        path: [connection.name, 'dbo'],
        scope: 'view:dbo.active_accounts',
        detail: 'view',
      },
      {
        id: 'dbo.refresh_rollups',
        label: 'refresh_rollups',
        kind: 'stored procedure',
        family: 'sql',
        path: [connection.name, 'dbo'],
        scope: 'procedure:dbo.refresh_rollups',
        detail: 'stored procedure',
      },
      {
        id: 'dbo.calculate_total',
        label: 'calculate_total',
        kind: 'function',
        family: 'sql',
        path: [connection.name, 'dbo'],
        scope: 'function:dbo.calculate_total',
        detail: 'function',
      },
    ])

    expect(findNode(tree, 'category:conn-orders:Databases/orders/Tables')).toMatchObject({
      label: 'Tables',
    })
    expect(findNode(tree, 'dbo.accounts')).toMatchObject({
      label: 'dbo.accounts',
      kind: 'table',
      queryTemplate: 'select top 100 * from [dbo].[accounts];',
    })
    expect(findNode(tree, 'category:conn-orders:Databases/orders/Views')).toMatchObject({
      label: 'Views',
    })
    expect(findNode(tree, 'dbo.active_accounts')).toMatchObject({
      label: 'dbo.active_accounts',
      kind: 'view',
    })
    expect(findNode(tree, 'category:conn-orders:Databases/orders/Programmability/Stored Procedures')).toMatchObject({
      label: 'Stored Procedures',
    })
    expect(findNode(tree, 'dbo.refresh_rollups')).toMatchObject({
      label: 'dbo.refresh_rollups',
      kind: 'stored-procedure',
    })
    expect(findNode(tree, 'category:conn-orders:Databases/orders/Programmability/Functions')).toMatchObject({
      label: 'Functions',
    })
  })

  it('does not duplicate SQL Server category nodes when live metadata sends category kinds', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-orders')!
    const tree = buildConnectionObjectTreeFromExplorerNodes(connection, [
      {
        id: 'live-tables-folder',
        label: 'Tables',
        kind: 'tables',
        family: 'sql',
        path: [connection.name, 'Databases', 'orders', 'Tables'],
        detail: 'tables folder',
      },
      {
        id: 'dbo.accounts',
        label: 'accounts',
        kind: 'BASE TABLE',
        family: 'sql',
        path: [connection.name, 'Databases', 'orders', 'Tables'],
        scope: 'table:dbo.accounts',
        detail: 'table',
      },
    ])

    const tables = findNode(tree, 'live-tables-folder')

    expect(tables).toMatchObject({ label: 'Tables', kind: 'tables' })
    expect(tables?.children?.some((node) => node.label === 'Tables')).toBe(false)
    expect(findNode(tree, 'dbo.accounts')).toMatchObject({
      label: 'dbo.accounts',
      kind: 'table',
    })
  })

  it('keeps live SQLite metadata under the main database root', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-local-sqlite')!
    const tree = buildConnectionObjectTreeFromExplorerNodes(connection, [
      {
        id: 'sqlite-tables-folder',
        label: 'Tables',
        kind: 'tables',
        family: 'sql',
        path: ['Tables'],
        detail: 'tables folder',
      },
      {
        id: 'main.accounts',
        label: 'accounts',
        kind: 'table',
        family: 'sql',
        path: ['Tables'],
        scope: 'table:main.accounts',
        detail: 'table',
      },
    ])

    expect(tree[0]).toMatchObject({ label: 'Main Database', kind: 'main-database' })
    expect(tree.some((node) => node.label === 'Tables')).toBe(false)
    expect(findNode(tree, 'sqlite-tables-folder')).toMatchObject({
      label: 'Tables',
      kind: 'tables',
    })
    expect(findNode(tree, 'main.accounts')).toMatchObject({
      label: 'accounts',
      kind: 'table',
      queryTemplate: 'select * from [main].[accounts] limit 100;',
    })
  })
})

function oracleConnection(): ConnectionProfile {
  return {
    id: 'conn-oracle',
    name: 'Oracle',
    engine: 'oracle',
    family: 'sql',
    host: 'localhost',
    port: 1521,
    database: 'FREEPDB1',
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: true,
    icon: 'OR',
    group: 'Connections',
    auth: { username: 'APP' },
    oracleOptions: { connectMode: 'service-name', serviceName: 'FREEPDB1' },
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
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'cockroachdb',
    group: 'Connections',
    auth: { username: 'root' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function timescaleConnection(): ConnectionProfile {
  return {
    id: 'conn-timescale',
    name: 'TimescaleDB',
    engine: 'timescaledb',
    family: 'sql',
    host: 'localhost',
    port: 5432,
    database: 'metrics',
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'timescaledb',
    group: 'Connections',
    auth: { username: 'postgres' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function mysqlConnection(): ConnectionProfile {
  return {
    id: 'conn-mysql',
    name: 'MySQL',
    engine: 'mysql',
    family: 'sql',
    host: 'localhost',
    port: 3306,
    database: 'datapadplusplus',
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'mysql',
    group: 'Connections',
    auth: { username: 'root' },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function adapterManifestFor(connection: ConnectionProfile): AdapterManifest {
  const defaultLanguage: AdapterManifest['defaultLanguage'] =
    connection.family === 'keyvalue'
      ? 'redis'
      : connection.family === 'document'
        ? 'mongodb'
        : 'sql'

  return {
    id: `adapter-${connection.engine}`,
    engine: connection.engine,
    family: connection.family,
    label: `${connection.engine} adapter`,
    maturity: 'mvp',
    capabilities: [],
    defaultLanguage,
    tree: datastoreTreeForEngine(connection.engine, connection.family),
  }
}

function findNode(
  nodes: ConnectionTreeNode[],
  id: string,
): ConnectionTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node
    }

    const child = node.children ? findNode(node.children, id) : undefined

    if (child) {
      return child
    }
  }

  return undefined
}

function findNodeByLabel(
  nodes: ConnectionTreeNode[],
  label: string,
): ConnectionTreeNode | undefined {
  for (const node of nodes) {
    if (node.label === label) {
      return node
    }

    const child = node.children ? findNodeByLabel(node.children, label) : undefined

    if (child) {
      return child
    }
  }

  return undefined
}
