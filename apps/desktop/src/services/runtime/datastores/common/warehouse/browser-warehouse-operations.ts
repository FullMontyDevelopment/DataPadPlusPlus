import type { ConnectionProfile, OperationPlanRequest } from '@datapadplusplus/shared-types'
import { defaultQueryTextForConnection } from '../../../../../app/state/helpers'

type JsonRecord = Record<string, unknown>

export function warehouseOperationRequest(connection: ConnectionProfile, request: OperationPlanRequest) {
  const parameters = asRecord(request.parameters)
  const objectName = stringValue(request.objectName ?? parameters.objectName ?? parameters.tableName) || '<table>'
  const schema = stringValue(parameters.schema ?? parameters.database ?? connection.database) || '<schema>'
  const query = stringValue(parameters.query) || warehouseSelect(connection, schema, objectName)

  if (request.operationId.endsWith('query.explain')) {
    return warehouseExplainRequest(connection, query)
  }

  if (request.operationId.endsWith('query.profile')) {
    return warehouseProfileRequest(connection, query)
  }

  if (request.operationId.endsWith('diagnostics.metrics')) {
    return warehouseMetricsRequest(connection, parameters)
  }

  if (request.operationId.endsWith('security.inspect')) {
    return warehouseSecurityRequest(connection, schema)
  }

  if (request.operationId.endsWith('data.import-export')) {
    return warehouseImportExportRequest(connection, objectName, parameters)
  }

  if (request.operationId.endsWith('table.clone')) {
    return warehouseTableCloneRequest(connection, objectName, parameters)
  }

  if (request.operationId.endsWith('table.copy')) {
    return warehouseTableCopyRequest(connection, objectName, parameters)
  }

  if (request.operationId.endsWith('table.optimize')) {
    return warehouseTableOptimizeRequest(connection, objectName)
  }

  if (request.operationId.endsWith('table.materialize-ttl')) {
    return warehouseTableMaterializeTtlRequest(connection, objectName)
  }

  if (request.operationId.endsWith('table.freeze')) {
    return warehouseTableFreezeRequest(connection, objectName, parameters)
  }

  if (request.operationId.endsWith('warehouse.suspend')) {
    return `ALTER WAREHOUSE ${quoteSnowflakeIdentifier(objectName)} SUSPEND;`
  }

  if (request.operationId.endsWith('warehouse.resume')) {
    return `ALTER WAREHOUSE ${quoteSnowflakeIdentifier(objectName)} RESUME;`
  }

  if (request.operationId.endsWith('object.drop')) {
    return warehouseDropObjectRequest(connection, objectName, parameters)
  }

  return defaultQueryTextForConnection(connection)
}

function warehouseExplainRequest(connection: ConnectionProfile, query: string) {
  if (connection.engine === 'bigquery') {
    return jsonRequest({
      operation: 'BigQuery.Jobs.QueryDryRun',
      dryRun: true,
      useQueryCache: false,
      query,
    })
  }

  if (connection.engine === 'clickhouse') {
    return `EXPLAIN PIPELINE\n${stripTrailingSemicolon(query)};`
  }

  return `EXPLAIN USING TEXT\n${stripTrailingSemicolon(query)};`
}

function warehouseProfileRequest(connection: ConnectionProfile, query: string) {
  if (connection.engine === 'bigquery') {
    return jsonRequest({
      operation: 'BigQuery.Jobs.QueryDryRun',
      dryRun: true,
      maximumBytesBilled: '<optional-limit>',
      query,
      estimate: ['bytesProcessed', 'slotMs', 'referencedTables'],
    })
  }

  if (connection.engine === 'snowflake') {
    return [
      '-- Run the query, then inspect profile/history for the returned query id.',
      stripTrailingSemicolon(query) + ';',
      "select * from table(information_schema.query_history()) order by start_time desc limit 20;",
    ].join('\n')
  }

  if (connection.engine === 'clickhouse') {
    return [
      stripTrailingSemicolon(query) + ' settings log_queries = 1;',
      'select query_id, read_rows, read_bytes, memory_usage, query_duration_ms',
      'from system.query_log',
      "where type = 'QueryFinish'",
      'order by event_time desc limit 20;',
    ].join('\n')
  }

  return `EXPLAIN ANALYZE ${stripTrailingSemicolon(query)};`
}

