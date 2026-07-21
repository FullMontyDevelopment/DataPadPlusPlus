import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'
import {
  oracleCategoryObjectNodes,
  oracleCategoryTarget,
  decodeOracleScopeComponent,
  encodeOracleScopeComponent,
  oracleDatabaseContext,
  oracleInspectQueryTemplateForKind,
  oracleNode,
  oracleObjectQueryTemplate,
  oracleObjectTargetFromNodeId,
  oracleSchemaContext,
  oracleSchemaSections,
  oracleServiceName,
  oracleTablePayload,
  oracleTableRows,
} from './browser-oracle-explorer-helpers'

export function createOracleExplorerNodes(
  connection: ConnectionProfile,
  scope?: string,
): ExplorerNode[] {
  const schema = connection.auth.username?.trim() || ''
  const service = oracleServiceName(connection)
  const encodedService = encodeOracleScopeComponent(service)
  const encodedSchema = encodeOracleScopeComponent(schema)

  if (!scope) {
    return [
      ...(service
        ? [oracleNode(`oracle-container:${encodedService}`, service, 'database', 'Preview-only configured Oracle service/PDB', `oracle:container:${encodedService}`, ['Oracle', 'Databases'], true)]
        : []),
      oracleNode('oracle-schemas', 'Schemas', 'schemas', 'Users and object schemas', 'oracle:schemas', ['Oracle'], true),
      oracleNode('oracle-security', 'Security', 'security', 'Users, roles, profiles, privileges, and grants', 'oracle:security', ['Oracle'], true),
      oracleNode('oracle-storage', 'Storage', 'storage', 'Tablespaces, data files, segments, and quotas', 'oracle:storage', ['Oracle'], true),
      oracleNode('oracle-performance', 'Performance', 'performance', 'Sessions, waits, SQL Monitor, and lock diagnostics', 'oracle:performance', ['Oracle'], true),
      oracleNode('oracle-diagnostics', 'Diagnostics', 'diagnostics', 'Plans, locks, waits, and database health', 'oracle:diagnostics', ['Oracle'], true),
    ]
  }

  if (scope === 'oracle:containers') {
    return service ? [
      oracleNode(`oracle-container:${encodedService}`, service, 'database', 'Preview-only configured Oracle service/container', `oracle:container:${encodedService}`, ['Oracle', 'Databases'], true),
    ] : []
  }

  if (scope.startsWith('oracle:container:')) {
    const container = decodeOracleScopeComponent(scope.replace('oracle:container:', '')) || service
    if (!container || !schema) return []
    return oracleSchemaSections(oracleDatabaseContext(container, schema))
  }

  if (scope === 'oracle:schemas') {
    return schema ? [
      oracleNode(`oracle-schema:${encodedSchema}`, schema, 'schema', 'Preview-only configured Oracle schema', `oracle:schema:${encodedSchema}`, ['Oracle', 'Schemas'], true),
    ] : []
  }

  if (scope.startsWith('oracle:schema:')) {
    const scopedSchema = decodeOracleScopeComponent(scope.replace('oracle:schema:', '')) || schema
    return scopedSchema ? oracleSchemaSections(oracleSchemaContext(scopedSchema)) : []
  }

  if (scope.startsWith('oracle:category:')) {
    const target = oracleCategoryTarget(scope)
    return target ? oracleCategoryObjectNodes(target.context, target.category) : []
  }

  if (scope === 'oracle:security') {
    return [
      oracleNode('oracle-users', 'Users', 'users', 'Database users', undefined, ['Oracle', 'Security']),
      oracleNode('oracle-roles', 'Roles', 'roles', 'Database roles', undefined, ['Oracle', 'Security']),
      oracleNode('oracle-profiles', 'Profiles', 'profiles', 'Password and resource profiles', undefined, ['Oracle', 'Security']),
      oracleNode('oracle-privileges', 'Privileges', 'privileges', 'System and object privileges', undefined, ['Oracle', 'Security']),
    ]
  }

  if (scope === 'oracle:storage') {
    return [
      oracleNode('oracle-tablespaces', 'Tablespaces', 'tablespaces', 'Tablespace status and allocation', undefined, ['Oracle', 'Storage']),
      oracleNode('oracle-data-files', 'Data Files', 'data-files', 'Data files where granted', undefined, ['Oracle', 'Storage']),
      oracleNode('oracle-segments', 'Segments', 'segments', 'Segment sizes and owners', undefined, ['Oracle', 'Storage']),
      oracleNode('oracle-quotas', 'Quotas', 'quotas', 'Tablespace quotas', undefined, ['Oracle', 'Storage']),
    ]
  }

  if (scope === 'oracle:performance' || scope === 'oracle:diagnostics') {
    return [
      oracleNode('oracle-sessions', 'Sessions', 'sessions', 'Active sessions', undefined, ['Oracle', 'Performance']),
      oracleNode('oracle-locks', 'Locks', 'locks', 'Lock and blocking metadata', undefined, ['Oracle', 'Performance']),
      oracleNode('oracle-top-sql', 'Top SQL', 'sql-monitor', 'High activity SQL', undefined, ['Oracle', 'Performance']),
      oracleNode('oracle-explain-plan', 'Execution Plan', 'execution-plan', 'DBMS_XPLAN output', undefined, ['Oracle', 'Diagnostics']),
      oracleNode('oracle-invalid-objects', 'Invalid Objects', 'invalid-objects', 'Invalid compilation status', undefined, ['Oracle', 'Diagnostics']),
    ]
  }

  if (scope === 'oracle:scheduler') {
    return [
      oracleNode('oracle-scheduler-jobs', 'Jobs', 'jobs', 'Scheduler jobs', undefined, ['Oracle', 'Scheduler']),
      oracleNode('oracle-scheduler-programs', 'Programs', 'programs', 'Scheduler programs', undefined, ['Oracle', 'Scheduler']),
      oracleNode('oracle-scheduler-chains', 'Chains', 'chains', 'Scheduler chains', undefined, ['Oracle', 'Scheduler']),
      oracleNode('oracle-scheduler-windows', 'Windows', 'windows', 'Scheduler windows', undefined, ['Oracle', 'Scheduler']),
    ]
  }

  return []
}

