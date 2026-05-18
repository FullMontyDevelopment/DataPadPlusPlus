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
  'User Schemas': 'User-created object namespaces',
  'System Schemas': 'Engine and system object namespaces',
  Databases: 'Database namespaces',
  'System Databases': 'Engine-maintained database namespaces',
  'Database Snapshots': 'Point-in-time database snapshots',
  'Database Diagrams': 'Database relationship diagrams',
  Tables: 'Base tables',
  'System Tables': 'Engine-maintained tables',
  'FileTables': 'SQL Server file-backed tables',
  'External Tables': 'Externally stored relational tables',
  'Graph Tables': 'SQL graph node and edge tables',
  Hypertables: 'Time-series hypertables',
  Views: 'Saved query projections',
  'Materialized Views': 'Persisted query projections',
  'External Resources': 'External data sources, file formats, and integration metadata',
  'Stored Procedures': 'Callable stored routines',
  Programmability: 'Procedures, functions, triggers, and programmable objects',
  Functions: 'Callable scalar or table routines',
  'Database Triggers': 'Database-scoped trigger routines',
  Assemblies: 'CLR assemblies and related programmable objects',
  Synonyms: 'Aliases for database objects',
  Sequences: 'Generated numeric sequences',
  Types: 'User-defined types',
  Users: 'Database users',
  Roles: 'Database roles',
  Extensions: 'Installed database extensions',
  Columns: 'Object fields and data types',
  Indexes: 'Access paths and constraints',
  Constraints: 'Rules and relational constraints',
  Triggers: 'Event-driven object routines',
  Collections: 'Document collections',
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
  Storage: 'Files, filegroups, partitions, and storage metadata',
  'Service Broker': 'SQL Server messaging objects',
  'Server Objects': 'Linked servers, endpoints, and server-level objects',
  Replication: 'Replication publications and subscriptions',
  'Always On High Availability': 'Availability groups and replicas',
  Management: 'Maintenance, policy, and data collection tooling',
  'SQL Server Agent': 'Jobs, alerts, and operators',
  'XEvent Profiler': 'Extended Events sessions and traces',
  'Integration Services Catalogs': 'SSIS package catalogs',
  Diagnostics: 'Health and performance metadata',
}

const SQL_TABLE_KINDS = new Set(['table', 'foreign-table', 'partitioned-table'])
const SQL_VIEW_KINDS = new Set(['view'])
const SQL_MATERIALIZED_VIEW_KINDS = new Set(['materialized-view', 'materialized view'])
const SQL_SCHEMA_ROOTS = new Set(['Schemas', 'User Schemas', 'System Schemas'])
const SQL_TABLE_CONTAINER_LABELS = new Set([
  'Tables',
  'System Tables',
  'External Tables',
  'FileTables',
  'Graph Tables',
  'Hypertables',
])