function warehouseMetricsRequest(connection: ConnectionProfile, parameters: JsonRecord) {
  if (connection.engine === 'bigquery') {
    return [
      'select creation_time, job_id, state, total_bytes_processed, total_slot_ms',
      'from `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT',
      'order by creation_time desc limit 100;',
    ].join('\n')
  }

  if (connection.engine === 'clickhouse') {
    return [
      'select event_time, query_id, read_rows, read_bytes, memory_usage, query_duration_ms',
      'from system.query_log',
      'order by event_time desc limit 100;',
      'select * from system.metrics;',
    ].join('\n')
  }

  return [
    'select * from table(information_schema.warehouse_load_history()) order by start_time desc limit 100;',
    'select * from table(information_schema.query_history()) order by start_time desc limit 100;',
    `-- Scope: ${parameters.objectKind ?? 'diagnostics'}`,
  ].join('\n')
}

function warehouseSecurityRequest(connection: ConnectionProfile, schema: string) {
  if (connection.engine === 'bigquery') {
    return jsonRequest({
      operation: 'BigQuery.TestIamPermissions',
      resource: `projects/<project>/datasets/${schema}`,
      permissions: [
        'bigquery.tables.get',
        'bigquery.tables.getData',
        'bigquery.tables.update',
        'bigquery.jobs.create',
      ],
    })
  }

  if (connection.engine === 'clickhouse') {
    return 'show grants;\nselect * from system.users;\nselect * from system.roles;'
  }

  return 'show grants to role <active_role>;\nshow grants on schema <database>.<schema>;'
}

function warehouseImportExportRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: JsonRecord,
) {
  const mode = stringValue(parameters.mode) || 'export'
  const format = stringValue(parameters.format) || defaultExportFormat(connection.engine)

  if (connection.engine === 'bigquery') {
    return jsonRequest({
      operation: mode === 'import' ? 'BigQuery.LoadJob' : 'BigQuery.ExtractJob',
      table: objectName,
      destination: parameters.destination ?? 'gs://<selected-bucket>/<path>',
      source: parameters.source ?? 'gs://<selected-bucket>/<path>',
      format,
      validation: mode === 'import' ? 'schema-and-sample-validation' : 'bounded-export',
    })
  }

  if (connection.engine === 'clickhouse') {
    return mode === 'import'
      ? `INSERT INTO ${quoteClickHouseIdentifier(objectName)} FORMAT ${format.toUpperCase()}`
      : `SELECT * FROM ${quoteClickHouseIdentifier(objectName)} INTO OUTFILE '<selected-file>' FORMAT ${format.toUpperCase()};`
  }

  return mode === 'import'
    ? `COPY INTO ${quoteSnowflakeIdentifier(objectName)}\nFROM @${parameters.stageName ?? '<stage>'}\nFILE_FORMAT = (TYPE = ${format.toUpperCase()});`
    : `COPY INTO @${parameters.stageName ?? '<stage>'}/${objectName}.${format}\nFROM ${quoteSnowflakeIdentifier(objectName)}\nFILE_FORMAT = (TYPE = ${format.toUpperCase()} HEADER = TRUE);`
}

function warehouseDropObjectRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: JsonRecord,
) {
  const objectKind = normalizeKind(stringValue(parameters.objectKind))

  if (connection.engine === 'bigquery') {
    return jsonRequest({
      operation: objectKind.includes('view') ? 'BigQuery.Tables.DeleteView' : 'BigQuery.Tables.Delete',
      table: objectName,
      preflight: ['getTable', 'listJobs', 'checkIamPermissions'],
    })
  }

  const ddlKind =
    objectKind.includes('warehouse')
      ? 'warehouse'
      : objectKind.includes('stage')
        ? 'stage'
        : objectKind.includes('view')
          ? 'view'
          : 'table'

  return `-- Review dependencies before running.\nDROP ${ddlKind.toUpperCase()} IF EXISTS ${warehouseIdentifier(connection, objectName)};`
}

function warehouseTableCloneRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: JsonRecord,
) {
  const cloneName = stringValue(parameters.cloneName) || `${objectName}_clone`
  if (connection.engine === 'snowflake') {
    return `CREATE TABLE ${quoteSnowflakeIdentifier(cloneName)} CLONE ${quoteSnowflakeIdentifier(objectName)};`
  }
  return `CREATE TABLE ${warehouseIdentifier(connection, cloneName)} AS SELECT * FROM ${warehouseIdentifier(connection, objectName)};`
}

function warehouseTableCopyRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: JsonRecord,
) {
  const destinationTable = stringValue(parameters.destinationTable) || `${objectName}_copy`
  if (connection.engine === 'bigquery') {
    return jsonRequest({
      operation: 'BigQuery.Tables.Copy',
      sourceTable: objectName,
      destinationTable,
      writeDisposition: 'WRITE_EMPTY',
      preflight: ['getTable', 'testIamPermissions', 'dryRunReferenceQuery'],
    })
  }
  return `CREATE TABLE ${warehouseIdentifier(connection, destinationTable)} AS SELECT * FROM ${warehouseIdentifier(connection, objectName)};`
}

function warehouseTableOptimizeRequest(connection: ConnectionProfile, objectName: string) {
  if (connection.engine === 'clickhouse') {
    return `OPTIMIZE TABLE ${quoteClickHouseIdentifier(objectName)} FINAL;`
  }
  return `-- Prepare an engine-native table maintenance workflow for ${objectName}.`
}

function warehouseTableMaterializeTtlRequest(connection: ConnectionProfile, objectName: string) {
  if (connection.engine === 'clickhouse') {
    return `ALTER TABLE ${quoteClickHouseIdentifier(objectName)} MATERIALIZE TTL;`
  }
  return `-- Prepare an engine-native TTL/materialization workflow for ${objectName}.`
}

function warehouseTableFreezeRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: JsonRecord,
) {
  const snapshotName = stringValue(parameters.snapshotName) || `${objectName}_snapshot`
  if (connection.engine === 'clickhouse') {
    return `ALTER TABLE ${quoteClickHouseIdentifier(objectName)} FREEZE WITH NAME '${escapeClickHouseString(snapshotName)}';`
  }
  return `-- Prepare an engine-native table snapshot workflow for ${objectName}.`
}

function warehouseSelect(connection: ConnectionProfile, schema: string, objectName: string) {
  if (connection.engine === 'bigquery') {
    return `select * from \`${schema}.${objectName}\` limit 100;`
  }

  return `select * from ${warehouseIdentifier(connection, `${schema}.${objectName}`)} limit 100;`
}

function warehouseIdentifier(connection: ConnectionProfile, value: string) {
  if (connection.engine === 'clickhouse') {
    return value.split('.').map(quoteClickHouseIdentifier).join('.')
  }

  if (connection.engine === 'snowflake') {
    return value.split('.').map(quoteSnowflakeIdentifier).join('.')
  }

  return value
}

function quoteSnowflakeIdentifier(value: string) {
  const cleaned = stripIdentifierWrapper(value)
  return `"${cleaned.replace(/"/g, '""')}"`
}

function quoteClickHouseIdentifier(value: string) {
  const cleaned = stripIdentifierWrapper(value)
  return `\`${cleaned.replace(/`/g, '``')}\``
}

function escapeClickHouseString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function stripIdentifierWrapper(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if ((first === '"' && last === '"') || (first === '`' && last === '`')) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function defaultExportFormat(engine: string) {
  if (engine === 'bigquery') return 'avro'
  if (engine === 'clickhouse') return 'parquet'
  return 'csv'
}

function stripTrailingSemicolon(value: string) {
  return value.trim().replace(/;+$/, '')
}

function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

function jsonRequest(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
