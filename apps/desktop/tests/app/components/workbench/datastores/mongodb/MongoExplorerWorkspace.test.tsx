import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerInspectResponse,
  ExplorerNode,
  ExplorerResponse,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { MongoExplorerWorkspace } from '../../../../../../src/app/components/workbench/datastores/mongodb/MongoExplorerWorkspace'

describe('MongoExplorerWorkspace', () => {
  it('renders structural groups from the scope cache without requesting inspection', async () => {
    const onInspectNode = vi.fn()
    const view = renderWorkspace({ onInspectNode })

    fireEvent.click(await screen.findByText('Collections'))

    expect(onInspectNode).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Collections', level: 2 })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Selected MongoDB object' })).toHaveClass(
      'mongo-explorer-context-card',
    )
    expect(
      screen
        .getByRole('heading', { name: 'Collections', level: 3 })
        .closest('.mongo-explorer-detail-section'),
    ).not.toBeNull()
    expect(screen.getByText('Loaded').nextSibling).toHaveTextContent('1')
    expect(screen.getByRole('button', { name: /products/i })).toBeInTheDocument()
    expect(view.container.querySelector('pre')).toBeNull()
    expect(screen.queryByText('Metadata details')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Expand Collections' }))
    const treePanel = view.container.querySelector('.mongo-explorer-tree-panel')!
    expect(within(treePanel).getByText('products')).toBeInTheDocument()
    fireEvent.click(
      within(treePanel).getByText('Collections').closest('.mongo-explorer-node')!,
    )

    expect(within(treePanel).queryByText('products')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Collections', level: 2 })).toBeInTheDocument()
    expect(
      within(treePanel).getByText('Collections').closest('.mongo-explorer-node'),
    ).toHaveAttribute('aria-current', 'true')
  })

  it('renders collection inspection as metrics, tables, and typed document fields', async () => {
    const onInspectNode = vi.fn()
    const view = renderWorkspace({ onInspectNode })

    fireEvent.click(await screen.findByText('Collections'))
    fireEvent.click(screen.getByRole('button', { name: /products/i }))
    expect(onInspectNode).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'collection:catalog:products' }),
    )

    view.rerender(workspace(collectionInspection(), onInspectNode))

    expect(screen.getByRole('heading', { name: 'Sampled fields' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Indexes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Validation' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sample documents' })).toBeInTheDocument()
    expect(screen.getAllByText('ObjectId')).not.toHaveLength(0)
    expect(screen.getByText('64f1e7a35b6f5e1c2a917001')).toBeInTheDocument()
    expect(view.container.querySelector('pre')).toBeNull()
    expect(view.container.textContent).not.toContain('{"nodeId"')
  })

  it('keeps launch nodes purposeful and does not inspect them', async () => {
    const onInspectNode = vi.fn()
    const scopes = mongoScopes()
    scopes['collection:catalog:products'] = response('collection:catalog:products', [
      node(
        'documents:catalog:products',
        'Documents',
        'documents',
        'collection:catalog:products',
      ),
    ])
    const view = render(
      workspace(undefined, onInspectNode, scopes),
    )

    fireEvent.click(await screen.findByText('Collections'))
    fireEvent.click(screen.getByRole('button', { name: /products/i }))
    await waitFor(() => expect(onInspectNode).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Expand Collections' }))
    fireEvent.click(screen.getByRole('button', { name: 'Expand products' }))
    fireEvent.click(await screen.findByText('Documents'))

    expect(onInspectNode).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('heading', { name: 'Browse collection documents' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open documents' })).toBeInTheDocument()
    expect(view.container.querySelector('pre')).toBeNull()
  })
})

function renderWorkspace({ onInspectNode }: { onInspectNode: ReturnType<typeof vi.fn> }) {
  return render(workspace(undefined, onInspectNode))
}

function workspace(
  inspection: ExplorerInspectResponse | undefined,
  onInspectNode: ReturnType<typeof vi.fn>,
  scopes = mongoScopes(),
) {
  return (
    <MongoExplorerWorkspace
      connection={mongoConnection()}
      environment={mongoEnvironment()}
      status="ready"
      inspection={inspection}
      scopes={scopes}
      isScopeLoading={() => false}
      getScopeError={() => undefined}
      onLoadScope={vi.fn()}
      onInspectNode={onInspectNode}
      onOpenQuery={vi.fn()}
      onOpenObjectView={vi.fn()}
    />
  )
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
    'database:catalog': response('database:catalog', [
      node('catalog:collections', 'Collections', 'collections', 'collections:catalog'),
      node('catalog:views', 'Views', 'views', 'views:catalog'),
    ]),
    'collections:catalog': response('collections:catalog', [
      node(
        'collection:catalog:products',
        'products',
        'collection',
        'collection:catalog:products',
      ),
    ]),
  }
}

function collectionInspection(): ExplorerInspectResponse {
  return {
    nodeId: 'collection:catalog:products',
    summary: 'Inspection ready for catalog.products.',
    payload: {
      database: 'catalog',
      collection: 'products',
      indexes: [
        { name: '_id_', key: { _id: 1 }, unique: true },
        { name: 'sku_1', key: { sku: 1 } },
      ],
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['sku'],
        },
      },
      statistics: {
        count: 12,
        storageSize: 4096,
      },
      sampleDocuments: [
        {
          _id: { $oid: '64f1e7a35b6f5e1c2a917001' },
          sku: 'luna-lamp',
          inventory: { available: 18 },
        },
      ],
    },
  }
}

function response(scope: string | undefined, nodes: ExplorerNode[]): ExplorerResponse {
  return {
    connectionId: 'conn-mongo',
    environmentId: 'env-local',
    scope,
    summary: 'MongoDB metadata',
    capabilities: {
      canCancel: true,
      canExplain: false,
      supportsLiveMetadata: true,
      editorLanguage: 'javascript',
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

function node(id: string, label: string, kind: string, scope?: string): ExplorerNode {
  return {
    id,
    label,
    kind,
    scope,
    family: 'document',
    detail: `${kind} metadata`,
    expandable: Boolean(scope),
    path: id.includes('catalog') ? ['catalog'] : undefined,
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

function mongoEnvironment(): EnvironmentProfile {
  return {
    id: 'env-local',
    name: 'local',
    label: 'Local',
    color: '#2f81f7',
    readOnly: false,
    safeMode: true,
    variables: [],
  }
}
