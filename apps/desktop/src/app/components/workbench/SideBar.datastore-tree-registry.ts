import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import type { ConnectionTreeNode } from './SideBar.connection-tree'

export type ConnectionTreeActionCommand = 'open-template' | 'copy-qualified-name'

export interface ConnectionTreeAction {
  id: string
  label: string
  command: ConnectionTreeActionCommand
  queryTemplate?: string
  separatorBefore?: boolean
}

export interface ConnectionTreePlacement {
  path: string[]
  kind: string
}

const CATEGORY_DETAILS: Record<string, string> = {
  Schemas: 'Logical object namespaces',
  Databases: 'Database namespaces',
  Tables: 'Base tables',
  Hypertables: 'Time-series hypertables',
  Views: 'Saved query projections',
  'Materialized Views': 'Persisted query projections',
  'Stored Procedures': 'Callable stored routines',
  Functions: 'Callable scalar or table routines',
  Sequences: 'Generated numeric sequences',
  Types: 'User-defined types',
  Extensions: 'Installed database extensions',
  Columns: 'Object fields and data types',
  Indexes: 'Access paths and constraints',
  Constraints: 'Rules and relational constraints',
  Triggers: 'Event-driven object routines',
  Collections: 'Document collections',
  'Sample Documents': 'Representative documents',
  Validators: 'Collection validation rules',
  'Key Prefixes': 'SCAN-friendly key groups',
  Keys: 'Individual cache keys',
  Streams: 'Append-only event streams',
  Sets: 'Set and sorted-set values',
  Metrics: 'Time-series metric names',
  Labels: 'Metric dimensions',
  Targets: 'Scrape targets',
  Rules: 'Recording and alerting rules',
  Alerts: 'Alert states',
  Buckets: 'Time-series storage scopes',
  Measurements: 'Measurement names',
  Tags: 'Indexed time-series dimensions',
  Fields: 'Time-series field values',
  Tasks: 'Scheduled processing tasks',
  'Retention Policies': 'Data retention rules',
  Indices: 'Searchable indices',
  Aliases: 'Search index aliases',
  'Data Streams': 'Append-oriented search streams',
  Mappings: 'Field mappings and analyzers',
  Templates: 'Index and component templates',
  Pipelines: 'Ingest pipelines',
  Keyspaces: 'Wide-column namespaces',
  'Node Labels': 'Graph node categories',
  'Relationship Types': 'Graph edge categories',
  Graphs: 'Named graph definitions',
  'Vertex Labels': 'Vertex categories',
  'Edge Labels': 'Edge categories',
  'Property Keys': 'Graph property definitions',
  Datasets: 'Warehouse datasets',
  Warehouses: 'Compute warehouses',
  Stages: 'External and internal data stages',
  Jobs: 'Query and task history',
  Security: 'Roles, grants, ACLs, and permissions',
  Diagnostics: 'Health and performance metadata',
}

const SQL_TABLE_KINDS = new Set(['table', 'foreign-table', 'partitioned-table'])
const SQL_VIEW_KINDS = new Set(['view'])
const SQL_MATERIALIZED_VIEW_KINDS = new Set(['materialized-view', 'materialized view'])

export function normalizeExplorerKind(
  connection: ConnectionProfile,
  kind: string,
): string {
  const normalized = kind.trim().toLowerCase().replace(/_/g, '-')

  if (normalized === 'base table' || normalized === 'base-table') {
    return connection.engine === 'timescaledb' ? 'table' : 'table'
  }

  if (normalized === 'stored procedure' || normalized === 'stored-procedures') {
    return 'stored-procedure'
  }

  if (normalized === 'materialized view') {
    return 'materialized-view'
  }

  if (normalized === 'data stream') {
    return 'data-stream'
  }

  if (normalized === 'secondary-index' || normalized === 'gsi' || normalized === 'lsi') {
    return 'index'
  }

  if (normalized === 'indexes') {
    return 'indexes'
  }

  return normalized
}

export function placementForExplorerNode(
  connection: ConnectionProfile,
  node: ExplorerNode,
): ConnectionTreePlacement {
  const kind = normalizeExplorerKind(connection, node.kind)
  const path = categoryPathForNode(connection, node, kind)

  return { kind, path }
}

