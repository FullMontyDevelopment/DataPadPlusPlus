import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'

export function createOracleExplorerNodes(
  connection: ConnectionProfile,
  scope?: string,
): ExplorerNode[] {
  const schema = connection.auth.username?.trim().toUpperCase() || ''
  const service = connection.database?.trim() || connection.oracleOptions?.serviceName?.trim() || ''

  if (!scope) {
    return [
      ...(service
        ? [oracleNode(`oracle-container:${service}`, service, 'database', 'Selected Oracle service/PDB', `oracle:container:${service}`, ['Oracle'], true)]
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
      oracleNode(`oracle-container:${service}`, service, 'database', 'Selected Oracle service/container', `oracle:container:${service}`, ['Oracle', 'Containers'], true),
    ] : []
  }

  if (scope.startsWith('oracle:container:')) {
    const container = scope.replace('oracle:container:', '') || service
    if (!container || !schema) return []
    return oracleSchemaSections(schema, ['Oracle', 'Containers', container])
  }

  if (scope === 'oracle:schemas') {
    return schema ? [
      oracleNode(`oracle-schema:${schema}`, schema, 'schema', 'Configured Oracle schema', `oracle:schema:${schema}`, ['Oracle', 'Schemas'], true),
    ] : []
  }

  if (scope.startsWith('oracle:schema:')) {
    const scopedSchema = scope.replace('oracle:schema:', '') || schema
    return scopedSchema ? oracleSchemaSections(scopedSchema, ['Oracle', 'Schemas', scopedSchema]) : []
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
  if (nodeId.startsWith('oracle-table:')) {
    const [, schema = 'APP', table = 'TABLE_NAME'] = nodeId.split(':')
    return `select * from "${schema}"."${table}" where rownum <= 100;`
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
    return 'select username, account_status, default_tablespace from all_users order by username;'
  }

  return oracleInspectQueryTemplateForKind('object', nodeId)
}

export function oracleInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const service = connection.database?.trim() || connection.oracleOptions?.serviceName?.trim() || ''
  const schema = connection.auth.username?.trim().toUpperCase() || ''
  const base = {
    engine: 'oracle',
    nodeId,
    service,
  }

  if (nodeId.startsWith('oracle-container:') || nodeId === 'oracle-schemas' || nodeId.startsWith('oracle-schema:')) {
    return {
      ...base,
      schema,
      openMode: 'READ WRITE',
      objectCounts: [
        { type: 'TABLE', count: 3, status: 'Visible' },
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
        { owner: schema, name: 'ACTIVE_ACCOUNTS', textLength: 482, status: 'VALID' },
      ],
    }
  }

  if (nodeId.startsWith('oracle-mviews:')) {
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

  if (nodeId.startsWith('oracle-table:')) {
    const [, owner = schema, table = 'ACCOUNTS'] = nodeId.split(':')
    return oracleTablePayload(base, owner, table)
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

function oracleSchemaSections(schema: string, path: string[]): ExplorerNode[] {
  return [
    oracleNode(`oracle-tables:${schema}`, 'Tables', 'tables', 'Base tables', undefined, path),
    oracleNode(`oracle-views:${schema}`, 'Views', 'views', 'Stored query projections', undefined, path),
    oracleNode(`oracle-mviews:${schema}`, 'Materialized Views', 'materialized-views', 'Refreshable persisted query results', undefined, path),
    oracleNode(`oracle-synonyms:${schema}`, 'Synonyms', 'synonyms', 'Object aliases', undefined, path),
    oracleNode(`oracle-sequences:${schema}`, 'Sequences', 'sequences', 'Generated numeric sequences', undefined, path),
    oracleNode(`oracle-functions:${schema}`, 'Functions', 'functions', 'PL/SQL functions', undefined, path),
    oracleNode(`oracle-procedures:${schema}`, 'Procedures', 'procedures', 'PL/SQL procedures', undefined, path),
    oracleNode(`oracle-packages:${schema}`, 'Packages', 'packages', 'PL/SQL package specs and bodies', undefined, path),
    oracleNode(`oracle-types:${schema}`, 'Types', 'types', 'Object and collection types', undefined, path),
    oracleNode(`oracle-json:${schema}`, 'JSON Collections', 'json-collections', 'Oracle JSON collection-style objects', undefined, path),
    oracleNode(`oracle-external:${schema}`, 'External Tables', 'external-tables', 'External file-backed tables', undefined, path),
    oracleNode(`oracle-dblinks:${schema}`, 'Database Links', 'database-links', 'Remote database links', undefined, path),
  ]
}

function oracleNode(
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  path: string[] = ['Oracle'],
  expandable = false,
): ExplorerNode {
  return {
    id,
    family: 'sql',
    label,
    kind,
    detail,
    scope,
    path,
    queryTemplate: oracleInspectQueryTemplateForKind(kind, label),
    expandable,
  }
}

function oracleInspectQueryTemplateForKind(kind: string, label: string) {
  if (kind === 'tables') {
    return "select owner, table_name, status from all_tables where rownum <= 100 order by owner, table_name;"
  }
  if (kind === 'packages') {
    return "select owner, object_name, object_type, status from all_objects where object_type in ('PACKAGE', 'PACKAGE BODY') order by owner, object_name;"
  }
  if (kind === 'security' || kind === 'users' || kind === 'roles') {
    return 'select * from session_privs;'
  }
  if (kind === 'performance' || kind === 'sessions') {
    return 'select * from v$session where rownum <= 100;'
  }
  if (kind === 'storage' || kind === 'tablespaces') {
    return 'select tablespace_name, status from user_tablespaces order by tablespace_name;'
  }
  if (kind === 'execution-plan') {
    return 'select * from table(dbms_xplan.display);'
  }

  return `select owner, object_name, object_type, status from all_objects where object_name = '${label}' or rownum <= 100;`
}

function oracleTableRows(schema: string) {
  return [
    { owner: schema, name: 'ACCOUNTS', status: 'VALID', tablespace: 'USERS', rows: 128 },
    { owner: schema, name: 'ORDERS', status: 'VALID', tablespace: 'USERS', rows: 348 },
    { owner: schema, name: 'AUDIT_EVENTS', status: 'VALID', tablespace: 'USERS', rows: 2000 },
  ]
}

function oracleTablePayload(
  base: { engine: string; nodeId: string; service: string },
  schema: string,
  table: string,
) {
  return {
    ...base,
    kind: 'table',
    schema,
    objectName: table,
    rowCount: 128,
    blocks: 24,
    avgRowLength: 128,
    lastAnalyzed: '2026-05-10',
    columns: [
      { name: 'ID', type: 'NUMBER(19)', nullable: 'NO', default: '' },
      { name: 'ACCOUNT_NAME', type: 'VARCHAR2(200)', nullable: 'NO', default: '' },
      { name: 'STATUS', type: 'VARCHAR2(40)', nullable: 'YES', default: "'ACTIVE'" },
      { name: 'CREATED_AT', type: 'TIMESTAMP WITH TIME ZONE', nullable: 'NO', default: 'SYSTIMESTAMP' },
    ],
    indexes: [
      { name: `${table}_PK`, uniqueness: 'UNIQUE', status: 'VALID', visibility: 'VISIBLE' },
      { name: `${table}_STATUS_IX`, uniqueness: 'NONUNIQUE', status: 'VALID', visibility: 'VISIBLE' },
    ],
    constraints: [
      { name: `${table}_PK`, type: 'PRIMARY KEY', status: 'ENABLED', columns: 'ID' },
      { name: `${table}_STATUS_CK`, type: 'CHECK', status: 'ENABLED', columns: 'STATUS' },
    ],
    triggers: [
      { name: `${table}_BI`, timing: 'BEFORE EACH ROW', event: 'INSERT', status: 'ENABLED' },
    ],
    grants: [
      { grantee: 'REPORTING', privilege: 'SELECT', objectName: table, grantable: 'NO' },
    ],
  }
}
