import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'

type JsonRecord = Record<string, unknown>

export function createMemcachedExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  if (!scope) {
    return [
      memcachedNode(connection, 'memcached:server', 'Server', 'server', 'Cache capacity, hit rate, slabs, and settings', 'memcached:server', true),
      memcachedNode(connection, 'memcached:diagnostics', 'Diagnostics', 'diagnostics', 'Hit ratio, evictions, memory pressure, and connection pressure', 'memcached:diagnostics'),
    ]
  }

  if (scope === 'memcached:server') {
    return [
      memcachedNode(connection, 'memcached:stats', 'Stats', 'stats', 'Operational counters and hit rate', 'memcached:stats'),
      memcachedNode(connection, 'memcached:slabs', 'Slabs', 'slabs', 'Slab classes and chunk allocation', 'memcached:slabs', true),
      memcachedNode(connection, 'memcached:items', 'Item Classes', 'items', 'Item counts, age, evictions, and reclaim signals', 'memcached:items', true),
      memcachedNode(connection, 'memcached:settings', 'Settings', 'settings', 'Cache limits and runtime flags', 'memcached:settings'),
      memcachedNode(connection, 'memcached:connections', 'Connections', 'connections', 'Client connection pressure', 'memcached:connections'),
    ]
  }

  if (scope === 'memcached:slabs') {
    return memcachedSlabs().map((slab) =>
      memcachedNode(
        connection,
        `memcached:slab:${slab.classId}`,
        `Class ${slab.classId}`,
        'slab',
        `${slab.chunkSize} chunks | ${slab.memory}`,
        `memcached:slab:${slab.classId}`,
      ),
    )
  }

  if (scope === 'memcached:items') {
    return memcachedItems().map((item) =>
      memcachedNode(
        connection,
        `memcached:item-class:${item.classId}`,
        `Class ${item.classId}`,
        'item-class',
        `${item.number} items | age ${item.age}`,
        `memcached:item-class:${item.classId}`,
      ),
    )
  }

  return []
}

export function memcachedInspectQueryTemplate(nodeId: string) {
  if (nodeId.includes(':slab')) {
    return 'stats slabs'
  }

  if (nodeId.includes(':items') || nodeId.includes(':item-class')) {
    return 'stats items'
  }

  if (nodeId.includes(':settings')) {
    return 'stats settings'
  }

  if (nodeId.includes(':connections')) {
    return 'stats conns'
  }

  return 'stats'
}

export function memcachedInspectPayload(connection: ConnectionProfile, nodeId: string): JsonRecord {
  const base = memcachedBasePayload(connection)

  if (nodeId === 'memcached:server') {
    return {
      ...base,
      objectView: 'server',
      stats: memcachedStats(),
      slabs: memcachedSlabs(),
      items: memcachedItems(),
      settings: memcachedSettings(),
      connections: memcachedConnections(),
      diagnostics: memcachedDiagnostics(),
      warnings: memcachedWarnings(),
    }
  }

  if (nodeId === 'memcached:stats') {
    return {
      ...base,
      objectView: 'stats',
      stats: memcachedStats(),
      diagnostics: memcachedDiagnostics(),
      warnings: memcachedWarnings(),
    }
  }

  if (nodeId === 'memcached:slabs' || nodeId.startsWith('memcached:slab:')) {
    const classId = nodeId.startsWith('memcached:slab:') ? nodeId.split(':').at(-1) : undefined
    return {
      ...base,
      objectView: classId ? 'slab' : 'slabs',
      slabs: memcachedSlabs().filter((row) => !classId || row.classId === classId),
      diagnostics: memcachedDiagnostics().filter((row) => row.signal.includes('Memory') || row.signal.includes('Evictions')),
      warnings: memcachedWarnings(),
    }
  }

  if (nodeId === 'memcached:items' || nodeId.startsWith('memcached:item-class:')) {
    const classId = nodeId.startsWith('memcached:item-class:') ? nodeId.split(':').at(-1) : undefined
    return {
      ...base,
      objectView: classId ? 'item-class' : 'items',
      items: memcachedItems().filter((row) => !classId || row.classId === classId),
      diagnostics: memcachedDiagnostics().filter((row) => row.signal.includes('Evictions') || row.signal.includes('Hit Rate')),
      warnings: memcachedWarnings(),
    }
  }

  if (nodeId === 'memcached:settings') {
    return {
      ...base,
      objectView: 'settings',
      settings: memcachedSettings(),
      warnings: memcachedWarnings(),
    }
  }

  if (nodeId === 'memcached:connections') {
    return {
      ...base,
      objectView: 'connections',
      connections: memcachedConnections(),
      diagnostics: memcachedDiagnostics().filter((row) => row.signal.includes('Connection')),
      warnings: memcachedWarnings(),
    }
  }

  return {
    ...base,
    objectView: 'diagnostics',
    stats: memcachedStats(),
    diagnostics: memcachedDiagnostics(),
    warnings: memcachedWarnings(),
  }
}

