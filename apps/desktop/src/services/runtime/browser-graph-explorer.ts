import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'

export function createGraphExplorerNodes(connection: ConnectionProfile, scope?: string): ExplorerNode[] {
  const graphName = graphDefaultName(connection)

  if (!scope) {
    return [
      graphNode({ id: 'graph:graphs', label: graphRootLabel(connection), kind: 'graphs', detail: 'Graph databases and named graph scopes', scope: 'graph:graphs', expandable: true }),
      graphNode({ id: 'graph:node-labels', label: 'Node Labels', kind: 'node-labels', detail: 'Node categories and counts', scope: 'graph:node-labels', expandable: true }),
      graphNode({ id: 'graph:relationship-types', label: 'Relationship Types', kind: 'relationship-types', detail: 'Edge types and direction', scope: 'graph:relationship-types', expandable: true }),
      graphNode({ id: 'graph:property-keys', label: 'Property Keys', kind: 'property-keys', detail: 'Graph property metadata', scope: 'graph:property-keys', expandable: true }),
      graphNode({ id: 'graph:indexes', label: 'Indexes', kind: 'indexes', detail: 'Graph schema indexes', scope: 'graph:indexes', expandable: true }),
      graphNode({ id: 'graph:constraints', label: 'Constraints', kind: 'constraints', detail: 'Uniqueness and existence constraints', scope: 'graph:constraints', expandable: true }),
      graphNode({ id: 'graph:procedures', label: graphProceduresLabel(connection), kind: 'procedures', detail: graphProceduresDetail(connection), scope: 'graph:procedures' }),
      graphNode({ id: 'graph:security', label: 'Security', kind: 'security', detail: 'Roles, privileges, IAM, or users', scope: 'graph:security' }),
      graphNode({ id: 'graph:diagnostics', label: 'Diagnostics', kind: 'diagnostics', detail: 'Query, transaction, storage, and schema health', scope: 'graph:diagnostics' }),
    ]
  }

  if (scope === 'graph:graphs') {
    return graphGraphs(connection).map((graph) =>
      graphNode({
        id: `graph:${graph.name}`,
        label: graph.name,
        kind: 'graph',
        detail: `${graph.nodes} nodes | ${graph.relationships} relationships`,
        path: [graphRootLabel(connection)],
        scope: `graph:${graph.name}`,
        expandable: true,
        queryTemplate: graphQueryTemplate(connection, graph.name),
      }),
    )
  }

  if (isGraphDatabaseScope(scope)) {
    return [
      graphNode({ id: `node-labels:${graphName}`, label: 'Node Labels', kind: 'node-labels', detail: 'Labels in this graph', path: [graphRootLabel(connection), graphName], scope: 'graph:node-labels', expandable: true }),
      graphNode({ id: `relationships:${graphName}`, label: 'Relationship Types', kind: 'relationship-types', detail: 'Relationship types in this graph', path: [graphRootLabel(connection), graphName], scope: 'graph:relationship-types', expandable: true }),
      graphNode({ id: `indexes:${graphName}`, label: 'Indexes', kind: 'indexes', detail: 'Schema indexes', path: [graphRootLabel(connection), graphName], scope: 'graph:indexes', expandable: true }),
      graphNode({ id: `constraints:${graphName}`, label: 'Constraints', kind: 'constraints', detail: 'Schema constraints', path: [graphRootLabel(connection), graphName], scope: 'graph:constraints', expandable: true }),
    ]
  }

  if (scope === 'graph:node-labels') {
    return graphNodeLabels(connection).map((label) =>
      graphNode({
        id: `node-label:${label.label}`,
        label: label.label,
        kind: 'node-label',
        detail: `${label.count} nodes | ${label.properties} properties`,
        path: ['Node Labels'],
        scope: `node-label:${label.label}`,
        expandable: true,
        queryTemplate: graphNodeLabelQueryTemplate(connection, label.label),
      }),
    )
  }

  if (scope.startsWith('node-label:')) {
    const label = scope.replace('node-label:', '')
    return [
      graphNode({ id: `properties:${label}`, label: 'Properties', kind: 'property-keys', detail: 'Properties found on this label', path: ['Node Labels', label], scope: `property-keys:${label}`, expandable: true }),
      graphNode({ id: `relationships:${label}`, label: 'Relationships', kind: 'relationship-types', detail: 'Relationship types connected to this label', path: ['Node Labels', label], scope: 'graph:relationship-types', expandable: true }),
    ]
  }

  if (scope === 'graph:relationship-types') {
    return graphRelationships(connection).map((relationship) =>
      graphNode({
        id: `relationship:${relationship.type}`,
        label: relationship.type,
        kind: 'relationship',
        detail: `${relationship.count} relationships | ${relationship.from} -> ${relationship.to}`,
        path: ['Relationship Types'],
        scope: `relationship:${relationship.type}`,
        queryTemplate: graphRelationshipQueryTemplate(connection, relationship.type),
      }),
    )
  }

  if (scope === 'graph:property-keys' || scope.startsWith('property-keys:')) {
    return graphPropertyKeys().map((property) =>
      graphNode({ id: `property-key:${property.name}`, label: property.name, kind: 'property-key', detail: `${property.types} | indexed: ${property.indexed}`, path: ['Property Keys'], scope: `property-key:${property.name}` }),
    )
  }

  if (scope === 'graph:indexes') {
    return graphIndexes().map((index) =>
      graphNode({ id: `index:${index.name}`, label: index.name, kind: 'index', detail: `${index.type} | ${index.state}`, path: ['Indexes'], scope: `index:${index.name}` }),
    )
  }

  if (scope === 'graph:constraints') {
    return graphConstraints().map((constraint) =>
      graphNode({ id: `constraint:${constraint.name}`, label: constraint.name, kind: 'constraint', detail: `${constraint.type} | ${constraint.state}`, path: ['Constraints'], scope: `constraint:${constraint.name}` }),
    )
  }

  return []
}

