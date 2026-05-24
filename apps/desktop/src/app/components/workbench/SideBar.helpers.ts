import type { CSSProperties } from 'react'
import type {
  ConnectionGroupMode,
  ConnectionProfile,
  EnvironmentProfile,
  ExplorerNode,
  ScopedQueryTarget,
} from '@datapadplusplus/shared-types'
import type { ConnectionTreeNode } from './SideBar.connection-tree'

export {
  buildConnectionObjectTree,
  buildConnectionObjectTreeFromExplorerNodes,
} from './SideBar.connection-tree'
export type { ConnectionTreeNode } from './SideBar.connection-tree'
export type { ConnectionTreeAction } from './SideBar.datastore-tree-registry'

export function isScopedQueryable(node: ConnectionTreeNode) {
  return Boolean(node.queryable || node.builderKind)
}

export function connectionTreeNodeTarget(node: ConnectionTreeNode): ScopedQueryTarget {
  return {
    kind: node.kind,
    label: node.label,
    path: node.path,
    scope: node.scope,
    queryTemplate: node.queryTemplate,
    preferredBuilder: node.builderKind,
  }
}

export function isExplorerNodeQueryable(node: ExplorerNode) {
  const kind = node.kind.trim().toLowerCase().replace(/_/g, '-')

  return [
    'collection',
    'documents',
    'aggregations',
    'gridfs-collection',
    'sample-results',
    'table',
    'base-table',
    'view',
    'materialized-view',
    'prefix',
    'index',
    'data-stream',
    'items',
    'data',
    'metric',
    'series',
    'measurement',
    'graph',
    'node-label',
    'relationship',
  ].includes(kind)
}

export function explorerNodeTarget(
  node: ExplorerNode,
  connection: ConnectionProfile | undefined,
): ScopedQueryTarget {
  const kind = node.kind.trim().toLowerCase().replace(/_/g, '-')
  const redisPrefix =
    ['redis', 'valkey'].includes(connection?.engine ?? '') && kind === 'prefix'
  const searchTarget =
    connection?.family === 'search' && ['index', 'data-stream', 'documents'].includes(kind)
  const dynamoTarget =
    connection?.engine === 'dynamodb' && ['table', 'items'].includes(kind)
  const cassandraTarget =
    connection?.engine === 'cassandra' && ['table', 'data', 'materialized-view'].includes(kind)

  return {
    kind: node.kind,
    label: node.label,
    path: node.path,
    scope: node.scope,
    queryTemplate: redisPrefix ? redisKeyBrowserQueryTemplateForNode(node) : node.queryTemplate,
    preferredBuilder: preferredBuilderForExplorerNode({
      cassandraTarget,
      dynamoTarget,
      kind,
      redisPrefix,
      searchTarget,
      engine: connection?.engine,
    }),
  }
}

function preferredBuilderForExplorerNode({
  cassandraTarget,
  dynamoTarget,
  engine,
  kind,
  redisPrefix,
  searchTarget,
}: {
  cassandraTarget: boolean
  dynamoTarget: boolean
  engine?: string
  kind: string
  redisPrefix: boolean
  searchTarget: boolean
}): ScopedQueryTarget['preferredBuilder'] | undefined {
  if (engine === 'mongodb' && kind === 'aggregations') {
    return 'mongo-aggregation'
  }

  if (engine === 'mongodb' && ['collection', 'documents', 'gridfs-collection', 'sample-results'].includes(kind)) {
    return 'mongo-find'
  }

  if (redisPrefix) {
    return 'redis-key-browser'
  }

  if (searchTarget) {
    return 'search-dsl'
  }

  if (dynamoTarget) {
    return 'dynamodb-key-condition'
  }

  if (cassandraTarget) {
    return 'cql-partition'
  }

  return undefined
}

function redisKeyBrowserQueryTemplateForNode(node: ExplorerNode) {
  const scopedPrefix = node.scope?.startsWith('prefix:')
    ? node.scope.replace('prefix:', '')
    : undefined
  const candidate = scopedPrefix || node.label || '*'
  const pattern = candidate.includes('*')
    ? candidate
    : candidate.endsWith(':')
      ? `${candidate}*`
      : candidate

  return JSON.stringify(
    {
      mode: 'redis-key-browser',
      pattern,
      type: 'all',
      count: 100,
    },
    null,
    2,
  )
}

export function sidebarSectionId(pane: string, scope: string, label: string) {
  return `${pane}:${scope}:${label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'section'}`
}

export function connectionGroupLabel(
  connection: ConnectionProfile,
  mode: ConnectionGroupMode,
  environments: EnvironmentProfile[],
) {
  if (mode === 'none') {
    return 'Connections'
  }

  if (mode === 'database-type') {
    return databaseTypeGroupLabel(connection)
  }

  const environment = environments.find((item) => connection.environmentIds.includes(item.id))

  return environment?.label ?? 'No Environment'
}

export function environmentAccentVariables(
  environment?: EnvironmentProfile,
): CSSProperties | undefined {
  const color = normalizeHexColor(environment?.color)

  if (!color) {
    return undefined
  }

  return {
    '--connection-env-color': color,
    '--connection-env-tint': hexToRgba(color, 0.09),
    '--connection-env-border': hexToRgba(color, 0.5),
  } as CSSProperties
}

function databaseTypeGroupLabel(connection: ConnectionProfile) {
  if (connection.family === 'document') {
    return 'NoSQL / Document'
  }

  if (connection.family === 'keyvalue') {
    return 'Key-Value'
  }

  if (connection.family === 'graph') {
    return 'Graph'
  }

  if (connection.family === 'timeseries') {
    return 'Time-Series'
  }

  if (connection.family === 'widecolumn') {
    return 'Wide-Column'
  }

  if (connection.family === 'search') {
    return 'Search'
  }

  if (connection.family === 'warehouse') {
    return 'Warehouse'
  }

  if (connection.family === 'embedded-olap') {
    return 'Embedded OLAP'
  }

  return 'SQL'
}

function normalizeHexColor(color?: string) {
  if (!color) {
    return undefined
  }

  const trimmed = color.trim()

  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed
  }

  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const [, red, green, blue] = trimmed
    return `#${red}${red}${green}${green}${blue}${blue}`
  }

  return undefined
}

function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16)
  const green = Number.parseInt(value.slice(2, 4), 16)
  const blue = Number.parseInt(value.slice(4, 6), 16)

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
