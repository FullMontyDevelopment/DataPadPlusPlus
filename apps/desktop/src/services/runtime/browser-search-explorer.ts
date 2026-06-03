import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import {
  searchAliases,
  searchDataStreams,
  searchIndices,
  searchPipelines,
  searchTemplates,
} from './browser-search-fixtures'

export function createSearchExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const engineLabel = connection.engine === 'opensearch' ? 'OpenSearch' : 'Elasticsearch'

  if (!scope) {
    return [
      searchNode(connection, 'search:cluster', 'Cluster', 'cluster', `${engineLabel} health, nodes, and allocation`, 'search:cluster', [], true),
      searchNode(connection, 'search:indices', 'Indices', 'indices', 'Searchable indices and lifecycle state', 'search:indices', [], true),
      searchNode(connection, 'search:data-streams', 'Data Streams', 'data-streams', 'Append-oriented data streams', 'search:data-streams', [], true),
      searchNode(connection, 'search:aliases', 'Aliases', 'aliases', 'Read/write aliases and routing', 'search:aliases', [], true),
      searchNode(connection, 'search:templates', 'Templates', 'templates', 'Index and component templates', 'search:templates', [], true),
      searchNode(connection, 'search:pipelines', 'Pipelines', 'pipelines', 'Ingest pipelines and processors', 'search:pipelines', [], true),
      searchNode(connection, 'search:security', 'Security', 'security', 'Users, roles, API keys, and privileges', 'search:security', [], true),
      searchNode(connection, 'search:diagnostics', 'Diagnostics', 'diagnostics', 'Shards, segments, tasks, snapshots, and lifecycle', 'search:diagnostics', [], true),
    ]
  }

  if (scope === 'search:cluster') {
    return [
      searchNode(connection, 'search:cluster:health', 'Health', 'health', 'Cluster health and shard allocation', undefined, ['Cluster']),
      searchNode(connection, 'search:cluster:nodes', 'Nodes', 'nodes', 'Node roles, heap, disk, and CPU', undefined, ['Cluster']),
      searchNode(connection, 'search:cluster:allocation', 'Shard Allocation', 'shards', 'Shard routing and node placement', undefined, ['Cluster']),
    ]
  }

  if (scope === 'search:indices') {
    return searchIndices(connection).map((index) =>
      searchNode(connection, `index:${index.name}`, index.name, 'index', `${index.health} / ${index.documents.toLocaleString()} docs / ${index.storage}`, `index:${index.name}`, ['Indices'], true, searchQueryTemplate(index.name)),
    )
  }

  if (scope.startsWith('index:')) {
    const index = scope.replace('index:', '').trim()
    if (!index) {
      return []
    }
    return [
      searchNode(connection, `documents:${index}`, 'Documents', 'documents', 'Bounded Query DSL search', undefined, ['Indices', index], false, searchQueryTemplate(index)),
      searchNode(connection, `mapping:${index}`, 'Mappings', 'mappings', 'Fields, analyzers, and doc values', undefined, ['Indices', index]),
      searchNode(connection, `settings:${index}`, 'Settings', 'settings', 'Shard, refresh, lifecycle, and analyzer settings', undefined, ['Indices', index]),
      searchNode(connection, `aliases:${index}`, 'Aliases', 'aliases', 'Aliases targeting this index', undefined, ['Indices', index]),
      searchNode(connection, `shards:${index}`, 'Shards', 'shards', 'Shard placement and state', undefined, ['Indices', index]),
      searchNode(connection, `segments:${index}`, 'Segments', 'segments', 'Lucene segment health', undefined, ['Indices', index]),
    ]
  }

  if (scope === 'search:data-streams') {
    return searchDataStreams().map((stream) =>
      searchNode(connection, `data-stream:${stream.name}`, stream.name, 'data-stream', `${stream.status} / generation ${stream.generation} / ${stream.documents.toLocaleString()} docs`, `data-stream:${stream.name}`, ['Data Streams'], true, searchQueryTemplate(stream.name)),
    )
  }

  if (scope.startsWith('data-stream:')) {
    const stream = scope.replace('data-stream:', '').trim()
    if (!stream) {
      return []
    }
    return [
      searchNode(connection, `documents:${stream}`, 'Documents', 'documents', 'Bounded Query DSL search', undefined, ['Data Streams', stream], false, searchQueryTemplate(stream)),
      searchNode(connection, `backing-indices:${stream}`, 'Backing Indices', 'backing-indices', 'Concrete backing indices', undefined, ['Data Streams', stream]),
      searchNode(connection, `lifecycle:${stream}`, 'Lifecycle', 'lifecycle-policies', 'ILM or ISM policy state', undefined, ['Data Streams', stream]),
      searchNode(connection, `stream-stats:${stream}`, 'Statistics', 'statistics', 'Document and storage counters', undefined, ['Data Streams', stream]),
    ]
  }

  if (scope === 'search:aliases') {
    return searchAliases().map((alias) =>
      searchNode(connection, `alias:${alias.name}`, alias.name, 'alias', `${alias.indices} / write ${alias.writeIndex}`, undefined, ['Aliases'], false, searchQueryTemplate(alias.name)),
    )
  }

  if (scope === 'search:templates') {
    return [
      searchNode(connection, 'search:templates:index', 'Index Templates', 'templates', 'Composable index templates', 'search:templates:index', ['Templates'], true),
      searchNode(connection, 'search:templates:component', 'Component Templates', 'templates', 'Reusable template components', 'search:templates:component', ['Templates'], true),
    ]
  }

  if (scope === 'search:templates:index') {
    return searchTemplates().filter((template) => template.type === 'index').map((template) =>
      searchNode(connection, `index-template:${template.name}`, template.name, 'index-template', `${template.patterns} / priority ${template.priority}`, undefined, ['Templates', 'Index Templates']),
    )
  }

  if (scope === 'search:templates:component') {
    return searchTemplates().filter((template) => template.type === 'component').map((template) =>
      searchNode(connection, `component-template:${template.name}`, template.name, 'component-template', template.components || 'Reusable settings and mappings', undefined, ['Templates', 'Component Templates']),
    )
  }

  if (scope === 'search:pipelines') {
    return searchPipelines().map((pipeline) =>
      searchNode(connection, `pipeline:${pipeline.name}`, pipeline.name, 'pipeline', `${pipeline.processors} processor(s)`, undefined, ['Pipelines']),
    )
  }

  if (scope === 'search:security') {
    return [
      searchNode(connection, 'search:security:users', 'Users', 'users', 'Visible users and realms', undefined, ['Security']),
      searchNode(connection, 'search:security:roles', 'Roles', 'roles', 'Cluster and index privileges', undefined, ['Security']),
      searchNode(connection, 'search:security:api-keys', 'API Keys', 'api-keys', 'API keys and expiry state', undefined, ['Security']),
    ]
  }

  if (scope === 'search:diagnostics') {
    return [
      searchNode(connection, 'search:diagnostics:shards', 'Shards', 'shards', 'Shard routing and state', undefined, ['Diagnostics']),
      searchNode(connection, 'search:diagnostics:segments', 'Segments', 'segments', 'Segment counts and deleted docs', undefined, ['Diagnostics']),
      searchNode(connection, 'search:diagnostics:tasks', 'Tasks', 'tasks', 'Active task list', undefined, ['Diagnostics']),
      searchNode(connection, 'search:diagnostics:snapshots', 'Snapshots', 'snapshots', 'Snapshot repositories and states', undefined, ['Diagnostics']),
      searchNode(connection, 'search:diagnostics:lifecycle', 'Lifecycle Policies', 'lifecycle-policies', 'ILM or ISM policy status', undefined, ['Diagnostics']),
    ]
  }

  return []
}

