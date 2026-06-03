import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import type {
  CompletionItemKind,
  CompletionObject,
  CompletionSuggestion,
  DatastoreCompletionProvider,
  EditorCompletionContext,
} from './types'

const DOCUMENT_ENGINES: Array<ConnectionProfile['engine']> = ['cosmosdb', 'litedb']
const GRAPH_ENGINES: Array<ConnectionProfile['engine']> = [
  'neo4j',
  'arango',
  'janusgraph',
  'neptune',
]
const TIMESERIES_ENGINES: Array<ConnectionProfile['engine']> = [
  'prometheus',
  'influxdb',
  'opentsdb',
]

const COSMOS_SQL_KEYWORDS = [
  'select',
  'from',
  'where',
  'order by',
  'offset limit',
  'join',
  'is_defined',
  'array_contains',
  'contains',
]
const DOCUMENT_JSON_KEYS = [
  'operation',
  'database',
  'container',
  'collection',
  'filter',
  'query',
  'parameters',
  'partitionKey',
  'limit',
]
const MEMCACHED_COMMANDS = [
  'get',
  'gets',
  'set',
  'add',
  'replace',
  'append',
  'prepend',
  'cas',
  'delete',
  'touch',
  'incr',
  'decr',
  'stats',
  'stats slabs',
  'stats items',
  'stats settings',
  'flush_all',
  'version',
]
const PROMQL_ITEMS = [
  'rate',
  'increase',
  'sum by',
  'avg by',
  'histogram_quantile',
  'topk',
  'label_replace',
  'offset',
]
const FLUX_ITEMS = [
  'from',
  'range',
  'filter',
  'aggregateWindow',
  'mean',
  'last',
  'yield',
]
const OPENTSDB_ITEMS = ['sum', 'avg', 'min', 'max', 'zimsum', 'none', '1m-avg', '5m-sum']
const GRAPH_KEYWORDS: Partial<Record<ConnectionProfile['engine'], string[]>> = {
  neo4j: ['match', 'where', 'return', 'with', 'unwind', 'call', 'profile', 'explain'],
  arango: ['for', 'in', 'filter', 'return', 'limit', 'collect', 'sort', 'graph'],
  janusgraph: ['g.V()', 'g.E()', 'hasLabel', 'has', 'out', 'in', 'both', 'limit'],
  neptune: ['g.V()', 'g.E()', 'hasLabel', 'has', 'out', 'profile', 'explain', 'sparql'],
}

export const SECONDARY_COMPLETION_PROVIDERS: DatastoreCompletionProvider[] = [
  {
    id: 'document-secondary',
    engines: DOCUMENT_ENGINES,
    languages: ['json', 'sql'],
    buildItems: buildDocumentSecondaryItems,
  },
  {
    id: 'memcached',
    engines: ['memcached'],
    languages: ['plaintext'],
    buildItems: buildMemcachedItems,
  },
  {
    id: 'timeseries',
    engines: TIMESERIES_ENGINES,
    languages: ['plaintext', 'sql'],
    buildItems: buildTimeseriesItems,
  },
  {
    id: 'graph',
    engines: GRAPH_ENGINES,
    languages: ['plaintext'],
    buildItems: buildGraphItems,
  },
]

function buildDocumentSecondaryItems(context: EditorCompletionContext) {
  const containers = context.catalog.objects.filter((object) =>
    ['container', 'collection'].includes(object.kind),
  )
  const databaseSuggestions = context.catalog.schemas.map((schema) =>
    suggestion(schema.name, schema.name, 'schema', schema.detail),
  )
  const objectSuggestions = containers.map((object) =>
    suggestion(objectLabel(object), object.name, object.kind === 'collection' ? 'collection' : 'table', object.detail),
  )
  const fieldSuggestions = context.catalog.fields.map((field) =>
    suggestion(field.path ?? field.name, field.path ?? field.name, 'field', field.detail ?? field.dataType),
  )

  if (context.connection?.engine === 'cosmosdb' && context.language === 'sql') {
    return uniqueSuggestions([
      ...COSMOS_SQL_KEYWORDS.map((keyword) => suggestion(keyword, keyword, 'keyword')),
      ...databaseSuggestions,
      ...objectSuggestions,
      ...fieldSuggestions,
      suggestion('bounded container query', 'SELECT * FROM c OFFSET 0 LIMIT 100', 'snippet'),
      suggestion('partition key filter', 'WHERE c.partitionKey = @partitionKey', 'snippet'),
    ])
  }

  return uniqueSuggestions([
    ...DOCUMENT_JSON_KEYS.map((key) => jsonPropertySuggestion(key)),
    ...objectSuggestions.map((item) => ({ ...item, insertText: JSON.stringify(item.insertText) })),
    ...fieldSuggestions.map((item) => ({ ...item, insertText: `${JSON.stringify(item.insertText)}: ` })),
    suggestion('bounded find', '"filter": {}, "limit": 100', 'snippet'),
  ])
}

function buildMemcachedItems(context: EditorCompletionContext) {
  const firstToken = context.queryText.slice(0, context.cursorOffset ?? context.queryText.length).trimStart().split(/\s+/)[0] ?? ''
  const commandMode = firstToken.length === 0 || context.queryText.trimStart() === firstToken
  const objects = context.catalog.objects.filter((object) =>
    ['key', 'known-key', 'slab', 'item-class', 'server'].includes(object.kind),
  )

  return uniqueSuggestions([
    ...MEMCACHED_COMMANDS.map((command) =>
      suggestion(command, commandMode ? command : command.toLowerCase(), 'command', memcachedCommandDetail(command)),
    ),
    ...objects.map((object) => suggestion(object.name, object.name, 'value', object.detail)),
    suggestion('safe set preview', 'set <key> 0 <ttl> <bytes>', 'snippet'),
    suggestion('CAS read', 'gets <key>', 'snippet'),
  ])
}

