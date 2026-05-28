import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DynamoObjectViewInsights } from './DynamoObjectViewInsights'

describe('DynamoObjectViewInsights', () => {
  it('renders key design, capacity, table features, and index coverage without raw payload dumps', () => {
    render(
      <DynamoObjectViewInsights
        kind="table"
        payload={{
          keys: [
            { attribute: 'pk', type: 'HASH', keyRole: 'partition', attributeType: 'S' },
            { attribute: 'sk', type: 'RANGE', keyRole: 'sort', attributeType: 'S' },
          ],
          globalSecondaryIndexes: [
            { name: 'customer-status-index', partitionKey: 'customerId', sortKey: 'status', projection: 'INCLUDE total', status: 'ACTIVE' },
          ],
          localSecondaryIndexes: [
            { name: 'createdAt-lsi', sortKey: 'createdAt', projection: 'KEYS_ONLY' },
          ],
          capacity: [
            { resource: 'Orders', readUnits: 84, writeUnits: 31, readThrottleEvents: 2, writeThrottleEvents: 0 },
          ],
          hotPartitions: [
            { partitionKey: 'CUSTOMER#123', readPercent: '18%', writePercent: '9%', throttles: 2, recommendation: 'Review access pattern.' },
          ],
          streams: [
            { status: 'ENABLED', viewType: 'NEW_AND_OLD_IMAGES', consumers: 1 },
          ],
          ttl: [
            { attribute: 'expiresAt', status: 'ENABLED', sampleExpiringItems: 1240 },
          ],
          backups: [
            { name: 'Orders-nightly', status: 'AVAILABLE', type: 'on-demand' },
          ],
        }}
      />,
    )

    const keyDesign = screen.getByRole('region', { name: 'DynamoDB key design' })
    expect(within(keyDesign).getByText('pk')).toBeInTheDocument()
    expect(within(keyDesign).getByText('partition')).toBeInTheDocument()

    const capacity = screen.getByRole('region', { name: 'DynamoDB capacity posture' })
    expect(within(capacity).getByText('CUSTOMER#123')).toBeInTheDocument()
    expect(within(capacity).getByText('Review access pattern.')).toBeInTheDocument()

    const features = screen.getByRole('region', { name: 'DynamoDB table features' })
    expect(within(features).getAllByText('expiresAt').length).toBeGreaterThan(0)
    expect(within(features).getByText('NEW_AND_OLD_IMAGES')).toBeInTheDocument()
    expect(within(features).getByText('Orders-nightly')).toBeInTheDocument()

    const coverage = screen.getByRole('region', { name: 'DynamoDB index coverage' })
    expect(within(coverage).getByText('customer-status-index')).toBeInTheDocument()
    expect(within(coverage).getByText('GSI')).toBeInTheDocument()
    expect(within(coverage).getByText('LSI')).toBeInTheDocument()
    expect(screen.queryByText(/Raw inspection payload/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/globalSecondaryIndexes/i)).not.toBeInTheDocument()
  })

  it('does not render insight panels for unrelated object kinds', () => {
    const { container } = render(
      <DynamoObjectViewInsights
        kind="permissions"
        payload={{
          keys: [{ attribute: 'pk', type: 'HASH' }],
        }}
      />,
    )

    expect(container).toBeEmptyDOMElement()
  })
})
