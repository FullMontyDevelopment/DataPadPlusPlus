import { describe, expect, it } from 'vitest'
import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { cassandraTableNameFromNodeId, parseCassandraTableScope } from './browser-cassandra-helpers'
import { cosmosInspectQueryTemplate } from './browser-cosmos-explorer'
import { cosmosDiagnostics } from './browser-cosmos-explorer-samples'
import { createDynamoExplorerNodes, dynamoInspectPayload } from './browser-dynamo-explorer'
import { createGraphExplorerNodes } from './browser-graph-explorer'
import { createInfluxExplorerNodes } from './browser-influx-explorer'
import { createLiteDbExplorerNodes, liteDbInspectPayload } from './browser-litedb-explorer'
import { createMongoExplorerNodes } from './browser-mongo-explorer'
import { mongoInspectQueryTemplate } from './browser-mongo-query-templates'
import { createMysqlExplorerNodes } from './browser-mysql-explorer'
import { parseMysqlObjectScope } from './browser-mysql-helpers'
import { createCockroachExplorerNodes } from './browser-postgres-family-explorer'
import { parsePostgresObjectScope } from './browser-postgres-family-helpers'
import { createOracleExplorerNodes } from './browser-oracle-explorer'
import { createSqlServerExplorerNodes } from './browser-sqlserver-explorer'
import { parseSqlServerNodeId, parseSqlServerObjectScope } from './browser-sqlserver-helpers'
import { warehouseInspectPayload } from './browser-warehouse-explorer'