export function branchNodeForPath(
  connection: ConnectionProfile,
  path: string[],
): ConnectionTreeNode {
  const label = path.at(-1) ?? 'Objects'
  const parentLabel = path.at(-2)
  const kind = branchKindForLabel(label, parentLabel)
  const node: ConnectionTreeNode = {
    id: `category:${connection.id}:${path.join('/')}`,
    label,
    kind,
    detail: CATEGORY_DETAILS[label] ?? `${connection.engine} metadata`,
    category: isCategoryLabel(label),
    expandable: true,
    children: [],
  }

  if (parentLabel === 'Collections') {
    node.kind = 'collection'
    node.scope = `collection:${label}`
    node.queryable = true
    node.builderKind = connection.engine === 'mongodb' ? 'mongo-find' : undefined
    node.queryTemplate = documentFindQueryTemplate(label, 20, connection.database?.trim())
  }

  if (parentLabel === 'Tables' || parentLabel === 'Hypertables') {
    const schema = schemaFromPlacementPath(connection, path)
    node.kind = parentLabel === 'Hypertables' ? 'hypertable' : 'table'
    node.scope = `table:${schema}.${label}`
    node.queryable = true
    node.queryTemplate = sqlObjectQueryTemplate(connection, schema, label)
  }

  node.scope ??= branchScopeForPath(path)
  return node
}

export function managementActionsForNode(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
): ConnectionTreeAction[] {
  const kind = normalizeExplorerKind(connection, node.kind)

  if (connection.family === 'sql' || connection.family === 'embedded-olap') {
    return sqlActions(connection, node, kind)
  }

  if (connection.family === 'document') {
    return documentActions(connection, node, kind)
  }

  if (connection.family === 'keyvalue') {
    return keyValueActions(node, kind)
  }

  if (connection.family === 'search') {
    return searchActions(node, kind)
  }

  if (connection.family === 'widecolumn') {
    return wideColumnActions(connection, node, kind)
  }

  if (connection.family === 'graph') {
    return graphActions(node, kind)
  }

  if (connection.family === 'timeseries') {
    return timeseriesActions(node, kind)
  }

  if (connection.family === 'warehouse') {
    return warehouseActions(node, kind)
  }

  return []
}

export function sqlObjectQueryTemplate(
  connection: ConnectionProfile,
  schema: string,
  objectName: string,
) {
  if (connection.engine === 'sqlserver') {
    return `select top 100 * from ${schema}.${objectName};`
  }

  if (connection.engine === 'sqlite') {
    return `select * from [${schema}].[${objectName}] limit 100;`
  }

  if (connection.engine === 'duckdb') {
    return `select * from ${objectName} limit 100;`
  }

  return `select * from ${schema}.${objectName} limit 100;`
}

export function documentFindQueryTemplate(
  collection: string,
  limit: number,
  database?: string,
) {
  return JSON.stringify(
    {
      ...(database ? { database } : {}),
      collection,
      filter: {},
      limit,
    },
    null,
    2,
  )
}

export function redisKeyBrowserQueryTemplate(pattern: string, count = 100) {
  return JSON.stringify(
    {
      mode: 'redis-key-browser',
      pattern: normalizeRedisPattern(pattern),
      type: 'all',
      count,
    },
    null,
    2,
  )
}

function normalizeRedisPattern(pattern: string) {
  const trimmed = pattern.trim()

  if (!trimmed) {
    return '*'
  }

  if (trimmed.includes('*')) {
    return trimmed
  }

  if (trimmed.endsWith(':')) {
    return `${trimmed}*`
  }

  return trimmed
}

function categoryPathForNode(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
) {
  const normalizedPath = cleanExplorerPath(connection, node.path)

  switch (connection.family) {
    case 'document':
      return documentPlacement(connection, node, kind, normalizedPath)
    case 'keyvalue':
      return keyValuePlacement(kind, normalizedPath)
    case 'search':
      return searchPlacement(kind, normalizedPath)
    case 'widecolumn':
      return wideColumnPlacement(connection, node, kind, normalizedPath)
    case 'graph':
      return graphPlacement(kind, normalizedPath)
    case 'timeseries':
      return timeseriesPlacement(connection, kind, normalizedPath)
    case 'warehouse':
      return warehousePlacement(connection, kind, normalizedPath)
    case 'embedded-olap':
    case 'sql':
    default:
      return sqlPlacement(connection, node, kind, normalizedPath)
  }
}