export function normalizeExplorerKind(
  connection: ConnectionProfile,
  kind: string,
): string {
  const normalized = kind.trim().toLowerCase().replace(/_/g, '-')

  if (normalized === 'base table' || normalized === 'base-table') {
    return connection.engine === 'timescaledb' ? 'table' : 'table'
  }

  if (normalized === 'stored procedure') {
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
    path,
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

  if (parentLabel && SQL_TABLE_CONTAINER_LABELS.has(parentLabel) && !isCategoryLabel(label)) {
    const { schema, objectName } = sqlObjectPartsFromPlacementPath(connection, path)
    node.kind = parentLabel === 'Hypertables' ? 'hypertable' : 'table'
    node.scope = `table:${schema}.${objectName}`
    node.queryable = true
    node.queryTemplate = sqlObjectQueryTemplate(connection, schema, objectName)
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
  if (connection.engine === 'sqlserver') {
    return sqlServerPlacement(connection, node, kind, normalizedPath)
  }

  if (kind === 'schema' && !isSqlSystemSchema(connection, node.label)) {
    return [sqlSchemaRootLabel(connection, node.label)]
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
  const schemaRoot = sqlSchemaRootLabel(connection, schema)
  const tableCategory = isSqlSystemObject(connection, kind, table || objectParts.objectName, schema)
    ? 'System Tables'
    : 'Tables'

  if (kind === 'column') {
    return [schemaRoot, schema, tableCategory, table || normalizedPath.at(-1) || 'Object', 'Columns']
  }

  if (kind === 'index') {
    return table
      ? [schemaRoot, schema, tableCategory, table, 'Indexes']
      : [schemaRoot, schema, 'Indexes']
  }

  if (kind === 'constraint') {
    return table
      ? [schemaRoot, schema, tableCategory, table, 'Constraints']
      : [schemaRoot, schema, 'Constraints']
  }

  if (kind === 'trigger') {
    return table
      ? [schemaRoot, schema, tableCategory, table, 'Triggers']
      : [schemaRoot, schema, 'Programmability', 'Triggers']
  }

  const category = sqlCategoryForKind(connection, kind, node.label, schema)
  if (isSqlProgrammabilityCategory(category)) {
    return [schemaRoot, schema, 'Programmability', category]
  }

  return [schemaRoot, schema, category]
}

function sqlServerPlacement(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
  normalizedPath: string[],
) {
  const database = sqlServerDatabaseName(connection, normalizedPath)

  if (kind === 'database' || kind === 'catalog') {
    return ['Databases']
  }

  if (kind === 'schema') {
    return ['Databases', database, 'Security', 'Schemas']
  }

  if (kind === 'role' || kind === 'roles') {
    return ['Databases', database, 'Security', 'Roles']
  }

  if (kind === 'user') {
    return ['Databases', database, 'Security', 'Users']
  }

  if (kind === 'grant' || kind === 'permission') {
    return ['Databases', database, 'Security']
  }

  if (kind === 'diagnostic' || kind === 'diagnostics' || kind === 'session' || kind === 'lock') {
    return ['Management']
  }

  const objectParts = sqlObjectPartsFromExplorerNode(connection, node, normalizedPath)
  const tableLabel = sqlServerQualifiedDisplayName(objectParts.schema, objectParts.table ?? objectParts.objectName)
  const tableCategory = sqlServerTableCategoryForKind(kind, objectParts.schema, objectParts.objectName)
  const tablePath = sqlServerTablePath(database, tableCategory, tableLabel)

  if (kind === 'column') {
    return [...tablePath, 'Columns']
  }

  if (kind === 'index') {
    return objectParts.table
      ? [...tablePath, 'Indexes']
      : ['Databases', database, 'Tables', 'Indexes']
  }

  if (kind === 'constraint') {
    return objectParts.table
      ? [...tablePath, 'Constraints']
      : ['Databases', database, 'Tables', 'Constraints']
  }

  if (kind === 'trigger') {
    return objectParts.table
      ? [...tablePath, 'Triggers']
      : ['Databases', database, 'Programmability', 'Database Triggers']
  }

  if (SQL_TABLE_KINDS.has(kind) || kind === 'hypertable') {
    return tableCategory === 'Tables'
      ? ['Databases', database, 'Tables']
      : ['Databases', database, 'Tables', tableCategory]
  }

  if (SQL_VIEW_KINDS.has(kind) || SQL_MATERIALIZED_VIEW_KINDS.has(kind)) {
    return ['Databases', database, 'Views']
  }

  if (kind === 'stored-procedure' || kind === 'procedure') {
    return ['Databases', database, 'Programmability', 'Stored Procedures']
  }

  if (kind === 'function') {
    return ['Databases', database, 'Programmability', 'Functions']
  }

  if (kind === 'sequence') {
    return ['Databases', database, 'Programmability', 'Sequences']
  }

  if (kind === 'type') {
    return ['Databases', database, 'Programmability', 'Types']
  }

  if (kind === 'synonym') {
    return ['Databases', database, 'Synonyms']
  }

  return ['Databases', database, 'Tables']
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

function sqlCategoryForKind(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  schema: string,
) {
  if (SQL_TABLE_KINDS.has(kind)) {
    return isSqlSystemObject(connection, kind, label, schema) ? 'System Tables' : 'Tables'
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
  if (kind === 'synonym') {
    return 'Synonyms'
  }
  if (kind === 'extension') {
    return 'Extensions'
  }
  return 'Tables'
}

function sqlServerDatabaseName(connection: ConnectionProfile, normalizedPath: string[]) {
  const databasesIndex = normalizedPath.indexOf('Databases')
  const pathDatabase =
    databasesIndex >= 0 && normalizedPath[databasesIndex + 1]
      ? normalizedPath[databasesIndex + 1]
      : undefined

  if (pathDatabase && !isCategoryLabel(pathDatabase)) {
    return pathDatabase
  }

  return connection.database?.trim() || 'master'
}

function sqlServerTableCategoryForKind(
  kind: string,
  schema: string | undefined,
  objectName: string | undefined,
) {
  if (kind === 'file-table' || kind === 'filetable') {
    return 'FileTables'
  }

  if (kind === 'external-table' || kind === 'foreign-table') {
    return 'External Tables'
  }

  if (kind === 'graph-table' || kind === 'node-table' || kind === 'edge-table') {
    return 'Graph Tables'
  }

  if (schema?.trim().toLowerCase() === 'sys' || objectName?.trim().toLowerCase().startsWith('sys')) {
    return 'System Tables'
  }

  return 'Tables'
}

function sqlServerTablePath(database: string, tableCategory: string, tableLabel: string) {
  return tableCategory === 'Tables'
    ? ['Databases', database, 'Tables', tableLabel]
    : ['Databases', database, 'Tables', tableCategory, tableLabel]
}

function sqlServerQualifiedDisplayName(schema: string | undefined, objectName: string | undefined) {
  const object = objectName?.trim() || 'Object'
  const [labelSchema, labelObject] = splitSqlName(object)

  if (labelObject) {
    return `${labelSchema}.${labelObject}`
  }

  return `${schema?.trim() || 'dbo'}.${object}`
}

function isSqlProgrammabilityCategory(category: string) {
  return ['Stored Procedures', 'Functions', 'Sequences', 'Types', 'Synonyms'].includes(category)
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
  const canCreateInSchema = !isSqlSystemSchema(connection, schema)
  const actions: ConnectionTreeAction[] = []

  if (kind === 'schema') {
    actions.push(
      templateAction('create-table', 'Create Table...', `create table ${qualifySqlName(connection, node.label, 'new_table')} (\n  id integer primary key\n);`),
      templateAction('create-view', 'Create View...', `create view ${qualifySqlName(connection, node.label, 'new_view')} as\nselect 1 as value;`),
    )
  }

  if (canCreateInSchema && kind === 'tables') {
    actions.push(
      templateAction('create-table', 'Create Table...', `create table ${qualifySqlName(connection, schema, 'new_table')} (\n  id integer primary key\n);`),
    )
  }

  if (canCreateInSchema && kind === 'views') {
    actions.push(
      templateAction('create-view', 'Create View...', `create view ${qualifySqlName(connection, schema, 'new_view')} as\nselect 1 as value;`),
    )
  }

  if (canCreateInSchema && (kind === 'programmability' || kind === 'stored-procedures')) {
    actions.push(
      templateAction('create-procedure', 'Create Stored Procedure...', sqlCreateStoredProcedureTemplate(connection, schema)),
    )
  }

  if (canCreateInSchema && (kind === 'programmability' || kind === 'functions')) {
    actions.push(
      templateAction('create-function', 'Create Function...', sqlCreateFunctionTemplate(connection, schema)),
    )
  }

  if (canCreateInSchema && kind === 'triggers') {
    actions.push(
      templateAction('create-trigger', 'Create Trigger...', sqlCreateTriggerTemplate(connection, schema)),
    )
  }

  if (canCreateInSchema && kind === 'indexes') {
    actions.push(
      templateAction('create-index', 'Create Index...', `create index idx_new_table_new_column on ${qualifySqlName(connection, schema, 'table_name')} (column_name);`),
    )
  }

  if (canCreateInSchema && kind === 'sequences') {
    actions.push(
      templateAction('create-sequence', 'Create Sequence...', `create sequence ${qualifySqlName(connection, schema, 'new_sequence')};`),
    )
  }

  if (canCreateInSchema && kind === 'types') {
    actions.push(
      templateAction('create-type', 'Create Type...', sqlCreateTypeTemplate(connection, schema)),
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

  if (kind === 'stored-procedure' || kind === 'procedure') {
    actions.push(
      templateAction('execute-procedure', 'Execute Procedure', sqlExecuteStoredProcedureTemplate(connection, qualified)),
      templateAction('alter-procedure', 'Alter Procedure...', sqlAlterStoredProcedureTemplate(connection, qualified)),
      templateAction('drop-procedure', 'Drop Procedure...', sqlDropStoredProcedureTemplate(connection, qualified), true),
    )
  }

  if (kind === 'function') {
    actions.push(
      templateAction('select-function', 'Select Function', `select * from ${qualified}();`),
      templateAction('alter-function', 'Alter Function...', sqlCreateFunctionTemplate(connection, schema, targetObjectName)),
      templateAction('drop-function', 'Drop Function...', `-- Review before running.\ndrop function ${qualified};`, true),
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
      templateAction('match-graph', 'Match Nodes', `match (n:${node.label}) return n limit 25;`),
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

  if (parentLabel && SQL_SCHEMA_ROOTS.has(parentLabel)) {
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

function sqlSchemaRootLabel(connection: ConnectionProfile, schema: string | undefined) {
  return isSqlSystemSchema(connection, schema) ? 'System Schemas' : 'User Schemas'
}

function isSqlSystemObject(
  connection: ConnectionProfile,
  kind: string,
  objectName: string | undefined,
  schema: string | undefined,
) {
  if (!SQL_TABLE_KINDS.has(kind) && kind !== 'column' && kind !== 'index' && kind !== 'constraint') {
    return false
  }

  if (isSqlSystemSchema(connection, schema)) {
    return true
  }

  if (connection.engine === 'sqlite') {
    return objectName?.toLowerCase().startsWith('sqlite_') ?? false
  }

  return false
}

function isSqlSystemSchema(connection: ConnectionProfile, schema: string | undefined) {
  const name = schema?.trim().toLowerCase()

  if (!name) {
    return false
  }

  if (connection.engine === 'postgresql' || connection.engine === 'cockroachdb' || connection.engine === 'timescaledb') {
    return name === 'information_schema' || name === 'pg_catalog' || name.startsWith('pg_')
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return ['information_schema', 'mysql', 'performance_schema', 'sys'].includes(name)
  }

  if (connection.engine === 'sqlserver') {
    return name === 'sys' || name === 'information_schema'
  }

  if (connection.engine === 'sqlite' || connection.engine === 'duckdb') {
    return name === 'temp' || name === 'information_schema'
  }

  return name === 'information_schema'
}

function sqlObjectPartsFromExplorerNode(
  connection: ConnectionProfile,
  node: ExplorerNode,
  normalizedPath: string[],
) {
  const kind = normalizeExplorerKind(connection, node.kind)
  const scopeName = node.scope?.split(':').slice(1).join(':')
  const [scopeSchema, scopeObject, scopeChild] = splitSqlName(scopeName)
  const pathObject = normalizedPath.find((segment) => splitSqlName(segment)[1])
  const [pathSchema, pathObjectName] = splitSqlName(pathObject)
  const [labelSchema, labelObject] = splitSqlName(node.label)
  const categoryFreePath = normalizedPath.filter((segment) => !isCategoryLabel(segment))
  const pathSchemaCandidate =
    categoryFreePath.length > 1 && !categoryFreePath.at(-1)?.includes('.')
      ? categoryFreePath.at(-2)
      : categoryFreePath[0]
  const schema =
    scopeSchema ||
    pathSchema ||
    labelSchema ||
    pathSchemaCandidate ||
    defaultSqlSchema(connection)
  const objectName =
    scopeObject ||
    pathObjectName ||
    labelObject ||
    (categoryFreePath.length > 1 ? categoryFreePath.at(-1) : node.label)
  const table =
    kind === 'column' || kind === 'index' || kind === 'constraint' || kind === 'trigger'
      ? scopeObject || pathObjectName || pathObject || categoryFreePath.at(-2) || objectName
      : undefined

  return { schema, objectName: scopeChild && !table ? scopeChild : objectName, table }
}

function sqlObjectPartsFromPlacementPath(connection: ConnectionProfile, path: string[]) {
  const label = path.at(-1) ?? 'Object'
  const [labelSchema, labelObject] = splitSqlName(label)
  const schema = labelSchema || schemaFromPlacementPath(connection, path)

  return {
    schema,
    objectName: labelObject || label,
  }
}

function splitSqlName(value: string | undefined) {
  const parts = value?.split('.').map((part) => part.trim()).filter(Boolean) ?? []

  if (parts.length >= 2) {
    return [parts[0], parts[1], parts.slice(2).join('.')] as const
  }

  return [undefined, parts[0], undefined] as const
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
  const schemaRootIndex = path.findIndex((segment) => SQL_SCHEMA_ROOTS.has(segment))

  if (schemaRootIndex >= 0) {
    return path[schemaRootIndex + 1] ?? defaultSqlSchema(connection)
  }

  for (let index = path.length - 1; index >= 0; index -= 1) {
    const [schema] = splitSqlName(path[index])

    if (schema) {
      return schema
    }
  }

  return defaultSqlSchema(connection)
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

  if (parentLabel && SQL_SCHEMA_ROOTS.has(parentLabel)) {
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

function sqlCreateStoredProcedureTemplate(
  connection: ConnectionProfile,
  schema: string,
  procedureName = 'new_procedure',
) {
  const qualified = qualifySqlName(connection, schema, procedureName)

  if (connection.engine === 'sqlserver') {
    return `create procedure ${qualified}\nas\nbegin\n  set nocount on;\n  select 1 as value;\nend;`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `delimiter //\ncreate procedure ${qualified}()\nbegin\n  select 1 as value;\nend//\ndelimiter ;`
  }

  if (connection.engine === 'oracle') {
    return `create or replace procedure ${qualified} as\nbegin\n  null;\nend;`
  }

  return `create or replace procedure ${qualified}()\nlanguage plpgsql\nas $$\nbegin\n  raise notice 'new_procedure ran';\nend;\n$$;`
}

function sqlCreateFunctionTemplate(
  connection: ConnectionProfile,
  schema: string,
  functionName = 'new_function',
) {
  const qualified = qualifySqlName(connection, schema, functionName)

  if (connection.engine === 'sqlserver') {
    return `create function ${qualified}()\nreturns int\nas\nbegin\n  return 1;\nend;`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `create function ${qualified}()\nreturns int deterministic\nreturn 1;`
  }

  return `create or replace function ${qualified}()\nreturns integer\nlanguage sql\nas $$\n  select 1;\n$$;`
}

function sqlCreateTriggerTemplate(connection: ConnectionProfile, schema: string) {
  const tableName = qualifySqlName(connection, schema, 'table_name')

  if (connection.engine === 'sqlserver') {
    return `create trigger ${qualifySqlName(connection, schema, 'new_trigger')}\non ${tableName}\nafter insert\nas\nbegin\n  set nocount on;\nend;`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `create trigger ${qualifySqlName(connection, schema, 'new_trigger')}\nbefore insert on ${tableName}\nfor each row\nbegin\n  set new.created_at = coalesce(new.created_at, current_timestamp);\nend;`
  }

  return `create trigger new_trigger\nbefore insert on ${tableName}\nfor each row\nexecute function ${qualifySqlName(connection, schema, 'trigger_function')}();`
}

function sqlCreateTypeTemplate(connection: ConnectionProfile, schema: string) {
  if (connection.engine === 'sqlserver') {
    return `create type ${qualifySqlName(connection, schema, 'new_table_type')} as table (\n  id int not null\n);`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb' || connection.engine === 'sqlite') {
    return `-- ${connection.engine} does not expose standalone user-defined types like PostgreSQL.\n-- Use enum/check constraints or table definitions instead.`
  }

  return `create type ${qualifySqlName(connection, schema, 'new_status')} as enum ('active', 'inactive');`
}

function sqlExecuteStoredProcedureTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'sqlserver') {
    return `exec ${qualified};`
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return `call ${qualified}();`
  }

  return `call ${qualified}();`
}

function sqlAlterStoredProcedureTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'sqlserver') {
    return `alter procedure ${qualified}\nas\nbegin\n  set nocount on;\n  select 1 as value;\nend;`
  }

  return `-- Edit and review before running.\n${sqlCreateStoredProcedureTemplate(connection, defaultSqlSchema(connection), qualified.split('.').at(-1) ?? 'new_procedure')}`
}

function sqlDropStoredProcedureTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'sqlserver') {
    return `-- Review before running.\ndrop procedure ${qualified};`
  }

  return `-- Review before running.\ndrop procedure ${qualified};`
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
