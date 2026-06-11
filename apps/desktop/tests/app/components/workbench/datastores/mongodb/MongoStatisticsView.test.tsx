import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getMongoObjectViewDescriptor } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoObjectViewDescriptors'
import { MongoStatisticsView } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoStatisticsView'

describe('MongoStatisticsView', () => {
  it('renders compact statistic cards and a readable metric table', () => {
    render(
      <MongoStatisticsView
        descriptor={getMongoObjectViewDescriptor('database-statistics')}
        payload={{
          result: {
            count: 100000,
            storageSize: 2048,
            avgObjSize: 128,
            capped: false,
            ignoredNested: { raw: true },
          },
        }}
      />,
    )

    expect(screen.getByText('Database Statistics')).toBeInTheDocument()
    expect(screen.getAllByText('Count').length).toBeGreaterThan(0)
    expect(screen.getAllByText('100000').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Storage Size').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2048').length).toBeGreaterThan(0)
    expect(screen.queryByText('Ignored Nested')).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })
})