function sqlPlacement(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
  normalizedPath: string[],
) {
  if (kind === 'schema') {
    return ['Schemas']
  }

  if (kind === 'database' || kind === 'catalog') {
    return ['Databases']
  }

  if (kind === 'extension') {
    return ['Extensions']
  }

  if (kind === 'role' || kind === 'roles' || kind === 'grant' || kind === 'permission') {
    return ['Security']
  }

  if (kind === 'diagnostic' || kind === 'diagnostics' || kind === 'session' || kind === 'lock') {
    return ['Diagnostics']
  }

  const objectParts = sqlObjectPartsFromExplorerNode(connection, node, normalizedPath)
  const schema = objectParts.schema
  const table = objectParts.table

  if (kind === 'column') {
    return ['Schemas', schema, 'Tables', table || normalizedPath.at(-1) || 'Object', 'Columns']
  }

  if (kind === 'index') {
    return table
      ? ['Schemas', schema, 'Tables', table, 'Indexes']
      : ['Schemas', schema, 'Indexes']
  }

  if (kind === 'constraint') {
    return table
      ? ['Schemas', schema, 'Tables', table, 'Constraints']
      : ['Schemas', schema, 'Constraints']
  }

  if (kind === 'trigger') {
    return table
      ? ['Schemas', schema, 'Tables', table, 'Triggers']
      : ['Schemas', schema, 'Triggers']
  }

  return ['Schemas', schema, sqlCategoryForKind(kind)]
}

function documentPlacement(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
  normalizedPath: string[],
) {
  const database =
    kind === 'database'
      ? undefined
      : databaseFromDocumentPath(connection, node, normalizedPath)
  const collection =
    collectionFromDocumentNode(connection, node, normalizedPath) ??
    (kind === 'collection' ? node.label : undefined)

  if (kind === 'database') {
    return ['Databases']
  }

  if (kind === 'collection') {
    return ['Databases', database, 'Collections'].filter(Boolean) as string[]
  }

  if (collection) {
    return ['Databases', database, 'Collections', collection].filter(Boolean) as string[]
  }

  return ['Databases', database ?? defaultDocumentDatabase(connection)].filter(Boolean)
}

function keyValuePlacement(kind: string, normalizedPath: string[]) {
  if (kind === 'database') {
    return ['Databases']
  }

  if (kind === 'prefix') {
    return ['Key Prefixes']
  }

  if (['stream'].includes(kind)) {
    return ['Streams']
  }

  if (['set', 'zset', 'sorted-set'].includes(kind)) {
    return ['Sets']
  }

  if (['key', 'string', 'hash', 'list'].includes(kind)) {
    const prefix = normalizedPath.find((segment) => segment.endsWith(':') || segment.includes('*'))
    return prefix ? ['Key Prefixes', prefix] : ['Keys']
  }

  if (['acl', 'user', 'role'].includes(kind)) {
    return ['Security']
  }

  return ['Diagnostics']
}

function searchPlacement(kind: string, normalizedPath: string[]) {
  const parentIndex = normalizedPath.find((segment) => !isCategoryLabel(segment))

  if (kind === 'index') {
    return ['Indices']
  }

  if (kind === 'data-stream') {
    return ['Data Streams']
  }

  if (kind === 'alias') {
    return ['Aliases']
  }

  if (kind === 'mapping' || kind === 'field') {
    return parentIndex ? ['Indices', parentIndex, 'Mappings'] : ['Mappings']
  }

  if (kind === 'template' || kind === 'component-template') {
    return ['Templates']
  }

  if (kind === 'pipeline') {
    return ['Pipelines']
  }

  if (kind === 'shard' || kind === 'segment' || kind === 'diagnostic') {
    return ['Diagnostics']
  }

  return normalizedPath.length ? normalizedPath : ['Indices']
}

function wideColumnPlacement(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
  normalizedPath: string[],
) {
  if (connection.engine === 'dynamodb') {
    if (kind === 'table') {
      return ['Tables']
    }

    const table = normalizedPath.find((segment) => !isCategoryLabel(segment)) ?? node.label
    return ['Tables', table, dynamoCategoryForKind(kind)]
  }

  if (kind === 'keyspace') {
    return ['Keyspaces']
  }

  const keyspace = normalizedPath.find((segment) => !isCategoryLabel(segment)) ?? 'app'
  return ['Keyspaces', keyspace, cassandraCategoryForKind(kind)]
}

