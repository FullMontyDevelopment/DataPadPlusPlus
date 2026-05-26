import type {
  AdapterManifest,
  ConnectionProfile,
  DatastoreTreeManifest,
  DatastoreTreeNodeManifest,
  ExplorerNode,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import {
  branchNodeForPath,
  documentFindQueryTemplate,
  managementActionsForNode,
  normalizeExplorerKind,
  placementForExplorerNode,
  redisKeyBrowserQueryTemplate,
  sqlObjectQueryTemplate,
  type ConnectionTreeAction,
} from './SideBar.datastore-tree-registry'

const SQL_SERVER_SERVER_LEVEL_GROUPS = [
  'Security',
  'Server Objects',
  'Replication',
  'Always On High Availability',
  'Management',
  'SQL Server Agent',
  'XEvent Profiler',
  'Integration Services Catalogs',
]

export interface ConnectionTreeNode {
  id: string
  label: string
  kind: string
  detail?: string
  scope?: string
  path?: string[]
  queryTemplate?: string
  queryable?: boolean
  expandable?: boolean
  refreshScope?: string
  category?: boolean
  actions?: ConnectionTreeAction[]
  builderKind?: ScopedQueryTarget['preferredBuilder']
  children?: ConnectionTreeNode[]
}

export function buildConnectionObjectTree(
  connection: ConnectionProfile,
  adapterManifest?: AdapterManifest,
): ConnectionTreeNode[] {
  if (adapterManifest?.tree) {
    const tree = buildConnectionObjectTreeFromManifest(connection, adapterManifest.tree)
    decorateTreeNodes(connection, tree, undefined)
    return tree
  }

  const tree = (() => {
    switch (connection.family) {
    case 'document':
      return documentConnectionTree(connection)
    case 'keyvalue':
      return keyValueConnectionTree(connection)
    case 'graph':
      return graphConnectionTree(connection)
    case 'timeseries':
      return timeseriesConnectionTree(connection)
    case 'widecolumn':
      return wideColumnConnectionTree(connection)
    case 'search':
      return searchConnectionTree(connection)
    case 'warehouse':
      return analyticsConnectionTree(connection)
    case 'embedded-olap':
      return connection.engine === 'duckdb'
        ? duckDbConnectionTree(connection)
        : analyticsConnectionTree(connection)
    case 'sql':
    default:
      return sqlConnectionTree(connection)
  }
  })()

  decorateTreeNodes(connection, tree, undefined)
  return tree
}

function buildConnectionObjectTreeFromManifest(
  connection: ConnectionProfile,
  treeManifest: DatastoreTreeManifest,
): ConnectionTreeNode[] {
  return treeManifest.roots.flatMap((node) =>
    connectionTreeNodeFromManifestNode(connection, node, []),
  )
}

function connectionTreeNodeFromManifestNode(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
  parentPath: string[],
): ConnectionTreeNode[] {
  if (manifestNode.optionalWhenLiveMetadata) {
    return []
  }

  if (manifestNode.hiddenWhenDatabaseSelected && connection.database?.trim()) {
    return []
  }

  const label = resolveManifestTreeLabel(connection, manifestNode)

  if (!label) {
    return []
  }

  const children = (manifestNode.children ?? []).flatMap((child) =>
    connectionTreeNodeFromManifestNode(connection, child, [...parentPath, label]),
  )

  return [
    {
      id: manifestTreeNodeId(connection, manifestNode, label, parentPath),
      label,
      kind: normalizeExplorerKind(connection, manifestNode.kind),
      detail: manifestNode.detail,
      scope: manifestTreeNodeScope(connection, manifestNode, label),
      path: [...parentPath, label],
      category: true,
      expandable: children.length > 0,
      children,
    },
  ]
}

function manifestTreeNodeId(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
  label: string,
  parentPath: string[],
) {
  if (connection.engine === 'memcached') {
    return memcachedManifestNodeId(manifestNode.kind, label)
  }

  if (connection.engine === 'litedb') {
    return liteDbManifestNodeId(manifestNode.kind, label)
  }

  if (connection.engine === 'cosmosdb') {
    return cosmosManifestNodeId(connection, manifestNode.kind, label, parentPath)
  }

  return `manifest:${connection.id}:${[...parentPath, label, manifestNode.id].join('/')}`
}

function manifestTreeNodeScope(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
  label: string,
) {
  if (connection.engine === 'memcached') {
    return memcachedManifestNodeId(manifestNode.kind, label)
  }

  if (connection.engine === 'litedb') {
    return liteDbManifestNodeId(manifestNode.kind, label)
  }

  if (connection.engine === 'cosmosdb') {
    return cosmosManifestNodeId(connection, manifestNode.kind, label, [])
  }

  return undefined
}

function memcachedManifestNodeId(kind: string, label: string) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')

  if (normalizedKind === 'server') {
    return 'memcached:server'
  }

  if (normalizedKind === 'diagnostics') {
    return 'memcached:diagnostics'
  }

  if (['stats', 'slabs', 'items', 'settings', 'connections'].includes(normalizedKind)) {
    return `memcached:${normalizedKind}`
  }

  if (normalizedLabel === 'item-classes') {
    return 'memcached:items'
  }

  return `memcached:${normalizedKind || normalizedLabel || 'object'}`
}

