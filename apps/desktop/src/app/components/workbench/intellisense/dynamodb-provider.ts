import type {
  CompletionItemKind,
  CompletionSuggestion,
  EditorCompletionContext,
} from './types'

const DYNAMODB_KEYS = [
  'operation',
  'tableName',
  'indexName',
  'statement',
  'parameters',
  'keyConditionExpression',
  'filterExpression',
  'projectionExpression',
  'expressionAttributeNames',
  'expressionAttributeValues',
  'consistentRead',
  'returnConsumedCapacity',
  'limit',
  'exclusiveStartKey',
  'nextToken',
]

export function buildDynamoDbItems(
  context: EditorCompletionContext,
): CompletionSuggestion[] {
  const tables = context.catalog.objects.filter(
    (object) => object.kind === 'table',
  )

  return uniqueSuggestions([
    ...DYNAMODB_KEYS.map((key) => jsonPropertySuggestion(key)),
    ...tables.map((table) =>
      suggestion(table.name, JSON.stringify(table.name), 'table', table.detail),
    ),
    ...context.catalog.fields.map((field) =>
      suggestion(
        field.path ?? field.name,
        field.path ?? field.name,
        'field',
        field.detail ?? field.dataType,
      ),
    ),
    suggestion(
      '#name',
      '"#name": "attributeName"',
      'snippet',
      'Expression attribute name helper',
    ),
    suggestion(
      ':value',
      '":value": { "S": "value" }',
      'snippet',
      'Expression attribute value helper',
    ),
    suggestion(
      'ExecuteStatement SELECT',
      '"operation": "ExecuteStatement",\n"statement": "SELECT * FROM \\"TableName\\" WHERE pk = ?",\n"parameters": [{ "S": "value" }]',
      'snippet',
      'Read-only PartiQL request with positional parameters',
    ),
    suggestion(
      'Query with consumed capacity',
      '"operation": "Query",\n"tableName": "",\n"keyConditionExpression": "#pk = :pk",\n"expressionAttributeNames": { "#pk": "pk" },\n"expressionAttributeValues": { ":pk": { "S": "value" } },\n"returnConsumedCapacity": "TOTAL"',
      'snippet',
      'Key-condition read request with capacity feedback',
    ),
  ])
}

function suggestion(
  label: string,
  insertText: string,
  kind: CompletionItemKind,
  detail?: string,
): CompletionSuggestion {
  return {
    label,
    insertText,
    kind,
    detail,
  }
}

function jsonPropertySuggestion(key: string) {
  return suggestion(key, `${JSON.stringify(key)}: `, 'keyword')
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
