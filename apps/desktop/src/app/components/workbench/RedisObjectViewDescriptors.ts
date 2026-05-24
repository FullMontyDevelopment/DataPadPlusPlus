export type RedisObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, RedisObjectViewDescriptor> = {
  databases: {
    kind: 'databases',
    menuLabel: 'View Databases',
    title: 'Redis Databases',
    purpose: 'Review logical Redis databases, key counts, and jump into a database-scoped key browser.',
    emptyTitle: 'No Redis databases are visible',
    emptyDescription: 'Refresh databases or check whether the selected database currently has keys.',
    primaryQueryLabel: 'Browse Keys',
  },
  database: {
    kind: 'database',
    menuLabel: 'Open DB Overview',
    title: 'Redis DB Overview',
    purpose: 'Inspect the selected logical database by key type, key count, scan progress, and metadata-safe browser entry points.',
    emptyTitle: 'No key metadata is loaded',
    emptyDescription: 'Refresh this database or open the key browser to scan keys with safe bounds.',
    primaryQueryLabel: 'Browse DB Keys',
  },
  keys: {
    kind: 'keys',
    menuLabel: 'Browse Keys',
    title: 'All Keys',
    purpose: 'Browse every Redis key type in this database with filters, incremental loading, and bounded key metadata.',
    emptyTitle: 'No keys were loaded',
    emptyDescription: 'Refresh or open the key browser with a wider pattern.',
    primaryQueryLabel: 'Open Key Browser',
  },
  string: typeDescriptor('string', 'Browse Strings', 'Redis Strings', 'String, bitmap, binary, and HyperLogLog-style values.'),
  hash: typeDescriptor('hash', 'Browse Hashes', 'Redis Hashes', 'Field/value maps with metadata and type-aware editing in Results.'),
  list: typeDescriptor('list', 'Browse Lists', 'Redis Lists', 'Ordered values with length, range, push/pop, and trim workflows.'),
  set: typeDescriptor('set', 'Browse Sets', 'Redis Sets', 'Unique members with set algebra and member-management workflows.'),
  zset: typeDescriptor('zset', 'Browse Sorted Sets', 'Redis Sorted Sets', 'Scored members with ranks, ranges, and score editing workflows.'),
  stream: typeDescriptor('stream', 'Browse Streams', 'Redis Streams', 'Append-only stream entries, consumer groups, pending messages, and stream metrics.'),
  json: typeDescriptor('json', 'Browse JSON Keys', 'Redis JSON', 'RedisJSON documents with path-aware browsing and editing when the module is available.'),
  timeseries: typeDescriptor('timeseries', 'Browse Time Series', 'Redis Time Series', 'Time-series keys, labels, retention, and bounded sample inspection when RedisTimeSeries is available.'),
  bloom: typeDescriptor('bloom', 'Browse Bloom Filters', 'Bloom Filters', 'Probabilistic filter keys and module capability status.'),
  'search-index': typeDescriptor('search-index', 'Manage Search Indexes', 'Search Indexes', 'RediSearch indexes, schema, document coverage, and disabled-state reasons when unavailable.'),
  vectorset: typeDescriptor('vectorset', 'Browse Vector Indexes', 'Vector Indexes', 'Vector search structures and capability status when the server supports them.'),
  pubsub: {
    kind: 'pubsub',
    menuLabel: 'Open Pub/Sub',
    title: 'Redis Pub/Sub',
    purpose: 'Inspect channels, patterns, subscribers, and Pub/Sub capability state without starting hidden monitoring.',
    emptyTitle: 'No Pub/Sub metadata is available',
    emptyDescription: 'Refresh channel metadata or use the Redis Console for explicit channel inspection.',
  },
  cluster: {
    kind: 'cluster',
    menuLabel: 'Open Cluster Status',
    title: 'Redis Cluster',
    purpose: 'Inspect cluster mode, node metadata, slots, and failover state when this connection targets a cluster deployment.',
    emptyTitle: 'Cluster metadata is unavailable',
    emptyDescription: 'This server may not have cluster mode enabled, or the connected user cannot inspect cluster status.',
  },
  sentinel: {
    kind: 'sentinel',
    menuLabel: 'Open Sentinel Status',
    title: 'Redis Sentinel',
    purpose: 'Inspect Sentinel masters, replicas, peer sentinels, and failover state when the deployment supports Sentinel.',
    emptyTitle: 'Sentinel metadata is unavailable',
    emptyDescription: 'This connection is not configured as Sentinel, or the connected user cannot inspect Sentinel status.',
  },
  'lua-scripts': {
    kind: 'lua-scripts',
    menuLabel: 'Manage Lua Scripts',
    title: 'Lua Scripts',
    purpose: 'Review script-related surfaces and plan script workflows while keeping saved scripts in Library.',
    emptyTitle: 'No script metadata is available',
    emptyDescription: 'Redis does not list loaded script bodies; use script SHA and Library scripts for repeatable workflows.',
  },
  functions: {
    kind: 'functions',
    menuLabel: 'Manage Functions',
    title: 'Redis Functions',
    purpose: 'Review Redis function libraries, when supported, without changing function state from the explorer.',
    emptyTitle: 'No function metadata is available',
    emptyDescription: 'Function metadata may be unavailable on this Redis version or blocked by ACL permissions.',
  },
  security: {
    kind: 'security',
    menuLabel: 'Manage ACL / Security',
    title: 'ACL / Security',
    purpose: 'Review ACL users, categories, and the current authenticated user with clear permission warnings.',
    emptyTitle: 'No ACL metadata is available',
    emptyDescription: 'ACL metadata may be unavailable or blocked by the connected user permissions.',
  },
  diagnostics: {
    kind: 'diagnostics',
    menuLabel: 'Open Diagnostics',
    title: 'Redis Diagnostics',
    purpose: 'Inspect server health, slow operations, operation counters, latency, memory, clients, persistence, and replication metadata.',
    emptyTitle: 'No diagnostics are loaded',
    emptyDescription: 'Refresh diagnostics to collect read-only server metadata.',
  },
  slowlog: {
    kind: 'slowlog',
    menuLabel: 'Review Slow Operations',
    title: 'Slow Operations',
    purpose: 'Review slow operations using bounded reads so performance issues are visible without starting monitoring.',
    emptyTitle: 'No slow operation entries were returned',
    emptyDescription: 'Slow operation history may be empty or unavailable to this user.',
  },
  metrics: {
    kind: 'metrics',
    menuLabel: 'Open Operation Stats',
    title: 'Redis Operation Stats',
    purpose: 'Review operation counters and runtime statistics where available.',
    emptyTitle: 'No operation stats were returned',
    emptyDescription: 'Refresh diagnostics or check whether operation statistics are available to this user.',
  },
  latency: {
    kind: 'latency',
    menuLabel: 'Open Latency',
    title: 'Redis Latency',
    purpose: 'Review Redis latency samples when LATENCY commands are enabled on the server.',
    emptyTitle: 'No latency samples were returned',
    emptyDescription: 'Latency monitoring may be disabled or unsupported by this Redis deployment.',
  },
  memory: {
    kind: 'memory',
    menuLabel: 'Open Memory Analysis',
    title: 'Memory Analysis',
    purpose: 'Review memory usage, fragmentation, allocator statistics, and high-signal memory facts.',
    emptyTitle: 'No memory metadata was returned',
    emptyDescription: 'MEMORY STATS may be unavailable or blocked by this user.',
  },
  clients: {
    kind: 'clients',
    menuLabel: 'Open Clients',
    title: 'Redis Clients',
    purpose: 'Review connected clients and connection metadata from safe, read-only server metadata.',
    emptyTitle: 'No client metadata was returned',
    emptyDescription: 'Client metadata may be blocked by ACL permissions.',
  },
  persistence: {
    kind: 'persistence',
    menuLabel: 'Open Persistence',
    title: 'Persistence',
    purpose: 'Review RDB/AOF status and persistence health when the server exposes it.',
    emptyTitle: 'No persistence metadata was returned',
    emptyDescription: 'Refresh diagnostics or check persistence metadata support.',
  },
  replication: {
    kind: 'replication',
    menuLabel: 'Open Replication',
    title: 'Replication',
    purpose: 'Review role, replica links, offsets, and replication health when the server exposes it.',
    emptyTitle: 'No replication metadata was returned',
    emptyDescription: 'Refresh diagnostics or check replication metadata support.',
  },
}

const DEFAULT_DESCRIPTOR: RedisObjectViewDescriptor = {
  kind: 'object',
  menuLabel: 'Inspect Redis Metadata',
  title: 'Redis Metadata',
  purpose: 'Inspect Redis metadata and open the closest native Redis workflow for this object.',
  emptyTitle: 'Redis metadata is not available',
  emptyDescription: 'Refresh this object or check whether the connected user can inspect it.',
}

export function getRedisObjectViewDescriptor(kind: string | undefined): RedisObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[kind] ?? DEFAULT_DESCRIPTOR
}

export function redisObjectViewMenuLabel(kind: string | undefined): string {
  return getRedisObjectViewDescriptor(kind).menuLabel
}

export function isRedisObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[kind])
}

export const REDIS_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function typeDescriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
): RedisObjectViewDescriptor {
  return {
    kind,
    menuLabel,
    title,
    purpose,
    emptyTitle: `No ${title.toLowerCase()} were loaded`,
    emptyDescription: 'Open the key browser or refresh this type folder to collect bounded key metadata.',
    primaryQueryLabel: `Browse ${title}`,
  }
}
