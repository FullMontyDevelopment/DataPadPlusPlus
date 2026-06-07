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
          compressionPolicies: [
            { hypertable: 'public.order_metrics', enabled: 'Yes', policy: 'compress after 7 days' },
          ],
          retentionPolicies: [
            { hypertable: 'public.order_metrics', window: '90 days', jobStatus: 'scheduled', lastRun: '2026-05-27 02:00' },
          ],
          continuousAggregates: [
            { schema: 'observability', name: 'hourly_order_metrics', bucket: '1 hour', lag: '10 minutes', lastRefresh: '2026-05-27 12:00' },
          ],
          jobs: [
            { id: 1001, jobType: 'compression policy', object: 'public.order_metrics', status: 'succeeded', lastRun: '2026-05-27 02:00' },
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
    expect(within(screen.getByRole('region', { name: 'Timescale policy posture' })).getByText('Policies')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Timescale continuous aggregate posture' })).getByText('hourly_order_metrics')).toBeInTheDocument()
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