function graphPlacement(kind: string, normalizedPath: string[]) {
  if (kind === 'database') {
    return ['Databases']
  }

  if (kind === 'graph') {
    return ['Graphs']
  }

  if (kind === 'node-label' || kind === 'vertex-label') {
    return ['Node Labels']
  }

  if (kind === 'relationship' || kind === 'edge-label') {
    return ['Relationship Types']
  }

  if (kind === 'property-key') {
    return ['Property Keys']
  }

  if (kind === 'constraint' || kind === 'index') {
    return ['Indexes']
  }

  return normalizedPath.length ? normalizedPath : ['Graphs']
}

function timeseriesPlacement(
  connection: ConnectionProfile,
  kind: string,
  normalizedPath: string[],
) {
  if (connection.engine === 'prometheus') {
    if (kind === 'metric') {
      return ['Metrics']
    }
    if (kind === 'label') {
      return ['Labels']
    }
    if (kind === 'target') {
      return ['Targets']
    }
    if (kind === 'rule' || kind === 'rule-group') {
      return ['Rules']
    }
    if (kind === 'alert') {
      return ['Alerts']
    }
  }

  if (kind === 'bucket') {
    return ['Buckets']
  }

  const bucket = normalizedPath.find((segment) => !isCategoryLabel(segment))
  if (kind === 'measurement') {
    return bucket ? ['Buckets', bucket, 'Measurements'] : ['Measurements']
  }
  if (kind === 'tag') {
    return bucket ? ['Buckets', bucket, 'Tags'] : ['Tags']
  }
  if (kind === 'field') {
    return bucket ? ['Buckets', bucket, 'Fields'] : ['Fields']
  }
  if (kind === 'task') {
    return ['Tasks']
  }

  return normalizedPath.length ? normalizedPath : ['Buckets']
}

function warehousePlacement(
  connection: ConnectionProfile,
  kind: string,
  normalizedPath: string[],
) {
  const namespaceLabel = connection.engine === 'bigquery' ? 'Datasets' : 'Databases'

  if (kind === 'dataset' || kind === 'database') {
    return [namespaceLabel]
  }

  if (kind === 'schema') {
    return ['Databases', normalizedPath[0] ?? connection.database ?? 'default', 'Schemas']
  }

  const namespace = normalizedPath.find((segment) => !isCategoryLabel(segment)) ??
    connection.database ??
    'default'

  if (kind === 'table') {
    return [namespaceLabel, namespace, 'Tables']
  }
  if (kind === 'view') {
    return [namespaceLabel, namespace, 'Views']
  }
  if (kind === 'materialized-view') {
    return [namespaceLabel, namespace, 'Materialized Views']
  }
  if (kind === 'stage') {
    return ['Stages']
  }
  if (kind === 'warehouse') {
    return ['Warehouses']
  }
  if (kind === 'job' || kind === 'task') {
    return ['Jobs']
  }

  return normalizedPath.length ? normalizedPath : [namespaceLabel]
}

function sqlCategoryForKind(kind: string) {
  if (SQL_TABLE_KINDS.has(kind)) {
    return 'Tables'
  }
  if (kind === 'hypertable') {
    return 'Hypertables'
  }
  if (SQL_VIEW_KINDS.has(kind)) {
    return 'Views'
  }
  if (SQL_MATERIALIZED_VIEW_KINDS.has(kind)) {
    return 'Materialized Views'
  }
  if (kind === 'stored-procedure' || kind === 'procedure') {
    return 'Stored Procedures'
  }
  if (kind === 'function') {
    return 'Functions'
  }
  if (kind === 'sequence') {
    return 'Sequences'
  }
  if (kind === 'type') {
    return 'Types'
  }
  if (kind === 'extension') {
    return 'Extensions'
  }
  return 'Tables'
}

function dynamoCategoryForKind(kind: string) {
  if (kind === 'index') {
    return 'Indexes'
  }
  if (kind === 'stream') {
    return 'Streams'
  }
  if (kind === 'key-schema') {
    return 'Key Schema'
  }
  if (kind === 'backup') {
    return 'Backups'
  }
  return 'Diagnostics'
}

