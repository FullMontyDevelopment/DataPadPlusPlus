import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import {
  searchAliases,
  searchClusterName,
  searchDataStreams,
  searchFields,
  searchIndices,
  searchNodes,
  searchPipelines,
  searchSegments,
  searchSettings,
  searchShards,
  searchTemplates,
} from './browser-search-fixtures'

export function searchInspectPayload(connection: ConnectionProfile, nodeId: string) {
  if (nodeId === 'search:cluster' || nodeId.startsWith('search:cluster')) {
    return searchClusterPayload(connection)
  }

  if (nodeId === 'search:indices') {
    return {
      ...searchClusterPayload(connection),
      objectView: 'indices',
      indices: searchIndices(connection),
      dataStreams: [],
      nodes: [],
      shards: [],
      statistics: [],
    }
  }

  if (nodeId.startsWith('index:')) {
    return searchIndexPayload(connection, nodeId.replace('index:', '').trim())
  }

  if (nodeId.startsWith('documents:')) {
    return {
      ...searchIndexPayload(connection, nodeId.replace('documents:', '').trim()),
      objectView: 'documents',
    }
  }

  if (nodeId.startsWith('mapping:')) {
    return {
      ...searchIndexPayload(connection, nodeId.replace('mapping:', '').trim()),
      objectView: 'mappings',
      indices: [],
      aliases: [],
      shards: [],
      segments: [],
      settings: [],
      statistics: [],
    }
  }

  if (nodeId.startsWith('settings:')) {
    return {
      ...searchIndexPayload(connection, nodeId.replace('settings:', '').trim()),
      objectView: 'settings',
      indices: [],
      fields: [],
      aliases: [],
      shards: [],
      segments: [],
      statistics: [],
    }
  }

  if (nodeId === 'search:data-streams') {
    return {
      ...searchClusterPayload(connection),
      objectView: 'data-streams',
      dataStreams: searchDataStreams(),
      indices: [],
      nodes: [],
      shards: [],
      statistics: [],
    }
  }

  if (nodeId.startsWith('data-stream:')) {
    return searchDataStreamPayload(connection, nodeId.replace('data-stream:', '').trim())
  }

  if (nodeId === 'search:aliases' || nodeId.startsWith('alias:') || nodeId.startsWith('aliases:')) {
    return {
      engine: connection.engine,
      clusterName: searchClusterName(connection),
      objectView: nodeId.startsWith('alias:') ? 'alias' : 'aliases',
      objectName: nodeId.replace(/^alias:/, '') || 'aliases',
      aliases: nodeId.startsWith('alias:')
        ? searchAliases().filter((alias) => alias.name === nodeId.replace('alias:', ''))
        : searchAliases(),
    }
  }

  if (nodeId === 'search:templates' || nodeId.startsWith('search:templates') || nodeId.includes('template:')) {
    const templateName = nodeId.split(':').at(-1)
    const templates = nodeId.includes('template:') && templateName
      ? searchTemplates().filter((template) => template.name === templateName)
      : searchTemplates()
    return {
      engine: connection.engine,
      clusterName: searchClusterName(connection),
      objectView: nodeId.includes('component-template') ? 'component-template' : nodeId.includes('index-template') ? 'index-template' : 'templates',
      objectName: templateName,
      templates,
    }
  }

  if (nodeId === 'search:pipelines' || nodeId.startsWith('pipeline:')) {
    const pipelineName = nodeId.replace('pipeline:', '')
    return {
      engine: connection.engine,
      clusterName: searchClusterName(connection),
      objectView: nodeId.startsWith('pipeline:') ? 'pipeline' : 'pipelines',
      objectName: pipelineName || 'pipelines',
      pipelines: pipelineName
        ? searchPipelines().filter((pipeline) => pipeline.name === pipelineName)
        : searchPipelines(),
    }
  }

  if (nodeId.startsWith('search:security')) {
    return searchSecurityPayload(connection, nodeId)
  }

  if (nodeId.startsWith('search:diagnostics')) {
    return searchDiagnosticsPayload(connection, nodeId)
  }

  return searchClusterPayload(connection)
}

