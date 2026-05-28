import type {
  ConnectionProfile,
  QueryTabState,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  getCockroachObjectViewDescriptor,
  type CockroachObjectViewDescriptor,
} from './CockroachObjectViewDescriptors'
import {
  getDuckDbObjectViewDescriptor,
  type DuckDbObjectViewDescriptor,
} from './DuckDbObjectViewDescriptors'
import {
  getMysqlObjectViewDescriptor,
  type MysqlObjectViewDescriptor,
} from './MysqlObjectViewDescriptors'
import {
  getPostgresObjectViewDescriptor,
  type PostgresObjectViewDescriptor,
} from './PostgresObjectViewDescriptors'
import {
  getSqlServerObjectViewDescriptor,
  type SqlServerObjectViewDescriptor,
} from './SqlServerObjectViewDescriptors'
import {
  getSqliteObjectViewDescriptor,
  type SqliteObjectViewDescriptor,
} from './SqliteObjectViewDescriptors'
import {
  sectionCandidates,
  type RelationalSectionIcon,
} from './RelationalObjectViewSections'
export {
  relationalWorkflows,
  type RelationalWorkflow,
} from './RelationalObjectViewWorkflows'

export type JsonRecord = Record<string, unknown>
export type RelationalObjectViewDescriptor =
  | CockroachObjectViewDescriptor
  | DuckDbObjectViewDescriptor
  | MysqlObjectViewDescriptor
  | PostgresObjectViewDescriptor
  | SqlServerObjectViewDescriptor
  | SqliteObjectViewDescriptor
export type RelationalSection = {
  key: string
  title: string
  icon: RelationalSectionIcon
  unit: string
  columns: string[]
  rows: string[][]
  emptyText: string
}

export function relationalSections(
  kind: string,
  payload: JsonRecord,
  descriptor: RelationalObjectViewDescriptor,
): RelationalSection[] {
  const candidates = sectionCandidates(kind)
  const sections = candidates.flatMap((candidate) => {
    const rows = arrayOfRecords(payload[candidate.key])

    if (!rows.length) {
      return []
    }

    return [{
      key: candidate.key,
      title: candidate.title,
      icon: candidate.icon,
      unit: `${rows.length} row(s)`,
      columns: preferredColumns(rows, candidate.columns),
      rows: tableRows(rows, candidate.columns),
      emptyText: candidate.emptyText,
    }]
  })

  if (!sections.length) {
    const genericRows = arrayOfRecords(payload.objects)
    if (genericRows.length) {
      return [{
        key: 'objects',
        title: descriptor.title,
        icon: 'table',
        unit: `${genericRows.length} row(s)`,
        columns: preferredColumns(genericRows, ['name', 'type', 'status', 'detail']),
        rows: tableRows(genericRows, ['name', 'type', 'status', 'detail']),
        emptyText: descriptor.emptyTitle,
      }]
    }
  }

  return sections
}

export function metricCardsForPayload(
  kind: string,
  payload: JsonRecord,
  connection: ConnectionProfile,
) {
  const cards: Array<{ label: string; value: string }> = []
  const entries: Array<[string, string[]]> = [
    ['Database', ['database', 'databaseName']],
    ['Schema', ['schema', 'schemaName']],
    ['Object', ['objectName', 'tableName', 'viewName', 'routineName']],
    ['Rows', ['rowCount', 'rows', 'estimatedRows']],
    ['Size', ['size', 'totalSize', 'databaseSize']],
    ['Tables', ['tableCount']],
    ['Indexes', ['indexCount']],
    ['Sessions', ['activeSessions', 'sessionCount']],
    ['Blocked', ['blockedSessions']],
    ['Nodes', ['nodeCount']],
    ['Ranges', ['rangeCount']],
    ['Regions', ['regionCount']],
    ['Jobs', ['jobCount']],
    ['Retries', ['retryCount']],
    ['Pages', ['pageCount']],
    ['Freelist', ['freelistCount']],
    ['Check', ['quickCheckStatus']],
    ['Engine', ['engine']],
  ]

  for (const [label, keys] of entries) {
    const value = keys.map((key) => payload[key]).find((candidate) => hasDisplayValue(candidate))
    if (hasDisplayValue(value)) {
      cards.push({ label, value: displayValue(value) })
    }
  }

  if (!cards.some((card) => card.label === 'Engine')) {
    cards.push({
      label: 'Engine',
      value: relationalEngineLabel(connection),
    })
  }

  if (!cards.length && kind) {
    cards.push({ label: 'Object Type', value: kind })
  }

  return cards.slice(0, 8)
}

