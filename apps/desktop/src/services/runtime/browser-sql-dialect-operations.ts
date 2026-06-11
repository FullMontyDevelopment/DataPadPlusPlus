import type { ConnectionProfile } from '@datapadplusplus/shared-types'
export { duckDbOperationRequest } from './datastores/duckdb/browser-duckdb-admin-operations'
import { mysqlBackupRestoreRequest, mysqlImportExportRequest } from './datastores/common/sql/browser-mysql-file-operations'
import { mysqlManagementOperationRequest } from './datastores/common/sql/browser-mysql-management-operations'
import { postgresRoutineExecuteRequest } from './datastores/common/sql/browser-postgres-routine-operations'
import { postgresSessionOperationRequest } from './datastores/common/sql/browser-postgres-session-operations'

export { cockroachOperationRequest } from './datastores/cockroachdb/browser-cockroach-operations'
export { sqlServerOperationRequest } from './datastores/sqlserver/browser-sqlserver-operations'

export function mysqlOperationRequest(
  connection: ConnectionProfile,
  operationId: string,
  objectName: string,
  parameters: Record<string, unknown> = {},
) {
  if (operationId.endsWith('data.import-export') || operationId.includes('import-export')) {
    return mysqlImportExportRequest(connection, objectName, parameters)
  }

  if (operationId.endsWith('data.backup-restore') || operationId.includes('backup-restore')) {
    return mysqlBackupRestoreRequest(connection, objectName, parameters)
  }

  const managementRequest = mysqlManagementOperationRequest(connection, operationId, objectName, parameters)
  if (managementRequest) {
    return managementRequest
  }

  if (operationId.endsWith('diagnostics.metrics') || operationId.endsWith('metrics')) {
    return mysqlDiagnosticsMetricsRequest(connection)
  }

  return undefined
}

function mysqlDiagnosticsMetricsRequest(connection: ConnectionProfile) {
  if (connection.engine === 'mariadb') {
    return [
      'show global status;',
      "show variables like 'version%';",
      'show engines;',
      'select id, user, db, command, state, time from information_schema.processlist order by time desc limit 100;',
      "select user, host, is_role from mysql.user where is_role = 'Y' order by user, host;",
      'select from_user, from_host, to_user, to_host from mysql.roles_mapping order by from_user, to_user;',
      'select digest_text, count_star, sum_timer_wait, avg_timer_wait, max_timer_wait, sum_rows_examined, sum_rows_sent from performance_schema.events_statements_summary_by_digest order by sum_timer_wait desc limit 50;',
      'select object_schema, object_name, index_name, count_star, count_read, count_write, sum_timer_wait from performance_schema.table_io_waits_summary_by_index_usage order by sum_timer_wait desc limit 100;',
      'select object_schema, object_name, object_type, lock_type, lock_duration, lock_status, owner_thread_id from performance_schema.metadata_locks order by lock_status, object_schema, object_name limit 100;',
      'analyze format=json select 1;',
    ].join('\n')
  }

  return [
    'show global status;',
    'select id, user, db, command, state, time from information_schema.processlist order by time desc limit 100;',
    'select digest_text, count_star, sum_timer_wait, avg_timer_wait, max_timer_wait, sum_rows_examined, sum_rows_sent from performance_schema.events_statements_summary_by_digest order by sum_timer_wait desc limit 50;',
    'select object_schema, object_name, index_name, count_star, count_read, count_write, sum_timer_wait from performance_schema.table_io_waits_summary_by_index_usage order by sum_timer_wait desc limit 100;',
    'select object_schema, object_name, object_type, lock_type, lock_duration, lock_status, owner_thread_id from performance_schema.metadata_locks order by lock_status, object_schema, object_name limit 100;',
    'select @@optimizer_trace, @@optimizer_trace_limit, @@optimizer_trace_max_mem_size;',
    'select query, trace, missing_bytes_beyond_max_mem_size, insufficient_privileges from information_schema.optimizer_trace limit 5;',
  ].join('\n')
}

export function postgresOperationRequest(
  operationId: string,
  objectName: string,
  parameters: Record<string, unknown> = {},
) {
  if (operationId.endsWith('routine.execute')) {
    return postgresRoutineExecuteRequest(objectName, parameters)
  }

  if (operationId.endsWith('session.cancel') || operationId.endsWith('session.terminate')) {
    return postgresSessionOperationRequest(operationId, parameters)
  }

  if (operationId.endsWith('table.analyze')) {
    return `analyze verbose ${objectName};`
  }

  if (operationId.endsWith('table.vacuum')) {
    return `vacuum (verbose, analyze) ${objectName};`
  }

  if (operationId.endsWith('database.analyze')) {
    return 'analyze verbose;'
  }

  if (operationId.endsWith('database.vacuum')) {
    return 'vacuum (verbose, analyze);'
  }

  if (operationId.endsWith('index.reindex')) {
    return `-- REINDEX may take stronger locks; review before running.\nreindex index concurrently ${objectName};`
  }

  if (operationId.endsWith('role.grant')) {
    const roleName = quotePostgresIdentifier(stringParameter(parameters, 'memberOf') ?? '<member_role>')
    const member = quotePostgresIdentifier(stringParameter(parameters, 'roleName') ?? '<role>')
    return `-- Review role inheritance and admin option before running.\ngrant ${roleName} to ${member};`
  }

  if (operationId.endsWith('role.revoke')) {
    const roleName = quotePostgresIdentifier(stringParameter(parameters, 'memberOf') ?? '<member_role>')
    const member = quotePostgresIdentifier(stringParameter(parameters, 'roleName') ?? '<role>')
    return `-- Review dependent privileges before revoking membership.\nrevoke ${roleName} from ${member};`
  }

  if (operationId.endsWith('extension.update')) {
    const extension = quotePostgresIdentifier(postgresExtensionName(parameters.extensionName ?? objectName))
    return [
      '-- Review extension release notes, dependency objects, and required privileges before running.',
      `alter extension ${extension} update;`,
    ].join('\n')
  }

  if (operationId.endsWith('extension.drop')) {
    const extension = quotePostgresIdentifier(postgresExtensionName(parameters.extensionName ?? objectName))
    return [
      '-- Dropping extensions can drop dependent functions, types, operators, or views.',
      `drop extension ${extension};`,
    ].join('\n')
  }

  return undefined
}

