import type { ConnectionProfile, OperationPlanRequest } from '@datapadplusplus/shared-types'
import { defaultQueryTextForConnection } from '../../app/state/helpers'

type JsonRecord = Record<string, unknown>

export function graphOperationRequest(connection: ConnectionProfile, request: OperationPlanRequest) {
  const parameters = asRecord(request.parameters)
  const objectName = stringValue(request.objectName ?? parameters.objectName) || '<label>'
  const query = stringValue(parameters.query) || defaultGraphQuery(connection, objectName)

  if (request.operationId.endsWith('query.profile')) {
    return graphProfileRequest(connection, query)
  }

  if (request.operationId.endsWith('diagnostics.metrics')) {
    return graphMetricsRequest(connection, parameters)
  }

  if (request.operationId.endsWith('security.inspect')) {
    return graphSecurityRequest(connection, parameters)
  }

  if (request.operationId.endsWith('index.create')) {
    return graphCreateIndexRequest(connection, objectName, parameters)
  }

  if (request.operationId.endsWith('index.drop')) {
    return graphDropIndexRequest(connection, objectName, parameters)
  }

  if (request.operationId.endsWith('data.import-export')) {
    return graphImportExportRequest(connection, objectName, parameters)
  }

  if (request.operationId.endsWith('object.drop')) {
    return graphDropObjectRequest(connection, objectName, parameters)
  }

  return defaultQueryTextForConnection(connection)
}

function graphProfileRequest(connection: ConnectionProfile, query: string) {
  if (connection.engine === 'arango') {
    return jsonRequest({
      method: 'POST',
      path: '/_api/explain',
      body: { query, options: { allPlans: true, profile: true } },
    })
  }

  if (connection.engine === 'neptune') {
    return jsonRequest({
      method: 'POST',
      path: '/gremlin/profile',
      body: { gremlin: query },
    })
  }

  if (connection.engine === 'janusgraph') {
    return `${query}.profile()`
  }

  return `PROFILE ${stripCypherPlanPrefix(query)}`
}

function graphMetricsRequest(connection: ConnectionProfile, parameters: JsonRecord) {
  if (connection.engine === 'arango') {
    return jsonRequest({ method: 'GET', path: '/_admin/statistics', query: { scope: parameters.objectKind ?? 'diagnostics' } })
  }

  if (connection.engine === 'neptune') {
    return jsonRequest({
      operation: 'CloudWatch.GetMetricData',
      namespace: 'AWS/Neptune',
      metrics: ['CPUUtilization', 'GremlinRequestsPerSec', 'SparqlRequestsPerSec', 'BufferCacheHitRatio'],
      cluster: parameters.graphName ?? '<cluster>',
    })
  }

  if (connection.engine === 'janusgraph') {
    return [
      'mgmt = graph.openManagement()',
      'mgmt.getRelationTypes(VertexLabel).collect { it.name() }',
      'mgmt.getGraphIndexes(Vertex).collect { [it.name(), it.getIndexStatus(mgmt.getPropertyKey("id"))] }',
      'mgmt.rollback()',
    ].join('\n')
  }

  return 'CALL dbms.queryJmx("org.neo4j:*") YIELD name, attributes RETURN name, attributes LIMIT 100;'
}

function graphSecurityRequest(connection: ConnectionProfile, parameters: JsonRecord) {
  if (connection.engine === 'arango') {
    return jsonRequest({ method: 'GET', path: '/_api/user', query: { database: parameters.graphName ?? connection.database } })
  }

  if (connection.engine === 'neptune') {
    return jsonRequest({
      operation: 'IAM.SimulatePrincipalPolicy',
      actions: ['neptune-db:ReadDataViaQuery', 'neptune-db:WriteDataViaQuery', 'neptune-db:GetQueryStatus'],
      resource: parameters.graphName ?? '<cluster>',
    })
  }

  if (connection.engine === 'janusgraph') {
    return '# JanusGraph security is usually enforced by Gremlin Server or backend storage credentials.'
  }

  return 'SHOW USERS;\nSHOW ROLES;\nSHOW PRIVILEGES;'
}

function graphCreateIndexRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: JsonRecord,
) {
  const label = stringValue(parameters.label) || objectName || '<Label>'
  const propertyName = stringValue(parameters.propertyName) || 'id'
  const indexName = stringValue(parameters.indexName) || `${label}_${propertyName}_lookup`

  if (connection.engine === 'arango') {
    return jsonRequest({
      method: 'POST',
      path: `/_api/index?collection=${encodeURIComponent(label)}`,
      body: { name: indexName, type: 'persistent', fields: [propertyName] },
    })
  }

  if (connection.engine === 'janusgraph') {
    return [
      'mgmt = graph.openManagement()',
      `key = mgmt.getPropertyKey('${escapeGremlinString(propertyName)}')`,
      `mgmt.buildIndex('${escapeGremlinString(indexName)}', Vertex.class).addKey(key).buildCompositeIndex()`,
      'mgmt.commit()',
    ].join('\n')
  }

  if (connection.engine === 'neptune') {
    return jsonRequest({
      operation: 'Neptune.CreateIndexPreview',
      label,
      propertyName,
      disabledReason: 'Neptune index management depends on engine mode and cluster configuration.',
    })
  }

  return `CREATE INDEX ${quoteCypherIdentifier(indexName)} IF NOT EXISTS FOR (n:${quoteCypherIdentifier(label)}) ON (n.${quoteCypherIdentifier(propertyName)});`
}

function graphDropIndexRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: JsonRecord,
) {
  const indexName = stringValue(parameters.indexName) || objectName

  if (connection.engine === 'arango') {
    return jsonRequest({ method: 'DELETE', path: `/_api/index/${encodeURIComponent(indexName)}` })
  }

  if (connection.engine === 'janusgraph') {
    return [
      'mgmt = graph.openManagement()',
      `index = mgmt.getGraphIndex('${escapeGremlinString(indexName)}')`,
      'mgmt.updateIndex(index, SchemaAction.DISABLE_INDEX).get()',
      'mgmt.commit()',
    ].join('\n')
  }

  return `DROP INDEX ${quoteCypherIdentifier(indexName)} IF EXISTS;`
}

function graphImportExportRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: JsonRecord,
) {
  if (connection.engine === 'neptune') {
    return jsonRequest({
      operation: 'Neptune.StartLoaderJob',
      mode: parameters.mode ?? 'export',
      source: parameters.source ?? '<selected-s3-location>',
      format: parameters.format ?? 'neptune-bulk',
      scope: objectName,
      validation: 'validate-before-write',
    })
  }

  if (connection.engine === 'arango') {
    return jsonRequest({
      method: 'POST',
      path: '/_api/export',
      body: {
        collection: objectName,
        format: parameters.format ?? 'jsonl',
        query: parameters.query,
      },
    })
  }

  return jsonRequest({
    operation: 'graph.export',
    objectName,
    format: parameters.format ?? 'graph-json',
    query: parameters.query,
  })
}

function graphDropObjectRequest(
  connection: ConnectionProfile,
  objectName: string,
  parameters: JsonRecord,
) {
  const objectKind = stringValue(parameters.objectKind)
  const constraintName = stringValue(parameters.constraintName) || objectName

  if (objectKind.includes('constraint') && connection.engine === 'neo4j') {
    return `DROP CONSTRAINT ${quoteCypherIdentifier(constraintName)} IF EXISTS;`
  }

  if (connection.engine === 'arango') {
    return jsonRequest({ method: 'DELETE', path: `/_api/collection/${encodeURIComponent(objectName)}` })
  }

  return `# Review before running.\n# Drop ${objectKind || 'graph object'} ${objectName}`
}

function defaultGraphQuery(connection: ConnectionProfile, objectName: string) {
  if (connection.engine === 'arango') {
    return `FOR doc IN ${objectName}\n  LIMIT 25\n  RETURN doc`
  }

  if (connection.engine === 'neptune' || connection.engine === 'janusgraph') {
    return `g.V().hasLabel('${escapeGremlinString(objectName)}').limit(25)`
  }

  return `MATCH (n:${quoteCypherIdentifier(objectName)}) RETURN n LIMIT 25`
}

function stripCypherPlanPrefix(query: string) {
  return query.replace(/^\s*(profile|explain)\s+/i, '')
}

function quoteCypherIdentifier(value: string) {
  const cleaned = value.replace(/`/g, '``')
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(cleaned) ? cleaned : `\`${cleaned}\``
}

function escapeGremlinString(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function jsonRequest(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
