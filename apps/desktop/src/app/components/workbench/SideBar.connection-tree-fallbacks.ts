import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { branch, type ConnectionTreeNode } from './SideBar.connection-tree-types'
import { duckDbConnectionTree, sqlConnectionTree } from './SideBar.connection-tree-sql'
import {
  analyticsConnectionTree,
  graphConnectionTree,
  searchConnectionTree,
  timeseriesConnectionTree,
  wideColumnConnectionTree,
} from './SideBar.connection-tree-secondary'

export function fallbackConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  switch (connection.family) {
  case 'document':
    return documentConnectionTree(connection)
  case 'keyvalue':
    return keyValueConnectionTree(connection)
  case 'graph':
    return graphConnectionTree(connection)
  case 'timeseries':
    return timeseriesConnectionTree(connection)
  case 'widecolumn':
    return wideColumnConnectionTree(connection)
  case 'search':
    return searchConnectionTree(connection)
  case 'warehouse':
    return analyticsConnectionTree(connection)
  case 'embedded-olap':
    return connection.engine === 'duckdb'
      ? duckDbConnectionTree(connection)
      : analyticsConnectionTree(connection)
  case 'sql':
  default:
    return sqlConnectionTree(connection)
  }
}

function documentConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'mongodb') {
    if (!connection.database) {
      return [
        branch('databases', 'Databases', 'databases', 'MongoDB database namespaces', []),
      ]
    }

    return [
      branch(
        `database-${connection.database}`,
        connection.database,
        'database',
        'MongoDB database',
        [
          branch('collections', 'Collections', 'collections', 'Document collections', []),
          branch('views', 'Views', 'views', 'Read-only collection views', []),
          branch('gridfs', 'GridFS', 'gridfs', 'GridFS files and chunks collections', []),
          branch('users', 'Users', 'users', 'Database users', []),
          branch('roles', 'Roles', 'roles', 'Database roles', []),
        ],
      ),
    ]
  }

  if (connection.engine === 'litedb') {
    return liteDbConnectionTree(connection)
  }

  if (connection.engine === 'cosmosdb') {
    return cosmosConnectionTree(connection)
  }

  const database = connection.database?.trim()

  if (!database) {
    return [
      branch('databases', 'Databases', 'databases', 'Document database namespaces', []),
    ]
  }

  return [
    branch('databases', 'Databases', 'databases', 'Document database namespaces', [
      branch(`database-${database}`, database, 'database', `${connection.engine} database`, [
        branch('collections', 'Collections', 'collections', 'Document collections', []),
        branch('indexes', 'Indexes', 'indexes', 'Collection index definitions', []),
      ]),
    ]),
  ]
}

function liteDbConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = fileName(connection.database || connection.host || 'local.db')

  return [
    branch('litedb-database', database, 'database', 'LiteDB local database file', [
      branch('litedb-collections', 'Collections', 'collections', 'Document collections', []),
      branch('litedb-indexes', 'Indexes', 'indexes', 'Collection index definitions', []),
      branch('litedb-file-storage', 'File Storage', 'file-storage', 'Stored files and chunks', [
        branch('litedb-files', 'Files', 'files', 'File metadata and chunk counts', []),
        branch('litedb-chunks', 'Chunks', 'chunks', 'File chunk distribution and health', []),
      ]),
      branch('litedb-pragmas', 'Pragmas', 'pragmas', 'LiteDB file options and runtime settings', []),
      branch('litedb-maintenance', 'Maintenance', 'maintenance', 'Checkpoint, compact, rebuild, and backup workflows', []),
    ]),
    branch('litedb-diagnostics', 'Diagnostics', 'diagnostics', 'File health, index coverage, and storage warnings', []),
  ]
}

function cosmosConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = connection.database?.trim()
  const databaseChildren = database
    ? [
        branch(`cosmos-database-${database}`, database, 'database', 'Selected Cosmos DB database', [
          branch('cosmos-containers', 'Containers', 'containers', 'Containers and partitioned item stores', []),
          branch('cosmos-throughput', 'Throughput', 'throughput', 'Shared database throughput where configured', []),
          branch('cosmos-security', 'Security', 'security', 'Database access posture', []),
        ]),
      ]
    : []

  return [
    branch('cosmos-account', 'Account', 'account', 'Cosmos DB account topology and API surface', [
      branch('cosmos-databases', 'Databases', 'databases', 'Cosmos DB databases', databaseChildren),
      branch('cosmos-regions', 'Regions', 'regions', 'Read and write region topology', []),
      branch('cosmos-consistency', 'Consistency', 'consistency', 'Default consistency and session behavior', []),
      branch('cosmos-security-root', 'Security', 'security', 'RBAC, keys, networking, and access posture', []),
      branch('cosmos-diagnostics', 'Diagnostics', 'diagnostics', 'RU, throttles, latency, and storage signals', []),
    ]),
  ]
}

function keyValueConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'memcached') {
    return [
      branch('server', 'Server', 'server', 'Memcached cache server overview', [
        branch('stats', 'Stats', 'stats', 'Operational counters, hit rate, item count, and memory use', []),
        branch('slabs', 'Slabs', 'slabs', 'Slab classes, chunk sizes, and allocation pressure', []),
        branch('items', 'Item Classes', 'items', 'Item-class counts, ages, evictions, and reclaim signals', []),
        branch('known-key', 'Known Key Lookup', 'known-key', 'Targeted get/gets/write previews for application-known cache keys', []),
        branch('settings', 'Settings', 'settings', 'Cache limits, protocol flags, and LRU behavior', []),
        branch('connections', 'Connections', 'connections', 'Client connection pressure and rejected clients', []),
      ]),
      branch('diagnostics', 'Diagnostics', 'diagnostics', 'Hit ratio, evictions, memory pressure, and connection pressure', []),
    ]
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return redisConnectionTree(connection)
  }

  return [
    branch('keyspaces', 'Key Spaces', 'keyspaces', 'Logical key groups and modules', [
      branch('prefixes', 'Prefixes', 'prefixes', 'SCAN-friendly key prefixes', []),
      branch('streams', 'Streams', 'streams', 'Append-only event streams', []),
      branch('sets', 'Sets', 'sets', 'Set and sorted-set keys', []),
    ]),
  ]
}

function redisConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const databaseIndex = redisDatabaseIndex(connection)
  const engineLabel = connection.engine === 'valkey' ? 'Valkey' : 'Redis'
  const aclDetail = connection.engine === 'valkey'
    ? 'Valkey ACL users, categories, and permissions'
    : 'ACL users, categories, and permissions'
  const roots = [
    branch('redis-databases', 'Databases', 'databases', `Logical ${engineLabel} databases`, [
      branch(`redis-db-${databaseIndex}`, `DB ${databaseIndex}`, 'database', `${engineLabel} logical database`, [
        branch('redis-keys', 'Keys', 'keys', 'All key types', [], redisTypeFolderOptions(databaseIndex, 'keys')),
        branch('redis-strings', 'Strings', 'strings', 'String, bitmap, and HyperLogLog values', [], redisTypeFolderOptions(databaseIndex, 'string')),
        branch('redis-hashes', 'Hashes', 'hashes', 'Hash maps', [], redisTypeFolderOptions(databaseIndex, 'hash')),
        branch('redis-lists', 'Lists', 'lists', 'Ordered list values', [], redisTypeFolderOptions(databaseIndex, 'list')),
        branch('redis-sets', 'Sets', 'sets', 'Set values', [], redisTypeFolderOptions(databaseIndex, 'set')),
        branch('redis-sorted-sets', 'Sorted Sets', 'sorted-sets', 'Scored set values', [], redisTypeFolderOptions(databaseIndex, 'zset')),
        branch('redis-streams', 'Streams', 'streams', 'Append-only stream values', [], redisTypeFolderOptions(databaseIndex, 'stream')),
      ], redisDatabaseNodeOptions(databaseIndex)),
    ], { scope: 'databases' }),
    branch('redis-lua-scripts', 'Lua Scripts', 'lua-scripts', 'Loaded scripts and SHA workflows', [], { scope: 'lua-scripts' }),
    branch('redis-security', 'ACL / Security', 'security', aclDetail, [], { scope: 'acl' }),
    branch('redis-diagnostics', 'Diagnostics', 'diagnostics', 'INFO, SLOWLOG, memory, and latency metadata', [], { scope: 'diagnostics' }),
  ]

  if (connection.redisOptions?.deploymentMode === 'cluster') {
    roots.splice(
      1,
      0,
      branch('redis-cluster', 'Cluster', 'cluster', 'Cluster slots, nodes, and failover status', [], { scope: 'cluster' }),
    )
  }

  if (connection.redisOptions?.deploymentMode === 'sentinel') {
    roots.splice(
      1,
      0,
      branch('redis-sentinel', 'Sentinel', 'sentinel', 'Sentinel masters, replicas, and failover status', [], { scope: 'sentinel' }),
    )
  }

  return roots
}

function redisDatabaseNodeOptions(databaseIndex: number): Partial<ConnectionTreeNode> {
  return {
    scope: `db:${databaseIndex}`,
    queryable: true,
    builderKind: 'redis-key-browser',
  }
}

function redisTypeFolderOptions(
  databaseIndex: number,
  type: string,
): Partial<ConnectionTreeNode> {
  return {
    scope: `db:${databaseIndex}:type:${type}`,
  }
}

function redisDatabaseIndex(connection: ConnectionProfile) {
  if (Number.isFinite(connection.redisOptions?.databaseIndex)) {
    return Math.max(0, Math.trunc(connection.redisOptions?.databaseIndex ?? 0))
  }

  const parsed = Number.parseInt(connection.database ?? '', 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

function fileName(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
}
