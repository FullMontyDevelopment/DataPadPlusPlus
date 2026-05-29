import type {
  ConnectionProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import type { JsonRecord } from './RelationalObjectViewWorkspace.helpers'
import type { RelationalSectionIcon } from './RelationalObjectViewSections'
import {
  cockroachOperationActions,
  duckDbOperationActions,
  mysqlOperationActions,
  postgresOperationActions,
  sqlServerOperationActions,
  sqliteOperationActions,
  timescaleOperationActions,
} from './RelationalObjectViewOperationDialects'

export type RelationalOperationAction = {
  label: string
  title: string
  icon: RelationalSectionIcon
  operationId: string
  objectName: string
  parameters: Record<string, unknown>
}

export function relationalOperationActions(
  connection: ConnectionProfile,
  tab: QueryTabState,
  kind: string,
  payload: JsonRecord,
): RelationalOperationAction[] {
  const supported = supportedOperationCapabilities(connection)
  const objectName = relationalOperationObjectName(connection, tab, payload)
  const actions: RelationalOperationAction[] = []

  if (!objectName) {
    return actions
  }

  const tableLike = ['table', 'view', 'materialized-view', 'hypertable'].includes(kind)
  const queryable = tableLike && Boolean(tab.objectViewState?.queryTemplate)
  const indexLike = ['indexes', 'index', 'index-health', 'missing-indexes'].includes(kind)
  const securityLike = ['security', 'roles', 'users', 'permissions', 'schemas'].includes(kind)
  const maintenanceLike = ['database', 'maintenance', 'storage', 'diagnostics', 'performance'].includes(kind)
  const baseParameters = relationalOperationParameters(tab, payload, objectName)

  if (queryable && supported.has('explain')) {
    actions.push(action(connection, 'query.explain', 'Explain', 'Preview execution plan', 'job', objectName, baseParameters))
  }

  if (queryable && supported.has('profile')) {
    actions.push(action(connection, 'query.profile', 'Profile', 'Profile execution with engine guardrails', 'job', objectName, baseParameters))
  }

  if (connection.engine === 'duckdb') {
    actions.push(...duckDbOperationActions(connection, kind, objectName, baseParameters))
  }

  if (connection.engine === 'timescaledb') {
    actions.push(...timescaleOperationActions(connection, kind, objectName, baseParameters))
  }

  if (connection.engine === 'cockroachdb') {
    actions.push(...cockroachOperationActions(connection, kind, objectName, baseParameters))
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    actions.push(...mysqlOperationActions(connection, kind, objectName, baseParameters))
  }

  if (connection.engine === 'postgresql') {
    actions.push(...postgresOperationActions(connection, kind, objectName, baseParameters))
  }

  if (connection.engine === 'sqlserver') {
    actions.push(...sqlServerOperationActions(connection, kind, objectName, baseParameters))
  }

  if (connection.engine === 'sqlite') {
    actions.push(...sqliteOperationActions(connection, kind, objectName, baseParameters))
  }

  if (tableLike && supported.has('index')) {
    actions.push(action(connection, 'index.create', 'Create Index', 'Prepare an index creation plan', 'index', objectName, {
      ...baseParameters,
      indexName: suggestedIndexName(objectName, baseParameters.columnName),
    }))
  }

  if (indexLike && supported.has('index')) {
    actions.push(action(connection, 'index.drop', 'Drop Index', 'Prepare an index drop plan', 'index', objectName, baseParameters))
  }

  if ((tableLike || securityLike) && supported.has('permissions') && !(connection.engine === 'cockroachdb' && securityLike)) {
    actions.push(action(connection, 'security.inspect', 'Grants', 'Inspect permissions and grants', 'security', objectName, baseParameters))
  }

  if ((tableLike || maintenanceLike) && supported.has('importExport')) {
    actions.push(action(connection, 'data.import-export', 'Export', 'Prepare an import or export workflow', 'table', objectName, {
      ...baseParameters,
      mode: 'export',
      format: preferredExportFormat(connection),
    }))
  }

  if (maintenanceLike && supported.has('backupRestore')) {
    actions.push(action(connection, 'data.backup-restore', 'Backup', 'Prepare a backup or restore workflow', 'security', objectName, {
      ...baseParameters,
      mode: 'backup',
    }))
  }

  return dedupeActions(actions).slice(0, 6)
}

export function relationalOperationObjectName(
  connection: ConnectionProfile,
  tab: QueryTabState,
  payload: JsonRecord,
) {
  const firstTable = firstPayloadRecord(payload.tables)
  const schema = stringValue(payload.schema ?? payload.schemaName ?? payload.ownerSchema ?? firstTable?.schema)
  const name = stringValue(
    payload.tableName ??
      payload.viewName ??
      payload.objectName ??
      payload.routineName ??
      payload.indexName ??
      payload.name ??
      firstTable?.name ??
      tab.objectViewState?.label,
  )

  if (!name) {
    return undefined
  }

  if (!schema || schema === name || connection.engine === 'sqlite') {
    return quoteQualifiedName(connection, [name])
  }

  return quoteQualifiedName(connection, [schema, name])
}

function supportedOperationCapabilities(connection: ConnectionProfile) {
  const capabilities = new Set(datastoreBacklogByEngine(connection.engine)?.capabilities ?? [])
  const supported = new Set<string>()

  if (capabilities.has('supports_explain_plan')) {
    supported.add('explain')
  }
  if (capabilities.has('supports_query_profile')) {
    supported.add('profile')
  }
  if (capabilities.has('supports_index_management')) {
    supported.add('index')
  }
  if (capabilities.has('supports_permission_inspection')) {
    supported.add('permissions')
  }
  if (capabilities.has('supports_import_export')) {
    supported.add('importExport')
  }
  if (capabilities.has('supports_backup_restore')) {
    supported.add('backupRestore')
  }

  return supported
}

function relationalOperationParameters(
  tab: QueryTabState,
  payload: JsonRecord,
  objectName: string,
) {
  const firstTable = firstPayloadRecord(payload.tables)
  const schema = stringValue(payload.schema ?? payload.schemaName ?? payload.ownerSchema ?? firstTable?.schema)
  const table = stringValue(payload.tableName ?? payload.viewName ?? payload.objectName ?? payload.name ?? firstTable?.name ?? tab.objectViewState?.label)
  const indexName = stringValue(payload.indexName ?? payload.index)
  const columnName = firstColumnName(payload)

  return {
    schema,
    table,
    objectName,
    indexName: indexName || suggestedIndexName(objectName, columnName),
    columnName,
    objectKind: tab.objectViewState?.kind,
  }
}

function firstPayloadRecord(value: unknown): JsonRecord | undefined {
  const first = Array.isArray(value) ? value[0] : undefined
  return first && typeof first === 'object' && !Array.isArray(first)
    ? first as JsonRecord
    : undefined
}

function action(
  connection: ConnectionProfile,
  suffix: string,
  label: string,
  title: string,
  icon: RelationalSectionIcon,
  objectName: string,
  parameters: Record<string, unknown>,
): RelationalOperationAction {
  return {
    label,
    title,
    icon,
    operationId: `${connection.engine}.${suffix}`,
    objectName,
    parameters,
  }
}

function firstColumnName(payload: JsonRecord) {
  const columns = Array.isArray(payload.columns) ? payload.columns : []
  const first = columns.find((column) => {
    const record = column && typeof column === 'object' && !Array.isArray(column)
      ? column as JsonRecord
      : undefined
    return stringValue(record?.name)
  })
  const record = first && typeof first === 'object' && !Array.isArray(first)
    ? first as JsonRecord
    : undefined

  return stringValue(record?.name) || 'id'
}

function preferredExportFormat(connection: ConnectionProfile) {
  if (connection.engine === 'duckdb') {
    return 'parquet'
  }

  return 'csv'
}

function suggestedIndexName(objectName: string, columnName: unknown) {
  const column = stringValue(columnName) || 'id'
  return `idx_${safeIdentifier(objectName)}_${safeIdentifier(column)}`.slice(0, 80)
}

function quoteQualifiedName(connection: ConnectionProfile, parts: string[]) {
  return parts
    .filter(Boolean)
    .map((part) => quoteIdentifier(connection, part))
    .join('.')
}

function quoteIdentifier(connection: ConnectionProfile, value: string) {
  const cleaned = stripSqlIdentifierWrapper(value)

  if (connection.engine === 'sqlserver' || connection.engine === 'sqlite') {
    return `[${cleaned.replace(/]/g, ']]')}]`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `\`${cleaned.replace(/`/g, '``')}\``
  }

  return `"${cleaned.replace(/"/g, '""')}"`
}

function safeIdentifier(value: string) {
  return value
    .replace(/[`"[\]]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'object'
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

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function dedupeActions(actions: RelationalOperationAction[]) {
  const seen = new Set<string>()
  return actions.filter((candidate) => {
    const key = `${candidate.operationId}:${candidate.objectName}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
