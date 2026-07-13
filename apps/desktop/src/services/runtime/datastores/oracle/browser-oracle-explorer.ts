import type { ConnectionProfile, ExplorerNode } from '@datapadplusplus/shared-types'

const ORACLE_OBJECT_CATEGORIES = [
  { kind: 'tables', label: 'Tables', detail: 'Base tables' },
  { kind: 'views', label: 'Views', detail: 'Stored query projections' },
  { kind: 'materialized-views', label: 'Materialized Views', detail: 'Refreshable persisted query results' },
  { kind: 'synonyms', label: 'Synonyms', detail: 'Object aliases' },
  { kind: 'sequences', label: 'Sequences', detail: 'Generated numeric sequences' },
  { kind: 'functions', label: 'Functions', detail: 'Standalone PL/SQL functions' },
  { kind: 'procedures', label: 'Procedures', detail: 'Standalone PL/SQL procedures' },
  { kind: 'packages', label: 'Packages', detail: 'PL/SQL package specifications and bodies' },
  { kind: 'types', label: 'Types', detail: 'Object, collection, and user-defined types' },
  { kind: 'json-collections', label: 'JSON Collections', detail: 'Tables with visible JSON columns' },
  { kind: 'external-tables', label: 'External Tables', detail: 'External file-backed tables' },
  { kind: 'database-links', label: 'Database Links', detail: 'Remote database link definitions' },
] as const

type OracleObjectContext = {
  key: string
  schema: string
  path: string[]
}

