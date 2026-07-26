import { fireEvent, render, screen, within } from '@testing-library/react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerInspectResponse,
  ExplorerNode,
  ExplorerResponse,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { workbenchSliceForEngine } from '../../../../../../../src/app/components/workbench/datastores/registry'

describe('datastore-native Explorer workspace', () => {
  it('renders hierarchy, scoped inventory, and typed inspection without raw payload output', () => {
    const onInspectNode = vi.fn()
    const onLoadScope = vi.fn()
    const props = explorerProps(onInspectNode, onLoadScope)
    const ExplorerWorkspace = workbenchSliceForEngine('postgresql').explorer.Workspace
    const view = render(<ExplorerWorkspace {...props} />)

    expect(screen.getByText('User Schemas')).toBeInTheDocument()
    const publicNode = screen.getAllByRole('button', { name: /public/i })
      .find((button) => button.classList.contains('datastore-explorer-node'))!
    fireEvent.click(publicNode)

    expect(onInspectNode).toHaveBeenCalledWith(expect.objectContaining({ id: 'schema:public' }))
    expect(onLoadScope).not.toHaveBeenCalledWith('schema:public')
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Inventory' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /products/i })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand public' }))
    const treePanel = view.container.querySelector('.datastore-explorer-tree-panel')!
    expect(within(treePanel).getByText('products')).toBeInTheDocument()
    fireEvent.click(publicNode)

    expect(within(treePanel).queryByText('products')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(publicNode.closest('[role="treeitem"]')).toHaveAttribute('aria-selected', 'true')

    view.rerender(
      <ExplorerWorkspace
        {...props}
        inspection={inspection()}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Columns' })).toBeInTheDocument()
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
