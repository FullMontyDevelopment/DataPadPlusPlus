import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ConnectionProfile,
  DataEditExecutionResponse,
  EnvironmentProfile,
  ExecutionResultEnvelope,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { resultEditQueryText } from '../../../../../src/app/result-edit-context'
import { ResultsView } from '../../../../../src/app/components/workbench/results/ResultsView'

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
        onResultRendered={vi.fn()}
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
        onResultRendered={vi.fn()}
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

  it('keeps PostgreSQL table results mounted while display timing finalizes', () => {
    const result: ExecutionResultEnvelope = {
      id: 'result-postgresql-stable',
      engine: 'postgresql',
      summary: '1 row returned from PostgreSQL.',
      defaultRenderer: 'table',
      rendererModes: ['table', 'json', 'raw'],
      payloads: [{
        renderer: 'table',
        columns: ['id', 'status'],
        rows: [['account-1', 'active']],
      }],
      notices: [],
      executedAt: '2026-01-01T00:00:00.000Z',
      durationMs: 14,
    }
    const capabilities = {
      canCancel: false,
      canExplain: false,
      defaultRowLimit: 200,
      editorLanguage: 'sql',
      supportsLiveMetadata: true,
    } as const
    const connection = connectionProfile({ family: 'sql', engine: 'postgresql' })
    const callbacks = {
      onLoadNextPage: vi.fn(),
      onResultRendered: vi.fn(),
      onSelectRenderer: vi.fn(),
    }
    const { rerender } = render(
      <ResultsView
        capabilities={capabilities}
        connection={connection}
        payload={result.payloads[0]}
        renderer="table"
        result={result}
        {...callbacks}
      />,
    )

    const grid = screen.getByRole('grid', { name: 'Table results grid' })
    const filter = screen.getByPlaceholderText('Find in results')
    fireEvent.change(filter, { target: { value: 'active' } })

    const finalizedResult: ExecutionResultEnvelope = JSON.parse(JSON.stringify({
      ...result,
      displayDurationMs: 18,
    }))
    rerender(
      <ResultsView
        capabilities={capabilities}
        connection={connection}
        payload={finalizedResult.payloads[0]}
        renderer="table"
        result={finalizedResult}
        {...callbacks}
      />,
    )

    expect(screen.getByRole('grid', { name: 'Table results grid' })).toBe(grid)
    expect(screen.getByPlaceholderText('Find in results')).toHaveValue('active')

    const nextResult = { ...finalizedResult, id: 'result-postgresql-next' }
    rerender(
      <ResultsView
        capabilities={capabilities}
        connection={connection}
        payload={nextResult.payloads[0]}
        renderer="table"
        result={nextResult}
        {...callbacks}
      />,
    )

    expect(screen.getByRole('grid', { name: 'Table results grid' })).not.toBe(grid)
    expect(screen.getByPlaceholderText('Find in results')).toHaveValue('')
  })

  it('replaces stale rows with the Oracle error code and connection action', () => {
    const result = tableResultEnvelope()
    const onEditConnection = vi.fn()
    const activeTab: QueryTabState = {
      ...sqlQueryTab(result),
      connectionId: 'conn-oracle',
      status: 'error',
      error: {
        code: 'ORA-00942',
        message: 'ORA-00942: table or view does not exist',
      },
    }

    render(
      <ResultsView
        activeTab={activeTab}
        capabilities={{
          canCancel: true,
          canExplain: true,
          defaultRowLimit: 500,
          editorLanguage: 'sql',
          supportsLiveMetadata: true,
        }}
        connection={connectionProfile({ family: 'sql', engine: 'oracle' })}
        payload={result.payloads[0]}
        renderer="table"
        result={result}
        onEditConnection={onEditConnection}
        onLoadNextPage={vi.fn()}
        onResultRendered={vi.fn()}
        onSelectRenderer={vi.fn()}
      />,
    )

    expect(screen.getByText('ORA-00942', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('ORA-00942: table or view does not exist')).toBeInTheDocument()
    expect(screen.queryByText('processing')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Connection' }))
    expect(onEditConnection).toHaveBeenCalledOnce()
  })

  it('acknowledges visible result rendering after the payload has painted', async () => {
    const result = resultEnvelope([{ _id: 'document-1', status: 'active' }], false)
    const onResultRendered = vi.fn()

    render(
      <ResultsView
        activeTab={queryTab(result, {
          executionId: 'execution-rendering',
          phase: 'rendering',
          startedAt: '2026-01-01T00:00:00.000Z',
        })}
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
        onLoadNextPage={vi.fn()}
        onResultRendered={onResultRendered}
        onSelectRenderer={vi.fn()}
      />,
    )

    expect(screen.getByText('document-1')).toBeInTheDocument()
    await waitFor(() => {
      expect(onResultRendered).toHaveBeenCalledWith(
        'tab-mongodb',
        'execution-rendering',
      )
    })
  })

  it('acknowledges result rendering even when no renderer payload is selected yet', async () => {
    const result = {
      ...resultEnvelope([{ _id: 'document-1', status: 'active' }], false),
      payloads: [],
    }
    const onResultRendered = vi.fn()

    render(
      <ResultsView
        activeTab={queryTab(result, {
          executionId: 'execution-without-payload',
          phase: 'rendering',
          startedAt: '2026-01-01T00:00:00.000Z',
        })}
        capabilities={{
          canCancel: false,
          canExplain: false,
          defaultRowLimit: 200,
          editorLanguage: 'mongodb',
          supportsLiveMetadata: true,
        }}
        connection={connectionProfile({ family: 'document', engine: 'mongodb' })}
        payload={undefined}
        renderer="document"
        result={result}
        onLoadNextPage={vi.fn()}
        onResultRendered={onResultRendered}
        onSelectRenderer={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(onResultRendered).toHaveBeenCalledWith(
        'tab-mongodb',
        'execution-without-payload',
      )
    })
  })

  it('keeps a pending render acknowledgment alive across equivalent rerenders', () => {
    const result = resultEnvelope([{ _id: 'document-1', status: 'active' }], false)
    const activeExecution = {
      executionId: 'execution-rerender',
      phase: 'rendering' as const,
      startedAt: '2026-01-01T00:00:00.000Z',
    }
    const onResultRendered = vi.fn()
    const callbacks = new Map<number, FrameRequestCallback>()
    let frameId = 0
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frameId += 1
        callbacks.set(frameId, callback)
        return frameId
      })
    const cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((id) => {
        callbacks.delete(id)
      })

    try {
      const props = {
        capabilities: {
          canCancel: false,
          canExplain: false,
          defaultRowLimit: 200,
          editorLanguage: 'mongodb' as const,
          supportsLiveMetadata: true,
        },
        connection: connectionProfile({ family: 'document', engine: 'mongodb' }),
        payload: result.payloads[0],
        renderer: 'document',
        result,
        onLoadNextPage: vi.fn(),
        onResultRendered,
        onSelectRenderer: vi.fn(),
      }
      const { rerender } = render(
        <ResultsView
          {...props}
          activeTab={queryTab(result, activeExecution)}
        />,
      )

      flushAnimationFrames(callbacks)
      expect(onResultRendered).not.toHaveBeenCalled()

      const clonedResult = {
        ...result,
        payloads: [...result.payloads],
      }

      rerender(
        <ResultsView
          {...props}
          payload={clonedResult.payloads[0]}
          result={clonedResult}
          activeTab={queryTab(clonedResult, activeExecution)}
        />,
      )

      expect(cancelAnimationFrameSpy).not.toHaveBeenCalled()
      flushAnimationFrames(callbacks)

      expect(onResultRendered).toHaveBeenCalledWith(
        'tab-mongodb',
        'execution-rerender',
      )
    } finally {
      requestAnimationFrameSpy.mockRestore()
      cancelAnimationFrameSpy.mockRestore()
    }
  })

  it('hydrates lazy document fields on expand and hides expand all in efficiency mode', async () => {
    const result = resultEnvelope([
      {
        _id: 'doc-1',
        sku: 'luna-lamp',
        inventory: {
          __datapadLazyNode: true,
          type: 'object',
          childCount: 2,
          path: ['inventory'],
          loaded: false,
        },
      },
    ], false)
    result.payloads[0] = {
      renderer: 'document',
      documents: result.payloads[0]?.renderer === 'document' ? result.payloads[0].documents : [],
      hydrationMode: 'lazy',
      database: 'catalog',
      collection: 'products',
    }
    const onFetchDocumentNodeChildren = vi.fn().mockResolvedValue({
      tabId: 'tab-mongodb',
      documentId: 'doc-1',
      path: ['inventory'],
      value: {
        reserved: 4,
        available: 18,
      },
      notices: [],
    })

    render(
      <ResultsView
        activeEnvironment={{ ...environmentProfile(), id: 'env-selected' }}
        activeTab={queryTab(result)}
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
        onFetchDocumentNodeChildren={onFetchDocumentNodeChildren}
        onLoadNextPage={vi.fn()}
        onResultRendered={vi.fn()}
        onSelectRenderer={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Expand All' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand doc-1' }))
    expect(screen.getByText('inventory')).toBeInTheDocument()
    expect(screen.getByText('{2 field(s)}')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand inventory' }))

    await waitFor(() => {
      expect(onFetchDocumentNodeChildren).toHaveBeenCalledWith(
        expect.objectContaining({
          tabId: 'tab-mongodb',
          connectionId: 'conn-mongodb',
          environmentId: 'env-dev',
          database: 'catalog',
          collection: 'products',
          documentId: 'doc-1',
          path: ['inventory'],
        }),
      )
    })
    expect(await screen.findByText('reserved')).toBeInTheDocument()
    expect(screen.getByText('available')).toBeInTheDocument()
  })

  it('keeps failed lazy nodes visible and retries deep nested paths', async () => {
    const result = resultEnvelope([
      {
        _id: 'doc-1',
        inventory: {
          __datapadLazyNode: true,
          type: 'object',
          childCount: 1,
          path: ['inventory'],
          loaded: false,
        },
      },
    ], false)
    result.payloads[0] = {
      renderer: 'document',
      documents: result.payloads[0]?.renderer === 'document' ? result.payloads[0].documents : [],
      hydrationMode: 'lazy',
      database: 'catalog',
      collection: 'products',
    }
    const onFetchDocumentNodeChildren = vi.fn()
      .mockRejectedValueOnce(new Error('The selected field no longer exists.'))
      .mockResolvedValueOnce({
        tabId: 'tab-mongodb',
        documentId: 'doc-1',
        path: ['inventory'],
        value: {
          warehouse: {
            __datapadLazyNode: true,
            type: 'object',
            childCount: 1,
            path: ['inventory', 'warehouse'],
            loaded: false,
          },
        },
        notices: [],
      })
      .mockResolvedValueOnce({
        tabId: 'tab-mongodb',
        documentId: 'doc-1',
        path: ['inventory', 'warehouse'],
        value: { bin: null },
        notices: [],
      })

    render(
      <ResultsView
        activeEnvironment={{ ...environmentProfile(), id: 'env-selected' }}
        activeTab={queryTab(result)}
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
        onFetchDocumentNodeChildren={onFetchDocumentNodeChildren}
        onLoadNextPage={vi.fn()}
        onResultRendered={vi.fn()}
        onSelectRenderer={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand doc-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand inventory' }))

    expect(await screen.findByLabelText('The selected field no longer exists.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry inventory' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Retry inventory' }))
    expect(await screen.findByText('warehouse')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Expand warehouse' }))
    expect(await screen.findByText('bin')).toBeInTheDocument()
    expect(onFetchDocumentNodeChildren).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: ['inventory', 'warehouse'] }),
    )
  })

  it('ignores lazy hydration responses after the result is replaced', async () => {
    const result = resultEnvelope([{
      _id: 'doc-1',
      inventory: {
        __datapadLazyNode: true,
        type: 'object',
        childCount: 1,
        path: ['inventory'],
        loaded: false,
      },
    }], false)
    result.payloads[0] = {
      renderer: 'document',
      documents: result.payloads[0]?.renderer === 'document' ? result.payloads[0].documents : [],
      hydrationMode: 'lazy',
      database: 'catalog',
      collection: 'products',
    }
    let resolveHydration: ((value: {
      tabId: string
      documentId: string
      path: string[]
      value: Record<string, unknown>
      notices: string[]
    }) => void) | undefined
    const onFetchDocumentNodeChildren = vi.fn(() => new Promise((resolve) => {
      resolveHydration = resolve
    }))
    const capabilities = {
      canCancel: false,
      canExplain: false,
      defaultRowLimit: 200,
      editorLanguage: 'mongodb',
      supportsLiveMetadata: true,
    }
    const replacement = resultEnvelope([{ _id: 'doc-2', status: 'fresh' }], false)
    const commonProps = {
      activeEnvironment: { ...environmentProfile(), id: 'env-selected' },
      capabilities,
      connection: connectionProfile({ family: 'document' as const, engine: 'mongodb' }),
      renderer: 'document' as const,
      onFetchDocumentNodeChildren,
      onLoadNextPage: vi.fn(),
      onResultRendered: vi.fn(),
      onSelectRenderer: vi.fn(),
    }

    const { rerender } = render(
      <ResultsView
        {...commonProps}
        activeTab={queryTab(result)}
        payload={result.payloads[0]}
        result={result}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Expand doc-1' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand inventory' }))
    await waitFor(() => expect(onFetchDocumentNodeChildren).toHaveBeenCalledOnce())

    rerender(
      <ResultsView
        {...commonProps}
        activeTab={queryTab(replacement)}
        payload={replacement.payloads[0]}
        result={replacement}
      />,
    )

    await act(async () => {
      resolveHydration?.({
        tabId: 'tab-mongodb',
        documentId: 'doc-1',
        path: ['inventory'],
        value: { staleChild: true },
        notices: [],
      })
    })

    expect(screen.getAllByText('doc-2')).not.toHaveLength(0)
    expect(screen.queryByText('staleChild')).not.toBeInTheDocument()
  })

  it('uses the last executed query as edit context after the editor text changes', async () => {
    const executeDataEdit = vi.fn(async (): Promise<DataEditExecutionResponse> => ({
      connectionId: 'conn-sqlserver',
      environmentId: 'env-dev',
      editKind: 'update-row',
      executionSupport: 'live',
      executed: true,
      plan: {
        operationId: 'sqlserver.data-edit.update-row',
        engine: 'sqlserver',
        summary: 'Updated row.',
        generatedRequest: 'update [dbo].[orders] set [status] = @P1 where [order_id] = @P2;',
        requestLanguage: 'sql',
        destructive: false,
        requiredPermissions: ['update table row'],
        warnings: [],
      },
      messages: ['Updated row.'],
      warnings: [],
    }))
    const result = tableResultEnvelope()
    const activeTab = {
      ...sqlQueryTab(result),
      queryText: 'select order_id, status from dbo.other_table',
      history: [
        {
          id: 'history-latest',
          queryText: 'select order_id, status from dbo.orders',
          executedAt: result.executedAt,
          status: 'success' as const,
        },
      ],
    }

    render(
      <ResultsView
        activeEnvironment={environmentProfile()}
        activeTab={activeTab}
        capabilities={{
          canCancel: false,
          canExplain: false,
          defaultRowLimit: 200,
          editorLanguage: 'sql',
          supportsLiveMetadata: true,
        }}
        connection={connectionProfile({ family: 'sql', engine: 'sqlserver' })}
        payload={result.payloads[0]}
        renderer="table"
        result={result}
        onExecuteDataEdit={executeDataEdit}
        onLoadNextPage={vi.fn()}
        onResultRendered={vi.fn()}
        onSelectRenderer={vi.fn()}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'processing' }))
    fireEvent.change(screen.getByLabelText('Edit status row 1'), {
      target: { value: 'fulfilled' },
    })
    fireEvent.blur(screen.getByLabelText('Edit status row 1'))

    await waitFor(() => {
      expect(executeDataEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          environmentId: 'env-dev',
          target: expect.objectContaining({
            schema: 'dbo',
            table: 'orders',
          }),
        }),
      )
    })
  })

  it('prefers matching execution history before falling back to current query text', () => {
    const result = tableResultEnvelope()
    const tab = sqlQueryTab(result)

    expect(
      resultEditQueryText(
        {
          ...tab,
          queryText: 'select * from dbo.current_text',
          history: [
            {
              id: 'history-newer',
              queryText: 'select * from dbo.unrelated',
              executedAt: '2026-01-01T00:00:02.000Z',
              status: 'success',
            },
            {
              id: 'history-match',
              queryText: 'select * from dbo.orders',
              executedAt: result.executedAt,
              status: 'success',
            },
          ],
        },
        result,
      ),
    ).toBe('select * from dbo.orders')

    expect(resultEditQueryText({ ...tab, history: [] }, result)).toBe(tab.queryText)
  })
})

