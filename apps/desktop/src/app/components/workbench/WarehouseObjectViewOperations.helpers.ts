import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'

type JsonRecord = Record<string, unknown>

export type WarehouseOperationIconName =
  | 'database'
  | 'table'
  | 'stage'
  | 'warehouse'
  | 'job'
  | 'security'
  | 'delete'

export type WarehouseOperationAction = {
  label: string
  title: string
  icon: WarehouseOperationIconName
  operationId: string
  objectName: string
  parameters: Record<string, unknown>
}

export function warehouseOperationActions(
  connection: ConnectionProfile,
  tab: QueryTabState,
  kind: string,
  payload: JsonRecord,
): WarehouseOperationAction[] {
  const supported = supportedWarehouseOperations(connection)
  const normalizedKind = normalizeKind(kind)
  const target = warehouseOperationTarget(connection, tab, payload)
  const actions: WarehouseOperationAction[] = []

  if (!target.objectName) {
    return actions
  }

  const baseParameters = warehouseOperationParameters(tab, payload, target)

  if (isExplainLike(normalizedKind) && supported.has('explain')) {
    actions.push(action(connection, 'query.explain', 'Explain', 'Prepare an engine-native plan or dry-run preview', 'job', target.objectName, {
      ...baseParameters,
      query: target.queryTemplate,
    }))
  }

  if (isProfileLike(normalizedKind) && supported.has('profile')) {
    actions.push(action(connection, 'query.profile', profileLabel(connection.engine), 'Prepare a guarded warehouse profile or cost request', 'job', target.objectName, {
      ...baseParameters,
      query: target.queryTemplate,
    }))
  }

  if (isMetricsLike(normalizedKind) && supported.has('metrics')) {
    actions.push(action(connection, 'diagnostics.metrics', 'Metrics', 'Collect warehouse utilization, job, cost, and storage signals', 'warehouse', target.objectName, baseParameters))
  }

  if (isSecurityLike(normalizedKind) && supported.has('permissions')) {
    actions.push(action(connection, 'security.inspect', 'Access', 'Review roles, grants, IAM bindings, or policies', 'security', target.objectName, baseParameters))
  }

  if (isImportExportLike(normalizedKind) && supported.has('importExport')) {
    actions.push(action(connection, 'data.import-export', exportLabel(normalizedKind), 'Prepare a guarded warehouse import or export workflow', exportIcon(normalizedKind), target.objectName, {
      ...baseParameters,
      mode: normalizedKind.includes('stage') ? 'import' : 'export',
      format: defaultWarehouseExportFormat(connection.engine),
    }))
  }

  if (isTableLike(normalizedKind) && supported.has('admin')) {
    actions.push(...tableMaintenanceActions(connection, target.objectName, baseParameters))
  }

  if (isWarehouseLike(normalizedKind) && connection.engine === 'snowflake' && supported.has('admin')) {
    actions.push(
      action(connection, 'warehouse.suspend', 'Suspend', 'Prepare a guarded Snowflake warehouse suspend plan', 'warehouse', target.objectName, baseParameters),
      action(connection, 'warehouse.resume', 'Resume', 'Prepare a guarded Snowflake warehouse resume plan', 'warehouse', target.objectName, baseParameters),
    )
  }

  if (isDestructiveLike(normalizedKind) && supported.has('admin')) {
    actions.push(action(connection, 'object.drop', dropLabel(normalizedKind), 'Prepare a guarded destructive warehouse object plan', 'delete', target.objectName, baseParameters))
  }

  return dedupeActions(actions).slice(0, 8)
}

export function warehouseOperationObjectName(
  connection: ConnectionProfile,
  tab: QueryTabState,
  payload: JsonRecord,
) {
  return warehouseOperationTarget(connection, tab, payload).objectName
}

function warehouseOperationTarget(
  connection: ConnectionProfile,
  tab: QueryTabState,
  payload: JsonRecord,
) {
  const state = tab.objectViewState
  const kind = normalizeKind(state?.kind ?? '')
  const pathSchema = usablePathSegment(state?.path?.[0])
  const database = stringValue(payload.database ?? payload.project ?? connection.database ?? pathSchema)
  const schema = stringValue(payload.schema ?? payload.dataset ?? pathSchema ?? database)
  const objectName = stringValue(
    payload.name ??
    payload.tableName ??
    payload.viewName ??
    payload.stageName ??
    payload.warehouse ??
    payload.id ??
    state?.label ??
    database,
  )

  return {
    database,
    schema,
    objectName,
    queryTemplate: state?.queryTemplate ?? defaultWarehouseQueryTemplate(connection, schema, objectName, kind),
  }
}

function supportedWarehouseOperations(connection: ConnectionProfile) {
  const capabilities = new Set(datastoreBacklogByEngine(connection.engine)?.capabilities ?? [])
  const supported = new Set<string>()

  if (capabilities.has('supports_explain_plan')) {
    supported.add('explain')
  }
  if (capabilities.has('supports_query_profile') || capabilities.has('supports_cost_estimation')) {
    supported.add('profile')
  }
  if (capabilities.has('supports_metrics_collection')) {
    supported.add('metrics')
  }
  if (capabilities.has('supports_permission_inspection')) {
    supported.add('permissions')
  }
  if (capabilities.has('supports_import_export')) {
    supported.add('importExport')
  }
  if (capabilities.has('supports_admin_operations')) {
    supported.add('admin')
  }

  return supported
}