export function sqliteOperationRequest(
  operationId: string,
  objectName: string,
  parameters: Record<string, unknown> = {},
) {
  const { schema, table } = sqliteObjectParts(objectName, parameters)

  if (operationId.endsWith('database.integrity-check')) {
    return 'pragma quick_check;\npragma integrity_check;'
  }

  if (operationId.endsWith('database.analyze')) {
    return 'analyze;'
  }

  if (operationId.endsWith('database.optimize')) {
    return 'pragma optimize;'
  }

  if (operationId.endsWith('database.vacuum')) {
    const targetPath = stringParameter(parameters, 'targetPath')
      ?? stringParameter(parameters, 'outputPath')
      ?? '<selected-file>.sqlite'
    return `-- Review file locks before running.\nvacuum;\n-- Or compact into a new file:\nvacuum ${quoteSqliteIdentifier(schema)} into '${targetPath.replace(/'/g, "''")}';`
  }

  if (operationId.endsWith('database.backup')) {
    return JSON.stringify({
      workflow: 'sqlite.database.backup',
      schema,
      targetPath: stringParameter(parameters, 'targetPath') ?? stringParameter(parameters, 'outputPath') ?? '<selected-file>.sqlite',
      overwrite: Boolean(parameters.overwrite),
      guardrails: ['absolute target path', 'parent folder exists', 'overwrite opt-in', 'desktop adapter execution only'],
    }, null, 2)
  }

  if (operationId.endsWith('table.analyze')) {
    return `analyze ${objectName};`
  }

  if (operationId.endsWith('table.export')) {
    return JSON.stringify({
      workflow: 'sqlite.table.export',
      schema,
      table,
      format: stringParameter(parameters, 'format') ?? 'csv',
      targetPath: stringParameter(parameters, 'targetPath') ?? stringParameter(parameters, 'outputPath') ?? '<selected-file>.csv',
      limit: numericParameter(parameters, 'limit') ?? 10000,
      overwrite: Boolean(parameters.overwrite),
      guardrails: ['absolute target path', 'parent folder exists', 'bounded row export', 'overwrite opt-in'],
    }, null, 2)
  }

  if (operationId.endsWith('table.import')) {
    return JSON.stringify({
      workflow: 'sqlite.table.import',
      schema,
      table,
      format: stringParameter(parameters, 'format') ?? 'csv',
      sourcePath: stringParameter(parameters, 'sourcePath') ?? stringParameter(parameters, 'inputPath') ?? '<selected-file>.csv',
      mode: stringParameter(parameters, 'mode') ?? 'append',
      guardrails: [
        'absolute source path',
        'existing target table',
        'CSV header or JSON object rows',
        'read-only connection blocked',
        'confirmation required before append',
      ],
    }, null, 2)
  }

  if (operationId.endsWith('index.reindex')) {
    return `reindex ${objectName};`
  }

  return undefined
}

function sqliteObjectParts(
  objectName: string,
  parameters: Record<string, unknown>,
): { schema: string; table: string } {
  const explicitSchema = stringParameter(parameters, 'schema')
  const explicitTable = stringParameter(parameters, 'table')
  if (explicitTable) {
    return { schema: explicitSchema ?? 'main', table: explicitTable }
  }

  const parts = objectName
    .split('.')
    .map((part) => stripSqliteIdentifierQuotes(part.trim()))
    .filter(Boolean)

  if (parts.length >= 2) {
    return { schema: explicitSchema ?? parts[0] ?? 'main', table: parts[1] ?? '<table>' }
  }

  return { schema: explicitSchema ?? 'main', table: parts[0] ?? '<table>' }
}

function stripSqliteIdentifierQuotes(value: string) {
  const withoutPrefix = ['`', '"', '['].some((quote) => value.startsWith(quote))
    ? value.slice(1)
    : value
  return ['`', '"', ']'].some((quote) => withoutPrefix.endsWith(quote))
    ? withoutPrefix.slice(0, -1)
    : withoutPrefix
}

function stringParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function postgresExtensionName(value: unknown) {
  const parts = String(value ?? '')
    .split('.')
    .map((part) => part.trim().replace(/^["`[]|["`\]]$/g, ''))
    .filter(Boolean)
  const candidate = (parts.at(-1) ?? String(value ?? '')).trim()
  const cleaned = candidate.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || '<extension>'
}

function quotePostgresIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}

function numericParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function quoteSqliteIdentifier(value: string) {
  return `"${value.replace(/"/g, '""')}"`
}
