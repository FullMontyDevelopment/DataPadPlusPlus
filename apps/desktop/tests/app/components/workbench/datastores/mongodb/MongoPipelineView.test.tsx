import { fireEvent, render, screen } from '@testing-library/react'
import type { ScopedQueryTarget } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { getMongoObjectViewDescriptor } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoObjectViewDescriptors'
import { MongoPipelineView } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoPipelineView'
import { mongoPipelineStageRows } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoPipelineView.helpers'

const descriptor = getMongoObjectViewDescriptor('pipeline')

describe('MongoPipelineView', () => {
  it('renders view pipeline stages with useful stage summaries', () => {
    render(
      <MongoPipelineView
        descriptor={descriptor}
        payload={{
          pipeline: [
            { $match: { active: true } },
            { $project: { sku: 1, name: 1 } },
          ],
        }}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByRole('group', { name: 'MongoDB view pipeline stages' })).toBeInTheDocument()
    expect(screen.getByText('$match')).toBeInTheDocument()
    expect(screen.getByText('Filters documents before later stages run.')).toBeInTheDocument()
    expect(screen.getByText('$project')).toBeInTheDocument()
    expect(screen.getByText('Shapes the fields returned by the view.')).toBeInTheDocument()
    expect(screen.queryByText(/^\[\s*\{\s*"\$match"/)).not.toBeInTheDocument()
  })

  it('opens a raw scoped results query from the pipeline view', () => {
    const onOpenQuery = vi.fn()
    const queryTarget: ScopedQueryTarget = {
      kind: 'pipeline',
      label: 'Pipeline',
      path: ['catalog', 'Views', 'active_products'],
      queryTemplate: '{ "database": "catalog", "collection": "active_products", "filter": {} }',
    }

    render(
      <MongoPipelineView
        descriptor={descriptor}
        payload={{ pipeline: [{ $match: { active: true } }] }}
        queryTarget={queryTarget}
        onOpenQuery={onOpenQuery}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Results Preview' }))
    expect(onOpenQuery).toHaveBeenCalledWith(queryTarget)
  })

  it('normalizes known and unknown pipeline stages consistently', () => {
    expect(mongoPipelineStageRows([
      { $limit: 10 },
      { $customStage: { mode: 'qa' } },
    ])).toEqual([
      expect.objectContaining({
        operator: '$limit',
        summary: 'Caps how many documents continue through the pipeline.',
        details: ['10'],
      }),
      expect.objectContaining({
        operator: '$customStage',
        summary: 'Runs a MongoDB aggregation stage.',
        details: ['1 setting(s)', 'mode'],
      }),
    ])
  })
})
