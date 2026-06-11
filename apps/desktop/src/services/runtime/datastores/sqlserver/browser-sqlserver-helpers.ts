import type { ConnectionProfile } from '@datapadplusplus/shared-types'

export function parseSqlServerObjectScope(scope: string) {
  const value = scope.replace(/^table:/, '')
  const [database = '', schema = '', objectName = ''] = value.split(':')
  return { database, schema, objectName }
}

export function parseSqlServerNodeId(connection: ConnectionProfile, nodeId: string) {
  const connectionDatabase = connection.database?.trim() || ''

  if (nodeId.startsWith('table:') || nodeId.startsWith('view:') || nodeId.startsWith('procedure:') || nodeId.startsWith('function:')) {
    const [, database = connectionDatabase, schema = 'dbo', objectName = ''] = nodeId.split(':')
    return { database, schema, objectName }
  }

  if (nodeId.startsWith('database:')) {
    return { database: nodeId.replace('database:', '') || connectionDatabase, schema: 'dbo', objectName: '' }
  }

  if (nodeId.startsWith('performance:')) {
    const [, database = connectionDatabase] = nodeId.split(':')
    return { database, schema: 'dbo', objectName: '' }
  }

  const parts = nodeId.split(':')
  return {
    database: parts[1] || connectionDatabase,
    schema: parts[2] || 'dbo',
    objectName: parts[3] || '',
  }
}

export function isSqlServerSystemDatabase(database: string) {
  return ['master', 'model', 'msdb', 'tempdb'].includes(database.trim().toLowerCase())
}

export function sqlServerSectionLabel(section: string) {
  switch (section) {
    case 'stored-procedures':
      return 'Stored Procedures'
    case 'query-store':
      return 'Query Store'
    case 'performance':
      return 'Performance'
    case 'extended-events':
      return 'Extended Events'
    case 'security':
      return 'Security'
    case 'storage':
      return 'Storage'
    case 'agent':
      return 'Agent'
    case 'functions':
      return 'Functions'
    case 'views':
      return 'Views'
    default:
      return 'Tables'
  }
}
