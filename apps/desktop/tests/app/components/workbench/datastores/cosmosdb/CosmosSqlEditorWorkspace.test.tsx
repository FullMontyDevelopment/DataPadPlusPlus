import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CosmosSqlEditorWorkspace } from '../../../../../../src/app/components/workbench/datastores/cosmosdb/CosmosSqlEditorWorkspace'

describe('CosmosSqlEditorWorkspace', () => {
  it('renders SQL rather than a transport envelope and edits typed parameters', () => {
    const onEditorStateChange = vi.fn()
    render(
      <CosmosSqlEditorWorkspace
        tab={{
          id: 'tab-cosmos',
          title: 'orders.sql',
          connectionId: 'conn-cosmos',
          environmentId: 'env-local',
          family: 'document',
          language: 'sql',
          editorLabel: 'Cosmos SQL',
          queryText: 'legacy envelope',
          scopedTarget: {
            kind: 'container',
            label: 'orders',
            path: ['catalog', 'orders'],
          },
          status: 'idle',
          dirty: false,
          history: [],
        }}
        connection={{
          id: 'conn-cosmos',
          name: 'Cosmos',
          engine: 'cosmosdb',
          family: 'document',
          host: 'https://localhost',
          database: 'catalog',
          environmentIds: ['env-local'],
          tags: [],
          favorite: false,
          readOnly: false,
          icon: 'cosmosdb',
          auth: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }}
        editorState={{
          kind: 'cosmos-sql',
          sql: 'SELECT * FROM c WHERE c.status = @status',
          parameters: [{
            id: 'status',
            name: '@status',
            valueType: 'string',
            value: 'open',
          }],
          source: 'custom',
        }}
        value={'{"operation":"QueryDocuments"}'}
        theme="vs-dark"
        completionProviders={[]}
        onEditorStateChange={onEditorStateChange}
      />,
    )

    expect(screen.getByLabelText('Cosmos DB SQL query editor')).toHaveValue(
      'SELECT * FROM c WHERE c.status = @status',
    )
    expect(screen.queryByDisplayValue('{"operation":"QueryDocuments"}')).not.toBeInTheDocument()
    expect(screen.queryByText('Query parameter @status does not have a binding.')).not.toBeInTheDocument()

    const removeParameter = screen.getByRole('button', { name: 'Remove @status' })
    expect(removeParameter).toHaveClass('query-builder-icon-button')
    expect(removeParameter).toHaveAttribute('title', 'Remove @status')
    expect(removeParameter).toHaveTextContent('')
    fireEvent.click(removeParameter)
    expect(onEditorStateChange).toHaveBeenCalledWith(expect.objectContaining({ parameters: [] }))
    onEditorStateChange.mockClear()

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(onEditorStateChange).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'cosmos-sql',
      parameters: expect.arrayContaining([
        expect.objectContaining({ name: '@parameter', valueType: 'string' }),
      ]),
    }))
  })

  it('collapses and restores the Parameters and Routing panel', () => {
    render(
      <CosmosSqlEditorWorkspace
        tab={{
          id: 'tab-cosmos',
          title: 'orders.sql',
          connectionId: 'conn-cosmos',
          environmentId: 'env-local',
          family: 'document',
          language: 'sql',
          editorLabel: 'Cosmos SQL',
          queryText: 'SELECT * FROM c',
          scopedTarget: { kind: 'container', label: 'orders', path: ['catalog', 'orders'] },
          status: 'idle',
          dirty: false,
          history: [],
        }}
        connection={{
          id: 'conn-cosmos',
          name: 'Cosmos',
          engine: 'cosmosdb',
          family: 'document',
          host: 'https://localhost',
          database: 'catalog',
          environmentIds: ['env-local'],
          tags: [],
          favorite: false,
          readOnly: false,
          icon: 'cosmosdb',
          auth: {},
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        }}
        editorState={{
          kind: 'cosmos-sql',
          sql: 'SELECT * FROM c',
          parameters: [],
          source: 'default',
        }}
        value="SELECT * FROM c"
        theme="vs-dark"
        completionProviders={[]}
        onEditorStateChange={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse parameters and routing' }))
    expect(screen.queryByRole('complementary', { name: 'Parameters and routing' }))
      .not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open parameters and routing' }))
    expect(screen.getByRole('complementary', { name: 'Parameters and routing' }))
      .toBeInTheDocument()
  })
})
