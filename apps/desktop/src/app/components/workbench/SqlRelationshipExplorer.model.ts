import type {
  ConnectionProfile,
  DatastoreEngine,
  StructureEdge,
  StructureNode,
  StructureResponse,
} from '@datapadplusplus/shared-types'

const SQL_STYLE_ENGINES = new Set<DatastoreEngine>([
  'postgresql',
  'cockroachdb',
  'sqlserver',
  'mysql',
  'mariadb',
  'sqlite',
  'oracle',
  'timescaledb',
  'clickhouse',
  'duckdb',
  'snowflake',
  'bigquery',
])

const SYSTEM_SCHEMAS = new Set([
  'information_schema',
  'pg_catalog',
  'pg_toast',
  'mysql',
  'performance_schema',
  'sys',
  'master',
  'model',
  'msdb',
  'tempdb',
  'dbo.sys',
])

export interface SqlExplorerNode {
  node: StructureNode
  schema: string
  objectName: string
  qualifiedName: string
  objectKind: string
  isSystem: boolean
  isView: boolean
  primaryFields: string[]
  fieldCount: number
  relationshipCount: number
  incoming: StructureEdge[]
  outgoing: StructureEdge[]
  searchText: string
}

export interface SqlRelationshipModel {
  nodes: SqlExplorerNode[]
  edges: StructureEdge[]
  nodeById: Map<string, SqlExplorerNode>
  schemas: string[]
  objectKinds: string[]
}

export function isSqlStyleConnection(connection?: ConnectionProfile) {
  return Boolean(
    connection &&
      (connection.family === 'sql' ||
        connection.family === 'warehouse' ||
        connection.family === 'embedded-olap' ||
        SQL_STYLE_ENGINES.has(connection.engine)),
  )
}

export function buildSqlRelationshipModel(
  structure: StructureResponse | undefined,
  includeInferredRelationships: boolean,
): SqlRelationshipModel {
  const rawNodes = (structure?.nodes ?? []).filter((node) => isSqlObjectKind(node.kind))
  const nodeById = new Map<string, SqlExplorerNode>()
  const declaredEdges = (structure?.edges ?? []).filter((edge) => edge.from && edge.to)
  const inferredEdges = includeInferredRelationships
    ? inferRelationshipEdges(rawNodes, declaredEdges)
    : []
  const edges = [...declaredEdges, ...inferredEdges].filter(
    (edge) => rawNodes.some((node) => node.id === edge.from) && rawNodes.some((node) => node.id === edge.to),
  )

  for (const node of rawNodes) {
    const normalized = normalizeSqlNode(node, edges)
    nodeById.set(node.id, normalized)
  }

  const nodes = [...nodeById.values()]
  const schemas = uniqueSorted(nodes.map((node) => node.schema))
  const objectKinds = uniqueSorted(nodes.map((node) => node.objectKind))

  return {
    nodes,
    edges,
    nodeById,
    schemas,
    objectKinds,
  }
}

export function buildSelectSql(node: SqlExplorerNode, engine: DatastoreEngine) {
  return `select *\nfrom ${quoteQualifiedName(node.schema, node.objectName, engine)}\nlimit 100;`
}

export function buildJoinSql(
  selected: SqlExplorerNode,
  edge: StructureEdge | undefined,
  model: SqlRelationshipModel,
  engine: DatastoreEngine,
) {
  if (!edge?.fromField || !edge.toField) {
    return buildSelectSql(selected, engine)
  }

  const from = model.nodeById.get(edge.from)
  const to = model.nodeById.get(edge.to)

  if (!from || !to) {
    return buildSelectSql(selected, engine)
  }

  return [
    'select *',
    `from ${quoteQualifiedName(from.schema, from.objectName, engine)} as source`,
    `join ${quoteQualifiedName(to.schema, to.objectName, engine)} as target`,
    `  on source.${quoteIdentifier(edge.fromField, engine)} = target.${quoteIdentifier(edge.toField, engine)};`,
  ].join('\n')
}