function warehouseOperationParameters(
  tab: QueryTabState,
  payload: JsonRecord,
  target: ReturnType<typeof warehouseOperationTarget>,
) {
  return {
    objectKind: tab.objectViewState?.kind,
    database: target.database || undefined,
    schema: target.schema || undefined,
    tableName: target.objectName || undefined,
    objectName: target.objectName || undefined,
    stageName: payload.stageName ?? payload.name,
    jobId: payload.id,
    query: target.queryTemplate,
  }
}

function isExplainLike(kind: string) {
  return ['table', 'tables', 'view', 'views', 'materialized-view', 'materialized-views'].includes(kind)
}

function isProfileLike(kind: string) {
  return ['table', 'tables', 'view', 'views', 'materialized-view', 'materialized-views', 'job', 'jobs', 'diagnostics'].includes(kind)
}

function isTableLike(kind: string) {
  return ['table', 'tables', 'view', 'views', 'materialized-view', 'materialized-views'].includes(kind)
}

function isWarehouseLike(kind: string) {
  return ['warehouse', 'warehouses'].includes(kind)
}

function isMetricsLike(kind: string) {
  return ['database', 'databases', 'dataset', 'datasets', 'schema', 'schemas', 'warehouse', 'warehouses', 'job', 'jobs', 'diagnostics'].includes(kind)
}

function isSecurityLike(kind: string) {
  return ['security', 'database', 'databases', 'dataset', 'datasets', 'schema', 'schemas', 'table', 'tables', 'view', 'views'].includes(kind)
}

function isImportExportLike(kind: string) {
  return ['table', 'tables', 'view', 'views', 'materialized-view', 'materialized-views', 'stage', 'stages', 'database', 'databases', 'dataset', 'datasets'].includes(kind)
}

function isDestructiveLike(kind: string) {
  return ['table', 'view', 'materialized-view', 'stage', 'warehouse', 'task'].includes(kind)
}

function profileLabel(engine: string) {
  return engine === 'bigquery' || engine === 'snowflake' ? 'Cost' : 'Profile'
}

function exportLabel(kind: string) {
  return kind.includes('stage') ? 'Load' : 'Export'
}

function exportIcon(kind: string): WarehouseOperationIconName {
  return kind.includes('stage') ? 'stage' : 'table'
}

function dropLabel(kind: string) {
  if (kind.includes('warehouse')) return 'Drop Warehouse'
  if (kind.includes('stage')) return 'Drop Stage'
  if (kind.includes('view')) return 'Drop View'
  return 'Drop Table'
}

function tableMaintenanceActions(
  connection: ConnectionProfile,
  objectName: string,
  parameters: Record<string, unknown>,
): WarehouseOperationAction[] {
  if (connection.engine === 'snowflake') {
    return [action(connection, 'table.clone', 'Clone', 'Prepare a guarded zero-copy table clone plan', 'table', objectName, {
      ...parameters,
      cloneName: `${objectName}_clone`,
    })]
  }
  if (connection.engine === 'bigquery') {
    return [action(connection, 'table.copy', 'Copy', 'Prepare a guarded BigQuery table copy job', 'table', objectName, {
      ...parameters,
      destinationTable: `${objectName}_copy`,
    })]
  }
  if (connection.engine === 'clickhouse') {
    return [
      action(connection, 'table.optimize', 'Optimize', 'Prepare a guarded ClickHouse table optimization plan', 'table', objectName, parameters),
      action(connection, 'table.materialize-ttl', 'TTL', 'Prepare a guarded ClickHouse TTL materialization plan', 'table', objectName, parameters),
      action(connection, 'table.freeze', 'Freeze', 'Prepare a guarded ClickHouse table freeze snapshot plan', 'table', objectName, {
        ...parameters,
        snapshotName: `${objectName}_snapshot`,
      }),
    ]
  }
  return []
}

function defaultWarehouseExportFormat(engine: string) {
  if (engine === 'bigquery') {
    return 'avro'
  }
  if (engine === 'clickhouse') {
    return 'parquet'
  }
  return 'csv'
}

function defaultWarehouseQueryTemplate(
  connection: ConnectionProfile,
  schema: string,
  objectName: string,
  kind: string,
) {
  if (kind === 'job' || kind === 'jobs') {
    if (connection.engine === 'bigquery') {
      return "select * from `region-us`.INFORMATION_SCHEMA.JOBS_BY_PROJECT order by creation_time desc limit 100;"
    }
    if (connection.engine === 'snowflake') {
      return 'select * from table(information_schema.query_history()) order by start_time desc limit 100;'
    }
    return 'select * from system.query_log order by event_time desc limit 100;'
  }

  const namespace = schema || connection.database || '<schema>'
  const table = objectName || '<table>'
  if (connection.engine === 'bigquery') {
    return `select * from \`${namespace}.${table}\` limit 100;`
  }
  if (connection.engine === 'snowflake') {
    return `select * from "${namespace}"."${table}" limit 100;`
  }
  if (connection.engine === 'clickhouse') {
    return `select * from \`${namespace}\`.\`${table}\` limit 100;`
  }
  return `select * from ${namespace}.${table} limit 100;`
}

function action(
  connection: ConnectionProfile,
  suffix: string,
  label: string,
  title: string,
  icon: WarehouseOperationIconName,
  objectName: string,
  parameters: Record<string, unknown>,
): WarehouseOperationAction {
  return {
    label,
    title,
    icon,
    operationId: `${connection.engine}.${suffix}`,
    objectName,
    parameters,
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function usablePathSegment(value: unknown) {
  const candidate = stringValue(value)
  if (!candidate || ['databases', 'datasets', 'warehouse', 'warehouses'].includes(normalizeKind(candidate))) {
    return undefined
  }
  return candidate
}

function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

function dedupeActions(actions: WarehouseOperationAction[]) {
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
