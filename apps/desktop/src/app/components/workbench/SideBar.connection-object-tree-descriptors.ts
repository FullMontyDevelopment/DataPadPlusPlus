import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  cassandraObjectViewMenuLabel,
  isCassandraObjectViewKind,
} from './CassandraObjectViewDescriptors'
import {
  cockroachObjectViewMenuLabel,
  isCockroachObjectViewKind,
} from './CockroachObjectViewDescriptors'
import {
  cosmosObjectViewMenuLabel,
  isCosmosObjectViewKind,
} from './CosmosObjectViewDescriptors'
import {
  duckDbObjectViewMenuLabel,
  isDuckDbObjectViewKind,
} from './DuckDbObjectViewDescriptors'
import {
  dynamoObjectViewMenuLabel,
  isDynamoObjectViewKind,
} from './DynamoObjectViewDescriptors'
import {
  graphObjectViewMenuLabel,
  isGraphObjectViewKind,
} from './GraphObjectViewDescriptors'
import {
  influxObjectViewMenuLabel,
  isInfluxObjectViewKind,
} from './InfluxObjectViewDescriptors'
import {
  isLiteDbObjectViewKind,
  liteDbObjectViewMenuLabel,
} from './LiteDbObjectViewDescriptors'
import {
  isMemcachedObjectViewKind,
  memcachedObjectViewMenuLabel,
} from './MemcachedObjectViewDescriptors'
import {
  isMongoObjectViewKind,
  mongoObjectViewMenuLabel,
  mongoScopedQueryMenuLabel,
} from './MongoObjectViewDescriptors'
import {
  isMysqlObjectViewKind,
  mysqlObjectViewMenuLabel,
} from './MysqlObjectViewDescriptors'
import {
  isOpenTsdbObjectViewKind,
  openTsdbObjectViewMenuLabel,
} from './OpenTsdbObjectViewDescriptors'
import {
  isOracleObjectViewKind,
  oracleObjectViewMenuLabel,
} from './OracleObjectViewDescriptors'
import {
  isPostgresObjectViewKind,
  postgresObjectViewMenuLabel,
} from './PostgresObjectViewDescriptors'
import {
  isPrometheusObjectViewKind,
  prometheusObjectViewMenuLabel,
} from './PrometheusObjectViewDescriptors'
import {
  isRedisObjectViewKind,
  redisObjectViewMenuLabel,
} from './RedisObjectViewDescriptors'
import {
  isSearchObjectViewKind,
  searchObjectViewMenuLabel,
} from './SearchObjectViewDescriptors'
import {
  isSqliteObjectViewKind,
  sqliteObjectViewMenuLabel,
} from './SqliteObjectViewDescriptors'
import {
  isSqlServerObjectViewKind,
  sqlServerObjectViewMenuLabel,
} from './SqlServerObjectViewDescriptors'
import {
  isWarehouseObjectViewKind,
  warehouseObjectViewMenuLabel,
} from './WarehouseObjectViewDescriptors'
import type { ConnectionTreeNode } from './SideBar.helpers'

export function isObjectViewNode(connection: ConnectionProfile, node: ConnectionTreeNode) {
  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return isRedisObjectViewKind(node.kind)
  }
  if (connection.engine === 'memcached') return isMemcachedObjectViewKind(node.kind)
  if (connection.engine === 'litedb') return isLiteDbObjectViewKind(node.kind)
  if (connection.engine === 'cosmosdb') return isCosmosObjectViewKind(node.kind)
  if (connection.engine === 'oracle') return isOracleObjectViewKind(node.kind)
  if (connection.engine === 'cockroachdb') return isCockroachObjectViewKind(node.kind)
  if (connection.engine === 'postgresql' || connection.engine === 'timescaledb') {
    return isPostgresObjectViewKind(node.kind)
  }
  if (connection.engine === 'sqlserver') return isSqlServerObjectViewKind(node.kind)
  if (connection.engine === 'sqlite') return isSqliteObjectViewKind(node.kind)
  if (connection.engine === 'duckdb') return isDuckDbObjectViewKind(node.kind)
  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return isMysqlObjectViewKind(node.kind)
  }
  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return isSearchObjectViewKind(node.kind)
  }
  if (connection.engine === 'dynamodb') return isDynamoObjectViewKind(node.kind)
  if (connection.engine === 'cassandra') return isCassandraObjectViewKind(node.kind)
  if (connection.family === 'graph') return isGraphObjectViewKind(node.kind)
  if (connection.family === 'warehouse') return isWarehouseObjectViewKind(node.kind)
  if (connection.engine === 'prometheus') return isPrometheusObjectViewKind(node.kind)
  if (connection.engine === 'influxdb') return isInfluxObjectViewKind(node.kind)
  if (connection.engine === 'opentsdb') return isOpenTsdbObjectViewKind(node.kind)

  return connection.engine === 'mongodb' && isMongoObjectViewKind(node.kind)
}

