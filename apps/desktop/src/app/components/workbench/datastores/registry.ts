import { postgresqlWorkbenchSlice } from './postgresql'
import { cockroachdbWorkbenchSlice } from './cockroachdb'
import { sqlserverWorkbenchSlice } from './sqlserver'
import { mysqlWorkbenchSlice } from './mysql'
import { mariadbWorkbenchSlice } from './mariadb'
import { sqliteWorkbenchSlice } from './sqlite'
import { oracleWorkbenchSlice } from './oracle'
import { timescaledbWorkbenchSlice } from './timescaledb'
import { mongodbWorkbenchSlice } from './mongodb'
import { dynamodbWorkbenchSlice } from './dynamodb'
import { cassandraWorkbenchSlice } from './cassandra'
import { cosmosdbWorkbenchSlice } from './cosmosdb'
import { litedbWorkbenchSlice } from './litedb'
import { redisWorkbenchSlice } from './redis'
import { valkeyWorkbenchSlice } from './valkey'
import { memcachedWorkbenchSlice } from './memcached'
import { neo4jWorkbenchSlice } from './neo4j'
import { neptuneWorkbenchSlice } from './neptune'
import { arangoWorkbenchSlice } from './arango'
import { janusgraphWorkbenchSlice } from './janusgraph'
import { influxdbWorkbenchSlice } from './influxdb'
import { prometheusWorkbenchSlice } from './prometheus'
import { opentsdbWorkbenchSlice } from './opentsdb'
import { elasticsearchWorkbenchSlice } from './elasticsearch'
import { opensearchWorkbenchSlice } from './opensearch'
import { clickhouseWorkbenchSlice } from './clickhouse'
import { duckdbWorkbenchSlice } from './duckdb'
import { snowflakeWorkbenchSlice } from './snowflake'
import { bigqueryWorkbenchSlice } from './bigquery'
import type { DatastoreWorkbenchSlice } from './types'

const workbenchSlices: DatastoreWorkbenchSlice[] = [
  postgresqlWorkbenchSlice,
  cockroachdbWorkbenchSlice,
  sqlserverWorkbenchSlice,
  mysqlWorkbenchSlice,
  mariadbWorkbenchSlice,
  sqliteWorkbenchSlice,
  oracleWorkbenchSlice,
  timescaledbWorkbenchSlice,
  mongodbWorkbenchSlice,
  dynamodbWorkbenchSlice,
  cassandraWorkbenchSlice,
  cosmosdbWorkbenchSlice,
  litedbWorkbenchSlice,
  redisWorkbenchSlice,
  valkeyWorkbenchSlice,
  memcachedWorkbenchSlice,
  neo4jWorkbenchSlice,
  neptuneWorkbenchSlice,
  arangoWorkbenchSlice,
  janusgraphWorkbenchSlice,
  influxdbWorkbenchSlice,
  prometheusWorkbenchSlice,
  opentsdbWorkbenchSlice,
  elasticsearchWorkbenchSlice,
  opensearchWorkbenchSlice,
  clickhouseWorkbenchSlice,
  duckdbWorkbenchSlice,
  snowflakeWorkbenchSlice,
  bigqueryWorkbenchSlice,
]

const workbenchSlicesByEngine = new Map(
  workbenchSlices.map((slice) => [slice.engine, slice] as const),
)

if (workbenchSlicesByEngine.size !== workbenchSlices.length) {
  throw new Error('Datastore workbench registry contains duplicate engine providers.')
}

export function workbenchSliceForEngine(engine: DatastoreWorkbenchSlice['engine']) {
  const slice = workbenchSlicesByEngine.get(engine)
  if (!slice) {
    throw new Error(`Datastore workbench provider is missing for ${engine}.`)
  }
  return slice
}

export { workbenchSlices }