function searchClusterPayload(connection: ConnectionProfile) {
  const indices = searchIndices(connection)
  const documentCount = indices.reduce((total, index) => total + index.documents, 0)
  return {
    engine: connection.engine,
    clusterName: searchClusterName(connection),
    objectView: 'cluster',
    status: 'green',
    health: 'green',
    nodeCount: 3,
    indexCount: indices.length,
    documentCount,
    storage: '1.7 GB',
    shardCount: 12,
    nodes: searchNodes(),
    indices,
    shards: searchShards(),
    statistics: [
      { name: 'Search rate', value: 42, unit: 'req/s', source: 'nodes.stats.indices.search' },
      { name: 'Indexing rate', value: 12, unit: 'docs/s', source: 'nodes.stats.indices.indexing' },
      { name: 'Query latency p95', value: 18, unit: 'ms', source: 'search slowlog sample' },
    ],
  }
}

function searchIndexPayload(connection: ConnectionProfile, indexName: string) {
  const indices = searchIndices(connection)
  const index = indices.find((candidate) => candidate.name === indexName)
  if (!index) {
    return {
      engine: connection.engine,
      clusterName: searchClusterName(connection),
      objectView: 'index',
      index: indexName,
      objectName: indexName,
      indices: [],
      fields: [],
      aliases: [],
      shards: [],
      segments: [],
      settings: [],
      lifecyclePolicies: [],
      statistics: [],
      warnings: [
        'No search index metadata is available. Refresh the Indices node or select another index.',
      ],
    }
  }
  return {
    engine: connection.engine,
    clusterName: searchClusterName(connection),
    objectView: 'index',
    index: index.name,
    objectName: index.name,
    status: index.health,
    documentCount: index.documents,
    storage: index.storage,
    primaryShards: index.primaryShards,
    replicaShards: index.replicaShards,
    indices: [index],
    fields: searchFields(),
    aliases: searchAliases().filter((alias) => alias.indices.includes(index.name)),
    shards: searchShards().filter((shard) => shard.index === index.name),
    segments: searchSegments().filter((segment) => segment.index === index.name),
    settings: searchSettings(index.name),
    lifecyclePolicies: [
      {
        name: index.lifecycle,
        type: connection.engine === 'opensearch' ? 'ISM' : 'ILM',
        phase: 'hot',
        managedIndices: 1,
        status: 'active',
      },
    ],
    statistics: [
      { name: 'Refresh interval', value: '1s', unit: '', source: 'index settings' },
      { name: 'Deleted docs', value: index.name === 'orders-v1' ? 18 : 3, unit: 'docs', source: 'segments' },
    ],
  }
}

function searchDataStreamPayload(connection: ConnectionProfile, streamName: string) {
  const streams = searchDataStreams()
  const stream = streams.find((candidate) => candidate.name === streamName)
  if (!stream) {
    return {
      engine: connection.engine,
      clusterName: searchClusterName(connection),
      objectView: 'data-stream',
      objectName: streamName,
      dataStreams: [],
      indices: [],
      shards: [],
      lifecyclePolicies: [],
      statistics: [],
      warnings: [
        'No data stream metadata is available. Refresh the Data Streams node or select another stream.',
      ],
    }
  }
  const backingIndices = stream.backingIndices.split(', ')
  return {
    engine: connection.engine,
    clusterName: searchClusterName(connection),
    objectView: 'data-stream',
    objectName: stream.name,
    status: stream.status,
    documentCount: stream.documents,
    storage: stream.storage,
    dataStreams: [stream],
    indices: backingIndices.map((name, index) => ({
      name,
      health: 'green',
      status: 'open',
      documents: Math.round(stream.documents / backingIndices.length),
      primaryShards: 1,
      replicaShards: 1,
      storage: index === 0 ? '180 MB' : '96 MB',
      lifecycle: stream.template,
    })),
    shards: searchShards().filter((shard) => backingIndices.includes(shard.index)),
    lifecyclePolicies: [
      {
        name: stream.template,
        type: connection.engine === 'opensearch' ? 'ISM' : 'ILM',
        phase: 'hot',
        managedIndices: backingIndices.length,
        status: 'active',
      },
    ],
    statistics: [{ name: 'Generation', value: stream.generation, unit: '', source: 'data_streams' }],
  }
}

