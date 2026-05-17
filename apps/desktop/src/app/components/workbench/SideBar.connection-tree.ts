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

  return {
    id: node.id,
    label: node.label,
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
  const scopedName =
    node.scope?.startsWith(`${node.kind}:`) ? node.scope.replace(`${node.kind}:`, '') : undefined
  const [scopedSchema, scopedObjectName] = scopedName?.includes('.')
    ? scopedName.split('.')
    : [undefined, scopedName]
  const normalizedPath =
    node.path?.[0] === connection.name ? node.path.slice(1) : node.path ?? []

  return {
    schema: scopedSchema || normalizedPath[0] || defaultSqlSchema(connection),
    objectName: scopedObjectName || node.label,
  }
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
  const schema = defaultSqlSchema(connection)
  const supportsStoredRoutines = !['sqlite', 'duckdb'].includes(connection.engine)

  return [
    branch('schemas', 'Schemas', 'schemas', `${connection.engine} metadata scopes`, [
      branch(`schema-${schema}`, schema, 'schema', connection.database ?? 'default schema', [
        branch('tables', 'Tables', 'tables', 'Base tables and table-like relations', [
          leaf('table-accounts', 'accounts', 'table', 'sample table', {
            path: [connection.name, schema, 'Tables'],
            queryable: true,
            queryTemplate: sqlObjectQueryTemplate(connection, schema, 'accounts'),
          }),
          leaf('table-transactions', 'transactions', 'table', 'sample table', {
            path: [connection.name, schema, 'Tables'],
            queryable: true,
            queryTemplate: sqlObjectQueryTemplate(connection, schema, 'transactions'),
          }),
        ]),
        branch('views', 'Views', 'views', 'Saved select projections', [
          leaf('view-active-accounts', 'active_accounts', 'view', 'sample view', {
            path: [connection.name, schema, 'Views'],
            queryable: true,
            queryTemplate: sqlObjectQueryTemplate(connection, schema, 'active_accounts'),
          }),
        ]),
        supportsStoredRoutines
          ? branch('stored-procedures', 'Stored Procedures', 'stored-procedures', 'Callable routines', [
              leaf('procedure-refresh-rollups', 'refresh_rollups', 'stored-procedure', 'sample procedure'),
            ])
          : branch('triggers', 'Triggers', 'triggers', 'Local table triggers', [
              leaf('trigger-audit-updated-at', 'audit_updated_at', 'trigger', 'sample trigger'),
            ]),
        branch('indexes', 'Indexes', 'indexes', 'Secondary access paths', [
          leaf('index-accounts-email', 'accounts_email_idx', 'index', 'sample index'),
        ]),
      ]),
    ]),
  ]
}

function documentConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = connection.database || (connection.engine === 'litedb' ? 'local file' : 'admin')

  return [
    branch('databases', 'Databases', 'databases', 'Document database namespaces', [
      branch(`database-${database}`, database, 'database', `${connection.engine} database`, [
        branch('collections', 'Collections', 'collections', 'Document collections', [
          documentCollectionLeaf(connection, 'products'),
          documentCollectionLeaf(connection, 'inventory'),
          documentCollectionLeaf(connection, 'orders'),
        ]),
        branch('indexes', 'Indexes', 'indexes', 'Collection index definitions', [
          leaf('index-products-sku', 'products.sku_1', 'index', 'sample index'),
        ]),
      ]),
    ]),
  ]
}

function documentCollectionLeaf(connection: ConnectionProfile, collection: string) {
  const database = connection.database?.trim()

  return leaf(`collection-${collection}`, collection, 'collection', 'sample collection', {
    path: [connection.name, connection.database ?? 'default', 'Collections'],
    scope: `collection:${collection}`,
    queryable: true,
    builderKind: connection.engine === 'mongodb' ? 'mongo-find' : undefined,
    queryTemplate: documentFindQueryTemplate(collection, 20, database),
  })
}

function keyValueConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'memcached') {
    return [
      branch('namespaces', 'Namespaces', 'namespaces', 'Application key prefixes', [
        leaf('prefix-session', 'session:*', 'prefix', 'sample prefix'),
        leaf('prefix-cache', 'cache:*', 'prefix', 'sample prefix'),
      ]),
      branch('diagnostics', 'Diagnostics', 'diagnostics', 'Runtime cache metadata', [
        leaf('stats-slabs', 'slabs', 'metric', 'slab stats'),
        leaf('stats-items', 'items', 'metric', 'item stats'),
      ]),
    ]
  }

  return [
    branch('keyspaces', 'Key Spaces', 'keyspaces', 'Logical key groups and modules', [
      branch('prefixes', 'Prefixes', 'prefixes', 'SCAN-friendly key prefixes', [
        redisPrefixLeaf(connection, 'session:*', 'hashes'),
        redisPrefixLeaf(connection, 'cache:*', 'strings'),
      ]),
      branch('streams', 'Streams', 'streams', 'Append-only event streams', [
        leaf('stream-orders', 'orders.events', 'stream', 'sample stream'),
      ]),
      branch('sets', 'Sets', 'sets', 'Set and sorted-set keys', [
        leaf('set-online-users', 'online_users', 'set', 'sample set'),
      ]),
    ]),
  ]
}

function redisPrefixLeaf(connection: ConnectionProfile, pattern: string, detail: string) {
  const scopePrefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern

  return leaf(`prefix-${pattern.replace(/[^a-z0-9]+/gi, '-')}`, pattern, 'prefix', detail, {
    path: [connection.name, 'Key Prefixes'],
    scope: `prefix:${scopePrefix}`,
    queryable: true,
    builderKind: 'redis-key-browser',
    queryTemplate: redisKeyBrowserQueryTemplate(pattern),
  })
}

function graphConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const database = connection.database || 'graph'

  return [
    branch('graphs', 'Graphs', 'graphs', 'Graph databases or named graphs', [
      branch(`graph-${database}`, database, 'graph', `${connection.engine} graph`, [
        branch('node-labels', 'Node Labels', 'node-labels', 'Vertex/node categories', [
          leaf('label-customer', 'Customer', 'node-label', 'sample label'),
          leaf('label-order', 'Order', 'node-label', 'sample label'),
        ]),
        branch('relationships', 'Relationship Types', 'relationships', 'Edges and relationship types', [
          leaf('rel-purchased', 'PURCHASED', 'relationship', 'sample relationship'),
        ]),
        branch('constraints', 'Indexes & Constraints', 'constraints', 'Graph lookup and uniqueness rules', [
          leaf('constraint-customer-id', 'Customer.id', 'constraint', 'sample constraint'),
        ]),
      ]),
    ]),
  ]
}

function timeseriesConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'prometheus') {
    return [
      branch('metrics', 'Metrics', 'metrics', 'PromQL metric families', [
        leaf('metric-up', 'up', 'metric', 'instant/range metric'),
        leaf('metric-http-duration', 'http_request_duration_seconds', 'metric', 'histogram'),
      ]),
      branch('labels', 'Labels', 'labels', 'Metric dimensions', [
        leaf('label-job', 'job', 'label', 'target label'),
        leaf('label-instance', 'instance', 'label', 'target label'),
      ]),
      branch('rules', 'Rules', 'rules', 'Alerting and recording rules', [
        leaf('rule-slo-burn', 'slo:burn_rate', 'rule', 'sample recording rule'),
      ]),
    ]
  }

  return [
    branch('buckets', 'Buckets', 'buckets', 'Time-series storage scopes', [
      branch('bucket-telemetry', 'telemetry', 'bucket', `${connection.engine} bucket`, [
        branch('measurements', 'Measurements', 'measurements', 'Series measurement names', [
          leaf('measurement-cpu', 'cpu_usage', 'measurement', 'sample measurement'),
          leaf('measurement-memory', 'memory_usage', 'measurement', 'sample measurement'),
        ]),
        branch('retention', 'Retention Policies', 'retention-policies', 'Data retention rules', [
          leaf('retention-thirty-days', '30d', 'retention-policy', 'sample policy'),
        ]),
      ]),
    ]),
  ]
}

function wideColumnConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  if (connection.engine === 'dynamodb') {
    return [
      branch('tables', 'Tables', 'tables', 'DynamoDB tables', [
        branch('table-orders', 'Orders', 'table', 'partition/sort-key table', [
          branch('indexes', 'Indexes', 'indexes', 'GSI and LSI definitions', [
            leaf('index-gsi-customer', 'GSI1CustomerOrders', 'index', 'sample GSI'),
          ]),
          branch('streams', 'Streams', 'streams', 'Change data capture', [
            leaf('stream-orders', 'Orders stream', 'stream', 'sample stream'),
          ]),
        ], {
          path: [connection.name, 'Tables'],
          queryable: true,
          builderKind: 'dynamodb-key-condition',
          queryTemplate: dynamoDbQueryTemplate('Orders'),
        }),
      ]),
    ]
  }

  return [
    branch('keyspaces', 'Keyspaces', 'keyspaces', 'Wide-column namespaces', [
      branch('keyspace-app', 'app', 'keyspace', `${connection.engine} keyspace`, [
        branch('tables', 'Tables', 'tables', 'Partition-key-first tables', [
          cassandraTableLeaf(connection, 'app', 'events_by_customer'),
          cassandraTableLeaf(connection, 'app', 'orders_by_day'),
        ]),
        branch('materialized-views', 'Materialized Views', 'materialized-views', 'Derived query tables', [
          leaf('view-orders-status', 'orders_by_status', 'materialized-view', 'sample view'),
        ]),
        branch('indexes', 'Indexes', 'indexes', 'SAI/secondary indexes', [
          leaf('index-events-type', 'events_type_idx', 'index', 'sample index'),
        ]),
      ]),
    ]),
  ]
}

function cassandraTableLeaf(connection: ConnectionProfile, keyspace: string, table: string) {
  return leaf(`table-${table}`, table, 'table', 'partition-key table', {
    path: [connection.name, keyspace, 'Tables'],
    queryable: true,
    builderKind: connection.engine === 'cassandra' ? 'cql-partition' : undefined,
    queryTemplate: `select *\nfrom ${keyspace}.${table}\nwhere customer_id = 'CUSTOMER#123'\nlimit 20;`,
  })
}

function dynamoDbQueryTemplate(table: string) {
  return JSON.stringify(
    {
      operation: 'Query',
      tableName: table,
      keyConditionExpression: '#pk = :pk',
      expressionAttributeNames: { '#pk': 'pk' },
      expressionAttributeValues: { ':pk': { S: 'CUSTOMER#123' } },
      limit: 20,
    },
    null,
    2,
  )
}

function searchConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  return [
    branch('indices', 'Indices', 'indices', `${connection.engine} searchable indices`, [
      searchIndexLeaf(connection, 'products'),
      searchIndexLeaf(connection, 'events-*'),
    ]),
    branch('data-streams', 'Data Streams', 'data-streams', 'Append-oriented streams', [
      searchIndexLeaf(connection, 'logs-app-default', 'data-stream'),
    ]),
    branch('mappings', 'Mappings', 'mappings', 'Field mappings and analyzers', [
      leaf('mapping-products', 'products mapping', 'mapping', 'sample mapping'),
    ]),
  ]
}

function searchIndexLeaf(
  connection: ConnectionProfile,
  index: string,
  kind: 'index' | 'data-stream' = 'index',
) {
  return leaf(`${kind}-${index}`, index, kind, kind === 'index' ? 'sample index' : 'sample stream', {
    path: [connection.name, kind === 'index' ? 'Indices' : 'Data Streams'],
    queryable: true,
    builderKind: 'search-dsl',
    queryTemplate: searchDslQueryTemplate(index),
  })
}

function searchDslQueryTemplate(index: string) {
  return JSON.stringify(
    {
      index,
      body: {
        query: { match_all: {} },
        size: 20,
      },
    },
    null,
    2,
  )
}

function analyticsConnectionTree(connection: ConnectionProfile): ConnectionTreeNode[] {
  const dataset = connection.database || (connection.engine === 'bigquery' ? 'analytics' : 'public')
  const topLabel = connection.engine === 'bigquery' ? 'Datasets' : 'Schemas'
  const topKind = connection.engine === 'bigquery' ? 'datasets' : 'schemas'

  return [
    branch(topKind, topLabel, topKind, 'Analytical object namespaces', [
      branch(`dataset-${dataset}`, dataset, connection.engine === 'bigquery' ? 'dataset' : 'schema', `${connection.engine} namespace`, [
        branch('tables', 'Tables', 'tables', 'Columnar/warehouse tables', [
          leaf('table-orders', 'fact_orders', 'table', 'sample table'),
          leaf('table-customers', 'dim_customers', 'table', 'sample table'),
        ]),
        branch('views', 'Views', 'views', 'Saved analytical projections', [
          leaf('view-daily-sales', 'daily_sales', 'view', 'sample view'),
        ]),
        branch('jobs', 'Jobs & Tasks', 'jobs', 'Warehouse jobs, tasks, or scheduled queries', [
          leaf('job-refresh-rollups', 'refresh_rollups', 'job', 'sample job'),
        ]),
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