export function graphInspectQueryTemplate(connection: ConnectionProfile, nodeId: string) {
  if (nodeId.startsWith('node-label:')) {
    return graphNodeLabelQueryTemplate(connection, nodeId.replace('node-label:', ''))
  }
  if (nodeId.startsWith('relationship:')) {
    return graphRelationshipQueryTemplate(connection, nodeId.replace('relationship:', ''))
  }
  return graphQueryTemplate(connection, graphDefaultName(connection))
}

export function graphInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const base = graphBasePayload(connection)

  if (nodeId === 'graph:graphs' || isGraphDatabaseScope(nodeId)) {
    const graphName = isGraphDatabaseScope(nodeId) ? nodeId.replace('graph:', '') : undefined
    return {
      ...base,
      objectView: graphName ? 'graph' : 'graphs',
      graphs: graphGraphs(connection).filter((graph) => !graphName || graph.name === graphName),
      nodeLabels: graphNodeLabels(connection),
      relationshipTypes: graphRelationships(connection),
      indexes: graphIndexes(),
      constraints: graphConstraints(),
      diagnostics: graphDiagnostics(connection),
    }
  }

  if (nodeId === 'graph:node-labels' || nodeId.startsWith('node-label:')) {
    const label = nodeId.startsWith('node-label:') ? nodeId.replace('node-label:', '') : undefined
    return {
      ...base,
      objectView: label ? 'node-label' : 'node-labels',
      nodeLabels: graphNodeLabels(connection).filter((row) => !label || row.label === label),
      propertyKeys: graphPropertyKeys().filter((property) => !label || property.labels.includes(label)),
      relationshipTypes: graphRelationships(connection).filter((relationship) => !label || relationship.from === label || relationship.to === label),
      indexes: graphIndexes().filter((index) => !label || index.target.includes(label)),
      constraints: graphConstraints().filter((constraint) => !label || constraint.target.includes(label)),
      diagnostics: graphDiagnostics(connection),
    }
  }

  if (nodeId === 'graph:relationship-types' || nodeId.startsWith('relationship:')) {
    const type = nodeId.startsWith('relationship:') ? nodeId.replace('relationship:', '') : undefined
    return {
      ...base,
      objectView: type ? 'relationship' : 'relationship-types',
      relationshipTypes: graphRelationships(connection).filter((row) => !type || row.type === type),
      propertyKeys: graphPropertyKeys().filter((property) => !type || property.relationshipTypes.includes(type)),
      diagnostics: graphDiagnostics(connection),
    }
  }

  if (nodeId === 'graph:property-keys' || nodeId.startsWith('property-key:') || nodeId.startsWith('property-keys:')) {
    const property = nodeId.startsWith('property-key:') ? nodeId.replace('property-key:', '') : undefined
    return {
      ...base,
      objectView: property ? 'property-key' : 'property-keys',
      propertyKeys: graphPropertyKeys().filter((row) => !property || row.name === property),
      nodeLabels: graphNodeLabels(connection),
      relationshipTypes: graphRelationships(connection),
      indexes: graphIndexes().filter((index) => !property || index.properties.includes(property)),
    }
  }

  if (nodeId === 'graph:indexes' || nodeId.startsWith('index:')) {
    const index = nodeId.startsWith('index:') ? nodeId.replace('index:', '') : undefined
    return { ...base, objectView: index ? 'index' : 'indexes', indexes: graphIndexes().filter((row) => !index || row.name === index), diagnostics: graphDiagnostics(connection), warnings: ['Graph schema changes should be previewed before execution.'] }
  }

  if (nodeId === 'graph:constraints' || nodeId.startsWith('constraint:')) {
    const constraint = nodeId.startsWith('constraint:') ? nodeId.replace('constraint:', '') : undefined
    return { ...base, objectView: constraint ? 'constraint' : 'constraints', constraints: graphConstraints().filter((row) => !constraint || row.name === constraint), diagnostics: graphDiagnostics(connection), warnings: ['Constraint changes can scan existing graph data and should be previewed before execution.'] }
  }

  if (nodeId === 'graph:procedures') {
    return { ...base, objectView: 'procedures', procedures: graphProcedures(connection), diagnostics: graphDiagnostics(connection) }
  }

  if (nodeId === 'graph:security') {
    return {
      ...base,
      objectView: 'security',
      security: graphSecurity(connection),
      permissionWarnings: [{ scope: 'security', reason: 'Security metadata depends on graph engine permissions.' }],
    }
  }

  return { ...base, objectView: 'diagnostics', procedures: graphProcedures(connection), diagnostics: graphDiagnostics(connection) }
}

