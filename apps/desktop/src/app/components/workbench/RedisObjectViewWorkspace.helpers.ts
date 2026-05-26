import type {
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  redisDatabaseIndex,
  stringValue,
} from './RedisObjectViewFormatters'
import type { JsonRecord } from './RedisObjectViewTypes'

export function redisQueryTargetFromObjectView(
  tab: QueryTabState,
  payload: JsonRecord,
): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state) {
    return undefined
  }

  const databaseIndex = redisDatabaseIndex(payload.database ?? state.nodeId ?? state.path?.join('/'))
  const type = redisBrowserTypeFromKind(state.kind)
  const pattern = stringValue(payload.pattern) || redisPatternFromState(state.kind, state.label)

  if (!type && state.kind !== 'database' && state.kind !== 'databases') {
    return undefined
  }

  return {
    kind: state.kind,
    label: state.label,
    path: state.path,
    queryTemplate: redisKeyBrowserTemplate({
      databaseIndex,
      pattern,
      type: type ?? 'all',
      count: 100,
    }),
    preferredBuilder: 'redis-key-browser',
  }
}

export function isRedisTypeFolderKind(kind: string) {
  return [
    'keys',
    'string',
    'hash',
    'list',
    'set',
    'zset',
    'stream',
    'json',
    'timeseries',
    'bloom',
    'search-index',
    'vectorset',
  ].includes(kind)
}

export function isRedisDiagnosticsKind(kind: string) {
  return [
    'slowlog',
    'metrics',
    'latency',
    'memory',
    'clients',
    'persistence',
    'replication',
  ].includes(kind)
}

export function isRedisClusterKind(kind: string) {
  return ['cluster', 'cluster-node', 'cluster-slots', 'cluster-failover'].includes(kind)
}

export function isRedisSentinelKind(kind: string) {
  return ['sentinel', 'sentinel-masters', 'sentinel-replicas', 'sentinel-peers', 'sentinel-failover'].includes(kind)
}

export function isRedisScriptKind(kind: string) {
  return ['lua-scripts', 'lua-script', 'history'].includes(kind)
}

export function isRedisFunctionKind(kind: string) {
  return kind === 'functions'
}

export function isRedisSecurityKind(kind: string) {
  return ['security', 'users', 'permissions', 'user'].includes(kind)
}

export function isRedisKeyPayload(payload: JsonRecord) {
  return Boolean(payload.key && (payload.type || payload.redisType || payload.ttlSeconds !== undefined))
}

export function objectViewWarnings(tab: QueryTabState, payload: JsonRecord) {
  return [
    ...(tab.objectViewState?.warnings ?? []),
    ...(tab.error?.message ? [tab.error.message] : []),
    ...(typeof payload.warning === 'string' ? [payload.warning] : []),
    ...(typeof payload.message === 'string' && /unavailable|unsupported|blocked|requires/i.test(payload.message)
      ? [payload.message]
      : []),
  ].filter(Boolean)
}

function redisKeyBrowserTemplate({
  databaseIndex,
  pattern,
  type,
  count,
}: {
  databaseIndex?: number
  pattern: string
  type: string
  count: number
}) {
  return JSON.stringify(
    {
      mode: 'redis-key-browser',
      ...(databaseIndex !== undefined ? { databaseIndex } : {}),
      pattern,
      type,
      count,
    },
    null,
    2,
  )
}

function redisPatternFromState(kind: string, label: string) {
  if (kind === 'database' || kind === 'databases') {
    return '*'
  }

  return label.includes('*') ? label : '*'
}

function redisBrowserTypeFromKind(kind: string | undefined) {
  if (!kind || kind === 'databases' || kind === 'database') {
    return undefined
  }

  if (kind === 'keys') {
    return 'all'
  }

  if (isRedisTypeFolderKind(kind)) {
    return kind === 'search-index' ? 'all' : kind
  }

  return undefined
}
