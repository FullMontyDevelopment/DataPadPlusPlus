import type {
  CompletionObject,
  CompletionSuggestion,
  EditorCompletionContext,
} from './types'

const ORACLE_KEYWORDS = [
  'fetch first',
  'connect by',
  'start with',
  'merge into',
  'minus',
  'returning into',
  'explain plan for',
]

const ORACLE_FUNCTIONS = [
  'nvl',
  'systimestamp',
  'sysdate',
  'to_char',
  'to_date',
  'numtodsinterval',
]

export function buildOracleSqlItems(
  context: EditorCompletionContext,
): CompletionSuggestion[] {
  const routines = context.catalog.objects.filter((object) =>
    ['function', 'procedure', 'package'].includes(object.kind),
  )
  const defaultObject = context.catalog.objects.find((object) =>
    ['table', 'view', 'materialized-view'].includes(object.kind),
  )
  const defaultTarget = defaultObject
    ? qualifiedOracleObject(defaultObject)
    : 'APP.ACCOUNTS'

  return [
    ...ORACLE_KEYWORDS.map((keyword) =>
      suggestion(keyword, keyword, 'keyword', 'Oracle SQL keyword'),
    ),
    ...ORACLE_FUNCTIONS.map((fn) =>
      suggestion(fn, `${fn}()`, 'function', 'Oracle SQL function'),
    ),
    ...routines.map((routine) => oracleRoutineSuggestion(routine)),
    suggestion(
      'dbms_xplan display',
      `explain plan for\nselect *\nfrom ${defaultTarget}\nfetch first 100 rows only;\n\nselect * from table(dbms_xplan.display);`,
      'snippet',
      'Render an Oracle EXPLAIN PLAN through DBMS_XPLAN',
    ),
    suggestion(
      'sql monitor',
      "select sql_id, status, elapsed_time, sql_text\nfrom v$sql_monitor\nwhere rownum <= 100;",
      'snippet',
      'Review SQL Monitor rows when V$SQL_MONITOR is granted',
    ),
    suggestion(
      'session waits',
      "select sid, serial#, username, status, wait_class, event\nfrom v$session\nwhere rownum <= 100;",
      'snippet',
      'Review Oracle sessions and wait classes',
    ),
    suggestion(
      'invalid objects',
      "select owner, object_name, object_type, status\nfrom all_objects\nwhere status <> 'VALID'\norder by owner, object_name;",
      'snippet',
      'List invalid Oracle schema objects',
    ),
    suggestion(
      'compile errors',
      "select name, type, line, position, text\nfrom user_errors\norder by name, sequence;",
      'snippet',
      'Inspect PL/SQL compilation errors',
    ),
    suggestion(
      'package source',
      "select line, text\nfrom user_source\nwhere name = 'PACKAGE_NAME'\norder by type, line;",
      'snippet',
      'Inspect Oracle package spec and body source',
    ),
  ]
}

export function quoteOracleIdentifier(identifier: string) {
  return /^[A-Z][A-Z0-9_$#]*$/.test(identifier)
    ? identifier
    : `"${identifier.replaceAll('"', '""')}"`
}

function oracleRoutineSuggestion(
  routine: CompletionObject,
): CompletionSuggestion {
  const name = qualifiedOracleObject(routine)

  if (routine.kind === 'function') {
    return suggestion(
      `select ${name}`,
      `select ${name}(/* parameters */) from dual;`,
      'function',
      routine.detail ?? 'Oracle function',
    )
  }

  if (routine.kind === 'procedure') {
    return suggestion(
      `execute ${name}`,
      `begin\n  ${name}(/* parameters */);\nend;\n/`,
      'function',
      routine.detail ?? 'Oracle procedure',
    )
  }

  return suggestion(
    `package ${name}`,
    `select line, text\nfrom all_source\nwhere owner = '${routine.schema ?? 'APP'}'\n  and name = '${routine.name}'\norder by type, line;`,
    'snippet',
    routine.detail ?? 'Oracle package source',
  )
}

function qualifiedOracleObject(object: CompletionObject) {
  const objectName = quoteOracleIdentifier(object.name)

  if (!object.schema) {
    return objectName
  }

  return `${quoteOracleIdentifier(object.schema)}.${objectName}`
}

function suggestion(
  label: string,
  insertText: string,
  kind: CompletionSuggestion['kind'],
  detail?: string,
  documentation?: string,
): CompletionSuggestion {
  return {
    label,
    insertText,
    kind,
    detail,
    documentation,
  }
}
