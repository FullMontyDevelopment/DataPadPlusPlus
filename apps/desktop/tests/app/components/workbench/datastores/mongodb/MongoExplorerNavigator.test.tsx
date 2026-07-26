import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ConnectionProfile,
  ExplorerNode,
  ExplorerResponse,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { MongoExplorerNavigator } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoExplorerNavigator'

describe('MongoExplorerNavigator', () => {
  it('auto-expands the configured database, keeps system databases collapsed, and pages objects', async () => {
    const onLoadScope = vi.fn()
    render(
      <MongoExplorerNavigator
        connection={mongoConnection()}
        scopes={mongoScopes()}
        filter=""
        isScopeLoading={() => false}
        getScopeError={() => undefined}
        onLoadScope={onLoadScope}
        onSelectNode={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('Collections')).toBeInTheDocument())
    expect(screen.queryByText('admin')).not.toBeInTheDocument()
    expect(screen.queryByText('collections metadata')).not.toBeInTheDocument()
    expect(screen.getByText('Collections').closest('.mongo-explorer-node')).toHaveAttribute(
      'title',
      'Collections — collections metadata',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Expand Collections' }))

    expect(await screen.findByText('products')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }))
    expect(onLoadScope).toHaveBeenCalledWith(
      'collections:catalog',
      'mongodb-explorer-v1:catalog:1',
    )
  })

  it('collapses a selected configured database without clearing its selection', async () => {
    const onSelectNode = vi.fn()
    render(
      <MongoExplorerNavigator
        connection={mongoConnection()}
        scopes={mongoScopes()}
        filter=""
        selectedNodeId="database:catalog"
        isScopeLoading={() => false}
        getScopeError={() => undefined}
        onLoadScope={vi.fn()}
        onSelectNode={onSelectNode}
      />,
    )

    await waitFor(() => expect(screen.getByText('Collections')).toBeInTheDocument())
    const catalogButton = nodeButton('catalog')
    expect(catalogButton).toHaveAttribute('aria-current', 'true')

    fireEvent.click(catalogButton)

    expect(screen.queryByText('Collections')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand catalog' })).toBeInTheDocument()
    expect(catalogButton).toHaveAttribute('aria-current', 'true')
    expect(onSelectNode).not.toHaveBeenCalled()

    fireEvent.click(catalogButton)

    expect(screen.getByText('Collections')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Collapse catalog' })).toBeInTheDocument()
  })

  it('toggles a selected row once during a double click and preserves unselected double-click expansion', async () => {
    const { rerender } = render(
      <MongoExplorerNavigator
        connection={mongoConnection()}
        scopes={mongoScopes()}
        filter=""
        selectedNodeId="database:catalog"
        isScopeLoading={() => false}
        getScopeError={() => undefined}
        onLoadScope={vi.fn()}
        onSelectNode={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('Collections')).toBeInTheDocument())
    const catalogButton = nodeButton('catalog')
    fireEvent.click(catalogButton, { detail: 1 })
    fireEvent.click(catalogButton, { detail: 2 })
    fireEvent.doubleClick(catalogButton, { detail: 2 })

    expect(screen.queryByText('Collections')).not.toBeInTheDocument()

    rerender(
      <MongoExplorerNavigator
        connection={mongoConnection()}
        scopes={mongoScopes()}
        filter=""
        isScopeLoading={() => false}
        getScopeError={() => undefined}
        onLoadScope={vi.fn()}
        onSelectNode={vi.fn()}
      />,
    )
    fireEvent.doubleClick(nodeButton('catalog'))

    expect(screen.getByText('Collections')).toBeInTheDocument()
  })

  it('honors filtered collapse and restores normal expansion when search clears', async () => {
    const props = {
      connection: mongoConnection(),
      scopes: mongoScopes(),
      selectedNodeId: 'database:catalog',
      isScopeLoading: () => false,
      getScopeError: () => undefined,
      onLoadScope: vi.fn(),
      onSelectNode: vi.fn(),
    }
    const { rerender } = render(
      <MongoExplorerNavigator {...props} filter="" />,
    )

    await waitFor(() => expect(screen.getByText('Collections')).toBeInTheDocument())
    fireEvent.click(nodeButton('catalog'))
    expect(screen.queryByText('Collections')).not.toBeInTheDocument()

    rerender(<MongoExplorerNavigator {...props} filter="products" />)
    expect(screen.getByText('products')).toBeInTheDocument()

    fireEvent.click(nodeButton('catalog'))
    expect(screen.queryByText('products')).not.toBeInTheDocument()
    expect(nodeButton('catalog')).toHaveAttribute('aria-current', 'true')

    rerender(<MongoExplorerNavigator {...props} filter="product" />)
    expect(screen.getByText('products')).toBeInTheDocument()

    rerender(<MongoExplorerNavigator {...props} filter="" />)
    expect(screen.queryByText('Collections')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand catalog' })).toBeInTheDocument()
  })

  it('preserves ancestors while filtering loaded descendants', async () => {
    render(
      <MongoExplorerNavigator
        connection={mongoConnection()}
        scopes={mongoScopes()}
        filter="products"
        isScopeLoading={() => false}
        getScopeError={() => undefined}
        onLoadScope={vi.fn()}
        onSelectNode={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('catalog')).toBeInTheDocument())
    expect(screen.getByText('Databases')).toBeInTheDocument()
    expect(screen.getByText('products')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
  })
})

function nodeButton(label: string) {
  return screen.getByText(label).closest('button')!
}

function mongoScopes(): Record<string, ExplorerResponse> {
  return {
    __root__: response(undefined, [
      node('mongodb-databases', 'Databases', 'databases', 'databases'),
      node(
        'mongodb-system-databases',
        'System Databases',
        'system-databases',
        'system-databases',
      ),
    ]),
    databases: response('databases', [
      node('database:catalog', 'catalog', 'database', 'database:catalog'),
    ]),
    'system-databases': response('system-databases', [
      node('database:admin', 'admin', 'database', 'database:admin'),
    ]),
    'database:catalog': response('database:catalog', [
      node(
        'collections:catalog',
        'Collections',
        'collections',
        'collections:catalog',
      ),
      node('views:catalog', 'Views', 'views', 'views:catalog'),
    ]),
    'collections:catalog': {
      ...response('collections:catalog', [
        node(
          'collection:catalog:products',
          'products',
          'collection',
          'collection:catalog:products',
        ),
      ]),
      pageInfo: {
        returnedCount: 1,
        knownTotal: 2,
        hasMore: true,
        nextCursor: 'mongodb-explorer-v1:catalog:1',
      },
    },
  }
}

function response(scope: string | undefined, nodes: ExplorerNode[]): ExplorerResponse {
  return {
    connectionId: 'conn-mongo',
    environmentId: 'env-local',
    scope,
    summary: 'Preview MongoDB metadata',
    capabilities: {
      canCancel: true,
      canExplain: false,
      supportsLiveMetadata: true,
      editorLanguage: 'javascript',
      defaultRowLimit: 100,
    },
    nodes,
  }
}

function node(
  id: string,
  label: string,
  kind: string,
  scope?: string,
): ExplorerNode {
  return {
    id,
    label,
    kind,
    scope,
    family: 'document',
    detail: `${kind} metadata`,
    expandable: Boolean(scope),
  }
}

function mongoConnection(): ConnectionProfile {
  return {
    id: 'conn-mongo',
    name: 'MongoDB Atlas',
    engine: 'mongodb',
    family: 'document',
    host: 'localhost',
    port: 27017,
    database: 'catalog',
    environmentIds: ['env-local'],
    tags: [],
    favorite: false,
    readOnly: false,
    icon: 'mongodb',
    auth: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}