function liteDbManifestNodeId(kind: string, label: string) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')

  if (normalizedKind === 'database') {
    return 'litedb:database'
  }

  if (normalizedKind === 'diagnostics') {
    return 'litedb:diagnostics'
  }

  if (['collections', 'indexes', 'file-storage', 'storage', 'settings'].includes(normalizedKind)) {
    return `litedb:${normalizedKind}`
  }

  if (normalizedKind === 'files' || normalizedLabel === 'files') {
    return 'litedb:files'
  }

  if (normalizedKind === 'chunks' || normalizedLabel === 'chunks') {
    return 'litedb:chunks'
  }

  return `litedb:${normalizedKind || normalizedLabel || 'object'}`
}

function cosmosManifestNodeId(
  connection: ConnectionProfile,
  kind: string,
  label: string,
  parentPath: string[],
) {
  const normalizedKind = kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const normalizedLabel = label.trim().toLowerCase().replace(/[_\s]+/g, '-')
  const database =
    parentPath.find((segment) => !isCosmosCategory(segment)) ||
    connection.database?.trim() ||
    'catalog'

  if (normalizedKind === 'account') {
    return 'cosmos:account'
  }

  if (normalizedKind === 'databases') {
    return 'cosmos:databases'
  }

  if (normalizedKind === 'database') {
    return `cosmos:database:${label || database}`
  }

  if (normalizedKind === 'containers') {
    return `cosmos:containers:${database}`
  }

  if ([
    'regions',
    'consistency',
    'security',
    'diagnostics',
  ].includes(normalizedKind)) {
    return `cosmos:${normalizedKind}`
  }

  if ([
    'items',
    'partition-key',
    'indexing-policy',
    'throughput',
    'change-feed',
    'stored-procedures',
    'triggers',
    'udfs',
    'conflicts',
  ].includes(normalizedKind)) {
    return `cosmos:${normalizedKind}:${database}:container`
  }

  return `cosmos:${normalizedKind || normalizedLabel || 'object'}`
}

function isCosmosCategory(label: string) {
  return [
    'Account',
    'Databases',
    'Containers',
    'Items',
    'Partition Key',
    'Indexing Policy',
    'Throughput',
    'Change Feed',
    'Stored Procedures',
    'Triggers',
    'User Defined Functions',
    'Conflict Feed',
    'Regions',
    'Consistency',
    'Security',
    'Diagnostics',
  ].includes(label)
}

function resolveManifestTreeLabel(
  connection: ConnectionProfile,
  manifestNode: DatastoreTreeNodeManifest,
) {
  const databasePlaceholder = /\{\{database(?::([^}]+))?\}\}/
  const databaseMatch = manifestNode.label.match(databasePlaceholder)

  if (!databaseMatch) {
    return manifestNode.label
  }

  const database =
    connection.database?.trim() ||
    manifestNode.defaultDatabase ||
    databaseMatch[1]?.trim()

  if (!database && manifestNode.requiresDatabase) {
    return undefined
  }

  if (!database) {
    return manifestNode.label.replace(databasePlaceholder, 'default')
  }

  return manifestNode.label.replace(databasePlaceholder, database)
}

export function buildConnectionObjectTreeFromExplorerNodes(
  connection: ConnectionProfile,
  nodes: ExplorerNode[],
): ConnectionTreeNode[] {
  const roots: ConnectionTreeNode[] = []
  const nodesByPath = new Map<string, ConnectionTreeNode>()

  const ensureBranch = (path: string[]) => {
    let parent: ConnectionTreeNode | undefined

    path.forEach((_segment, index) => {
      const branchPath = path.slice(0, index + 1)
      const key = treePathKey(branchPath)
      let branch = nodesByPath.get(key)

      if (!branch) {
        branch = branchNodeForPath(connection, branchPath)
        nodesByPath.set(key, branch)

        if (parent) {
          attachChild(parent, branch)
        } else {
          attachRoot(roots, branch)
        }
      }

      parent = branch
    })

    return parent
  }

  for (const node of nodes) {
    const placement = placementForExplorerNode(connection, node)
    const parentNode = ensureBranch(placement.path)
    const treeNode = explorerNodeToConnectionTreeNode(connection, node, placement.kind)
    const fullPath = [...placement.path, treeNode.label]
    const key = treePathKey(fullPath)
    const existingNode = nodesByPath.get(key)
    const mergedNode = existingNode ? mergeTreeNode(existingNode, treeNode) : treeNode

    nodesByPath.set(key, mergedNode)

    if (parentNode) {
      attachChild(parentNode, mergedNode)
    } else {
      attachRoot(roots, mergedNode)
    }
  }

  decorateTreeNodes(connection, roots, undefined)
  return roots
}

