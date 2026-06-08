import type { ConnectionProfile, OperationPlanRequest } from '@datapadplusplus/shared-types'
import { sqlOperationRequest } from './browser-sql-operations'

type JsonRecord = Record<string, unknown>

export function timescaleOperationRequest(
  connection: ConnectionProfile,
  request: OperationPlanRequest,
) {
  const parameters = asRecord(request.parameters)
  const objectName = String(request.objectName ?? parameters.objectName ?? '<schema>.<hypertable>')
  const relation = timescaleRelationLiteral(parameters, objectName)

  if (request.operationId.endsWith('timescale.compression-policy')) {
    const parts = timescaleRelationParts(parameters, objectName)
    return [
      ...timescaleExecutionBoundaryPrelude('compression policy'),
      ...timescaleHypertablePreflight(parts),
      `select add_compression_policy('${relation}', interval '${escapeSqlLiteral(stringValue(parameters.compressAfter) || '7 days')}', if_not_exists => true);`,
    ].join('\n')
  }

  if (request.operationId.endsWith('timescale.retention-policy')) {
    const parts = timescaleRelationParts(parameters, objectName)
    return [
      ...timescaleExecutionBoundaryPrelude('retention policy'),
      ...timescaleHypertablePreflight(parts),
      `select add_retention_policy('${relation}', interval '${escapeSqlLiteral(stringValue(parameters.dropAfter) || '90 days')}', if_not_exists => true);`,
    ].join('\n')
  }

  if (request.operationId.endsWith('timescale.refresh-continuous-aggregate')) {
    const startOffset = escapeSqlLiteral(stringValue(parameters.startOffset) || '7 days')
    const endOffset = escapeSqlLiteral(stringValue(parameters.endOffset) || '0 minutes')
    const parts = timescaleRelationParts(parameters, objectName)
    return [
      ...timescaleExecutionBoundaryPrelude('continuous aggregate refresh'),
      ...timescaleContinuousAggregatePreflight(parts),
      `call refresh_continuous_aggregate('${relation}', now() - interval '${startOffset}', now() - interval '${endOffset}');`,
    ].join('\n')
  }

  if (request.operationId.endsWith('timescale.job-control')) {
    return timescaleJobControlRequest(parameters)
  }

  if (request.operationId.endsWith('data.import-export')) {
    return timescaleImportExportRequest(parameters, objectName)
  }

  if (request.operationId.endsWith('data.backup-restore')) {
    return timescaleBackupRestoreRequest(connection, parameters, objectName)
  }

  return sqlOperationRequest(connection, request)
}

