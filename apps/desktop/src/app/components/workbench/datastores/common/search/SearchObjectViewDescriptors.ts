export type SearchObjectViewDescriptor = {
  kind: string
  menuLabel: string
  title: string
  purpose: string
  emptyTitle: string
  emptyDescription: string
  primaryQueryLabel?: string
}

const DESCRIPTORS: Record<string, SearchObjectViewDescriptor> = {
  cluster: descriptor('cluster', 'Review Cluster', 'Search Cluster', 'Review health, nodes, allocation, index counts, and workload signals for this search cluster.', 'No cluster metadata is loaded', 'Refresh cluster metadata or verify the account can read cluster health.'),
  health: descriptor('health', 'Open Cluster Health', 'Cluster Health', 'Review shard allocation status, node availability, and cluster health warnings.', 'No health metadata is loaded', 'Refresh health to collect cluster status.'),
  nodes: descriptor('nodes', 'Review Nodes', 'Search Nodes', 'Review node roles, heap, disk, CPU, and indexing/search load.', 'No nodes were returned', 'The current account may not inspect nodes.'),
  indices: descriptor('indices', 'Open Indices', 'Search Indices', 'Review searchable indices, health, shards, document counts, storage, and lifecycle state.', 'No indices were returned', 'This cluster may not contain user indices.'),
  index: descriptor('index', 'Open Index', 'Search Index', 'Inspect mapping fields, aliases, shards, segments, settings, stats, and a bounded search query.', 'No index metadata is loaded', 'Refresh this index to collect mapping and stats metadata.', 'Open Search'),
  documents: descriptor('documents', 'Search Documents', 'Search Documents', 'Run a bounded Query DSL search against this index or data stream.', 'No search target is loaded', 'Open the query action to search documents.', 'Open Search'),
  mappings: descriptor('mappings', 'Open Mappings', 'Search Mappings', 'Review field paths, field types, analyzers, searchability, and aggregation support.', 'No mappings were returned', 'Refresh mappings or verify the account can read index mappings.'),
  mapping: descriptor('mapping', 'Open Mapping', 'Search Mapping', 'Review field mappings and analyzer choices for this index.', 'No mapping metadata is loaded', 'Refresh this mapping to collect field metadata.'),
  settings: descriptor('settings', 'Open Settings', 'Index Settings', 'Review lifecycle, shard, replica, refresh, analyzer, and similarity settings.', 'No settings were returned', 'Refresh settings or verify index metadata permissions.'),
  aliases: descriptor('aliases', 'Open Aliases', 'Search Aliases', 'Review alias routing, filters, write-index flags, and target indices.', 'No aliases were returned', 'This cluster may not define aliases.'),
  alias: descriptor('alias', 'Open Alias', 'Search Alias', 'Inspect alias targets, filters, and write-index routing.', 'No alias metadata is loaded', 'Refresh this alias to collect alias metadata.', 'Open Alias Search'),
  'data-streams': descriptor('data-streams', 'Open Data Streams', 'Data Streams', 'Review backing indices, generation, lifecycle, and append-oriented stream health.', 'No data streams were returned', 'This cluster may not use data streams.'),
  'data-stream': descriptor('data-stream', 'Open Data Stream', 'Data Stream', 'Inspect backing indices, template, lifecycle, and a bounded search query.', 'No data-stream metadata is loaded', 'Refresh this data stream to collect stream metadata.', 'Open Stream Search'),
  'backing-indices': descriptor('backing-indices', 'Open Backing Indices', 'Backing Indices', 'Review concrete backing indices for a data stream.', 'No backing indices were returned', 'This stream may not have visible backing indices.'),
  templates: descriptor('templates', 'Open Templates', 'Index Templates', 'Review index templates, component templates, priorities, patterns, and composed settings.', 'No templates were returned', 'No visible templates are available.'),
  'index-template': descriptor('index-template', 'Open Index Template', 'Index Template', 'Inspect index patterns, priority, lifecycle, mappings, and component composition.', 'No template metadata is loaded', 'Refresh this template to collect metadata.'),
  'component-template': descriptor('component-template', 'Open Component Template', 'Component Template', 'Inspect reusable mapping, setting, and alias fragments.', 'No component-template metadata is loaded', 'Refresh this component template to collect metadata.'),
  pipelines: descriptor('pipelines', 'Open Pipelines', 'Ingest Pipelines', 'Review processors, failure handlers, descriptions, and guarded pipeline management entry points.', 'No ingest pipelines were returned', 'This cluster may not define ingest pipelines.'),
  pipeline: descriptor('pipeline', 'Open Pipeline', 'Ingest Pipeline', 'Inspect processors, on-failure behavior, and simulation entry points.', 'No pipeline metadata is loaded', 'Refresh this pipeline to collect processor metadata.'),
  security: descriptor('security', 'Review Security', 'Search Security', 'Review users, roles, index privileges, API keys, and disabled capability reasons.', 'No security metadata is loaded', 'Security metadata may be unavailable or restricted.'),
  users: descriptor('users', 'Review Users', 'Search Users', 'Review visible users and authentication realms.', 'No users were returned', 'The security plugin may be disabled or restricted.'),
  roles: descriptor('roles', 'Review Roles', 'Search Roles', 'Review cluster and index privileges for visible roles.', 'No roles were returned', 'Role metadata may be restricted.'),
  'api-keys': descriptor('api-keys', 'Review API Keys', 'Search API Keys', 'Review API key names, ownership, expiry, and invalidation state.', 'No API keys were returned', 'API key metadata may be restricted.'),
  diagnostics: descriptor('diagnostics', 'Open Diagnostics', 'Search Diagnostics', 'Review shards, segments, allocation, tasks, snapshots, lifecycle, and profile-ready workload signals.', 'No diagnostics are loaded', 'Refresh diagnostics to collect cluster metadata.'),
  shards: descriptor('shards', 'Review Shards', 'Search Shards', 'Review shard routing, state, node placement, and size.', 'No shards were returned', 'Shard metadata may be restricted.'),
  segments: descriptor('segments', 'Review Segments', 'Search Segments', 'Review Lucene segment counts, deleted docs, memory, and merge pressure.', 'No segments were returned', 'Segment metadata may be restricted.'),
  tasks: descriptor('tasks', 'Review Tasks', 'Search Tasks', 'Review active tasks, action names, running time, and cancellability.', 'No tasks were returned', 'There may be no active tasks.'),
  snapshots: descriptor('snapshots', 'Review Snapshots', 'Search Snapshots', 'Review snapshot repositories, snapshots, states, and restore-readiness.', 'No snapshots were returned', 'No visible repositories or snapshots were returned.'),
  'lifecycle-policies': descriptor('lifecycle-policies', 'Open Lifecycle Policies', 'Lifecycle Policies', 'Review ILM or ISM policies and managed-index state.', 'No lifecycle policies were returned', 'Lifecycle APIs may be unavailable on this connection.'),
}

