import type { ConnectionProfile, OperationPlanRequest } from '@datapadplusplus/shared-types'
import { defaultQueryTextForConnection } from '../../../../../app/state/helpers'

type JsonRecord = Record<string, unknown>

export function timeSeriesOperationRequest(
  connection: ConnectionProfile,
  request: OperationPlanRequest,
) {
  if (connection.engine === 'prometheus') {
    return prometheusOperationRequest(connection, request)
  }

  if (connection.engine === 'influxdb') {
    return influxOperationRequest(connection, request)
  }

  if (connection.engine === 'opentsdb') {
    return openTsdbOperationRequest(connection, request)
  }

  return defaultQueryTextForConnection(connection)
}

function prometheusOperationRequest(connection: ConnectionProfile, request: OperationPlanRequest) {
  const parameters = asRecord(request.parameters)
  const query = stringValue(parameters.query) || stringValue(request.objectName) || 'up'

  if (request.operationId.endsWith('query.profile')) {
    return httpJson({
      method: 'GET',
      path: '/api/v1/query',
      query: {
        query,
        time: 'now',
      },
      profile: {
        range: parameters.range ?? '5m',
        checks: ['cardinality', 'sample-count', 'step-width'],
      },
    })
  }

  if (request.operationId.endsWith('diagnostics.metrics')) {
    return httpJson({
      method: 'GET',
      path: prometheusDiagnosticsPath(parameters),
      query: {
        scope: parameters.objectKind ?? 'diagnostics',
      },
    })
  }

  if (request.operationId.endsWith('cardinality.analyze')) {
    return httpJson({
      method: 'GET',
      path: '/api/v1/series',
      query: {
        match: [parameters.match ?? query],
        start: parameters.start ?? 'now-1h',
        end: parameters.end ?? 'now',
      },
      analysis: {
        groupBy: ['__name__', 'job', 'instance'],
        checks: ['label-value-count', 'series-count', 'high-cardinality-labels'],
      },
    })
  }

  if (request.operationId.endsWith('data.import-export')) {
    return httpJson({
      operation: 'prometheus.range-export',
      method: 'GET',
      path: '/api/v1/query_range',
      query: {
        query,
        start: parameters.start ?? 'now-1h',
        end: parameters.end ?? 'now',
        step: parameters.step ?? '30s',
      },
      format: parameters.format ?? 'json',
      validation: ['bounded-range', 'cardinality-check', 'result-snapshot-only'],
    })
  }

  return defaultQueryTextForConnection(connection)
}

function influxOperationRequest(connection: ConnectionProfile, request: OperationPlanRequest) {
  const parameters = asRecord(request.parameters)
  const bucket = stringValue(parameters.bucket) || connection.database || '<bucket>'
  const measurement = stringValue(parameters.measurement) || stringValue(request.objectName) || '<measurement>'
  const query = stringValue(parameters.query) || `from(bucket: "${bucket}")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "${measurement}")`

  if (request.operationId.endsWith('query.profile')) {
    return httpJson({
      method: 'POST',
      path: '/api/v2/query',
      query: {
        org: parameters.org ?? '<org>',
      },
      body: {
        query,
        type: 'flux',
        profilers: ['query', 'operator'],
      },
    })
  }

  if (request.operationId.endsWith('diagnostics.metrics')) {
    return httpJson({
      method: 'GET',
      path: '/metrics',
      query: {
        bucket,
        measurement: measurement === '<measurement>' ? undefined : measurement,
      },
    })
  }

  if (request.operationId.endsWith('security.inspect')) {
    return httpJson({
      method: 'GET',
      path: '/api/v2/authorizations',
      query: {
        org: parameters.org ?? '<org>',
        bucket,
      },
    })
  }

  if (request.operationId.endsWith('retention.update')) {
    return httpJson({
      method: 'PATCH',
      path: `/api/v2/buckets/${encodeURIComponent(stringValue(request.objectName) || bucket)}`,
      body: {
        name: bucket,
        retentionRules: [{
          type: 'expire',
          everySeconds: retentionSeconds(parameters.retentionPeriod),
        }],
      },
      validation: ['read-current-bucket', 'estimate-affected-series', 'confirm-retention-window'],
    })
  }

  if (request.operationId.endsWith('data.import-export')) {
    return httpJson({
      operation: parameters.mode === 'import' ? 'line-protocol.import' : 'line-protocol.export',
      bucket,
      measurement,
      format: parameters.format ?? 'line-protocol',
      query,
      validation: parameters.mode === 'import' ? 'validate-before-write' : 'bounded-export',
    })
  }

  if (request.operationId.endsWith('object.drop')) {
    return httpJson({
      method: 'DELETE',
      path: influxDeletePath(parameters, request.objectName),
      body: {
        bucket,
        measurement,
        predicate: parameters.predicate ?? `_measurement="${measurement}"`,
        window: parameters.window ?? '1970-01-01T00:00:00Z..now',
      },
    })
  }

  return defaultQueryTextForConnection(connection)
}

