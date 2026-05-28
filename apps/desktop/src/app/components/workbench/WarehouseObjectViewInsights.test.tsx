import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WarehouseObjectViewInsights } from './WarehouseObjectViewInsights'

describe('WarehouseObjectViewInsights', () => {
  it('renders cost, compute, storage, and access posture for warehouse metadata', () => {
    render(
      <WarehouseObjectViewInsights
        engine="bigquery"
        kind="table"
        payload={{
          bytesProcessed: '1.2 TB',
          estimatedCost: '$6.10',
          totalSlotMs: '42,000',
          jobs: [
            { id: 'job_1', status: 'DONE', duration: '4.2 s', bytesScanned: '1.2 TB' },
            { id: 'job_2', status: 'FAILED', duration: '1.1 s', bytesScanned: '12 MB' },
          ],
          diagnostics: [
            { signal: 'Broad Scan Risk', value: 'watch', status: 'watch' },
          ],
          warehouses: [
            { name: 'reservation-prod', state: 'active', queued: 1, running: 2 },
          ],
          tables: [
            { name: 'orders', rows: '12.4 M', size: '88 GB', partitioning: 'order_date', clustering: 'tenant_id' },
          ],
          columns: [
            { name: 'id', type: 'STRING' },
            { name: 'created_at', type: 'TIMESTAMP' },
          ],
          security: [
            { principal: 'analytics@example.com', role: 'reader', privilege: 'bigquery.tables.getData', effect: 'allow' },
          ],
        }}
      />,
    )

    const cost = screen.getByRole('region', { name: 'Warehouse cost posture' })
    expect(within(cost).getByText('BigQuery Cost')).toBeInTheDocument()
    expect(within(cost).getByText('1.2 TB')).toBeInTheDocument()
    expect(within(cost).getByText('$6.10')).toBeInTheDocument()

    const compute = screen.getByRole('region', { name: 'Warehouse compute posture' })
    expect(within(compute).getAllByText('reservation-prod').length).toBeGreaterThan(0)
    expect(within(compute).getByText('active')).toBeInTheDocument()

    const storage = screen.getByRole('region', { name: 'Warehouse storage posture' })
    expect(within(storage).getByText('orders')).toBeInTheDocument()
    expect(within(storage).getByText('12.4 M')).toBeInTheDocument()

    const access = screen.getByRole('region', { name: 'Warehouse access posture' })
    expect(within(access).getByText('analytics@example.com')).toBeInTheDocument()
    expect(within(access).getByText('bigquery.tables.getData')).toBeInTheDocument()
    expect(screen.queryByText(/Raw inspection payload/i)).not.toBeInTheDocument()
  })

  it('stays hidden for unsupported object kinds without posture data', () => {
    const { container } = render(<WarehouseObjectViewInsights engine="snowflake" kind="unknown" payload={{}} />)

    expect(container).toBeEmptyDOMElement()
  })
})