export function oracleInspectQueryTemplate(nodeId: string) {
  const objectTarget = oracleObjectTargetFromNodeId(nodeId)
  if (objectTarget) {
    return oracleObjectQueryTemplate(
      objectTarget.category,
      objectTarget.schema,
      objectTarget.objectName,
    )
  }

  if (nodeId === 'oracle-performance' || nodeId === 'oracle-sessions') {
    return 'select * from v$session where rownum <= 100;'
  }

  if (nodeId === 'oracle-explain-plan') {
    return 'select * from table(dbms_xplan.display);'
  }

  if (nodeId === 'oracle-storage' || nodeId === 'oracle-tablespaces') {
    return 'select tablespace_name, status from user_tablespaces order by tablespace_name;'
  }

  if (nodeId === 'oracle-security' || nodeId === 'oracle-users') {
    return "select owner, count(*) object_count from all_objects group by owner order by case when owner = sys_context('USERENV', 'CURRENT_SCHEMA') then 0 else 1 end, owner;"
  }

  return oracleInspectQueryTemplateForKind('object', nodeId)
}

export function oracleInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const service = oracleServiceName(connection)
  const schema = connection.auth.username?.trim() || ''
  const base = {
    engine: 'oracle',
    nodeId,
    service,
  }

  const objectTarget = oracleObjectTargetFromNodeId(nodeId)
  if (objectTarget) {
    if (objectTarget.kind === 'table') {
      return oracleTablePayload(base, objectTarget.schema, objectTarget.objectName)
    }

    return {
      ...base,
      kind: objectTarget.kind,
      schema: objectTarget.schema,
      objectName: objectTarget.objectName,
      objects: [{
        owner: objectTarget.schema,
        name: objectTarget.objectName,
        type: objectTarget.kind.replaceAll('-', ' ').toUpperCase(),
        status: 'VALID',
      }],
      warnings: ['Browser preview metadata is synthetic; the desktop built-in Oracle runtime loads live object details.'],
    }
  }

  if (nodeId.startsWith('oracle-container:') || nodeId === 'oracle-schemas' || nodeId.startsWith('oracle-schema:')) {
    return {
      ...base,
      schema,
      openMode: 'READ WRITE',
      objectCounts: [
        { type: 'TABLE', count: 4, status: 'Visible' },
        { type: 'VIEW', count: 1, status: 'Visible' },
        { type: 'PACKAGE', count: 2, status: 'Visible' },
        { type: 'SEQUENCE', count: 2, status: 'Visible' },
      ],
      invalidObjects: [
        { owner: schema, name: 'ORDER_API', type: 'PACKAGE BODY', status: 'INVALID' },
      ],
      grants: [
        { grantee: schema, privilege: 'CREATE SESSION', objectName: '', grantable: 'NO' },
      ],
    }
  }

  if (nodeId.startsWith('oracle-tables:')) {
    return { ...base, schema, tables: oracleTableRows(schema) }
  }

  if (nodeId.startsWith('oracle-views:')) {
    return {
      ...base,
      schema,
      views: [
        { owner: schema, name: 'ORDER_FULFILLMENT_SUMMARY', textLength: 482, status: 'VALID' },
      ],
    }
  }

  if (nodeId.startsWith('oracle-materialized-views:') || nodeId.startsWith('oracle-mviews:')) {
    return {
      ...base,
      schema,
      materializedViews: [
        { owner: schema, name: 'ACCOUNT_BALANCES_MV', refreshMode: 'DEMAND', status: 'VALID' },
      ],
    }
  }

  if (nodeId.startsWith('oracle-sequences:')) {
    return {
      ...base,
      schema,
      sequences: [
        { owner: schema, name: 'ACCOUNTS_SEQ', increment: 1, cache: 20 },
        { owner: schema, name: 'ORDERS_SEQ', increment: 1, cache: 50 },
      ],
    }
  }

  if (nodeId.startsWith('oracle-synonyms:')) {
    return {
      ...base,
      schema,
      synonyms: [
        { owner: schema, name: 'CUSTOMERS', targetOwner: schema, targetObject: 'ACCOUNTS' },
      ],
    }
  }

  if (nodeId.startsWith('oracle-packages:')) {
    return {
      ...base,
      schema,
      packages: [
        { owner: schema, name: 'ACCOUNT_API', type: 'PACKAGE', status: 'VALID', lastDdlTime: '2026-05-01' },
        { owner: schema, name: 'ORDER_API', type: 'PACKAGE BODY', status: 'INVALID', lastDdlTime: '2026-05-06' },
      ],
    }
  }

  if (nodeId.startsWith('oracle-procedures:')) {
    return {
      ...base,
      schema,
      procedures: [
        { owner: schema, name: 'REFRESH_ACCOUNT_CACHE', status: 'VALID', lastDdlTime: '2026-05-02' },
      ],
    }
  }

  if (nodeId.startsWith('oracle-functions:')) {
    return {
      ...base,
      schema,
      functions: [
        { owner: schema, name: 'ACCOUNT_STATUS', status: 'VALID', lastDdlTime: '2026-05-02' },
      ],
    }
  }

  if (nodeId.startsWith('oracle-types:')) {
    return {
      ...base,
      schema,
      types: [
        { owner: schema, name: 'ACCOUNT_ROW_T', type: 'OBJECT', status: 'VALID' },
      ],
    }
  }

  if (nodeId.startsWith('oracle-json-collections:') || nodeId.startsWith('oracle-json:')) {
    return {
      ...base,
      schema,
      jsonCollections: [
        { owner: schema, name: 'ACCOUNT_DOCUMENTS', column: 'DOCUMENT', status: 'VALID' },
      ],
    }
  }

  if (nodeId.startsWith('oracle-external-tables:') || nodeId.startsWith('oracle-external:')) {
    return {
      ...base,
      schema,
      externalTables: [
        { owner: schema, name: 'IMPORT_TRANSACTIONS', type: 'ORACLE_LOADER', status: 'VALID' },
      ],
    }
  }

  if (nodeId.startsWith('oracle-database-links:') || nodeId.startsWith('oracle-dblinks:')) {
    return {
      ...base,
      schema,
      databaseLinks: [
        { owner: schema, name: 'REPORTING_DB', username: 'REPORTING', host: 'reporting.internal' },
      ],
    }
  }

  if (nodeId === 'oracle-security' || nodeId === 'oracle-users') {
    return {
      ...base,
      users: [
        { username: schema, accountStatus: 'OPEN', defaultTablespace: 'USERS', profile: 'DEFAULT' },
      ],
      warnings: ['DBA_USERS may require elevated privileges; showing visible user metadata.'],
    }
  }

  if (nodeId === 'oracle-roles') {
    return {
      ...base,
      roles: [
        { role: 'CONNECT', source: 'SESSION_ROLES', defaultRole: 'YES', adminOption: 'NO' },
        { role: 'RESOURCE', source: 'SESSION_ROLES', defaultRole: 'YES', adminOption: 'NO' },
      ],
    }
  }

  if (nodeId === 'oracle-profiles') {
    return {
      ...base,
      profiles: [
        { profile: 'DEFAULT', resourceName: 'FAILED_LOGIN_ATTEMPTS', limit: '10', resourceType: 'PASSWORD' },
      ],
      warnings: ['Profile details may be partial without DBA_PROFILES access.'],
    }
  }

  if (nodeId === 'oracle-privileges') {
    return {
      ...base,
      grants: [
        { grantee: schema, privilege: 'CREATE SESSION', objectName: '', grantable: 'NO' },
        { grantee: schema, privilege: 'SELECT', objectName: 'ACCOUNTS', grantable: 'NO' },
      ],
    }
  }

  if (nodeId === 'oracle-storage' || nodeId === 'oracle-tablespaces') {
    return {
      ...base,
      allocatedBytes: 536870912,
      usedBytes: 167772160,
      freeBytes: 369098752,
      tablespaces: [
        { name: 'USERS', status: 'ONLINE', contents: 'PERMANENT', extentManagement: 'LOCAL' },
        { name: 'TEMP', status: 'ONLINE', contents: 'TEMPORARY', extentManagement: 'LOCAL' },
      ],
    }
  }

  if (nodeId === 'oracle-data-files') {
    return {
      ...base,
      dataFiles: [
        { tablespaceName: 'USERS', fileName: 'users01.dbf', bytes: 536870912, status: 'AVAILABLE' },
      ],
      warnings: ['Data file details require DBA_DATA_FILES access on live Oracle connections.'],
    }
  }

  if (nodeId === 'oracle-segments') {
    return {
      ...base,
      segments: [
        { owner: schema, name: 'ACCOUNTS', type: 'TABLE', bytes: 8388608 },
        { owner: schema, name: 'ACCOUNTS_PK', type: 'INDEX', bytes: 1048576 },
      ],
    }
  }

  if (nodeId === 'oracle-quotas') {
    return {
      ...base,
      quotas: [
        { tablespaceName: 'USERS', bytes: 167772160, maxBytes: 1073741824, blocks: 20480 },
      ],
    }
  }

  if (nodeId === 'oracle-performance' || nodeId === 'oracle-sessions') {
    return {
      ...base,
      activeSessions: 3,
      blockedSessions: 0,
      sessions: [
        { sid: 42, username: schema, status: 'ACTIVE', waitClass: 'CPU' },
        { sid: 84, username: 'SYS', status: 'INACTIVE', waitClass: 'Idle' },
      ],
      warnings: ['Session diagnostics may be partial without V$SESSION privileges.'],
    }
  }

  if (nodeId === 'oracle-locks') {
    return {
      ...base,
      blockedSessions: 0,
      locks: [
        { sid: 42, type: 'TX', modeHeld: 'ROW-X', request: 'NONE', blocking: 'NO' },
      ],
    }
  }

  if (nodeId === 'oracle-top-sql' || nodeId === 'oracle-sql-monitor') {
    return {
      ...base,
      topSql: [
        { sqlId: '9xv6b7p1', status: 'DONE', elapsedMs: 18, sqlText: 'select * from APP.ACCOUNTS where rownum <= 100' },
      ],
    }
  }

  if (nodeId === 'oracle-explain-plan') {
    return {
      ...base,
      elapsedMs: 12,
      planLines: [
        { id: 0, operation: 'SELECT STATEMENT', objectName: '', rows: 100, cost: 4 },
        { id: 1, operation: 'TABLE ACCESS FULL', objectName: 'ACCOUNTS', rows: 100, cost: 4 },
      ],
    }
  }

  if (nodeId === 'oracle-invalid-objects' || nodeId === 'oracle-diagnostics') {
    return {
      ...base,
      invalidObjects: [
        { owner: schema, name: 'ORDER_API', type: 'PACKAGE BODY', status: 'INVALID' },
      ],
      warnings: ['Diagnostics are limited to dictionary metadata available to this user.'],
    }
  }

  return {
    ...base,
    schema,
    objects: [
      { owner: schema, name: 'ACCOUNTS', type: 'TABLE', status: 'VALID' },
      { owner: schema, name: 'ACCOUNT_API', type: 'PACKAGE', status: 'VALID' },
    ],
  }
}