function buildTimeseriesItems(context: EditorCompletionContext) {
  const engine = context.connection?.engine
  const keywords =
    engine === 'prometheus' ? PROMQL_ITEMS : engine === 'opentsdb' ? OPENTSDB_ITEMS : FLUX_ITEMS
  const metricObjects = context.catalog.objects.filter((object) =>
    ['metric', 'measurement'].includes(object.kind),
  )
  const dimensions = context.catalog.objects.filter((object) =>
    ['label', 'tag', 'bucket'].includes(object.kind),
  )

  return uniqueSuggestions([
    ...keywords.map((keyword) => suggestion(keyword, keyword, keyword.includes('(') ? 'function' : 'keyword')),
    ...metricObjects.map((object) => suggestion(object.name, object.name, 'field', object.detail)),
    ...dimensions.map((object) => suggestion(object.name, object.name, object.kind === 'bucket' ? 'schema' : 'field', object.detail)),
    ...context.catalog.fields.map((field) =>
      suggestion(field.path ?? field.name, field.path ?? field.name, 'field', field.detail ?? field.dataType),
    ),
    ...timeseriesSnippets(engine, metricObjects[0]?.name),
  ])
}

function buildGraphItems(context: EditorCompletionContext) {
  const engine = context.connection?.engine
  const labels = context.catalog.objects.filter((object) => object.kind === 'node-label')
  const relationships = context.catalog.objects.filter((object) => object.kind === 'relationship')
  const properties = context.catalog.objects.filter((object) => object.kind === 'property-key')
  const graphs = context.catalog.objects.filter((object) => object.kind === 'graph')

  return uniqueSuggestions([
    ...(GRAPH_KEYWORDS[engine ?? 'neo4j'] ?? []).map((keyword) => suggestion(keyword, keyword, 'keyword')),
    ...graphs.map((graph) => suggestion(graph.name, graph.name, 'schema', graph.detail)),
    ...labels.map((label) => suggestion(label.name, graphLabelInsert(engine, label.name), 'table', label.detail)),
    ...relationships.map((relationship) =>
      suggestion(relationship.name, graphRelationshipInsert(engine, relationship.name), 'value', relationship.detail),
    ),
    ...properties.map((property) => suggestion(property.name, property.name, 'field', property.detail)),
    ...context.catalog.fields.map((field) =>
      suggestion(field.path ?? field.name, field.path ?? field.name, 'field', field.detail ?? field.dataType),
    ),
    ...graphSnippets(engine, labels[0]?.name, relationships[0]?.name),
  ])
}

function timeseriesSnippets(engine: ConnectionProfile['engine'] | undefined, metric = 'metric') {
  if (engine === 'prometheus') {
    return [
      suggestion('rate over 5m', `rate(${metric}[5m])`, 'snippet'),
      suggestion('sum by label', `sum by (job) (${metric})`, 'snippet'),
    ]
  }
  if (engine === 'opentsdb') {
    return [suggestion('bounded OpenTSDB query', `m=sum:${metric} start=1h-ago`, 'snippet')]
  }
  return [
    suggestion('Flux range filter', `from(bucket: "bucket")\n  |> range(start: -1h)\n  |> filter(fn: (r) => r._measurement == "${metric}")`, 'snippet'),
  ]
}

function graphSnippets(engine: ConnectionProfile['engine'] | undefined, label = 'Label', relationship = 'RELATED_TO') {
  if (engine === 'arango') {
    return [suggestion('bounded AQL traversal', `FOR doc IN ${label}\n  LIMIT 25\n  RETURN doc`, 'snippet')]
  }
  if (engine === 'janusgraph' || engine === 'neptune') {
    return [suggestion('bounded Gremlin traversal', `g.V().hasLabel('${label}').limit(25)`, 'snippet')]
  }
  return [suggestion('bounded Cypher match', `MATCH (n:\`${label}\`)-[r:\`${relationship}\`]->() RETURN n, r LIMIT 25`, 'snippet')]
}

function graphLabelInsert(engine: ConnectionProfile['engine'] | undefined, label: string) {
  return engine === 'neo4j' ? `:\`${label}\`` : label
}

function graphRelationshipInsert(engine: ConnectionProfile['engine'] | undefined, relationship: string) {
  return engine === 'neo4j' ? `:\`${relationship}\`` : relationship
}

function memcachedCommandDetail(command: string) {
  if (command.startsWith('stats')) return 'Read-only server statistics'
  if (['set', 'add', 'replace', 'append', 'prepend', 'cas', 'delete', 'touch', 'incr', 'decr', 'flush_all'].includes(command)) {
    return 'Guarded preview command'
  }
  return 'Read-only cache command'
}

function jsonPropertySuggestion(key: string) {
  return suggestion(key, `${JSON.stringify(key)}: `, 'keyword')
}

function suggestion(
  label: string,
  insertText: string,
  kind: CompletionItemKind,
  detail?: string,
): CompletionSuggestion {
  return { label, insertText, kind, detail }
}

function uniqueSuggestions(suggestions: CompletionSuggestion[]) {
  const seen = new Set<string>()
  return suggestions.filter((item) => {
    const key = `${item.kind}:${item.label}:${item.insertText}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function objectLabel(object: CompletionObject) {
  return object.schema ? `${object.schema}.${object.name}` : object.name
}
