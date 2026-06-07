import type {
  CompletionItemKind,
  CompletionObject,
  CompletionSuggestion,
} from './types'

const RESERVED_MYSQL_IDENTIFIERS = new Set([
  'add',
  'alter',
  'analyze',
  'and',
  'as',
  'between',
  'by',
  'call',
  'case',
  'check',
  'create',
  'delete',
  'desc',
  'distinct',
  'explain',
  'from',
  'group',
  'index',
  'insert',
  'into',
  'join',
  'key',
  'limit',
  'lock',
  'not',
  'null',
  'on',
  'optimize',
  'or',
  'order',
  'procedure',
  'repair',
  'select',
  'table',
  'update',
  'user',
  'where',
  'with',
])

export function quoteMySqlIdentifier(identifier: string) {
  const trimmed = identifier.trim()
  const normalized = trimmed.toLowerCase()

  if (
    /^[A-Za-z_][A-Za-z0-9_$]*$/.test(trimmed) &&
    !RESERVED_MYSQL_IDENTIFIERS.has(normalized)
  ) {
    return trimmed
  }

  return `\`${trimmed.replaceAll('`', '``')}\``
}

export function mysqlRoutineSuggestions(
  routines: CompletionObject[],
  dialectLabel: string,
): CompletionSuggestion[] {
  return routines.flatMap((routine) => {
    const routineKind = normalizedRoutineKind(routine)
    const args = routineArguments(routine)
    const callArguments = args ? `/* ${args} */` : ''
    const qualifiedName = qualifiedMySqlObject(routine)
    const label = objectLabel(routine)
    const callText =
      routineKind === 'procedure'
        ? `call ${qualifiedName}(${callArguments});`
        : `select ${qualifiedName}(${callArguments});`

    return [
      suggestion(
        `call ${label}`,
        callText,
        'function',
        routine.detail ?? `${dialectLabel} ${routineKind}`,
        undefined,
        '05-mysql-routine-call',
      ),
      suggestion(
        `define ${label}`,
        routineDefinitionQuery(routine, routineKind),
        'snippet',
        `Inspect ${dialectLabel} ${routineKind} definition`,
        undefined,
        '06-mysql-routine-def',
      ),
    ]
  })
}

export function mysqlSnippets(
  defaultObject: string,
  routine: CompletionObject | undefined,
  dialectLabel: string,
  isMariaDb: boolean,
): CompletionSuggestion[] {
  const routineName = routine ? qualifiedMySqlObject(routine) : 'database_name.routine_name'
  const routineArgs = routine ? routineArguments(routine) : ''
  const routineCallArgs = routineArgs ? `/* ${routineArgs} */` : ''

  return [
    suggestion(
      'bounded select',
      `select *\nfrom ${defaultObject}\nlimit 100;`,
      'snippet',
      'Read a bounded sample from the current table or view',
      undefined,
      '40-mysql-snippet',
    ),
    suggestion(
      'explain format json',
      `explain format=json\nselect *\nfrom ${defaultObject}\nlimit 100;`,
      'snippet',
      `Render a ${dialectLabel} JSON execution plan for a read statement`,
      undefined,
      '40-mysql-snippet',
    ),
    ...(isMariaDb ? mariaDbSnippets(defaultObject) : mysqlOptimizerTraceSnippet(defaultObject)),
    suggestion(
      'processlist waits',
      `select p.id, p.user, p.host, p.db, p.command, p.time, p.state, p.info,\n       t.processlist_state,\n       t.processlist_time\nfrom information_schema.processlist p\nleft join performance_schema.threads t on t.processlist_id = p.id\norder by p.time desc\nlimit 100;`,
      'snippet',
      'Inspect active sessions and wait context',
      undefined,
      '40-mysql-snippet',
    ),
    suggestion(
      'statement digest profile',
      `select schema_name, digest_text, count_star, sum_timer_wait, sum_rows_examined, sum_rows_sent\nfrom performance_schema.events_statements_summary_by_digest\nwhere schema_name is not null\norder by sum_timer_wait desc\nlimit 50;`,
      'snippet',
      'Review top statement digests from performance_schema',
      undefined,
      '40-mysql-snippet',
    ),
    suggestion(
      'metadata locks',
      `select object_schema, object_name, lock_type, lock_duration, lock_status, owner_thread_id\nfrom performance_schema.metadata_locks\norder by object_schema, object_name, lock_status\nlimit 100;`,
      'snippet',
      `Inspect ${dialectLabel} metadata lock posture`,
      undefined,
      '40-mysql-snippet',
    ),
    suggestion(
      'routine inventory',
      `select routine_schema, routine_name, routine_type, data_type, security_type, definer\nfrom information_schema.routines\nwhere routine_schema not in ('mysql', 'information_schema', 'performance_schema', 'sys')\norder by routine_schema, routine_name\nlimit 200;`,
      'snippet',
      `List ${dialectLabel} functions and procedures with execution metadata`,
      undefined,
      '40-mysql-snippet',
    ),
    suggestion(
      'routine call',
      `select ${routineName}(${routineCallArgs});`,
      'snippet',
      `Call the first known ${dialectLabel} routine from metadata`,
      undefined,
      '40-mysql-snippet',
    ),
  ]
}

