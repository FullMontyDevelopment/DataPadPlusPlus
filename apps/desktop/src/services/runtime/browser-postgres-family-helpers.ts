import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export function isPostgresLike(connection: ConnectionProfile) {
  return ['postgresql', 'cockroachdb', 'timescaledb'].includes(connection.engine)
}

export function parsePostgresObjectScope(scope: string) {
  const value = scope.replace(/^table:/, '')
  const [schema = 'public', objectName = ''] = value.includes('.')
    ? value.split('.', 2)
    : ['public', value]

  return { schema, objectName }
}

export function parsePostgresNodeId(connection: ConnectionProfile, nodeId: string) {
  if (nodeId.startsWith('table:')) {
    return parsePostgresObjectScope(nodeId)
  }

  if (nodeId.startsWith('schema:')) {
    return { schema: nodeId.replace('schema:', '') || 'public', objectName: '' }
  }

  const parts = nodeId.split(':')
  if (parts.length >= 3) {
    return { schema: parts[1] || 'public', objectName: parts[2] || '' }
  }

  return { schema: connection.database || 'public', objectName: '' }
}

export function parseCockroachNodeId(connection: ConnectionProfile, nodeId: string) {
  if (nodeId.startsWith('cockroach:')) {
    const [, maybeDatabase = connection.database?.trim() || '', maybeSchema = 'public', maybeObject = ''] = nodeId.split(':')
    if (['cluster', 'security', 'diagnostics'].includes(maybeDatabase)) {
      return { schema: 'public', objectName: maybeSchema || '' }
    }
    return { schema: maybeSchema || 'public', objectName: maybeObject || '' }
  }

  return parsePostgresNodeId(connection, nodeId)
}

export function isPostgresSystemSchema(schema: string) {
  const normalized = schema.trim().toLowerCase()
  return normalized === 'information_schema' || normalized.startsWith('pg_')
}

export function postgresSectionLabel(section: string) {
  switch (section) {
    case 'materialized-views':
      return 'Materialized Views'
    case 'functions':
      return 'Functions'
    case 'procedures':
      return 'Procedures'
    case 'sequences':
      return 'Sequences'
    case 'types':
      return 'Types'
    case 'indexes':
      return 'Indexes'
    case 'views':
      return 'Views'
    default:
      return 'Tables'
  }
}

export function cockroachSectionLabel(section: string) {
  switch (section) {
    case 'zone-configurations':
      return 'Zone Configurations'
    case 'cluster-settings':
      return 'Cluster Settings'
    case 'statements':
      return 'Statement Stats'
    default:
      return postgresSectionLabel(section)
  }
}

export function postgresColumns() {
  return [
    { name: 'id', type: 'bigint', nullable: false, default: "nextval('id_seq')" },
    { name: 'sku', type: 'text', nullable: false, default: '' },
    { name: 'updated_at', type: 'timestamp with time zone', nullable: false, default: 'now()' },
  ]
}
