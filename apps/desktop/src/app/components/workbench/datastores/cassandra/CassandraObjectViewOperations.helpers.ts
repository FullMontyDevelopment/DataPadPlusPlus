import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import type { WideColumnOperationAction, WideColumnOperationIconName } from '../common/widecolumn/WideColumnObjectViewOperations'

type JsonRecord = Record<string, unknown>

export function cassandraOperationActions(
  connection: ConnectionProfile,
  tab: QueryTabState,
  kind: string,
  payload: JsonRecord,
): WideColumnOperationAction[] {
  const supported = supportedCassandraOperations(connection)
  const target = cassandraOperationTarget(tab, payload)
  const actions: WideColumnOperationAction[] = []

  if (!target.objectName) {
    return actions
  }

  const normalizedKind = normalizeKind(kind)
  const tableLike = ['table', 'data', 'columns', 'primary-key', 'statistics', 'compaction', 'materialized-view'].includes(normalizedKind)
  const indexLike = ['indexes', 'index'].includes(normalizedKind)
  const securityLike = ['security', 'permissions'].includes(normalizedKind)
  const diagnosticLike = ['diagnostics', 'cluster', 'tracing', 'repairs', 'compaction', 'statistics'].includes(normalizedKind)
  const baseParameters = cassandraOperationParameters(tab, payload, target)

  if (tableLike && supported.has('profile')) {
    actions.push(action(connection, 'query.profile', 'Trace', 'Prepare a CQL tracing profile for this object', 'job', target.objectName, baseParameters))
  }

  if ((tableLike || indexLike) && supported.has('index')) {
    actions.push(action(connection, 'index.create', 'Create Index', 'Prepare a guarded SAI or secondary index creation plan', 'index', target.objectName, {
      ...baseParameters,
      indexName: firstIndexName(payload) ?? `${target.tableName ?? 'table'}_new_idx`,
      columnName: firstRegularColumnName(payload) ?? 'column_name',
      indexKind: 'SAI',
    }))
  }

  if (indexLike && supported.has('index')) {
    const indexName = firstIndexName(payload) ?? target.objectName
    actions.push(action(connection, 'index.drop', 'Drop Index', 'Prepare a guarded index drop plan', 'index', indexName, {
      ...baseParameters,
      indexName,
    }))
  }

  if ((securityLike || tableLike) && supported.has('permissions')) {
    actions.push(action(connection, 'security.inspect', 'Permissions', 'Review visible roles and grants', 'security', target.objectName, baseParameters))
  }

  if (diagnosticLike && supported.has('metrics')) {
    actions.push(action(connection, 'diagnostics.metrics', 'Metrics', 'Collect latency, compaction, repair, and node health metrics', 'job', target.objectName, baseParameters))
  }

  if (tableLike && supported.has('importExport')) {
    actions.push(action(connection, 'data.import-export', 'Export', 'Prepare a contract-backed cqlsh COPY import or export plan', 'table', target.objectName, {
      ...baseParameters,
      mode: 'export',
      format: 'csv',
    }))
  }

  if (tableLike && supported.has('backupRestore')) {
    actions.push(action(connection, 'data.backup-restore', 'Snapshot', 'Prepare a guarded nodetool snapshot or SSTable restore plan', 'job', target.objectName, {
      ...baseParameters,
      mode: 'backup',
      snapshotName: `${target.tableName ?? 'table'}_snapshot`,
    }))
  }

  if ((normalizedKind === 'table' || normalizedKind === 'materialized-view' || normalizedKind === 'type' || normalizedKind === 'function' || normalizedKind === 'aggregate') && supported.has('admin')) {
    actions.push(action(connection, 'object.drop', 'Drop Object', 'Prepare a guarded CQL object drop plan', 'database', target.objectName, baseParameters))
  }

  return dedupeActions(actions).slice(0, 8)
}

export function cassandraOperationTarget(tab: QueryTabState, payload: JsonRecord) {
  const state = tab.objectViewState
  const nodeParts = state?.nodeId.split(':') ?? []
  const path = state?.path ?? []
  const keyspace = stringValue(
    payload.keyspace ??
      nodeParts.find((part, index) => index > 0 && part !== state?.label) ??
      path.find((segment) => !['Keyspaces', 'Tables'].includes(segment)),
  ) || 'app'
  const tableName = stringValue(payload.tableName ?? payload.name ?? state?.label)
  const objectName = tableName
    ? `"${keyspace}"."${tableName}"`
    : stringValue(state?.label)

  return { keyspace, tableName, objectName }
}

function supportedCassandraOperations(connection: ConnectionProfile) {
  const capabilities = new Set(datastoreBacklogByEngine(connection.engine)?.capabilities ?? [])
  const supported = new Set<string>()

  if (capabilities.has('supports_query_profile')) {
    supported.add('profile')
  }
  if (capabilities.has('supports_index_management')) {
    supported.add('index')
  }
  if (capabilities.has('supports_permission_inspection')) {
    supported.add('permissions')
  }
  if (capabilities.has('supports_metrics_collection')) {
    supported.add('metrics')
  }
  if (capabilities.has('supports_import_export')) {
    supported.add('importExport')
  }
  if (capabilities.has('supports_backup_restore')) {
    supported.add('backupRestore')
  }
  if (capabilities.has('supports_admin_operations')) {
    supported.add('admin')
  }

  return supported
}

function cassandraOperationParameters(
  tab: QueryTabState,
  payload: JsonRecord,
  target: ReturnType<typeof cassandraOperationTarget>,
) {
  return {
    keyspace: target.keyspace,
    tableName: target.tableName,
    objectKind: tab.objectViewState?.kind,
    primaryKey: payload.primaryKey,
  }
}

function action(
  connection: ConnectionProfile,
  suffix: string,
  label: string,
  title: string,
  icon: WideColumnOperationIconName,
  objectName: string,
  parameters: Record<string, unknown>,
): WideColumnOperationAction {
  return {
    label,
    title,
    icon,
    operationId: `${connection.engine}.${suffix}`,
    objectName,
    parameters,
  }
}

function firstIndexName(payload: JsonRecord) {
  const firstIndex = firstRecord(payload.indexes)

  return stringValue(firstIndex?.name)
}

function firstRegularColumnName(payload: JsonRecord) {
  const columns = Array.isArray(payload.columns) ? payload.columns : []
  const firstRegular = columns.find((item): item is JsonRecord =>
    Boolean(item) &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    stringValue(item.role).toLowerCase() === 'regular',
  )

  return stringValue(firstRegular?.name)
}

function firstRecord(value: unknown): JsonRecord | undefined {
  return Array.isArray(value)
    ? value.find((item): item is JsonRecord => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : undefined
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

function dedupeActions(actions: WideColumnOperationAction[]) {
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
