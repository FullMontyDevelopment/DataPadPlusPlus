import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export function quoteSqlIdentifier(connection: ConnectionProfile, value: string) {
  const cleaned = stripSqlIdentifierWrapper(value)

  if (connection.engine === 'sqlserver' || connection.engine === 'sqlite') {
    return `[${cleaned.replace(/]/g, ']]')}]`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `\`${cleaned.replace(/`/g, '``')}\``
  }

  return `"${cleaned.replace(/"/g, '""')}"`
}

export function duckDbImportFileRequest(objectName: string, parameters: Record<string, unknown>) {
  const format = String(parameters.sourceFormat ?? parameters.format ?? 'parquet').toLowerCase()
  const reader = format === 'csv'
    ? "read_csv_auto('<selected-file>.csv')"
    : format === 'json'
      ? "read_json_auto('<selected-file>.json')"
      : "read_parquet('<selected-file>.parquet')"

  return `create or replace table ${objectName} as\nselect * from ${reader};`
}

export function suggestedSqlIndexName(objectName: string, columnName: string) {
  const object = objectName
    .replace(/[`"[\]]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'object'
  const column = columnName
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'id'

  return `idx_${object}_${column}`.slice(0, 80)
}

export function duckDbExtensionName(value: unknown) {
  const cleaned = String(value ?? 'parquet')
    .replace(/[`"[\]]/g, '')
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()

  return cleaned || 'parquet'
}

function stripSqlIdentifierWrapper(value: string) {
  const trimmed = value.trim()
  const first = trimmed[0]
  const last = trimmed[trimmed.length - 1]
  if (
    (first === '[' && last === ']') ||
    (first === '"' && last === '"') ||
    (first === '`' && last === '`')
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}
