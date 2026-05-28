import { previewRedisKeysForType } from './browser-redis-helpers'

export function redisInspectPayload(nodeId: string) {
  if (nodeId === 'redis:databases') {
    return {
      databases: [
        { database: 0, keys: 40010, expires: 39992, avgTtl: '12m' },
        { database: 1, keys: 0, expires: 0, avgTtl: 'n/a' },
      ],
      configuredDatabase: 0,
    }
  }

  if (nodeId.startsWith('redis:db:')) {
    const [, , database = '0', type] = nodeId.split(':')
    const typeCounts = [
      { type: 'hash', count: 39992, examples: ['perf:session:000143'] },
      { type: 'zset', count: 1, examples: ['products:inventory'] },
      { type: 'string', count: 17, examples: ['account:1'] },
    ]

    if (type) {
      const keys = previewRedisKeysForType(type)
      return {
        database: Number.parseInt(database, 10),
        type,
        pattern: '*',
        scannedKeys: keys.length,
        keys,
      }
    }

    return {
      database: Number.parseInt(database, 10),
      keyCount: 40010,
      scannedKeys: 100,
      typeCounts,
    }
  }

  if (nodeId.startsWith('key:')) {
    const [, database = '0', ...keyParts] = nodeId.split(':')
    const key = keyParts.join(':')
    return {
      database: Number.parseInt(database, 10),
      key,
      type: key.includes('inventory') ? 'zset' : key.includes('orders') ? 'list' : 'hash',
      ttlSeconds: key.startsWith('perf:') ? -1 : 600,
      memoryUsageBytes: 144,
      length: 4,
      preview: {
        status: 'active',
        updatedAt: '2026-05-20T12:00:00.000Z',
      },
    }
  }

  if (nodeId.includes('pubsub')) {
    return {
      kind: 'pubsub',
      channels: [],
      patterns: [],
      subscribers: [],
      activeChannels: 0,
      patternSubscriptions: 0,
      totalSubscribers: 0,
    }
  }

  if (nodeId.includes('sentinel')) {
    if (nodeId.includes('masters')) {
      return {
        kind: 'sentinel',
        masters: [
          { name: 'preview-primary', ip: '127.0.0.1', port: 6379, flags: 'master', quorum: 2, numSlaves: 1 },
        ],
        replicas: [],
        sentinels: [],
      }
    }

    if (nodeId.includes('replicas')) {
      return {
        kind: 'sentinel',
        masters: [],
        replicas: [
          { name: 'preview-replica-1', ip: '127.0.0.1', port: 6380, flags: 'slave', masterName: 'preview-primary' },
        ],
        sentinels: [],
      }
    }

    if (nodeId.includes('sentinels')) {
      return {
        kind: 'sentinel',
        masters: [],
        replicas: [],
        sentinels: [
          { name: 'sentinel-a', ip: '127.0.0.1', port: 26379, flags: 'sentinel', runid: 'preview-sentinel' },
        ],
      }
    }

    return {
      kind: 'sentinel',
      masters: [
        { name: 'preview-primary', ip: '127.0.0.1', port: 6379, flags: 'master', quorum: 2, numSlaves: 1 },
      ],
      replicas: [
        { name: 'preview-replica-1', ip: '127.0.0.1', port: 6380, flags: 'slave', masterName: 'preview-primary' },
      ],
      sentinels: [
        { name: 'sentinel-a', ip: '127.0.0.1', port: 26379, flags: 'sentinel', runid: 'preview-sentinel' },
      ],
    }
  }

  if (nodeId.includes('lua')) {
    return {
      kind: 'lua-scripts',
      scripts: [
        { sha: '9f2c-preview', name: 'reserve-stock', lastUsedAt: '2026-05-20T12:00:00.000Z' },
      ],
      history: [
        { name: 'reserve-stock.lua', scope: 'DB 0', lastRunAt: '2026-05-20T12:00:00.000Z' },
      ],
    }
  }

  if (nodeId.includes('functions')) {
    return {
      kind: 'functions',
      libraries: [
        {
          name: 'inventory',
          engine: 'LUA',
          functions: [{ name: 'reserve_stock' }, { name: 'release_stock' }],
          flags: ['no-writes'],
        },
      ],
    }
  }

  if (nodeId.includes('diagnostics:info')) {
    return {
      kind: 'diagnostics',
      server: { version: '7.2.5', uptimeSeconds: 3600 },
      keyspace: [{ database: 0, keys: 40010, expires: 39992, avgTtlMs: 720000 }],
      metrics: [
        { label: 'Connected Clients', value: 1, unit: 'clients', section: 'clients' },
        { label: 'Used Memory', value: 7399232, unit: 'bytes', section: 'memory' },
        { label: 'Memory Fragmentation', value: 2.35, unit: 'ratio', section: 'memory' },
        { label: 'Ops Per Sec', value: 0, unit: 'ops/s', section: 'stats' },
        { label: 'Keyspace Hits', value: 31449, unit: 'hits', section: 'stats' },
        { label: 'Keyspace Misses', value: 0, unit: 'misses', section: 'stats' },
      ],
    }
  }

  if (nodeId.includes('slowlog')) {
    return {
      kind: 'slowlog',
      entries: [
        { id: 1, durationMicros: 1200, commandName: 'HGETALL', key: 'perf:session:000143', recordedAt: '2026-05-20T12:00:00.000Z' },
      ],
    }
  }

  if (nodeId.includes('commandstats')) {
    return {
      kind: 'metrics',
      metrics: [
        { label: 'GET Calls', value: 31449, unit: 'calls', section: 'commandstats' },
        { label: 'HGETALL Calls', value: 120, unit: 'calls', section: 'commandstats' },
        { label: 'Average GET Time', value: 1.2, unit: 'usec/call', section: 'commandstats' },
      ],
    }
  }

  if (nodeId.includes('latency')) {
    return {
      kind: 'latency',
      samples: [
        { event: 'command', latestMs: 1, maxMs: 4 },
        { event: 'fork', latestMs: 0, maxMs: 0 },
      ],
    }
  }

  if (nodeId.includes('memory')) {
    return {
      kind: 'memory',
      metrics: [
        { label: 'Used Memory', value: 7399232, unit: 'bytes', section: 'memory' },
        { label: 'Peak Memory', value: 8501248, unit: 'bytes', section: 'memory' },
        { label: 'Fragmentation Ratio', value: 2.35, unit: 'ratio', section: 'memory' },
      ],
    }
  }

  if (nodeId.includes('clients')) {
    return {
      kind: 'clients',
      clients: [
        { id: 1, address: '127.0.0.1:55622', name: 'DataPad++ preview', ageSeconds: 120, idleSeconds: 0 },
      ],
    }
  }

  if (nodeId.includes('persistence')) {
    return {
      kind: 'persistence',
      metrics: [
        { label: 'RDB Last Save', value: '2026-05-20T12:00:00.000Z', unit: '', section: 'rdb' },
        { label: 'AOF Enabled', value: false, unit: '', section: 'aof' },
      ],
    }
  }

  if (nodeId.includes('replication')) {
    return {
      kind: 'replication',
      role: 'master',
      replicas: [],
      metrics: [
        { label: 'Connected Replicas', value: 0, unit: 'replicas', section: 'replication' },
        { label: 'Replication Offset', value: 0, unit: 'bytes', section: 'replication' },
      ],
    }
  }

  if (nodeId.includes('acl')) {
    return {
      kind: 'security',
      users: [
        {
          name: 'default',
          enabled: true,
          authentication: 'nopass',
          keyPatterns: ['*'],
          channelPatterns: ['*'],
          categories: ['@all'],
        },
      ],
      categories: [
        { name: '@all', description: 'All command categories are enabled for the default preview user.' },
      ],
    }
  }

  if (nodeId.includes('cluster')) {
    if (nodeId.includes('nodes')) {
      return {
        kind: 'cluster',
        nodes: [
          { id: '07c37dfeb2352e0b1e5', address: '127.0.0.1:6379@16379', role: 'master', linkState: 'connected', slots: ['0-5460'] },
          { id: '2a2b-preview', address: '127.0.0.1:6380@16380', role: 'replica', linkState: 'connected', slots: [] },
        ],
      }
    }

    if (nodeId.includes('slots')) {
      return {
        kind: 'cluster',
        slots: [
          { range: '0-5460', master: '127.0.0.1:6379', replicas: ['127.0.0.1:6380'], detail: '1 replica' },
        ],
      }
    }

    return {
      kind: 'cluster',
      state: 'ok',
      knownNodes: 2,
      slotsAssigned: 5461,
      nodes: [
        { id: '07c37dfeb2352e0b1e5', address: '127.0.0.1:6379@16379', role: 'master', linkState: 'connected', slots: ['0-5460'] },
      ],
      slots: [
        { range: '0-5460', master: '127.0.0.1:6379', replicas: ['127.0.0.1:6380'], detail: '1 replica' },
      ],
    }
  }

  return {
    kind: 'metadata',
    facts: [],
    warning: 'Preview metadata is deterministic. Refresh against a live connection for server-specific details.',
  }
}
