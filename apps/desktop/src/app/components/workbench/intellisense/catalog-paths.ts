import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type { CompletionCatalogInput } from './types'

interface SqlNameParts {
  schema?: string
  objectName?: string
}

export function normalizeCatalogKind(kind: string) {
  const normalized = kind.trim().toLowerCase().replace(/_/g, '-')
  if (normalized === 'base table' || normalized === 'base-table') return 'table'
  if (normalized === 'materialized view') return 'materialized-view'
  if (normalized === 'stored procedure') return 'stored-procedure'
  if (normalized === 'data stream') return 'data-stream'
  return normalized
}

export function completionObjectPartsFromExplorerNode(
  connection: CompletionCatalogInput['connection'],
  node: CompletionCatalogInput['explorerNodes'][number],
  kind: string,
) {
  if (connection?.family !== 'sql' && connection?.family !== 'embedded-olap') {
    return { schema: schemaFromExplorerPath(connection, node.path), objectName: node.label }
  }

  const scopeParts = sqlNamePartsFromScope(node.scope, connection?.engine)
  const labelParts = splitQualifiedName(node.label)
  const idParts = splitQualifiedName(node.id)
  const pathParts = sqlNamePartsFromPath(connection, node.path)
  const schema = scopeParts.schema ?? pathParts.schema ?? labelParts.schema ?? idParts.schema
  const objectName = scopeParts.objectName
    ?? (isSqlChildKind(kind) ? pathParts.objectName : undefined)
    ?? labelParts.objectName
    ?? (idParts.schema ? idParts.objectName : undefined)
    ?? node.label
  return { schema, objectName }
}

function schemaFromExplorerPath(
  connection: CompletionCatalogInput['connection'],
  path?: string[],
) {
  const categoryFreePath = cleanExplorerPath(connection, path)
    .filter((segment) => !isMetadataCategory(segment))
  if (categoryFreePath.length === 0) return undefined
  return categoryFreePath.length > 1 ? categoryFreePath.at(-2) : categoryFreePath[0]
}

function sqlNamePartsFromPath(
  connection: CompletionCatalogInput['connection'],
  path?: string[],
): SqlNameParts {
  const categoryFreePath = cleanExplorerPath(connection, path)
    .filter((segment) => !isMetadataCategory(segment))
  if (categoryFreePath.length === 0) return {}
  if (categoryFreePath.length === 1) {
    const qualified = splitQualifiedName(categoryFreePath[0])
    return qualified.schema ? qualified : { schema: categoryFreePath[0] }
  }
  return { schema: categoryFreePath[0], objectName: categoryFreePath.at(-1) }
}

function cleanExplorerPath(
  connection: CompletionCatalogInput['connection'],
  path?: string[],
) {
  const segments = (path ?? []).filter(Boolean)
  const rootLabels = new Set([
    connection?.name,
    connection?.engine,
    'PostgreSQL',
    'CockroachDB',
    'TimescaleDB',
    'SQL Server',
    'MySQL',
    'MariaDB',
    'SQLite',
    'Oracle',
  ].filter(Boolean) as string[])
  return segments[0] && rootLabels.has(segments[0]) ? segments.slice(1) : segments
}

function sqlNamePartsFromScope(
  scope?: string,
  engine?: ConnectionProfile['engine'],
): SqlNameParts {
  if (engine === 'oracle' && scope?.startsWith('oracle:object:')) {
    const [, , , schema, ...objectParts] = scope.split(':')
    return { schema: schema || undefined, objectName: objectParts.join(':') || undefined }
  }
  const name = scope?.split(':').slice(1).join(':')
  return name ? splitQualifiedName(name) : {}
}

function splitQualifiedName(value: string | undefined): SqlNameParts {
  const clean = value?.replaceAll('[', '').replaceAll(']', '').replaceAll('"', '').trim()
  if (!clean?.includes('.')) return clean ? { objectName: clean } : {}
  const parts = clean.split('.').filter(Boolean)
  return { schema: parts.length > 1 ? parts.at(-2) : undefined, objectName: parts.at(-1) }
}

function isSqlChildKind(kind: string) {
  return ['column', 'field', 'index', 'constraint', 'trigger'].includes(kind)
}

const METADATA_CATEGORIES = new Set([
  'schemas',
  'databases',
  'user schemas',
  'system schemas',
  'tables',
  'system tables',
  'views',
  'materialized views',
  'stored procedures',
  'procedures',
  'programmability',
  'functions',
  'sequences',
  'types',
  'extensions',
  'columns',
  'indexes',
  'constraints',
  'triggers',
  'security',
  'diagnostics',
].map((label) => label.toLowerCase()))

function isMetadataCategory(label: string | undefined) {
  return Boolean(label && METADATA_CATEGORIES.has(label.toLowerCase()))
}