function openTsdbOperationRequest(connection: ConnectionProfile, request: OperationPlanRequest) {
  const parameters = asRecord(request.parameters)
  const metric = stringValue(parameters.metric) || stringValue(request.objectName) || '<metric>'

  if (request.operationId.endsWith('diagnostics.metrics')) {
    return httpJson({
      method: 'GET',
      path: '/api/stats',
      query: {
        scope: parameters.objectKind ?? 'stats',
        metric: metric === '<metric>' ? undefined : metric,
      },
    })
  }

  if (request.operationId.endsWith('data.import-export')) {
    return httpJson({
      method: 'POST',
      path: '/api/query',
      body: {
        start: parameters.start ?? '1h-ago',
        queries: [{
          metric,
          aggregator: parameters.aggregator ?? 'avg',
          downsample: parameters.downsample ?? '1m-avg',
          tags: parameters.tags ?? {},
        }],
        format: parameters.format ?? 'json',
      },
    })
  }

  if (request.operationId.endsWith('uid.repair')) {
    return httpJson({
      operation: 'opentsdb.uid.repair',
      metric,
      objectKind: parameters.objectKind ?? 'metric',
      preflight: ['lookup-uid', 'load-meta', 'validate-tree-rules', 'dry-run-meta-update'],
      update: {
        displayName: parameters.displayName ?? metric,
        notes: parameters.notes ?? 'Prepared by DataPad++ guarded UID repair.',
      },
    })
  }

  if (request.operationId.endsWith('object.drop')) {
    return httpJson({
      operation: 'opentsdb.metadata.delete',
      object: metric,
      objectKind: parameters.objectKind ?? 'metric',
      preflight: ['lookup-uid', 'check-tree-rules', 'scan-recent-series'],
    })
  }

  return defaultQueryTextForConnection(connection)
}

function prometheusDiagnosticsPath(parameters: JsonRecord) {
  const kind = stringValue(parameters.objectKind)

  if (['targets', 'target'].includes(kind)) {
    return '/api/v1/targets'
  }

  if (['rules', 'rule', 'alerts', 'alert'].includes(kind)) {
    return '/api/v1/rules'
  }

  return '/api/v1/status/tsdb'
}

function influxDeletePath(parameters: JsonRecord, objectName: string | undefined) {
  const kind = stringValue(parameters.objectKind)
  if (kind.includes('bucket')) {
    return `/api/v2/buckets/${encodeURIComponent(stringValue(objectName) || '<bucket-id>')}`
  }

  if (kind.includes('task')) {
    return `/api/v2/tasks/${encodeURIComponent(stringValue(objectName) || '<task-id>')}`
  }

  return '/api/v2/delete'
}

function httpJson(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function retentionSeconds(value: unknown) {
  const text = stringValue(value)
  const match = text.match(/^(\d+)\s*([dhm])?$/i)
  if (!match) {
    return 30 * 24 * 60 * 60
  }
  const amount = Number(match[1])
  const unit = (match[2] ?? 'd').toLowerCase()
  if (unit === 'h') return amount * 60 * 60
  if (unit === 'm') return amount * 60
  return amount * 24 * 60 * 60
}
