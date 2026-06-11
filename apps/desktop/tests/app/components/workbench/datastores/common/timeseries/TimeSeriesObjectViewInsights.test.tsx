import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TimeSeriesObjectViewInsights } from '../../../../../../../src/app/components/workbench/datastores/common/timeseries/TimeSeriesObjectViewInsights'

describe('TimeSeriesObjectViewInsights', () => {
  it('renders cardinality, ingestion, retention, and governance posture without raw payload text', () => {
    render(
      <TimeSeriesObjectViewInsights
        engine="influxdb"
        kind="measurement"
        payload={{
          bucket: 'telemetry',
          measurementCount: 3,
          seriesCount: 18420,
          retention: '30 d',
          storage: '1.8 GB',
          taskCount: 2,
          measurements: [
            { name: 'cpu', lastWrite: '12s ago', series: 8400 },
          ],
          tags: [
            { name: 'host', valueCount: 42, cardinality: 'medium', risk: 'watch' },
          ],
          tasks: [
            { name: 'downsample_cpu', status: 'active', lastRun: '2 min ago' },
          ],
          diagnostics: [
            { signal: 'Measurement Cardinality', value: 'medium', status: 'healthy' },
            { signal: 'Write Health', value: 'ok', status: 'healthy' },
          ],
        }}
      />,
    )

    const cardinality = screen.getByRole('region', { name: 'Time-series cardinality posture' })
    expect(within(cardinality).getByText('InfluxDB Cardinality')).toBeInTheDocument()
    expect(within(cardinality).getByText('host')).toBeInTheDocument()

    const ingestion = screen.getByRole('region', { name: 'Time-series ingestion posture' })
    expect(within(ingestion).getAllByText('12s ago').length).toBeGreaterThan(0)

    const retention = screen.getByRole('region', { name: 'Time-series retention posture' })
    expect(within(retention).getByText('telemetry')).toBeInTheDocument()
    expect(within(retention).getByText('30 d')).toBeInTheDocument()

    const governance = screen.getByRole('region', { name: 'Time-series governance posture' })
    expect(within(governance).getByText('Controls')).toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('stays hidden for unsupported object kinds without posture data', () => {
    const { container } = render(<TimeSeriesObjectViewInsights engine="prometheus" kind="unknown" payload={{}} />)

    expect(container).toBeEmptyDOMElement()
  })
})
