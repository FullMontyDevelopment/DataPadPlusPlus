import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import {
  previewRedisKeysForType,
  redisCoreBrowserTypes,
  redisDatabaseFromScope,
  redisTypeFolderLabel,
} from './browser-redis-helpers'

export function createRedisExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    const nodes = [
      redisNode(connection, 'redis:databases', 'Databases', 'databases', 'Logical Redis databases', 'databases', true),
      redisNode(connection, 'redis:pubsub', 'Pub/Sub', 'pubsub', 'Channels and patterns', 'pubsub', true),
      redisNode(connection, 'redis:lua-scripts', 'Lua Scripts', 'lua-scripts', 'Script workflow surfaces', 'lua-scripts', true),
      redisNode(connection, 'redis:acl', 'ACL / Security', 'security', 'ACL users and categories', 'acl', true),
      redisNode(connection, 'redis:diagnostics', 'Diagnostics', 'diagnostics', 'INFO, SLOWLOG, memory, latency, clients', 'diagnostics', true),
    ]

    if (connection.redisOptions?.deploymentMode === 'cluster') {
      nodes.splice(1, 0, redisNode(connection, 'redis:cluster', 'Cluster', 'cluster', 'Cluster status and nodes', 'cluster', true))
    }

    if (connection.redisOptions?.deploymentMode === 'sentinel') {
      nodes.splice(1, 0, redisNode(connection, 'redis:sentinel', 'Sentinel', 'sentinel', 'Sentinel masters and failover status', 'sentinel', true))
    }

    return nodes
  }

  if (scope === 'databases') {
    return [
      redisNode(connection, 'redis:db:0', 'DB 0', 'database', '40,010 keys', 'db:0', true),
      redisNode(connection, 'redis:db:1', 'DB 1', 'database', '0 keys', 'db:1', true),
    ]
  }

  if (scope.startsWith('db:') && !scope.includes(':type:')) {
    const database = redisDatabaseFromScope(scope)
    return redisCoreBrowserTypes().map((type) =>
      redisNode(
        connection,
        `redis:db:${database}:${type.kind}`,
        type.label,
        type.kind,
        type.detail,
        `db:${database}:type:${type.kind}`,
        type.kind !== 'pubsub' && type.kind !== 'search-index',
      ),
    )
  }

  if (scope.startsWith('db:') && scope.includes(':type:')) {
    const database = redisDatabaseFromScope(scope)
    const type = scope.split(':type:')[1] ?? 'keys'
    return previewRedisKeysForType(type).map((key) => ({
      id: `key:${database}:${key.key}`,
      family: 'keyvalue',
      label: key.key,
      kind: key.type,
      detail: `${key.type} / ${key.length} item(s)`,
      path: [connection.name, `DB ${database}`, redisTypeFolderLabel(type)],
      queryTemplate: `TYPE ${key.key}\nTTL ${key.key}`,
    }))
  }

  if (scope === 'cluster') {
    return [
      redisNode(connection, 'redis:cluster:info', 'Cluster Info', 'cluster', 'Mode and health'),
      redisNode(connection, 'redis:cluster:nodes', 'Nodes', 'cluster-node', 'Cluster nodes'),
      redisNode(connection, 'redis:cluster:slots', 'Slots', 'cluster-slots', 'Hash slot allocation'),
      redisNode(connection, 'redis:cluster:failover', 'Failover Status', 'cluster-failover', 'Failover metadata'),
    ]
  }

  if (scope === 'sentinel') {
    return [
      redisNode(connection, 'redis:sentinel:masters', 'Masters', 'sentinel-masters', 'Monitored masters'),
      redisNode(connection, 'redis:sentinel:replicas', 'Replicas', 'sentinel-replicas', 'Replica status'),
      redisNode(connection, 'redis:sentinel:sentinels', 'Sentinels', 'sentinel-peers', 'Peer sentinels'),
      redisNode(connection, 'redis:sentinel:failover', 'Failover Status', 'sentinel-failover', 'Failover metadata'),
    ]
  }

  if (scope === 'pubsub') {
    return [
      redisNode(connection, 'redis:pubsub:channels', 'Channels', 'pubsub-channel', 'Active channel names'),
      redisNode(connection, 'redis:pubsub:patterns', 'Patterns', 'pubsub-pattern', 'Pattern subscription count'),
      redisNode(connection, 'redis:pubsub:subscribers', 'Subscribers', 'pubsub-subscriber', 'Channel subscriber counts'),
    ]
  }

  if (scope === 'lua-scripts') {
    return [
      redisNode(connection, 'redis:lua:scripts', 'Loaded Scripts', 'lua-script', 'Script SHA workflow'),
      redisNode(connection, 'redis:lua:history', 'Script History', 'history', 'Saved script history lives in Library'),
    ]
  }

  if (scope === 'functions') {
    return [
      redisNode(connection, 'redis:functions:list', 'Libraries', 'functions', 'Function libraries'),
    ]
  }

  if (scope === 'acl') {
    return [
      redisNode(connection, 'redis:acl:users', 'Users', 'users', 'ACL users'),
      redisNode(connection, 'redis:acl:categories', 'Categories', 'permissions', 'Command categories'),
      redisNode(connection, 'redis:acl:whoami', 'Current User', 'user', 'Authenticated principal'),
    ]
  }

  if (scope === 'diagnostics') {
    return [
      redisNode(connection, 'redis:diagnostics:info', 'Overview', 'diagnostics', 'Server health sections'),
      redisNode(connection, 'redis:diagnostics:slowlog', 'Slow Operations', 'slowlog', 'Slow operation history'),
      redisNode(connection, 'redis:diagnostics:commandstats', 'Command Stats', 'metrics', 'Command usage counters'),
      redisNode(connection, 'redis:diagnostics:latency', 'Latency', 'latency', 'Latency samples'),
      redisNode(connection, 'redis:diagnostics:memory', 'Memory Analysis', 'memory', 'Memory usage and allocator facts'),
      redisNode(connection, 'redis:diagnostics:clients', 'Clients', 'clients', 'Connected client metadata'),
      redisNode(connection, 'redis:diagnostics:persistence', 'Persistence', 'persistence', 'Persistence health'),
      redisNode(connection, 'redis:diagnostics:replication', 'Replication', 'replication', 'Replication health'),
    ]
  }

  return []
}

export function redisInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('key:')) {
    const key = nodeId.split(':').slice(2).join(':')
    return `TYPE ${key}\nTTL ${key}`
  }

  if (nodeId.includes(':slowlog')) {
    return 'SLOWLOG GET 128'
  }

  if (nodeId.includes(':memory')) {
    return 'MEMORY STATS'
  }

  if (nodeId.includes(':clients')) {
    return 'CLIENT LIST'
  }

  if (nodeId.includes(':replication')) {
    return 'INFO replication'
  }

  if (nodeId.includes(':persistence')) {
    return 'INFO persistence'
  }

  if (nodeId.includes(':latency')) {
    return 'LATENCY LATEST'
  }

  if (nodeId.includes(':acl')) {
    return 'ACL LIST'
  }

  if (nodeId.includes(':cluster')) {
    return 'CLUSTER INFO'
  }

  return 'INFO'
}

function redisNode(
  connection: ConnectionProfile,
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  expandable?: boolean,
): ExplorerNode {
  return {
    id,
    family: 'keyvalue',
    label,
    kind,
    detail,
    scope,
    path: [connection.name],
    expandable,
  }
}