const DEFAULT_DESCRIPTOR = descriptor(
  'object',
  'Inspect Search Object',
  'Search Object',
  'Review available Elasticsearch or OpenSearch metadata for this object.',
  'Search metadata is not available',
  'Refresh this object or check whether the account can inspect it.',
)

export function getSearchObjectViewDescriptor(kind: string | undefined): SearchObjectViewDescriptor {
  if (!kind) {
    return DEFAULT_DESCRIPTOR
  }

  return DESCRIPTORS[normalizeSearchObjectKind(kind)] ?? DEFAULT_DESCRIPTOR
}

export function searchObjectViewMenuLabel(kind: string | undefined): string {
  return getSearchObjectViewDescriptor(kind).menuLabel
}

export function isSearchObjectViewKind(kind: string | undefined): boolean {
  return Boolean(kind && DESCRIPTORS[normalizeSearchObjectKind(kind)])
}

export const SEARCH_OBJECT_VIEW_KINDS = Object.freeze(Object.keys(DESCRIPTORS))

function descriptor(
  kind: string,
  menuLabel: string,
  title: string,
  purpose: string,
  emptyTitle: string,
  emptyDescription: string,
  primaryQueryLabel?: string,
): SearchObjectViewDescriptor {
  return {
    kind,
    menuLabel,
    title,
    purpose,
    emptyTitle,
    emptyDescription,
    primaryQueryLabel,
  }
}

function normalizeSearchObjectKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}
