import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import type { ConnectionTreeNode } from './SideBar.connection-tree'
import { objectViewAction } from './SideBar.datastore-tree-actions'

export type ConnectionTreeActionCommand = 'open-template' | 'copy-qualified-name' | 'open-object-view'

export interface ConnectionTreeAction {
  id: string
  label: string
  command: ConnectionTreeActionCommand
  queryTemplate?: string
  objectViewKind?: string
  objectViewNodeId?: string
  objectViewLabel?: string
  objectViewPath?: string[]
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
  'Node Tables': 'SQL graph node tables',
  'Edge Tables': 'SQL graph edge tables',
  Hypertables: 'Time-series hypertables',
  Views: 'Saved query projections',
  'Materialized Views': 'Persisted query projections',
  'External Resources': 'External data sources, file formats, and integration metadata',
  'Stored Procedures': 'Callable stored routines',
  Programmability: 'Procedures, functions, triggers, and programmable objects',
  Functions: 'Callable scalar or table routines',
  'Scalar-valued Functions': 'Scalar T-SQL functions',
  'Table-valued Functions': 'Inline and multi-statement table-valued functions',
  'Aggregate Functions': 'CLR aggregate functions',
  'CLR Functions': 'CLR-backed functions',
  'Database Triggers': 'Database-scoped trigger routines',
  Assemblies: 'CLR assemblies and related programmable objects',
  Synonyms: 'Aliases for database objects',
  Sequences: 'Generated numeric sequences',
  Types: 'User-defined types',
  'XML Schemas': 'XML schema collections',
  'Full-Text Search': 'Full-text catalogs and indexes',
  'Main Database': 'SQLite main database file',
  'Attached Databases': 'SQLite attached database files',
  Pragmas: 'SQLite PRAGMA configuration and checks',
  Schema: 'SQLite schema definitions',
  'Virtual Tables': 'SQLite extension-backed virtual tables',
  'FTS Tables': 'SQLite full-text search virtual tables',
  'RTree Tables': 'SQLite RTree virtual tables',
  'Generated Columns': 'SQLite generated and hidden columns',
  'Foreign Keys': 'Foreign key relationships',
  Statistics: 'Object statistics and storage hints',
  DDL: 'Object definition SQL',
  Users: 'Database users',
  Roles: 'Database roles',
  Certificates: 'Database certificates',
  'Symmetric Keys': 'Database symmetric keys',
  'Asymmetric Keys': 'Database asymmetric keys',
  Credentials: 'Scoped credentials',
  Audits: 'Database audit specifications',
  Extensions: 'Installed database extensions',
  Columns: 'Object fields and data types',
  Indexes: 'Access paths and constraints',
  Constraints: 'Rules and relational constraints',
  Triggers: 'Event-driven object routines',
  Collections: 'Document collections',
  Documents: 'Collection document query surface',
  'Schema Preview': 'Inferred document fields and BSON types',
  Validators: 'Collection validation rules',
  'Validation Rules': 'Collection validation rules',
  Aggregations: 'Aggregation pipelines and templates',
  GridFS: 'GridFS file and chunk collections',
  'File Storage': 'LiteDB stored files and chunk metadata',
  Account: 'Cosmos DB account topology and API surface',
  Containers: 'Cosmos DB containers and partitioned item stores',
  Items: 'Container item query surface',
  'Partition Key': 'Container partition key and routing posture',
  'Indexing Policy': 'Container indexing policy',
  Throughput: 'Request-unit throughput and throttling posture',
  'Change Feed': 'Change feed processor readiness',
  'Conflict Feed': 'Multi-region conflict metadata',
  Consistency: 'Cosmos DB consistency settings',
  Regions: 'Read and write region topology',
  Pipeline: 'View backing aggregation pipeline',
  'Results Preview': 'Bounded view results query',
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
  Filegroups: 'Database filegroups',
  Files: 'Database files',
  'Partition Schemes': 'Partition schemes',
  'Partition Functions': 'Partition functions',
  'Query Store': 'Runtime stats, plans, and regressed queries',
  CDC: 'Change Data Capture objects',
  'Change Tracking': 'Change tracking objects and settings',
  'Service Broker': 'SQL Server messaging objects',
  'Linked Servers': 'Remote server definitions and providers',
  'Server Objects': 'Linked servers, endpoints, and server-level objects',
  Replication: 'Replication publications and subscriptions',
  'Availability Groups': 'Always On availability groups and replicas',
  'Always On High Availability': 'Availability groups and replicas',
  Management: 'Maintenance, policy, and data collection tooling',
  'SQL Server Agent': 'Jobs, alerts, and operators',
  Agent: 'Jobs, schedules, alerts, operators, and proxies',
  Schedules: 'Agent schedules',
  Operators: 'Agent operators',
  Proxies: 'Agent proxies',
  'Extended Events': 'Extended Events sessions and traces',
  'XEvent Profiler': 'Extended Events sessions and traces',
  'Integration Services Catalogs': 'SSIS package catalogs',
  'Analysis Services': 'SSAS endpoints and model metadata',
  'Reporting Services': 'SSRS catalog metadata',
  Diagnostics: 'Health and performance metadata',
  Cluster: 'Cluster-level health, topology, and configuration',
  Nodes: 'Cluster nodes, locality, and liveness',
  Ranges: 'Range distribution, replicas, and leaseholders',
  'Regions / Localities': 'Regional placement and locality tiers',
  'Cluster Settings': 'Runtime cluster configuration',
  'Zone Configurations': 'Replication and placement configuration',
  Grants: 'Granted privileges and default privilege surfaces',
  'Statement Stats': 'Statement fingerprints, latency, rows, and retries',
  Transactions: 'Transaction state, retry pressure, and contention',
  Contention: 'Waiting keys and blocking transaction metadata',
  Performance: 'Sessions, waits, SQL Monitor, AWR, and ASH',
  Scheduler: 'Jobs, programs, chains, and windows',
  Queues: 'Advanced Queuing objects',
  'Data Guard': 'Standby and protection status',
  RAC: 'Oracle Real Application Clusters metadata',
  Flashback: 'Restore points and flashback metadata',
  Packages: 'PL/SQL package specs and bodies',
  Spec: 'Package specification',
  Body: 'Package body',
  Dependencies: 'Dependent and referenced objects',
  'Compilation Errors': 'Compilation and validation errors',
  Procedures: 'PL/SQL procedures',
  'Java Sources': 'Java stored source objects',
  'JSON Collections': 'Oracle JSON collection-style objects',
  'XML DB': 'Oracle XML DB resources',
  'Database Links': 'Remote database links',
  Profiles: 'Password and resource profiles',
  Privileges: 'System and object privileges',
  Tablespaces: 'Oracle tablespace storage',
  'Data Files': 'Oracle data file metadata',
  Segments: 'Segment sizes and owners',
  Quotas: 'Tablespace quotas',
  'Top SQL': 'High-activity SQL statements',
  'AWR / ASH': 'AWR and ASH diagnostic views',
  'SQL Monitor': 'SQL Monitor reports',
  'Invalid Objects': 'Objects with invalid compilation status',
}

