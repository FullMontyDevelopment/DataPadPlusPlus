import type {
  ConnectionProfile,
  DatastoreExperienceManifest,
} from '@datapadplusplus/shared-types'

type QueryBuilder = DatastoreExperienceManifest['queryBuilders'][number]

const SINGLE_QUERY_BUILDER_BY_ENGINE: Partial<
  Record<ConnectionProfile['engine'], QueryBuilder>
> = {
  elasticsearch: {
    kind: 'search-dsl',
    label: 'Search DSL Builder',
    scope: 'index',
    defaultMode: 'split',
  },
  opensearch: {
    kind: 'search-dsl',
    label: 'Search DSL Builder',
    scope: 'index',
    defaultMode: 'split',
  },
  dynamodb: {
    kind: 'dynamodb-key-condition',
    label: 'Key Condition Builder',
    scope: 'table',
    defaultMode: 'split',
  },
  cassandra: {
    kind: 'cql-partition',
    label: 'Partition Key Builder',
    scope: 'table',
    defaultMode: 'split',
  },
  prometheus: {
    kind: 'timeseries-query',
    label: 'PromQL Range Builder',
    scope: 'query',
    defaultMode: 'split',
  },
  influxdb: {
    kind: 'timeseries-query',
    label: 'Flux / InfluxQL Builder',
    scope: 'query',
    defaultMode: 'split',
  },
  opentsdb: {
    kind: 'timeseries-query',
    label: 'Metric Query Builder',
    scope: 'query',
    defaultMode: 'split',
  },
  redis: {
    kind: 'redis-key-browser',
    label: 'Key Browser',
    scope: 'key',
    defaultMode: 'visual',
  },
  valkey: {
    kind: 'redis-key-browser',
    label: 'Key Browser',
    scope: 'key',
    defaultMode: 'visual',
  },
}

const GRAPH_QUERY_BUILDER_LABELS: Partial<Record<ConnectionProfile['engine'], string>> = {
  arango: 'AQL Graph Builder',
  janusgraph: 'Gremlin Traversal Builder',
  neo4j: 'Cypher Pattern Builder',
  neptune: 'Gremlin / openCypher Builder',
}

const SQL_SELECT_ENGINES = new Set<ConnectionProfile['engine']>([
  'postgresql',
  'cockroachdb',
  'sqlserver',
  'mysql',
  'mariadb',
  'sqlite',
  'timescaledb',
  'oracle',
  'duckdb',
  'clickhouse',
  'snowflake',
  'bigquery',
])

export function browserQueryBuilders(
  engine: ConnectionProfile['engine'],
): DatastoreExperienceManifest['queryBuilders'] {
  if (engine === 'mongodb') {
    return [
      { kind: 'mongo-find', label: 'Find Builder', scope: 'collection', defaultMode: 'visual' },
      {
        kind: 'mongo-aggregation',
        label: 'Aggregation Builder',
        scope: 'collection',
        defaultMode: 'visual',
      },
    ]
  }

  const singleBuilder = SINGLE_QUERY_BUILDER_BY_ENGINE[engine]
  if (singleBuilder) {
    return [singleBuilder]
  }

  const graphLabel = GRAPH_QUERY_BUILDER_LABELS[engine]
  if (graphLabel) {
    return [
      {
        kind: 'graph-query',
        label: graphLabel,
        scope: 'query',
        defaultMode: 'split',
      },
    ]
  }

  if (SQL_SELECT_ENGINES.has(engine)) {
    return [{ kind: 'sql-select', label: 'SQL SELECT Builder', scope: 'table', defaultMode: 'raw' }]
  }

  return []
}
