import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanResponse,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { SearchObjectViewWorkspace } from './SearchObjectViewWorkspace'

describe('SearchObjectViewWorkspace', () => {
  it('renders Elasticsearch index views with native field, shard, and lifecycle panels', () => {
    render(
      <SearchObjectViewWorkspace
        connection={searchConnection}
        environment={environment}
        tab={indexTab}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: 'Search Index object view' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Field capabilities' })).toBeInTheDocument()
    expect(screen.getByText('sku')).toBeInTheDocument()
    expect(screen.getAllByText('dense_vector').length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: 'Shard health' })).toBeInTheDocument()
    expect(screen.getAllByText('node-a').length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: 'Lifecycle status' })).toBeInTheDocument()
    expect(screen.getByText('products-ilm')).toBeInTheDocument()
    expect(screen.queryByText(/"_source"/)).not.toBeInTheDocument()
  })

  it('plans native search mapping, settings, alias, and lifecycle operations from the index view', async () => {
    const onPlanOperation = vi.fn(async (): Promise<OperationPlanResponse> => operationPlanResponse)

    render(
      <SearchObjectViewWorkspace
        connection={searchConnection}
        environment={environment}
        tab={indexTab}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
        onPlanOperation={onPlanOperation}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Update Mapping' }))
    await waitFor(() => expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'elasticsearch.index.put-mapping',
      objectName: 'products-v1',
      parameters: expect.objectContaining({
        mappings: expect.objectContaining({
          properties: expect.objectContaining({
            new_field: { type: 'keyword' },
          }),
        }),
      }),
    })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Update Settings' })).not.toBeDisabled())

    fireEvent.click(screen.getByRole('button', { name: 'Update Settings' }))
    await waitFor(() => expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'elasticsearch.index.update-settings',
      objectName: 'products-v1',
    })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add Alias' })).not.toBeDisabled())

    fireEvent.click(screen.getByRole('button', { name: 'Add Alias' }))
    await waitFor(() => expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'elasticsearch.alias.put',
      parameters: expect.objectContaining({
        alias: 'products-v1-read',
      }),
    })))
    await waitFor(() => expect(screen.getByTitle('Review lifecycle or state-management status')).not.toBeDisabled())

    fireEvent.click(screen.getByTitle('Review lifecycle or state-management status'))
    await waitFor(() => expect(onPlanOperation).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'elasticsearch.lifecycle.explain',
      objectName: 'products-v1',
    })))
  })
})

const searchConnection: ConnectionProfile = {
  id: 'conn-search',
  name: 'Elasticsearch',
  engine: 'elasticsearch',
  family: 'search',
  host: 'localhost',
  port: 9200,
  database: 'elasticsearch-local',
  connectionString: undefined,
  connectionMode: 'native',
  environmentIds: ['env-local'],
  tags: [],
  favorite: false,
  readOnly: false,
  icon: 'elasticsearch',
  auth: {},
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const environment: EnvironmentProfile = {
  id: 'env-local',
  label: 'Local',
  risk: 'low',
  color: '#24d3a6',
  variables: {},
  sensitiveKeys: [],
  variableDefinitions: [],
  requiresConfirmation: false,
  safeMode: false,
  exportable: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const indexTab = {
  id: 'tab-search-index',
  title: 'products-v1',
  tabKind: 'object-view',
  connectionId: searchConnection.id,
  environmentId: environment.id,
  family: 'search',
  language: 'json',
  editorLabel: 'Elasticsearch / Local',
  queryText: '',
  result: undefined,
  history: [],
  status: 'idle',
  dirty: false,
  objectViewState: {
    connectionId: searchConnection.id,
    environmentId: environment.id,
    nodeId: 'index:products-v1',
    kind: 'index',
    label: 'products-v1',
    path: ['Indices', 'products-v1'],
    queryTemplate: '{ "index": "products-v1", "body": { "query": { "match_all": {} }, "size": 20 } }',
    warnings: [],
    payload: {
      engine: 'elasticsearch',
      clusterName: 'elasticsearch-local',
      objectView: 'index',
      index: 'products-v1',
      objectName: 'products-v1',
      documentCount: 100000,
      storage: '420 MB',
      fields: [
        { path: 'sku', type: 'keyword', searchable: true, aggregatable: true },
        { path: 'name', type: 'text', searchable: true, aggregatable: false },
        { path: 'embedding', type: 'dense_vector', searchable: true, aggregatable: false },
      ],
      shards: [
        { index: 'products-v1', shard: 0, primary: true, state: 'STARTED', node: 'node-a', documents: 100000, storage: '210 MB' },
        { index: 'products-v1', shard: 0, primary: false, state: 'STARTED', node: 'node-b', documents: 100000, storage: '210 MB' },
      ],
      lifecyclePolicies: [
        { name: 'products-ilm', type: 'ILM', phase: 'hot', managedIndices: 1, status: 'active' },
      ],
      indices: [
        { name: 'products-v1', health: 'green', status: 'open', documents: 100000, primaryShards: 1, replicaShards: 1, storage: '420 MB' },
      ],
    },
  },
} as QueryTabState

const operationPlanResponse: OperationPlanResponse = {
  connectionId: searchConnection.id,
  environmentId: environment.id,
  plan: {
    operationId: 'elasticsearch.index.put-mapping',
    engine: 'elasticsearch',
    summary: 'Preview operation plan prepared for Elasticsearch.',
    generatedRequest: '{}',
    requestLanguage: 'json',
    destructive: false,
    estimatedCost: 'No material cost expected in preview mode.',
    estimatedScanImpact: 'Metadata/read preview only.',
    requiredPermissions: ['read metadata/query privilege'],
    warnings: ['Preview mode generates guarded operation plans without mutating the datastore.'],
  },
}
