import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import type { TimeSeriesOperationAction, TimeSeriesOperationIconName } from './TimeSeriesObjectViewOperations'
import { timescaleObjectName, timescaleOperationActions } from './TimeSeriesObjectViewOperations.timescale-actions'

type JsonRecord = Record<string, unknown>

export function timeSeriesOperationActions(
  connection: ConnectionProfile,
  tab: QueryTabState,
  kind: string,
  payload: JsonRecord,
): TimeSeriesOperationAction[] {
  const supported = supportedTimeSeriesOperations(connection)
  const target = timeSeriesOperationTarget(connection, tab, payload)
  const actions: TimeSeriesOperationAction[] = []

  if (!target.objectName) {
    return actions
  }

  const normalizedKind = normalizeKind(kind)
  const baseParameters = timeSeriesOperationParameters(tab, payload, target)

  if (isProfileLike(connection.engine, normalizedKind) && supported.has('profile')) {
    actions.push(action(connection, 'query.profile', 'Profile', 'Prepare a guarded query-profile request', 'job', target.objectName, {
      ...baseParameters,
      query: target.queryTemplate,
    }))
  }

  if (isMetricsLike(connection.engine, normalizedKind) && supported.has('metrics')) {
    actions.push(action(connection, 'diagnostics.metrics', connection.engine === 'opentsdb' ? 'Stats' : 'Metrics', 'Collect native health, cardinality, and storage signals', 'storage', target.objectName, baseParameters))
  }

  if (connection.engine === 'prometheus' && isPrometheusCardinalityLike(normalizedKind) && supported.has('metrics')) {
    actions.push(action(connection, 'cardinality.analyze', 'Cardinality', 'Analyze metric and label cardinality before broad range queries', 'series', target.objectName, {
      ...baseParameters,
      match: target.queryTemplate || target.objectName,
    }))
  }

  if (isSecurityLike(normalizedKind) && supported.has('permissions')) {
    actions.push(action(connection, 'security.inspect', 'Access', 'Review tokens, scopes, or gateway permissions', 'security', target.objectName, baseParameters))
  }

  if (connection.engine === 'influxdb' && isInfluxRetentionLike(normalizedKind) && supported.has('admin')) {
    actions.push(action(connection, 'retention.update', 'Retention', 'Prepare a guarded bucket retention update', 'storage', target.objectName, {
      ...baseParameters,
      retentionPeriod: '30d',
    }))
  }

  if (connection.engine === 'opentsdb' && isOpenTsdbUidLike(normalizedKind) && supported.has('admin')) {
    actions.push(action(connection, 'uid.repair', 'UID Repair', 'Prepare a guarded UID metadata repair workflow', 'storage', target.objectName, baseParameters))
  }

  if (connection.engine === 'timescaledb') {
    actions.push(...timescaleOperationActions(connection, normalizedKind, target, baseParameters, supported))
  }

  if (isImportExportLike(connection.engine, normalizedKind) && supported.has('importExport')) {
    actions.push(action(connection, 'data.import-export', 'Export', 'Prepare an engine-native time-series export workflow', target.icon, target.objectName, {
      ...baseParameters,
      mode: 'export',
      format: defaultExportFormat(connection.engine),
    }))
  }

  if (isDestructiveLike(connection.engine, normalizedKind) && supported.has('admin')) {
    actions.push(action(connection, 'object.drop', deleteLabel(connection.engine, normalizedKind), 'Prepare a guarded destructive object plan', 'delete', target.objectName, baseParameters))
  }

  return dedupeActions(actions).slice(0, 6)
}

export function timeSeriesOperationObjectName(
  connection: ConnectionProfile,
  tab: QueryTabState,
  payload: JsonRecord,
) {
  return timeSeriesOperationTarget(connection, tab, payload).objectName
}

function timeSeriesOperationTarget(
  connection: ConnectionProfile,
  tab: QueryTabState,
  payload: JsonRecord,
) {
  const state = tab.objectViewState
  const kind = normalizeKind(state?.kind ?? '')
  const metric = stringValue(payload.metric ?? payload.name ?? state?.label)
  const bucket = stringValue(payload.bucket ?? payload.database ?? connection.database)
  const measurement = stringValue(payload.measurement ?? payload.name ?? state?.label)
  const label = stringValue(state?.label)
  const objectName = stringValue(
    connection.engine === 'timescaledb'
      ? timescaleObjectName(payload, label)
      : connection.engine === 'influxdb'
      ? kind.includes('bucket')
        ? payload.bucket ?? payload.name ?? label
        : payload.measurement ?? payload.name ?? label ?? payload.bucket
      : payload.metric ?? payload.name ?? label,
  )

  return {
    bucket,
    measurement,
    metric: connection.engine === 'opentsdb' || connection.engine === 'prometheus' ? metric : '',
    objectName,
    queryTemplate: state?.queryTemplate ?? defaultQueryTemplate(connection, objectName, bucket, measurement),
    icon: targetIcon(connection.engine, state?.kind ?? ''),
  }
}

