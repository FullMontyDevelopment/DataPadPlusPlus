import { MONGO_SCRIPT_CATALOG } from './mongo-script-catalog'
import type { CompletionSuggestion, EditorCompletionContext } from '../../intellisense/types'

const BSON_GLOBALS = [
  'ObjectId', 'UUID', 'Binary', 'Decimal128', 'NumberLong', 'Int32', 'Double',
  'ISODate', 'Timestamp', 'MinKey', 'MaxKey', 'EJSON', 'print', 'printjson',
]

const OPERATORS = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$exists', '$regex',
  '$and', '$or', '$nor', '$not', '$elemMatch', '$size', '$all', '$type', '$expr',
  '$set', '$unset', '$inc', '$mul', '$rename', '$push', '$pull', '$addToSet',
  '$match', '$project', '$group', '$sort', '$limit', '$skip', '$lookup', '$unwind',
  '$addFields', '$count', '$facet', '$setWindowFields', '$merge', '$out',
]

export function buildMongoScriptItems(context: EditorCompletionContext): CompletionSuggestion[] {
  const beforeCursor = context.queryText.slice(0, context.cursorOffset ?? context.queryText.length)
  const afterDb = /\bdb\.$/.test(beforeCursor)
  const afterCollection = /(?:\bdb\.[A-Za-z_$][\w$]*|getCollection\([^)]*\))\.$/.test(beforeCursor)
  const collections = context.catalog.objects.filter((object) => object.kind === 'collection')
  const items: CompletionSuggestion[] = []

  if (afterDb) {
    items.push(
      ...collections.map((collection) => suggestion(
        collection.name,
        safeIdentifier(collection.name) ? collection.name : `getCollection(${JSON.stringify(collection.name)})`,
        'collection',
        collection.detail ?? 'MongoDB collection',
      )),
      ...['getCollection', 'getName', 'getSiblingDB', 'runCommand', 'adminCommand', 'createCollection', 'dropDatabase', 'startSession'].map((name) =>
        suggestion(name, methodInsert(name), 'function', `MongoDB db.${name}`),
      ),
    )
  }

  if (afterCollection) {
    items.push(...MONGO_SCRIPT_CATALOG
      .filter((item) => !['runCommand', 'adminCommand', 'createCollection', 'withTransaction', 'BSON constructors', 'printjson', 'environment secrets'].includes(item.name))
      .map((item) => suggestion(item.name, methodInsert(item.name), 'function', item.signature, `${item.summary} Risk: ${item.risk}.`)))
  }

  items.push(
    suggestion('db', 'db', 'variable', 'Active MongoDB database'),
    ...BSON_GLOBALS.map((name) => suggestion(name, name, name === 'print' || name === 'printjson' ? 'function' : 'value', 'MongoDB sandbox global')),
    ...OPERATORS.map((operator) => suggestion(operator, operator, 'operator', 'MongoDB operator')),
    ...context.catalog.fields.map((field) => suggestion(field.path ?? field.name, field.path ?? field.name, 'field', field.detail ?? field.dataType)),
    ...MONGO_SCRIPT_CATALOG.map((item) => suggestion(item.signature, item.example(context.connection?.database ?? 'database', collections[0]?.name ?? 'collection'), 'snippet', item.summary)),
  )

  return unique(items)
}

function methodInsert(name: string) {
  return `${name}()`
}

function safeIdentifier(value: string) {
  return /^[A-Za-z_$][\w$]*$/.test(value)
}

function suggestion(
  label: string,
  insertText: string,
  kind: CompletionSuggestion['kind'],
  detail?: string,
  documentation?: string,
): CompletionSuggestion {
  return { label, insertText, kind, detail, documentation }
}

function unique(items: CompletionSuggestion[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.label}:${item.insertText}`.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