const SQL_TABLE_KINDS = new Set([
  'table',
  'foreign-table',
  'partitioned-table',
  'strict-table',
  'virtual-table',
  'fts-table',
  'rtree-table',
])
const SQL_VIEW_KINDS = new Set(['view'])
const SQL_MATERIALIZED_VIEW_KINDS = new Set(['materialized-view', 'materialized view'])
const SQL_SCHEMA_ROOTS = new Set(['Schemas', 'User Schemas', 'System Schemas'])
const SQL_TABLE_CONTAINER_LABELS = new Set([
  'Tables',
  'System Tables',
  'External Tables',
  'FileTables',
  'Graph Tables',
  'Node Tables',
  'Edge Tables',
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

  if (normalized === 'system-database') {
    return 'database'
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

  if (normalized === 'schema-preview') {
    return 'schema-preview'
  }

  if (normalized === 'validation-rules' || normalized === 'validators') {
    return 'validation-rules'
  }

  if (normalized === 'gridfs-collection') {
    return 'gridfs-collection'
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
    const database = documentDatabaseFromPlacementPath(connection, path)
    node.kind = 'collection'
    node.scope = `collection:${database}:${label}`
    node.queryable = true
    node.builderKind = connection.engine === 'mongodb' ? 'mongo-find' : undefined
    node.queryTemplate = documentFindQueryTemplate(label, 20, database)
  }

  if (connection.engine === 'mongodb' && parentLabel === 'Views') {
    const database = documentDatabaseFromPlacementPath(connection, path)
    node.kind = 'view'
    node.scope = `view:${database}:${label}`
    node.expandable = true
    node.queryable = false
    node.queryTemplate = documentFindQueryTemplate(label, 20, database)
  }

  if (connection.engine === 'mongodb' && parentLabel === 'GridFS') {
    const database = documentDatabaseFromPlacementPath(connection, path)
    node.kind = 'gridfs-collection'
    node.scope = `collection:${database}:${label}`
    node.queryable = true
    node.builderKind = 'mongo-find'
    node.queryTemplate = documentFindQueryTemplate(label, 20, database)
  }

  if (connection.engine === 'cosmosdb' && parentLabel === 'Containers') {
    const database = cosmosDatabaseFromPlacementPath(connection, path)
    node.kind = 'container'
    node.scope = `cosmos:container:${database}:${label}`
    node.expandable = true
    node.queryable = true
    node.queryTemplate = documentFindQueryTemplate(label, 20, database)
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
    return `select top 100 * from [${schema.replace(/]/g, ']]')}].[${objectName.replace(/]/g, ']]')}];`
  }

  if (connection.engine === 'sqlite') {
    return `select * from [${schema.replace(/]/g, ']]')}].[${objectName.replace(/]/g, ']]')}] limit 100;`
  }

  if (connection.engine === 'oracle') {
    return `select * from ${qualifySqlName(connection, schema, objectName)} where rownum <= 100;`
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
): string[] {
  const normalizedPath = cleanExplorerPath(connection, node.path)

  switch (connection.family) {
    case 'document':
      return documentPlacement(connection, node, kind, normalizedPath)
    case 'keyvalue':
      return keyValuePlacement(node, kind, normalizedPath)
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
  if (connection.engine === 'oracle' && normalizedPath.length > 0) {
    return normalizedPath
  }

  if (connection.engine === 'sqlserver') {
    return sqlServerPlacement(connection, node, kind, normalizedPath)
  }

  if (connection.engine === 'cockroachdb') {
    return cockroachPlacement(connection, node, kind, normalizedPath)
  }

  if (connection.engine === 'sqlite') {
    return sqlitePlacement(connection, node, kind, normalizedPath)
  }

  if (connection.engine === 'duckdb') {
    return duckDbPlacement(kind, normalizedPath)
  }

  if (isPostgresFamily(connection) && isSqlCategoryExplorerNode(node, normalizedPath)) {
    const [, schema] = node.scope?.split(':') ?? []

    if (schema) {
      return [sqlSchemaRootLabel(connection, schema), schema]
    }

    return normalizedPath
  }

  if (isSqlCategoryExplorerNode(node, normalizedPath)) {
    return normalizedPath
  }

  if (kind === 'schema') {
    return [sqlSchemaRootLabel(connection, node.label)]
  }

  if (kind === 'database' || kind === 'catalog') {
    return ['Databases']
  }

  if (kind === 'extension') {
    return ['Extensions']
  }

  if (kind === 'security') {
    return []
  }

  if (kind === 'role' || kind === 'roles' || kind === 'grant' || kind === 'permission') {
    return ['Security']
  }

  if (kind === 'diagnostics') {
    return []
  }

  if (kind === 'diagnostic' || kind === 'session' || kind === 'lock') {
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

function duckDbPlacement(kind: string, normalizedPath: string[]) {
  if (kind === 'database') {
    return ['Main Database']
  }

  if (kind === 'schema') {
    return ['Main Database', 'Schemas']
  }

  const schema = normalizedPath.find((segment) => !isCategoryLabel(segment)) ?? 'main'

  if (kind === 'table') {
    return ['Main Database', 'Schemas', schema, 'Tables']
  }

  if (kind === 'view') {
    return ['Main Database', 'Schemas', schema, 'Views']
  }

  if (kind === 'index') {
    return ['Main Database', 'Schemas', schema, 'Indexes']
  }

  if (kind === 'function') {
    return ['Main Database', 'Schemas', schema, 'Functions & Macros']
  }

  if (kind === 'extension') {
    return ['Main Database', 'Extensions']
  }

  if (kind === 'attached-databases') {
    return ['Main Database', 'Attached Databases']
  }

  if (kind === 'files') {
    return ['Main Database', 'Files']
  }

  if (kind === 'pragmas' || kind === 'pragma') {
    return ['Main Database', 'Pragmas']
  }

  if (kind === 'statistics') {
    return ['Main Database', 'Statistics']
  }

  if (kind === 'diagnostics') {
    return []
  }

  return normalizedPath.length ? ['Main Database', ...normalizedPath] : ['Main Database']
}

function cockroachPlacement(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
  normalizedPath: string[],
) {
  const database = cockroachDatabaseName(connection, normalizedPath)

  if (kind === 'database' || kind === 'catalog') {
    return ['Databases']
  }

  if (kind === 'schema') {
    return ['Databases', database, isSqlSystemSchema(connection, node.label) ? 'System Schemas' : 'User Schemas']
  }

  if (kind === 'cluster' || ['nodes', 'ranges', 'regions', 'jobs', 'cluster-settings'].includes(kind)) {
    return kind === 'cluster' ? [] : ['Cluster']
  }

  if (kind === 'security' || kind === 'roles' || kind === 'grants' || kind === 'permission' || kind === 'certificates') {
    return kind === 'security' ? [] : ['Security']
  }

  if (kind === 'diagnostic' || kind === 'diagnostics' || ['sessions', 'statements', 'transactions', 'contention', 'locks', 'statistics'].includes(kind)) {
    return kind === 'diagnostics' ? [] : ['Diagnostics']
  }

  if (isSqlCategoryExplorerNode(node, normalizedPath)) {
    return normalizedPath
  }

  const objectParts = sqlObjectPartsFromExplorerNode(connection, node, normalizedPath)
  const schema = objectParts.schema
  const schemaRoot = isSqlSystemSchema(connection, schema) ? 'System Schemas' : 'User Schemas'
  const table = objectParts.table ?? objectParts.objectName
  const schemaPath = ['Databases', database, schemaRoot, schema]

  if (kind === 'column') {
    return [...schemaPath, 'Tables', table || 'Object', 'Columns']
  }

  if (kind === 'index') {
    return table ? [...schemaPath, 'Tables', table, 'Indexes'] : [...schemaPath, 'Indexes']
  }

  if (kind === 'constraint') {
    return table ? [...schemaPath, 'Tables', table, 'Constraints'] : [...schemaPath, 'Constraints']
  }

  if (SQL_TABLE_KINDS.has(kind)) {
    return [...schemaPath, 'Tables']
  }

  if (SQL_VIEW_KINDS.has(kind)) {
    return [...schemaPath, 'Views']
  }

  if (kind === 'function') {
    return [...schemaPath, 'Functions']
  }

  if (kind === 'sequence') {
    return [...schemaPath, 'Sequences']
  }

  if (kind === 'type') {
    return [...schemaPath, 'Types']
  }

  if (kind === 'zone-configuration') {
    return [...schemaPath, 'Zone Configurations']
  }

  return [...schemaPath, sqlCategoryForKind(connection, kind, node.label, schema)]
}

function sqlitePlacement(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
  normalizedPath: string[],
) {
  if (normalizedPath.length > 0) {
    return normalizedPath
  }

  if (kind === 'database') {
    return node.label === 'Main Database' || node.label === 'main'
      ? ['Main Database']
      : ['Attached Databases']
  }

  if (kind === 'pragma') {
    return ['Main Database', 'Pragmas']
  }

  const objectParts = sqlObjectPartsFromExplorerNode(connection, node, normalizedPath)
  const table = objectParts.table || objectParts.objectName || node.label

  if (kind === 'column' || kind === 'generated-column') {
    return ['Main Database', 'Tables', table, 'Columns']
  }

  if (kind === 'foreign-key') {
    return ['Main Database', 'Tables', table, 'Foreign Keys']
  }

  if (kind === 'constraint') {
    return ['Main Database', 'Tables', table, 'Constraints']
  }

  if (kind === 'index') {
    return objectParts.table
      ? ['Main Database', 'Tables', table, 'Indexes']
      : ['Main Database', 'Indexes']
  }

  if (kind === 'trigger') {
    return objectParts.table
      ? ['Main Database', 'Tables', table, 'Triggers']
      : ['Main Database', 'Triggers']
  }

  if (kind === 'view') {
    return ['Main Database', 'Views']
  }

  if (kind === 'virtual-table') {
    return ['Main Database', 'Virtual Tables']
  }

  if (kind === 'fts-table' || kind === 'rtree-table') {
    return ['Main Database', 'Virtual Tables']
  }

  return ['Main Database', sqlCategoryForKind(connection, kind, node.label, objectParts.schema)]
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

  if (isSqlServerCategoryExplorerNode(node, normalizedPath)) {
    return normalizedPath
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

function isSqlServerCategoryExplorerNode(node: ExplorerNode, normalizedPath: string[]) {
  return isSqlCategoryExplorerNode(node, normalizedPath)
}

function isSqlCategoryExplorerNode(node: ExplorerNode, normalizedPath: string[]) {
  return Boolean(
    normalizedPath.length > 0 &&
      node.expandable &&
      isCategoryLabel(node.label),
  )
}

function documentPlacement(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
  normalizedPath: string[],
) {
  if (connection.engine === 'mongodb') {
    return mongoPlacement(connection, node, kind, normalizedPath)
  }

  if (connection.engine === 'litedb') {
    return liteDbPlacement(connection, node, kind, normalizedPath)
  }

  if (connection.engine === 'cosmosdb') {
    return cosmosPlacement(connection, node, kind, normalizedPath)
  }

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

function cosmosPlacement(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
  normalizedPath: string[],
): string[] {
  const account = cosmosAccountFromNode(connection, normalizedPath)

  if (node.id === 'cosmos:account' || kind === 'account') {
    return []
  }

  if (['databases', 'regions', 'consistency', 'security', 'diagnostics'].includes(kind)) {
    return [account]
  }

  if (node.id.startsWith('cosmos:database:') || kind === 'database') {
    return [account, 'Databases']
  }

  const database = cosmosDatabaseFromNode(connection, node, normalizedPath)

  if (node.id.startsWith('cosmos:containers:') || kind === 'containers') {
    return [account, 'Databases', database]
  }

  if (node.id.startsWith('cosmos:container:') || kind === 'container') {
    return [account, 'Databases', database, 'Containers']
  }

  const container = cosmosContainerFromNode(node, normalizedPath)

  if (['items', 'partition-key', 'indexing-policy', 'throughput', 'change-feed', 'stored-procedures', 'triggers', 'udfs', 'conflicts'].includes(kind)) {
    const base = container
      ? [account, 'Databases', database, 'Containers', container]
      : [account, 'Databases', database]

    return kind === 'throughput' && !container ? [account, 'Databases', database] : base
  }

  return normalizedPath.length ? normalizedPath : [account]
}

function cosmosAccountFromNode(connection: ConnectionProfile, normalizedPath: string[]) {
  const account = normalizedPath.find((segment) => !isCategoryLabel(segment))

  return account ?? connection.host?.split('.').at(0) ?? connection.name ?? 'Account'
}

function cosmosDatabaseFromNode(
  connection: ConnectionProfile,
  node: ExplorerNode,
  normalizedPath: string[],
) {
  const databasesIndex = normalizedPath.indexOf('Databases')

  if (databasesIndex >= 0 && normalizedPath[databasesIndex + 1]) {
    return normalizedPath[databasesIndex + 1] ?? 'catalog'
  }

  const parts = node.id.split(':')
  const database = (() => {
    if (node.id.startsWith('cosmos:database:') || node.id.startsWith('cosmos:containers:')) {
      return parts.at(-1)
    }

    if (
      node.id.startsWith('cosmos:container:') ||
      node.id.startsWith('cosmos:items:') ||
      node.id.startsWith('cosmos:partition-key:') ||
      node.id.startsWith('cosmos:indexing-policy:') ||
      node.id.startsWith('cosmos:throughput:') ||
      node.id.startsWith('cosmos:change-feed:') ||
      node.id.startsWith('cosmos:stored-procedures:') ||
      node.id.startsWith('cosmos:triggers:') ||
      node.id.startsWith('cosmos:udfs:') ||
      node.id.startsWith('cosmos:conflicts:')
    ) {
      return parts.at(-2)
    }

    return undefined
  })()

  if (database && !isCategoryLabel(database)) {
    return database
  }

  return connection.database?.trim() || 'catalog'
}

function cosmosContainerFromNode(node: ExplorerNode, normalizedPath: string[]) {
  const containersIndex = normalizedPath.indexOf('Containers')

  if (containersIndex >= 0 && normalizedPath[containersIndex + 1]) {
    return normalizedPath[containersIndex + 1] ?? undefined
  }

  if (node.id.startsWith('cosmos:container:') || node.id.startsWith('cosmos:items:')) {
    return node.id.split(':').at(-1)
  }

  return undefined
}

function cosmosDatabaseFromPlacementPath(connection: ConnectionProfile, path: string[]) {
  const databasesIndex = path.indexOf('Databases')

  if (databasesIndex >= 0 && path[databasesIndex + 1]) {
    return path[databasesIndex + 1] ?? 'catalog'
  }

  return connection.database?.trim() || 'catalog'
}

function liteDbPlacement(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
  normalizedPath: string[],
): string[] {
  const database = liteDbDatabaseLabel(connection, normalizedPath)

  if (node.id === 'litedb:database' || kind === 'database') {
    return []
  }

  if (node.id === 'litedb:diagnostics' || kind === 'diagnostics') {
    return []
  }

  if (node.id === 'litedb:collections' || kind === 'collections') {
    return [database]
  }

  if (node.id.startsWith('litedb:collection:') || kind === 'collection') {
    return [database, 'Collections']
  }

  if (node.id.startsWith('litedb:documents:') || kind === 'documents') {
    return [database, 'Collections', liteDbCollectionFromNode(node, normalizedPath)]
  }

  if (node.id.startsWith('litedb:schema:') || kind === 'schema') {
    return [database, 'Collections', liteDbCollectionFromNode(node, normalizedPath)]
  }

  if (node.id === 'litedb:indexes') {
    return [database]
  }

  if (node.id.startsWith('litedb:collection-indexes:')) {
    return [database, 'Collections', liteDbCollectionFromNode(node, normalizedPath)]
  }

  if (node.id.startsWith('litedb:index:') || kind === 'index') {
    const collection = node.id.startsWith('litedb:index:')
      ? node.id.split(':').at(-2)
      : liteDbCollectionFromNode(node, normalizedPath)

    return collection
      ? [database, 'Collections', collection, 'Indexes']
      : [database, 'Indexes']
  }

  if (node.id === 'litedb:file-storage' || kind === 'file-storage') {
    return [database]
  }

  if (node.id === 'litedb:files' || kind === 'files') {
    return [database, 'File Storage']
  }

  if (node.id === 'litedb:chunks' || kind === 'chunks') {
    return [database, 'File Storage']
  }

  if (node.id === 'litedb:storage' || node.id.startsWith('litedb:collection-storage:') || kind === 'storage') {
    return node.id.startsWith('litedb:collection-storage:')
      ? [database, 'Collections', liteDbCollectionFromNode(node, normalizedPath)]
      : [database]
  }

  if (node.id === 'litedb:settings' || kind === 'settings') {
    return [database]
  }

  return normalizedPath.length ? normalizedPath : compactPath(database)
}

function liteDbDatabaseLabel(connection: ConnectionProfile, normalizedPath: string[]) {
  const root = normalizedPath.find((segment) => !isCategoryLabel(segment))

  if (root) {
    return root
  }

  return fileName(connection.database || connection.host || connection.name || 'local.db')
}

function liteDbCollectionFromNode(node: ExplorerNode, normalizedPath: string[]): string {
  const collectionIndex = normalizedPath.indexOf('Collections')

  if (collectionIndex >= 0 && normalizedPath[collectionIndex + 1]) {
    return normalizedPath[collectionIndex + 1] ?? 'collection'
  }

  const scopedCollection = node.id.split(':').at(-1)

  if (scopedCollection && scopedCollection !== node.id) {
    return scopedCollection
  }

  return node.label || 'collection'
}

function mongoPlacement(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
  normalizedPath: string[],
): string[] {
  if (kind === 'database') {
    return normalizedPath[0] === 'System Databases' ? ['System Databases'] : []
  }

  if (normalizedPath.length) {
    return normalizedPath
  }

  const database = databaseFromDocumentPath(connection, node, normalizedPath)
  const collection = collectionFromDocumentNode(connection, node, normalizedPath)

  if (kind === 'collection') {
    return [database, 'Collections'].filter(Boolean) as string[]
  }

  if (kind === 'view') {
    return [database, 'Views'].filter(Boolean) as string[]
  }

  if (kind === 'gridfs-collection') {
    return [database, 'GridFS'].filter(Boolean) as string[]
  }

  if (['documents', 'schema-preview', 'indexes', 'validation-rules', 'aggregations'].includes(kind)) {
    return [database, 'Collections', collection].filter(Boolean) as string[]
  }

  if (['pipeline', 'sample-results'].includes(kind)) {
    return [database, 'Views', collection].filter(Boolean) as string[]
  }

  if (kind === 'user' || kind === 'users') {
    return [database, 'Users'].filter(Boolean) as string[]
  }

  if (kind === 'role' || kind === 'roles') {
    return [database, 'Roles'].filter(Boolean) as string[]
  }

  if (kind === 'permission') {
    return normalizedPath.length ? normalizedPath : compactPath(database)
  }

  return compactPath(database ?? defaultDocumentDatabase(connection))
}

function compactPath(...segments: Array<string | undefined>) {
  return segments.filter((segment): segment is string => Boolean(segment))
}

function fileName(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
}

function keyValuePlacement(node: ExplorerNode, kind: string, normalizedPath: string[]) {
  const memcachedPath = memcachedPlacement(node)
  if (memcachedPath) {
    return memcachedPath
  }

  const redisRootPath = redisRootPlacement(node)
  if (redisRootPath) {
    return redisRootPath
  }

  const redisScopedPath = redisScopedPlacement(node, kind)
  if (redisScopedPath) {
    return redisScopedPath
  }

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

function memcachedPlacement(node: ExplorerNode): string[] | undefined {
  if (node.id === 'memcached:server' || node.id === 'memcached:diagnostics') {
    return []
  }

  if (
    node.id === 'memcached:stats' ||
    node.id === 'memcached:slabs' ||
    node.id === 'memcached:items' ||
    node.id === 'memcached:settings' ||
    node.id === 'memcached:connections'
  ) {
    return ['Server']
  }

  if (node.id.startsWith('memcached:slab:')) {
    return ['Server', 'Slabs']
  }

  if (node.id.startsWith('memcached:item-class:')) {
    return ['Server', 'Item Classes']
  }

  return undefined
}

function redisRootPlacement(node: ExplorerNode): string[] | undefined {
  const rootIds = new Set([
    'redis:databases',
    'redis:cluster',
    'redis:sentinel',
    'redis:pubsub',
    'redis:lua-scripts',
    'redis:functions',
    'redis:acl',
    'redis:diagnostics',
  ])

  return rootIds.has(node.id) ? [] : undefined
}

function redisScopedPlacement(node: ExplorerNode, kind: string): string[] | undefined {
  const databaseMatch = /^redis:db:(\d+)(?::(.+))?$/.exec(node.id)

  if (databaseMatch) {
    const databaseLabel = `DB ${databaseMatch[1]}`
    const typeKind = databaseMatch[2]

    return typeKind ? ['Databases', databaseLabel] : ['Databases']
  }

  const keyMatch = /^key:(\d+):/.exec(node.id)
  if (keyMatch) {
    return ['Databases', `DB ${keyMatch[1]}`, redisTypeFolderLabel(kind)]
  }

  if (node.id.startsWith('redis:cluster:')) {
    return ['Cluster']
  }

  if (node.id.startsWith('redis:sentinel:')) {
    return ['Sentinel']
  }

  if (node.id.startsWith('redis:pubsub:')) {
    return ['Pub/Sub']
  }

  if (node.id.startsWith('redis:lua:')) {
    return ['Lua Scripts']
  }

  if (node.id.startsWith('redis:functions:')) {
    return ['Functions']
  }

  if (node.id.startsWith('redis:acl:')) {
    return ['ACL / Security']
  }

  if (node.id.startsWith('redis:diagnostics:')) {
    return ['Diagnostics']
  }

  return undefined
}

function redisTypeFolderLabel(kind: string) {
  switch (kind) {
    case 'string':
      return 'Strings'
    case 'hash':
      return 'Hashes'
    case 'list':
      return 'Lists'
    case 'set':
      return 'Sets'
    case 'zset':
    case 'sorted-set':
      return 'Sorted Sets'
    case 'stream':
      return 'Streams'
    case 'json':
      return 'JSON'
    case 'timeseries':
      return 'Time Series'
    case 'bloom':
      return 'Bloom Filters'
    case 'search-index':
    case 'search-indexes':
      return 'Search Indexes'
    case 'vectorset':
    case 'vector-indexes':
      return 'Vector Indexes'
    default:
      return 'Keys'
  }
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
  if ([
    'graphs',
    'node-labels',
    'relationship-types',
    'property-keys',
    'indexes',
    'constraints',
    'procedures',
    'security',
    'diagnostics',
  ].includes(kind)) {
    return []
  }

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
    return kind === 'constraint' ? ['Constraints'] : ['Indexes']
  }

  return normalizedPath.length ? normalizedPath : ['Graphs']
}

function timeseriesPlacement(
  connection: ConnectionProfile,
  kind: string,
  normalizedPath: string[],
) {
  if (connection.engine === 'prometheus') {
    if ([
      'metrics',
      'labels',
      'targets',
      'rules',
      'alerts',
      'service-discovery',
      'tsdb',
      'diagnostics',
    ].includes(kind)) {
      return []
    }
    if (kind === 'metric') {
      return ['Metrics']
    }
    if (kind === 'label') {
      return ['Labels']
    }
    if (kind === 'series') {
      return normalizedPath.length ? normalizedPath : ['Metrics']
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

  if (connection.engine === 'opentsdb') {
    if ([
      'metrics',
      'tags',
      'aggregators',
      'downsampling',
      'uid-metadata',
      'trees',
      'stats',
      'diagnostics',
    ].includes(kind)) {
      return []
    }
    if (kind === 'metric') {
      return ['Metrics']
    }
    if (kind === 'tag') {
      return normalizedPath.length ? normalizedPath : ['Tags']
    }
    if (kind === 'aggregator') {
      return ['Aggregators']
    }
    if (kind === 'downsampler') {
      return ['Downsampling']
    }
    if (kind === 'uid') {
      return ['UID Metadata']
    }
    if (kind === 'tree') {
      return ['Trees']
    }
    if (kind === 'stat') {
      return ['Stats']
    }
  }

  if (kind === 'bucket') {
    return ['Buckets']
  }

  if (connection.engine === 'influxdb') {
    if (['buckets', 'security', 'diagnostics'].includes(kind)) {
      return []
    }

    if (kind === 'retention-policies' || kind === 'retention') {
      const bucket = normalizedPath.find((segment) => !isCategoryLabel(segment))
      return bucket ? ['Buckets', bucket, 'Retention Policies'] : ['Retention Policies']
    }

    if (kind === 'tasks' || kind === 'task') {
      return ['Tasks']
    }
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
    return connection.engine === 'oracle' ? 'Procedures' : 'Stored Procedures'
  }
  if (kind === 'package' || kind === 'packages') {
    return 'Packages'
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

function cockroachDatabaseName(connection: ConnectionProfile, normalizedPath: string[]) {
  const databasesIndex = normalizedPath.indexOf('Databases')
  const pathDatabase =
    databasesIndex >= 0 && normalizedPath[databasesIndex + 1]
      ? normalizedPath[databasesIndex + 1]
      : undefined

  if (pathDatabase && !isCategoryLabel(pathDatabase)) {
    return pathDatabase
  }

  return connection.database?.trim() || 'defaultdb'
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
  return ['Stored Procedures', 'Procedures', 'Functions', 'Sequences', 'Types', 'Synonyms', 'Packages'].includes(category)
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

  if (canCreateInSchema && (kind === 'programmability' || kind === 'stored-procedures' || kind === 'procedures')) {
    actions.push(
      templateAction('create-procedure', connection.engine === 'oracle' ? 'Create Procedure...' : 'Create Stored Procedure...', sqlCreateStoredProcedureTemplate(connection, schema)),
    )
  }

  if (canCreateInSchema && (kind === 'programmability' || kind === 'packages')) {
    actions.push(
      templateAction('create-package', 'Create Package...', sqlCreatePackageTemplate(connection, schema)),
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
      templateAction('create-index', 'Create Index...', sqlCreateIndexTemplate(connection, schema)),
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
      templateAction('add-column', 'Add Column...', sqlAddColumnTemplate(connection, qualified)),
      templateAction('create-index', 'Create Index...', `create index idx_${objectName || node.label}_new_column on ${qualified} (new_column);`),
      templateAction('drop-table', 'Drop Table...', sqlDropTableTemplate(connection, qualified), true),
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
      templateAction('select-function', 'Select Function', sqlSelectFunctionTemplate(connection, qualified)),
      templateAction('alter-function', 'Alter Function...', sqlCreateFunctionTemplate(connection, schema, targetObjectName)),
      templateAction('drop-function', 'Drop Function...', `-- Review before running.\ndrop function ${qualified};`, true),
    )
  }

  if (kind === 'package') {
    actions.push(
      templateAction('view-package-errors', 'View Compilation Errors', sqlPackageErrorsQuery(connection, schema, targetObjectName)),
      templateAction('compile-package', 'Compile Package...', `alter package ${qualified} compile;\nalter package ${qualified} compile body;`),
      templateAction('drop-package', 'Drop Package...', `-- Review before running.\ndrop package ${qualified};`, true),
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
      templateAction('drop-column', 'Drop Column...', sqlDropColumnTemplate(connection, qualifySqlName(connection, schema, targetObjectName), node.label), true),
    )
  }

  return actions
}

function documentActions(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  kind: string,
): ConnectionTreeAction[] {
  if (connection.engine === 'mongodb') {
    return mongoActions(connection, node, kind)
  }

  if (connection.engine === 'litedb') {
    return liteDbActions(node, kind)
  }

  if (connection.engine === 'cosmosdb') {
    return cosmosActions(connection, node, kind)
  }

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

function cosmosActions(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  kind: string,
): ConnectionTreeAction[] {
  const target = cosmosTreeTarget(connection, node)
  const database = target.database
  const container = target.container ?? node.label

  if (kind === 'databases') {
    return [
      templateAction('create-database', 'Create Database...', cosmosOperationTemplate('createDatabase', {
        database: 'new_database',
        throughput: 'shared 400 RU/s',
      })),
    ]
  }

  if (kind === 'database' || kind === 'containers') {
    return [
      templateAction('create-container', 'Create Container...', cosmosOperationTemplate('createContainer', {
        database,
        container: 'new_container',
        partitionKey: '/tenantId',
        throughput: '400 RU/s',
      })),
    ]
  }

  if (kind === 'container') {
    return [
      templateAction('open-items', 'Open Items Query', documentFindQueryTemplate(container, 20, database)),
      templateAction('update-throughput', 'Update Throughput...', cosmosOperationTemplate('updateThroughput', {
        database,
        container,
        mode: 'autoscale',
        maxRuPerSecond: 4000,
      })),
      templateAction('update-indexing-policy', 'Update Indexing Policy...', cosmosOperationTemplate('updateIndexingPolicy', {
        database,
        container,
        includedPaths: ['/*'],
        excludedPaths: ['/"_etag"/?'],
      })),
      templateAction('drop-container', 'Delete Container...', cosmosOperationTemplate('deleteContainer', {
        database,
        container,
      }), true),
    ]
  }

  if (kind === 'items') {
    return [
      templateAction('open-items', 'Open Items Query', documentFindQueryTemplate(container, 20, database)),
    ]
  }

  if (kind === 'stored-procedures' || kind === 'triggers' || kind === 'udfs') {
    return [
      templateAction('create-script', 'Create Script...', cosmosOperationTemplate('createScript', {
        database,
        container,
        scriptType: kind,
        name: 'new_script',
      })),
    ]
  }

  if (kind === 'throughput') {
    return [
      templateAction('update-throughput', 'Update Throughput...', cosmosOperationTemplate('updateThroughput', {
        database,
        container: target.container,
        mode: 'manual',
        ruPerSecond: 1000,
      })),
    ]
  }

  return []
}

function cosmosTreeTarget(connection: ConnectionProfile, node: ConnectionTreeNode) {
  const path = node.path ?? []
  const scopeParts = node.scope?.split(':') ?? []
  const databaseFromScope = scopeParts.length >= 3 ? scopeParts.at(-2) : undefined
  const containerFromScope =
    node.scope?.startsWith('cosmos:container:') || node.scope?.startsWith('cosmos:items:')
      ? scopeParts.at(-1)
      : undefined
  const databaseIndex = path.indexOf('Databases')
  const containerIndex = path.indexOf('Containers')

  return {
    database:
      databaseFromScope ||
      (databaseIndex >= 0 ? path[databaseIndex + 1] : undefined) ||
      connection.database?.trim() ||
      'catalog',
    container:
      containerFromScope ||
      (containerIndex >= 0 ? path[containerIndex + 1] : undefined),
  }
}

function cosmosOperationTemplate(operation: string, values: Record<string, unknown>) {
  return JSON.stringify({ engine: 'cosmosdb', operation, ...values }, null, 2)
}

function liteDbActions(node: ConnectionTreeNode, kind: string): ConnectionTreeAction[] {
  const collection = liteDbCollectionFromTreeNode(node)

  if (kind === 'collections') {
    return [
      templateAction('create-collection', 'Create Collection...', liteDbOperationTemplate('createCollection', {
        collection: 'new_collection',
      })),
    ]
  }

  if (kind === 'collection') {
    return [
      templateAction('open-documents', 'Open Documents', JSON.stringify({ collection, filter: {}, limit: 20 }, null, 2)),
      templateAction('create-index', 'Create Index...', liteDbOperationTemplate('createIndex', {
        collection,
        name: 'field_1',
        expression: '$.field',
        unique: false,
      })),
      templateAction('rename-collection', 'Rename Collection...', liteDbOperationTemplate('renameCollection', {
        collection,
        newName: `${collection}_new`,
      })),
      templateAction('drop-collection', 'Drop Collection...', liteDbOperationTemplate('dropCollection', {
        collection,
      }), true),
    ]
  }

  if (kind === 'documents') {
    return [
      templateAction('open-documents', 'Open Documents', JSON.stringify({ collection, filter: {}, limit: 20 }, null, 2)),
    ]
  }

  if (kind === 'indexes') {
    return [
      templateAction('create-index', 'Create Index...', liteDbOperationTemplate('createIndex', {
        collection,
        name: 'field_1',
        expression: '$.field',
        unique: false,
      })),
    ]
  }

  if (kind === 'index') {
    return [
      templateAction('drop-index', 'Drop Index...', liteDbOperationTemplate('dropIndex', {
        collection,
        name: node.label.split('.').at(-1) ?? node.label,
      }), true),
    ]
  }

  if (kind === 'file-storage' || kind === 'files') {
    return [
      templateAction('download-file', 'Export File...', liteDbOperationTemplate('exportFile', {
        fileId: 'file_id',
      })),
      templateAction('upload-file', 'Upload File...', liteDbOperationTemplate('uploadFile', {
        fileId: 'file_id',
        sourcePath: 'choose file',
      })),
    ]
  }

  if (kind === 'storage' || kind === 'diagnostics') {
    return [
      templateAction('shrink-preview', 'Preview Shrink...', liteDbOperationTemplate('shrinkDatabase', {
        mode: 'preview',
      })),
      templateAction('rebuild-preview', 'Preview Rebuild...', liteDbOperationTemplate('rebuildIndexes', {
        scope: collection || 'database',
      })),
    ]
  }

  return []
}

function liteDbCollectionFromTreeNode(node: ConnectionTreeNode) {
  const path = node.path ?? []
  const collectionIndex = path.indexOf('Collections')

  if (collectionIndex >= 0 && path[collectionIndex + 1]) {
    return path[collectionIndex + 1]
  }

  if (node.scope?.startsWith('litedb:collection:') || node.scope?.startsWith('litedb:documents:')) {
    return node.scope.split(':').at(-1) ?? node.label
  }

  if (node.id.startsWith('litedb:collection:') || node.id.startsWith('litedb:documents:')) {
    return node.id.split(':').at(-1) ?? node.label
  }

  return node.label
}

function liteDbOperationTemplate(operation: string, values: Record<string, unknown>) {
  return JSON.stringify({ engine: 'litedb', operation, ...values }, null, 2)
}

function mongoActions(
  connection: ConnectionProfile,
  node: ConnectionTreeNode,
  kind: string,
): ConnectionTreeAction[] {
  const target = mongoTreeTarget(connection, node)
  const database = target.database
  const collection = target.collection ?? node.label

  if (kind === 'collections') {
    return [
      templateAction('create-collection', 'Create Collection...', mongoCommandTemplateForDatabase(database, {
        create: 'new_collection',
      })),
    ]
  }

  if (kind === 'collection' || kind === 'gridfs-collection') {
    return [
      templateAction('open-documents', 'Open Documents', documentFindQueryTemplate(collection, 20, database)),
      objectViewAction(
        'insert-document',
        'Add Document...',
        'insert-document',
        `insert-document:${database ?? ''}:${collection}`,
        mongoCollectionObjectViewPath(database, collection),
      ),
      templateAction('aggregation', 'Open Aggregation Pipeline', mongoAggregationTemplate(database, collection)),
      objectViewAction(
        'create-index',
        'Create Index...',
        'create-index',
        `create-index:${database ?? ''}:${collection}`,
        mongoCollectionObjectViewPath(database, collection),
      ),
      templateAction('update-validator', 'Update Validation Rules...', mongoCommandTemplateForDatabase(database, { collMod: collection, validator: {} })),
      templateAction('rename-collection', 'Rename Collection...', mongoCommandTemplateForDatabase(database, { renameCollection: `${database}.${collection}`, to: `${database}.${collection}_new` })),
      templateAction('drop-collection', 'Drop Collection...', mongoCommandTemplateForDatabase(database, { drop: collection }), true),
    ]
  }

  if (kind === 'documents' || kind === 'sample-results') {
    return [
      templateAction('open-documents', 'Open Query', documentFindQueryTemplate(collection, 20, database)),
    ]
  }

  if (kind === 'schema-preview') {
    return []
  }

  if (kind === 'indexes') {
    return [
      objectViewAction(
        'create-index',
        'Create Index...',
        'create-index',
        `create-index:${database ?? ''}:${collection}`,
        mongoCollectionObjectViewPath(database, collection),
      ),
    ]
  }

  if (kind === 'index') {
    return [
      templateAction('drop-index', 'Drop Index...', mongoCommandTemplateForDatabase(database, { dropIndexes: collection, index: node.label }), true),
    ]
  }

  if (kind === 'validation-rules') {
    return []
  }

  if (kind === 'aggregations') {
    return [
      templateAction('open-aggregation', 'Open Aggregation Builder', mongoAggregationTemplate(database, collection)),
    ]
  }

  if (kind === 'view') {
    return [
      templateAction('preview-view-results', 'Open Results Preview', documentFindQueryTemplate(collection, 20, database)),
      templateAction('drop-view', 'Drop View...', mongoCommandTemplateForDatabase(database, { drop: collection }), true),
    ]
  }

  if (kind === 'pipeline') {
    return [
      templateAction('preview-view-results', 'Open Results Preview', documentFindQueryTemplate(collection, 20, database)),
    ]
  }

  if (kind === 'views') {
    return [
      templateAction('create-view', 'Create View...', mongoCommandTemplateForDatabase(database, {
        create: 'new_view',
        viewOn: 'source_collection',
        pipeline: [{ $match: {} }],
      })),
    ]
  }

  return []
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
    const bucket = node.path?.includes('Buckets')
      ? node.path[node.path.indexOf('Buckets') + 1] ?? 'bucket'
      : 'bucket'
    return [
      templateAction('query-measurement', 'Query Measurement', `from(bucket: "${bucket}")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "${node.label}")`),
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

function mongoCollectionObjectViewPath(database: string | undefined, collection: string) {
  return [database, 'Collections', collection].filter((segment): segment is string => Boolean(segment))
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
    'Oracle',
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

  if (connection.engine === 'oracle') {
    return connection.auth.username?.trim().toUpperCase() || 'APP'
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

  if (connection.engine === 'oracle') {
    return [
      'sys',
      'system',
      'xdb',
      'ctxsys',
      'mdsys',
      'ordsys',
      'outln',
      'dbsnmp',
      'sysman',
      'wmsys',
    ].includes(name) || name.startsWith('apex_')
  }

  if (connection.engine === 'sqlite' || connection.engine === 'duckdb') {
    return name === 'temp' || name === 'information_schema'
  }

  return name === 'information_schema'
}

function isPostgresFamily(connection: ConnectionProfile) {
  return (
    connection.engine === 'postgresql' ||
    connection.engine === 'cockroachdb' ||
    connection.engine === 'timescaledb'
  )
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

function documentDatabaseFromPlacementPath(connection: ConnectionProfile, path: string[]) {
  const systemDatabaseIndex = path.indexOf('System Databases')
  if (systemDatabaseIndex >= 0 && path[systemDatabaseIndex + 1]) {
    return path[systemDatabaseIndex + 1]
  }

  const collectionsIndex = path.indexOf('Collections')
  if (collectionsIndex > 0) {
    return path[collectionsIndex - 1]
  }

  const viewsIndex = path.indexOf('Views')
  if (viewsIndex > 0) {
    return path[viewsIndex - 1]
  }

  const gridFsIndex = path.indexOf('GridFS')
  if (gridFsIndex > 0) {
    return path[gridFsIndex - 1]
  }

  const firstNonCategory = path.find((segment) => !isCategoryLabel(segment))
  return firstNonCategory ?? defaultDocumentDatabase(connection)
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

  if (connection.engine === 'oracle') {
    return `"${schema.replace(/"/g, '""')}"."${objectName.replace(/"/g, '""')}"`
  }

  return `${schema}.${objectName}`
}

function sqlColumnsQuery(connection: ConnectionProfile, schema: string, table: string) {
  if (connection.engine === 'sqlite') {
    return `pragma table_info(${table});`
  }

  if (connection.engine === 'oracle') {
    return `select column_name, data_type, nullable, data_default\nfrom all_tab_columns\nwhere owner = '${schema}' and table_name = '${table}'\norder by column_id;`
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

  if (connection.engine === 'oracle') {
    return `select index_name, uniqueness, status, visibility\nfrom all_indexes\nwhere owner = '${schema}' and table_name = '${table}'\norder by index_name;`
  }

  return `select indexname, indexdef\nfrom pg_indexes\nwhere schemaname = '${schema}' and tablename = '${table}';`
}

function sqlViewDefinitionQuery(connection: ConnectionProfile, schema: string, view: string) {
  if (connection.engine === 'sqlite') {
    return `select sql from sqlite_master where type in ('view', 'table') and name = '${view}';`
  }

  if (connection.engine === 'oracle') {
    return `select text\nfrom all_views\nwhere owner = '${schema}' and view_name = '${view}';`
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

  if (connection.engine === 'oracle') {
    return `alter index ${indexName} rebuild;`
  }

  return `reindex index ${indexName};`
}

function sqlCreateIndexTemplate(connection: ConnectionProfile, schema: string) {
  if (connection.engine === 'oracle') {
    return `create index ${qualifySqlName(connection, schema, 'idx_table_name_column_name')}\non ${qualifySqlName(connection, schema, 'table_name')} (column_name);`
  }

  return `create index idx_new_table_new_column on ${qualifySqlName(connection, schema, 'table_name')} (column_name);`
}

function sqlAddColumnTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'oracle') {
    return `alter table ${qualified} add (new_column varchar2(255));`
  }

  return `alter table ${qualified} add column new_column text;`
}

function sqlDropColumnTemplate(connection: ConnectionProfile, qualified: string, column: string) {
  if (connection.engine === 'oracle') {
    return `-- Review before running.\nalter table ${qualified} drop column ${column};`
  }

  return `-- Review before running.\nalter table ${qualified} drop column ${column};`
}

function sqlDropTableTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'oracle') {
    return `-- Review before running.\ndrop table ${qualified} purge;`
  }

  return `-- Review before running.\ndrop table ${qualified};`
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

  if (connection.engine === 'oracle') {
    return `create or replace function ${qualified}\nreturn number\nas\nbegin\n  return 1;\nend;`
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

  if (connection.engine === 'oracle') {
    return `create or replace trigger ${qualifySqlName(connection, schema, 'new_trigger')}\nbefore insert on ${tableName}\nfor each row\nbegin\n  null;\nend;`
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

  if (connection.engine === 'oracle') {
    return `create or replace type ${qualifySqlName(connection, schema, 'new_object_type')} as object (\n  id number,\n  name varchar2(255)\n);`
  }

  return `create type ${qualifySqlName(connection, schema, 'new_status')} as enum ('active', 'inactive');`
}

function sqlCreatePackageTemplate(connection: ConnectionProfile, schema: string) {
  if (connection.engine !== 'oracle') {
    return sqlCreateStoredProcedureTemplate(connection, schema)
  }

  const qualified = qualifySqlName(connection, schema, 'new_package')
  return `create or replace package ${qualified} as\n  function ping return varchar2;\nend;\n/\ncreate or replace package body ${qualified} as\n  function ping return varchar2 as\n  begin\n    return 'pong';\n  end;\nend;\n/`
}

function sqlSelectFunctionTemplate(connection: ConnectionProfile, qualified: string) {
  if (connection.engine === 'oracle') {
    return `select ${qualified}() as value from dual;`
  }

  return `select * from ${qualified}();`
}

function sqlPackageErrorsQuery(connection: ConnectionProfile, schema: string, packageName: string) {
  if (connection.engine === 'oracle') {
    return `select name, type, line, position, text\nfrom all_errors\nwhere owner = '${schema}' and name = '${packageName}'\norder by sequence;`
  }

  return `select 1;`
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
  return mongoCommandTemplateForDatabase(connection.database, {
    ...command,
    target: node.label,
  })
}

function mongoCommandTemplateForDatabase(
  database: string | undefined,
  command: Record<string, unknown>,
) {
  return JSON.stringify(
    {
      ...(database ? { database } : {}),
      command,
    },
    null,
    2,
  )
}

function mongoAggregationTemplate(database: string | undefined, collection: string) {
  return JSON.stringify(
    {
      ...(database ? { database } : {}),
      collection,
      pipeline: [{ $match: {} }, { $limit: 20 }],
    },
    null,
    2,
  )
}

function mongoTreeTarget(connection: ConnectionProfile, node: ConnectionTreeNode) {
  const path = node.path ?? []
  const scope = node.scope ?? ''
  const scopeParts = scope.split(':').filter(Boolean)
  const scopedDatabase =
    scopeParts.length >= 3 ? scopeParts[1] : scopeParts[0] === 'database' ? scopeParts[1] : undefined
  const scopedCollection =
    scopeParts.length >= 3 ? scopeParts.slice(2).join(':') : undefined
  const collectionIndex = path.indexOf('Collections')
  const viewsIndex = path.indexOf('Views')
  const gridFsIndex = path.indexOf('GridFS')
  const objectIndex = [collectionIndex, viewsIndex, gridFsIndex].find((index) => index >= 0)
  const databaseFromPath =
    objectIndex !== undefined && objectIndex > 0
      ? path[objectIndex - 1]
      : path.find((segment) => !isCategoryLabel(segment))
  const collectionFromPath =
    objectIndex !== undefined && objectIndex >= 0
      ? path[objectIndex + 1]
      : undefined

  return {
    database: scopedDatabase ?? databaseFromPath ?? connection.database,
    collection: scopedCollection ?? collectionFromPath,
  }
}
