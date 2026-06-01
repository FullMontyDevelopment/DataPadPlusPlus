import type { JsonRecord } from './RelationalObjectViewWorkspace.helpers'

export type SummaryIcon = 'index' | 'job' | 'relationship' | 'security' | 'table'

export interface SummaryStat {
  label: string
  value: string
  icon: SummaryIcon
}

export interface RelationshipSummary {
  from: string
  name: string
  to: string
}

export function summaryStats(kind: string, payload: JsonRecord): SummaryStat[] {
  if (['table', 'view', 'materialized-view', 'hypertable', 'index'].includes(kind)) {
    return compactStats([
      stat('Columns', count(payload.columns), 'table'),
      stat('Indexes', firstCount(payload.indexCount, payload.indexes), 'index'),
      stat('Keys', count(payload.foreignKeys) + count(payload.constraints), 'relationship'),
      stat('Triggers', count(payload.triggers), 'job'),
      stat('Grants', firstCount(undefined, payload.permissions, payload.grants), 'security'),
    ])
  }

  if (['database', 'schema', 'tables', 'views'].includes(kind)) {
    return compactStats([
      stat('Tables', firstCount(payload.tableCount, payload.tables), 'table'),
      stat('Views', firstCount(payload.viewCount, payload.views), 'table'),
      stat('Schemas', firstCount(payload.schemaCount, payload.schemas), 'security'),
      stat('Routines', firstCount(undefined, payload.routines, payload.procedures, payload.functions), 'job'),
      stat('Indexes', firstCount(payload.indexCount, payload.indexes), 'index'),
    ])
  }

  if (['security', 'users', 'roles', 'permissions'].includes(kind)) {
    return compactStats([
      stat('Users', firstCount(undefined, payload.users), 'security'),
      stat('Roles', firstCount(undefined, payload.roles), 'security'),
      stat('Grants', firstCount(undefined, payload.permissions, payload.grants), 'security'),
      stat('Schemas', firstCount(undefined, payload.schemas), 'table'),
    ])
  }

  if (['diagnostics', 'performance', 'query-store', 'sessions', 'locks', 'waits', 'statements'].includes(kind)) {
    return compactStats([
      stat('Sessions', firstCount(payload.activeSessions, payload.sessions), 'job'),
      stat('Blocked', firstScalar(payload.blockedSessions), 'relationship'),
      stat('Waits', firstCount(undefined, payload.waits), 'job'),
      stat('Plans', firstCount(undefined, payload.queryStore, payload.statements), 'index'),
      stat('Locks', firstCount(undefined, payload.locks), 'security'),
    ])
  }

  if (['procedure', 'function', 'stored-procedure', 'stored-procedures', 'functions', 'routines'].includes(kind)) {
    return compactStats([
      stat('Params', firstCount(undefined, payload.parameters), 'table'),
      stat('Deps', firstCount(undefined, payload.dependencies), 'relationship'),
      stat('Grants', firstCount(undefined, payload.permissions, payload.grants), 'security'),
      stat('Source', sourceSize(payload), 'job'),
    ])
  }

  return compactStats([
    stat('Objects', firstCount(undefined, payload.objects), 'table'),
    stat('Indexes', firstCount(payload.indexCount, payload.indexes), 'index'),
    stat('Jobs', firstCount(undefined, payload.jobs), 'job'),
    stat('Grants', firstCount(undefined, payload.permissions, payload.grants), 'security'),
  ])
}

export function relationshipRows(payload: JsonRecord): RelationshipSummary[] {
  return records(payload.foreignKeys)
    .concat(records(payload.dependencies))
    .map((row) => ({
      from: display(row.from ?? endpoint(row.table ?? row.object, row.columns) ?? row.name),
      to: display(
        row.to ??
          endpoint(row.referencedName ?? row.referencedTable ?? row.target, row.referencedColumns ?? row.targetColumns),
      ),
      name: display(row.name ?? row.constraintName ?? row.type ?? row.direction ?? 'relates to'),
    }))
    .filter((row) => row.from && row.to)
}

export function displaySummaryValue(value: unknown): string {
  return display(value)
}

function stat(label: string, value: string | undefined | number, icon: SummaryIcon): SummaryStat | undefined {
  const displayValue = typeof value === 'number' ? (value ? value.toLocaleString() : undefined) : value
  return displayValue ? { label, value: displayValue, icon } : undefined
}

function compactStats(values: Array<SummaryStat | undefined>) {
  return values.filter((value): value is SummaryStat => Boolean(value)).slice(0, 6)
}

function firstCount(explicit: unknown, ...arrays: unknown[]) {
  const explicitValue = firstScalar(explicit)
  if (explicitValue) {
    return explicitValue
  }

  const total = arrays.reduce<number>((sum, value) => sum + count(value), 0)
  return total ? total.toLocaleString() : undefined
}

function firstScalar(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString() : undefined
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  return String(value)
}

function count(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

function sourceSize(payload: JsonRecord) {
  const source = display(payload.definition ?? payload.sql ?? payload.source ?? payload.sourceText)
  return source ? `${source.length.toLocaleString()} chars` : undefined
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function display(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toLocaleString() : String(value)
  }

  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No'
  }

  return String(value)
}

function endpoint(object: unknown, columns: unknown): string | undefined {
  const objectName = display(object)
  if (!objectName) {
    return undefined
  }

  const columnNames = display(columns)
  return columnNames ? `${objectName}.${columnNames}` : objectName
}