export function buildForeignKeyPreviewSql(
  edge: StructureEdge | undefined,
  model: SqlRelationshipModel,
  engine: DatastoreEngine,
) {
  if (!edge?.fromField || !edge.toField) {
    return undefined
  }

  const from = model.nodeById.get(edge.from)
  const to = model.nodeById.get(edge.to)

  if (!from || !to) {
    return undefined
  }

  const constraintName =
    edge.constraintName ??
    `fk_${sanitizeIdentifier(from.objectName)}_${sanitizeIdentifier(edge.fromField)}_${sanitizeIdentifier(to.objectName)}`

  return [
    `alter table ${quoteQualifiedName(from.schema, from.objectName, engine)}`,
    `add constraint ${quoteIdentifier(constraintName, engine)}`,
    `foreign key (${quoteIdentifier(edge.fromField, engine)})`,
    `references ${quoteQualifiedName(to.schema, to.objectName, engine)} (${quoteIdentifier(edge.toField, engine)});`,
  ].join('\n')
}

export function edgeLabel(edge: StructureEdge) {
  if (edge.fromField && edge.toField) {
    return `${edge.fromField} -> ${edge.toField}`
  }

  return edge.label
}

function normalizeSqlNode(node: StructureNode, edges: StructureEdge[]): SqlExplorerNode {
  const parsed = parseQualifiedName(node)
  const outgoing = edges.filter((edge) => edge.from === node.id)
  const incoming = edges.filter((edge) => edge.to === node.id)
  const fields = node.fields ?? []
  const primaryFields = fields.filter((field) => field.primary).map((field) => field.name)
  const objectKind = normalizeObjectKind(node.kind)
  const schema = node.schema ?? parsed.schema
  const objectName = node.objectName ?? parsed.objectName
  const qualifiedName = node.qualifiedName ?? `${schema}.${objectName}`
  const isSystem = node.isSystem ?? isSystemObject(schema, objectName)
  const isView = node.isView ?? objectKind.includes('view')
  const fieldSearch = fields.map((field) => `${field.name} ${field.dataType}`).join(' ')

  return {
    node,
    schema,
    objectName,
    qualifiedName,
    objectKind,
    isSystem,
    isView,
    primaryFields,
    fieldCount: node.columnCount ?? fields.length,
    relationshipCount: node.relationshipCount ?? outgoing.length + incoming.length,
    incoming,
    outgoing,
    searchText: `${node.label} ${node.detail ?? ''} ${schema} ${objectName} ${qualifiedName} ${objectKind} ${fieldSearch}`.toLowerCase(),
  }
}

function parseQualifiedName(node: StructureNode) {
  const source = node.qualifiedName ?? node.detail ?? node.id
  const parts = source.split('.').filter(Boolean)

  if (parts.length >= 2) {
    return {
      schema: parts.at(-2) ?? node.groupId ?? 'default',
      objectName: parts.at(-1) ?? node.label,
    }
  }

  return {
    schema: node.groupId ?? node.schema ?? 'default',
    objectName: node.objectName ?? node.label,
  }
}