function cassandraCategoryForKind(kind: string) {
  if (kind === 'table') {
    return 'Tables'
  }
  if (kind === 'materialized-view') {
    return 'Materialized Views'
  }
  if (kind === 'type') {
    return 'Types'
  }
  if (kind === 'index') {
    return 'Indexes'
  }
  if (kind === 'function' || kind === 'aggregate') {
    return 'Functions'
  }
  return 'Tables'
}

function sqlActions(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  kind: string,
): ConnectionTreeAction[] {
  const { schema, objectName } = sqlObjectPartsFromTreeNode(connection, node)
  const targetObjectName = objectName || node.label
  const qualified = qualifySqlName(connection, schema, targetObjectName)
  const actions: ConnectionTreeAction[] = []

  if (kind === 'schema') {
    actions.push(
      templateAction('create-table', 'Create Table...', `create table ${qualifySqlName(connection, node.label, 'new_table')} (\n  id integer primary key\n);`),
      templateAction('create-view', 'Create View...', `create view ${qualifySqlName(connection, node.label, 'new_view')} as\nselect 1 as value;`),
    )
  }

  if (SQL_TABLE_KINDS.has(kind) || kind === 'hypertable') {
    actions.push(
      templateAction('view-columns', 'View Columns', sqlColumnsQuery(connection, schema, objectName || node.label)),
      templateAction('view-indexes', 'View Indexes', sqlIndexesQuery(connection, schema, objectName || node.label)),
      templateAction('add-column', 'Add Column...', `alter table ${qualified} add column new_column text;`),
      templateAction('create-index', 'Create Index...', `create index idx_${objectName || node.label}_new_column on ${qualified} (new_column);`),
      templateAction('drop-table', 'Drop Table...', `-- Review before running.\ndrop table ${qualified};`, true),
    )
  }

  if (kind === 'view' || kind === 'materialized-view') {
    actions.push(
      templateAction('view-definition', 'View Definition', sqlViewDefinitionQuery(connection, schema, objectName || node.label)),
      templateAction('drop-view', kind === 'materialized-view' ? 'Drop Materialized View...' : 'Drop View...', `-- Review before running.\ndrop ${kind === 'materialized-view' ? 'materialized view' : 'view'} ${qualified};`, true),
    )
  }

  if (kind === 'index') {
    actions.push(
      templateAction('rebuild-index', 'Rebuild Index...', sqlRebuildIndexQuery(connection, node.label)),
      templateAction('drop-index', 'Drop Index...', `-- Review before running.\ndrop index ${node.label};`, true),
    )
  }

  if (kind === 'column') {
    actions.push(
      templateAction('rename-column', 'Rename Column...', `alter table ${qualifySqlName(connection, schema, targetObjectName)} rename column ${node.label} to new_${node.label};`),
      templateAction('drop-column', 'Drop Column...', `-- Review before running.\nalter table ${qualifySqlName(connection, schema, targetObjectName)} drop column ${node.label};`, true),
    )
  }

  return actions
}

function documentActions(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  kind: string,
): ConnectionTreeAction[] {
  if (kind !== 'collection') {
    if (kind === 'index' || kind === 'indexes') {
      return [
        templateAction('create-index', 'Create Index...', mongoCommandTemplate(connection, node, { createIndexes: node.path?.at(-1) ?? 'collection', indexes: [{ key: { field: 1 }, name: 'field_1' }] })),
        templateAction('drop-index', 'Drop Index...', mongoCommandTemplate(connection, node, { dropIndexes: node.path?.at(-1) ?? 'collection', index: 'index_name' }), true),
      ]
    }

    return []
  }

  const collection = node.label
  return [
    templateAction('aggregation', 'Open Aggregation Pipeline', JSON.stringify({ collection, pipeline: [{ $match: {} }, { $limit: 20 }] }, null, 2)),
    templateAction('create-index', 'Create Index...', mongoCommandTemplate(connection, node, { createIndexes: collection, indexes: [{ key: { field: 1 }, name: 'field_1' }] })),
    templateAction('rename-collection', 'Rename Collection...', mongoCommandTemplate(connection, node, { renameCollection: collection, to: `${collection}_new` })),
    templateAction('drop-collection', 'Drop Collection...', mongoCommandTemplate(connection, node, { drop: collection }), true),
  ]
}

