import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { quoteSqlIdentifier } from '../common/sql/browser-sql-operation-format'

export function sqlServerOperationRequest(
  connection: ConnectionProfile,
  operationId: string,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const indexName = quoteSqlIdentifier(connection, String(parameters.indexName ?? 'IX_name'))
  const targetObject = sqlServerTargetObject(connection, objectName, parameters)

  if (operationId.endsWith('data.import-export') || operationId.includes('import-export')) {
    return sqlServerImportExportRequest(objectName, parameters)
  }

  if (operationId.endsWith('data.backup-restore') || operationId.includes('backup-restore')) {
    return sqlServerBackupRestoreRequest(objectName, parameters)
  }

  if (operationId.endsWith('statistics.update')) {
    return `update statistics ${targetObject} with fullscan;`
  }

  if (operationId.endsWith('index.reorganize')) {
    return `alter index ${indexName} on ${targetObject} reorganize;`
  }

  if (operationId.endsWith('index.rebuild')) {
    return `alter index ${indexName} on ${targetObject} rebuild with (online = on);`
  }

  if (operationId.endsWith('index.disable')) {
    return `-- Review carefully before disabling an index.\nalter index ${indexName} on ${targetObject} disable;`
  }

  if (operationId.endsWith('index.enable')) {
    return `alter index ${indexName} on ${targetObject} rebuild with (online = on);`
  }

  if (operationId.endsWith('query-store.top-queries')) {
    return [
      'select top (50)',
      '  qsq.query_id,',
      '  qsp.plan_id,',
      '  rs.avg_duration,',
      '  rs.count_executions',
      'from sys.query_store_query qsq',
      'join sys.query_store_plan qsp on qsq.query_id = qsp.query_id',
      'join sys.query_store_runtime_stats rs on qsp.plan_id = rs.plan_id',
      'order by rs.avg_duration desc;',
    ].join('\n')
  }

  if (operationId.endsWith('metrics') || operationId.endsWith('diagnostics')) {
    return [
      'select top (50) * from sys.dm_exec_query_stats order by total_elapsed_time desc;',
      'select * from sys.dm_exec_requests;',
      'select * from sys.dm_os_wait_stats;',
      'select * from sys.dm_io_virtual_file_stats(db_id(), null);',
      'select * from sys.dm_exec_query_memory_grants;',
    ].join('\n')
  }

  return undefined
}

function sqlServerTargetObject(
  connection: ConnectionProfile,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const schema = stringParameter(parameters, 'schema') ?? ''
  const table = stringParameter(parameters, 'table') ?? ''
  if (table) {
    return schema
      ? `${quoteSqlIdentifier(connection, schema)}.${quoteSqlIdentifier(connection, table)}`
      : quoteSqlIdentifier(connection, table)
  }
  return objectName
}

function sqlServerImportExportRequest(objectName: string, parameters: Record<string, unknown>) {
  const { schema, table } = sqlServerWorkflowTableParts(objectName, parameters)
  const mode = (stringParameter(parameters, 'mode') ?? 'export').toLowerCase()
  const format = stringParameter(parameters, 'format') ?? 'csv'
  const rowLimit = numericParameter(parameters, 'rowLimit') ?? numericParameter(parameters, 'limit') ?? 10000
  const importLike = ['import', 'append', 'insert', 'validate', 'validate-only'].includes(mode)

  if (importLike) {
    return JSON.stringify({
      workflow: 'sqlserver.table.import',
      schema,
      table,
      format,
      source: {
        path: stringParameter(parameters, 'sourcePath') ?? stringParameter(parameters, 'inputPath') ?? `<selected-file>.${format}`,
      },
      mode,
      rowLimit,
      emptyStringAsNull: Boolean(parameters.emptyStringAsNull),
      executionGate: {
        defaultSupport: 'live',
        guards: [
          'desktop adapter execution only',
          'absolute source path',
          'existing target table',
          'insertable target-column validation',
          'bounded row import',
          'read-only connection blocked',
          'explicit confirmation required before append',
        ],
        residualRisk: 'bulk load and identity-insert workflows remain manual preview paths',
      },
    }, null, 2)
  }

  return JSON.stringify({
    workflow: 'sqlserver.table.export',
    schema,
    table,
    format,
    target: {
      path: stringParameter(parameters, 'targetPath') ?? stringParameter(parameters, 'outputPath') ?? `<selected-file>.${format}`,
      overwrite: Boolean(parameters.overwrite),
    },
    rowLimit,
    serialization: 'FOR JSON PATH, INCLUDE_NULL_VALUES, then local CSV/JSON/NDJSON writer',
    executionGate: {
      defaultSupport: 'live',
      guards: [
        'desktop adapter execution only',
        'absolute target path',
        'parent folder exists',
        'overwrite opt-in',
        'bounded row export',
      ],
      residualRisk: 'server-side bcp/sqlcmd bulk workflows remain manual preview paths',
    },
  }, null, 2)
}

