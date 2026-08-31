import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export function mysqlImportExportRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const mode = (stringParameter(parameters, 'mode') ?? 'export').toLowerCase()
  const format = stringParameter(parameters, 'format') ?? 'csv'
  const { database, table } = mysqlWorkflowTableParts(objectName, parameters)
  const rowLimit = numericParameter(parameters, 'rowLimit') ?? numericParameter(parameters, 'limit') ?? 10000
  const importLike = ['import', 'append', 'insert', 'validate', 'validate-only'].includes(mode)
  const defaultSupport = 'live'
  const dumpTool = connection.engine === 'mariadb' ? 'mariadb-dump' : 'mysqldump'

  if (importLike) {
    return JSON.stringify({
      workflow: `${connection.engine}.table.import`,
      database,
      schema: database,
      table,
      format,
      source: {
        path: stringParameter(parameters, 'sourcePath') ?? stringParameter(parameters, 'inputPath') ?? `<selected-file>.${format}`,
      },
      mode,
      rowLimit,
      emptyStringAsNull: Boolean(parameters.emptyStringAsNull),
      executionGate: {
        defaultSupport,
        guards: [
          'desktop adapter execution only',
          'absolute source path',
          'existing target table',
          'insertable target-column validation',
          'bounded row import',
          'read-only connection blocked',
          'explicit confirmation required before append',
        ],
        residualRisk: 'LOAD DATA INFILE, generated column mapping, and full dump import workflows remain manual preview paths',
      },
    }, null, 2)
  }

  return JSON.stringify({
    workflow: `${connection.engine}.table.export`,
    database,
    schema: database,
    table,
    format,
    target: {
      path: stringParameter(parameters, 'targetPath') ?? stringParameter(parameters, 'outputPath') ?? `<selected-file>.${format}`,
      overwrite: Boolean(parameters.overwrite),
    },
    rowLimit,
    serialization: 'SELECT rows through the desktop adapter, then local CSV/JSON/NDJSON writer',
    executionGate: {
      defaultSupport,
      guards: [
        'desktop adapter execution only',
        'absolute target path',
        'parent folder exists',
        'overwrite opt-in',
        'bounded row export',
      ],
      residualRisk: `server-side INTO OUTFILE and mysqlpump/${dumpTool} bulk workflows remain manual preview paths`,
    },
  }, null, 2)
}

export function mysqlBackupRestoreRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: Record<string, unknown>,
) {
  const mode = (stringParameter(parameters, 'mode') ?? 'backup').toLowerCase()
  const database = stringParameter(parameters, 'database')
    ?? stringParameter(parameters, 'schema')
    ?? mysqlWorkflowDatabaseName(objectName)
    ?? 'database'
  const dumpTool = connection.engine === 'mariadb' ? 'mariadb-dump' : 'mysqldump'

  return JSON.stringify({
    workflow: `${connection.engine}.database.${mode}-unavailable`,
    database,
    mode,
    executionGate: {
      defaultSupport: 'unsupported',
      reason: `Full ${connection.engine === 'mariadb' ? 'MariaDB' : 'MySQL'} backup and restore require ${dumpTool}, which DataPad++ does not bundle or execute.`,
    },
  }, null, 2)
}

function mysqlWorkflowTableParts(objectName: string, parameters: Record<string, unknown>) {
  const explicitDatabase = stringParameter(parameters, 'database') ?? stringParameter(parameters, 'schema')
  const explicitTable = stringParameter(parameters, 'table') ?? stringParameter(parameters, 'tableName')
  if (explicitTable) {
    return { database: explicitDatabase ?? 'database', table: explicitTable }
  }

  const parts = splitMysqlName(objectName).map(cleanMysqlIdentifier).filter(Boolean)
  if (parts.length >= 2) {
    return { database: explicitDatabase ?? parts[0] ?? 'database', table: parts[1] ?? '<table>' }
  }
  return { database: explicitDatabase ?? 'database', table: parts[0] ?? '<table>' }
}

function mysqlWorkflowDatabaseName(objectName: string) {
  const parts = splitMysqlName(objectName).map(cleanMysqlIdentifier).filter(Boolean)
  return parts.length === 1 ? parts[0] : undefined
}

function splitMysqlName(value: string) {
  const parts: string[] = []
  let current = ''
  let bracketDepth = 0
  let quote: string | undefined

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? ''
    if ((character === '`' || character === '"') && quote === character && value[index + 1] === character) {
      current += character
      index += 1
    } else if (character === '[' && !quote) {
      bracketDepth += 1
      current += character
    } else if (character === ']' && !quote && bracketDepth > 0) {
      bracketDepth -= 1
      current += character
    } else if ((character === '`' || character === '"') && bracketDepth === 0) {
      quote = quote === character ? undefined : quote ? quote : character
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

function cleanMysqlIdentifier(value: string) {
  const trimmed = value.trim()
  const unwrapped =
    (trimmed.startsWith('`') && trimmed.endsWith('`')) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ? trimmed.slice(1, -1)
      : trimmed
  return unwrapped.replace(/``/g, '`').replace(/""/g, '"').replace(/]]/g, ']')
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
