export type RedisObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

type RedisDescriptorEngine = 'redis' | 'valkey'

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
  'stream-detail': descriptor('stream-detail', 'Open Stream Overview', 'Stream Overview', 'Review XINFO STREAM facts, recent entries, group counts, and stream range boundaries.', 'No stream overview was returned', 'The stream key may not exist, or XINFO STREAM may be blocked.'),
  'stream-entries': descriptor('stream-entries', 'Review Stream Entries', 'Stream Entries', 'Review bounded XRANGE entries without starting a blocking read.', 'No stream entries were returned', 'The stream may be empty, trimmed, or blocked by ACL permissions.'),
  'stream-groups': descriptor('stream-groups', 'Review Consumer Groups', 'Consumer Groups', 'Review XINFO GROUPS metadata for this stream and drill into group consumers or pending messages.', 'No consumer groups were returned', 'The stream may not have consumer groups, or XINFO GROUPS may be blocked.'),
  'stream-group': descriptor('stream-group', 'Open Consumer Group', 'Consumer Group', 'Review group lag, delivered IDs, pending summary, consumers, and follow-up drilldowns.', 'No consumer group metadata was returned', 'The group may not exist, or consumer-group metadata may be blocked.'),
  'stream-consumers': descriptor('stream-consumers', 'Review Consumers', 'Stream Consumers', 'Review XINFO CONSUMERS metadata for a selected stream consumer group.', 'No consumers were returned', 'The group may be idle, empty, or blocked by ACL permissions.'),
  'stream-pending': descriptor('stream-pending', 'Review Pending Entries', 'Pending Stream Entries', 'Review XPENDING summaries and bounded pending-entry details for a selected consumer group.', 'No pending entries were returned', 'The group may have no pending messages, or XPENDING may be blocked.'),
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
  'pubsub-channel': descriptor('pubsub-channel', 'Review Pub/Sub Channels', 'Pub/Sub Channels', 'Review active channels from PUBSUB CHANNELS without starting a monitor session.', 'No Pub/Sub channels were returned', 'No clients may be subscribed, or PUBSUB CHANNELS may be blocked.'),
  'pubsub-pattern': descriptor('pubsub-pattern', 'Review Pattern Subscriptions', 'Pub/Sub Patterns', 'Review pattern subscription counts from PUBSUB NUMPAT.', 'No pattern subscriptions were returned', 'No pattern subscriptions may be active, or PUBSUB NUMPAT may be blocked.'),
  'pubsub-subscriber': descriptor('pubsub-subscriber', 'Review Subscriber Counts', 'Pub/Sub Subscribers', 'Review subscriber counts for selected channels using PUBSUB NUMSUB plans.', 'No subscriber counts were returned', 'Choose explicit channels before loading subscriber counts.'),
  cluster: {
    kind: 'cluster',
    menuLabel: 'Open Cluster Status',
    title: 'Redis Cluster',
    purpose: 'Inspect cluster mode, node metadata, slots, and failover state when this connection targets a cluster deployment.',
    emptyTitle: 'Cluster metadata is unavailable',
    emptyDescription: 'This server may not have cluster mode enabled, or the connected user cannot inspect cluster status.',
  },
  'cluster-node': descriptor('cluster-node', 'Review Cluster Nodes', 'Cluster Nodes', 'Review cluster node addresses, roles, links, and slot ownership.', 'No cluster nodes were returned', 'This server may not be running in cluster mode, or CLUSTER NODES is blocked.'),
  'cluster-slots': descriptor('cluster-slots', 'Review Hash Slots', 'Cluster Hash Slots', 'Review hash-slot ranges, masters, and replicas.', 'No hash slots were returned', 'This server may not be running in cluster mode, or CLUSTER SLOTS is blocked.'),
  'cluster-failover': descriptor('cluster-failover', 'Review Failover Status', 'Cluster Failover', 'Review failover posture and cluster availability signals.', 'No failover metadata was returned', 'Failover metadata is only available for cluster deployments.'),
  sentinel: {
    kind: 'sentinel',
    menuLabel: 'Open Sentinel Status',
    title: 'Redis Sentinel',
    purpose: 'Inspect Sentinel masters, replicas, peer sentinels, and failover state when the deployment supports Sentinel.',
    emptyTitle: 'Sentinel metadata is unavailable',
    emptyDescription: 'This connection is not configured as Sentinel, or the connected user cannot inspect Sentinel status.',
  },
  'sentinel-masters': descriptor('sentinel-masters', 'Review Sentinel Masters', 'Sentinel Masters', 'Review monitored masters, status flags, replica counts, and quorum signals.', 'No Sentinel masters were returned', 'This connection may not target Sentinel, or SENTINEL MASTERS is blocked.'),
  'sentinel-replicas': descriptor('sentinel-replicas', 'Review Sentinel Replicas', 'Sentinel Replicas', 'Review replicas for a selected monitored master.', 'No Sentinel replicas were returned', 'Select a master before loading replicas.'),
  'sentinel-peers': descriptor('sentinel-peers', 'Review Sentinel Peers', 'Sentinel Peers', 'Review peer Sentinel instances for a monitored master.', 'No Sentinel peers were returned', 'Select a master before loading peer Sentinel instances.'),
  'sentinel-failover': descriptor('sentinel-failover', 'Review Sentinel Failover', 'Sentinel Failover', 'Review Sentinel failover state and guarded failover workflows.', 'No Sentinel failover metadata was returned', 'Failover metadata is only available for Sentinel deployments.'),
  'lua-scripts': {
    kind: 'lua-scripts',
    menuLabel: 'Manage Lua Scripts',
    title: 'Lua Scripts',
    purpose: 'Review script-related surfaces and plan script workflows while keeping saved scripts in Library.',
    emptyTitle: 'No script metadata is available',
    emptyDescription: 'Redis does not list loaded script bodies; use script SHA and Library scripts for repeatable workflows.',
  },
  'lua-script': descriptor('lua-script', 'Manage Lua Scripts', 'Lua Scripts', 'Review script SHA workflows and saved-script handoffs without dumping raw command payloads.', 'No loaded script metadata is available', 'Redis does not enumerate script bodies. Save reusable scripts in Library.'),
  history: descriptor('history', 'Open Script History', 'Script History', 'Review saved Redis script workflow history from Library-backed artifacts.', 'No script history is available', 'Saved script history appears after scripts are saved or run from Library.'),
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
  users: descriptor('users', 'Manage ACL Users', 'ACL Users', 'Review Redis ACL users, enabled state, command categories, key patterns, and channel patterns.', 'No ACL users were returned', 'ACL user metadata may be unavailable or blocked by permissions.'),
  permissions: descriptor('permissions', 'Review ACL Categories', 'ACL Categories', 'Review Redis command categories exposed by the server.', 'No ACL categories were returned', 'ACL category metadata may be unavailable or blocked by permissions.'),
  user: descriptor('user', 'Review Current User', 'Current Redis User', 'Review the authenticated Redis user for this connection.', 'Current user metadata is unavailable', 'ACL WHOAMI may be unavailable or blocked by permissions.'),
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

