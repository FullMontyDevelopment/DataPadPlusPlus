import { describe, expect, it } from 'vitest'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  createRedisExplorerNodes,
  redisInspectQueryTemplate,
} from './browser-redis-explorer'
import { redisInspectPayload } from './browser-redis-payloads'

describe('browser Redis explorer slice', () => {
  it('renders Redis-native root and database type folders', () => {
    const connection = redisConnection()

    expect(createRedisExplorerNodes(connection).map((node) => node.label)).toEqual([
      'Databases',
      'Pub/Sub',
      'Lua Scripts',
      'Functions',
      'ACL / Security',
      'Diagnostics',
    ])

    expect(createRedisExplorerNodes(connection, 'db:0').map((node) => node.label)).toEqual([
      'Keys',
      'Strings',
      'Hashes',
      'Lists',
      'Sets',
      'Sorted Sets',
      'Streams',
    ])
  })

  it('shows deployment-specific Cluster and Sentinel branches only when configured', () => {
    expect(createRedisExplorerNodes(redisConnection({ deploymentMode: 'cluster' })).map((node) => node.label)).toContain('Cluster')
    expect(createRedisExplorerNodes(redisConnection({ deploymentMode: 'cluster' })).map((node) => node.label)).not.toContain('Sentinel')
    expect(createRedisExplorerNodes(redisConnection({ deploymentMode: 'sentinel' })).map((node) => node.label)).toContain('Sentinel')
    expect(createRedisExplorerNodes(redisConnection({ deploymentMode: 'sentinel' })).map((node) => node.label)).not.toContain('Cluster')
  })

  it('renders key leaves without sampled language and with executable metadata templates', () => {
    const nodes = createRedisExplorerNodes(redisConnection(), 'db:0:type:hash')

    expect(nodes).toEqual([
      expect.objectContaining({
        id: 'key:0:perf:session:000143',
        label: 'perf:session:000143',
        kind: 'hash',
        queryTemplate: 'TYPE perf:session:000143\nTTL perf:session:000143',
      }),
      expect.objectContaining({
        id: 'key:0:perf:session:000561',
        label: 'perf:session:000561',
      }),
    ])
    expect(JSON.stringify(nodes).toLowerCase()).not.toContain('sampled')
  })

  it('maps Redis object ids to native inspection commands', () => {
    expect(redisInspectQueryTemplate('key:0:perf:session:000143')).toBe('TYPE perf:session:000143\nTTL perf:session:000143')
    expect(redisInspectQueryTemplate('redis:diagnostics:slowlog')).toBe('SLOWLOG GET 128')
    expect(redisInspectQueryTemplate('redis:diagnostics:memory')).toBe('MEMORY STATS')
    expect(redisInspectQueryTemplate('redis:acl:users')).toBe('ACL LIST')
    expect(redisInspectQueryTemplate('redis:cluster:nodes')).toBe('CLUSTER INFO')
  })

  it('returns purpose-built payloads for keyspace, key, cluster, security, and diagnostics views', () => {
    expect(redisInspectPayload('redis:databases')).toMatchObject({
      databases: expect.arrayContaining([expect.objectContaining({ database: 0, keys: 40010 })]),
    })

    expect(redisInspectPayload('key:0:products:inventory')).toMatchObject({
      database: 0,
      key: 'products:inventory',
      type: 'zset',
    })

    expect(redisInspectPayload('redis:cluster:nodes')).toMatchObject({
      kind: 'cluster',
      nodes: expect.arrayContaining([expect.objectContaining({ role: 'master' })]),
    })

    expect(redisInspectPayload('redis:acl:users')).toMatchObject({
      kind: 'security',
      users: expect.arrayContaining([expect.objectContaining({ name: 'default' })]),
    })

    expect(redisInspectPayload('redis:diagnostics:info')).toMatchObject({
      kind: 'diagnostics',
      metrics: expect.arrayContaining([expect.objectContaining({ label: 'Used Memory' })]),
    })
  })
})

function redisConnection(redisOptions: ConnectionProfile['redisOptions'] = {}): ConnectionProfile {
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
    redisOptions,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
