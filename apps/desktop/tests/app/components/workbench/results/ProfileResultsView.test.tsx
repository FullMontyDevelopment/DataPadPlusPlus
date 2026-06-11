import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResultPayloadView } from '../../../../../src/app/components/workbench/results/ResultPayloadView'

describe('ProfileResultsView', () => {
  it('renders profile payloads as stages instead of dumping JSON', () => {
    render(
      <ResultPayloadView
        payload={{
          renderer: 'profile',
          summary: 'Search profile',
          stages: [
            {
              name: 'query',
              durationMs: 12.4,
              rows: 42,
              details: {
                collector: 'SimpleTopScoreDocCollector',
                cacheHit: false,
              },
            },
            {
              name: 'fetch',
              durationMs: 3,
              details: {
                storedFields: 5,
              },
            },
          ],
        }}
      />,
    )

    expect(screen.getByRole('region', { name: 'Query profile' })).toBeInTheDocument()
    expect(screen.getByText('Search profile')).toBeInTheDocument()
    expect(screen.getByText('15.4 ms')).toBeInTheDocument()
    expect(screen.getByText('query')).toBeInTheDocument()
    expect(screen.getByText('fetch')).toBeInTheDocument()
    expect(screen.getByText('SimpleTopScoreDocCollector')).toBeInTheDocument()
    expect(screen.queryByText('"collector"')).not.toBeInTheDocument()
  })
})
