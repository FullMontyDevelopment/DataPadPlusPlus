import type {
  CosmosSqlQueryEditorParameter,
} from '@datapadplusplus/shared-types'
import type {
  CompletionSuggestion,
  DatastoreCompletionProvider,
  EditorCompletionContext,
} from '../../intellisense/types'

const KEYWORDS = [
  'SELECT',
  'SELECT VALUE',
  'SELECT DISTINCT',
  'TOP',
  'FROM',
  'JOIN',
  'IN',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'ORDER BY',
  'ASC',
  'DESC',
  'OFFSET',
  'LIMIT',
]

const FUNCTIONS = [
  'ARRAY_CONTAINS',
  'ARRAY_LENGTH',
  'CONTAINS',
  'ENDSWITH',
  'IS_ARRAY',
  'IS_BOOL',
  'IS_DEFINED',
  'IS_NULL',
  'IS_NUMBER',
  'IS_OBJECT',
  'IS_STRING',
  'STARTSWITH',
]

export const COSMOS_SQL_COMPLETION_PROVIDER: DatastoreCompletionProvider = {
  id: 'cosmos-sql',
  engines: ['cosmosdb'],
  languages: ['sql'],
  buildItems: (context) => buildCosmosSqlItems(context, []),
}

export function cosmosSqlCompletionProvider(
  parameters: CosmosSqlQueryEditorParameter[],
): DatastoreCompletionProvider {
  return {
    ...COSMOS_SQL_COMPLETION_PROVIDER,
    id: 'cosmos-sql-editor',
    buildItems: (context) => buildCosmosSqlItems(context, parameters),
  }
}

export function buildCosmosSqlItems(
  context: EditorCompletionContext,
  parameters: CosmosSqlQueryEditorParameter[],
) {
  const fields = context.catalog.fields.filter((field) => targetField(context, field))
  const containers = context.catalog.objects.filter((object) =>
    ['container', 'collection'].includes(object.kind),
  )
  return unique([
    ...KEYWORDS.map((keyword) =>
      item(keyword.toLowerCase(), `${keyword} `, 'keyword', 'Cosmos DB NoSQL clause'),
    ),
    ...FUNCTIONS.map((fn) => item(fn, `${fn}()`, 'function', 'Cosmos DB built-in function')),
    item('c', 'c', 'value', 'Current container item alias'),
    ...containers.map((container) => {
      const label = [container.schema, container.name].filter(Boolean).join('.')
      return item(label, container.name, 'table', container.detail)
    }),
    ...fields.flatMap((field) => {
      const path = field.path ?? field.name
      const expression = path.startsWith('c.') || path.startsWith('c[')
        ? path
        : `c.${path}`
      return [item(expression, expression, 'field', field.detail ?? field.dataType)]
    }),
    ...parameters
      .filter((parameter) => /^@[A-Za-z_][A-Za-z0-9_]*$/.test(parameter.name.trim()))
      .map((parameter) =>
        item(parameter.name.trim(), parameter.name.trim(), 'variable', parameter.valueType),
      ),
    item(
      'bounded query',
      'SELECT * FROM c OFFSET 0 LIMIT 100',
      'snippet',
      'Bounded Cosmos DB container query',
    ),
    item(
      'partition key filter',
      'WHERE c.partitionKey = @partitionKey',
      'snippet',
      'Route a query with a bound partition-key value',
    ),
  ])
}

function targetField(
  context: EditorCompletionContext,
  field: EditorCompletionContext['catalog']['fields'][number],
) {
  const target = context.tab?.scopedTarget
  if (!target || !field.objectName) return true
  const targetName = target.path?.at(-1) ?? target.scope
  return !targetName || field.objectName === targetName
}

function item(
  label: string,
  insertText: string,
  kind: CompletionSuggestion['kind'],
  detail?: string,
): CompletionSuggestion {
  return { label, insertText, kind, detail }
}

function unique(items: CompletionSuggestion[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.kind}:${item.label.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