function timescaleRelationLiteral(parameters: JsonRecord, objectName: string) {
  const schema = stringValue(parameters.schema)
  const table = stringValue(parameters.table)
  if (schema && table) {
    return `${escapeSqlLiteral(stripIdentifier(schema))}.${escapeSqlLiteral(stripIdentifier(table))}`
  }

  return escapeSqlLiteral(
    objectName
      .replace(/"/g, '')
      .replace(/\[/g, '')
      .replace(/]/g, '')
      .replace(/`/g, '')
      .trim(),
  )
}

function timescaleImportExportRequest(parameters: JsonRecord, objectName: string) {
  const mode = (stringValue(parameters.mode) || 'export').toLowerCase()
  const format = (stringValue(parameters.format) || 'csv').toLowerCase()
  const relation = timescaleRelationIdentifier(parameters, objectName)
  const parts = timescaleRelationParts(parameters, objectName)
  const filePath = sqlStringLiteral(stringValue(parameters.filePath) || `<selected-file>.${formatExtension(format)}`)
  const preflight = timescaleHypertablePreflight(parts)

  if (['import', 'append', 'insert'].includes(mode)) {
    if (['json', 'jsonl', 'ndjson'].includes(format)) {
      return [
        ...timescaleExecutionBoundaryPrelude('import file workflow'),
        '-- TimescaleDB JSON/NDJSON import remains preview-first until column mapping and chunk policy checks pass.',
        ...preflight,
        'create temporary table datapad_timescale_import_payload (payload jsonb);',
        `copy datapad_timescale_import_payload from ${filePath} with (format text);`,
        `-- Map validated payload fields into ${relation} inside an explicit transaction after identity, trigger, and compression checks.`,
        'select * from timescaledb_information.jobs order by job_id;',
      ].join('\n')
    }

    return [
      ...timescaleExecutionBoundaryPrelude('import file workflow'),
      '-- TimescaleDB import is preview-first until file, column, compression, retention, and continuous aggregate checks pass.',
      ...preflight,
      `copy ${relation} from ${filePath} with (${timescaleCopyOptions(format)});`,
      '-- After import: review retention/compression jobs and refresh affected continuous aggregates over the imported time window.',
      'select * from timescaledb_information.jobs order by job_id;',
    ].join('\n')
  }

  const timeColumn = quoteSqlIdentifier(stripIdentifier(stringValue(parameters.timeColumn) || 'time'))
  const boundedSelect = `select * from ${relation}${timescaleWhereClause(parameters, timeColumn)}`

  if (['json', 'jsonl', 'ndjson'].includes(format)) {
    return [
      ...timescaleExecutionBoundaryPrelude('export file workflow'),
      '-- TimescaleDB export should be bounded by time and reviewed for compressed chunk fan-out.',
      ...preflight,
      `copy (select row_to_json(row_data) from (${boundedSelect}) row_data) to ${filePath};`,
    ].join('\n')
  }

  return [
    ...timescaleExecutionBoundaryPrelude('export file workflow'),
    '-- TimescaleDB export should be bounded by time and reviewed for compressed chunk fan-out.',
    ...preflight,
    `copy (${boundedSelect}) to ${filePath} with (${timescaleCopyOptions(format)});`,
  ].join('\n')
}

function timescaleBackupRestoreRequest(
  connection: ConnectionProfile,
  parameters: JsonRecord,
  objectName: string,
) {
  const mode = (stringValue(parameters.mode) || 'backup').toLowerCase()
  const database = stringValue(parameters.database) || connection.database || '<database>'
  const filePath = stringValue(parameters.filePath) || '<selected-file>.dump'
  const relation = timescaleRelationIdentifier(parameters, objectName)
  const scopedTable = relation.includes('<') ? '' : ` --table=${relation.replace(/"/g, '')}`

  if (mode === 'restore') {
    return [
      ...timescaleExecutionBoundaryPrelude('restore file workflow'),
      '-- TimescaleDB restore is destructive and remains preview-first until extension/version and policy checks pass.',
      "select e.extversion, n.nspname as extension_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'timescaledb';",
      `pg_restore --clean --if-exists --dbname=${shellToken(database)} ${shellToken(filePath)}`,
      'select * from timescaledb_information.hypertables order by hypertable_schema, hypertable_name;',
      'select * from timescaledb_information.continuous_aggregates order by view_schema, view_name;',
      'select * from timescaledb_information.jobs order by job_id;',
      '-- Review compression policies, retention policies, continuous aggregate refresh windows, and job schedules before allowing writes.',
    ].join('\n')
  }

  return [
    ...timescaleExecutionBoundaryPrelude('backup file workflow'),
    '-- TimescaleDB backup should capture extension metadata, hypertables, chunks, policies, jobs, and continuous aggregates.',
    "select e.extversion, n.nspname as extension_schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'timescaledb';",
    'select * from timescaledb_information.hypertables order by hypertable_schema, hypertable_name;',
    'select * from timescaledb_information.chunks order by hypertable_schema, hypertable_name, range_start desc limit 50;',
    'select * from timescaledb_information.continuous_aggregates order by view_schema, view_name;',
    'select * from timescaledb_information.jobs order by job_id;',
    `pg_dump --format=custom --file=${shellToken(filePath)}${scopedTable} ${shellToken(database)}`,
  ].join('\n')
}

function timescaleJobControlRequest(parameters: JsonRecord) {
  const action = (stringValue(parameters.action) || 'run').toLowerCase()
  const jobId = timescaleJobId(parameters)
  const command =
    action === 'pause'
      ? `select alter_job(${jobId}, scheduled => false);`
      : action === 'resume'
        ? `select alter_job(${jobId}, scheduled => true);`
        : `call run_job(${jobId});`

  return [
    ...timescaleExecutionBoundaryPrelude('job-control workflow'),
    '-- TimescaleDB job control is preview-first until job ownership, schedule impact, and policy windows are verified.',
    `select * from timescaledb_information.jobs where job_id = ${jobId};`,
    `select * from timescaledb_information.job_stats where job_id = ${jobId};`,
    command,
    `select * from timescaledb_information.job_stats where job_id = ${jobId};`,
  ].join('\n')
}

function timescaleRelationIdentifier(parameters: JsonRecord, objectName: string) {
  const parts = timescaleRelationParts(parameters, objectName)
  return `${quoteSqlIdentifier(parts.schema)}.${quoteSqlIdentifier(parts.table)}`
}

function timescaleRelationParts(parameters: JsonRecord, objectName: string): { schema: string, table: string } {
  const schema = stringValue(parameters.schema)
  const table = stringValue(parameters.table)
  if (schema && table) {
    return {
      schema: stripIdentifier(schema),
      table: stripIdentifier(table),
    }
  }

  const parts = objectName
    .replace(/\[/g, '')
    .replace(/]/g, '')
    .replace(/`/g, '')
    .split('.')
    .map(stripIdentifier)
    .filter(Boolean)

  if (parts.length >= 2) {
    return {
      schema: parts[parts.length - 2] ?? 'public',
      table: parts[parts.length - 1] ?? '<hypertable>',
    }
  }

  return {
    schema: 'public',
    table: parts[0] || '<hypertable>',
  }
}

function timescaleHypertablePreflight(parts: { schema: string, table: string }) {
  const schema = sqlStringLiteral(parts.schema)
  const table = sqlStringLiteral(parts.table)
  return [
    `select hypertable_schema, hypertable_name, num_dimensions, compression_enabled from timescaledb_information.hypertables where hypertable_schema = ${schema} and hypertable_name = ${table};`,
    `select chunk_schema, chunk_name, range_start, range_end, is_compressed from timescaledb_information.chunks where hypertable_schema = ${schema} and hypertable_name = ${table} order by range_start desc limit 50;`,
    `select * from timescaledb_information.compression_settings where hypertable_schema = ${schema} and hypertable_name = ${table};`,
  ]
}

function timescaleContinuousAggregatePreflight(parts: { schema: string, table: string }) {
  const schema = sqlStringLiteral(parts.schema)
  const table = sqlStringLiteral(parts.table)
  return [
    `select view_schema, view_name, materialized_hypertable_schema, materialized_hypertable_name, refresh_lag from timescaledb_information.continuous_aggregates where view_schema = ${schema} and view_name = ${table};`,
    "select job_id, proc_schema, proc_name, scheduled, config from timescaledb_information.jobs where proc_name = 'policy_refresh_continuous_aggregate' order by job_id;",
  ]
}

function timescaleExecutionBoundaryPrelude(scope: string) {
  return [
    `-- DataPad++ TimescaleDB execution boundary: ${scope} stays plan-only in this scoped native claim.`,
    '-- Live promotion requires an adapter-owned executor with privilege checks, chunk/window impact review, fixture evidence, explicit confirmation, and concrete file-path guards where applicable.',
  ]
}

function timescaleWhereClause(parameters: JsonRecord, timeColumn: string) {
  const predicates = [
    stringValue(parameters.start) ? `${timeColumn} >= timestamp with time zone ${sqlStringLiteral(stringValue(parameters.start))}` : undefined,
    stringValue(parameters.end) ? `${timeColumn} < timestamp with time zone ${sqlStringLiteral(stringValue(parameters.end))}` : undefined,
    stringValue(parameters.where) ? `(${stringValue(parameters.where).replace(/;+$/, '')})` : undefined,
  ].filter(Boolean)

  return predicates.length ? `\nwhere ${predicates.join('\n  and ')}` : ''
}

function timescaleCopyOptions(format: string) {
  if (format === 'tsv') return "format csv, delimiter E'\\t', header true"
  if (format === 'binary') return 'format binary'
  return 'format csv, header true'
}

function formatExtension(format: string) {
  if (format === 'jsonl') return 'ndjson'
  if (['csv', 'tsv', 'json', 'ndjson', 'binary'].includes(format)) return format
  return 'csv'
}

function timescaleJobId(parameters: JsonRecord) {
  const value = parameters.jobId ?? parameters.job_id ?? parameters.id
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(Math.trunc(value))
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return value.trim()
  }
  return '<job_id>'
}

function sqlStringLiteral(value: string) {
  return `'${escapeSqlLiteral(value)}'`
}

function quoteSqlIdentifier(value: string) {
  if (value.startsWith('<') && value.endsWith('>')) return value
  return `"${value.replace(/"/g, '""')}"`
}

function shellToken(value: string) {
  if (value.startsWith('<') && value.endsWith('>')) return value
  return value.includes(' ') ? `"${value.replace(/"/g, '\\"')}"` : value
}

function escapeSqlLiteral(value: string) {
  return value.replace(/'/g, "''")
}

function stripIdentifier(value: string) {
  let result = value.trim()
  if (['"', '`', '['].includes(result[0] ?? '')) result = result.slice(1)
  if (['"', '`', ']'].includes(result[result.length - 1] ?? '')) result = result.slice(0, -1)
  return result.trim()
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
