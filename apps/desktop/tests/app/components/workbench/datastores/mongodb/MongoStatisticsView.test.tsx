import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { getMongoObjectViewDescriptor } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoObjectViewDescriptors'
import { MongoStatisticsView } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoStatisticsView'

describe('MongoStatisticsView', () => {
  it('normalizes nested statistics into a compact summary and one readable table', () => {
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

    expect(screen.getByRole('heading', { name: 'Statistics' })).toBeInTheDocument()
    expect(screen.getAllByText('Count').length).toBeGreaterThan(0)
    expect(screen.getAllByText('100,000').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Storage Size').length).toBeGreaterThan(0)
    expect(screen.getAllByText('2.0 KB').length).toBeGreaterThan(0)
    expect(screen.queryByText('Ignored Nested')).not.toBeInTheDocument()
    expect(screen.queryByText('Raw inspection payload')).not.toBeInTheDocument()
  })

  it('accepts browser-preview statistics at the top level', () => {
    render(
      <MongoStatisticsView
        descriptor={getMongoObjectViewDescriptor('collection-statistics')}
        payload={{
          database: 'catalog',
          collection: 'products',
          count: 42,
          storageSize: 1024,
        }}
      />,
    )

    expect(screen.getByText('catalog / products')).toBeInTheDocument()
    expect(screen.getAllByText('42').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1.0 KB').length).toBeGreaterThan(0)
  })
})
