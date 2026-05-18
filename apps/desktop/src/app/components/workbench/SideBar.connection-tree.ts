import type {
  ConnectionProfile,
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

export function buildConnectionObjectTree(connection: ConnectionProfile): ConnectionTreeNode[] {
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
    case 'embedded-olap':
      return analyticsConnectionTree(connection)
    case 'sql':
    default:
      return sqlConnectionTree(connection)
  }
  })()

  decorateTreeNodes(connection, tree, undefined)
  return tree
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
  const isMongoCollection = connection.engine === 'mongodb' && normalizedKind === 'collection'
  const isRedisPrefix = isRedisLikeConnection(connection) && normalizedKind === 'prefix'
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
    queryable: isRedisPrefix || isExplorerNodeQueryable(connection, node),
    expandable: node.expandable,
    builderKind: isMongoCollection
      ? 'mongo-find'
      : isRedisPrefix
        ? 'redis-key-browser'
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
    ['table', 'hypertable', 'view', 'materialized-view'].includes(kind)
  ) {
    const { schema, objectName } = sqlObjectPartsFromExplorerNode(connection, node)

    if (objectName) {
      return sqlObjectQueryTemplate(connection, schema, objectName)
    }
  }

  if (connection.engine === 'mongodb' && node.kind === 'collection') {
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

  return Boolean(
    ['collection', 'table', 'hypertable', 'view', 'materialized-view'].includes(kind) ||
      (['elasticsearch', 'opensearch'].includes(connection.engine) &&
        ['index', 'data-stream'].includes(kind)) ||
      (connection.engine === 'dynamodb' && kind === 'table') ||
      (connection.engine === 'cassandra' && kind === 'table'),
  )
}

function sqlConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'sqlserver') {
    return sqlServerConnectionTree(connection)
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
    ...SQL_SERVER_SERVER_LEVEL_GROUPS.map((label) =>
      branch(
        label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        label,
        label.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        `SQL Server ${label.toLowerCase()}`,
        [],
      ),
    ),
  ]
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
  const database = connection.database || (connection.engine === 'litedb' ? 'local file' : 'admin')

  return [
    branch('databases', 'Databases', 'databases', 'Document database namespaces', [
      branch(`database-${database}`, database, 'database', `${connection.engine} database`, [
        branch('collections', 'Collections', 'collections', 'Document collections', []),
        branch('indexes', 'Indexes', 'indexes', 'Collection index definitions', []),
      ]),
    ]),
  ]
}

function keyValueConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'memcached') {
    return [
      branch('namespaces', 'Namespaces', 'namespaces', 'Application key prefixes', []),
      branch('diagnostics', 'Diagnostics', 'diagnostics', 'Runtime cache metadata', [
        leaf('stats-slabs', 'slabs', 'metric', 'slab stats'),
        leaf('stats-items', 'items', 'metric', 'item stats'),
      ]),
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
  const database = connection.database || 'graph'

  return [
    branch('graphs', 'Graphs', 'graphs', 'Graph databases or named graphs', [
      branch(`graph-${database}`, database, 'graph', `${connection.engine} graph`, [
        branch('node-labels', 'Node Labels', 'node-labels', 'Vertex/node categories', []),
        branch('relationships', 'Relationship Types', 'relationships', 'Edges and relationship types', []),
        branch('constraints', 'Indexes & Constraints', 'constraints', 'Graph lookup and uniqueness rules', []),
      ]),
    ]),
  ]
}

function timeseriesConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'prometheus') {
    return [
      branch('metrics', 'Metrics', 'metrics', 'PromQL metric families', []),
      branch('labels', 'Labels', 'labels', 'Metric dimensions', []),
      branch('rules', 'Rules', 'rules', 'Alerting and recording rules', []),
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