export function relationalQueryTargetFromObjectView(tab: QueryTabState): ScopedQueryTarget | undefined {
  const state = tab.objectViewState
  if (!state?.queryTemplate) {
    return undefined
  }

  return {
    kind: state.kind,
    label: state.label,
    path: state.path,
    queryTemplate: state.queryTemplate,
    preferredBuilder: undefined,
  }
}

export function descriptorForConnection(
  connection: ConnectionProfile,
  kind: string,
): RelationalObjectViewDescriptor {
  if (connection.engine === 'sqlserver') {
    return getSqlServerObjectViewDescriptor(kind)
  }

  if (connection.engine === 'sqlite') {
    return getSqliteObjectViewDescriptor(kind)
  }

  if (connection.engine === 'duckdb') {
    return getDuckDbObjectViewDescriptor(kind)
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return getMysqlObjectViewDescriptor(kind)
  }

  if (connection.engine === 'cockroachdb') {
    return getCockroachObjectViewDescriptor(kind)
  }

  return getPostgresObjectViewDescriptor(kind)
}

export function displayCellValue(column: string, value: unknown) {
  if (isSqlTextColumn(column)) {
    return sqlTextSummary(value)
  }

  return displayValue(value)
}

export function labelForColumn(column: string) {
  return column
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function objectViewWarnings(tab: QueryTabState, payload: JsonRecord) {
  const payloadWarnings = Array.isArray(payload.warnings)
    ? payload.warnings.map(displayValue)
    : []

  return [
    ...(tab.objectViewState?.warnings ?? []),
    ...(tab.error?.message ? [tab.error.message] : []),
    ...(typeof payload.warning === 'string' ? [payload.warning] : []),
    ...payloadWarnings,
  ].filter(Boolean)
}

export function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function preferredColumns(rows: JsonRecord[], preferred: string[]) {
  const available = new Set(rows.flatMap((row) => Object.keys(row)))
  const preferredAvailable = preferred.filter((key) => available.has(key))
  const extras = [...available].filter((key) => !preferredAvailable.includes(key)).slice(0, 4)
  return [...preferredAvailable, ...extras].slice(0, 8)
}

function tableRows(rows: JsonRecord[], preferred: string[]) {
  const columns = preferredColumns(rows, preferred)
  return rows.map((row) => columns.map((column) => displayCellValue(column, row[column])))
}

function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
}

function hasDisplayValue(value: unknown) {
  return value !== undefined && value !== null && value !== ''
}

function displayValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString() : String(value)
  }

  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(displayValue).filter(Boolean).join(', ')
  }

  return Object.entries(asRecord(value))
    .map(([key, nested]) => `${key}: ${displayValue(nested)}`)
    .join(', ')
}

function relationalEngineLabel(connection: ConnectionProfile) {
  if (connection.engine === 'sqlserver') {
    return 'SQL Server / Azure SQL'
  }

  if (connection.engine === 'cockroachdb') {
    return 'CockroachDB'
  }

  if (connection.engine === 'timescaledb') {
    return 'TimescaleDB'
  }

  if (connection.engine === 'mysql') {
    return 'MySQL'
  }

  if (connection.engine === 'mariadb') {
    return 'MariaDB'
  }

  if (connection.engine === 'sqlite') {
    return 'SQLite'
  }

  if (connection.engine === 'duckdb') {
    return 'DuckDB'
  }

  return 'PostgreSQL'
}

function isSqlTextColumn(column: string) {
  return /definition|sql|query|text/i.test(column)
}

function sqlTextSummary(value: unknown) {
  const text = displayValue(value).replace(/\s+/g, ' ').trim()
  if (!text) {
    return ''
  }

  const keyword = text.match(/\b(select|insert|update|delete|merge|create|alter|drop|exec|execute|with)\b/i)?.[1]
  const label = keyword ? `${keyword.toUpperCase()} statement` : 'SQL text'
  return `${label} (${text.length.toLocaleString()} chars)`
}
