import type { ConnectionProfile, GraphConnectionOptions } from '@datapadplusplus/shared-types'

export function connectionModes(engine: ConnectionProfile['engine']) {
  if (engine === 'neo4j') {
    return [
      { value: 'neo4j-bolt', label: 'Neo4j Bolt' },
      { value: 'neo4j-http', label: 'Neo4j HTTP' },
      { value: 'connection-string', label: 'Connection string' },
    ] as const
  }
  if (engine === 'arango') {
    return [
      { value: 'arango-http', label: 'ArangoDB HTTP' },
      { value: 'connection-string', label: 'Connection string' },
    ] as const
  }
  if (engine === 'neptune') {
    return [
      { value: 'neptune-http', label: 'Neptune HTTP' },
      { value: 'neptune-iam', label: 'Neptune IAM' },
    ] as const
  }
  return [
    { value: 'gremlin-websocket', label: 'Gremlin WebSocket' },
    { value: 'gremlin-http', label: 'Gremlin HTTP' },
    { value: 'connection-string', label: 'Connection string' },
  ] as const
}

export function queryLanguages(engine: ConnectionProfile['engine']) {
  if (engine === 'neo4j') {
    return [
      { value: 'cypher', label: 'Cypher' },
      { value: 'opencypher', label: 'openCypher' },
    ] as const
  }
  if (engine === 'arango') return [{ value: 'aql', label: 'AQL' }] as const
  if (engine === 'neptune') {
    return [
      { value: 'gremlin', label: 'Gremlin' },
      { value: 'opencypher', label: 'openCypher' },
      { value: 'sparql', label: 'SPARQL' },
    ] as const
  }
  return [{ value: 'gremlin', label: 'Gremlin' }] as const
}

export function defaultConnectMode(engine: ConnectionProfile['engine']): GraphConnectionOptions['connectMode'] {
  if (engine === 'neo4j') return 'neo4j-bolt'
  if (engine === 'arango') return 'arango-http'
  if (engine === 'neptune') return 'neptune-iam'
  return 'gremlin-websocket'
}

export function defaultAuthMode(engine: ConnectionProfile['engine']): GraphConnectionOptions['authMode'] {
  return engine === 'neptune' ? 'none' : 'basic'
}

export function defaultLanguage(engine: ConnectionProfile['engine']): GraphConnectionOptions['defaultQueryLanguage'] {
  if (engine === 'neo4j') return 'cypher'
  if (engine === 'arango') return 'aql'
  return 'gremlin'
}

export function authenticationModes(
  engine: ConnectionProfile['engine'],
  connectMode: GraphConnectionOptions['connectMode'],
) {
  if (connectMode === 'neptune-iam') {
    return [{ value: 'aws-sigv4', label: 'AWS SigV4' }] as const
  }
  if (connectMode === 'neo4j-bolt' || connectMode === 'gremlin-websocket') {
    return [
      { value: 'none', label: 'None' },
      { value: 'basic', label: 'Basic' },
    ] as const
  }
  return [
    { value: 'none', label: 'None' },
    { value: 'basic', label: 'Basic' },
    { value: 'bearer-token', label: 'Bearer token' },
    ...(engine === 'neptune' ? [{ value: 'aws-sigv4', label: 'AWS SigV4' } as const] : []),
  ] as const
}

export function endpointPlaceholder(
  engine: ConnectionProfile['engine'],
  connectMode: GraphConnectionOptions['connectMode'],
) {
  if (engine === 'neo4j') {
    return connectMode === 'neo4j-bolt' ? 'bolt://localhost:7687' : 'http://localhost:7474'
  }
  if (engine === 'arango') return 'http://localhost:8529'
  if (engine === 'neptune') return 'https://cluster.neptune.amazonaws.com:8182'
  return connectMode === 'gremlin-websocket' ? 'ws://localhost:8182/gremlin' : 'http://localhost:8182'
}

export function databasePlaceholder(engine: ConnectionProfile['engine']) {
  if (engine === 'neo4j') return 'neo4j'
  if (engine === 'arango') return '_system'
  if (engine === 'janusgraph') return 'g'
  return 'graph'
}

export function engineLabel(engine: ConnectionProfile['engine']) {
  if (engine === 'neo4j') return 'Neo4j'
  if (engine === 'arango') return 'ArangoDB'
  if (engine === 'janusgraph') return 'JanusGraph'
  return 'Amazon Neptune'
}
