export type MemcachedObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
}

const DESCRIPTORS: Record<string, MemcachedObjectViewDescriptor> = {
  server: descriptor('server', 'Open Server Overview', 'Memcached Server', 'Review cache capacity, item pressure, hit rate, connections, slabs, and safe next actions.', 'Server metadata is not loaded', 'Refresh server metadata or verify the Memcached endpoint is reachable.'),
  stats: descriptor('stats', 'Open Stats', 'Memcached Stats', 'Review operational counters, item counts, memory usage, hit rate, and eviction pressure.', 'No stats are loaded', 'Refresh stats metadata for this Memcached server.'),
  slabs: descriptor('slabs', 'Review Slabs', 'Memcached Slabs', 'Review slab classes, chunk sizing, page allocation, used chunks, and memory pressure.', 'No slab metadata is loaded', 'Refresh slab stats or check whether the server exposes slab metadata.'),
  slab: descriptor('slab', 'Open Slab Class', 'Memcached Slab Class', 'Inspect one slab class with chunk sizing, allocation pressure, and storage efficiency hints.', 'Slab class metadata is not loaded', 'Refresh this slab class.'),
  items: descriptor('items', 'Review Item Classes', 'Memcached Item Classes', 'Review item-class counts, age, evictions, reclaimed items, and out-of-memory signals.', 'No item-class metadata is loaded', 'Refresh item stats for this server.'),
  'item-class': descriptor('item-class', 'Open Item Class', 'Memcached Item Class', 'Inspect one item class with count, age, eviction pressure, and allocation health.', 'Item class metadata is not loaded', 'Refresh this item class.'),
  settings: descriptor('settings', 'Open Settings', 'Memcached Settings', 'Review cache limits, connection limits, protocols, LRU behavior, and operational flags.', 'No settings metadata is loaded', 'Refresh server settings.'),
  connections: descriptor('connections', 'Review Connections', 'Memcached Connections', 'Review active, rejected, and saturated connection signals for the cache server.', 'No connection metadata is loaded', 'Refresh connection metadata.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'Memcached Diagnostics', 'Review hit ratio, eviction pressure, memory pressure, connection pressure, and actionable warnings.', 'No diagnostics are loaded', 'Refresh diagnostics metadata.'),
}

const DEFAULT_DESCRIPTOR = descriptor(
  'object',
  'Inspect Memcached Object',
  'Memcached Object',
  'Review available Memcached metadata for this object.',
  'Memcached metadata is not available',
  'Refresh this object or check whether the connection can inspect it.',
)

export function getMemcachedObjectViewDescriptor(kind: string | undefined): MemcachedObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeMemcachedObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function memcachedObjectViewMenuLabel(kind: string | undefined): string {
  return getMemcachedObjectViewDescriptor(kind).menuLabel
}

export function isMemcachedObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeMemcachedObjectKind(kind)])
}

export const MEMCACHED_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
): MemcachedObjectViewDescriptor {
  return {
    kind,
    menuLabel,
    title,
    purpose,
    emptyTitle,
    emptyDescription,
  }
}

function normalizeMemcachedObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
