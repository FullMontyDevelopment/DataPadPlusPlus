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

export function oracleSchemaSections(context: OracleObjectContext): ExplorerNode[] {
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

export function oracleDatabaseContext(service: string, schema: string): OracleObjectContext {
  return {
    key: `database:${encodeOracleScopeComponent(service)}:${encodeOracleScopeComponent(schema)}`,
    schema,
    path: ['Oracle', 'Databases', service],
  }
}

export function oracleSchemaContext(schema: string): OracleObjectContext {
  return {
    key: `schema:${encodeOracleScopeComponent(schema)}`,
    schema,
    path: ['Oracle', 'Schemas', schema],
  }
}

export function oracleCategoryTarget(
  scope: string,
): { context: OracleObjectContext; category: string } | undefined {
  const parts = scope.replace('oracle:category:', '').split(':')
  const [branch, first, second, third] = parts
  if (branch === 'database' && parts.length === 4 && first && second && third) {
    const service = decodeOracleScopeComponent(first)
    const schema = decodeOracleScopeComponent(second)
    if (service === undefined || schema === undefined) return undefined
    return {
      context: oracleDatabaseContext(service, schema),
      category: third,
    }
  }
  if (branch === 'schema' && parts.length === 3 && first && second && !third) {
    const schema = decodeOracleScopeComponent(first)
    if (schema === undefined) return undefined
    return {
      context: oracleSchemaContext(schema),
      category: second,
    }
  }
  return undefined
}

export function oracleCategoryObjectNodes(context: OracleObjectContext, category: string) {
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
      `oracle-${objectKind}:${context.key}:${encodeOracleScopeComponent(objectName)}`,
      objectName,
      objectKind,
      `${oracleObjectDetail(category, row)} | Browser preview; live Oracle metadata is available in the desktop app.`,
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

export function oracleObjectTargetFromNodeId(nodeId: string) {
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
    const schema = decodeOracleScopeComponent(parts.at(-2)?.trim() ?? '')
    const objectName = decodeOracleScopeComponent(parts.at(-1)?.trim() ?? '')
    if (schema && objectName) {
      return { kind, category, schema, objectName }
    }
  }

  return undefined
}

export function encodeOracleScopeComponent(value: string) {
  return encodeURIComponent(value).replaceAll('%20', ' ')
}

export function decodeOracleScopeComponent(value: string) {
  try {
    return decodeURIComponent(value.replaceAll(' ', '%20'))
  } catch {
    return undefined
  }
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

export function oracleObjectQueryTemplate(category: string, schema: string, objectName: string) {
  const owner = oracleSqlLiteral(schema)
  const name = oracleSqlLiteral(objectName)
  switch (category) {
    case 'tables':
    case 'views':
    case 'materialized-views':
    case 'json-collections':
    case 'external-tables':
      return `select * from "${schema.replaceAll('"', '""')}"."${objectName.replaceAll('"', '""')}" fetch first 100 rows only;`
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

export function oracleServiceName(connection: ConnectionProfile) {
  return connection.oracleOptions?.serviceName?.trim() || connection.database?.trim() || ''
}

export function oracleNode(
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

export function oracleInspectQueryTemplateForKind(kind: string, label: string) {
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

  return `select owner, object_name, object_type, status from all_objects where object_name = '${oracleSqlLiteral(label)}' fetch first 100 rows only;`
}

export function oracleTableRows(schema: string) {
  return [
    { owner: schema, name: 'ACCOUNTS', status: 'VALID', tablespace: 'USERS', rows: 128 },
    { owner: schema, name: 'ORDERS', status: 'VALID', tablespace: 'USERS', rows: 348 },
    { owner: schema, name: 'ORDER_ITEMS', status: 'VALID', tablespace: 'USERS', rows: 75000 },
    { owner: schema, name: 'SUPPORT_TICKETS', status: 'VALID', tablespace: 'USERS', rows: 5000 },
  ]
}

export function oracleTablePayload(
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