function keyValueActions(node: ConnectionTreeNode, kind: string): ConnectionTreeAction[] {
  if (kind === 'prefix') {
    return [
      templateAction('scan-prefix', 'Scan Prefix', `SCAN 0 MATCH ${node.label} COUNT 100`),
      templateAction('delete-matching-keys', 'Delete Matching Keys...', `-- Review before running.\n-- Delete keys matching ${node.label} in batches.`),
    ]
  }

  if (['key', 'string', 'hash', 'list', 'set', 'zset', 'stream'].includes(kind)) {
    return [
      templateAction('type-key', 'Inspect Key Type', `TYPE ${node.label}`),
      templateAction('ttl-key', 'Set TTL...', `EXPIRE ${node.label} 3600`),
      templateAction('rename-key', 'Rename Key...', `RENAME ${node.label} ${node.label}:new`),
      templateAction('delete-key', 'Delete Key...', `-- Review before running.\nDEL ${node.label}`, true),
    ]
  }

  return []
}

function searchActions(node: ConnectionTreeNode, kind: string): ConnectionTreeAction[] {
  if (kind === 'index' || kind === 'data-stream') {
    return [
      templateAction('view-mapping', 'View Mapping', JSON.stringify({ index: node.label, endpoint: '_mapping' }, null, 2)),
      templateAction('profile-search', 'Profile Search', JSON.stringify({ index: node.label, profile: true, body: { query: { match_all: {} }, size: 20 } }, null, 2)),
      templateAction('delete-index', kind === 'data-stream' ? 'Delete Data Stream...' : 'Delete Index...', JSON.stringify({ method: 'DELETE', path: `/${node.label}` }, null, 2), true),
    ]
  }

  return []
}

function wideColumnActions(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  kind: string,
): ConnectionTreeAction[] {
  if (connection.engine === 'dynamodb' && kind === 'table') {
    return [
      templateAction('scan-table', 'Scan Table', JSON.stringify({ operation: 'Scan', tableName: node.label, limit: 20 }, null, 2)),
      templateAction('create-gsi', 'Create GSI...', JSON.stringify({ operation: 'UpdateTable', tableName: node.label, createGlobalSecondaryIndex: { indexName: 'gsi_new' } }, null, 2)),
      templateAction('delete-table', 'Delete Table...', JSON.stringify({ operation: 'DeleteTable', tableName: node.label }, null, 2), true),
    ]
  }

  if (kind === 'table') {
    return [
      templateAction('trace-query', 'Trace Query', `tracing on;\nselect * from ${node.label} limit 20;`),
      templateAction('create-index', 'Create Index...', `create index on ${node.label} (column_name);`),
      templateAction('drop-table', 'Drop Table...', `-- Review before running.\ndrop table ${node.label};`, true),
    ]
  }

  return []
}

function graphActions(node: ConnectionTreeNode, kind: string): ConnectionTreeAction[] {
  if (['node-label', 'relationship', 'graph', 'collection'].includes(kind)) {
    return [
      templateAction('sample-graph', 'Sample Matches', `match (n:${node.label}) return n limit 25;`),
      templateAction('profile-graph', 'Profile Query', `profile match (n:${node.label}) return n limit 25;`),
    ]
  }

  return []
}

function timeseriesActions(node: ConnectionTreeNode, kind: string): ConnectionTreeAction[] {
  if (kind === 'metric') {
    return [
      templateAction('instant-query', 'Instant Query', node.label),
      templateAction('range-query', 'Range Query', `${node.label}[5m]`),
    ]
  }

  if (kind === 'measurement') {
    return [
      templateAction('query-measurement', 'Query Measurement', `from(bucket: "bucket")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "${node.label}")`),
    ]
  }

  return []
}

function warehouseActions(node: ConnectionTreeNode, kind: string): ConnectionTreeAction[] {
  if (['table', 'view', 'materialized-view'].includes(kind)) {
    return [
      templateAction('select-rows', 'Select Rows', `select * from ${node.label} limit 100;`),
      templateAction('dry-run', 'Estimate Cost / Dry Run', `-- Use warehouse dry-run or explain for:\nselect * from ${node.label} limit 100;`),
    ]
  }

  return []
}

function templateAction(
  id: string,
  label: string,
  queryTemplate: string,
  separatorBefore = false,
): ConnectionTreeAction {
  return { id, label, command: 'open-template', queryTemplate, separatorBefore }
}

