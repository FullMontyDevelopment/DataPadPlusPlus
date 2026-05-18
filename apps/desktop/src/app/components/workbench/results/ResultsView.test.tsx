import { fireEvent, render, screen } from '@testing-library/react'
import type { ConnectionProfile, ExecutionResultEnvelope } from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { ResultsView } from './ResultsView'

describe('ResultsView', () => {
  it('shows loaded document results without local page controls', () => {
    const documents = Array.from({ length: 25 }, (_item, index) => ({
      _id: `document-${index + 1}`,
      status: 'active',
    }))
    const onLoadNextPage = vi.fn()
    const result = resultEnvelope(documents, true)

    const { container } = render(
      <ResultsView
        capabilities={{
          canCancel: false,
          canExplain: false,
          defaultRowLimit: 200,
          editorLanguage: 'mongodb',
          supportsLiveMetadata: true,
        }}
        connection={connectionProfile({ family: 'document', engine: 'mongodb' })}
        payload={result.payloads[0]}
        renderer="document"
        result={result}
        onLoadNextPage={onLoadNextPage}
        onSelectRenderer={vi.fn()}
      />,
    )

    const footer = container.querySelector('.document-data-grid-footer')

    expect(footer).not.toBeNull()
    expect(container.querySelector('.panel-page-row')).toBeNull()
    expect(screen.queryByLabelText('Page size')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand All' })).toBeInTheDocument()
    expect(screen.getByText('25 document(s) loaded')).toBeInTheDocument()
    expect(screen.getByText('document-1')).toBeInTheDocument()
    expect(screen.getByText('document-21')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Load More' }))
    expect(onLoadNextPage).toHaveBeenCalledOnce()
  })

  it('does not locally paginate non-document table results', () => {
    const rows = Array.from({ length: 25 }, (_item, index) => [
      `account-${index + 1}`,
      index % 2 === 0 ? 'active' : 'inactive',
    ])
    const result: ExecutionResultEnvelope = {
      id: 'result-table',
      engine: 'postgresql',
      summary: '25 row(s) returned from PostgreSQL.',
      defaultRenderer: 'table',
      rendererModes: ['table', 'json', 'raw'],
      payloads: [
        {
          renderer: 'table',
          columns: ['id', 'status'],
          rows,
        },
      ],
      notices: [],
      executedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 14,
    }

    render(
      <ResultsView
        capabilities={{
          canCancel: false,
          canExplain: false,
          defaultRowLimit: 200,
          editorLanguage: 'sql',
          supportsLiveMetadata: true,
        }}
        connection={connectionProfile({ family: 'sql', engine: 'postgresql' })}
        payload={result.payloads[0]}
        renderer="table"
        result={result}
        onLoadNextPage={vi.fn()}
        onSelectRenderer={vi.fn()}
      />,
    )

    expect(screen.queryByLabelText('Page size')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'table' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'json' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'raw' })).toBeInTheDocument()
    expect(screen.queryByText('1-20 of 25')).not.toBeInTheDocument()
    expect(screen.getByText('account-1')).toBeInTheDocument()
    expect(screen.getByText('account-25')).toBeInTheDocument()
  })
})

function resultEnvelope(
  documents: Array<Record<string, unknown>>,
  hasMore = false,
): ExecutionResultEnvelope {
  return {
    id: 'result-documents',
    engine: 'mongodb',
    summary: `${documents.length} documents returned from MongoDB adapter preview.`,
    defaultRenderer: 'document',
    rendererModes: ['document', 'json', 'raw'],
    payloads: [
      {
        renderer: 'document',
        documents,
      },
    ],
    notices: [],
    executedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 12,
    pageInfo: {
      bufferedRows: documents.length,
      hasMore,
      nextCursor: hasMore ? 'next' : undefined,
      pageIndex: 0,
      pageSize: 20,
    },
  }
}

function connectionProfile({
  engine,
  family,
}: {
  engine: ConnectionProfile['engine']
  family: ConnectionProfile['family']
}): ConnectionProfile {
  return {
    id: `conn-${engine}`,
    name: engine,
    engine,
    family,
    host: 'localhost',
    port: undefined,
    database: undefined,
    connectionString: undefined,
    connectionMode: 'native',
    environmentIds: ['env-dev'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: engine,
    color: undefined,
    group: undefined,
    notes: undefined,
    auth: {
      username: undefined,
      secretRef: undefined,
      sslMode: undefined,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