export function searchInspectQueryTemplate(nodeId: string) {
  if (nodeId.startsWith('index:')) {
    return searchQueryTemplate(nodeId.replace('index:', '').trim())
  }

  if (nodeId.startsWith('data-stream:')) {
    return searchQueryTemplate(nodeId.replace('data-stream:', '').trim())
  }

  if (nodeId.startsWith('documents:')) {
    return searchQueryTemplate(nodeId.replace('documents:', '').trim())
  }

  if (nodeId.startsWith('mapping:')) {
    return JSON.stringify({ method: 'GET', path: `/${nodeId.replace('mapping:', '')}/_mapping` }, null, 2)
  }

  if (nodeId.startsWith('settings:')) {
    return JSON.stringify({ method: 'GET', path: `/${nodeId.replace('settings:', '')}/_settings` }, null, 2)
  }

  if (nodeId.includes('diagnostics') || nodeId.includes('cluster')) {
    return JSON.stringify({ method: 'GET', path: '/_cluster/health' }, null, 2)
  }

  return JSON.stringify({ method: 'GET', path: '/_cat/indices?format=json' }, null, 2)
}

function searchNode(
  _connection: ConnectionProfile,
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  path: string[] = [],
  expandable = false,
  queryTemplate?: string,
): ExplorerNode {
  return {
    id,
    family: 'search',
    label,
    kind,
    detail,
    scope,
    path,
    queryTemplate,
    expandable,
  }
}

export function searchQueryTemplate(index: string) {
  return JSON.stringify({
    index,
    body: {
      query: {
        match_all: {},
      },
      size: 20,
    },
  }, null, 2)
}
