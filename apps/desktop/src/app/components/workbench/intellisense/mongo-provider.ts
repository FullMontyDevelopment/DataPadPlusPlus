import type {
  CompletionItemKind,
  CompletionSuggestion,
  EditorCompletionContext,
} from './types'

const MONGO_KEYS = [
  'database',
  'collection',
  'operation',
  'filter',
  'projection',
  'sort',
  'skip',
  'limit',
  'pipeline',
  'command',
  'verbosity',
]

const MONGO_OPERATORS = [
  '$eq',
  '$ne',
  '$gt',
  '$gte',
  '$lt',
  '$lte',
  '$in',
  '$exists',
  '$regex',
  '$and',
  '$or',
  '$nor',
  '$not',
  '$elemMatch',
  '$size',
  '$all',
  '$type',
  '$expr',
  '$match',
  '$project',
  '$sort',
  '$limit',
  '$group',
]

const MONGO_AGGREGATION_STAGES = [
  '$match',
  '$project',
  '$group',
  '$sort',
  '$limit',
  '$skip',
  '$lookup',
  '$unwind',
  '$addFields',
  '$set',
  '$unset',
  '$count',
  '$facet',
  '$bucket',
  '$bucketAuto',
  '$replaceRoot',
  '$replaceWith',
  '$sortByCount',
  '$setWindowFields',
]

const MONGO_EXPRESSION_OPERATORS = [
  '$sum',
  '$avg',
  '$min',
  '$max',
  '$first',
  '$last',
  '$push',
  '$addToSet',
  '$cond',
  '$ifNull',
  '$concat',
  '$toString',
  '$toObjectId',
  '$toDate',
  '$dateToString',
  '$map',
  '$filter',
  '$reduce',
]

export function buildMongoItems(context: EditorCompletionContext): CompletionSuggestion[] {
  const collections = context.catalog.objects.filter((object) => object.kind === 'collection')
  const aggregationContext = isMongoAggregationContext(context)
  const fieldPaths = context.catalog.fields.map((field) => field.path ?? field.name)

  return uniqueSuggestions([
    ...MONGO_KEYS.map((key) => jsonPropertySuggestion(key)),
    ...MONGO_OPERATORS.map((operator) => jsonPropertySuggestion(operator, 'operator')),
    ...(aggregationContext
      ? [
          ...MONGO_AGGREGATION_STAGES.map((stage) => mongoStageSuggestion(stage)),
          ...MONGO_EXPRESSION_OPERATORS.map((operator) =>
            jsonPropertySuggestion(operator, 'function'),
          ),
          ...fieldPaths.map((fieldPath) =>
            suggestion(
              `$${fieldPath}`,
              JSON.stringify(`$${fieldPath}`),
              'field',
              'Aggregation field path expression',
            ),
          ),
          suggestion(
            'aggregation match stage',
            '{ "$match": { } }',
            'snippet',
            'Pipeline stage template',
          ),
          suggestion(
            'aggregation group count',
            '{ "$group": { "_id": "$status", "count": { "$sum": 1 } } }',
            'snippet',
            'Group documents and count by a field',
          ),
          suggestion(
            'lookup stage',
            '{ "$lookup": { "from": "", "localField": "", "foreignField": "", "as": "" } }',
            'snippet',
            'Join another collection into the pipeline',
          ),
        ]
      : []),
    ...collections.map((collection) =>
      suggestion(collection.name, JSON.stringify(collection.name), 'collection', collection.detail),
    ),
    ...context.catalog.fields.map((field) =>
      suggestion(
        field.path ?? field.name,
        `${JSON.stringify(field.path ?? field.name)}: `,
        'field',
        field.detail ?? field.dataType,
      ),
    ),
    suggestion('find active documents', '"filter": { "status": "active" }', 'snippet'),
    suggestion('limit 20', '"limit": 20', 'snippet'),
    suggestion(
      'aggregation pipeline',
      '"pipeline": [\n  { "$match": { } },\n  { "$limit": 20 }\n]',
      'snippet',
    ),
  ])
}

function suggestion(
  label: string,
  insertText: string,
  kind: CompletionItemKind,
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

function jsonPropertySuggestion(
  key: string,
  kind: CompletionItemKind = 'keyword',
): CompletionSuggestion {
  return suggestion(key, `${JSON.stringify(key)}: `, kind)
}

function mongoStageSuggestion(stage: string): CompletionSuggestion {
  const body =
    stage === '$limit' || stage === '$skip'
      ? '20'
      : stage === '$unwind'
        ? JSON.stringify('$field')
        : '{ }'

  return suggestion(stage, `{ ${JSON.stringify(stage)}: ${body} }`, 'operator', 'Aggregation stage')
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

function isMongoAggregationContext(context: EditorCompletionContext) {
  const beforeCursor = context.queryText.slice(0, context.cursorOffset ?? context.queryText.length)

  return (
    /"pipeline"\s*:\s*\[[\s\S]*$/i.test(beforeCursor) ||
    /\bpipeline\s*:\s*\[[\s\S]*$/i.test(beforeCursor) ||
    beforeCursor.trimStart().startsWith('[') ||
    beforeCursor.includes('$group') ||
    beforeCursor.includes('$project') ||
    beforeCursor.includes('$addFields')
  )
}