export function objectViewMenuLabel(connection: ConnectionProfile, kind: string | undefined) {
  if (connection.engine === 'mongodb') return mongoObjectViewMenuLabel(kind)
  if (connection.engine === 'oracle') return oracleObjectViewMenuLabel(kind)
  if (connection.engine === 'cockroachdb') return cockroachObjectViewMenuLabel(kind)
  if (connection.engine === 'postgresql' || connection.engine === 'timescaledb') {
    return postgresObjectViewMenuLabel(kind)
  }
  if (connection.engine === 'sqlserver') return sqlServerObjectViewMenuLabel(kind)
  if (connection.engine === 'sqlite') return sqliteObjectViewMenuLabel(kind)
  if (connection.engine === 'duckdb') return duckDbObjectViewMenuLabel(kind)
  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return mysqlObjectViewMenuLabel(kind)
  }
  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return redisObjectViewMenuLabel(kind)
  }
  if (connection.engine === 'memcached') return memcachedObjectViewMenuLabel(kind)
  if (connection.engine === 'litedb') return liteDbObjectViewMenuLabel(kind)
  if (connection.engine === 'cosmosdb') return cosmosObjectViewMenuLabel(kind)
  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return searchObjectViewMenuLabel(kind)
  }
  if (connection.engine === 'dynamodb') return dynamoObjectViewMenuLabel(kind)
  if (connection.engine === 'cassandra') return cassandraObjectViewMenuLabel(kind)
  if (connection.family === 'graph') return graphObjectViewMenuLabel(kind)
  if (connection.family === 'warehouse') return warehouseObjectViewMenuLabel(kind)
  if (connection.engine === 'prometheus') return prometheusObjectViewMenuLabel(kind)
  if (connection.engine === 'influxdb') return influxObjectViewMenuLabel(kind)
  if (connection.engine === 'opentsdb') return openTsdbObjectViewMenuLabel(kind)

  return 'Inspect Object'
}

export function scopedQueryMenuLabel(connection: ConnectionProfile, kind: string | undefined) {
  const normalizedKind = kind?.trim().toLowerCase().replace(/[_\s]+/g, '-')

  if (connection.engine === 'mongodb') return mongoScopedQueryMenuLabel(kind)
  if (connection.engine === 'redis' || connection.engine === 'valkey') return 'Open Key Browser'
  if (connection.engine === 'prometheus') return 'Open PromQL Query'
  if (connection.engine === 'influxdb') return 'Open Time-Series Query'
  if (connection.engine === 'opentsdb') return 'Open OpenTSDB Query'

  if (connection.family === 'graph') {
    return connection.engine === 'arango'
      ? 'Open AQL Query'
      : connection.engine === 'neptune' || connection.engine === 'janusgraph'
        ? 'Open Gremlin Query'
        : 'Open Cypher Query'
  }

  if (connection.family === 'warehouse') {
    return connection.engine === 'bigquery'
      ? 'Open BigQuery SQL'
      : connection.engine === 'snowflake'
        ? 'Open Snowflake SQL'
        : connection.engine === 'clickhouse'
          ? 'Open ClickHouse SQL'
          : 'Open SQL Query'
  }

  if (connection.family === 'sql') {
    if (
      normalizedKind &&
      [
        'table',
        'base-table',
        'strict-table',
        'virtual-table',
        'fts-table',
        'rtree-table',
        'hypertable',
      ].includes(normalizedKind)
    ) {
      return 'Open Table Data'
    }

    if (normalizedKind === 'view' || normalizedKind === 'materialized-view') {
      return 'Open View Data'
    }

    if (normalizedKind === 'data') {
      return 'Open Data Query'
    }

    return 'Open SQL Query'
  }

  return 'Open Query'
}

export function objectNodeTitle(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  queryable: boolean,
  objectViewable: boolean,
  hasChildren: boolean,
) {
  const base = node.detail ? `${node.label}: ${node.detail}` : node.label

  if (objectViewable && !hasChildren) {
    return `${base}. Click to ${objectViewMenuLabel(connection, node.kind).toLowerCase()}.`
  }

  if (!queryable) return base
  if (hasChildren) return `${base}. Right-click to open a scoped query.`

  return `${base}. Click to open a scoped query.`
}
