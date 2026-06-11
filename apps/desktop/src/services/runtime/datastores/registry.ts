import { postgresqlRuntimeSlice } from './postgresql'
import { cockroachdbRuntimeSlice } from './cockroachdb'
import { sqlserverRuntimeSlice } from './sqlserver'
import { mysqlRuntimeSlice } from './mysql'
import { mariadbRuntimeSlice } from './mariadb'
import { sqliteRuntimeSlice } from './sqlite'
import { oracleRuntimeSlice } from './oracle'
import { timescaledbRuntimeSlice } from './timescaledb'
import { mongodbRuntimeSlice } from './mongodb'
import { dynamodbRuntimeSlice } from './dynamodb'
import { cassandraRuntimeSlice } from './cassandra'
import { cosmosdbRuntimeSlice } from './cosmosdb'
import { litedbRuntimeSlice } from './litedb'
import { redisRuntimeSlice } from './redis'
import { valkeyRuntimeSlice } from './valkey'
import { memcachedRuntimeSlice } from './memcached'
import { neo4jRuntimeSlice } from './neo4j'
import { neptuneRuntimeSlice } from './neptune'
import { arangoRuntimeSlice } from './arango'
import { janusgraphRuntimeSlice } from './janusgraph'
import { influxdbRuntimeSlice } from './influxdb'
import { prometheusRuntimeSlice } from './prometheus'
import { opentsdbRuntimeSlice } from './opentsdb'
import { elasticsearchRuntimeSlice } from './elasticsearch'
import { opensearchRuntimeSlice } from './opensearch'
import { clickhouseRuntimeSlice } from './clickhouse'
import { duckdbRuntimeSlice } from './duckdb'
import { snowflakeRuntimeSlice } from './snowflake'
import { bigqueryRuntimeSlice } from './bigquery'
import type { DatastoreRuntimeSlice } from './types'

const runtimeSlices: DatastoreRuntimeSlice[] = [
  postgresqlRuntimeSlice,
  cockroachdbRuntimeSlice,
  sqlserverRuntimeSlice,
  mysqlRuntimeSlice,
  mariadbRuntimeSlice,
  sqliteRuntimeSlice,
  oracleRuntimeSlice,
  timescaledbRuntimeSlice,
  mongodbRuntimeSlice,
  dynamodbRuntimeSlice,
  cassandraRuntimeSlice,
  cosmosdbRuntimeSlice,
  litedbRuntimeSlice,
  redisRuntimeSlice,
  valkeyRuntimeSlice,
  memcachedRuntimeSlice,
  neo4jRuntimeSlice,
  neptuneRuntimeSlice,
  arangoRuntimeSlice,
  janusgraphRuntimeSlice,
  influxdbRuntimeSlice,
  prometheusRuntimeSlice,
  opentsdbRuntimeSlice,
  elasticsearchRuntimeSlice,
  opensearchRuntimeSlice,
  clickhouseRuntimeSlice,
  duckdbRuntimeSlice,
  snowflakeRuntimeSlice,
  bigqueryRuntimeSlice,
]

export function runtimeSliceForEngine(engine: DatastoreRuntimeSlice['engine']) {
  return runtimeSlices.find((slice) => slice.engine === engine)
}

export { runtimeSlices }
