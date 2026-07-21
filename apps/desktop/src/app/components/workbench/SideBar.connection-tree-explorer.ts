import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import {
  branchNodeForPath,
  documentFindQueryTemplate,
  normalizeExplorerKind,
  placementForExplorerNode,
  redisKeyBrowserQueryTemplate,
  sqlObjectQueryTemplate,
} from './SideBar.datastore-tree-registry'
import { decorateTreeNodes } from './SideBar.connection-tree-decorate'
import { defaultSqlSchema, isSqlTableLikeKind } from './SideBar.connection-tree-sql'
import type { ConnectionTreeNode } from './SideBar.connection-tree-types'

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
    ['collection', 'documents', 'aggregations', 'view-results', 'sample-results', 'gridfs-collection'].includes(
      normalizedKind,
    )
  const isRedisConnection = isRedisLikeConnection(connection)
  const isRedisPrefix = isRedisConnection && normalizedKind === 'prefix'
  const isRedisDatabase = isRedisConnection && normalizedKind === 'database'
  const isSearchBuilderNode =
    connection.family === 'search' &&
    ['index', 'data-stream', 'documents'].includes(normalizedKind)
  const isDynamoBuilderNode =
    connection.engine === 'dynamodb' &&
    ['table', 'items'].includes(normalizedKind)
  const isCassandraBuilderNode =
    connection.engine === 'cassandra' &&
    ['table', 'data', 'materialized-view'].includes(normalizedKind)
  const isCosmosBuilderNode =
    connection.engine === 'cosmosdb' &&
    (connection.cosmosDbOptions?.api ?? 'nosql') === 'nosql' &&
    ['container', 'items'].includes(normalizedKind)
  const isGraphQueryNode =
    connection.family === 'graph' &&
    ['graph', 'node-label', 'relationship'].includes(normalizedKind)
  const redisPattern =
    isRedisPrefix || isRedisDatabase
      ? redisPatternFromExplorerNode(node, normalizedKind)
      : undefined
  const redisDatabaseIndex = isRedisConnection
    ? redisDatabaseIndexFromExplorerNode(node)
    : undefined
  const label = sqlDisplayLabelForExplorerNode(connection, node, normalizedKind)

  return {
    id: node.id,
    label,
    kind: normalizedKind,
    detail: node.detail,
    scope: node.scope,
    refreshScope: node.scope,
    path: Array.isArray(node.path) ? node.path : [],
    queryTemplate:
      redisPattern !== undefined
        ? redisKeyBrowserQueryTemplate(redisPattern, 100, redisDatabaseIndex)
        : (node.queryTemplate ?? fallbackExplorerQueryTemplate(connection, node)),
    queryable: isRedisPrefix || isRedisDatabase || isGraphQueryNode || isExplorerNodeQueryable(connection, node),
    expandable: node.expandable,
    builderKind: isMongoBuilderNode
      ? normalizedKind === 'aggregations'
        ? 'mongo-aggregation'
        : 'mongo-find'
      : isRedisPrefix
        ? 'redis-key-browser'
        : isRedisDatabase
          ? 'redis-key-browser'
        : isSearchBuilderNode
          ? 'search-dsl'
          : isDynamoBuilderNode
            ? 'dynamodb-key-condition'
            : isCassandraBuilderNode
              ? 'cql-partition'
              : isCosmosBuilderNode
                ? 'cosmos-sql'
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
    ['collection', 'documents', 'aggregations', 'view-results', 'sample-results', 'gridfs-collection'].includes(
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

function redisPatternFromExplorerNode(node: ExplorerNode, kind: string) {
  if (kind === 'database') return '*'

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

function redisDatabaseIndexFromExplorerNode(node: ExplorerNode) {
  const scopedDatabase = /^db:(\d+)(?::|$)/.exec(node.scope ?? '')?.[1]
  const labelDatabase = /^DB\s+(\d+)$/i.exec(node.label.trim())?.[1]
  const candidate = scopedDatabase ?? labelDatabase

  if (!candidate) return undefined

  const parsed = Number.parseInt(candidate, 10)
  return Number.isFinite(parsed) ? Math.max(0, parsed) : undefined
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
  const pathObject = normalizedPath.find(isQualifiedSqlPathSegment)
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

function isQualifiedSqlPathSegment(segment: string) {
  const [schema, objectName] = splitSqlName(segment)
  return Boolean(schema && objectName)
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
    return ['collection', 'documents', 'aggregations', 'view-results', 'sample-results', 'gridfs-collection'].includes(
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