export function getRedisObjectViewDescriptor(
  kind: string | undefined,
  engine: RedisDescriptorEngine = 'redis',
): RedisObjectViewDescriptor {
  const descriptor = kind ? DESCRIPTORS[kind] ?? DEFAULT_DESCRIPTOR : DEFAULT_DESCRIPTOR
  return engine === 'valkey' ? valkeyDescriptor(descriptor) : descriptor
}

export function redisObjectViewMenuLabel(kind: string | undefined): string {
  return getRedisObjectViewDescriptor(kind).menuLabel
}

export function isRedisObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[kind])
}

export const REDIS_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
): RedisObjectViewDescriptor {
  return {
    kind,
    menuLabel,
    title,
    purpose,
    emptyTitle,
    emptyDescription,
  }
}

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

function valkeyDescriptor(descriptor: RedisObjectViewDescriptor): RedisObjectViewDescriptor {
  return {
    ...descriptor,
    menuLabel: valkeyText(descriptor.menuLabel),
    title: valkeyText(descriptor.title),
    purpose: valkeyText(descriptor.purpose),
    emptyTitle: valkeyText(descriptor.emptyTitle),
    emptyDescription: valkeyText(descriptor.emptyDescription),
    primaryQueryLabel: descriptor.primaryQueryLabel
      ? valkeyText(descriptor.primaryQueryLabel)
      : undefined,
  }
}

function valkeyText(value: string) {
  return value.replace(/\bRedis\b/g, 'Valkey')
}
