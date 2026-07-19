import type {
  AdapterCapability,
  AdapterManifest,
  LocalDatabaseManifest,
} from './capabilities'
import {
  type ConnectionMode,
  type DatastoreEngine,
  type DatastoreFamily,
} from './connection'
import { datastoreTreeForEngine } from './datastore-tree-manifests'
import type { QueryLanguage, ResultRenderer } from './workspace'
import {
  POSTGRESQL_DATASTORE_FEATURE,
  COCKROACHDB_DATASTORE_FEATURE,
  SQLSERVER_DATASTORE_FEATURE,
  MYSQL_DATASTORE_FEATURE,
  MARIADB_DATASTORE_FEATURE,
  SQLITE_DATASTORE_FEATURE,
  ORACLE_DATASTORE_FEATURE,
} from './datastore-roadmap/sql'
import {
  TIMESCALEDB_DATASTORE_FEATURE,
  INFLUXDB_DATASTORE_FEATURE,
  PROMETHEUS_DATASTORE_FEATURE,
  OPENTSDB_DATASTORE_FEATURE,
} from './datastore-roadmap/timeseries'
import {
  MONGODB_DATASTORE_FEATURE,
  COSMOSDB_DATASTORE_FEATURE,
  LITEDB_DATASTORE_FEATURE,
} from './datastore-roadmap/document'
import {
  DYNAMODB_DATASTORE_FEATURE,
  CASSANDRA_DATASTORE_FEATURE,
} from './datastore-roadmap/widecolumn'
import {
  REDIS_DATASTORE_FEATURE,
  VALKEY_DATASTORE_FEATURE,
  MEMCACHED_DATASTORE_FEATURE,
} from './datastore-roadmap/keyvalue'
import {
  NEO4J_DATASTORE_FEATURE,
  NEPTUNE_DATASTORE_FEATURE,
  ARANGO_DATASTORE_FEATURE,
  JANUSGRAPH_DATASTORE_FEATURE,
} from './datastore-roadmap/graph'
import {
  ELASTICSEARCH_DATASTORE_FEATURE,
  OPENSEARCH_DATASTORE_FEATURE,
} from './datastore-roadmap/search'
import {
  CLICKHOUSE_DATASTORE_FEATURE,
  SNOWFLAKE_DATASTORE_FEATURE,
  BIGQUERY_DATASTORE_FEATURE,
} from './datastore-roadmap/warehouse'
import {
  DUCKDB_DATASTORE_FEATURE,
} from './datastore-roadmap/embedded-olap'

export interface DatastoreFeatureBacklogEntry {
  engine: DatastoreEngine
  displayName: string
  family: DatastoreFamily
  maturity: AdapterManifest['maturity']
  defaultLanguage: QueryLanguage
  queryLanguages: QueryLanguage[]
  connectionModes: ConnectionMode[]
  primaryConnectionMechanisms: string[]
  defaultPort?: number
  managementModel: string
  queryModel: string
  presentationModel: string
  securityModel: string
  resultRenderers: ResultRenderer[]
  capabilities: AdapterCapability[]
  baselineFeatures: string[]
  advancedFeatures: string[]
  diagnosticFeatures: string[]
  analyticsSignals: string[]
  roadmapNotes?: string[]
  localDatabase?: LocalDatabaseManifest
}

export const MVP_ADAPTER_ENGINES = [
  'postgresql',
  'cockroachdb',
  'sqlserver',
  'mysql',
  'mariadb',
  'sqlite',
  'mongodb',
  'redis',
] as const satisfies readonly DatastoreEngine[]

export const DATASTORE_FEATURE_BACKLOG: DatastoreFeatureBacklogEntry[] = [
  POSTGRESQL_DATASTORE_FEATURE,
  COCKROACHDB_DATASTORE_FEATURE,
  SQLSERVER_DATASTORE_FEATURE,
  MYSQL_DATASTORE_FEATURE,
  MARIADB_DATASTORE_FEATURE,
  SQLITE_DATASTORE_FEATURE,
  ORACLE_DATASTORE_FEATURE,
  TIMESCALEDB_DATASTORE_FEATURE,
  MONGODB_DATASTORE_FEATURE,
  DYNAMODB_DATASTORE_FEATURE,
  CASSANDRA_DATASTORE_FEATURE,
  COSMOSDB_DATASTORE_FEATURE,
  LITEDB_DATASTORE_FEATURE,
  REDIS_DATASTORE_FEATURE,
  VALKEY_DATASTORE_FEATURE,
  MEMCACHED_DATASTORE_FEATURE,
  NEO4J_DATASTORE_FEATURE,
  NEPTUNE_DATASTORE_FEATURE,
  ARANGO_DATASTORE_FEATURE,
  JANUSGRAPH_DATASTORE_FEATURE,
  INFLUXDB_DATASTORE_FEATURE,
  PROMETHEUS_DATASTORE_FEATURE,
  OPENTSDB_DATASTORE_FEATURE,
  ELASTICSEARCH_DATASTORE_FEATURE,
  OPENSEARCH_DATASTORE_FEATURE,
  CLICKHOUSE_DATASTORE_FEATURE,
  DUCKDB_DATASTORE_FEATURE,
  SNOWFLAKE_DATASTORE_FEATURE,
  BIGQUERY_DATASTORE_FEATURE,
]

export const BETA_ADAPTER_ENGINES = DATASTORE_FEATURE_BACKLOG.filter(
  (entry) => entry.maturity === 'beta',
).map((entry) => entry.engine)

export const PLANNED_ADAPTER_ENGINES = DATASTORE_FEATURE_BACKLOG.filter(
  (entry) => entry.maturity === 'planned',
).map((entry) => entry.engine)

export const DATAPADPLUSPLUS_ADAPTER_MANIFESTS: AdapterManifest[] =
  DATASTORE_FEATURE_BACKLOG.map((entry) => ({
    id: `adapter-${entry.engine}`,
    engine: entry.engine,
    family: entry.family,
    label: `${entry.displayName} adapter`,
    maturity: entry.maturity,
    capabilities: entry.capabilities,
    defaultLanguage: entry.defaultLanguage,
    localDatabase: entry.localDatabase,
    tree: datastoreTreeForEngine(entry.engine, entry.family),
  }))

export function datastoreBacklogByEngine(engine: DatastoreEngine) {
  return DATASTORE_FEATURE_BACKLOG.find((entry) => entry.engine === engine)
}