function cleanExplorerPath(connection: ConnectionProfile, path: string[] | undefined) {
  const segments = (path ?? []).filter(Boolean)
  const withoutConnection = segments[0] === connection.name ? segments.slice(1) : segments
  const engineRootLabels = new Set([
    connection.engine,
    'PostgreSQL',
    'CockroachDB',
    'TimescaleDB',
    'MongoDB',
    'DynamoDB',
    'Cassandra',
    'Redis',
    'Valkey',
    'Elasticsearch',
    'OpenSearch',
    'Prometheus',
    'InfluxDB',
    'JanusGraph',
    'ArangoDB',
    'Cosmos DB',
  ])

  return engineRootLabels.has(withoutConnection[0] ?? '')
    ? withoutConnection.slice(1)
    : withoutConnection
}

function isCategoryLabel(label: string | undefined) {
  return Boolean(label && CATEGORY_DETAILS[label])
}

function branchKindForLabel(label: string, parentLabel?: string) {
  if (isCategoryLabel(label)) {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  }

  if (parentLabel === 'Schemas') {
    return 'schema'
  }
  if (parentLabel === 'Databases') {
    return 'database'
  }
  if (parentLabel === 'Keyspaces') {
    return 'keyspace'
  }
  if (parentLabel === 'Buckets') {
    return 'bucket'
  }
  if (parentLabel === 'Indices') {
    return 'index'
  }
  if (parentLabel === 'Graphs') {
    return 'graph'
  }
  if (parentLabel === 'Datasets') {
    return 'dataset'
  }
  return 'namespace'
}

function defaultSqlSchema(connection: ConnectionProfile) {
  if (connection.engine === 'sqlite' || connection.engine === 'duckdb') {
    return 'main'
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return connection.database || 'default'
  }

  if (connection.engine === 'sqlserver') {
    return 'dbo'
  }

  return 'public'
}

function sqlObjectPartsFromExplorerNode(
  connection: ConnectionProfile,
  node: ExplorerNode,
  normalizedPath: string[],
) {
  const scopeName = node.scope?.split(':').slice(1).join(':')
  const scopeParts = scopeName?.includes('.') ? scopeName.split('.') : undefined
  const pathObject = normalizedPath.find((segment) => segment.includes('.'))
  const pathParts = pathObject?.split('.')
  const categoryFreePath = normalizedPath.filter((segment) => !isCategoryLabel(segment))
  const schema = scopeParts?.[0] || pathParts?.[0] || categoryFreePath[0] || defaultSqlSchema(connection)
  const objectName =
    scopeParts?.[1] ||
    pathParts?.[1] ||
    (categoryFreePath.length > 1 ? categoryFreePath.at(-1) : node.label)
  const table =
    node.kind === 'column' || node.kind === 'index' || node.kind === 'constraint'
      ? objectName
      : undefined

  return { schema, objectName, table }
}

function sqlObjectPartsFromTreeNode(connection: ConnectionProfile, node: ConnectionTreeNode) {
  const normalizedPath = cleanExplorerPath(connection, node.path)
  const parts = sqlObjectPartsFromExplorerNode(
    connection,
    {
      id: node.id,
      label: node.label,
      kind: node.kind,
      family: connection.family,
      path: node.path,
      scope: node.scope,
      detail: node.detail ?? '',
      queryTemplate: node.queryTemplate,
      expandable: node.expandable,
    },
    normalizedPath,
  )

  return {
    schema: parts.schema,
    objectName: parts.objectName,
  }
}

function schemaFromPlacementPath(connection: ConnectionProfile, path: string[]) {
  const schemaIndex = path.indexOf('Schemas')
  return schemaIndex >= 0 ? path[schemaIndex + 1] ?? defaultSqlSchema(connection) : defaultSqlSchema(connection)
}

function databaseFromDocumentPath(
  connection: ConnectionProfile,
  node: ExplorerNode,
  normalizedPath: string[],
) {
  if (connection.database?.trim()) {
    return connection.database.trim()
  }

  const databaseIndex = normalizedPath.indexOf('Databases')
  if (databaseIndex >= 0 && normalizedPath[databaseIndex + 1]) {
    return normalizedPath[databaseIndex + 1]
  }

  const collectionIndex = normalizedPath.indexOf('Collections')
  if (collectionIndex > 0 && normalizedPath[collectionIndex - 1]) {
    return normalizedPath[collectionIndex - 1]
  }

  const categoryFreePath = normalizedPath.filter((segment) => !isCategoryLabel(segment))
  if (categoryFreePath.length > 1) {
    return categoryFreePath[0]
  }

  if (
    normalizeExplorerKind(connection, node.kind) === 'collection' &&
    categoryFreePath.length === 1 &&
    categoryFreePath[0] !== node.label
  ) {
    return categoryFreePath[0]
  }

  return defaultDocumentDatabase(connection)
}

