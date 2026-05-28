import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CassandraObjectViewInsights } from './CassandraObjectViewInsights'

describe('CassandraObjectViewInsights', () => {
  it('renders native partition, storage, and cluster health panels', () => {
    render(
      <CassandraObjectViewInsights
        kind="table"
        payload={{
          primaryKey: [
            { role: 'partition key', name: 'customer_id', position: 1, type: 'uuid' },
            { role: 'clustering', name: 'order_day', position: 2, type: 'date' },
          ],
          indexes: [
            { name: 'orders_status_sai', kind: 'SAI', target: 'status' },
          ],
          options: [
            { option: 'compaction', value: 'TimeWindowCompactionStrategy', guidance: 'Match TTL patterns.' },
            { option: 'default_time_to_live', value: 604800 },
          ],
          diagnostics: [
            { signal: 'Read latency p95', value: '6 ms', status: 'Healthy', guidance: 'Partition reads are within expected bounds.' },
            { signal: 'Pending compactions', value: 2, status: 'Watch', guidance: 'Monitor backlog.' },
          ],
          warningRows: [
            { warning: 'High tombstone reads', scope: 'orders_by_customer', guidance: 'Review deletes.' },
          ],
          nodes: [
            { node: '127.0.0.1', datacenter: 'datacenter1', status: 'UN' },
          ],
        }}
      />,
    )

    const partitionModel = screen.getByRole('region', { name: 'Cassandra partition model' })
    expect(within(partitionModel).getAllByText('customer_id').length).toBeGreaterThan(0)
    expect(within(partitionModel).getAllByText('order_day').length).toBeGreaterThan(0)

    const storage = screen.getByRole('region', { name: 'Cassandra storage posture' })
    expect(within(storage).getByText('TimeWindowCompactionStrategy')).toBeInTheDocument()
    expect(within(storage).getByText('High tombstone reads')).toBeInTheDocument()

    const cluster = screen.getByRole('region', { name: 'Cassandra cluster health' })
    expect(within(cluster).getByText('Read latency p95')).toBeInTheDocument()
    expect(within(cluster).getByText('Pending compactions')).toBeInTheDocument()
    expect(screen.queryByText(/Raw inspection payload/i)).not.toBeInTheDocument()
  })

  it('does not render for unrelated Cassandra sections', () => {
    const { container } = render(
      <CassandraObjectViewInsights kind="permissions" payload={{ primaryKey: [{ name: 'id' }] }} />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
