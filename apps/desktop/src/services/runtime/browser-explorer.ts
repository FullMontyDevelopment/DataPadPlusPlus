import type { ConnectionProfile, ExplorerInspectRequest, ExplorerInspectResponse, ExplorerNode, WorkspaceSnapshot } from '@datapadplusplus/shared-types'
import {
  cassandraInspectQueryTemplate,
  createCassandraExplorerNodes,
} from './browser-cassandra-explorer'
import { cassandraInspectPayload } from './browser-cassandra-payloads'
import {
  createDuckDbExplorerNodes,
  duckDbInspectPayload,
  duckDbInspectQueryTemplate,
} from './browser-duckdb-explorer'
import {
  createOracleExplorerNodes,
  oracleInspectPayload,
  oracleInspectQueryTemplate,
} from './browser-oracle-explorer'
import {
  createOpenTsdbExplorerNodes,
  openTsdbInspectPayload,
  openTsdbInspectQueryTemplate,
} from './browser-opentsdb-explorer'
import {
  createCockroachExplorerNodes,
  createPostgresExplorerNodes,
} from './browser-postgres-family-explorer'
import { createTimescaleExplorerNodes } from './browser-timescale-explorer'
import {
  cockroachInspectPayload,
  cockroachInspectQueryTemplate,
  postgresInspectPayload,
  postgresInspectQueryTemplate,
} from './browser-postgres-family-payloads'
import { isPostgresLike } from './browser-postgres-family-helpers'
import {
  createMemcachedExplorerNodes,
  memcachedInspectPayload,
  memcachedInspectQueryTemplate,
} from './browser-memcached-explorer'
import {
  createMongoExplorerNodes,
} from './browser-mongo-explorer'
import { mongoInspectPayload } from './browser-mongo-payloads'
import { mongoInspectQueryTemplate } from './browser-mongo-query-templates'
import {
  createMysqlExplorerNodes,
  mysqlInspectQueryTemplate,
} from './browser-mysql-explorer'
import { mysqlInspectPayload } from './browser-mysql-payloads'
import {
  createLiteDbExplorerNodes,
  liteDbInspectPayload,
  liteDbInspectQueryTemplate,
} from './browser-litedb-explorer'
import {
  cosmosInspectPayload,
  cosmosInspectQueryTemplate,
  createCosmosExplorerNodes,
} from './browser-cosmos-explorer'
import {
  createDynamoExplorerNodes,
  dynamoInspectPayload,
  dynamoInspectQueryTemplate,
} from './browser-dynamo-explorer'
import {
  createGraphExplorerNodes,
  graphInspectPayload,
  graphInspectQueryTemplate,
} from './browser-graph-explorer'
import {
  createInfluxExplorerNodes,
  influxInspectPayload,
  influxInspectQueryTemplate,
} from './browser-influx-explorer'
import {
  createPrometheusExplorerNodes,
  prometheusInspectPayload,
  prometheusInspectQueryTemplate,
} from './browser-prometheus-explorer'
import {
  createRedisExplorerNodes,
  redisInspectQueryTemplate,
} from './browser-redis-explorer'
import { redisInspectPayload } from './browser-redis-payloads'
import {
  createSearchExplorerNodes,
  searchInspectQueryTemplate,
} from './browser-search-explorer'
import { searchInspectPayload } from './browser-search-payloads'
import {
  createSqliteExplorerNodes,
  sqliteInspectQueryTemplate,
} from './browser-sqlite-explorer'
import { sqliteInspectPayload } from './browser-sqlite-payloads'
import {
  createSqlServerExplorerNodes,
  sqlServerInspectQueryTemplate,
} from './browser-sqlserver-explorer'
import { sqlServerInspectPayload } from './browser-sqlserver-payloads'
import {
  createWarehouseExplorerNodes,
  warehouseInspectPayload,
  warehouseInspectQueryTemplate,
} from './browser-warehouse-explorer'
import { findConnection } from './browser-store'

export function createExplorerNodes(
  connection: ConnectionProfile,
  scope?: string,
): ExplorerNode[] {
  if (connection.engine === 'mongodb') {
    return createMongoExplorerNodes(connection, scope)
  }

  if (connection.engine === 'litedb') {
    return createLiteDbExplorerNodes(connection, scope)
  }

  if (connection.engine === 'cosmosdb') {
    return createCosmosExplorerNodes(connection, scope)
  }

  if (connection.engine === 'oracle') {
    return createOracleExplorerNodes(connection, scope)
  }

  if (connection.engine === 'redis' || connection.engine === 'valkey') {
    return createRedisExplorerNodes(connection, scope)
  }

  if (connection.engine === 'memcached') {
    return createMemcachedExplorerNodes(connection, scope)
  }

  if (connection.engine === 'cockroachdb') {
    return createCockroachExplorerNodes(connection, scope)
  }

  if (connection.engine === 'timescaledb') {
    return createTimescaleExplorerNodes(connection, scope)
  }

  if (isPostgresLike(connection)) {
    return createPostgresExplorerNodes(connection, scope)
  }

  if (connection.engine === 'sqlserver') {
    return createSqlServerExplorerNodes(connection, scope)
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return createMysqlExplorerNodes(connection, scope)
  }

  if (connection.engine === 'elasticsearch' || connection.engine === 'opensearch') {
    return createSearchExplorerNodes(connection, scope)
  }

  if (connection.engine === 'dynamodb') {
    return createDynamoExplorerNodes(connection, scope)
  }

  if (connection.engine === 'cassandra') {
    return createCassandraExplorerNodes(connection, scope)
  }

  if (connection.engine === 'prometheus') {
    return createPrometheusExplorerNodes(scope)
  }

  if (connection.engine === 'influxdb') {
    return createInfluxExplorerNodes(connection, scope)
  }

  if (connection.engine === 'opentsdb') {
    return createOpenTsdbExplorerNodes(scope)
  }

  if (connection.family === 'warehouse') {
    return createWarehouseExplorerNodes(connection, scope)
  }

  if (connection.family === 'graph') {
    return createGraphExplorerNodes(connection, scope)
  }

  if (connection.engine === 'sqlite') {
    return createSqliteExplorerNodes(connection, scope)
  }

  if (connection.engine === 'duckdb') {
    return createDuckDbExplorerNodes(connection, scope)
  }

  return []
}

