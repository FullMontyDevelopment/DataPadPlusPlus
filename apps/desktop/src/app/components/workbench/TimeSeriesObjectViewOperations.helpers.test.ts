import { describe, expect, it } from 'vitest'
import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import {
  timeSeriesOperationActions,
  timeSeriesOperationObjectName,
} from './TimeSeriesObjectViewOperations.helpers'

describe('timeSeriesOperationActions', () => {
  it('offers Prometheus profile and metrics previews for metric objects', () => {
    const tab = objectViewTab('metric', 'http_requests_total', {
      queryTemplate: 'sum(rate(http_requests_total[5m]))',
    })

    const actions = timeSeriesOperationActions(
      connection('prometheus'),
      tab,
      'metric',
      { metric: 'http_requests_total' },
    )

    expect(actions.map((action) => action.label)).toEqual(['Profile', 'Metrics', 'Cardinality'])
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
})

function connection(engine: 'prometheus' | 'influxdb' | 'opentsdb', database?: string): ConnectionProfile {
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
