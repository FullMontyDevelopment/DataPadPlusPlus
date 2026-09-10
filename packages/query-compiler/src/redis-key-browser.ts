import type {
  QueryBuilderState,
  RedisKeyBrowserState,
  RedisKeyTypeFilter,
} from '@datapadplusplus/shared-types'

export const REDIS_KEY_TYPE_FILTERS: Array<{
  value: RedisKeyTypeFilter
  label: string
}> = [
  { value: 'all', label: 'All Key Types' },
  { value: 'string', label: 'Strings' },
  { value: 'hash', label: 'Hashes' },
  { value: 'list', label: 'Lists' },
  { value: 'set', label: 'Sets' },
  { value: 'zset', label: 'Sorted Sets' },
  { value: 'stream', label: 'Streams' },
  { value: 'json', label: 'JSON' },
  { value: 'timeseries', label: 'TimeSeries' },
  { value: 'bloom', label: 'Bloom' },
  { value: 'cuckoo', label: 'Cuckoo' },
  { value: 'cms', label: 'Count-Min' },
  { value: 'topk', label: 'TopK' },
  { value: 'tdigest', label: 't-digest' },
  { value: 'vectorset', label: 'Vector Sets' },
]

export function createDefaultRedisKeyBrowserState(
  pattern = '*',
  pageSize = 100,
): RedisKeyBrowserState {
  const state: RedisKeyBrowserState = {
    kind: 'redis-key-browser',
    pattern,
    typeFilter: 'all',
    databaseIndex: 0,
    delimiter: ':',
    cursor: '0',
    scanCount: pageSize,
    pageSize,
    scannedCount: 0,
    scanCursorByDb: { '0': '0' },
    filters: { ttl: 'all' },
    expandedPrefixes: [],
    visibleColumns: ['ttl', 'memory', 'length'],
    viewMode: 'tree',
    pipelineMode: false,
    consoleHistory: [],
  }

  return {
    ...state,
    lastAppliedQueryText: buildRedisKeyBrowserQueryText(state),
  }
}

export function isRedisKeyBrowserState(
  state: QueryBuilderState | undefined,
): state is RedisKeyBrowserState {
  return state?.kind === 'redis-key-browser'
}

export function buildRedisKeyBrowserQueryText(state: RedisKeyBrowserState) {
  return JSON.stringify(
    {
      mode: 'redis-key-browser',
      database: state.databaseIndex ?? 0,
      pattern: state.pattern || '*',
      type: state.typeFilter || 'all',
      delimiter: state.delimiter || ':',
      count: state.scanCount ?? state.pageSize ?? 100,
      filters: state.filters ?? { ttl: 'all' },
    },
    null,
    2,
  )
}

export function parseRedisKeyBrowserQueryText(
  queryText: string,
): RedisKeyBrowserState | undefined {
  try {
    const parsed = JSON.parse(queryText) as {
      mode?: unknown
      pattern?: unknown
      type?: unknown
      database?: unknown
      delimiter?: unknown
      count?: unknown
      filters?: unknown
    }

    if (parsed.mode !== 'redis-key-browser') {
      return undefined
    }

    const state = createDefaultRedisKeyBrowserState(
      typeof parsed.pattern === 'string' ? parsed.pattern : '*',
      typeof parsed.count === 'number' && Number.isFinite(parsed.count)
        ? Math.max(1, Math.floor(parsed.count))
        : 100,
    )

    return {
      ...state,
      typeFilter: isRedisKeyTypeFilter(parsed.type) ? parsed.type : 'all',
      databaseIndex:
        typeof parsed.database === 'number' && Number.isInteger(parsed.database)
          ? Math.max(0, parsed.database)
          : state.databaseIndex,
      delimiter: typeof parsed.delimiter === 'string' ? parsed.delimiter : state.delimiter,
      filters: parseRedisFilters(parsed.filters),
    }
  } catch {
    return undefined
  }
}

export function redisKeyTypeLabel(type: string | undefined) {
  const normalized = (type ?? 'unknown').toLowerCase()
  return REDIS_KEY_TYPE_FILTERS.find((item) => item.value === normalized)?.label ?? normalized
}

function isRedisKeyTypeFilter(value: unknown): value is RedisKeyTypeFilter {
  return (
    typeof value === 'string' &&
    REDIS_KEY_TYPE_FILTERS.some((item) => item.value === value)
  )
}

function parseRedisFilters(value: unknown): RedisKeyBrowserState['filters'] {
  if (!value || typeof value !== 'object') {
    return { ttl: 'all' }
  }

  const source = value as Record<string, unknown>
  const ttl =
    source.ttl === 'expiring' || source.ttl === 'persistent' || source.ttl === 'all'
      ? source.ttl
      : 'all'

  return {
    ttl,
    minBytes:
      typeof source.minBytes === 'number' && Number.isFinite(source.minBytes)
        ? Math.max(0, Math.floor(source.minBytes))
        : undefined,
    maxBytes:
      typeof source.maxBytes === 'number' && Number.isFinite(source.maxBytes)
        ? Math.max(0, Math.floor(source.maxBytes))
        : undefined,
  }
}
