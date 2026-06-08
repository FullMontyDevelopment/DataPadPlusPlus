import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type { TimeSeriesOperationAction, TimeSeriesOperationIconName } from './TimeSeriesObjectViewOperations'

type JsonRecord = Record<string, unknown>

interface TimescaleActionTarget {
  objectName: string
  queryTemplate: string
  icon: TimeSeriesOperationIconName
}

export function timescaleOperationActions(
  connection: ConnectionProfile,
  kind: string,
  target: TimescaleActionTarget,
  baseParameters: Record<string, unknown>,
  supported: ReadonlySet<string>,
) {
  const actions: TimeSeriesOperationAction[] = []

  if (isTimescaleQueryableLike(kind) && supported.has('profile')) {
    actions.push(action(connection, 'query.profile', 'Profile', 'Prepare a guarded TimescaleDB query profile', 'job', target.objectName, {
      ...baseParameters,
      query: target.queryTemplate,
    }))
  }

  if (isTimescaleHypertableLike(kind) && supported.has('admin')) {
    actions.push(
      action(connection, 'timescale.compression-policy', 'Compress', 'Preview a guarded TimescaleDB compression policy change', 'storage', target.objectName, {
        ...baseParameters,
        compressAfter: '7 days',
      }),
      action(connection, 'timescale.retention-policy', 'Retention', 'Preview a guarded TimescaleDB retention policy change', 'storage', target.objectName, {
        ...baseParameters,
        dropAfter: '90 days',
      }),
    )
  }

  if (isTimescaleAggregateLike(kind) && supported.has('admin')) {
    actions.push(action(connection, 'timescale.refresh-continuous-aggregate', 'Refresh', 'Preview a bounded continuous aggregate refresh', 'job', target.objectName, {
      ...baseParameters,
      startOffset: '7 days',
      endOffset: '0 minutes',
    }))
  }

  if (isTimescaleJobLike(kind) && supported.has('admin')) {
    actions.push(action(connection, 'timescale.job-control', 'Job Control', 'Preview pausing, resuming, or running a TimescaleDB job', 'job', target.objectName, {
      ...baseParameters,
      action: 'run',
    }))
  }

  if (isTimescaleImportExportLike(kind) && supported.has('importExport')) {
    actions.push(action(connection, 'data.import-export', 'Export', 'Prepare a bounded TimescaleDB hypertable export workflow', target.icon, target.objectName, {
      ...baseParameters,
      mode: 'export',
      format: 'csv',
      timeColumn: 'time',
    }))
  }

  if (isTimescaleBackupLike(kind) && supported.has('backupRestore')) {
    actions.push(action(connection, 'data.backup-restore', 'Backup', 'Preview a TimescaleDB backup or restore workflow with extension, chunk, policy, and job preflights', 'storage', target.objectName, {
      ...baseParameters,
      mode: 'backup',
      filePath: '<selected-file>.dump',
    }))
  }

  return actions
}

export function timescaleObjectName(payload: JsonRecord, label: string) {
  const schema = stringValue(payload.schema ?? payload.hypertableSchema ?? payload.viewSchema)
  const table = stringValue(payload.table ?? payload.hypertableName ?? payload.viewName ?? payload.name)
  if (schema && table) {
    return `"${schema.replace(/"/g, '""')}"."${table.replace(/"/g, '""')}"`
  }
  return stringValue(payload.hypertable ?? payload.view ?? payload.name ?? label)
}

function isTimescaleHypertableLike(kind: string) {
  return ['hypertable', 'hypertables', 'chunks', 'compression', 'retention', 'table'].includes(kind)
}

function isTimescaleAggregateLike(kind: string) {
  return ['continuous-aggregate', 'continuous-aggregates', 'materialized-view'].includes(kind)
}

function isTimescaleJobLike(kind: string) {
  return ['job', 'jobs', 'compression', 'retention'].includes(kind)
}

function isTimescaleQueryableLike(kind: string) {
  return ['hypertable', 'table', 'continuous-aggregate', 'materialized-view'].includes(kind)
}

function isTimescaleImportExportLike(kind: string) {
  return ['hypertable', 'hypertables', 'table', 'continuous-aggregate', 'continuous-aggregates'].includes(kind)
}

function isTimescaleBackupLike(kind: string) {
  return ['database', 'schema', 'hypertable', 'hypertables', 'table', 'continuous-aggregate', 'continuous-aggregates'].includes(kind)
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