function graphNode(node: Omit<ExplorerNode, 'family'>): ExplorerNode {
  return { family: 'graph', ...node }
}

const GRAPH_SECTION_SCOPES = new Set([
  'graph:graphs',
  'graph:node-labels',
  'graph:relationship-types',
  'graph:property-keys',
  'graph:indexes',
  'graph:constraints',
  'graph:procedures',
  'graph:security',
  'graph:diagnostics',
])

function isGraphDatabaseScope(scope: string) {
  return scope.startsWith('graph:') && !GRAPH_SECTION_SCOPES.has(scope)
}

function graphRootLabel(connection: ConnectionProfile) {
  return connection.engine === 'arango' ? 'Graphs' : 'Databases'
}

function graphDefaultName(connection: ConnectionProfile) {
  return connection.database || (connection.engine === 'neo4j' ? 'neo4j' : connection.name)
}

function graphProceduresLabel(connection: ConnectionProfile) {
  if (connection.engine === 'arango') return 'Services'
  if (connection.engine === 'neptune') return 'Loader Jobs'
  return 'Procedures'
}

function graphProceduresDetail(connection: ConnectionProfile) {
  if (connection.engine === 'arango') return 'Foxx services and graph helpers'
  if (connection.engine === 'neptune') return 'Bulk loader jobs and query status'
  return 'Procedures, algorithms, and signatures'
}

function graphQueryTemplate(connection: ConnectionProfile, graphName: string) {
  if (connection.engine === 'arango') return `FOR vertex IN ${graphName}\n  LIMIT 25\n  RETURN vertex`
  if (connection.engine === 'neptune' || connection.engine === 'janusgraph') return 'g.V().limit(25)'
  return 'MATCH (n) RETURN n LIMIT 25'
}

function graphNodeLabelQueryTemplate(connection: ConnectionProfile, label: string) {
  if (connection.engine === 'arango') return `FOR doc IN ${label}\n  LIMIT 25\n  RETURN doc`
  if (connection.engine === 'neptune' || connection.engine === 'janusgraph') return `g.V().hasLabel('${label}').limit(25)`
  return `MATCH (n:\`${label}\`) RETURN n LIMIT 25`
}

function graphRelationshipQueryTemplate(connection: ConnectionProfile, relationship: string) {
  if (connection.engine === 'arango') return `FOR edge IN ${relationship}\n  LIMIT 25\n  RETURN edge`
  if (connection.engine === 'neptune' || connection.engine === 'janusgraph') return `g.E().hasLabel('${relationship}').limit(25)`
  return `MATCH ()-[r:\`${relationship}\`]->() RETURN r LIMIT 25`
}

function graphBasePayload(connection: ConnectionProfile) {
  return {
    engine: connection.engine,
    graphName: graphDefaultName(connection),
    nodeCount: 18420,
    relationshipCount: 39210,
    labelCount: graphNodeLabels(connection).length,
    relationshipTypeCount: graphRelationships(connection).length,
    indexCount: graphIndexes().length,
    constraintCount: graphConstraints().length,
  }
}

function graphGraphs(connection: ConnectionProfile) {
  const database = graphDefaultName(connection)
  return [{ name: database, database, nodes: 18420, relationships: 39210, labels: graphNodeLabels(connection).length, relationshipTypes: graphRelationships(connection).length }]
}

