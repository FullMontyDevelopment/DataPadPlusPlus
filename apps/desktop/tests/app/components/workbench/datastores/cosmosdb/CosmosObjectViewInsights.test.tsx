import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CosmosObjectViewInsights } from '../../../../../../src/app/components/workbench/datastores/cosmosdb/CosmosObjectViewInsights'

describe('CosmosObjectViewInsights', () => {
  it('renders partition, RU, indexing, and distribution panels without raw payload text', () => {
    render(
      <CosmosObjectViewInsights
        kind="container"
        payload={{
          partitionKeys: [
            { path: '/tenantId', kind: 'Hash', hotPartitionRisk: 'low', guidance: 'Tenant-scoped queries route cleanly.' },
          ],
          throughput: [
            { scope: 'catalog.products', mode: 'autoscale', ruPerSecond: '4,000 max', throttles: 0 },
          ],
          diagnostics: [
            { signal: 'RU Consumption', value: '52%', status: 'healthy', guidance: 'Current workload fits configured RU/s.' },
            { signal: 'Throttled Requests', value: 0, status: 'healthy', guidance: 'No throttling.' },
            { signal: 'Server Latency', value: '9 ms', status: 'healthy', guidance: 'Within target.' },
          ],
          indexingPolicy: [
            { path: '/*', mode: 'consistent', kind: 'included', precision: -1 },
            { path: '/"_etag"/?', mode: 'consistent', kind: 'excluded', precision: '-' },
          ],
          regions: [
            { name: 'West Europe', role: 'write', priority: 0, status: 'online' },
            { name: 'North Europe', role: 'read', priority: 1, status: 'online' },
          ],
          consistency: [
            { setting: 'Default consistency', value: 'Session', guidance: 'Good default.' },
          ],
        }}
      />,
    )

    const partition = screen.getByRole('region', { name: 'Cosmos DB partition posture' })
    expect(within(partition).getAllByText('/tenantId').length).toBeGreaterThan(0)
    expect(partition).toHaveTextContent('Tenant-scoped queries route cleanly.')

    const ru = screen.getByRole('region', { name: 'Cosmos DB RU posture' })
    expect(within(ru).getByText('autoscale')).toBeInTheDocument()
    expect(within(ru).getByText('RU Consumption')).toBeInTheDocument()

    const indexing = screen.getByRole('region', { name: 'Cosmos DB indexing posture' })
    expect(within(indexing).getByText('/*')).toBeInTheDocument()
    expect(within(indexing).getByText('/"_etag"/?')).toBeInTheDocument()

    const distribution = screen.getByRole('region', { name: 'Cosmos DB global distribution' })
    expect(within(distribution).getByText('West Europe')).toBeInTheDocument()
    expect(within(distribution).getByText('Session')).toBeInTheDocument()
    expect(screen.queryByText(/Raw inspection payload/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/indexingPolicy/i)).not.toBeInTheDocument()
  })

  it('stays hidden for server-side script-only sections without insight data', () => {
    const { container } = render(<CosmosObjectViewInsights kind="stored-procedures" payload={{}} />)

    expect(container).toBeEmptyDOMElement()
  })
})
