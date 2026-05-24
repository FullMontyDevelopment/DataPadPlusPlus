import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { MetricsWorkspace } from './MetricsWorkspace'

describe('MetricsWorkspace', () => {
  it('renders metric tiles and charts instead of diagnostic query history', () => {
    render(
      <MetricsWorkspace
        connection={connection}
        environment={environment}
        tab={{
          ...metricsTab,
          metricsState: {
            connectionId: connection.id,
            environmentId: environment.id,
            lastRefreshedAt: '1779030229',
            warnings: [],
            diagnostics: {
              engine: 'redis',
              plans: [],
              profiles: [],
              metrics: [
                {
                  renderer: 'metrics',
                  metrics: [
                    {
                      name: 'redis.used_memory',
                      value: 7_340_032,
                      unit: 'bytes',
                      labels: { source: 'INFO memory' },
                    },
                    {
                      name: 'redis.cache_hit_rate',
                      value: 98.4,
                      unit: '%',
                      labels: { source: 'INFO stats' },
                    },
                  ],
                },
                {
                  renderer: 'chart',
                  chartType: 'bar',
                  xAxis: 'Metric',
                  yAxis: 'Value',
                  series: [
                    {
                      name: 'Redis health',
                      points: [
                        { x: 'memory', y: 7 },
                        { x: 'hit rate', y: 98 },
                      ],
                    },
                  ],
                },
              ],
              queryHistory: [
                {
                  renderer: 'json',
                  value: { message: 'should not render in Metrics by default' },
                },
              ],
              costEstimates: [],
              warnings: [],
            },
          },
        }}
        onRefresh={vi.fn()}
      />,
    )

    expect(screen.getAllByText('7.0 MB').length).toBeGreaterThan(0)
    expect(screen.getAllByText('98.4%').length).toBeGreaterThan(0)
    expect(screen.getByText('All Metrics')).toBeInTheDocument()
    expect(screen.getAllByText('Used Memory').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Cache Hit Rate').length).toBeGreaterThan(0)
    expect(screen.getByText('source: INFO memory')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Metrics 1/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/should not render/i)).not.toBeInTheDocument()
  })

  it('shows a clear empty state when a connection returns no metrics', () => {
    render(
      <MetricsWorkspace
        connection={connection}
        environment={environment}
        tab={{
          ...metricsTab,
          metricsState: {
            connectionId: connection.id,
            environmentId: environment.id,
            warnings: [],
            diagnostics: {
              engine: 'redis',
              plans: [],
              profiles: [],
              metrics: [],
              queryHistory: [],
              costEstimates: [],
              warnings: [],
            },
          },
        }}
        onRefresh={vi.fn()}
      />,
    )

    expect(screen.getByText('No live metrics yet')).toBeInTheDocument()
    expect(screen.getByText('No live metrics were returned for this connection.')).toBeInTheDocument()
  })
})

const connection: ConnectionProfile = {
  id: 'conn-redis',
  name: 'Redis',
  engine: 'redis',
  family: 'keyvalue',
  host: 'localhost',
  port: 6379,
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'R',
  auth: {},
  createdAt: '2026-05-17T00:00:00.000Z',
  updatedAt: '2026-05-17T00:00:00.000Z',
}

const environment: EnvironmentProfile = {
  id: 'env-local',
  label: 'Local',
  color: '#5dd6b0',
  risk: 'low',
  variables: {},
  sensitiveKeys: [],
  requiresConfirmation: false,
  safeMode: false,
  exportable: true,
  createdAt: '2026-05-17T00:00:00.000Z',
  updatedAt: '2026-05-17T00:00:00.000Z',
}

const metricsTab: QueryTabState = {
  id: 'tab-metrics',
  title: 'Metrics - Redis',
  tabKind: 'metrics',
  connectionId: connection.id,
  environmentId: environment.id,
  family: 'keyvalue',
  language: 'json',
  editorLabel: 'Metrics',
  queryText: '',
  status: 'success',
  dirty: false,
  history: [],
}
