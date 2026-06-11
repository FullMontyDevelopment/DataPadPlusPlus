import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ClickHouseObjectViewInsights } from '../../../../../../src/app/components/workbench/datastores/clickhouse/ClickHouseObjectViewInsights'

describe('ClickHouseObjectViewInsights', () => {
  it('renders query-log, MergeTree, cluster, and maintenance posture', () => {
    render(
      <ClickHouseObjectViewInsights
        kind="table"
        payload={{
          queryLog: [
            { queryId: 'ch-1', duration: '120 ms', readRows: 1000, readBytes: 2048, memoryUsage: 4096, status: 'QueryFinish' },
            { queryId: 'ch-2', duration: '12 ms', readRows: 0, readBytes: 0, memoryUsage: 128, status: 'Exception' },
          ],
          parts: [
            { name: '202605_1_1_0', active: true, rows: 1000, compressedBytes: 2048 },
          ],
          partitions: [
            { partition: '202605', rows: 1000, parts: 1 },
          ],
          clusters: [
            { host: 'ch-01', shard: 1, replica: 1, health: 'healthy' },
          ],
          replicas: [
            { host: 'ch-01', status: 'healthy' },
            { host: 'ch-02', status: 'lagging' },
          ],
          merges: [
            { table: 'events', progress: '42%' },
          ],
          mutations: [
            { mutationId: 'mutation_1', status: 'running' },
          ],
        }}
      />,
    )

    expect(within(screen.getByRole('region', { name: 'ClickHouse query log posture' })).getByText('Query Log')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'ClickHouse MergeTree posture' })).getByText('MergeTree')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'ClickHouse cluster posture' })).getByText('Cluster')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'ClickHouse maintenance posture' })).getByText('Maintenance')).toBeInTheDocument()
    expect(screen.queryByText(/Raw inspection payload/i)).not.toBeInTheDocument()
  })

  it('stays hidden for unsupported kinds without ClickHouse metadata', () => {
    const { container } = render(<ClickHouseObjectViewInsights kind="unknown" payload={{}} />)

    expect(container).toBeEmptyDOMElement()
  })
})
