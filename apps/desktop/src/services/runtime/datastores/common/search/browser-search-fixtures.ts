import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export function searchClusterName(connection: ConnectionProfile) {
  return connection.database || (connection.engine === 'opensearch' ? 'opensearch-local' : 'elasticsearch-local')
}

export function searchIndices(connection: ConnectionProfile) {
  const lifecycle = connection.engine === 'opensearch' ? 'hot-warm-delete' : 'products-ilm'
  return [
    { name: 'products-v1', health: 'green', status: 'open', documents: 100000, primaryShards: 1, replicaShards: 1, storage: '420 MB', lifecycle },
    { name: 'orders-v1', health: 'green', status: 'open', documents: 482000, primaryShards: 3, replicaShards: 1, storage: '1.2 GB', lifecycle },
  ]
}

export function searchDataStreams() {
  return [
    { name: 'logs-generic-default', generation: 3, status: 'green', template: 'logs-template', backingIndices: '.ds-logs-generic-default-000001, .ds-logs-generic-default-000002', documents: 250000, storage: '276 MB' },
  ]
}

export function searchAliases() {
  return [
    { name: 'products-read', indices: 'products-v1', writeIndex: false, routing: '-', filter: { term: { active: true } } },
    { name: 'orders-write', indices: 'orders-v1', writeIndex: true, routing: 'tenant_id', filter: '-' },
  ]
}

export function searchFields() {
  return [
    { path: 'sku', type: 'keyword', searchable: true, aggregatable: true, analyzer: '-', normalizer: 'lowercase' },
    { path: 'name', type: 'text', searchable: true, aggregatable: false, analyzer: 'standard', normalizer: '-' },
    { path: 'category', type: 'keyword', searchable: true, aggregatable: true, analyzer: '-', normalizer: '-' },
    { path: 'inventory.available', type: 'integer', searchable: true, aggregatable: true, analyzer: '-', normalizer: '-' },
    { path: 'updated_at', type: 'date', searchable: true, aggregatable: true, analyzer: '-', normalizer: '-' },
    { path: 'embedding', type: 'dense_vector', searchable: true, aggregatable: false, analyzer: '-', normalizer: '-' },
  ]
}

export function searchSettings(index: string) {
  return [
    { name: 'number_of_shards', value: index === 'orders-v1' ? 3 : 1, scope: 'index' },
    { name: 'number_of_replicas', value: 1, scope: 'index' },
    { name: 'refresh_interval', value: '1s', scope: 'index' },
    { name: 'lifecycle.name', value: 'products-ilm', scope: 'index' },
  ]
}

export function searchTemplates() {
  return [
    { name: 'products-template', type: 'index', patterns: 'products-*', priority: 100, components: 'common-settings, product-mappings', lifecycle: 'products-ilm' },
    { name: 'common-settings', type: 'component', patterns: '-', priority: '-', components: 'settings', lifecycle: '-' },
    { name: 'product-mappings', type: 'component', patterns: '-', priority: '-', components: 'mappings', lifecycle: '-' },
  ]
}

export function searchPipelines() {
  return [
    { name: 'normalize-products', description: 'Normalize product names and tags before indexing', processors: 3, onFailure: 'dead-letter-index', usedBy: 'products-template' },
    { name: 'enrich-orders', description: 'Attach account metadata to order documents', processors: 2, onFailure: '-', usedBy: 'orders-v1' },
  ]
}

export function searchNodes() {
  return [
    { name: 'node-a', roles: 'master,data_hot,ingest', heapUsed: '41%', diskUsed: '33%', cpu: '12%', status: 'online' },
    { name: 'node-b', roles: 'data_hot,ingest', heapUsed: '38%', diskUsed: '29%', cpu: '8%', status: 'online' },
    { name: 'node-c', roles: 'data_warm', heapUsed: '24%', diskUsed: '45%', cpu: '4%', status: 'online' },
  ]
}

export function searchShards() {
  return [
    { index: 'products-v1', shard: 0, primary: true, state: 'STARTED', node: 'node-a', documents: 100000, storage: '210 MB' },
    { index: 'products-v1', shard: 0, primary: false, state: 'STARTED', node: 'node-b', documents: 100000, storage: '210 MB' },
    { index: 'orders-v1', shard: 0, primary: true, state: 'STARTED', node: 'node-a', documents: 162000, storage: '410 MB' },
    { index: 'orders-v1', shard: 1, primary: true, state: 'STARTED', node: 'node-b', documents: 160000, storage: '405 MB' },
    { index: 'orders-v1', shard: 2, primary: true, state: 'STARTED', node: 'node-c', documents: 160000, storage: '385 MB' },
  ]
}

export function searchSegments() {
  return [
    { index: 'products-v1', shard: 0, segments: 8, deletedDocs: 3, memory: '12 MB' },
    { index: 'orders-v1', shard: 0, segments: 14, deletedDocs: 18, memory: '31 MB' },
  ]
}
