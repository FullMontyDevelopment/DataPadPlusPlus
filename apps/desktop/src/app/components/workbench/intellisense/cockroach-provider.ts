import type {
  CompletionItemKind,
  CompletionObject,
  CompletionSuggestion,
  EditorCompletionContext,
} from './types'
import { quotePostgresIdentifier } from './postgres-provider'

const COCKROACH_KEYWORDS = [
  'show jobs',
  'show ranges',
  'show regions',
  'show localities',
  'show sessions',
  'show cluster settings',
  'show zone configurations',
  'backup',
  'restore',
  'import table',
  'export into csv',
  'experimental_relocate',
]

const COCKROACH_FUNCTIONS = [
  'crdb_internal.cluster_id',
  'crdb_internal.node_id',
  'crdb_internal.pretty_key',
  'crdb_internal.force_retry',
]

const COCKROACH_CATALOG_OBJECTS: CompletionObject[] = [
  {
    schema: 'crdb_internal',
    name: 'gossip_nodes',
    kind: 'view',
    detail: 'Node liveness, address, and locality metadata',
  },
  {
    schema: 'crdb_internal',
    name: 'ranges_no_leases',
    kind: 'view',
    detail: 'Range distribution without leaseholder joins',
  },
  {
    schema: 'crdb_internal',
    name: 'cluster_locks',
    kind: 'view',
    detail: 'Visible lock holders and waiters',
  },
  {
    schema: 'crdb_internal',
    name: 'cluster_contention_events',
    kind: 'view',
    detail: 'Transaction contention events',
  },
  {
    schema: 'crdb_internal',
    name: 'node_statement_statistics',
    kind: 'view',
    detail: 'Statement fingerprint latency, row, and retry statistics',
  },
  {
    schema: 'crdb_internal',
    name: 'cluster_transactions',
    kind: 'view',
    detail: 'Cluster transaction state and priority metadata',
  },
  {
    schema: 'crdb_internal',
    name: 'table_spans',
    kind: 'view',
    detail: 'Table span and range ownership metadata',
  },
]

export function buildCockroachSqlItems(
  context: EditorCompletionContext,
): CompletionSuggestion[] {
  const queryableObjects = context.catalog.objects.filter((object) =>
    ['table', 'view', 'materialized-view'].includes(object.kind),
  )
  const defaultObject = queryableObjects[0]
    ? qualifiedCockroachObject(queryableObjects[0])
    : 'public.table_name'

  return uniqueSuggestions([
    ...COCKROACH_KEYWORDS.map((keyword) =>
      suggestion(keyword, keyword, 'keyword', 'CockroachDB SQL helper', '00-crdb-keyword'),
    ),
    ...COCKROACH_FUNCTIONS.map((fn) =>
      suggestion(fn, `${fn}()`, 'function', 'CockroachDB function', '30-crdb-function'),
    ),
    suggestion(
      'crdb_internal',
      'crdb_internal',
      'schema',
      'CockroachDB internal diagnostics schema',
      '10-crdb-schema',
    ),
    ...COCKROACH_CATALOG_OBJECTS.map((object) =>
      suggestion(
        objectLabel(object),
        qualifiedCockroachObject(object),
        object.kind === 'view' ? 'view' : 'table',
        object.detail,
        '12-crdb-catalog',
      ),
    ),
    ...cockroachSnippets(defaultObject),
  ])
}

function cockroachSnippets(defaultObject: string): CompletionSuggestion[] {
  return [
    suggestion(
      'distributed explain',
      `explain (distsql)\nselect *\nfrom ${defaultObject}\nlimit 100;`,
      'snippet',
      'Review the distributed SQL plan without executing the query',
      '40-crdb-snippet',
    ),
    suggestion(
      'distributed profile preview',
      `explain analyze (debug)\nselect *\nfrom ${defaultObject}\nlimit 100;`,
      'snippet',
      'Prepare a confirmed CockroachDB profile request; this executes the read query',
      '40-crdb-snippet',
    ),
    suggestion(
      'jobs dashboard',
      'show jobs;',
      'snippet',
      'Inspect schema-change, backup, restore, import, and changefeed jobs',
      '40-crdb-snippet',
    ),
    suggestion(
      'range distribution',
      'select *\nfrom crdb_internal.ranges_no_leases\nlimit 100;',
      'snippet',
      'Inspect range distribution where crdb_internal is visible',
      '40-crdb-snippet',
    ),
    suggestion(
      'contention dashboard',
      'show sessions;\nselect *\nfrom crdb_internal.cluster_locks\nlimit 100;\nselect *\nfrom crdb_internal.cluster_contention_events\nlimit 100;',
      'snippet',
      'Review sessions, lock waits, and contention events',
      '40-crdb-snippet',
    ),
    suggestion(
      'regions and localities',
      'show regions;\nshow localities;',
      'snippet',
      'Review multi-region and locality placement metadata',
      '40-crdb-snippet',
    ),
    suggestion(
      'zone configuration review',
      `show zone configuration for table ${defaultObject};`,
      'snippet',
      'Review replication, lease preference, and GC settings',
      '40-crdb-snippet',
    ),
  ]
}

function qualifiedCockroachObject(object: CompletionObject) {
  const objectName = quotePostgresIdentifier(object.name)

  if (!object.schema) {
    return objectName
  }

  return `${quotePostgresIdentifier(object.schema)}.${objectName}`
}

function objectLabel(object: CompletionObject) {
  return object.schema ? `${object.schema}.${object.name}` : object.name
}

function suggestion(
  label: string,
  insertText: string,
  kind: CompletionItemKind,
  detail?: string,
  sortText?: string,
): CompletionSuggestion {
  return {
    label,
    insertText,
    kind,
    detail,
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