export function createOracleExplorerNodes(
  connection: ConnectionProfile,
  scope?: string,
): ExplorerNode[] {
  const schema = connection.auth.username?.trim().toUpperCase() || ''
  const service = oracleServiceName(connection)

  if (!scope) {
    return [
      ...(service
        ? [oracleNode(`oracle-container:${service}`, service, 'database', 'Selected Oracle service/PDB', `oracle:container:${service}`, ['Oracle', 'Databases'], true)]
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
      oracleNode(`oracle-container:${service}`, service, 'database', 'Selected Oracle service/container', `oracle:container:${service}`, ['Oracle', 'Databases'], true),
    ] : []
  }

  if (scope.startsWith('oracle:container:')) {
    const container = scope.replace('oracle:container:', '') || service
    if (!container || !schema) return []
    return oracleSchemaSections(oracleDatabaseContext(container, schema))
  }

  if (scope === 'oracle:schemas') {
    return schema ? [
      oracleNode(`oracle-schema:${schema}`, schema, 'schema', 'Configured Oracle schema', `oracle:schema:${schema}`, ['Oracle', 'Schemas'], true),
    ] : []
  }

  if (scope.startsWith('oracle:schema:')) {
    const scopedSchema = scope.replace('oracle:schema:', '') || schema
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
    return 'select username, account_status, default_tablespace from all_users order by username;'
  }

  return oracleInspectQueryTemplateForKind('object', nodeId)
}

export function oracleInspectPayload(connection: ConnectionProfile, nodeId: string) {
  const service = oracleServiceName(connection)
  const schema = connection.auth.username?.trim().toUpperCase() || ''
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
      warnings: ['Contract preview metadata is shown; configure SQLPlus for live object details.'],
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

function oracleSchemaSections(context: OracleObjectContext): ExplorerNode[] {
  return ORACLE_OBJECT_CATEGORIES.map(({ kind, label, detail }) => ({
    ...oracleNode(
      `oracle-${kind}:${context.key}`,
      label,
      kind,
      detail,
      `oracle:category:${context.key}:${kind}`,
      context.path,
      true,
    ),
    queryTemplate: oracleSchemaQueryTemplate(kind, context.schema),
  }))
}

function oracleDatabaseContext(service: string, schema: string): OracleObjectContext {
  return {
    key: `database:${service}:${schema}`,
    schema,
    path: ['Oracle', 'Databases', service],
  }
}

function oracleSchemaContext(schema: string): OracleObjectContext {
  return {
    key: `schema:${schema}`,
    schema,
    path: ['Oracle', 'Schemas', schema],
  }
}

function oracleCategoryTarget(
  scope: string,
): { context: OracleObjectContext; category: string } | undefined {
  const parts = scope.replace('oracle:category:', '').split(':')
  const [branch, first, second, third] = parts
  if (branch === 'database' && parts.length === 4 && first && second && third) {
    return {
      context: oracleDatabaseContext(first, second),
      category: third,
    }
  }
  if (branch === 'schema' && parts.length === 3 && first && second && !third) {
    return {
      context: oracleSchemaContext(first),
      category: second,
    }
  }
  return undefined
}

function oracleCategoryObjectNodes(context: OracleObjectContext, category: string) {
  const definition = ORACLE_OBJECT_CATEGORIES.find((item) => item.kind === category)
  if (!definition) return []

  const objectKind = oracleCategoryObjectKind(category)
  const path = [...context.path, definition.label]
  const seen = new Set<string>()

  return oracleContractCategoryRows(category, context.schema).flatMap((row) => {
    const objectName = row[1]?.trim()
    if (!objectName || seen.has(objectName)) return []
    seen.add(objectName)

    return [oracleNode(
      `oracle-${objectKind}:${context.key}:${objectName}`,
      objectName,
      objectKind,
      `${oracleObjectDetail(category, row)} | Contract preview; configure SQLPlus for live metadata.`,
      `${objectKind}:${context.schema}.${objectName}`,
      path,
      false,
      oracleObjectQueryTemplate(category, context.schema, objectName),
    )]
  })
}

function oracleCategoryObjectKind(category: string) {
  const kinds: Record<string, string> = {
    tables: 'table',
    views: 'view',
    'materialized-views': 'materialized-view',
    synonyms: 'synonym',
    sequences: 'sequence',
    functions: 'function',
    procedures: 'procedure',
    packages: 'package',
    types: 'type',
    'json-collections': 'json-collection',
    'external-tables': 'external-table',
    'database-links': 'database-link',
  }
  return kinds[category] ?? 'object'
}

function oracleObjectTargetFromNodeId(nodeId: string) {
  const definitions = [
    ['oracle-table:', 'table', 'tables'],
    ['oracle-view:', 'view', 'views'],
    ['oracle-materialized-view:', 'materialized-view', 'materialized-views'],
    ['oracle-synonym:', 'synonym', 'synonyms'],
    ['oracle-sequence:', 'sequence', 'sequences'],
    ['oracle-function:', 'function', 'functions'],
    ['oracle-procedure:', 'procedure', 'procedures'],
    ['oracle-package:', 'package', 'packages'],
    ['oracle-type:', 'type', 'types'],
    ['oracle-json-collection:', 'json-collection', 'json-collections'],
    ['oracle-external-table:', 'external-table', 'external-tables'],
    ['oracle-database-link:', 'database-link', 'database-links'],
  ] as const

  for (const [prefix, kind, category] of definitions) {
    if (!nodeId.startsWith(prefix)) continue
    const parts = nodeId.slice(prefix.length).split(':')
    const schema = parts.at(-2)?.trim()
    const objectName = parts.at(-1)?.trim()
    if (schema && objectName) {
      return { kind, category, schema, objectName }
    }
  }

  return undefined
}

function oracleContractCategoryRows(category: string, schema: string): string[][] {
  switch (category) {
    case 'tables':
      return [
        [schema, 'ACCOUNTS', 'USERS', 'VALID'],
        [schema, 'ORDERS', 'USERS', 'VALID'],
        [schema, 'ORDER_ITEMS', 'USERS', 'VALID'],
        [schema, 'SUPPORT_TICKETS', 'USERS', 'VALID'],
      ]
    case 'views':
      return [[schema, 'ORDER_FULFILLMENT_SUMMARY', '482']]
    case 'materialized-views':
      return [[schema, 'ACCOUNT_BALANCES_MV', 'DEMAND', 'COMPLETE']]
    case 'synonyms':
      return [[schema, 'CUSTOMERS', schema, 'ACCOUNTS']]
    case 'sequences':
      return [
        [schema, 'ACCOUNTS_SEQ', '1', '999999999', '1', '20'],
        [schema, 'ORDERS_SEQ', '1', '999999999', '1', '50'],
      ]
    case 'functions':
      return [[schema, 'ACCOUNT_STATUS', 'FUNCTION', 'VALID']]
    case 'procedures':
      return [[schema, 'REFRESH_ACCOUNT_CACHE', 'PROCEDURE', 'VALID']]
    case 'packages':
      return [
        [schema, 'ACCOUNT_API', 'PACKAGE', 'VALID'],
        [schema, 'ACCOUNT_API', 'PACKAGE BODY', 'VALID'],
        [schema, 'ORDER_API', 'PACKAGE', 'VALID'],
        [schema, 'ORDER_API', 'PACKAGE BODY', 'INVALID'],
      ]
    case 'types':
      return [[schema, 'ACCOUNT_ROW_T', 'TYPE', 'VALID']]
    case 'json-collections':
      return [[schema, 'ACCOUNT_DOCUMENTS', 'DOCUMENT']]
    case 'external-tables':
      return [[schema, 'IMPORT_TRANSACTIONS', 'ORACLE_LOADER']]
    case 'database-links':
      return [[schema, 'REPORTING_DB', 'REPORTING', 'reporting.internal']]
    default:
      return []
  }
}

function oracleObjectDetail(category: string, row: string[]) {
  switch (category) {
    case 'tables': return [row[3], row[2]].filter(Boolean).join(' | ')
    case 'views': return `Definition length ${row[2]}`
    case 'materialized-views': return `${row[2]} refresh | ${row[3]}`
    case 'synonyms': return `Target ${row[2]}.${row[3]}`
    case 'sequences': return `Increment ${row[4]} | Cache ${row[5]}`
    case 'functions':
    case 'procedures':
    case 'packages':
    case 'types': return [row[2], row[3]].filter(Boolean).join(' | ')
    case 'json-collections': return `JSON column ${row[2]}`
    case 'external-tables': return `Access type ${row[2]}`
    case 'database-links': return `User ${row[2]} | Host ${row[3]}`
    default: return 'Oracle object'
  }
}

function oracleObjectQueryTemplate(category: string, schema: string, objectName: string) {
  const owner = oracleSqlLiteral(schema)
  const name = oracleSqlLiteral(objectName)
  switch (category) {
    case 'tables':
    case 'views':
    case 'materialized-views':
    case 'json-collections':
    case 'external-tables':
      return `select * from "${schema.replaceAll('"', '""')}"."${objectName.replaceAll('"', '""')}" where rownum <= 100;`
    case 'synonyms':
      return `select owner, synonym_name, table_owner, table_name, db_link from all_synonyms where owner = '${owner}' and synonym_name = '${name}';`
    case 'sequences':
      return `select sequence_owner, sequence_name, min_value, max_value, increment_by, cache_size, cycle_flag, order_flag from all_sequences where sequence_owner = '${owner}' and sequence_name = '${name}';`
    case 'functions':
    case 'procedures':
    case 'packages':
    case 'types':
      return `select owner, name, type, line, text from all_source where owner = '${owner}' and name = '${name}' order by type, line;`
    case 'database-links':
      return `select owner, db_link, username, host from all_db_links where owner = '${owner}' and db_link = '${name}';`
    default:
      return `select owner, object_name, object_type, status from all_objects where owner = '${owner}' and object_name = '${name}';`
  }
}

function oracleSqlLiteral(value: string) {
  return value.replaceAll("'", "''")
}

function oracleSchemaQueryTemplate(kind: string, schema: string) {
  const owner = schema.replaceAll("'", "''")

  switch (kind) {
    case 'tables':
      return `select owner, table_name, tablespace_name, status from all_tables where owner = '${owner}' order by table_name;`
    case 'views':
      return `select owner, view_name, text_length from all_views where owner = '${owner}' order by view_name;`
    case 'materialized-views':
      return `select owner, mview_name, refresh_mode, refresh_method from all_mviews where owner = '${owner}' order by mview_name;`
    case 'synonyms':
      return `select owner, synonym_name, table_owner, table_name from all_synonyms where owner = '${owner}' order by synonym_name;`
    case 'sequences':
      return `select sequence_owner, sequence_name, min_value, max_value, increment_by, cache_size from all_sequences where sequence_owner = '${owner}' order by sequence_name;`
    case 'functions':
      return oracleObjectsQueryTemplate(owner, ['FUNCTION'])
    case 'procedures':
      return oracleObjectsQueryTemplate(owner, ['PROCEDURE'])
    case 'packages':
      return oracleObjectsQueryTemplate(owner, ['PACKAGE', 'PACKAGE BODY'])
    case 'types':
      return oracleObjectsQueryTemplate(owner, ['TYPE', 'TYPE BODY'])
    case 'json-collections':
      return `select owner, table_name, column_name from all_json_columns where owner = '${owner}' order by table_name, column_name;`
    case 'external-tables':
      return `select owner, table_name, type_name from all_external_tables where owner = '${owner}' order by table_name;`
    case 'database-links':
      return `select owner, db_link, username, host from all_db_links where owner = '${owner}' order by db_link;`
    default:
      return oracleInspectQueryTemplateForKind(kind, schema)
  }
}

function oracleObjectsQueryTemplate(owner: string, objectTypes: string[]) {
  const types = objectTypes.map((objectType) => `'${objectType}'`).join(', ')
  return `select owner, object_name, object_type, status from all_objects where owner = '${owner}' and object_type in (${types}) order by object_name, object_type;`
}

function oracleServiceName(connection: ConnectionProfile) {
  return connection.oracleOptions?.serviceName?.trim() || connection.database?.trim() || ''
}

function oracleNode(
  id: string,
  label: string,
  kind: string,
  detail: string,
  scope?: string,
  path: string[] = ['Oracle'],
  expandable = false,
  queryTemplate?: string,
): ExplorerNode {
  return {
    id,
    family: 'sql',
    label,
    kind,
    detail,
    scope,
    path,
    queryTemplate: queryTemplate ?? oracleInspectQueryTemplateForKind(kind, label),
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
    { owner: schema, name: 'ORDER_ITEMS', status: 'VALID', tablespace: 'USERS', rows: 75000 },
    { owner: schema, name: 'SUPPORT_TICKETS', status: 'VALID', tablespace: 'USERS', rows: 5000 },
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
