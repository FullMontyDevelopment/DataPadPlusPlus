import { describe, expect, it } from 'vitest'
import type { ExplorerNode } from '@datapadplusplus/shared-types'
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
  it('builds SQL object nodes with scoped select templates', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-analytics')

    expect(connection).toBeDefined()

    const tree = buildConnectionObjectTree(connection!)
    const accounts = findNode(tree, 'table-accounts')

    expect(accounts).toMatchObject({
      kind: 'table',
      label: 'accounts',
      queryable: true,
      queryTemplate: 'select * from public.accounts limit 100;',
    })
  })

  it('builds SQL Server table templates using T-SQL top syntax', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-orders')

    const tree = buildConnectionObjectTree(connection!)
    const accounts = findNode(tree, 'table-accounts')

    expect(accounts?.queryTemplate).toBe('select top 100 * from dbo.accounts;')
  })

  it('builds SQLite table templates with the main schema', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-local-sqlite')

    const tree = buildConnectionObjectTree(connection!)
    const accounts = findNode(tree, 'table-accounts')

    expect(accounts?.queryTemplate).toBe('select * from [main].[accounts] limit 100;')
  })

  it('marks Mongo collection nodes as builder-capable scoped targets', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-catalog')

    const tree = buildConnectionObjectTree(connection!)
    const products = findNode(tree, 'collection-products')

    expect(products).toMatchObject({
      kind: 'collection',
      scope: 'collection:products',
      builderKind: 'mongo-find',
    })
    expect(isScopedQueryable(products!)).toBe(true)
    expect(connectionTreeNodeTarget(products!)).toMatchObject({
      kind: 'collection',
      label: 'products',
      preferredBuilder: 'mongo-find',
      queryTemplate: expect.stringContaining('"collection": "products"'),
    })
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
      detail: 'sample collection',
      family: 'document',
      path: ['catalog', 'products'],
      scope: 'collection:products',
    }

    expect(isExplorerNodeQueryable(node)).toBe(true)
    expect(explorerNodeTarget(node, connection)).toMatchObject({
      kind: 'collection',
      label: 'products',
      preferredBuilder: 'mongo-find',
      scope: 'collection:products',
    })
  })

  it('maps explorer Redis prefixes to key-browser scoped targets', () => {
    const snapshot = createSeedSnapshot()
    const connection = snapshot.connections.find((item) => item.id === 'conn-cache')
    const node: ExplorerNode = {
      id: 'prefix-perf',
      label: 'perf:*',
      kind: 'prefix',
      detail: '51 sampled key(s)',
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
        detail: '51 sampled key(s)',
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
        id: 'products',
        label: 'products',
        kind: 'collection',
        detail: 'Documents, indexes, and samples',
        family: 'document',
        path: [connection.name],
        scope: 'collection:products',
        queryTemplate: '{ "collection": "products", "filter": {} }',
        expandable: true,
      },
      {
        id: 'products:indexes',
        label: 'Indexes',
        kind: 'indexes',
        detail: '2 index(es)',
        family: 'document',
        path: [connection.name, 'products'],
      },
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({
      label: 'Databases',
      kind: 'databases',
    })

    const products = findNode(tree, 'products')
    expect(products).toMatchObject({
      id: 'products',
      label: 'products',
      builderKind: 'mongo-find',
      queryable: true,
      expandable: true,
    })
    expect(findNode(tree, 'products:indexes')).toMatchObject({
      id: 'products:indexes',
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

    expect(tree[0]).toMatchObject({ label: 'Schemas' })
    expect(findNode(tree, 'schema-public')).toMatchObject({
      label: 'public',
      kind: 'schema',
      expandable: true,
    })
    expect(findNode(tree, 'category:conn-analytics:Schemas/public/Tables')).toMatchObject({
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
})

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