function searchSecurityPayload(connection: ConnectionProfile, nodeId: string) {
  const base = {
    engine: connection.engine,
    clusterName: searchClusterName(connection),
    objectView: 'security',
    users: [
      { name: 'app-search', realm: 'native', roles: 'search_writer', enabled: true },
      { name: 'reporting', realm: 'native', roles: 'search_reader', enabled: true },
    ],
    roles: [
      { name: 'search_reader', clusterPrivileges: 'monitor', indexPrivileges: 'read on products-*', applicationPrivileges: '-' },
      { name: 'search_writer', clusterPrivileges: 'monitor', indexPrivileges: 'read/write on products-*', applicationPrivileges: '-' },
    ],
    apiKeys: [
      { name: 'ingest-pipeline-key', owner: 'app-search', status: 'active', expiresAt: '2026-06-30' },
    ],
  }

  if (nodeId.endsWith(':users')) {
    return { ...base, objectView: 'users', roles: [], apiKeys: [] }
  }

  if (nodeId.endsWith(':roles')) {
    return { ...base, objectView: 'roles', users: [], apiKeys: [] }
  }

  if (nodeId.endsWith(':api-keys')) {
    return { ...base, objectView: 'api-keys', users: [], roles: [] }
  }

  return base
}

function searchDiagnosticsPayload(connection: ConnectionProfile, nodeId: string) {
  const base = {
    engine: connection.engine,
    clusterName: searchClusterName(connection),
    objectView: 'diagnostics',
    nodes: searchNodes(),
    shards: searchShards(),
    segments: searchSegments(),
    tasks: [
      { action: 'indices:data/read/search', description: 'dashboard query', runningTime: '42ms', cancellable: true, node: 'node-a' },
    ],
    snapshots: [
      { repository: 'daily', snapshot: 'snap-2026-05-22', state: 'SUCCESS', indices: 'products-v1, orders-v1', startedAt: '2026-05-22T02:00:00Z' },
    ],
    lifecyclePolicies: [
      { name: connection.engine === 'opensearch' ? 'hot-warm-delete' : 'products-ilm', type: connection.engine === 'opensearch' ? 'ISM' : 'ILM', phase: 'hot', managedIndices: 2, status: 'active' },
    ],
    slowLogs: [
      { index: 'products-v1', kind: 'query', level: 'warn', threshold: '200ms', observed: '18ms p95', source: 'index.search.slowlog.threshold.query.warn' },
      { index: 'products-v1', kind: 'fetch', level: 'info', threshold: '80ms', observed: '7ms p95', source: 'index.search.slowlog.threshold.fetch.info' },
      { index: 'orders-v1', kind: 'indexing', level: 'debug', threshold: '500ms', observed: '41ms p95', source: 'index.indexing.slowlog.threshold.index.debug' },
    ],
    allocationDecisions: [
      { index: 'products-v1', shard: '0p', node: 'node-a', decision: 'yes', reason: 'balanced allocation' },
      { index: 'orders-v1', shard: '1r', node: 'node-b', decision: 'throttle', reason: 'disk watermark nearing threshold' },
      { index: 'logs-2026.06.07', shard: '2r', node: 'node-c', decision: 'yes', reason: 'replica awareness satisfied' },
    ],
    statistics: [
      { name: 'Open scroll contexts', value: 0, unit: 'contexts', source: 'nodes.stats.search' },
      { name: 'Pending tasks', value: 1, unit: 'tasks', source: 'cluster.pending_tasks' },
    ],
  }

  if (nodeId.endsWith(':shards')) {
    return { ...base, objectView: 'shards', nodes: [], segments: [], tasks: [], snapshots: [], lifecyclePolicies: [], statistics: [] }
  }

  if (nodeId.endsWith(':segments')) {
    return { ...base, objectView: 'segments', nodes: [], shards: [], tasks: [], snapshots: [], lifecyclePolicies: [], statistics: [] }
  }

  if (nodeId.endsWith(':tasks')) {
    return { ...base, objectView: 'tasks', nodes: [], shards: [], segments: [], snapshots: [], lifecyclePolicies: [], statistics: [] }
  }

  if (nodeId.endsWith(':snapshots')) {
    return { ...base, objectView: 'snapshots', nodes: [], shards: [], segments: [], tasks: [], lifecyclePolicies: [], statistics: [] }
  }

  if (nodeId.endsWith(':lifecycle')) {
    return { ...base, objectView: 'lifecycle-policies', nodes: [], shards: [], segments: [], tasks: [], snapshots: [], statistics: [] }
  }

  return base
}
