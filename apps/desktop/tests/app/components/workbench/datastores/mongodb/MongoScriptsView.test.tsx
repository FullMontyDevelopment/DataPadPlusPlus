import { fireEvent, render, screen } from '@testing-library/react'
import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { getMongoObjectViewDescriptor } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoObjectViewDescriptors'
import { MongoScriptsView } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoScriptsView'

const descriptor = getMongoObjectViewDescriptor('scripts')

describe('MongoScriptsView', () => {
  it('renders script templates as launch cards and hides script text until requested', () => {
    render(
      <MongoScriptsView
        descriptor={descriptor}
        payload={{
          scripts: [{
            name: 'Find recent products',
            description: 'Open a read-only script template for product review.',
            tags: ['find', 'read-only'],
            script: 'db.products.find({ updatedAt: { $gte: ISODate("2026-01-01") } }).limit(20)',
          }],
        }}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByRole('list', { name: 'MongoDB script templates' })).toBeInTheDocument()
    expect(screen.getByText('Find recent products')).toBeInTheDocument()
    expect(screen.getByText('Open a read-only script template for product review.')).toBeInTheDocument()
    expect(screen.getByText('read-only')).toBeInTheDocument()
    expect(screen.queryByText(/db\.products\.find/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show script' }))
    expect(screen.getByText(/db\.products\.find/)).toBeInTheDocument()
  })

  it('infers labels for simple string scripts', () => {
    render(
      <MongoScriptsView
        descriptor={descriptor}
        payload={{ scripts: ['db.products.aggregate([{ $limit: 20 }])'] }}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByText('Aggregation Script')).toBeInTheDocument()
    expect(screen.getByText('Runs a read-only aggregation workflow from the MongoDB scripting view.')).toBeInTheDocument()
    expect(screen.getByText('aggregation')).toBeInTheDocument()
  })

  it('opens a scoped scripting query when a target is supplied', () => {
    const onOpenQuery = vi.fn()
    const queryTarget: ScopedQueryTarget = {
      kind: 'scripts',
      label: 'Scripts',
      path: ['catalog', 'Collections', 'products'],
      queryTemplate: 'db.products.find({}).limit(20)',
      preferredBuilder: 'mongo-aggregation',
    }

    render(
      <MongoScriptsView
        descriptor={descriptor}
        payload={{ scripts: [] }}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Scripting' }))
    expect(onOpenQuery).toHaveBeenCalledWith(queryTarget)
  })
})