export function inspectExplorerNodeLocally(
  snapshot: WorkspaceSnapshot,
  request: ExplorerInspectRequest,
): ExplorerInspectResponse {
  const connection = findConnection(snapshot, request.connectionId)

  if (!connection) {
    return {
      nodeId: request.nodeId,
      summary: 'Explorer node is not available in the current workspace.',
    }
  }

  const queryTemplate = connection.engine === 'mongodb'
    ? mongoInspectQueryTemplate(connection, request.nodeId)
    : connection.engine === 'oracle'
      ? oracleInspectQueryTemplate(request.nodeId)
      : connection.engine === 'litedb'
      ? liteDbInspectQueryTemplate(request.nodeId)
      : connection.engine === 'cosmosdb'
      ? cosmosInspectQueryTemplate(request.nodeId)
      : connection.engine === 'redis' || connection.engine === 'valkey'
      ? redisInspectQueryTemplate(request.nodeId)
      : connection.engine === 'memcached'
      ? memcachedInspectQueryTemplate(request.nodeId)
      : connection.engine === 'cockroachdb'
      ? cockroachInspectQueryTemplate(connection, request.nodeId)
      : isPostgresLike(connection)
      ? postgresInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'sqlserver'
      ? sqlServerInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'mysql' || connection.engine === 'mariadb'
      ? mysqlInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'elasticsearch' || connection.engine === 'opensearch'
      ? searchInspectQueryTemplate(request.nodeId)
      : connection.engine === 'dynamodb'
      ? dynamoInspectQueryTemplate(request.nodeId)
      : connection.engine === 'cassandra'
      ? cassandraInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'prometheus'
      ? prometheusInspectQueryTemplate(request.nodeId)
      : connection.engine === 'influxdb'
      ? influxInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'opentsdb'
      ? openTsdbInspectQueryTemplate(request.nodeId)
      : connection.family === 'warehouse'
      ? warehouseInspectQueryTemplate(connection, request.nodeId)
      : connection.family === 'graph'
      ? graphInspectQueryTemplate(connection, request.nodeId)
      : connection.engine === 'sqlite'
      ? sqliteInspectQueryTemplate(request.nodeId)
      : connection.engine === 'duckdb'
      ? duckDbInspectQueryTemplate(request.nodeId)
      : undefined

  return {
    nodeId: request.nodeId,
    summary: `Inspection ready for ${request.nodeId} on ${connection.name}.`,
    queryTemplate,
    payload:
      connection.engine === 'mongodb'
        ? mongoInspectPayload(connection, request.nodeId)
        : connection.engine === 'oracle'
          ? oracleInspectPayload(connection, request.nodeId)
        : connection.engine === 'litedb'
          ? liteDbInspectPayload(connection, request.nodeId)
        : connection.engine === 'cosmosdb'
          ? cosmosInspectPayload(connection, request.nodeId)
        : connection.engine === 'redis' || connection.engine === 'valkey'
          ? redisInspectPayload(request.nodeId)
        : connection.engine === 'memcached'
          ? memcachedInspectPayload(connection, request.nodeId)
        : connection.engine === 'cockroachdb'
          ? cockroachInspectPayload(connection, request.nodeId)
        : isPostgresLike(connection)
          ? postgresInspectPayload(connection, request.nodeId)
        : connection.engine === 'sqlserver'
          ? sqlServerInspectPayload(connection, request.nodeId)
        : connection.engine === 'mysql' || connection.engine === 'mariadb'
          ? mysqlInspectPayload(connection, request.nodeId)
        : connection.engine === 'elasticsearch' || connection.engine === 'opensearch'
          ? searchInspectPayload(connection, request.nodeId)
        : connection.engine === 'dynamodb'
          ? dynamoInspectPayload(connection, request.nodeId)
        : connection.engine === 'cassandra'
          ? cassandraInspectPayload(connection, request.nodeId)
        : connection.engine === 'prometheus'
          ? prometheusInspectPayload(connection, request.nodeId)
        : connection.engine === 'influxdb'
          ? influxInspectPayload(connection, request.nodeId)
        : connection.engine === 'opentsdb'
          ? openTsdbInspectPayload(request.nodeId)
        : connection.family === 'warehouse'
          ? warehouseInspectPayload(connection, request.nodeId)
        : connection.family === 'graph'
          ? graphInspectPayload(connection, request.nodeId)
        : connection.engine === 'sqlite'
          ? sqliteInspectPayload(request.nodeId)
        : connection.engine === 'duckdb'
          ? duckDbInspectPayload(connection, request.nodeId)
        : {
            engine: connection.engine,
            objectName: request.nodeId,
            objectView: 'unavailable',
            warnings: [
              'Preview metadata is not available for this datastore adapter yet.',
            ],
          },
  }
}