function inferRelationshipEdges(nodes: StructureNode[], declaredEdges: StructureEdge[]) {
  const targetByName = new Map<string, StructureNode>()

  for (const node of nodes) {
    const names = candidateObjectNames(node)
    for (const name of names) {
      if (!targetByName.has(name)) {
        targetByName.set(name, node)
      }
    }
  }

  const declaredKeys = new Set(
    declaredEdges.map((edge) => `${edge.from}:${edge.fromField ?? edge.label}->${edge.to}:${edge.toField ?? ''}`),
  )
  const inferred: StructureEdge[] = []

  for (const node of nodes) {
    for (const field of node.fields ?? []) {
      if (field.primary) {
        continue
      }

      const targetName = inferTargetName(field.name)
      if (!targetName) {
        continue
      }

      const target = targetByName.get(targetName)
      if (!target || target.id === node.id || !typesCanReference(field.dataType, target)) {
        continue
      }

      const targetField = (target.fields ?? []).find((candidate) => candidate.primary)?.name ?? 'id'
      const key = `${node.id}:${field.name}->${target.id}:${targetField}`

      if (declaredKeys.has(key)) {
        continue
      }

      inferred.push({
        id: `inferred:${node.id}:${field.name}->${target.id}:${targetField}`,
        from: node.id,
        to: target.id,
        label: `${field.name} may reference ${target.label}.${targetField}`,
        kind: 'inferred-reference',
        inferred: true,
        fromField: field.name,
        toField: targetField,
        cardinality: 'many-to-one',
        confidence: targetName === target.label.toLowerCase() ? 0.82 : 0.68,
      })
    }
  }

  return inferred
}

function candidateObjectNames(node: StructureNode) {
  const label = (node.objectName ?? node.label).toLowerCase()
  const singular = label.endsWith('ies')
    ? `${label.slice(0, -3)}y`
    : label.endsWith('s')
      ? label.slice(0, -1)
      : label

  return new Set([label, singular])
}

function inferTargetName(fieldName: string) {
  const lower = fieldName.toLowerCase()
  if (lower === 'id' || lower === '_id') {
    return undefined
  }

  for (const suffix of ['_id', 'id']) {
    if (lower.endsWith(suffix) && lower.length > suffix.length) {
      return lower.slice(0, -suffix.length).replace(/[_\s-]+$/u, '')
    }
  }

  return undefined
}

function typesCanReference(sourceType: string, target: StructureNode) {
  const targetPrimary = (target.fields ?? []).find((field) => field.primary)

  if (!targetPrimary) {
    return true
  }

  return dataTypeFamily(sourceType) === dataTypeFamily(targetPrimary.dataType)
}

function dataTypeFamily(value: string) {
  const normalized = value.toLowerCase()

  if (normalized.includes('uuid') || normalized.includes('uniqueidentifier')) return 'uuid'
  if (normalized.includes('int') || normalized.includes('number') || normalized.includes('decimal') || normalized.includes('numeric')) return 'number'
  if (normalized.includes('char') || normalized.includes('text') || normalized.includes('string')) return 'text'
  return 'other'
}

function isSqlObjectKind(kind: string) {
  const normalized = normalizeObjectKind(kind)
  return normalized.includes('table') || normalized.includes('view')
}

function normalizeObjectKind(kind: string) {
  return kind.toLowerCase().replace(/\s+/gu, '-')
}

function isSystemObject(schema: string, objectName: string) {
  const lowerSchema = schema.toLowerCase()
  const lowerObject = objectName.toLowerCase()
  return SYSTEM_SCHEMAS.has(lowerSchema) || lowerObject.startsWith('sqlite_') || lowerObject.startsWith('sys')
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right))
}

function quoteQualifiedName(schema: string, objectName: string, engine: DatastoreEngine) {
  if (schema && schema !== 'default') {
    return `${quoteIdentifier(schema, engine)}.${quoteIdentifier(objectName, engine)}`
  }

  return quoteIdentifier(objectName, engine)
}

function quoteIdentifier(value: string, engine: DatastoreEngine) {
  if (engine === 'sqlserver') {
    return `[${value.replaceAll(']', ']]')}]`
  }

  if (engine === 'mysql' || engine === 'mariadb' || engine === 'clickhouse') {
    return `\`${value.replaceAll('`', '``')}\``
  }

  return `"${value.replaceAll('"', '""')}"`
}

function sanitizeIdentifier(value: string) {
  return value.replace(/[^a-zA-Z0-9_]+/gu, '_').replace(/^_+|_+$/gu, '') || 'relationship'
}
