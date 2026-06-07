import type {
  CompletionItemKind,
  CompletionObject,
  CompletionSuggestion,
  EditorCompletionContext,
} from './types'

const POSTGRES_KEYWORDS = [
  'distinct on',
  'filter (where',
  'for update skip locked',
  'lateral',
  'on conflict',
  'returning',
  'with recursive',
]

const POSTGRES_FUNCTIONS = [
  'array_agg',
  'current_setting',
  'jsonb_build_object',
  'jsonb_path_query',
  'now',
  'pg_get_functiondef',
  'pg_get_viewdef',
  'pg_relation_size',
  'pg_size_pretty',
  'pg_total_relation_size',
  'set_config',
  'string_agg',
  'to_regclass',
]

const POSTGRES_CATALOG_OBJECTS: CompletionObject[] = [
  {
    schema: 'pg_catalog',
    name: 'pg_stat_activity',
    kind: 'view',
    detail: 'Session, wait, and blocking state',
  },
  {
    schema: 'pg_catalog',
    name: 'pg_locks',
    kind: 'view',
    detail: 'Current lock posture',
  },
  {
    schema: 'pg_catalog',
    name: 'pg_stat_user_tables',
    kind: 'view',
    detail: 'User table vacuum, analyze, and scan counters',
  },
  {
    schema: 'pg_catalog',
    name: 'pg_stat_statements',
    kind: 'view',
    detail: 'Top statement statistics when the extension is enabled',
  },
  {
    schema: 'pg_catalog',
    name: 'pg_extension',
    kind: 'table',
    detail: 'Installed extensions',
  },
  {
    schema: 'pg_catalog',
    name: 'pg_roles',
    kind: 'view',
    detail: 'Role posture and attributes',
  },
  {
    schema: 'pg_catalog',
    name: 'pg_auth_members',
    kind: 'view',
    detail: 'Role membership edges',
  },
  {
    schema: 'information_schema',
    name: 'routine_privileges',
    kind: 'view',
    detail: 'Routine grant visibility',
  },
]

const RESERVED_POSTGRES_IDENTIFIERS = new Set([
  'all',
  'analyze',
  'and',
  'as',
  'asc',
  'between',
  'by',
  'case',
  'create',
  'delete',
  'desc',
  'distinct',
  'from',
  'group',
  'insert',
  'join',
  'limit',
  'not',
  'null',
  'offset',
  'on',
  'or',
  'order',
  'returning',
  'select',
  'table',
  'update',
  'user',
  'where',
  'with',
])

export function buildPostgresSqlItems(
  context: EditorCompletionContext,
): CompletionSuggestion[] {
  const queryableObjects = context.catalog.objects.filter((object) =>
    ['table', 'view', 'materialized-view'].includes(object.kind),
  )
  const routines = context.catalog.objects.filter(isRoutineObject)
  const defaultObject = queryableObjects[0]
    ? qualifiedPostgresObject(queryableObjects[0])
    : 'public.table_name'

  return uniqueSuggestions([
    ...POSTGRES_KEYWORDS.map((keyword) =>
      suggestion(
        keyword,
        keyword,
        'keyword',
        'PostgreSQL keyword',
        undefined,
        '00-pg-keyword',
      ),
    ),
    ...POSTGRES_FUNCTIONS.map((fn) =>
      suggestion(
        fn,
        `${fn}()`,
        'function',
        'PostgreSQL function',
        undefined,
        '30-pg-function',
      ),
    ),
    suggestion(
      'pg_catalog',
      'pg_catalog',
      'schema',
      'PostgreSQL system catalog',
      undefined,
      '10-pg-schema',
    ),
    suggestion(
      'information_schema',
      'information_schema',
      'schema',
      'SQL-standard metadata schema',
      undefined,
      '10-pg-schema',
    ),
    ...POSTGRES_CATALOG_OBJECTS.map((object) =>
      suggestion(
        objectLabel(object),
        qualifiedPostgresObject(object),
        object.kind === 'view' ? 'view' : 'table',
        object.detail,
        undefined,
        '12-pg-catalog',
      ),
    ),
    ...routineSuggestions(routines),
    ...postgresSnippets(defaultObject, routines[0]),
  ])
}

function routineSuggestions(
  routines: CompletionObject[],
): CompletionSuggestion[] {
  return routines.flatMap((routine) => {
    const routineKind = normalizedRoutineKind(routine)
    const args = routineArguments(routine)
    const callArguments = args ? `/* ${args} */` : ''
    const qualifiedName = qualifiedPostgresObject(routine)
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
        routine.detail ?? `PostgreSQL ${routineKind}`,
        undefined,
        '05-pg-routine-call',
      ),
      suggestion(
        `define ${label}`,
        routineDefinitionQuery(routine, routineKind),
        'snippet',
        `Inspect PostgreSQL ${routineKind} definition`,
        undefined,
        '06-pg-routine-def',
      ),
    ]
  })
}

