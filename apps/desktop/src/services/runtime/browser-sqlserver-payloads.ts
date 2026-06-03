import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { sqlServerSourceInspectPayload } from './browser-relational-source-payloads'
import { parseSqlServerNodeId } from './browser-sqlserver-helpers'

export function sqlServerInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const { database, schema, objectName } = parseSqlServerNodeId(connection, nodeId)
  const base = {
    engine: 'sqlserver',
    database,
    schema,
    objectName,
  }

  if (nodeId.startsWith('table:')) {
    return {
      ...base,
      rowCount: 128,
      size: '160 KB',
      columns: [
        { name: 'id', type: 'bigint', nullable: false, identity: true },
        { name: 'sku', type: 'nvarchar(80)', nullable: false, collation: 'database default' },
        { name: 'updated_at', type: 'datetimeoffset', nullable: false },
      ],
      indexes: [
        { name: `PK_${objectName}`, type: 'CLUSTERED', columns: 'id', unique: true, usage: 'seek 14 / scan 1' },
        { name: `IX_${objectName}_sku`, type: 'NONCLUSTERED', columns: 'sku', unique: false, usage: 'seek 8 / scan 0' },
      ],
      constraints: [
        { name: `PK_${objectName}`, type: 'PRIMARY KEY', columns: 'id', status: 'enabled' },
      ],
      triggers: [
        { name: `TR_${objectName}_audit`, event: 'INSERT, UPDATE', enabled: true, timing: 'AFTER' },
      ],
      statistics: [
        { name: objectName, rows: 128, scans: 6, size: '160 KB' },
      ],
      permissions: [
        { principal: 'reporting', privilege: 'SELECT', object: `${schema}.${objectName}`, state: 'GRANT', grantor: 'dbo' },
      ],
    }
  }

  const sourcePayload = sqlServerSourceInspectPayload(base, nodeId, schema, objectName)
  if (sourcePayload) {
    return sourcePayload
  }

  if (nodeId.startsWith('database:') || nodeId.includes(':tables') || nodeId.includes(':views')) {
    return {
      ...base,
      databaseSize: '32 MB',
      tableCount: 3,
      indexCount: 7,
      tables: [
        { schema: 'dbo', name: 'accounts', type: 'base table', rows: 128, size: '160 KB', owner: 'dbo' },
        { schema: 'dbo', name: 'orders', type: 'base table', rows: 348, size: '240 KB', owner: 'dbo' },
        { schema: 'dbo', name: 'products', type: 'base table', rows: 3, size: '80 KB', owner: 'dbo' },
      ],
      views: [
        { schema: 'dbo', name: 'active_accounts', status: 'valid', definition: 'Visible in sys.sql_modules.' },
      ],
      queryStore: [
        { name: 'Top Queries', status: 'available', durationMs: 18, executions: 14, planState: 'not forced' },
      ],
    }
  }

  if (nodeId.includes('security') || nodeId.includes('users') || nodeId.includes('roles')) {
    return {
      ...base,
      users: [
        { name: 'dbo', type: 'SQL_USER', defaultSchema: 'dbo', authenticationType: 'INSTANCE' },
        { name: 'reporting', type: 'DATABASE_ROLE', defaultSchema: '', authenticationType: '' },
      ],
      roles: [
        { name: 'db_datareader', type: 'DATABASE_ROLE', defaultSchema: '', authenticationType: '' },
      ],
      permissions: [
        { principal: 'reporting', privilege: 'SELECT', object: 'dbo.accounts', state: 'GRANT', grantor: 'dbo' },
      ],
    }
  }

  if (nodeId.includes('query-store')) {
    return {
      ...base,
      queryStore: [
        { name: 'Top Queries', status: 'available', durationMs: 18, executions: 14, planState: 'not forced' },
        { name: 'Regressed Queries', status: 'no regressions', durationMs: 0, executions: 0, planState: '' },
      ],
    }
  }

  if (
    nodeId.includes('performance') ||
    nodeId.includes('sessions') ||
    nodeId.includes('locks') ||
    nodeId.includes('waits') ||
    nodeId.includes('missing-indexes')
  ) {
    return {
      ...base,
      sessions: [
        { sessionId: 52, user: 'app_user', database, state: 'running', wait: 'PAGEIOLATCH_SH', blockedBy: '' },
        { sessionId: 57, user: 'reporting', database, state: 'sleeping', wait: '', blockedBy: '' },
      ],
      locks: [
        { sessionId: 52, object: `${schema}.orders`, mode: 'S', granted: true, blocking: '' },
      ],
      waits: [
        { waitType: 'PAGEIOLATCH_SH', waitingTasks: 4, waitMs: 128, signalWaitMs: 2, resource: 'data file reads' },
        { waitType: 'CXPACKET', waitingTasks: 2, waitMs: 42, signalWaitMs: 4, resource: 'parallel query coordination' },
      ],
      missingIndexes: [
        { table: `${schema}.orders`, equalityColumns: 'status', inequalityColumns: 'updated_at', includedColumns: 'customer_id,total', impact: 'medium' },
      ],
    }
  }

  if (nodeId.includes('storage') || nodeId.includes('files') || nodeId.includes('filegroups')) {
    return {
      ...base,
      files: [
        { name: `${database}`, type: 'ROWS', size: '32 MB', growth: '64 MB', state: 'ONLINE' },
        { name: `${database}_log`, type: 'LOG', size: '16 MB', growth: '64 MB', state: 'ONLINE' },
      ],
      filegroups: [
        { name: 'PRIMARY', type: 'ROWS_FILEGROUP', default: true, readOnly: false },
      ],
    }
  }

  return {
    ...base,
    objects: objectName
      ? [{ schema, name: objectName, type: nodeId.split(':')[0] || 'object', status: 'visible' }]
      : [],
  }
}