function explorerNodeToConnectionTreeNode(
  connection: ConnectionProfile,
  node: ExplorerNode,
  normalizedKind = normalizeExplorerKind(connection, node.kind),
): ConnectionTreeNode {
  const isMongoBuilderNode =
    connection.engine === 'mongodb' &&
    ['collection', 'documents', 'aggregations', 'sample-results', 'gridfs-collection'].includes(
      normalizedKind,
    )
  const isRedisPrefix = isRedisLikeConnection(connection) && normalizedKind === 'prefix'
  const isSearchBuilderNode =
    connection.family === 'search' &&
    ['index', 'data-stream', 'documents'].includes(normalizedKind)
  const isDynamoBuilderNode =
    connection.engine === 'dynamodb' &&
    ['table', 'items'].includes(normalizedKind)
  const isCassandraBuilderNode =
    connection.engine === 'cassandra' &&
    ['table', 'data', 'materialized-view'].includes(normalizedKind)
  const isGraphQueryNode =
    connection.family === 'graph' &&
    ['graph', 'node-label', 'relationship'].includes(normalizedKind)
  const redisPattern = isRedisPrefix ? redisPatternFromExplorerNode(node) : undefined
  const label = sqlDisplayLabelForExplorerNode(connection, node, normalizedKind)

  return {
    id: node.id,
    label,
    kind: normalizedKind,
    detail: node.detail,
    scope: node.scope,
    refreshScope: node.scope,
    path: node.path,
    queryTemplate:
      redisPattern !== undefined
        ? redisKeyBrowserQueryTemplate(redisPattern)
        : (node.queryTemplate ?? fallbackExplorerQueryTemplate(connection, node)),
    queryable: isRedisPrefix || isGraphQueryNode || isExplorerNodeQueryable(connection, node),
    expandable: node.expandable,
    builderKind: isMongoBuilderNode
      ? normalizedKind === 'aggregations'
        ? 'mongo-aggregation'
        : 'mongo-find'
      : isRedisPrefix
        ? 'redis-key-browser'
        : isSearchBuilderNode
          ? 'search-dsl'
          : isDynamoBuilderNode
            ? 'dynamodb-key-condition'
          : isCassandraBuilderNode
            ? 'cql-partition'
        : undefined,
  }
}

function attachRoot(roots: ConnectionTreeNode[], node: ConnectionTreeNode) {
  if (!roots.some((root) => root === node || root.id === node.id)) {
    roots.push(node)
  }
}

function attachChild(parent: ConnectionTreeNode, child: ConnectionTreeNode) {
  parent.children ??= []
  if (!parent.children.some((item) => item === child || item.id === child.id)) {
    parent.children.push(child)
  }
}

function mergeTreeNode(
  existingNode: ConnectionTreeNode,
  incomingNode: ConnectionTreeNode,
) {
  const children = existingNode.children ?? incomingNode.children

  Object.assign(existingNode, incomingNode)
  existingNode.children = children
  return existingNode
}

function decorateTreeNodes(
  connection: ConnectionProfile,
  nodes: ConnectionTreeNode[],
  inheritedRefreshScope: string | undefined,
) {
  for (const node of nodes) {
    node.refreshScope ??= node.scope ?? inheritedRefreshScope
    node.actions = managementActionsForNode(connection, node)

    if (node.children?.length) {
      decorateTreeNodes(connection, node.children, node.scope ?? node.refreshScope)
    }
  }
}

function treePathKey(path: string[]) {
  return path.map((segment) => segment.toLowerCase()).join('/')
}

function fallbackExplorerQueryTemplate(
  connection: ConnectionProfile,
  node: ExplorerNode,
): string | undefined {
  const kind = normalizeExplorerKind(connection, node.kind)

  if (
    connection.family === 'sql' &&
    (isSqlTableLikeKind(kind) || ['hypertable', 'view', 'materialized-view'].includes(kind))
  ) {
    const { schema, objectName } = sqlObjectPartsFromExplorerNode(connection, node)

    if (objectName) {
      return sqlObjectQueryTemplate(connection, schema, objectName)
    }
  }

  if (
    connection.engine === 'mongodb' &&
    ['collection', 'documents', 'aggregations', 'sample-results', 'gridfs-collection'].includes(
      kind,
    )
  ) {
    return documentFindQueryTemplate(node.label, 20, connection.database?.trim())
  }

  return undefined
}

function isRedisLikeConnection(connection: ConnectionProfile) {
  return connection.engine === 'redis' || connection.engine === 'valkey'
}

function redisPatternFromExplorerNode(node: ExplorerNode) {
  const scopedPrefix = node.scope?.startsWith('prefix:')
    ? node.scope.replace('prefix:', '')
    : undefined
  const pattern = scopedPrefix || node.label

  if (pattern.includes('*')) {
    return pattern
  }

  if (pattern.endsWith(':')) {
    return `${pattern}*`
  }

  return pattern
}

