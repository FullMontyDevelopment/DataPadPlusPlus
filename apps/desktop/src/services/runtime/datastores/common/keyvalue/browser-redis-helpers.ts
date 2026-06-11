export const REDIS_BROWSER_TYPES = [
  { kind: 'keys', label: 'Keys', detail: 'All key types' },
  { kind: 'string', label: 'Strings', detail: 'String, bitmap, and HyperLogLog values' },
  { kind: 'hash', label: 'Hashes', detail: 'Hash maps' },
  { kind: 'list', label: 'Lists', detail: 'Ordered list values' },
  { kind: 'set', label: 'Sets', detail: 'Set values' },
  { kind: 'zset', label: 'Sorted Sets', detail: 'Scored set values' },
  { kind: 'stream', label: 'Streams', detail: 'Append-only stream values' },
  { kind: 'json', label: 'JSON', detail: 'RedisJSON values when the module is installed' },
  { kind: 'timeseries', label: 'Time Series', detail: 'RedisTimeSeries values when available' },
  { kind: 'bloom', label: 'Bloom Filters', detail: 'RedisBloom probabilistic values when available' },
  { kind: 'search-index', label: 'Search Indexes', detail: 'RediSearch indexes' },
  { kind: 'vectorset', label: 'Vector Indexes', detail: 'Vector search structures' },
  { kind: 'pubsub', label: 'Pub/Sub', detail: 'Channels, patterns, and subscribers' },
] as const

const REDIS_CORE_TYPE_KINDS = new Set([
  'keys',
  'string',
  'hash',
  'list',
  'set',
  'zset',
  'stream',
])

export function redisCoreBrowserTypes() {
  return REDIS_BROWSER_TYPES.filter((type) => REDIS_CORE_TYPE_KINDS.has(type.kind))
}

export function redisDatabaseFromScope(scope: string) {
  const match = /^db:(\d+)/.exec(scope)
  return match?.[1] ?? '0'
}

export function previewRedisKeysForType(type: string) {
  switch (type) {
    case 'hash':
      return [
        { key: 'perf:session:000143', type: 'hash', ttlSeconds: -1, memoryUsageBytes: 144, length: 4 },
        { key: 'perf:session:000561', type: 'hash', ttlSeconds: -1, memoryUsageBytes: 128, length: 4 },
      ]
    case 'zset':
      return [
        { key: 'products:inventory', type: 'zset', ttlSeconds: -1, memoryUsageBytes: 120, length: 3 },
      ]
    case 'list':
      return [
        { key: 'orders:recent', type: 'list', ttlSeconds: 600, memoryUsageBytes: 512, length: 20 },
      ]
    case 'string':
      return [
        { key: 'account:1', type: 'string', ttlSeconds: -1, memoryUsageBytes: 48, length: 1 },
      ]
    case 'keys':
      return [
        { key: 'perf:session:000143', type: 'hash', ttlSeconds: -1, memoryUsageBytes: 144, length: 4 },
        { key: 'products:inventory', type: 'zset', ttlSeconds: -1, memoryUsageBytes: 120, length: 3 },
        { key: 'account:1', type: 'string', ttlSeconds: -1, memoryUsageBytes: 48, length: 1 },
      ]
    default:
      return []
  }
}

export function redisTypeFolderLabel(type: string) {
  return REDIS_BROWSER_TYPES.find((entry) => entry.kind === type)?.label ?? 'Keys'
}
