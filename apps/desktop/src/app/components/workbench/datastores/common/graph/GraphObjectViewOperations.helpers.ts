import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'

type JsonRecord = Record<string, unknown>

export type GraphOperationIconName =
  | 'graph'
  | 'index'
  | 'constraint'
  | 'security'
  | 'diagnostics'
  | 'delete'

export type GraphOperationAction = {
  label: string
  title: string
  icon: GraphOperationIconName
  operationId: string
  objectName: string
  parameters: Record<string, unknown>
}

export function graphOperationActions(
  connection: ConnectionProfile,
  tab: QueryTabState,
  kind: string,
  payload: JsonRecord,
): GraphOperationAction[] {
  const supported = supportedGraphOperations(connection)
  const normalizedKind = normalizeKind(kind)
  const target = graphOperationTarget(connection, tab, payload)
  const actions: GraphOperationAction[] = []

  if (!target.objectName) {
    return actions
  }

  const baseParameters = graphOperationParameters(tab, payload, target)

  if (isProfileLike(normalizedKind) && supported.has('profile')) {
    actions.push(action(connection, 'query.profile', 'Profile', 'Prepare a guarded graph profile request', 'diagnostics', target.objectName, {
      ...baseParameters,
      query: target.queryTemplate,
    }))
  }

  if (isMetricsLike(normalizedKind) && supported.has('metrics')) {
    actions.push(action(connection, 'diagnostics.metrics', 'Metrics', 'Collect graph health, runtime, and storage signals', 'diagnostics', target.objectName, baseParameters))
  }

  if (isSecurityLike(normalizedKind) && supported.has('permissions')) {
    actions.push(action(connection, 'security.inspect', 'Access', 'Review visible graph users, roles, grants, or IAM permissions', 'security', target.objectName, baseParameters))
  }

  if (isIndexLike(normalizedKind) && supported.has('indexes')) {
    actions.push(action(connection, 'index.create', 'Create Index', 'Prepare a guarded graph index creation plan', 'index', target.objectName, {
      ...baseParameters,
      indexName: target.indexName || suggestedIndexName(target),
    }))
    if (target.indexName) {
      actions.push(action(connection, 'index.drop', 'Drop Index', 'Prepare a guarded graph index drop plan', 'delete', target.objectName, baseParameters))
    }
  }

  if (isConstraintLike(normalizedKind) && supported.has('admin')) {
    actions.push(action(connection, 'object.drop', 'Drop Constraint', 'Prepare a guarded constraint drop plan', 'delete', target.objectName, baseParameters))
  }

  if (isExportLike(normalizedKind) && supported.has('importExport')) {
    actions.push(action(connection, 'data.import-export', 'Export', 'Prepare an engine-native graph export workflow', 'graph', target.objectName, {
      ...baseParameters,
      mode: 'export',
      format: defaultGraphExportFormat(connection.engine),
    }))
  }

  return dedupeActions(actions).slice(0, 6)
}

export function graphOperationObjectName(
  connection: ConnectionProfile,
  tab: QueryTabState,
  payload: JsonRecord,
) {
  return graphOperationTarget(connection, tab, payload).objectName
}

function graphOperationTarget(
  connection: ConnectionProfile,
  tab: QueryTabState,
  payload: JsonRecord,
) {
  const state = tab.objectViewState
  const kind = normalizeKind(state?.kind ?? '')
  const graphName = stringValue(payload.graphName ?? payload.database ?? connection.database ?? state?.path?.[0])
  const label = stringValue(payload.label ?? payload.name ?? state?.label)
  const relationshipType = stringValue(payload.type ?? payload.relationshipType ?? state?.label)
  const propertyName = stringValue(payload.property ?? payload.propertyName ?? state?.label)
  const indexName = stringValue(payload.indexName ?? payload.name ?? state?.label)
  const constraintName = stringValue(payload.constraintName ?? payload.name ?? state?.label)
  const objectName = stringValue(
    kind.includes('relationship')
      ? relationshipType
      : kind.includes('property')
        ? propertyName
        : kind.includes('index')
          ? indexName
          : kind.includes('constraint')
            ? constraintName
            : label || graphName,
  )

  return {
    graphName,
    label,
    relationshipType,
    propertyName,
    indexName: kind.includes('index') ? indexName : '',
    constraintName: kind.includes('constraint') ? constraintName : '',
    objectName,
    queryTemplate: state?.queryTemplate ?? defaultGraphQueryTemplate(connection, kind, objectName),
  }
}

