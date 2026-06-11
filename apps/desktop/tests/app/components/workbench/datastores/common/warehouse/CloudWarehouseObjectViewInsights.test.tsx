import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CloudWarehouseObjectViewInsights } from '../../../../../../../src/app/components/workbench/datastores/common/warehouse/CloudWarehouseObjectViewInsights'

describe('CloudWarehouseObjectViewInsights', () => {
  it('renders Snowflake query, warehouse, data-flow, and grant posture', () => {
    render(
      <CloudWarehouseObjectViewInsights
        engine="snowflake"
        kind="warehouse"
        payload={{
          creditsConsumed: '0.42',
          bytesScanned: '1.8 TB',
          queryHistory: [
            { queryId: 'sf-1', warehouse: 'ANALYTICS_XS', status: 'succeeded', duration: '1.8 s' },
            { queryId: 'sf-2', warehouse: 'LOAD_WH', status: 'failed', duration: '480 ms' },
          ],
          warehouseLoad: [
            { warehouse: 'ANALYTICS_XS', state: 'running', queued: 1, running: 4, credits: '0.24', load: '42%' },
          ],
          streams: [
            { name: 'orders_stream', table: 'orders', stale: 'no' },
          ],
          shares: [
            { name: 'ANALYTICS_SHARE', status: 'active' },
          ],
          security: [
            { principal: 'ANALYST_ROLE', role: 'reader', object: 'ANALYTICS' },
          ],
        }}
      />,
    )

    expect(within(screen.getByRole('region', { name: 'Snowflake query posture' })).getByText('Query History')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Snowflake warehouse posture' })).getByText('Warehouses')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Snowflake data flow posture' })).getByText('Data Flow')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'Grants posture' })).getByText('Grants')).toBeInTheDocument()
    expect(screen.queryByText(/Raw inspection payload/i)).not.toBeInTheDocument()
  })

  it('renders BigQuery jobs, reservations, storage, and IAM posture', () => {
    render(
      <CloudWarehouseObjectViewInsights
        engine="bigquery"
        kind="dataset"
        payload={{
          totalBytesProcessed: '1.2 TB',
          totalSlotMs: '84.2 K',
          estimatedCost: '$6.00',
          jobTimeline: [
            { jobId: 'bq-1', state: 'DONE', duration: '1.8 s' },
            { jobId: 'bq-2', state: 'FAILED', duration: '480 ms' },
          ],
          reservations: [
            { name: 'default-reservation', slots: 500, idleSlots: 120 },
          ],
          slotUsage: [
            { reservation: 'default-reservation', utilization: '76%' },
          ],
          tableStorage: [
            { table: 'orders', bytes: '88 GB', longTermBytes: '12 GB', partitions: 420 },
          ],
          iamBindings: [
            { principal: 'group:analytics@example.com', role: 'roles/bigquery.dataViewer', resource: 'analytics' },
          ],
        }}
      />,
    )

    expect(within(screen.getByRole('region', { name: 'BigQuery job posture' })).getByText('Jobs')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'BigQuery reservation posture' })).getByText('Slots')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'BigQuery storage posture' })).getByText('Storage')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'IAM posture' })).getByText('IAM')).toBeInTheDocument()
  })

  it('stays hidden for non-cloud warehouse engines', () => {
    const { container } = render(
      <CloudWarehouseObjectViewInsights
        engine="clickhouse"
        kind="table"
        payload={{ queryHistory: [{ queryId: 'ignored' }] }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