function sqlServerBackupRestoreRequest(objectName: string, parameters: Record<string, unknown>) {
  const mode = (stringParameter(parameters, 'mode') ?? 'backup').toLowerCase()
  const database = stringParameter(parameters, 'database') ?? sqlServerWorkflowDatabaseName(objectName) ?? 'database'

  if (['restore', 'recover', 'import'].includes(mode)) {
    return JSON.stringify({
      workflow: 'sqlserver.database.restore',
      database,
      source: {
        path: stringParameter(parameters, 'sourcePath') ?? stringParameter(parameters, 'inputPath') ?? '<selected-file>.json',
      },
      mode,
      executionGate: {
        defaultSupport: 'plan-only',
        guards: [
          'restore execution remains preview-first',
          'validate package before manual restore',
          'review schema DDL, identity columns, triggers, constraints, and target database state',
        ],
        residualRisk: 'native .bak restore and generated insert replay remain manual reviewed workflows',
      },
    }, null, 2)
  }

  return JSON.stringify({
    workflow: 'sqlserver.database.backup',
    database,
    target: {
      path: stringParameter(parameters, 'targetPath') ?? stringParameter(parameters, 'outputPath') ?? '<selected-file>.json',
      overwrite: Boolean(parameters.overwrite),
    },
    schema: stringParameter(parameters, 'schema'),
    format: stringParameter(parameters, 'format') ?? 'json',
    includeData: parameters.includeData !== false,
    rowLimit: numericParameter(parameters, 'rowLimit') ?? 1000,
    tableLimit: numericParameter(parameters, 'tableLimit') ?? 25,
    executionGate: {
      defaultSupport: 'live',
      guards: [
        'desktop adapter execution only',
        'absolute target path',
        'parent folder exists',
        'overwrite opt-in',
        'bounded table list',
        'bounded rows per table',
      ],
      residualRisk: 'bounded logical DataPad++ backup package; native .bak backup/restore execution remains preview-first',
    },
  }, null, 2)
}

function sqlServerWorkflowTableParts(objectName: string, parameters: Record<string, unknown>) {
  const explicitSchema = stringParameter(parameters, 'schema')
  const explicitTable = stringParameter(parameters, 'table') ?? stringParameter(parameters, 'tableName')
  if (explicitTable) {
    return { schema: explicitSchema ?? 'dbo', table: explicitTable }
  }

  const parts = splitSqlServerName(objectName).map(cleanSqlServerIdentifier).filter(Boolean)
  if (parts.length >= 2) {
    return { schema: explicitSchema ?? parts[0] ?? 'dbo', table: parts[1] ?? '<table>' }
  }
  return { schema: explicitSchema ?? 'dbo', table: parts[0] ?? '<table>' }
}

function sqlServerWorkflowDatabaseName(objectName: string) {
  const parts = splitSqlServerName(objectName).map(cleanSqlServerIdentifier).filter(Boolean)
  return parts.length === 1 ? parts[0] : undefined
}

function splitSqlServerName(value: string) {
  const parts: string[] = []
  let current = ''
  let bracketDepth = 0
  let quote: string | undefined

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? ''
    if (character === '[' && !quote) {
      bracketDepth += 1
      current += character
    } else if (character === ']' && !quote && bracketDepth > 0) {
      bracketDepth -= 1
      current += character
    } else if ((character === '"' || character === '`') && bracketDepth === 0) {
      if (quote === character) {
        quote = undefined
      } else if (!quote) {
        quote = character
      }
      current += character
    } else if (character === '.' && bracketDepth === 0 && !quote) {
      parts.push(current)
      current = ''
    } else {
      current += character
    }
  }
  if (current) parts.push(current)
  return parts
}

function cleanSqlServerIdentifier(value: string) {
  const trimmed = value.trim()
  const unwrapped =
    (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
      ? trimmed.slice(1, -1)
      : trimmed
  return unwrapped.replace(/]]/g, ']').replace(/""/g, '"').replace(/``/g, '`')
}

function stringParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numericParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return undefined
}
