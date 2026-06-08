import { describe, expect, it } from 'vitest'
import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import {
  timeSeriesOperationActions,
  timeSeriesOperationObjectName,
} from './TimeSeriesObjectViewOperations.helpers'

describe('timeSeriesOperationActions', () => {
  it('offers Prometheus profile, metrics, cardinality, and export previews for metric objects', () => {
    const tab = objectViewTab('metric', 'http_requests_total', {
      queryTemplate: 'sum(rate(http_requests_total[5m]))',
    })

    const actions = timeSeriesOperationActions(
      connection('prometheus'),
      tab,
      'metric',
      { metric: 'http_requests_total' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Profile', 'Metrics', 'Cardinality', 'Export'])
    expect(actions[0]).toMatchObject({
      operationId: 'prometheus.query.profile',
      objectName: 'http_requests_total',
      parameters: expect.objectContaining({
        metric: 'http_requests_total',
        query: 'sum(rate(http_requests_total[5m]))',
      }),
    })
    expect(actions.find((action) => action.label === 'Cardinality')).toMatchObject({
      operationId: 'prometheus.cardinality.analyze',
      parameters: expect.objectContaining({
        match: 'sum(rate(http_requests_total[5m]))',
      }),
    })
    expect(actions.find((action) => action.label === 'Export')).toMatchObject({
      operationId: 'prometheus.data.import-export',
      parameters: expect.objectContaining({
        format: 'json',
        query: 'sum(rate(http_requests_total[5m]))',
      }),
    })
  })

  it('offers InfluxDB profile, metrics, export, and guarded delete previews', () => {
    const tab = objectViewTab('measurement', 'cpu', {
      path: ['Buckets', 'telemetry', 'Measurements'],
      queryTemplate: 'from(bucket: "telemetry") |> range(start: -1h)',
    })

    const actions = timeSeriesOperationActions(
      connection('influxdb', 'telemetry'),
      tab,
      'measurement',
      { bucket: 'telemetry', measurement: 'cpu' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Profile', 'Metrics', 'Export', 'Delete Series'])
    expect(actions.find((action) => action.operationId === 'influxdb.data.import-export')).toMatchObject({
      objectName: 'cpu',
      parameters: expect.objectContaining({
        bucket: 'telemetry',
        measurement: 'cpu',
        format: 'line-protocol',
      }),
    })
  })

  it('offers OpenTSDB stats, export, and guarded delete previews', () => {
    const tab = objectViewTab('metric', 'http.requests', {
      queryTemplate: '{ "start": "1h-ago", "queries": [{ "metric": "http.requests" }] }',
    })

    const actions = timeSeriesOperationActions(
      connection('opentsdb'),
      tab,
      'metric',
      { metric: 'http.requests' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Stats', 'UID Repair', 'Export', 'Delete Metric'])
    expect(timeSeriesOperationObjectName(connection('opentsdb'), tab, { metric: 'http.requests' })).toBe('http.requests')
  })

  it('offers InfluxDB retention updates on bucket scopes', () => {
    const actions = timeSeriesOperationActions(
      connection('influxdb', 'telemetry'),
      objectViewTab('bucket', 'telemetry'),
      'bucket',
      { bucket: 'telemetry' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Profile', 'Metrics', 'Retention', 'Export', 'Delete Bucket'])
    expect(actions.find((action) => action.label === 'Retention')).toMatchObject({
      operationId: 'influxdb.retention.update',
      parameters: expect.objectContaining({
        bucket: 'telemetry',
        retentionPeriod: '30d',
      }),
    })
  })

  it('offers TimescaleDB policy, export, aggregate refresh, and job-control previews', () => {
    const hypertableActions = timeSeriesOperationActions(
      connection('timescaledb', 'metrics'),
      objectViewTab('hypertable', 'public.order_metrics', {
        queryTemplate: 'select * from "public"."order_metrics" limit 100;',
      }),
      'hypertable',
      { schema: 'public', hypertableName: 'order_metrics' },
    )

    expect(hypertableActions.map((action) => action.label)).toEqual(['Profile', 'Compress', 'Retention', 'Export', 'Backup'])
    expect(hypertableActions.find((action) => action.label === 'Export')).toMatchObject({
      operationId: 'timescaledb.data.import-export',
      objectName: '"public"."order_metrics"',
      parameters: expect.objectContaining({
        schema: 'public',
        table: 'order_metrics',
        format: 'csv',
        timeColumn: 'time',
      }),
    })
    expect(hypertableActions.find((action) => action.label === 'Backup')).toMatchObject({
      operationId: 'timescaledb.data.backup-restore',
      objectName: '"public"."order_metrics"',
      parameters: expect.objectContaining({
        mode: 'backup',
        filePath: '<selected-file>.dump',
      }),
    })

    const aggregateActions = timeSeriesOperationActions(
      connection('timescaledb', 'metrics'),
      objectViewTab('continuous-aggregate', 'observability.hourly_order_metrics'),
      'continuous-aggregate',
      { schema: 'observability', viewName: 'hourly_order_metrics' },
    )
    expect(aggregateActions.map((action) => action.label)).toEqual(['Profile', 'Refresh', 'Export', 'Backup'])
    expect(aggregateActions.find((action) => action.label === 'Refresh')).toMatchObject({
      operationId: 'timescaledb.timescale.refresh-continuous-aggregate',
      parameters: expect.objectContaining({
        table: 'hourly_order_metrics',
        startOffset: '7 days',
      }),
    })

    const jobActions = timeSeriesOperationActions(
      connection('timescaledb', 'metrics'),
      objectViewTab('jobs', 'Compression order_metrics'),
      'jobs',
      { jobId: 1001, schema: 'public', hypertableName: 'order_metrics' },
    )
    expect(jobActions.map((action) => action.label)).toEqual(['Job Control'])
    expect(jobActions.find((action) => action.label === 'Job Control')).toMatchObject({
      operationId: 'timescaledb.timescale.job-control',
      parameters: expect.objectContaining({
        jobId: 1001,
        action: 'run',
      }),
    })
  })
})

function connection(engine: 'prometheus' | 'influxdb' | 'opentsdb' | 'timescaledb', database?: string): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine,
    engine,
    family: 'timeseries',
    host: 'localhost',
    port: undefined,
    database,
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function objectViewTab(kind: string, label: string, overrides: Record<string, unknown> = {}): QueryTabState {
  return {
    id: `tab-${kind}`,
    tabKind: 'object-view',
    connectionId: 'conn',
    environmentId: 'env-local',
    title: label,
    family: 'timeseries',
    language: 'promql',
    queryText: '',
    isDirty: false,
    canSave: false,
    objectViewState: {
      connectionId: 'conn',
      environmentId: 'env-local',
      nodeId: `${kind}:${label}`,
      label,
      kind,
      path: ['Metrics'],
      warnings: [],
      payload: {},
      ...overrides,
    },
  } as unknown as QueryTabState
}
