import type {
  ConnectionProfile,
  DatastoreEngine,
  ExplorerNode,
  QueryBuilderState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import { explorerNodeTarget } from '../SideBar.helpers'

export interface QueryTargetLevel {
  id: string
  label: string
  kinds: string[]
  containerKinds: string[]
  selectable?: boolean
}

export interface QueryTargetRegistryEntry {
  levels: QueryTargetLevel[]
  noTargetReason?: string
}

export interface QueryTargetOption {
  value: string
  label: string
  values?: string[]
  scope?: string
  target?: ScopedQueryTarget
  unavailable?: boolean
}

const database = level('database', 'Database', ['database', 'catalog'], ['databases', 'catalogs'])
const schema = level('schema', 'Schema', ['schema'], ['schemas', 'user-schemas'])
const relation = level(
  'relation',
  'Table or view',
  ['table', 'base-table', 'view', 'materialized-view', 'hypertable'],
  ['tables', 'views', 'materialized-views', 'hypertables'],
  true,
)
const collection = level(
  'collection',
  'Collection',
  ['collection', 'gridfs-collection', 'view'],
  ['collections', 'views', 'gridfs'],
  true,
)
const graphObject = level(
  'graph-object',
  'Label or collection',
  ['node-label', 'relationship', 'collection', 'edge-collection'],
  ['node-labels', 'relationship-types', 'collections', 'edge-collections'],
  true,
)

export const QUERY_TARGET_REGISTRY: Record<DatastoreEngine, QueryTargetRegistryEntry> = {
  postgresql: { levels: [database, schema, relation] },
  cockroachdb: { levels: [database, schema, relation] },
  sqlserver: { levels: [database, schema, relation] },
  mysql: { levels: [database, relation] },
  mariadb: { levels: [database, relation] },
  sqlite: { levels: [schema, relation] },
  oracle: { levels: [database, schema, relation] },
  mongodb: { levels: [database, collection] },
  dynamodb: {
    levels: [
      level('table', 'Table', ['table'], ['tables'], true),
      level(
        'index',
        'Secondary index',
        ['index', 'global-secondary-index', 'local-secondary-index'],
        ['indexes', 'global-secondary-indexes', 'local-secondary-indexes'],
        true,
      ),
    ],
  },
  cassandra: {
    levels: [
      level('keyspace', 'Keyspace', ['keyspace'], ['keyspaces']),
      level('relation', 'Table or view', ['table', 'materialized-view'], ['tables', 'materialized-views'], true),
    ],
  },
  cosmosdb: {
    levels: [
      database,
      level('container', 'Container or graph', ['container', 'collection', 'graph'], ['containers', 'collections', 'graphs'], true),
    ],
  },
  litedb: { levels: [database, collection] },
  redis: {
    levels: [
      level('database', 'Logical database', ['database'], ['databases'], true),
      level('pattern', 'Key pattern', ['prefix'], ['prefixes'], true),
    ],
  },
  valkey: {
    levels: [
      level('database', 'Logical database', ['database'], ['databases'], true),
      level('pattern', 'Key pattern', ['prefix'], ['prefixes'], true),
    ],
  },
  memcached: { levels: [], noTargetReason: 'Memcached does not expose selectable namespaces.' },
  neo4j: {
    levels: [level('graph', 'Database', ['graph', 'database'], ['graphs', 'databases'], true), graphObject],
  },
  neptune: { levels: [], noTargetReason: 'Neptune queries do not expose a stable selectable graph namespace.' },
  arango: {
    levels: [level('graph', 'Graph', ['graph', 'database'], ['graphs', 'databases'], true), graphObject],
  },
  janusgraph: {
    levels: [level('graph', 'Graph', ['graph'], ['graphs'], true), graphObject],
  },
  influxdb: {
    levels: [
      level('bucket', 'Bucket or database', ['bucket', 'database'], ['buckets', 'databases']),
      level('measurement', 'Measurement', ['measurement'], ['measurements'], true),
    ],
  },
  timescaledb: { levels: [database, schema, relation] },
  prometheus: { levels: [level('metric', 'Metric', ['metric'], ['metrics'], true)] },
  opentsdb: { levels: [level('metric', 'Metric', ['metric'], ['metrics'], true)] },
  elasticsearch: { levels: [level('index', 'Index or data stream', ['index', 'data-stream'], ['indexes', 'data-streams'], true)] },
  opensearch: { levels: [level('index', 'Index or data stream', ['index', 'data-stream'], ['indexes', 'data-streams'], true)] },
  clickhouse: { levels: [database, schema, relation] },
  duckdb: { levels: [database, schema, relation] },
  snowflake: { levels: [database, schema, relation] },
  bigquery: {
    levels: [
      level('catalog', 'Project', ['project', 'catalog'], ['projects', 'catalogs']),
      level('schema', 'Dataset', ['dataset', 'schema'], ['datasets', 'schemas']),
      relation,
    ],
  },
}

export function queryTargetRegistryForEngine(engine: DatastoreEngine) {
  return QUERY_TARGET_REGISTRY[engine]
}

export function queryTargetOptions(
  connection: ConnectionProfile,
  nodes: ExplorerNode[],
  currentTarget: ScopedQueryTarget | undefined,
  builderState: QueryBuilderState | undefined,
) {
  const registry = queryTargetRegistryForEngine(connection.engine)
  const options = registry.levels.map(() => [] as QueryTargetOption[])

  for (const node of nodes) {
    const nodeKind = normalizeKind(node.kind)
    const explicitLevelIndex = registry.levels.findIndex((item) => item.kinds.includes(nodeKind))
    if (explicitLevelIndex < 0) {
      continue
    }
    const target = explorerNodeTarget(node, connection)
    const values = queryTargetValues(connection, target, registry)

    registry.levels.forEach((targetLevel, levelIndex) => {
      const explicitLevel = targetLevel.kinds.includes(nodeKind)
      const inferredValue = values[levelIndex]
      if (!explicitLevel && !inferredValue) {
        return
      }
      const value = explicitLevel ? node.label.trim() : inferredValue
      if (!value) {
        return
      }
      options[levelIndex]?.push({
        value,
        label: value,
        values,
        scope: explicitLevel ? node.scope : undefined,
        target:
          explicitLevel && (targetLevel.selectable || levelIndex === registry.levels.length - 1)
            ? target
            : undefined,
      })
    })
  }

  const selectedValues = currentQueryTargetValues(
    connection,
    currentTarget,
    builderState,
    registry,
  )
  return {
    levels: registry.levels,
    options: options.map((items, levelIndex) => {
      const deduplicated = dedupeOptions(items, levelIndex)
      const selected = selectedValues[levelIndex]
      if (selected && !deduplicated.some((item) => item.value === selected)) {
        deduplicated.unshift({
          value: selected,
          label: `${selected} (unavailable)`,
          values: selectedValues,
          unavailable: true,
        })
      }
      return deduplicated
    }),
    selectedValues,
  }
}

export function queryTargetValues(
  connection: ConnectionProfile,
  target: ScopedQueryTarget,
  registry = queryTargetRegistryForEngine(connection.engine),
) {
  const values = Array(registry.levels.length).fill('') as string[]
  if (values.length === 0) {
    return values
  }

  const kind = normalizeKind(target.kind)
  const explicitIndex = registry.levels.findIndex((item) => item.kinds.includes(kind))
  const leafIndex = explicitIndex >= 0 ? explicitIndex : registry.levels.length - 1
  values[leafIndex] = target.label.trim()

  const hints = targetLevelHints(connection, target)
  registry.levels.forEach((item, index) => {
    if (index < leafIndex && hints[item.id]) {
      values[index] = hints[item.id] ?? ''
    }
  })

  const parents = cleanTargetPath(target.path ?? [], connection)
    .filter((value) => !values.includes(value))
  const emptyParentIndexes = registry.levels
    .map((_, index) => index)
    .filter((index) => index < leafIndex && !values[index])
  for (
    let pathIndex = parents.length - 1, levelIndex = emptyParentIndexes.length - 1;
    pathIndex >= 0 && levelIndex >= 0;
    pathIndex -= 1, levelIndex -= 1
  ) {
    values[emptyParentIndexes[levelIndex] ?? 0] = parents[pathIndex] ?? ''
  }

  return values
}

export function targetRelatedExplorerScopes(
  connection: ConnectionProfile,
  nodes: ExplorerNode[],
  selectedValues: string[],
) {
  const registry = queryTargetRegistryForEngine(connection.engine)
  const relevantKinds = new Set(
    registry.levels.flatMap((item) => [...item.kinds, ...item.containerKinds]),
  )
  return nodes
    .filter((node) => node.expandable && node.scope && relevantKinds.has(normalizeKind(node.kind)))
    .filter((node) => {
      const kind = normalizeKind(node.kind)
      const levelIndex = registry.levels.findIndex((item) => item.kinds.includes(kind))
      return levelIndex < 0 || selectedValues[levelIndex] === node.label
    })
    .filter((node) => pathMatchesSelection(cleanTargetPath(node.path ?? [], connection), selectedValues))
    .map((node) => node.scope as string)
}

function currentQueryTargetValues(
  connection: ConnectionProfile,
  target: ScopedQueryTarget | undefined,
  builderState: QueryBuilderState | undefined,
  registry: QueryTargetRegistryEntry,
) {
  const values = target ? queryTargetValues(connection, target, registry) : registry.levels.map(() => '')
  const set = (levelId: string, value: string | number | undefined) => {
    const index = registry.levels.findIndex((item) => item.id === levelId)
    if (index >= 0 && value !== undefined && String(value).trim()) {
      values[index] = String(value)
    }
  }
  const setDefault = (levelId: string, value: string | number | undefined) => {
    const index = registry.levels.findIndex((item) => item.id === levelId)
    if (index >= 0 && !values[index] && value !== undefined && String(value).trim()) {
      values[index] = String(value)
    }
  }

  setDefault(
    'database',
    connection.database ??
      connection.cosmosDbOptions?.databaseName ??
      connection.warehouseOptions?.databaseName,
  )
  setDefault('catalog', connection.warehouseOptions?.projectId ?? connection.warehouseOptions?.catalogName)
  setDefault('schema', connection.warehouseOptions?.schemaName ?? connection.warehouseOptions?.datasetId)
  setDefault('keyspace', connection.cassandraOptions?.defaultKeyspace ?? connection.database)
  setDefault('bucket', connection.timeSeriesOptions?.bucket ?? connection.timeSeriesOptions?.databaseName)
  setDefault('graph', connection.graphOptions?.databaseName ?? connection.graphOptions?.graphName)
  setDefault('metric', connection.timeSeriesOptions?.defaultMetric)
  setDefault(
    'database',
    connection.redisOptions?.databaseIndex === undefined
      ? undefined
      : `DB ${connection.redisOptions.databaseIndex}`,
  )

  switch (builderState?.kind) {
    case 'mongo-find':
    case 'mongo-aggregation':
      set('database', builderState.database)
      set('collection', builderState.collection)
      break
    case 'sql-select':
      set('schema', builderState.schema)
      set('relation', builderState.table)
      break
    case 'dynamodb-key-condition':
      set('table', builderState.table)
      set('index', builderState.indexName)
      break
    case 'cql-partition':
      set('keyspace', builderState.keyspace)
      set('relation', builderState.table)
      break
    case 'search-dsl':
      set('index', builderState.index)
      break
    case 'cosmos-sql':
      set('database', builderState.database)
      set('container', builderState.container)
      break
    case 'redis-key-browser':
      set('database', builderState.databaseIndex === undefined ? undefined : `DB ${builderState.databaseIndex}`)
      set('pattern', builderState.pattern)
      break
  }

  return values
}

function targetLevelHints(connection: ConnectionProfile, target: ScopedQueryTarget) {
  const hints: Record<string, string | undefined> = {}
  const scope = target.scope ?? ''
  const parts = scope.split(':')
  const identity = parts.slice(1).join(':')
  const set = (id: string, value: string | undefined) => {
    if (value?.trim()) hints[id] = value.trim()
  }

  if (['mongodb', 'litedb', 'cosmosdb'].includes(connection.engine) && parts.length >= 3) {
    set('database', parts[1])
  }
  if (connection.engine === 'cassandra' && identity.includes('.')) {
    set('keyspace', identity.split('.')[0])
  }
  if (connection.engine === 'sqlserver' && parts.length >= 4) {
    set('database', parts[1])
    set('schema', parts[2])
  }
  if (['mysql', 'mariadb'].includes(connection.engine)) {
    const tableDatabase = /^table:([^.]+)\./i.exec(scope)?.[1]
    set('database', tableDatabase ?? (parts[0] === 'mysql' ? parts[1] : undefined))
  }
  if (connection.engine === 'oracle' && parts[0] === 'oracle' && parts[1] === 'object') {
    set('schema', parts[3])
  }
  if (
    ['postgresql', 'cockroachdb', 'timescaledb', 'sqlite', 'duckdb', 'clickhouse', 'snowflake', 'bigquery']
      .includes(connection.engine)
  ) {
    const scopedSchema = /^(?:table|view|materialized-view):([^.:]+)[.:]/i.exec(scope)?.[1]
    set('schema', scopedSchema)
  }
  if (connection.engine === 'dynamodb' && normalizeKind(target.kind).includes('index')) {
    set('table', cleanTargetPath(target.path ?? [], connection)[0])
  }
  if (['redis', 'valkey'].includes(connection.engine)) {
    const database = (target.path ?? [])
      .map((value) => /^DB\s+(\d+)$/i.exec(value.trim())?.[1])
      .find(Boolean)
    set('database', database === undefined ? undefined : `DB ${database}`)
  }

  set('database', valueAfterContainer(target.path ?? [], ['databases', 'catalogs']))
  set('catalog', valueAfterContainer(target.path ?? [], ['projects', 'catalogs']))
  set('schema', valueAfterContainer(target.path ?? [], ['schemas', 'user-schemas']))
  set('keyspace', valueAfterContainer(target.path ?? [], ['keyspaces']))
  set('bucket', valueAfterContainer(target.path ?? [], ['buckets']))
  set('graph', valueAfterContainer(target.path ?? [], ['graphs']))
  return hints
}

function valueAfterContainer(path: string[], containers: string[]) {
  const normalizedContainers = new Set(containers.map(normalizeKind))
  const index = path.findIndex((value) => normalizedContainers.has(normalizeKind(value)))
  return index >= 0 ? path[index + 1] : undefined
}

function cleanTargetPath(path: string[], connection?: ConnectionProfile) {
  const containers = new Set(
    Object.values(QUERY_TARGET_REGISTRY)
      .flatMap((entry) => entry.levels)
      .flatMap((item) => item.containerKinds)
      .map((item) => normalizeKind(item)),
  )
  return path
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => normalizeKind(value) !== normalizeKind(connection?.name ?? ''))
    .filter((value) => !containers.has(normalizeKind(value)))
}

function pathMatchesSelection(path: string[], selected: string[]) {
  const chosen = selected.filter(Boolean)
  if (chosen.length === 0 || path.length === 0) {
    return true
  }
  return chosen.every((value) => path.includes(value))
}

function dedupeOptions(options: QueryTargetOption[], levelIndex: number) {
  const byValue = new Map<string, QueryTargetOption>()
  for (const option of options) {
    const key = `${(option.values ?? []).slice(0, levelIndex + 1).join('\u001f')}\u001f${option.value}`
    const current = byValue.get(key)
    byValue.set(key, {
      ...current,
      ...option,
      scope: option.scope ?? current?.scope,
      target: option.target ?? current?.target,
    })
  }
  return [...byValue.values()].sort((left, right) => left.label.localeCompare(right.label))
}

function level(
  id: string,
  label: string,
  kinds: string[],
  containerKinds: string[],
  selectable = false,
): QueryTargetLevel {
  return {
    id,
    label,
    kinds: kinds.map(normalizeKind),
    containerKinds: containerKinds.map(normalizeKind),
    selectable,
  }
}

export function normalizeKind(value: string) {
  return value.trim().toLowerCase().replaceAll('_', '-').replaceAll(' ', '-')
}
