import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type {
  ConnectionProfile,
  EnvironmentProfile,
  OperationPlanResponse,
  QueryTabState,
} from '@datapadplusplus/shared-types'
import { describe, expect, it, vi } from 'vitest'
import { SearchObjectViewWorkspace } from '../../../../../../../src/app/components/workbench/datastores/common/search/SearchObjectViewWorkspace'

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
    expect(screen.getByRole('region', { name: 'Search cluster posture' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Field capabilities' })).toBeInTheDocument()
    expect(screen.getByText('sku')).toBeInTheDocument()
    expect(screen.getAllByText('dense_vector').length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: 'Shard health' })).toBeInTheDocument()
    expect(screen.getAllByText('node-a').length).toBeGreaterThan(0)
    expect(screen.getByRole('region', { name: 'Lucene segment posture' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Lifecycle status' })).toBeInTheDocument()
    expect(screen.getByText('products-ilm')).toBeInTheDocument()
    expect(screen.queryByText(/"_source"/)).not.toBeInTheDocument()
  })

  it('renders search ingestion and security views as purpose-built panels', () => {
    render(
      <SearchObjectViewWorkspace
        connection={searchConnection}
        environment={environment}
        tab={securityTab}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: 'Search Security object view' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Search security posture' })).toBeInTheDocument()
    expect(screen.getAllByText('search_writer').length).toBeGreaterThan(0)

    render(
      <SearchObjectViewWorkspace
        connection={searchConnection}
        environment={environment}
        tab={pipelineTab}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: 'Ingest Pipelines object view' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Search ingestion posture' })).toBeInTheDocument()
    expect(screen.getAllByText('normalize-products').length).toBeGreaterThan(0)
  })

  it('renders search diagnostic slow-log and allocation panels', () => {
    render(
      <SearchObjectViewWorkspace
        connection={searchConnection}
        environment={environment}
        tab={diagnosticsTab}
        onRefresh={vi.fn()}
        onOpenQuery={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: 'Search slow log posture' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Shard allocation posture' })).toBeInTheDocument()
    expect(screen.getByText('Slow Logs')).toBeInTheDocument()
    expect(screen.getByText('Allocation Decisions')).toBeInTheDocument()
    expect(screen.getAllByText('disk watermark nearing threshold').length).toBeGreaterThan(0)
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
      nodes: [
        { name: 'node-a', roles: 'master,data_hot,ingest', heapUsed: '41%', diskUsed: '33%', status: 'online' },
        { name: 'node-b', roles: 'data_hot,ingest', heapUsed: '38%', diskUsed: '29%', status: 'online' },
      ],
      segments: [
        { index: 'products-v1', shard: 0, segments: 8, deletedDocs: 3, memory: '12 MB' },
      ],
      indices: [
        { name: 'products-v1', health: 'green', status: 'open', documents: 100000, primaryShards: 1, replicaShards: 1, storage: '420 MB' },
      ],
    },
  },
} as QueryTabState

const securityTab = {
  ...indexTab,
  id: 'tab-search-security',
  title: 'Security',
  objectViewState: {
    ...indexTab.objectViewState!,
    nodeId: 'search:security',
    kind: 'security',
    label: 'Security',
    path: ['Security'],
    queryTemplate: undefined,
    payload: {
      engine: 'elasticsearch',
      objectView: 'security',
      users: [
        { name: 'app-search', realm: 'native', roles: 'search_writer', enabled: true },
      ],
      roles: [
        { name: 'search_writer', clusterPrivileges: 'monitor', indexPrivileges: 'read/write on products-*' },
      ],
      apiKeys: [
        { name: 'ingest-pipeline-key', owner: 'app-search', status: 'active' },
      ],
    },
  },
} as QueryTabState

const pipelineTab = {
  ...indexTab,
  id: 'tab-search-pipelines',
  title: 'Pipelines',
  objectViewState: {
    ...indexTab.objectViewState!,
    nodeId: 'search:pipelines',
    kind: 'pipelines',
    label: 'Pipelines',
    path: ['Pipelines'],
    queryTemplate: undefined,
    payload: {
      engine: 'elasticsearch',
      objectView: 'pipelines',
      pipelines: [
        { name: 'normalize-products', description: 'Normalize products', processors: 3, onFailure: 'dead-letter' },
      ],
      templates: [
        { name: 'products-template', type: 'index', patterns: 'products-*', priority: 100 },
      ],
    },
  },
} as QueryTabState

const diagnosticsTab = {
  ...indexTab,
  id: 'tab-search-diagnostics',
  title: 'Diagnostics',
  objectViewState: {
    ...indexTab.objectViewState!,
    nodeId: 'search:diagnostics',
    kind: 'diagnostics',
    label: 'Diagnostics',
    path: ['Diagnostics'],
    queryTemplate: undefined,
    payload: {
      engine: 'elasticsearch',
      objectView: 'diagnostics',
      slowLogs: [
        { index: 'products-v1', kind: 'query', level: 'warn', threshold: '200ms', observed: '18ms p95', source: 'index.search.slowlog.threshold.query.warn' },
      ],
      allocationDecisions: [
        { index: 'orders-v1', shard: '1r', node: 'node-b', decision: 'throttle', reason: 'disk watermark nearing threshold' },
      ],
      nodes: [
        { name: 'node-b', roles: 'data_hot,ingest', heapUsed: '38%', diskUsed: '29%', status: 'online' },
      ],
      shards: [
        { index: 'orders-v1', shard: 1, primary: false, state: 'STARTED', node: 'node-b', documents: 50000, storage: '180 MB' },
      ],
      statistics: [
        { name: 'Pending tasks', value: 1, unit: 'tasks', source: 'cluster.pending_tasks' },
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
