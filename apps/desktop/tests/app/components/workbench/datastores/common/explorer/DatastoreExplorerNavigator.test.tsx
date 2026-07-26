import { fireEvent, render, screen } from '@testing-library/react'
import type {
  ConnectionProfile,
  ExplorerNode,
  ExplorerResponse,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { DatastoreExplorerNavigator } from '../../../../../../../src/app/components/workbench/datastores/common/explorer/DatastoreExplorerNavigator'
import { createDatastoreExplorerProvider } from '../../../../../../../src/app/components/workbench/datastores/common/explorer/DatastoreExplorerProvider'

const provider = createDatastoreExplorerProvider({
  engine: 'postgresql',
  family: 'sql',
  label: 'PostgreSQL',
})

describe('DatastoreExplorerNavigator', () => {
  it.each([false, true])(
    'collapses and re-expands a selected branch while retaining selection (compact: %s)',
    (compact) => {
      const onSelectNode = vi.fn()
      render(
        <Navigator
          compact={compact}
          selectedNodeId="databases"
          onSelectNode={onSelectNode}
        />,
      )

      expect(screen.getByText('catalog')).toBeInTheDocument()
      fireEvent.click(nodeButton('Databases'))

      expect(screen.queryByText('catalog')).not.toBeInTheDocument()
      expect(treeItem('Databases')).toHaveAttribute('aria-expanded', 'false')
      expect(treeItem('Databases')).toHaveAttribute('aria-selected', 'true')
      expect(onSelectNode).not.toHaveBeenCalled()

      fireEvent.click(nodeButton('Databases'))

      expect(screen.getByText('catalog')).toBeInTheDocument()
      expect(treeItem('Databases')).toHaveAttribute('aria-expanded', 'true')
      expect(treeItem('Databases')).toHaveAttribute('aria-selected', 'true')
    },
  )

  it('selects an unselected branch without changing its expansion', () => {
    const onSelectNode = vi.fn()
    render(<Navigator onSelectNode={onSelectNode} />)

    fireEvent.click(nodeButton('Databases'))

    expect(onSelectNode).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'databases' }),
    )
    expect(screen.getByText('catalog')).toBeInTheDocument()
    expect(treeItem('Databases')).toHaveAttribute('aria-expanded', 'true')
  })

  it('honors search-specific collapse and restores normal expansion after search', () => {
    const onSelectNode = vi.fn()
    const { rerender } = render(
      <Navigator selectedNodeId="databases" onSelectNode={onSelectNode} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Collapse Databases' }))
    expect(screen.queryByText('catalog')).not.toBeInTheDocument()

    rerender(
      <Navigator
        filter="products"
        selectedNodeId="databases"
        onSelectNode={onSelectNode}
      />,
    )
    expect(screen.getByText('products')).toBeInTheDocument()

    fireEvent.click(nodeButton('Databases'))
    expect(screen.queryByText('products')).not.toBeInTheDocument()
    expect(treeItem('Databases')).toHaveAttribute('aria-selected', 'true')

    rerender(
      <Navigator
        filter="product"
        selectedNodeId="databases"
        onSelectNode={onSelectNode}
      />,
    )
    expect(screen.getByText('products')).toBeInTheDocument()

    rerender(
      <Navigator selectedNodeId="databases" onSelectNode={onSelectNode} />,
    )
    expect(screen.queryByText('catalog')).not.toBeInTheDocument()
    expect(treeItem('Databases')).toHaveAttribute('aria-expanded', 'false')
  })
})

function Navigator({
  compact = false,
  filter = '',
  selectedNodeId,
  onSelectNode,
}: {
  compact?: boolean
  filter?: string
  selectedNodeId?: string
  onSelectNode(node: ExplorerNode): void
}) {
  return (
    <DatastoreExplorerNavigator
      provider={provider}
      connection={postgresConnection()}
      scopes={explorerScopes()}
      filter={filter}
      selectedNodeId={selectedNodeId}
      compact={compact}
      isScopeLoading={() => false}
      getScopeError={() => undefined}
      onLoadScope={vi.fn()}
      onSelectNode={onSelectNode}
    />
  )
}

function nodeButton(label: string) {
  return screen.getByText(label).closest('button')!
}

function treeItem(label: string) {
  return nodeButton(label).closest('[role="treeitem"]')!
}

function explorerScopes(): Record<string, ExplorerResponse> {
  return {
    __root__: response(undefined, [
      node('databases', 'Databases', 'databases', [], 'databases'),
    ]),
    databases: response('databases', [
      node('database:catalog', 'catalog', 'database', ['Databases'], 'database:catalog'),
    ]),
    'database:catalog': response('database:catalog', [
      node(
        'table:catalog:products',
        'products',
        'table',
        ['Databases', 'catalog'],
      ),
    ]),
  }
}

function response(
  scope: string | undefined,
  nodes: ExplorerNode[],
): ExplorerResponse {
  return {
    connectionId: 'conn-postgres',
    environmentId: 'env-local',
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
  }
}

function node(
  id: string,
  label: string,
  kind: string,
  path: string[],
  scope?: string,
): ExplorerNode {
  return {
    id,
    label,
    kind,
    path,
    scope,
    family: 'sql',
    detail: `${kind} metadata`,
    expandable: Boolean(scope),
  }
}

function postgresConnection(): ConnectionProfile {
  return {
    id: 'conn-postgres',
    name: 'PostgreSQL',
    engine: 'postgresql',
    family: 'sql',
    host: 'localhost',
    port: 5432,
    database: 'catalog',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'postgresql',
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
