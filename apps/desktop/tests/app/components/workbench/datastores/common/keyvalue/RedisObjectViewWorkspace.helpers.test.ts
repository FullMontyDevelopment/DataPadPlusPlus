import { describe, expect, it } from 'vitest'
import type { QueryTabState } from '@datapadplusplus/shared-types'
import {
  isRedisClusterKind,
  isRedisDiagnosticsKind,
  isRedisFunctionKind,
  isRedisKeyPayload,
  isRedisModuleKind,
  isRedisScriptKind,
  isRedisSecurityKind,
  isRedisSentinelKind,
  isRedisStreamKind,
  isRedisTypeFolderKind,
  objectViewWarnings,
  redisQueryTargetFromObjectView,
} from '../../../../../../../src/app/components/workbench/datastores/common/keyvalue/RedisObjectViewWorkspace.helpers'

describe('RedisObjectViewWorkspace helpers', () => {
  it('creates a database-scoped key browser target from object-view state', () => {
    const target = redisQueryTargetFromObjectView(
      redisObjectViewTab({
        kind: 'database',
        label: 'DB 3',
        nodeId: 'redis-db:3',
        path: ['Databases', 'DB 3'],
      }),
      {},
    )

    expect(target).toMatchObject({
      kind: 'database',
      label: 'DB 3',
      path: ['Databases', 'DB 3'],
      preferredBuilder: 'redis-key-browser',
    })
    expect(JSON.parse(target?.queryTemplate ?? '{}')).toEqual({
      mode: 'redis-key-browser',
      databaseIndex: 3,
      pattern: '*',
      type: 'all',
      count: 100,
    })
  })

  it('creates a type-scoped key browser target with payload pattern and database', () => {
    const target = redisQueryTargetFromObjectView(
      redisObjectViewTab({
        kind: 'hash',
        label: 'Hashes',
        path: ['Databases', 'DB 0', 'Hashes'],
      }),
      {
        database: 'DB 0',
        pattern: 'account:*',
      },
    )

    expect(JSON.parse(target?.queryTemplate ?? '{}')).toEqual({
      mode: 'redis-key-browser',
      databaseIndex: 0,
      pattern: 'account:*',
      type: 'hash',
      count: 100,
    })
  })

  it('keeps Search index folders queryable through the key browser all-type scan', () => {
    const target = redisQueryTargetFromObjectView(
      redisObjectViewTab({
        kind: 'search-index',
        label: 'Search Indexes',
        path: ['Databases', 'DB 0', 'Search Indexes'],
      }),
      {
        database: 0,
      },
    )

    expect(JSON.parse(target?.queryTemplate ?? '{}')).toMatchObject({
      type: 'all',
      pattern: '*',
    })
  })

  it('does not create query targets for non-key admin views', () => {
    expect(redisQueryTargetFromObjectView(redisObjectViewTab({ kind: 'security' }), {})).toBeUndefined()
    expect(redisQueryTargetFromObjectView(redisObjectViewTab({ kind: 'cluster' }), {})).toBeUndefined()
  })

  it('classifies native Redis object-view kinds', () => {
    expect(isRedisTypeFolderKind('stream')).toBe(true)
    expect(isRedisTypeFolderKind('security')).toBe(false)
    expect(isRedisDiagnosticsKind('slowlog')).toBe(true)
    expect(isRedisClusterKind('cluster-slots')).toBe(true)
    expect(isRedisSentinelKind('sentinel-peers')).toBe(true)
    expect(isRedisStreamKind('stream-group')).toBe(true)
    expect(isRedisStreamKind('stream')).toBe(false)
    expect(isRedisModuleKind('json')).toBe(true)
    expect(isRedisModuleKind('stream')).toBe(false)
    expect(isRedisScriptKind('lua-script')).toBe(true)
    expect(isRedisFunctionKind('functions')).toBe(true)
    expect(isRedisSecurityKind('permissions')).toBe(true)
  })

  it('detects key payloads without confusing general metadata payloads for keys', () => {
    expect(isRedisKeyPayload({ key: 'orders:1', type: 'hash' })).toBe(true)
    expect(isRedisKeyPayload({ key: 'orders:1', ttlSeconds: -1 })).toBe(true)
    expect(isRedisKeyPayload({ key: 'orders:1' })).toBe(false)
    expect(isRedisKeyPayload({ database: 0, typeCounts: [] })).toBe(false)
  })

  it('aggregates view, runtime, payload, and unavailable-message warnings', () => {
    const tab = redisObjectViewTab({
      kind: 'metrics',
      warnings: ['View warning'],
    })
    tab.error = { code: 'REDIS_RUNTIME_WARNING', message: 'Runtime warning' }

    expect(objectViewWarnings(tab, {
      warning: 'Payload warning',
      message: 'Slowlog unavailable for this user',
    })).toEqual([
      'View warning',
      'Runtime warning',
      'Payload warning',
      'Slowlog unavailable for this user',
    ])
  })
})

function redisObjectViewTab(overrides: Partial<NonNullable<QueryTabState['objectViewState']>>): QueryTabState {
  return {
    id: `tab-${overrides.kind ?? 'redis'}`,
    title: overrides.label ?? 'Redis view',
    tabKind: 'object-view',
    connectionId: 'conn-redis',
    objectViewState: {
      connectionId: 'conn-redis',
      nodeId: 'redis-node',
      kind: 'database',
      label: 'DB 0',
      path: ['Databases', 'DB 0'],
      ...overrides,
    },
  } as QueryTabState
}
