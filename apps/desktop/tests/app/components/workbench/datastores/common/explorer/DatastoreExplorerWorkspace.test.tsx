import { fireEvent, render, screen, within } from '@testing-library/react'
import { StrictMode } from 'react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerInspectResponse,
  ExplorerNode,
  ExplorerResponse,
  StructureRequest,
  StructureResponse,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { workbenchSliceForEngine } from '../../../../../../../src/app/components/workbench/datastores/registry'

describe('datastore-native Explorer workspace', () => {
  const request: StructureRequest = {
    connectionId: 'connection-postgres', environmentId: 'environment-local', mode: 'relationships',
  }
  const structure: StructureResponse = {
    connectionId: request.connectionId, environmentId: request.environmentId, engine: 'postgresql',
    summary: 'Relationships', groups: [], edges: [],
    nodes: [{ id: 'accounts', label: 'accounts', kind: 'table', family: 'sql', fields: [] }],
  }

  it.each(['missing', 'other connection', 'other environment', 'completion', 'scoped', 'unrelated loading'])(
    'loads relationships on first opening with %s metadata without requiring Refresh', (scenario) => {
      const onRefresh = vi.fn()
      const props = explorerProps(vi.fn(), vi.fn())
      const staleRequest = scenario === 'missing' ? undefined : {
        ...request,
        ...(scenario === 'other connection' || scenario === 'unrelated loading' ? { connectionId: 'other' } : {}),
        ...(scenario === 'other environment' ? { environmentId: 'other' } : {}),
        ...(scenario === 'completion' ? { mode: 'completion' as const } : {}),
        ...(scenario === 'scoped' ? { scope: 'schema:audit' } : {}),
      }
      const ExplorerWorkspace = workbenchSliceForEngine('postgresql').explorer.Workspace
      const relationshipMap = {
        request: staleRequest, structure: scenario === 'missing' ? undefined : { ...structure, nodes: [] },
        status: scenario === 'unrelated loading' ? 'loading' as const : 'ready' as const, onRefresh,
      }
      const view = render(<StrictMode><ExplorerWorkspace {...props} relationshipMap={relationshipMap} /></StrictMode>)
      expect(onRefresh).not.toHaveBeenCalled()
      fireEvent.click(screen.getByRole('button', { name: 'Relationship map' }))
      expect(onRefresh).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ mode: 'relationships', maxNodes: 320 }))
      expect(screen.getByRole('heading', { name: 'Loading relationships...' })).toBeInTheDocument()
      expect(screen.queryByText('No structure objects found')).not.toBeInTheDocument()
      view.rerender(<StrictMode><ExplorerWorkspace {...props} relationshipMap={{ ...relationshipMap }} /></StrictMode>)
      expect(onRefresh).toHaveBeenCalledOnce()
      view.rerender(<StrictMode><ExplorerWorkspace {...props} relationshipMap={{ request, structure, status: 'ready', onRefresh }} /></StrictMode>)
      expect(screen.getByRole('img', { name: 'SQL table relationship diagram' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Back to Explorer' }))
      fireEvent.click(screen.getByRole('button', { name: 'Relationship map' }))
      expect(onRefresh).toHaveBeenCalledOnce()
    },
  )

  it('waits for an in-flight relationship request and does not reload an empty successful result', () => {
    const props = explorerProps(vi.fn(), vi.fn())
    const onRefresh = vi.fn()
    const ExplorerWorkspace = workbenchSliceForEngine('postgresql').explorer.Workspace
    const view = render(<ExplorerWorkspace {...props} relationshipMap={{ request, status: 'loading', onRefresh }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Relationship map' }))
    expect(onRefresh).not.toHaveBeenCalled()
    expect(screen.getByTitle('Refresh relationship metadata')).toBeDisabled()
    view.rerender(<ExplorerWorkspace {...props} relationshipMap={{ request, structure: { ...structure, nodes: [] }, status: 'ready', onRefresh }} />)
    expect(screen.getByText('No structure objects found')).toBeInTheDocument()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('keeps a failed initial load retryable without an automatic retry loop', () => {
    const props = explorerProps(vi.fn(), vi.fn())
    const onRefresh = vi.fn()
    const ExplorerWorkspace = workbenchSliceForEngine('sqlite').explorer.Workspace
    const view = render(<ExplorerWorkspace {...props} relationshipMap={{ status: 'idle', onRefresh }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Relationship map' }))
    view.rerender(<ExplorerWorkspace {...props} relationshipMap={{ request, status: 'ready', error: 'Metadata unavailable', onRefresh }} />)
    expect(screen.getByText('Metadata unavailable')).toBeInTheDocument()
    expect(onRefresh).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByTitle('Refresh relationship metadata'))
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it('reloads on environment changes and never displays a late previous-environment response', () => {
    const props = explorerProps(vi.fn(), vi.fn())
    const onRefresh = vi.fn()
    const ExplorerWorkspace = workbenchSliceForEngine('postgresql').explorer.Workspace
    const relationshipMap = { request, structure, status: 'ready' as const, onRefresh }
    const view = render(<ExplorerWorkspace {...props} relationshipMap={relationshipMap} />)
    fireEvent.click(screen.getByRole('button', { name: 'Relationship map' }))
    expect(screen.getByRole('img', { name: 'SQL table relationship diagram' })).toBeInTheDocument()
    view.rerender(<ExplorerWorkspace {...props} environment={{ ...props.environment, id: 'other' }} relationshipMap={relationshipMap} />)
    expect(onRefresh).toHaveBeenCalledOnce()
    expect(screen.queryByRole('img', { name: 'SQL table relationship diagram' })).not.toBeInTheDocument()
    view.rerender(<ExplorerWorkspace {...props} environment={{ ...props.environment, id: 'other' }} relationshipMap={{ ...relationshipMap, request: { ...request, environmentId: 'other' } }} />)
    expect(screen.queryByText('accounts')).not.toBeInTheDocument()
    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('renders hierarchy, scoped inventory, and typed inspection without raw payload output', () => {
    const onInspectNode = vi.fn()
    const onLoadScope = vi.fn()
    const props = explorerProps(onInspectNode, onLoadScope)
    const ExplorerWorkspace = workbenchSliceForEngine('postgresql').explorer.Workspace
    const view = render(<ExplorerWorkspace {...props} />)

    expect(screen.getByText('User Schemas')).toBeInTheDocument()
    const treePanel = view.container.querySelector('.datastore-explorer-tree-panel')!
    const publicNode = screen.getAllByRole('button', { name: /public/i })
      .find((button) => button.classList.contains('datastore-explorer-node'))!
    fireEvent.click(publicNode)

    expect(onInspectNode).toHaveBeenCalledWith(expect.objectContaining({ id: 'schema:public' }))
    expect(onLoadScope).not.toHaveBeenCalledWith('schema:public')
    expect(screen.getByRole('region', { name: 'Selected object' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Objects' })).toBeInTheDocument()
    const inventory = view.container.querySelector('.datastore-explorer-inventory')!
    expect(within(inventory).getByRole('button', { name: /products/i })).toBeInTheDocument()
    expect(within(treePanel).getByText('products')).toBeInTheDocument()

    fireEvent.click(publicNode)

    expect(within(treePanel).queryByText('products')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Selected object' })).toBeInTheDocument()
    expect(publicNode.closest('[role="treeitem"]')).toHaveAttribute('aria-selected', 'true')

    view.rerender(
      <ExplorerWorkspace
        {...props}
        inspection={inspection()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Columns' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Properties' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByText('uuid')).toBeInTheDocument()
    expect(view.container.querySelector('pre')).toBeNull()
    expect(view.container.textContent).not.toContain('super-secret')
    expect(screen.queryByText('Metadata details')).not.toBeInTheDocument()
  })
})

function explorerProps(
  onInspectNode: ReturnType<typeof vi.fn>,
  onLoadScope: ReturnType<typeof vi.fn>,
) {
  return {
    connection: {
      id: 'connection-postgres',
      name: 'PostgreSQL Local',
      engine: 'postgresql',
      family: 'sql',
      database: 'catalog',
    } as ConnectionProfile,
    environment: {
      id: 'environment-local',
      label: 'Local',
      risk: 'low',
    } as EnvironmentProfile,
    status: 'ready' as const,
    scopes: {
      __root__: response(undefined, [
        node('schema:public', 'public', 'schema', 'schema:public', ['PostgreSQL Local', 'User Schemas']),
      ]),
      'schema:public': response('schema:public', [
        node('table:public.products', 'products', 'table', 'table:public.products', [
          'PostgreSQL Local',
          'User Schemas',
          'public',
          'Tables',
        ]),
      ]),
    },
    isScopeLoading: () => false,
    getScopeError: () => undefined,
    onLoadScope,
    onInspectNode,
    onOpenQuery: vi.fn(),
    onOpenObjectView: vi.fn(),
  }
}

function response(scope: string | undefined, nodes: ExplorerNode[]): ExplorerResponse {
  return {
    connectionId: 'connection-postgres',
    environmentId: 'environment-local',
    scope,
    summary: 'PostgreSQL metadata',
    capabilities: {
      canCancel: true,
      canExplain: true,
      supportsLiveMetadata: true,
      editorLanguage: 'sql',
      defaultRowLimit: 100,
    },
    nodes,
    pageInfo: {
      returnedCount: nodes.length,
      knownTotal: nodes.length,
      hasMore: false,
    },
  }
}

function node(
  id: string,
  label: string,
  kind: string,
  scope: string,
  path: string[],
): ExplorerNode {
  return {
    id,
    family: 'sql',
    label,
    kind,
    detail: `${label} ${kind}`,
    scope,
    path,
    expandable: true,
  }
}

function inspection(): ExplorerInspectResponse {
  return {
    nodeId: 'schema:public',
    summary: 'Schema details',
    payload: {
      owner: 'catalog_owner',
      credentials: 'super-secret',
      columns: [
        { name: 'id', dataType: 'uuid', nullable: false },
        { name: 'name', dataType: 'text', nullable: false },
      ],
    },
  }
}
