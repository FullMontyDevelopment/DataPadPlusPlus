import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TimescaleObjectViewInsights } from './TimescaleObjectViewInsights'

describe('TimescaleObjectViewInsights', () => {
  it('renders hypertable, policy, aggregate, and diagnostic posture without raw payload text', () => {
    render(
      <TimescaleObjectViewInsights
        kind="hypertable"
        payload={{
          engine: 'timescaledb',
          hypertableCount: 2,
          chunkCount: 11,
          continuousAggregateCount: 1,
          jobCount: 3,
          timescaleProfile: {
            deploymentMode: 'timescale-cloud',
            region: 'aws-us-east-1',
            extensionVersion: '2.15.0',
            license: 'timescale',
            policyExecution: 'Preview only',
            disabledReason: 'Live policy execution is disabled.',
          },
          hypertables: [
            { schema: 'public', name: 'order_metrics', chunks: 8, compressed: 'Yes', retention: '90 days', size: '1.8 GB' },
          ],
          chunks: [
            { hypertable: 'public.order_metrics', chunk: '_hyper_1_42_chunk', compressed: 'Yes', size: '120 MB' },
            { hypertable: 'public.order_metrics', chunk: '_hyper_1_43_chunk', compressed: 'No', size: '164 MB' },
          ],
          timeBuckets: [
            { hypertable: 'public.order_metrics', bucket: '1 hour', latestBucket: '2026-05-27 12:00', avgRows: '20.4k/hour', gapCount: 0, p95Duration: '92 ms', status: 'current' },
          ],
          toolkitDiagnostics: [
            { name: 'timescaledb_toolkit', installedVersion: '1.18.0', schema: 'public', status: 'installed', guidance: 'Advanced aggregates visible' },
          ],
          timeBucketFunctions: [
            { functionName: 'time_bucket', status: 'available' },
            { functionName: 'time_bucket_gapfill', status: 'available' },
          ],
          timeBucketWindows: [
            { hypertable: 'public.order_metrics', bucket: '1 hour', range: '2026-05-20 to 2026-05-22', chunks: 2, compressedChunks: 1, gapfill: 'available', queryGuidance: 'Use bounded time predicates before bucket aggregation.' },
          ],
          timeBucketQueryStats: [
            { queryId: 'bucket-1h', calls: 28, rows: '571k', meanExecMs: '48.00', totalExecMs: '1344.00', status: 'sampled from pg_stat_statements' },
          ],
          chunkSizing: [
            { hypertable: 'public.order_metrics', chunk: '_hyper_1_42_chunk', rows: '156k', size: '120 MB', indexSize: '22 MB', compression: 'compressed' },
          ],
          compressionCoverage: [
            { hypertable: 'public.order_metrics', ratio: '87.5%', compressedChunks: 7, totalChunks: 8, pendingChunks: 1, policy: 'compress after 7 days', status: 'newest chunk pending' },
          ],
          compressionPolicies: [
            { hypertable: 'public.order_metrics', enabled: 'Yes', policy: 'compress after 7 days' },
          ],
          retentionPolicies: [
            { hypertable: 'public.order_metrics', window: '90 days', jobStatus: 'scheduled', lastRun: '2026-05-27 02:00' },
          ],
          continuousAggregates: [
            { schema: 'observability', name: 'hourly_order_metrics', bucket: '1 hour', lag: '10 minutes', lastRefresh: '2026-05-27 12:00' },
          ],
          aggregateFreshness: [
            { view: 'observability.hourly_order_metrics', lag: '10 minutes', invalidationLag: '6 minutes', lastRefresh: '2026-05-27 12:00', materializedOnly: 'No', status: 'healthy' },
          ],
          jobs: [
            { id: 1001, jobType: 'compression policy', object: 'public.order_metrics', status: 'succeeded', lastRun: '2026-05-27 02:00' },
          ],
          jobHistory: [
            { job: 'Compression order_metrics', lastRun: '2026-05-27 02:00', nextRun: '2026-05-28 02:00', duration: '12s', status: 'succeeded', failures: 0 },
          ],
          diagnostics: [
            { signal: 'Compression Coverage', value: '63%', status: 'review newest chunks' },
            { signal: 'Refresh Lag', value: '10 minutes', status: 'healthy' },
          ],
        }}
      />,
    )

    expect(within(screen.getByRole('region', { name: 'Timescale profile posture' })).getByText('timescale-cloud')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale hypertable posture' })).getByText('order_metrics')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale time bucket posture' })).getByText('20.4k/hour')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale Toolkit diagnostics' })).getAllByText('timescaledb_toolkit')).toHaveLength(2)
    expect(within(screen.getByRole('region', { name: 'Timescale time bucket windows' })).getByText('available')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale time bucket query history' })).getByText('48.00')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale chunk sizing posture' })).getByText('_hyper_1_42_chunk')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale compression coverage' })).getByText('7/8')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale policy posture' })).getByText('Policies')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale continuous aggregate posture' })).getByText('hourly_order_metrics')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale aggregate freshness' })).getByText('6 minutes')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale job history' })).getByText('Compression order_metrics')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale diagnostics posture' })).getByText('63%')).toBeInTheDocument()
    expect(screen.queryByText(/Raw inspection payload/i)).not.toBeInTheDocument()
  })

  it('stays hidden for non-Timescale payloads', () => {
    const { container } = render(
      <TimescaleObjectViewInsights
        kind="table"
        payload={{
          engine: 'postgresql',
          hypertables: [{ name: 'ignored' }],
        }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
