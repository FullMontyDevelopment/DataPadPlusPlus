import type { ConnectionProfile, QueryTabState, QueryViewMode } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'

export function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function languageForConnection(connection: ConnectionProfile): QueryTabState['language'] {
  const defaultLanguage = datastoreBacklogByEngine(connection.engine)?.defaultLanguage

  if (defaultLanguage) {
    return defaultLanguage
  }

  if (connection.family === 'document') {
    return 'mongodb'
  }

  if (connection.family === 'keyvalue') {
    return 'redis'
  }

  return 'sql'
}

export function editorLanguageForConnection(connection: ConnectionProfile) {
  const language = languageForConnection(connection)

  if (language === 'mongodb' || language === 'json' || language === 'query-dsl') {
    return 'json'
  }

  if (
    language === 'sql' ||
    language === 'cql' ||
    language === 'google-sql' ||
    language === 'snowflake-sql' ||
    language === 'clickhouse-sql'
  ) {
    return 'sql'
  }

  return 'plaintext'
}

export function editorLabelForConnection(connection: ConnectionProfile) {
  const language = languageForConnection(connection)

  if (language === 'mongodb' || connection.family === 'document') {
    return 'Document query'
  }

  if (language === 'redis') {
    return `${connection.engine === 'valkey' ? 'Valkey' : 'Redis'} console`
  }

  if (language === 'cypher') {
    return 'Cypher editor'
  }

  if (language === 'gremlin') {
    return 'Gremlin editor'
  }

  if (language === 'sparql') {
    return 'SPARQL editor'
  }

  if (language === 'aql') {
    return 'AQL editor'
  }

  if (language === 'promql') {
    return 'PromQL editor'
  }

  if (language === 'influxql' || language === 'flux' || language === 'opentsdb') {
    return 'Time-series query'
  }

  if (language === 'query-dsl') {
    return 'Search DSL editor'
  }

  if (language === 'google-sql') {
    return 'GoogleSQL editor'
  }

  if (language === 'snowflake-sql') {
    return 'Snowflake SQL editor'
  }

  if (language === 'clickhouse-sql') {
    return 'ClickHouse SQL editor'
  }

  if (language === 'cql') {
    return 'CQL editor'
  }

  return 'SQL editor'
}

export function defaultQueryTextForConnection(connection: ConnectionProfile) {
  switch (connection.engine) {
    case 'mongodb':
      return '{\n  "collection": "",\n  "filter": {},\n  "limit": 20\n}'
    case 'dynamodb':
      return '{\n  "operation": "Scan",\n  "tableName": "",\n  "limit": 25\n}'
    case 'cosmosdb':
      return 'select top 50 * from c'
    case 'litedb':
      return '{\n  "collection": "",\n  "filter": {},\n  "limit": 20\n}'
    case 'redis':
    case 'valkey':
      return 'SCAN 0 MATCH * COUNT 25'
    case 'memcached':
      return 'stats'
    case 'cassandra':
      return ''
    case 'neo4j':
      return 'MATCH (n) OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m LIMIT 25'
    case 'neptune':
    case 'janusgraph':
      return 'g.V().limit(25)'
    case 'arango':
      return ''
    case 'influxdb':
      return ''
    case 'prometheus':
      return 'up'
    case 'opentsdb':
      return '{\n  "start": "1h-ago",\n  "queries": []\n}'
    case 'elasticsearch':
    case 'opensearch':
      return '{\n  "index": "",\n  "body": {\n    "query": { "match_all": {} },\n    "size": 20\n  }\n}'
    case 'bigquery':
    case 'snowflake':
    case 'clickhouse':
    case 'duckdb':
    case 'postgresql':
    case 'cockroachdb':
    case 'sqlserver':
    case 'mysql':
    case 'mariadb':
    case 'sqlite':
    case 'oracle':
    case 'timescaledb':
      return 'select 1;'
    default:
      return ''
  }
}

export function defaultQueryViewModeForConnection(connection: ConnectionProfile): QueryViewMode {
  switch (connection.engine) {
    case 'mongodb':
    case 'redis':
    case 'valkey':
    case 'dynamodb':
    case 'cassandra':
    case 'elasticsearch':
    case 'opensearch':
      return 'builder'
    default:
      return 'raw'
  }
}

export function defaultScriptTextForConnection(connection: ConnectionProfile) {
  if (connection.engine === 'mongodb') {
    return ''
  }

  return undefined
}

export function defaultRowLimitForConnection(connection: ConnectionProfile) {
  if (connection.family === 'document' || connection.family === 'keyvalue') {
    return 100
  }

  if (connection.family === 'search' || connection.family === 'timeseries') {
    return 250
  }

  return 200
}