function supportedGraphOperations(connection: ConnectionProfile) {
  const capabilities = new Set(datastoreBacklogByEngine(connection.engine)?.capabilities ?? [])
  const supported = new Set<string>()

  if (capabilities.has('supports_query_profile')) {
    supported.add('profile')
  }
  if (capabilities.has('supports_metrics_collection')) {
    supported.add('metrics')
  }
  if (capabilities.has('supports_permission_inspection') || capabilities.has('supports_cloud_iam')) {
    supported.add('permissions')
  }
  if (capabilities.has('supports_index_management')) {
    supported.add('indexes')
  }
  if (capabilities.has('supports_admin_operations')) {
    supported.add('admin')
  }
  if (capabilities.has('supports_import_export')) {
    supported.add('importExport')
  }

  return supported
}

function graphOperationParameters(
  tab: QueryTabState,
  payload: JsonRecord,
  target: ReturnType<typeof graphOperationTarget>,
) {
  return {
    objectKind: tab.objectViewState?.kind,
    graphName: target.graphName || undefined,
    label: target.label || undefined,
    relationshipType: target.relationshipType || undefined,
    propertyName: target.propertyName || undefined,
    indexName: target.indexName || undefined,
    constraintName: target.constraintName || undefined,
    target: payload.target,
    properties: payload.properties,
    query: target.queryTemplate,
  }
}

function isProfileLike(kind: string) {
  return ['graph', 'graphs', 'node-label', 'node-labels', 'relationship', 'relationship-types', 'property-key', 'property-keys'].includes(kind)
}

function isMetricsLike(kind: string) {
  return ['graph', 'graphs', 'diagnostics', 'procedures', 'node-label', 'node-labels', 'indexes', 'index', 'constraints', 'constraint'].includes(kind)
}

function isSecurityLike(kind: string) {
  return ['security', 'procedures'].includes(kind)
}

function isIndexLike(kind: string) {
  return ['indexes', 'index', 'node-label', 'node-labels', 'property-key', 'property-keys'].includes(kind)
}

function isConstraintLike(kind: string) {
  return ['constraint', 'constraints'].includes(kind)
}

function isExportLike(kind: string) {
  return ['graph', 'graphs', 'node-label', 'node-labels', 'relationship', 'relationship-types'].includes(kind)
}

function defaultGraphQueryTemplate(
  connection: ConnectionProfile,
  kind: string,
  objectName: string,
) {
  if (connection.engine === 'arango') {
    return `FOR doc IN ${objectName || '<collection>'}\n  LIMIT 25\n  RETURN doc`
  }

  if (connection.engine === 'neptune' || connection.engine === 'janusgraph') {
    if (kind.includes('relationship')) {
      return `g.E().hasLabel('${objectName || '<edge-label>'}').limit(25)`
    }
    return `g.V().hasLabel('${objectName || '<label>'}').limit(25)`
  }

  if (kind.includes('relationship')) {
    return `MATCH ()-[r:\`${objectName || '<TYPE>'}\`]->() RETURN r LIMIT 25`
  }

  return `MATCH (n:\`${objectName || '<Label>'}\`) RETURN n LIMIT 25`
}

function suggestedIndexName(target: ReturnType<typeof graphOperationTarget>) {
  const label = (target.label || target.objectName || 'node').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()
  const property = (target.propertyName || 'id').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase()
  return `${label}_${property}_lookup`.replace(/^_+|_+$/g, '')
}

function defaultGraphExportFormat(engine: string) {
  if (engine === 'neptune') {
    return 'neptune-bulk'
  }
  if (engine === 'arango') {
    return 'jsonl'
  }
  return 'graph-json'
}

function action(
  connection: ConnectionProfile,
  suffix: string,
  label: string,
  title: string,
  icon: GraphOperationIconName,
  objectName: string,
  parameters: Record<string, unknown>,
): GraphOperationAction {
  return {
    label,
    title,
    icon,
    operationId: `${connection.engine}.${suffix}`,
    objectName,
    parameters,
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeKind(kind: string) {
  return kind.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

function dedupeActions(actions: GraphOperationAction[]) {
  const seen = new Set<string>()
  return actions.filter((candidate) => {
    const key = `${candidate.operationId}:${candidate.objectName}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
