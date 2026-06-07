import type {
  CompletionItemKind,
  CompletionObject,
  CompletionSuggestion,
  EditorCompletionContext,
} from './types'
import {
  mysqlRoutineSuggestions,
  mysqlSnippets,
  objectLabel,
  qualifiedMySqlObject,
} from './mysql-provider.helpers'

export { quoteMySqlIdentifier } from './mysql-provider.helpers'

const MYSQL_KEYWORDS = [
  'force index',
  'for update',
  'ignore index',
  'lock in share mode',
  'on duplicate key update',
  'straight_join',
  'use index',
  'with recursive',
]

const MYSQL_FUNCTIONS = [
  'current_user',
  'database',
  'date_format',
  'group_concat',
  'ifnull',
  'json_extract',
  'json_table',
  'regexp_like',
  'timestampdiff',
  'version',
]

const MYSQL_CATALOG_OBJECTS: CompletionObject[] = [
  {
    schema: 'information_schema',
    name: 'tables',
    kind: 'view',
    detail: 'Table and view metadata',
  },
  {
    schema: 'information_schema',
    name: 'columns',
    kind: 'view',
    detail: 'Column metadata and data types',
  },
  {
    schema: 'information_schema',
    name: 'routines',
    kind: 'view',
    detail: 'Stored function and procedure metadata',
  },
  {
    schema: 'information_schema',
    name: 'optimizer_trace',
    kind: 'view',
    detail: 'Optimizer trace output after enabling optimizer_trace',
  },
  {
    schema: 'performance_schema',
    name: 'events_statements_summary_by_digest',
    kind: 'view',
    detail: 'Statement digest workload profile',
  },
  {
    schema: 'performance_schema',
    name: 'table_io_waits_summary_by_table',
    kind: 'view',
    detail: 'Table I/O wait profile',
  },
  {
    schema: 'performance_schema',
    name: 'metadata_locks',
    kind: 'view',
    detail: 'Metadata lock posture',
  },
  {
    schema: 'performance_schema',
    name: 'threads',
    kind: 'view',
    detail: 'Session/thread mapping for wait analysis',
  },
]

const MARIADB_CATALOG_OBJECTS: CompletionObject[] = [
  {
    schema: 'information_schema',
    name: 'engines',
    kind: 'view',
    detail: 'Storage engine metadata',
  },
  {
    schema: 'mysql',
    name: 'roles_mapping',
    kind: 'table',
    detail: 'MariaDB role membership mapping',
  },
]

export function buildMySqlItems(
  context: EditorCompletionContext,
): CompletionSuggestion[] {
  const isMariaDb = context.connection?.engine === 'mariadb' || context.catalog.engine === 'mariadb'
  const dialectLabel = isMariaDb ? 'MariaDB' : 'MySQL'
  const catalogObjects = isMariaDb
    ? [
        ...MYSQL_CATALOG_OBJECTS.filter((object) => object.name !== 'optimizer_trace'),
        ...MARIADB_CATALOG_OBJECTS,
      ]
    : MYSQL_CATALOG_OBJECTS
  const queryableObjects = context.catalog.objects.filter((object) =>
    ['table', 'view'].includes(object.kind),
  )
  const routines = context.catalog.objects.filter(isRoutineObject)
  const defaultObject = queryableObjects[0]
    ? qualifiedMySqlObject(queryableObjects[0])
    : 'database_name.table_name'

  return uniqueSuggestions([
    ...MYSQL_KEYWORDS.map((keyword) =>
      suggestion(
        keyword,
        keyword,
        'keyword',
        `${dialectLabel} keyword`,
        undefined,
        `00-${isMariaDb ? 'mariadb' : 'mysql'}-keyword`,
      ),
    ),
    ...MYSQL_FUNCTIONS.map((fn) =>
      suggestion(
        fn,
        `${fn}()`,
        'function',
        `${dialectLabel} function`,
        undefined,
        `30-${isMariaDb ? 'mariadb' : 'mysql'}-function`,
      ),
    ),
    suggestion(
      'information_schema',
      'information_schema',
      'schema',
      'SQL metadata schema',
      undefined,
      '10-mysql-schema',
    ),
    suggestion(
      'performance_schema',
      'performance_schema',
      'schema',
      `${dialectLabel} performance instrumentation schema`,
      undefined,
      '10-mysql-schema',
    ),
    ...catalogObjects.map((object) =>
      suggestion(
        objectLabel(object),
        qualifiedMySqlObject(object),
        object.kind === 'view' ? 'view' : 'table',
        object.detail,
        undefined,
        '12-mysql-catalog',
      ),
    ),
    ...mysqlRoutineSuggestions(routines, dialectLabel),
    ...mysqlSnippets(defaultObject, routines[0], dialectLabel, isMariaDb),
  ])
}

function isRoutineObject(object: CompletionObject) {
  return ['function', 'procedure', 'stored-procedure'].includes(object.kind)
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