function graphNodeLabels(connection: ConnectionProfile) {
  const productLabel = connection.engine === 'arango' ? 'products' : 'Product'
  return [
    { label: 'Account', count: 2800, properties: 7, indexedProperties: 'id, email', constraints: 'account_id_unique' },
    { label: 'Order', count: 12400, properties: 9, indexedProperties: 'id, createdAt', constraints: 'order_id_unique' },
    { label: productLabel, count: 3220, properties: 6, indexedProperties: 'sku', constraints: 'product_sku_unique' },
  ]
}

function graphRelationships(connection: ConnectionProfile) {
  const productLabel = connection.engine === 'arango' ? 'products' : 'Product'
  return [
    { type: 'PLACED', count: 12400, from: 'Account', to: 'Order', properties: 'createdAt, channel' },
    { type: 'CONTAINS', count: 28650, from: 'Order', to: productLabel, properties: 'quantity, price' },
    { type: 'RELATED_TO', count: 810, from: productLabel, to: productLabel, properties: 'score' },
  ]
}

function graphPropertyKeys() {
  return [
    { name: 'id', types: 'string', labels: ['Account', 'Order'], relationshipTypes: [], indexed: 'yes' },
    { name: 'email', types: 'string', labels: ['Account'], relationshipTypes: [], indexed: 'yes' },
    { name: 'createdAt', types: 'datetime', labels: ['Order'], relationshipTypes: ['PLACED'], indexed: 'yes' },
    { name: 'sku', types: 'string', labels: ['Product', 'products'], relationshipTypes: [], indexed: 'yes' },
    { name: 'score', types: 'float', labels: [], relationshipTypes: ['RELATED_TO'], indexed: 'no' },
  ]
}

function graphIndexes() {
  return [
    { name: 'account_email_lookup', type: 'range', target: 'Account', properties: 'email', state: 'online', provider: 'native-btree' },
    { name: 'order_created_at_lookup', type: 'range', target: 'Order', properties: 'createdAt', state: 'online', provider: 'native-btree' },
    { name: 'product_sku_lookup', type: 'range', target: 'Product', properties: 'sku', state: 'online', provider: 'native-btree' },
  ]
}

function graphConstraints() {
  return [
    { name: 'account_id_unique', type: 'unique', target: 'Account', properties: 'id', state: 'online' },
    { name: 'order_id_unique', type: 'unique', target: 'Order', properties: 'id', state: 'online' },
    { name: 'product_sku_unique', type: 'unique', target: 'Product', properties: 'sku', state: 'online' },
  ]
}

function graphProcedures(connection: ConnectionProfile) {
  if (connection.engine === 'neptune') {
    return [{ name: 'loader.status', mode: 'read', signature: 'GET /loader/{loadId}', description: 'Review bulk loader job status.', requiresAdmin: 'no' }]
  }
  if (connection.engine === 'arango') {
    return [{ name: 'foxx.list', mode: 'read', signature: 'GET /_api/foxx', description: 'List installed Foxx services.', requiresAdmin: 'yes' }]
  }
  return [
    { name: 'db.schema.nodeTypeProperties', mode: 'read', signature: '() :: label, propertyName, propertyTypes', description: 'Inspect node property types.', requiresAdmin: 'no' },
    { name: 'db.indexes', mode: 'read', signature: '() :: name, type, labelsOrTypes, properties', description: 'Inspect schema indexes.', requiresAdmin: 'no' },
  ]
}

function graphSecurity(connection: ConnectionProfile) {
  if (connection.engine === 'neptune') {
    return [{ principal: 'iam-role/datapad-readonly', role: 'IAM', privilege: 'read', scope: 'cluster', effect: 'allow' }]
  }
  return [
    { principal: 'reader', role: 'reader', privilege: 'MATCH', scope: graphDefaultName(connection), effect: 'allow' },
    { principal: 'publisher', role: 'publisher', privilege: 'WRITE', scope: graphDefaultName(connection), effect: 'guarded' },
  ]
}

function graphDiagnostics(connection: ConnectionProfile) {
  return [
    { signal: 'Label Scan Risk', value: 'medium', status: 'watch', guidance: 'Prefer indexed predicates before broad traversals.' },
    { signal: 'Index Coverage', value: `${graphIndexes().length} online`, status: 'healthy', guidance: 'Primary lookup paths are indexed.' },
    { signal: connection.engine === 'neo4j' ? 'Transaction Pool' : 'Query Runtime', value: 'healthy', status: 'healthy', guidance: 'No simulated runtime pressure detected.' },
  ]
}