describe('browser runtime scoped target safety', () => {
  it('does not invent MongoDB databases or collections for incomplete scopes', () => {
    const connection = connectionProfile('mongodb', 'document', undefined)

    expect(createMongoExplorerNodes(connection, 'databases')).toEqual([])

    const collectionTemplate = mongoInspectQueryTemplate(connection, 'collection:')
    const indexesTemplate = mongoInspectQueryTemplate(connection, 'indexes:')

    expect(collectionTemplate).toContain('"operation": "inspect"')
    expect(indexesTemplate).toContain('"operation": "inspect"')
    expect(collectionTemplate).not.toContain('catalog')
    expect(collectionTemplate).not.toContain('products')
  })

  it('does not fall back to fixture DynamoDB tables for incomplete table scopes', () => {
    const connection = connectionProfile('dynamodb', 'widecolumn')

    expect(createDynamoExplorerNodes(connection, 'table:')).toEqual([])

    const payload = dynamoInspectPayload(connection, 'items:') as {
      tableName?: string
      items?: unknown[]
      tables?: unknown[]
    }

    expect(payload.tableName).toBe('')
    expect(payload.items).toEqual([])
    expect(payload.tables).toEqual([])
  })

  it('does not fall back to fixture document collections for incomplete scopes', () => {
    const cosmosTemplate = cosmosInspectQueryTemplate('cosmos:items:')
    expect(cosmosTemplate).toContain('"operation": "inspect"')
    expect(cosmosTemplate).not.toContain('products')

    const liteDbConnection = connectionProfile('litedb', 'document')
    expect(createLiteDbExplorerNodes(liteDbConnection, 'litedb:collection:')).toEqual([])

    const liteDbPayload = liteDbInspectPayload(liteDbConnection, 'litedb:documents:') as {
      collection?: string
      fields?: unknown[]
      indexes?: unknown[]
    }
    expect(liteDbPayload.collection).toBe('')
    expect(liteDbPayload.fields).toEqual([])
    expect(liteDbPayload.indexes).toEqual([])
  })

  it('does not fall back to fixture Cassandra tables for incomplete scopes', () => {
    const connection = connectionProfile('cassandra', 'widecolumn', 'app')

    expect(parseCassandraTableScope('table:', 'app')).toEqual({
      keyspace: 'app',
      table: undefined,
    })
    expect(cassandraTableNameFromNodeId(connection, 'data:app:')).toEqual({
      keyspace: 'app',
      table: undefined,
    })
  })

  it('does not invent SQL Server databases or objects for incomplete scopes', () => {
    const connection = connectionProfile('sqlserver', 'sql', undefined)

    expect(createSqlServerExplorerNodes(connection).map((node) => node.label)).toEqual([
      'master',
      'model',
      'msdb',
      'tempdb',
    ])
    expect(createSqlServerExplorerNodes(connection, 'database:')).toEqual([])
    expect(createSqlServerExplorerNodes(connection, 'sqlserver::tables')).toEqual([])
    expect(parseSqlServerObjectScope('table:')).toEqual({
      database: '',
      schema: '',
      objectName: '',
    })
    expect(parseSqlServerNodeId(connection, 'table:')).toEqual({
      database: '',
      schema: 'dbo',
      objectName: '',
    })
  })

  it('does not invent MySQL or CockroachDB databases and table objects for blank profiles', () => {
    const mysqlConnection = connectionProfile('mysql', 'sql', undefined)
    const cockroachConnection = connectionProfile('cockroachdb', 'sql', undefined)

    expect(createMysqlExplorerNodes(mysqlConnection).map((node) => node.label)).not.toContain('datapadplusplus')
    expect(createMysqlExplorerNodes(mysqlConnection, 'database:')).toEqual([])
    expect(createMysqlExplorerNodes(mysqlConnection, 'mysql::tables')).toEqual([])
    expect(createMysqlExplorerNodes(mysqlConnection, 'table:')).toEqual([])
    expect(parseMysqlObjectScope('table:', '')).toEqual({
      database: '',
      objectName: '',
    })

    expect(createCockroachExplorerNodes(cockroachConnection).map((node) => node.label)).toEqual([
      'Cluster',
      'Security',
      'Diagnostics',
    ])
    expect(createCockroachExplorerNodes(cockroachConnection, 'database:')).toEqual([])
    expect(createCockroachExplorerNodes(cockroachConnection, 'schema:public')).toEqual([])
    expect(parsePostgresObjectScope('table:')).toEqual({
      schema: 'public',
      objectName: '',
    })
  })

  it('does not invent Oracle, InfluxDB, or graph database roots for blank profiles', () => {
    const oracleConnection = connectionProfile('oracle', 'sql', undefined)
    const influxConnection = connectionProfile('influxdb', 'timeseries', undefined)
    const graphConnection = connectionProfile('neo4j', 'graph', undefined)

    expect(createOracleExplorerNodes(oracleConnection).map((node) => node.label)).toEqual([
      'Schemas',
      'Security',
      'Storage',
      'Performance',
      'Diagnostics',
    ])
    expect(createOracleExplorerNodes(oracleConnection, 'oracle:containers')).toEqual([])
    expect(createOracleExplorerNodes(oracleConnection, 'oracle:schemas')).toEqual([])

    expect(createInfluxExplorerNodes(influxConnection, 'influx:buckets')).toEqual([])

    expect(createGraphExplorerNodes(graphConnection, 'graph:graphs')).toEqual([])
    expect(createGraphExplorerNodes(graphConnection, 'graph:neo4j')).toEqual([])
  })

  it('keeps browser object-view payloads free of demo sample paths and preview-sample copy', () => {
    const bigQueryPayload = warehouseInspectPayload(
      connectionProfile('bigquery', 'warehouse', 'analytics'),
      'warehouse:stages',
    )
    const snowflakePayload = warehouseInspectPayload(
      connectionProfile('snowflake', 'warehouse', 'analytics'),
      'warehouse:stages',
    )
    const diagnosticsText = JSON.stringify(cosmosDiagnostics('catalog', 'products'))

    expect(JSON.stringify(bigQueryPayload)).not.toContain('datapad-samples')
    expect(JSON.stringify(snowflakePayload)).not.toContain('datapad-samples')
    expect(diagnosticsText).not.toContain('preview sample')
    expect(diagnosticsText).not.toContain('sample queries')
  })
})

function connectionProfile(
  engine: ConnectionProfile['engine'],
  family: ConnectionProfile['family'],
  database = '',
): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine,
    engine,
    family,
    host: 'localhost',
    port: undefined,
    database,
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