function postgresSnippets(
  defaultObject: string,
  routine: CompletionObject | undefined,
): CompletionSuggestion[] {
  const routineName = routine
    ? qualifiedPostgresObject(routine)
    : 'public.routine_name'
  const routineArgs = routine ? routineArguments(routine) : ''
  const routineCallArgs = routineArgs ? `/* ${routineArgs} */` : ''

  return [
    suggestion(
      'bounded select',
      `select *\nfrom ${defaultObject}\nlimit 100;`,
      'snippet',
      'Read a bounded sample from the current table or view',
      undefined,
      '40-pg-snippet',
    ),
    suggestion(
      'cte read model',
      `with source as (\n  select *\n  from ${defaultObject}\n  limit 100\n)\nselect *\nfrom source;`,
      'snippet',
      'Start a bounded CTE query',
      undefined,
      '40-pg-snippet',
    ),
    suggestion(
      'explain analyze json',
      `explain (analyze true, buffers true, verbose true, format json)\nselect *\nfrom ${defaultObject}\nlimit 100;`,
      'snippet',
      'Run a PostgreSQL JSON profile for a read statement',
      undefined,
      '40-pg-snippet',
    ),
    suggestion(
      'session wait profile',
      `select pid, usename, application_name, state, wait_event_type, wait_event, query_start, query\nfrom pg_catalog.pg_stat_activity\nwhere datname = current_database()\norder by query_start nulls last\nlimit 100;`,
      'snippet',
      'Inspect active sessions and waits',
      undefined,
      '40-pg-snippet',
    ),
    suggestion(
      'lock posture',
      `select l.locktype, l.mode, l.granted, a.pid, a.usename, a.query\nfrom pg_catalog.pg_locks l\nleft join pg_catalog.pg_stat_activity a on a.pid = l.pid\norder by l.granted, l.locktype, l.mode\nlimit 100;`,
      'snippet',
      'Inspect lock state with session context',
      undefined,
      '40-pg-snippet',
    ),
    suggestion(
      'routine inventory',
      `select n.nspname as schema_name,\n       p.proname as routine_name,\n       case p.prokind when 'p' then 'procedure' else 'function' end as routine_type,\n       pg_get_function_arguments(p.oid) as arguments,\n       pg_get_function_result(p.oid) as returns\nfrom pg_catalog.pg_proc p\njoin pg_catalog.pg_namespace n on n.oid = p.pronamespace\nwhere n.nspname not in ('pg_catalog', 'information_schema')\norder by n.nspname, p.proname\nlimit 200;`,
      'snippet',
      'List PostgreSQL functions and procedures with signatures',
      undefined,
      '40-pg-snippet',
    ),
    suggestion(
      'extension update check',
      `select e.extname,\n       e.extversion as installed_version,\n       v.default_version,\n       v.installed_version is distinct from v.default_version as update_available\nfrom pg_catalog.pg_extension e\nleft join pg_catalog.pg_available_extensions v on v.name = e.extname\norder by e.extname;`,
      'snippet',
      'Check installed extension versions against defaults',
      undefined,
      '40-pg-snippet',
    ),
    suggestion(
      'routine call',
      `select ${routineName}(${routineCallArgs});`,
      'snippet',
      'Call the first known PostgreSQL routine from metadata',
      undefined,
      '40-pg-snippet',
    ),
  ]
}

function routineDefinitionQuery(
  routine: CompletionObject,
  routineKind: 'function' | 'procedure',
) {
  const schema = escapeSqlString(routine.schema ?? 'public')
  const name = escapeSqlString(routine.name)
  const prokind = routineKind === 'procedure' ? "  and p.prokind = 'p'\n" : ''

  return `select pg_get_functiondef(p.oid)\nfrom pg_catalog.pg_proc p\njoin pg_catalog.pg_namespace n on n.oid = p.pronamespace\nwhere n.nspname = '${schema}'\n  and p.proname = '${name}'\n${prokind}limit 1;`
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

function isRoutineObject(object: CompletionObject) {
  return ['function', 'procedure', 'stored-procedure'].includes(object.kind)
}

function qualifiedPostgresObject(object: CompletionObject) {
  const objectName = quotePostgresIdentifier(object.name)

  if (!object.schema) {
    return objectName
  }

  return `${quotePostgresIdentifier(object.schema)}.${objectName}`
}

export function quotePostgresIdentifier(identifier: string) {
  const trimmed = identifier.trim()
  const normalized = trimmed.toLowerCase()

  if (
    /^[a-z_][a-z0-9_]*$/.test(trimmed) &&
    trimmed === normalized &&
    !RESERVED_POSTGRES_IDENTIFIERS.has(normalized)
  ) {
    return trimmed
  }

  return `"${trimmed.replaceAll('"', '""')}"`
}

function escapeSqlString(value: string) {
  return value.replaceAll("'", "''")
}

function objectLabel(object: CompletionObject) {
  return object.schema ? `${object.schema}.${object.name}` : object.name
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

function uniqueSuggestions(suggestions: CompletionSuggestion[]) {
  const seen = new Set<string>()
  const result: CompletionSuggestion[] = []

  for (const item of suggestions) {
    const key = `${item.kind}:${item.label}:${item.insertText}`.toLowerCase()

    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }

  return result
}