function flushAnimationFrames(callbacks: Map<number, FrameRequestCallback>) {
  const pendingCallbacks = [...callbacks.values()]
  callbacks.clear()
  pendingCallbacks.forEach((callback) => callback(performance.now()))
}

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

function tableResultEnvelope(): ExecutionResultEnvelope {
  return {
    id: 'result-table',
    engine: 'sqlserver',
    summary: '1 row returned from SQL Server.',
    defaultRenderer: 'table',
    rendererModes: ['table', 'json', 'raw'],
    payloads: [
      {
        renderer: 'table',
        columns: ['order_id', 'status'],
        rows: [['101', 'processing']],
      },
    ],
    notices: [],
    executedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 12,
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

function queryTab(
  result: ExecutionResultEnvelope,
  activeExecution?: QueryTabState['activeExecution'],
): QueryTabState {
  return {
    id: 'tab-mongodb',
    title: 'Mongo query',
    tabKind: 'query',
    connectionId: 'conn-mongodb',
    environmentId: 'env-dev',
    family: 'document',
    language: 'mongodb',
    editorLabel: 'Mongo query',
    queryText: '{}',
    status: activeExecution ? 'running' : 'success',
    activeExecution,
    dirty: false,
    result,
    history: [],
  }
}

function sqlQueryTab(result: ExecutionResultEnvelope): QueryTabState {
  return {
    id: 'tab-sqlserver',
    title: 'SQL query',
    tabKind: 'query',
    connectionId: 'conn-sqlserver',
    environmentId: 'env-dev',
    family: 'sql',
    language: 'sql',
    editorLabel: 'SQL query',
    queryText: 'select order_id, status from dbo.orders',
    status: 'success',
    dirty: false,
    result,
    history: [],
  }
}

function environmentProfile(): EnvironmentProfile {
  return {
    id: 'env-dev',
    label: 'Development',
    risk: 'low',
    color: '#22c55e',
    variables: {},
    variableDefinitions: [],
    sensitiveKeys: [],
    safeMode: false,
    requiresConfirmation: false,
    exportable: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