function sqlObjectPartsFromExplorerNode(
  connection: ConnectionProfile,
  node: ExplorerNode,
) {
  const scopedName = node.scope?.split(':').slice(1).join(':')
  const [scopedSchema, scopedObjectName] = splitSqlName(scopedName)
  const [labelSchema, labelObjectName] = splitSqlName(node.label)
  const normalizedPath =
    node.path?.[0] === connection.name ? node.path.slice(1) : node.path ?? []
  const pathObject = normalizedPath.find((segment) => splitSqlName(segment)[1])
  const [pathSchema, pathObjectName] = splitSqlName(pathObject)
  const categoryFreePath = normalizedPath.filter((segment) => !isSqlTreeCategory(segment))

  return {
    schema:
      scopedSchema ||
      pathSchema ||
      labelSchema ||
      (categoryFreePath.length > 1 ? categoryFreePath.at(-2) : categoryFreePath[0]) ||
      defaultSqlSchema(connection),
    objectName:
      scopedObjectName ||
      pathObjectName ||
      labelObjectName ||
      (categoryFreePath.length > 1 ? categoryFreePath.at(-1) : node.label),
  }
}

function sqlDisplayLabelForExplorerNode(
  connection: ConnectionProfile,
  node: ExplorerNode,
  kind: string,
) {
  if (connection.engine !== 'sqlserver') {
    return node.label
  }

  if (![
    'table',
    'view',
    'materialized-view',
    'stored-procedure',
    'procedure',
    'function',
    'sequence',
    'synonym',
    'type',
  ].includes(kind)) {
    return node.label
  }

  if (node.label.includes('.')) {
    return node.label
  }

  const { schema, objectName } = sqlObjectPartsFromExplorerNode(connection, node)
  return `${schema}.${objectName}`
}

function splitSqlName(value: string | undefined) {
  const parts = value?.split('.').map((part) => part.trim()).filter(Boolean) ?? []

  if (parts.length >= 2) {
    return [parts[0], parts[1]] as const
  }

  return [undefined, parts[0]] as const
}

function isSqlTreeCategory(label: string) {
  return [
    'Schemas',
    'User Schemas',
    'System Schemas',
    'Tables',
    'System Tables',
    'FileTables',
    'External Tables',
    'Graph Tables',
    'Views',
    'Materialized Views',
    'Programmability',
    'Stored Procedures',
    'Functions',
    'Sequences',
    'Types',
    'Synonyms',
    'Columns',
    'Indexes',
    'Constraints',
    'Triggers',
  ].includes(label)
}

function isExplorerNodeQueryable(connection: ConnectionProfile, node: ExplorerNode) {
  const kind = normalizeExplorerKind(connection, node.kind)

  if (connection.engine === 'mongodb') {
    return ['collection', 'documents', 'aggregations', 'sample-results', 'gridfs-collection'].includes(
      kind,
    )
  }

  if (connection.engine === 'litedb') {
    return ['collection', 'documents'].includes(kind)
  }

  if (connection.engine === 'cosmosdb') {
    return ['container', 'items'].includes(kind)
  }

  return Boolean(
    isSqlTableLikeKind(kind) ||
      ['hypertable', 'view', 'materialized-view', 'data'].includes(kind) ||
      (['elasticsearch', 'opensearch'].includes(connection.engine) &&
        ['index', 'data-stream', 'documents'].includes(kind)) ||
      (connection.engine === 'dynamodb' && ['table', 'items'].includes(kind)) ||
      (connection.engine === 'cassandra' && ['table', 'data', 'materialized-view'].includes(kind)) ||
      (connection.family === 'graph' && ['graph', 'node-label', 'relationship'].includes(kind)) ||
      (connection.engine === 'prometheus' && ['metric', 'series'].includes(kind)) ||
      (connection.engine === 'influxdb' && ['measurement'].includes(kind)) ||
      (connection.engine === 'opentsdb' && ['metric'].includes(kind)),
  )
}

function isSqlTableLikeKind(kind: string) {
  return [
    'table',
    'base-table',
    'strict-table',
    'virtual-table',
    'fts-table',
    'rtree-table',
  ].includes(kind)
}

function sqlConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'sqlserver') {
    return sqlServerConnectionTree(connection)
  }

  if (connection.engine === 'sqlite') {
    return sqliteConnectionTree()
  }

  const schema = defaultSqlSchema(connection)
  const supportsStoredRoutines = !['sqlite', 'duckdb'].includes(connection.engine)
  const userSchema = branch(`schema-${schema}`, schema, 'schema', connection.database ?? 'default schema', [
    branch('tables', 'Tables', 'tables', 'Base tables and table-like relations', []),
    branch('views', 'Views', 'views', 'Saved select projections', []),
    sqlProgrammabilityBranch(supportsStoredRoutines),
    branch('indexes', 'Indexes', 'indexes', 'Secondary access paths', []),
    branch('security', 'Security', 'security', 'Schema roles and grants', []),
  ])
  const systemSchemaName = systemSqlSchemaForConnection(connection)
  const roots = [
    branch('user-schemas', 'User Schemas', 'user-schemas', `${connection.engine} user metadata scopes`, [
      userSchema,
    ]),
    branch('system-schemas', 'System Schemas', 'system-schemas', `${connection.engine} system metadata scopes`, [
      branch(`schema-${systemSchemaName}`, systemSchemaName, 'schema', 'system schema', [
        branch('system-tables', 'System Tables', 'system-tables', 'Engine-maintained tables', []),
        branch('system-views', 'Views', 'views', 'Engine-maintained views', []),
        branch('system-functions', 'Functions', 'functions', 'Engine-maintained functions', []),
      ]),
    ]),
  ]

  return roots
}

function sqliteConnectionTree(): ConnectionTreeNode[] {
  const databaseChildren = [
    branch('tables', 'Tables', 'tables', 'Base row-store tables', []),
    branch('views', 'Views', 'views', 'Stored SELECT definitions', []),
    branch('indexes', 'Indexes', 'indexes', 'Standalone and table indexes', []),
    branch('triggers', 'Triggers', 'triggers', 'Database and table triggers', []),
  ]

  return [
    branch('main-database', 'Main Database', 'database', 'SQLite main database file', databaseChildren),
    branch('diagnostics', 'Diagnostics', 'diagnostics', 'PRAGMA, explain, integrity, and storage metadata', []),
  ]
}

function duckDbConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = connection.database || 'local DuckDB file'

  return [
    branch('main-database', 'Main Database', 'database', database, [
      branch('schemas', 'Schemas', 'schemas', 'Attached schemas and namespaces', [
        branch('main-schema', 'main', 'schema', 'Main DuckDB schema', [
          branch('tables', 'Tables', 'tables', 'Analytical row/column tables', []),
          branch('views', 'Views', 'views', 'Saved analytical projections', []),
          branch('indexes', 'Indexes', 'indexes', 'DuckDB secondary indexes', []),
          branch('functions', 'Functions & Macros', 'functions', 'Scalar/table functions and macros', []),
        ]),
        branch('temp-schema', 'temp', 'schema', 'Temporary DuckDB schema', []),
      ]),
      branch('attached-databases', 'Attached Databases', 'attached-databases', 'Other DuckDB files attached to this session', []),
      branch('extensions', 'Extensions', 'extensions', 'Installed and loadable extensions', []),
      branch('files', 'Files', 'files', 'Parquet, CSV, and JSON file sources', []),
      branch('pragmas', 'Pragmas', 'pragmas', 'DuckDB settings and checks', []),
      branch('statistics', 'Statistics', 'statistics', 'Storage and column statistics', []),
    ]),
    branch('diagnostics', 'Diagnostics', 'diagnostics', 'Memory, threads, storage, and extension health', []),
  ]
}

function sqlServerConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = connection.database?.trim() || 'master'

  return [
    branch('databases', 'Databases', 'databases', 'SQL Server database catalogs', [
      branch('system-databases', 'System Databases', 'system-databases', 'Engine-maintained databases', []),
      branch('database-snapshots', 'Database Snapshots', 'database-snapshots', 'Point-in-time database snapshots', []),
      branch(`database-${database}`, database, 'database', 'user database', [
        branch('database-diagrams', 'Database Diagrams', 'database-diagrams', 'Database relationship diagrams', []),
        branch('tables', 'Tables', 'tables', 'Base tables and table-like relations', [
          branch('system-tables', 'System Tables', 'system-tables', 'Engine-maintained tables', []),
          branch('filetables', 'FileTables', 'filetables', 'SQL Server file-backed tables', []),
          branch('external-tables', 'External Tables', 'external-tables', 'Externally stored relational tables', []),
          branch('graph-tables', 'Graph Tables', 'graph-tables', 'SQL graph node and edge tables', []),
        ]),
        branch('views', 'Views', 'views', 'Saved select projections', []),
        branch('external-resources', 'External Resources', 'external-resources', 'External data access metadata', []),
        branch('synonyms', 'Synonyms', 'synonyms', 'Object aliases', []),
        sqlServerProgrammabilityBranch(),
        branch('service-broker', 'Service Broker', 'service-broker', 'Messaging and queue objects', []),
        branch('storage', 'Storage', 'storage', 'Files, filegroups, and partitions', []),
        branch('security', 'Security', 'security', 'Database users, roles, and schemas', [
          branch('users', 'Users', 'users', 'Database users', []),
          branch('roles', 'Roles', 'roles', 'Database roles', []),
          branch('schemas', 'Schemas', 'schemas', 'Database object namespaces', [
            leaf('schema-dbo', 'dbo', 'schema', 'default user schema', {
              path: [connection.name, 'Databases', database, 'Security', 'Schemas'],
              scope: 'schema:dbo',
            }),
          ]),
        ]),
      ]),
    ]),
    ...SQL_SERVER_SERVER_LEVEL_GROUPS.map((label) => sqlServerServerLevelBranch(label)),
  ]
}