function memcachedNode(
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

function memcachedBasePayload(connection: ConnectionProfile) {
  return {
    engine: 'memcached',
    host: connection.host || 'localhost',
    port: connection.port ?? 11211,
    hitRate: '99.2%',
    currentItems: 12842,
    bytesUsed: '42.8 MB',
    evictions: 12,
    currentConnections: 18,
  }
}

function memcachedStats() {
  return [
    { metric: 'curr_items', value: 12842, unit: 'items', section: 'items' },
    { metric: 'bytes', value: '42.8 MB', unit: 'memory', section: 'memory' },
    { metric: 'limit_maxbytes', value: '256 MB', unit: 'memory', section: 'memory' },
    { metric: 'cmd_get', value: 1482931, unit: 'commands', section: 'commands' },
    { metric: 'get_hits', value: 1471453, unit: 'hits', section: 'commands' },
    { metric: 'get_misses', value: 11478, unit: 'misses', section: 'commands' },
    { metric: 'evictions', value: 12, unit: 'items', section: 'items' },
    { metric: 'curr_connections', value: 18, unit: 'clients', section: 'connections' },
  ]
}

function memcachedSlabs() {
  return [
    { classId: '1', chunkSize: '96 B', usedChunks: 2048, freeChunks: 512, totalPages: 2, memory: '192 KB' },
    { classId: '2', chunkSize: '240 B', usedChunks: 48128, freeChunks: 1280, totalPages: 12, memory: '11.0 MB' },
    { classId: '3', chunkSize: '1.2 KB', usedChunks: 9870, freeChunks: 420, totalPages: 16, memory: '18.8 MB' },
  ]
}

function memcachedItems() {
  return [
    { classId: '1', number: 1024, age: '4m', evicted: 0, outOfMemory: 0, reclaimed: 12 },
    { classId: '2', number: 9004, age: '18m', evicted: 7, outOfMemory: 0, reclaimed: 481 },
    { classId: '3', number: 2814, age: '11m', evicted: 5, outOfMemory: 0, reclaimed: 132 },
  ]
}

function memcachedSettings() {
  return [
    { name: 'maxbytes', value: '256 MB', impact: 'cache capacity limit' },
    { name: 'maxconns', value: 1024, impact: 'client connection ceiling' },
    { name: 'tcpport', value: 11211, impact: 'TCP listener' },
    { name: 'evictions', value: 'enabled', impact: 'older items may be evicted under pressure' },
    { name: 'lru_crawler', value: 'enabled', impact: 'background LRU maintenance' },
  ]
}

function memcachedConnections() {
  return [
    { name: 'current', value: 18, unit: 'clients', status: 'healthy' },
    { name: 'max', value: 1024, unit: 'clients', status: 'configured' },
    { name: 'rejected', value: 0, unit: 'clients', status: 'healthy' },
    { name: 'listen_disabled', value: 0, unit: 'events', status: 'healthy' },
  ]
}

function memcachedDiagnostics() {
  return [
    { signal: 'Hit Rate', value: '99.2%', status: 'healthy', guidance: 'Cache is serving most requested keys.' },
    { signal: 'Evictions', value: 12, status: 'watch', guidance: 'Review maxbytes and slab classes if evictions keep rising.' },
    { signal: 'Memory Pressure', value: '16.7%', status: 'healthy', guidance: 'Used memory is comfortably below maxbytes.' },
    { signal: 'Connection Pressure', value: '1.8%', status: 'healthy', guidance: 'Active clients are well below max connections.' },
  ]
}

function memcachedWarnings() {
  return [
    'Memcached does not expose safe key enumeration; use application key knowledge or targeted get/set flows.',
  ]
}