function defaultDocumentDatabase(connection: ConnectionProfile) {
  return connection.database || (connection.engine === 'litedb' ? 'local file' : 'default')
}

function collectionFromDocumentNode(
  connection: ConnectionProfile,
  node: ExplorerNode,
  normalizedPath: string[],
) {
  const collectionIndex = normalizedPath.indexOf('Collections')
  if (collectionIndex >= 0 && normalizedPath[collectionIndex + 1]) {
    return normalizedPath[collectionIndex + 1]
  }

  const scopeCollection = node.scope?.startsWith('collection:')
    ? node.scope.replace('collection:', '')
    : undefined

  if (scopeCollection) {
    return scopeCollection
  }

  const categoryFreePath = normalizedPath.filter((segment) => !isCategoryLabel(segment))
  if (categoryFreePath.length > 1) {
    return categoryFreePath.at(-1)
  }

  if (connection.database && categoryFreePath[0] === connection.database) {
    return undefined
  }

  return categoryFreePath[0]
}

function branchScopeForPath(path: string[]) {
  const parentLabel = path.at(-2)
  const label = path.at(-1)

  if (!label) {
    return undefined
  }

  if (parentLabel === 'Schemas') {
    return `schema:${label}`
  }
  if (parentLabel === 'Databases') {
    return `database:${label}`
  }
  if (parentLabel === 'Keyspaces') {
    return `keyspace:${label}`
  }
  if (parentLabel === 'Buckets') {
    return `bucket:${label}`
  }
  if (parentLabel === 'Indices') {
    return `index:${label}`
  }
  if (parentLabel === 'Graphs') {
    return `graph:${label}`
  }
  if (parentLabel === 'Datasets') {
    return `dataset:${label}`
  }

  return undefined
}

function qualifySqlName(connection: ConnectionProfile, schema: string, objectName: string) {
  if (connection.engine === 'sqlite') {
    return `[${schema}].[${objectName}]`
  }

  return `${schema}.${objectName}`
}

function sqlColumnsQuery(connection: ConnectionProfile, schema: string, table: string) {
  if (connection.engine === 'sqlite') {
    return `pragma table_info(${table});`
  }

  return `select column_name, data_type, is_nullable\nfrom information_schema.columns\nwhere table_schema = '${schema}' and table_name = '${table}'\norder by ordinal_position;`
}

function sqlIndexesQuery(connection: ConnectionProfile, schema: string, table: string) {
  if (connection.engine === 'sqlite') {
    return `pragma index_list(${table});`
  }

  if (connection.engine === 'sqlserver') {
    return `select i.name, i.type_desc, i.is_unique\nfrom sys.indexes i\njoin sys.objects o on i.object_id = o.object_id\njoin sys.schemas s on o.schema_id = s.schema_id\nwhere s.name = '${schema}' and o.name = '${table}';`
  }

  return `select indexname, indexdef\nfrom pg_indexes\nwhere schemaname = '${schema}' and tablename = '${table}';`
}

function sqlViewDefinitionQuery(connection: ConnectionProfile, schema: string, view: string) {
  if (connection.engine === 'sqlite') {
    return `select sql from sqlite_master where type in ('view', 'table') and name = '${view}';`
  }

  return `select view_definition\nfrom information_schema.views\nwhere table_schema = '${schema}' and table_name = '${view}';`
}

function sqlRebuildIndexQuery(connection: ConnectionProfile, indexName: string) {
  if (connection.engine === 'sqlserver') {
    return `alter index ${indexName} rebuild;`
  }

  if (connection.engine === 'sqlite') {
    return `reindex ${indexName};`
  }

  return `reindex index ${indexName};`
}

function mongoCommandTemplate(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  command: Record<string, unknown>,
) {
  return JSON.stringify(
    {
      ...(connection.database ? { database: connection.database } : {}),
      command,
      target: node.label,
    },
    null,
    2,
  )
}
