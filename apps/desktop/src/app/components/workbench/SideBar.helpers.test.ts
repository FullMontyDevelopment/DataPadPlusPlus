import { describe, expect, it } from 'vitest'
import type { AdapterManifest, ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import { datastoreTreeForEngine } from '@datapadplusplus/shared-types'
import { createSeedSnapshot } from '../../../test/fixtures/seed-workspace'
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
} from './SideBar.helpers'
import type { ConnectionTreeNode } from './SideBar.helpers'

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
    expect(findNodeByLabel(tree, 'Pragmas')).toMatchObject({ label: 'Pragmas' })
    expect(findNode(tree, 'table-accounts')).toBeUndefined()
  })

  it('builds Oracle structural folders for containers, schemas, and PL/SQL objects', () => {
    const connection = oracleConnection()
    const tree = buildConnectionObjectTree(connection, adapterManifestFor(connection))

    expect(findNodeByLabel(tree, 'Containers')).toMatchObject({ label: 'Containers' })
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
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({
      label: 'catalog',
      kind: 'database',
    })

    const products = findNode(tree, 'collection:catalog:products')
    expect(products).toMatchObject({
      id: 'collection:catalog:products',
      label: 'products',
      builderKind: 'mongo-find',
      queryable: true,
      expandable: true,
    })
    expect(findNode(tree, 'indexes:catalog:products')).toMatchObject({
      id: 'indexes:catalog:products',
      label: 'Indexes',
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
    expect(findNode(tree, 'system-tables')).toMatchObject({ label: 'System Tables' })
    expect(findNode(tree, 'filetables')).toMatchObject({ label: 'FileTables' })
    expect(findNode(tree, 'external-tables')).toMatchObject({ label: 'External Tables' })
    expect(findNode(tree, 'graph-tables')).toMatchObject({ label: 'Graph Tables' })
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
    expect(findNode(tree, 'server-objects')).toMatchObject({ label: 'Server Objects' })
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
      queryTemplate: 'select top 100 * from dbo.accounts;',
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
