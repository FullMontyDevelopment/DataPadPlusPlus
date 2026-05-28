import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { describe, expect, it } from 'vitest'
import { fallbackConnectionTree } from './SideBar.connection-tree-fallbacks'
import type { ConnectionTreeNode } from './SideBar.connection-tree-types'

describe('fallbackConnectionTree', () => {
  it('keeps the SQLite fallback tree native and maintenance-focused', () => {
    const tree = fallbackConnectionTree(sqlConnection({
      engine: 'sqlite',
      family: 'sql',
      icon: 'sqlite',
      database: 'local.sqlite',
    }))

    expect(labels(tree)).toEqual(['Main Database', 'Diagnostics'])
    expect(labels(findNode(tree, 'Main Database')?.children ?? [])).toEqual([
      'Tables',
      'Views',
      'Indexes',
      'Triggers',
      'Maintenance',
    ])
    expect(findNode(tree, 'Stored Procedures')).toBeUndefined()
    expect(findNode(tree, 'System Schemas')).toBeUndefined()
  })

  it('keeps optional SQL Server service folders out of the fallback tree', () => {
    const tree = fallbackConnectionTree(sqlConnection({
      engine: 'sqlserver',
      icon: 'sqlserver',
      database: 'datapadplusplus',
    }))

    expect(findNode(tree, 'Extended Events')).toBeTruthy()
    expect(findNode(tree, 'Integration Services Catalogs')).toBeUndefined()
    expect(findNode(tree, 'Analysis Services')).toBeUndefined()
    expect(findNode(tree, 'Reporting Services')).toBeUndefined()
  })

  it('renders a Redis-native fallback tree without unavailable module clutter', () => {
    const tree = fallbackConnectionTree(redisConnection())

    expect(labels(tree)).toEqual([
      'Databases',
      'Lua Scripts',
      'ACL / Security',
      'Diagnostics',
    ])

    expect(findNode(tree, 'DB 0')).toBeTruthy()
    expect(labels(findNode(tree, 'DB 0')?.children ?? [])).toEqual([
      'Keys',
      'Strings',
      'Hashes',
      'Lists',
      'Sets',
      'Sorted Sets',
      'Streams',
    ])

    expect(findNode(tree, 'JSON')).toBeUndefined()
    expect(findNode(tree, 'Search Indexes')).toBeUndefined()
    expect(findNode(tree, 'Vector Indexes')).toBeUndefined()
    expect(findNode(tree, 'Cluster')).toBeUndefined()
    expect(findNode(tree, 'Sentinel')).toBeUndefined()
  })

  it('uses the configured Redis database index in the fallback tree', () => {
    const tree = fallbackConnectionTree(redisConnection({ redisOptions: { databaseIndex: 3 } }))

    expect(findNode(tree, 'DB 3')).toBeTruthy()
    expect(findNode(tree, 'DB 0')).toBeUndefined()
  })

  it('shows Redis cluster and sentinel branches only for matching deployment modes', () => {
    const clusterTree = fallbackConnectionTree(redisConnection({
      redisOptions: { deploymentMode: 'cluster' },
    }))
    const sentinelTree = fallbackConnectionTree(redisConnection({
      redisOptions: { deploymentMode: 'sentinel' },
    }))

    expect(findNode(clusterTree, 'Cluster')).toBeTruthy()
    expect(findNode(clusterTree, 'Sentinel')).toBeUndefined()
    expect(findNode(sentinelTree, 'Sentinel')).toBeTruthy()
    expect(findNode(sentinelTree, 'Cluster')).toBeUndefined()
  })

  it('uses the Redis-native fallback tree for Valkey connections', () => {
    const tree = fallbackConnectionTree(redisConnection({ engine: 'valkey' }))

    expect(findNode(tree, 'Databases')).toBeTruthy()
    expect(findNode(tree, 'Keys')).toBeTruthy()
    expect(findNode(tree, 'Search Indexes')).toBeUndefined()
  })

  it('renders DynamoDB fallback access and diagnostic areas', () => {
    const tree = fallbackConnectionTree(connection({
      engine: 'dynamodb',
      family: 'widecolumn',
      icon: 'dynamodb',
    }))

    expect(labels(tree)).toEqual(['Tables', 'Access', 'Diagnostics'])
    expect(labels(findNode(tree, 'Access')?.children ?? [])).toEqual([
      'Permissions',
      'Table Policies',
    ])
    expect(labels(findNode(tree, 'Diagnostics')?.children ?? [])).toEqual([
      'Capacity',
      'Hot Partitions',
      'Alarms',
      'Backups',
    ])
  })

  it('renders Cassandra fallback keyspace, cluster, security, and diagnostics areas', () => {
    const tree = fallbackConnectionTree(connection({
      engine: 'cassandra',
      family: 'widecolumn',
      icon: 'cassandra',
      database: 'commerce',
    }))

    expect(labels(tree)).toEqual(['commerce', 'Cluster', 'Security', 'Diagnostics'])
    expect(labels(findNode(tree, 'commerce')?.children ?? [])).toEqual([
      'Tables',
      'Materialized Views',
      'Indexes',
      'Types',
      'Functions',
      'Aggregates',
      'Permissions',
    ])
  })

  it('renders search engine fallback trees with native admin surfaces', () => {
    const tree = fallbackConnectionTree(connection({
      engine: 'opensearch',
      family: 'search',
      icon: 'opensearch',
    }))

    expect(labels(tree)).toEqual([
      'Cluster',
      'Indices',
      'Data Streams',
      'Aliases',
      'Templates',
      'Pipelines',
      'Security',
      'Diagnostics',
    ])
    expect(labels(findNode(tree, 'Templates')?.children ?? [])).toEqual([
      'Index Templates',
      'Component Templates',
    ])
    expect(labels(findNode(tree, 'Security')?.children ?? [])).toEqual([
      'Users',
      'Roles',
      'API Keys',
    ])
  })

  it('renders warehouse fallback trees with compute, jobs, security, and diagnostics', () => {
    const snowflakeTree = fallbackConnectionTree(connection({
      engine: 'snowflake',
      family: 'warehouse',
      icon: 'snowflake',
      database: 'analytics',
    }))
    const bigQueryTree = fallbackConnectionTree(connection({
      engine: 'bigquery',
      family: 'warehouse',
      icon: 'bigquery',
      database: 'sales',
    }))

    expect(labels(snowflakeTree)).toEqual([
      'Databases',
      'Warehouses',
      'Tasks & Query History',
      'Security',
      'Diagnostics',
    ])
    expect(labels(findNode(snowflakeTree, 'analytics')?.children ?? [])).toEqual([
      'Tables',
      'Views',
      'Materialized Views',
      'Stages',
      'Tasks & Query History',
    ])
    expect(labels(bigQueryTree)).toEqual([
      'Datasets',
      'Reservations',
      'Jobs',
      'Security',
      'Diagnostics',
    ])
    expect(findNode(bigQueryTree, 'External Tables')).toBeTruthy()
  })
})

function labels(nodes: ConnectionTreeNode[]) {
  return nodes.map((node) => node.label)
}

function findNode(nodes: ConnectionTreeNode[], label: string): ConnectionTreeNode | undefined {
  for (const node of nodes) {
    if (node.label === label) {
      return node
    }

    const child = findNode(node.children ?? [], label)
    if (child) {
      return child
    }
  }

  return undefined
}

function redisConnection(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return connection({
    id: 'redis-1',
    name: 'Redis',
    engine: 'redis',
    family: 'keyvalue',
    host: 'localhost',
    port: 6379,
    database: '0',
    icon: 'redis',
    ...overrides,
  })
}

function sqlConnection(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return connection({
    id: 'sql-1',
    name: 'SQL',
    engine: 'postgresql',
    family: 'sql',
    host: 'localhost',
    database: 'app',
    icon: 'postgresql',
    ...overrides,
  })
}

function connection(overrides: Partial<ConnectionProfile>): ConnectionProfile {
  return {
    id: 'conn-1',
    name: 'Connection',
    engine: 'postgresql',
    family: 'sql',
    host: 'localhost',
    environmentIds: [],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'database',
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}