function sqlServerServerLevelBranch(label: string) {
  const kind = label.toLowerCase().replace(/[^a-z0-9]+/g, '-')

  if (label === 'Server Objects') {
    return branch('server-objects', 'Server Objects', 'server-objects', 'Linked servers, endpoints, and server-level objects', [
      branch('linked-servers', 'Linked Servers', 'linked-servers', 'Remote server definitions and providers', []),
      branch('endpoints', 'Endpoints', 'endpoints', 'Database mirroring, service broker, and TDS endpoints', []),
    ])
  }

  if (label === 'Always On High Availability') {
    return branch('always-on-high-availability', label, 'always-on-high-availability', 'Availability groups and replicas', [
      branch('availability-groups', 'Availability Groups', 'availability-groups', 'Always On availability groups and replicas', []),
    ])
  }

  return branch(kind, label, kind, `SQL Server ${label.toLowerCase()}`, [])
}

function sqlServerProgrammabilityBranch() {
  return branch('programmability', 'Programmability', 'programmability', 'Procedures, functions, and programmable objects', [
    branch('stored-procedures', 'Stored Procedures', 'stored-procedures', 'Callable routines', []),
    branch('functions', 'Functions', 'functions', 'Scalar and table-valued functions', []),
    branch('database-triggers', 'Database Triggers', 'database-triggers', 'Database-scoped triggers', []),
    branch('assemblies', 'Assemblies', 'assemblies', 'CLR assemblies', []),
    branch('types', 'Types', 'types', 'User-defined types', []),
    branch('rules', 'Rules', 'rules', 'Legacy rules', []),
    branch('defaults', 'Defaults', 'defaults', 'Legacy defaults', []),
    branch('sequences', 'Sequences', 'sequences', 'Generated numeric sequences', []),
  ])
}

function sqlProgrammabilityBranch(supportsStoredRoutines: boolean) {
  const routineChildren = supportsStoredRoutines
    ? [
        branch('stored-procedures', 'Stored Procedures', 'stored-procedures', 'Callable routines', []),
        branch('functions', 'Functions', 'functions', 'Scalar and table-valued functions', []),
      ]
    : []

  return branch('programmability', 'Programmability', 'programmability', 'Procedures, functions, and triggers', [
    ...routineChildren,
    branch('triggers', 'Triggers', 'triggers', 'Table triggers', []),
    branch('sequences', 'Sequences', 'sequences', 'Generated numeric sequences', []),
    branch('types', 'Types', 'types', 'User-defined types', []),
    branch('synonyms', 'Synonyms', 'synonyms', 'Object aliases', []),
  ])
}

function documentConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'mongodb') {
    if (!connection.database) {
      return [
        branch('databases', 'Databases', 'databases', 'MongoDB database namespaces', []),
      ]
    }

    return [
      branch(
        `database-${connection.database}`,
        connection.database,
        'database',
        'MongoDB database',
        [
          branch('collections', 'Collections', 'collections', 'Document collections', []),
          branch('views', 'Views', 'views', 'Read-only collection views', []),
          branch('gridfs', 'GridFS', 'gridfs', 'GridFS files and chunks collections', []),
          branch('users', 'Users', 'users', 'Database users', []),
          branch('roles', 'Roles', 'roles', 'Database roles', []),
        ],
      ),
    ]
  }

  if (connection.engine === 'litedb') {
    return liteDbConnectionTree(connection)
  }

  if (connection.engine === 'cosmosdb') {
    return cosmosConnectionTree(connection)
  }

  const database = connection.database || 'admin'

  return [
    branch('databases', 'Databases', 'databases', 'Document database namespaces', [
      branch(`database-${database}`, database, 'database', `${connection.engine} database`, [
        branch('collections', 'Collections', 'collections', 'Document collections', []),
        branch('indexes', 'Indexes', 'indexes', 'Collection index definitions', []),
      ]),
    ]),
  ]
}

function liteDbConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = fileName(connection.database || connection.host || 'local.db')

  return [
    branch('litedb-database', database, 'database', 'LiteDB local database file', [
      branch('litedb-collections', 'Collections', 'collections', 'Document collections', []),
      branch('litedb-indexes', 'Indexes', 'indexes', 'Collection index definitions', []),
      branch('litedb-file-storage', 'File Storage', 'file-storage', 'Stored files and chunks', [
        branch('litedb-files', 'Files', 'files', 'File metadata and chunk counts', []),
        branch('litedb-chunks', 'Chunks', 'chunks', 'File chunk distribution and health', []),
      ]),
      branch('litedb-storage', 'Storage', 'storage', 'Pages, free space, and maintenance health', []),
      branch('litedb-settings', 'Settings', 'settings', 'Local file connection options', []),
    ]),
    branch('litedb-diagnostics', 'Diagnostics', 'diagnostics', 'File health, index coverage, and storage warnings', []),
  ]
}

function cosmosConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = connection.database?.trim() || 'catalog'

  return [
    branch('cosmos-account', 'Account', 'account', 'Cosmos DB account topology and API surface', [
      branch('cosmos-databases', 'Databases', 'databases', 'Cosmos DB databases', [
        branch(`cosmos-database-${database}`, database, 'database', 'Selected Cosmos DB database', [
          branch('cosmos-containers', 'Containers', 'containers', 'Containers and partitioned item stores', []),
          branch('cosmos-throughput', 'Throughput', 'throughput', 'Shared database throughput where configured', []),
          branch('cosmos-security', 'Security', 'security', 'Database access posture', []),
        ]),
      ]),
      branch('cosmos-regions', 'Regions', 'regions', 'Read and write region topology', []),
      branch('cosmos-consistency', 'Consistency', 'consistency', 'Default consistency and session behavior', []),
      branch('cosmos-security-root', 'Security', 'security', 'RBAC, keys, networking, and access posture', []),
      branch('cosmos-diagnostics', 'Diagnostics', 'diagnostics', 'RU, throttles, latency, and storage signals', []),
    ]),
  ]
}

function keyValueConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'memcached') {
    return [
      branch('server', 'Server', 'server', 'Memcached cache server overview', [
        branch('stats', 'Stats', 'stats', 'Operational counters, hit rate, item count, and memory use', []),
        branch('slabs', 'Slabs', 'slabs', 'Slab classes, chunk sizes, and allocation pressure', []),
        branch('items', 'Item Classes', 'items', 'Item-class counts, ages, evictions, and reclaim signals', []),
        branch('settings', 'Settings', 'settings', 'Cache limits, protocol flags, and LRU behavior', []),
        branch('connections', 'Connections', 'connections', 'Client connection pressure and rejected clients', []),
      ]),
      branch('diagnostics', 'Diagnostics', 'diagnostics', 'Hit ratio, evictions, memory pressure, and connection pressure', []),
    ]
  }

  return [
    branch('keyspaces', 'Key Spaces', 'keyspaces', 'Logical key groups and modules', [
      branch('prefixes', 'Prefixes', 'prefixes', 'SCAN-friendly key prefixes', []),
      branch('streams', 'Streams', 'streams', 'Append-only event streams', []),
      branch('sets', 'Sets', 'sets', 'Set and sorted-set keys', []),
    ]),
  ]
}

function graphConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = connection.database || (connection.engine === 'neo4j' ? 'neo4j' : 'graph')
  const rootLabel = connection.engine === 'arango' ? 'Graphs' : 'Databases'

  return [
    branch('graphs', rootLabel, 'graphs', 'Graph databases or named graphs', [
      branch(`graph-${database}`, database, 'graph', `${connection.engine} graph`, [
        branch('node-labels', 'Node Labels', 'node-labels', 'Vertex/node categories', []),
        branch('relationship-types', 'Relationship Types', 'relationship-types', 'Edges and relationship types', []),
        branch('property-keys', 'Property Keys', 'property-keys', 'Graph property definitions', []),
        branch('indexes', 'Indexes', 'indexes', 'Graph lookup indexes', []),
        branch('constraints', 'Constraints', 'constraints', 'Graph uniqueness and existence rules', []),
      ]),
    ]),
    branch('procedures', connection.engine === 'neptune' ? 'Loader Jobs' : connection.engine === 'arango' ? 'Services' : 'Procedures', 'procedures', 'Procedures, services, algorithms, or loader jobs', []),
    branch('security', 'Security', 'security', 'Users, roles, IAM, and graph permissions', []),
    branch('diagnostics', 'Diagnostics', 'diagnostics', 'Query, storage, and schema health', []),
  ]
}

function timeseriesConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'prometheus') {
    return [
      branch('metrics', 'Metrics', 'metrics', 'PromQL metric families', []),
      branch('labels', 'Labels', 'labels', 'Metric dimensions', []),
      branch('targets', 'Targets', 'targets', 'Scrape targets', []),
      branch('rules', 'Rules', 'rules', 'Alerting and recording rules', []),
      branch('alerts', 'Alerts', 'alerts', 'Alert state', []),
      branch('service-discovery', 'Service Discovery', 'service-discovery', 'Discovered and dropped targets', []),
      branch('tsdb', 'TSDB / Storage', 'tsdb', 'Head blocks, WAL, and retention status', []),
      branch('diagnostics', 'Diagnostics', 'diagnostics', 'Runtime and status metadata', []),
    ]
  }

  if (connection.engine === 'influxdb') {
    const bucket = connection.database || 'telemetry'
    return [
      branch('buckets', 'Buckets', 'buckets', 'InfluxDB buckets and retention scopes', [
        branch(`bucket-${bucket}`, bucket, 'bucket', 'InfluxDB bucket', [
          branch('measurements', 'Measurements', 'measurements', 'Measurement schema', []),
          branch('tags', 'Tags', 'tags', 'Indexed dimensions', []),
          branch('fields', 'Fields', 'fields', 'Value fields', []),
          branch('retention-policies', 'Retention Policies', 'retention-policies', 'Retention and shard groups', []),
        ]),
      ]),
      branch('tasks', 'Tasks', 'tasks', 'Scheduled Flux tasks', []),
      branch('security', 'Tokens', 'security', 'Authorizations and bucket scopes', []),
      branch('diagnostics', 'Diagnostics', 'diagnostics', 'Cardinality, storage, and query health', []),
    ]
  }

  if (connection.engine === 'opentsdb') {
    return [
      branch('metrics', 'Metrics', 'metrics', 'OpenTSDB metric names', []),
      branch('tags', 'Tags', 'tags', 'Tag keys and values', []),
      branch('aggregators', 'Aggregators', 'aggregators', 'Supported aggregation functions', []),
      branch('downsampling', 'Downsampling', 'downsampling', 'Downsample windows and fill policies', []),
      branch('uid-metadata', 'UID Metadata', 'uid-metadata', 'Metric and tag UID metadata', []),
      branch('trees', 'Trees', 'trees', 'OpenTSDB tree definitions', []),
      branch('stats', 'Stats', 'stats', 'OpenTSDB runtime stats', []),
      branch('diagnostics', 'Diagnostics', 'diagnostics', 'Backend health and query risk', []),
    ]
  }

  return [
    branch('buckets', 'Buckets', 'buckets', 'Time-series storage scopes', [
      branch('bucket-telemetry', 'telemetry', 'bucket', `${connection.engine} bucket`, [
        branch('measurements', 'Measurements', 'measurements', 'Series measurement names', []),
        branch('retention', 'Retention Policies', 'retention-policies', 'Data retention rules', []),
      ]),
    ]),
  ]
}

function wideColumnConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'dynamodb') {
    return [
      branch('tables', 'Tables', 'tables', 'DynamoDB tables', []),
    ]
  }

  return [
    branch('keyspaces', 'Keyspaces', 'keyspaces', 'Wide-column namespaces', [
      branch('keyspace-app', 'app', 'keyspace', `${connection.engine} keyspace`, [
        branch('tables', 'Tables', 'tables', 'Partition-key-first tables', []),
        branch('materialized-views', 'Materialized Views', 'materialized-views', 'Derived query tables', []),
        branch('indexes', 'Indexes', 'indexes', 'SAI/secondary indexes', []),
      ]),
    ]),
  ]
}

function searchConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  return [
    branch('indices', 'Indices', 'indices', `${connection.engine} searchable indices`, []),
    branch('data-streams', 'Data Streams', 'data-streams', 'Append-oriented streams', []),
    branch('mappings', 'Mappings', 'mappings', 'Field mappings and analyzers', []),
  ]
}

function analyticsConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const dataset = connection.database || (connection.engine === 'bigquery' ? 'analytics' : 'public')
  const topLabel = connection.engine === 'bigquery' ? 'Datasets' : 'Schemas'
  const topKind = connection.engine === 'bigquery' ? 'datasets' : 'schemas'

  return [
    branch(topKind, topLabel, topKind, 'Analytical object namespaces', [
      branch(`dataset-${dataset}`, dataset, connection.engine === 'bigquery' ? 'dataset' : 'schema', `${connection.engine} namespace`, [
        branch('tables', 'Tables', 'tables', 'Columnar/warehouse tables', []),
        branch('views', 'Views', 'views', 'Saved analytical projections', []),
        branch('jobs', 'Jobs & Tasks', 'jobs', 'Warehouse jobs, tasks, or scheduled queries', []),
      ]),
    ]),
  ]
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

function systemSqlSchemaForConnection(connection: ConnectionProfile) {
  if (connection.engine === 'sqlserver') {
    return 'sys'
  }

  if (connection.engine === 'mysql' || connection.engine === 'mariadb') {
    return 'information_schema'
  }

  if (connection.engine === 'sqlite' || connection.engine === 'duckdb') {
    return 'temp'
  }

  return 'pg_catalog'
}

function branch(
  id: string,
  label: string,
  kind: string,
  detail: string,
  children: ConnectionTreeNode[],
  options: Partial<ConnectionTreeNode> = {},
): ConnectionTreeNode {
  return { id, label, kind, detail, children, ...options }
}

function leaf(
  id: string,
  label: string,
  kind: string,
  detail: string,
  options: Partial<ConnectionTreeNode> = {},
): ConnectionTreeNode {
  return { id, label, kind, detail, ...options }
}

function fileName(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
}