export function qualifiedMySqlObject(object: CompletionObject) {
  const objectName = quoteMySqlIdentifier(object.name)

  if (!object.schema) {
    return objectName
  }

  return `${quoteMySqlIdentifier(object.schema)}.${objectName}`
}

export function objectLabel(object: CompletionObject) {
  return object.schema ? `${object.schema}.${object.name}` : object.name
}

function mariaDbSnippets(defaultObject: string) {
  return [
    suggestion(
      'analyze format json',
      `analyze format=json\nselect *\nfrom ${defaultObject}\nlimit 100;`,
      'snippet',
      'Run a MariaDB ANALYZE FORMAT=JSON profile for a bounded statement',
      undefined,
      '40-mysql-snippet',
    ),
    suggestion(
      'mariadb status variables',
      "show global status like 'Threads_%';\nshow global status like 'Aria_%';\nshow variables like 'version%';\nshow engines;",
      'snippet',
      'Inspect MariaDB status counters, version variables, and storage engines',
      undefined,
      '40-mysql-snippet',
    ),
    suggestion(
      'mariadb roles',
      "select user as role_name, host\nfrom mysql.user\nwhere is_role = 'Y'\norder by user, host;\nselect from_user, from_host, to_user, to_host\nfrom mysql.roles_mapping\norder by from_user, to_user;",
      'snippet',
      'Inspect MariaDB roles and role mappings',
      undefined,
      '40-mysql-snippet',
    ),
  ]
}

function mysqlOptimizerTraceSnippet(defaultObject: string) {
  return [
    suggestion(
      'optimizer trace',
      `set optimizer_trace='enabled=on';\nselect *\nfrom ${defaultObject}\nlimit 100;\nselect trace\nfrom information_schema.optimizer_trace\nlimit 1;`,
      'snippet',
      'Capture optimizer trace output for a bounded statement',
      undefined,
      '40-mysql-snippet',
    ),
  ]
}

function routineDefinitionQuery(
  routine: CompletionObject,
  routineKind: 'function' | 'procedure',
) {
  const schema = escapeSqlString(routine.schema ?? 'database_name')
  const name = escapeSqlString(routine.name)
  const routineType = routineKind.toUpperCase()

  return `select routine_definition\nfrom information_schema.routines\nwhere routine_schema = '${schema}'\n  and routine_name = '${name}'\n  and routine_type = '${routineType}'\nlimit 1;`
}

function normalizedRoutineKind(
  routine: CompletionObject,
): 'function' | 'procedure' {
  return routine.kind === 'procedure' || routine.kind === 'stored-procedure'
    ? 'procedure'
    : 'function'
}

function routineArguments(routine: CompletionObject) {
  const detail = routine.detail?.split('/').slice(1).join('/').trim()
  return detail && detail !== '-' ? detail : ''
}

function escapeSqlString(value: string) {
  return value.replaceAll("'", "''")
}

function suggestion(
  label: string,
  insertText: string,
  kind: CompletionItemKind,
  detail?: string,
  documentation?: string,
  sortText?: string,
): CompletionSuggestion {
  return {
    label,
    insertText,
    kind,
    detail,
    documentation,
    sortText,
  }
}