function supportedTimeSeriesOperations(connection: ConnectionProfile) {
  const capabilities = new Set(datastoreBacklogByEngine(connection.engine)?.capabilities ?? [])
  const supported = new Set<string>()

  if (capabilities.has('supports_query_profile')) {
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
  if (capabilities.has('supports_backup_restore')) {
    supported.add('backupRestore')
  }
  if (capabilities.has('supports_admin_operations')) {
    supported.add('admin')
  }

  return supported
}

function timeSeriesOperationParameters(
  tab: QueryTabState,
  payload: JsonRecord,
  target: ReturnType<typeof timeSeriesOperationTarget>,
) {
  return {
    objectKind: tab.objectViewState?.kind,
    bucket: target.bucket || undefined,
    measurement: target.measurement || undefined,
    metric: target.metric || undefined,
    schema: payload.schema ?? payload.hypertableSchema ?? payload.viewSchema,
    table: payload.table ?? payload.hypertableName ?? payload.viewName ?? payload.name,
    jobId: payload.jobId ?? payload.job_id ?? payload.id,
    tag: payload.tag ?? payload.name,
    field: payload.field,
    query: target.queryTemplate,
  }
}

function isProfileLike(engine: string, kind: string) {
  if (engine === 'prometheus') {
    return ['metric', 'metrics', 'series', 'label', 'labels'].includes(kind)
  }

  if (engine === 'influxdb') {
    return ['bucket', 'buckets', 'measurement', 'measurements', 'tag', 'tags', 'field', 'fields'].includes(kind)
  }

  return false
}

function isMetricsLike(engine: string, kind: string) {
  if (engine === 'prometheus') {
    return ['metric', 'metrics', 'series', 'targets', 'target', 'rules', 'alerts', 'tsdb', 'storage', 'diagnostics', 'remote-write', 'service-discovery'].includes(kind)
  }

  if (engine === 'influxdb') {
    return ['bucket', 'buckets', 'measurement', 'measurements', 'retention', 'retention-policies', 'task', 'tasks', 'diagnostics'].includes(kind)
  }

  return ['metric', 'metrics', 'tag', 'tags', 'aggregators', 'downsampling', 'uid-metadata', 'uid', 'tree', 'trees', 'stats', 'diagnostics'].includes(kind)
}

function isSecurityLike(kind: string) {
  return ['security', 'tokens', 'token', 'permissions'].includes(kind)
}

function isPrometheusCardinalityLike(kind: string) {
  return ['metric', 'metrics', 'series', 'label', 'labels', 'tsdb', 'storage'].includes(kind)
}

function isInfluxRetentionLike(kind: string) {
  return ['bucket', 'buckets', 'retention', 'retention-policy', 'retention-policies'].includes(kind)
}

function isOpenTsdbUidLike(kind: string) {
  return ['metric', 'metrics', 'uid', 'uid-metadata', 'tree', 'trees'].includes(kind)
}

function isImportExportLike(engine: string, kind: string) {
  if (engine === 'timescaledb') {
    return false
  }

  if (engine === 'prometheus') {
    return ['metric', 'metrics', 'series', 'label', 'labels', 'tsdb', 'storage'].includes(kind)
  }

  if (engine === 'influxdb') {
    return ['bucket', 'buckets', 'measurement', 'measurements', 'tag', 'tags', 'field', 'fields'].includes(kind)
  }

  return ['metric', 'metrics', 'tag', 'tags', 'uid-metadata', 'uid', 'tree', 'trees'].includes(kind)
}

function isDestructiveLike(engine: string, kind: string) {
  if (engine === 'prometheus') {
    return false
  }

  if (engine === 'influxdb') {
    return ['bucket', 'measurement', 'task', 'retention', 'retention-policy'].includes(kind)
  }

  return ['metric', 'tree', 'uid'].includes(kind)
}

function defaultQueryTemplate(
  connection: ConnectionProfile,
  objectName: string,
  bucket: string,
  measurement: string,
) {
  if (connection.engine === 'timescaledb') {
    return `select * from ${objectName || '"public"."<hypertable>"'} limit 100;`
  }

  if (connection.engine === 'prometheus') {
    return objectName || 'up'
  }

  if (connection.engine === 'influxdb') {
    const selectedBucket = bucket || connection.database || '<bucket>'
    const selectedMeasurement = measurement || objectName || '<measurement>'
    return `from(bucket: "${selectedBucket}")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "${selectedMeasurement}")`
  }

  return JSON.stringify({
    start: '1h-ago',
    queries: [{ metric: objectName || '<metric>', aggregator: 'avg', downsample: '1m-avg', tags: {} }],
  }, null, 2)
}

function defaultExportFormat(engine: string) {
  if (engine === 'timescaledb') {
    return 'csv'
  }

  if (engine === 'influxdb') {
    return 'line-protocol'
  }

  if (engine === 'opentsdb') {
    return 'json'
  }

  return 'json'
}

function deleteLabel(engine: string, kind: string) {
  if (engine === 'influxdb') {
    if (kind.includes('bucket')) return 'Delete Bucket'
    if (kind.includes('task')) return 'Delete Task'
    return 'Delete Series'
  }

  if (kind.includes('tree')) return 'Delete Tree'
  if (kind.includes('uid')) return 'Delete UID'
  return 'Delete Metric'
}

function targetIcon(engine: string, kind: string): TimeSeriesOperationIconName {
  const normalizedKind = normalizeKind(kind)
  if (engine === 'timescaledb') {
    if (normalizedKind.includes('job') || normalizedKind.includes('aggregate')) return 'job'
    if (normalizedKind.includes('compression') || normalizedKind.includes('retention')) return 'storage'
    return 'metric'
  }

  if (engine === 'influxdb') {
    return normalizedKind.includes('bucket') ? 'bucket' : 'series'
  }

  if (normalizedKind.includes('storage') || normalizedKind.includes('tsdb') || normalizedKind.includes('stats')) {
    return 'storage'
  }

  return 'metric'
}

function action(
  connection: ConnectionProfile,
  suffix: string,
  label: string,
  title: string,
  icon: TimeSeriesOperationIconName,
  objectName: string,
  parameters: Record<string, unknown>,
): TimeSeriesOperationAction {
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

function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

function dedupeActions(actions: TimeSeriesOperationAction[]) {
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
