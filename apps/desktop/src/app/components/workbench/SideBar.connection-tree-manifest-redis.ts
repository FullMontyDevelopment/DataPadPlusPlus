import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { normalizeKind } from './SideBar.connection-tree-manifest-common'

export function isRedisLikeConnection(connection: ConnectionProfile) {
  return connection.engine === 'redis' || connection.engine === 'valkey'
}

export function redisManifestNodeId(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  const normalizedKind = normalizeKind(kind)
  const typeKind = redisBrowserTypeKind(normalizedKind)

  if (normalizedKind === 'databases') return 'redis:databases'
  if (normalizedKind === 'database') {
    return `redis:db:${redisDatabaseIndexFromPath(connection, label, parentPath)}`
  }
  if (typeKind) {
    return `redis:db:${redisDatabaseIndexFromPath(connection, label, parentPath)}:${typeKind}`
  }
  if (normalizedKind === 'cluster') return 'redis:cluster'
  if (normalizedKind === 'sentinel') return 'redis:sentinel'
  if (normalizedKind === 'lua-scripts') return 'redis:lua-scripts'
  if (normalizedKind === 'functions') return 'redis:functions'
  if (normalizedKind === 'security') return 'redis:acl'
  if (normalizedKind === 'diagnostics') return 'redis:diagnostics'

  return `redis:${normalizedKind || normalizeKind(label) || 'object'}`
}

export function redisManifestNodeScope(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  const normalizedKind = normalizeKind(kind)
  const typeKind = redisBrowserTypeKind(normalizedKind)

  if (normalizedKind === 'databases') return 'databases'
  if (normalizedKind === 'database') {
    return `db:${redisDatabaseIndexFromPath(connection, label, parentPath)}`
  }
  if (typeKind) {
    return `db:${redisDatabaseIndexFromPath(connection, label, parentPath)}:type:${typeKind}`
  }
  if (normalizedKind === 'cluster') return 'cluster'
  if (normalizedKind === 'sentinel') return 'sentinel'
  if (normalizedKind === 'lua-scripts') return 'lua-scripts'
  if (normalizedKind === 'functions') return 'functions'
  if (normalizedKind === 'security') return 'acl'
  if (normalizedKind === 'diagnostics') return 'diagnostics'

  return undefined
}

export function redisDatabaseIndexFromPath(
  connection: ConnectionProfile,
  label: string,
  parentPath: string[],
) {
  const candidate = [...parentPath, label]
    .map((part) => /^DB\s+(\d+)$/i.exec(part.trim())?.[1])
    .find(Boolean)

  if (candidate) return Math.max(0, Number.parseInt(candidate, 10))

  if (Number.isFinite(connection.redisOptions?.databaseIndex)) {
    return Math.max(0, Math.trunc(connection.redisOptions?.databaseIndex ?? 0))
  }

  const parsedConnectionDatabase = Number.parseInt(connection.database ?? '', 10)
  return Number.isFinite(parsedConnectionDatabase)
    ? Math.max(0, parsedConnectionDatabase)
    : 0
}

function redisBrowserTypeKind(kind: string) {
  switch (kind) {
    case 'keys':
      return 'keys'
    case 'strings':
      return 'string'
    case 'hashes':
      return 'hash'
    case 'lists':
      return 'list'
    case 'sets':
      return 'set'
    case 'sorted-sets':
      return 'zset'
    case 'streams':
      return 'stream'
    case 'json':
      return 'json'
    case 'time-series':
      return 'timeseries'
    case 'bloom':
    case 'bloom-filters':
      return 'bloom'
    case 'search-indexes':
      return 'search-index'
    case 'vector-indexes':
      return 'vectorset'
    case 'pubsub':
      return 'pubsub'
    default:
      return undefined
  }
}
