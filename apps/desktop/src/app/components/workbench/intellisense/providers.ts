import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { variableDefinitionsForEnvironment } from '../../../state/environment-variables'
import type {
  CompletionField,
  CompletionItemKind,
  CompletionObject,
  CompletionSuggestion,
  DatastoreCompletionProvider,
  EditorCompletionContext,
} from './types'
import { buildMongoItems } from './mongo-provider'
import { buildCockroachSqlItems } from './cockroach-provider'
import { buildDynamoDbItems } from './dynamodb-provider'
import { buildMySqlItems, quoteMySqlIdentifier } from './mysql-provider'
import { buildOracleSqlItems, quoteOracleIdentifier } from './oracle-provider'
import { buildPostgresSqlItems, quotePostgresIdentifier } from './postgres-provider'
import { buildRedisItems } from './redis-provider'
import { SECONDARY_COMPLETION_PROVIDERS } from './secondary-providers'

const SQL_ENGINES: Array<ConnectionProfile['engine']> = [
  'postgresql',
  'cockroachdb',
  'sqlserver',
  'mysql',
  'mariadb',
  'sqlite',
  'timescaledb',
  'oracle',
  'duckdb',
  'clickhouse',
  'snowflake',
  'bigquery',
]

const SQL_KEYWORDS = [
  'select',
  'from',
  'where',
  'join',
  'left join',
  'inner join',
  'group by',
  'order by',
  'limit',
  'offset',
  'insert into',
  'update',
  'delete from',
  'create table',
  'alter table',
  'explain',
]

const SQL_FUNCTIONS = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'coalesce',
  'date_trunc',
  'current_timestamp',
]

const SEARCH_KEYS = [
  'index',
  'body',
  'query',
  'bool',
  'must',
  'filter',
  'match',
  'term',
  'range',
  'exists',
  'aggs',
  'size',
  'sort',
  '_source',
]

const CQL_KEYWORDS = [
  'select',
  'from',
  'where',
  'and',
  'limit',
  'allow filtering',
  'insert into',
  'update',
  'delete from',
  'create table',
  'create index',
]

export const ENVIRONMENT_VARIABLE_COMPLETION_PROVIDER: DatastoreCompletionProvider =
  {
    id: 'environment-variables',
    languages: [
      'sql',
      'json',
      'javascript',
      'typescript',
      'plaintext',
      'redis',
    ],
    buildItems: buildEnvironmentVariableItems,
  }

export const DEFAULT_COMPLETION_PROVIDERS: DatastoreCompletionProvider[] = [
  {
    id: 'sql',
    engines: SQL_ENGINES,
    languages: ['sql'],
    buildItems: buildSqlItems,
  },
  {
    id: 'mongodb',
    engines: ['mongodb'],
    languages: ['json'],
    buildItems: buildMongoItems,
  },
  {
    id: 'redis',
    engines: ['redis', 'valkey'],
    languages: ['plaintext', 'redis'],
    buildItems: buildRedisItems,
  },
  {
    id: 'search',
    engines: ['elasticsearch', 'opensearch'],
    languages: ['json'],
    buildItems: buildSearchItems,
  },
  {
    id: 'dynamodb',
    engines: ['dynamodb'],
    languages: ['json', 'sql'],
    buildItems: buildDynamoDbItems,
  },
  {
    id: 'cassandra',
    engines: ['cassandra'],
    languages: ['sql'],
    buildItems: buildCassandraItems,
  },
  ...SECONDARY_COMPLETION_PROVIDERS,
]

export function completionProvidersForConnection(
  connection: ConnectionProfile | undefined,
  language: string,
) {
  if (!connection) {
    return []
  }

  return DEFAULT_COMPLETION_PROVIDERS.filter((provider) => {
    const engineMatches =
      !provider.engines || provider.engines.includes(connection.engine)
    const familyMatches =
      !provider.families || provider.families.includes(connection.family)
    const languageMatches = provider.languages.includes(language)

    return engineMatches && familyMatches && languageMatches
  })
}

function buildSqlItems(
  context: EditorCompletionContext,
): CompletionSuggestion[] {
  const aliasTarget = aliasBeforeCursor(context.queryText, context.cursorOffset)
  const aliasMap = parseSqlAliases(context.queryText, context.catalog.objects)
  const aliasedObject = aliasTarget
    ? aliasMap.get(aliasTarget.toLowerCase())
    : undefined
  const prefix = currentTokenPrefix(context.queryText, context.cursorOffset)
  const sourceObjects = context.catalog.objects.filter((object) =>
    ['table', 'view', 'materialized-view'].includes(object.kind),
  )

  const columns = aliasedObject
    ? fieldsForObject(context.catalog.fields, aliasedObject)
    : context.catalog.fields

  return uniqueSuggestions([
    ...sqlKeywordsForContext(context).map((keyword) => suggestion(keyword, keyword, 'keyword')),
    ...sqlFunctionsForContext(context).map((fn) => suggestion(fn, `${fn}()`, 'function')),
    ...(isPostgresCompletionContext(context)
      ? buildPostgresSqlItems(context)
      : []),
    ...(isCockroachCompletionContext(context)
      ? buildCockroachSqlItems(context)
      : []),
    ...(isMySqlCompletionContext(context) ? buildMySqlItems(context) : []),
    ...(context.connection?.engine === 'oracle' ? buildOracleSqlItems(context) : []),
    ...context.catalog.schemas.map((schema) =>
      suggestion(
        schema.name,
        quoteSqlIdentifier(schema.name, context.connection),
        'schema',
        schema.detail,
      ),
    ),
    ...sourceObjects.map((object) =>
      suggestion(
        objectLabel(object),
        qualifiedSqlObject(object, context.connection),
        object.kind === 'view' ? 'view' : 'table',
        object.detail,
      ),
    ),
    ...columns.map((field) =>
      suggestion(
        field.path ?? field.name,
        quoteSqlIdentifier(field.name, context.connection),
        'field',
        field.detail ?? field.dataType,
      ),
    ),
    ...objectsForSchemaPrefix(sourceObjects, prefix, context.connection),
  ])
}

function sqlKeywordsForContext(context: EditorCompletionContext) {
  return context.connection?.engine === 'oracle'
    ? SQL_KEYWORDS.filter((keyword) => keyword !== 'limit' && keyword !== 'offset')
    : SQL_KEYWORDS
}

function sqlFunctionsForContext(context: EditorCompletionContext) {
  return context.connection?.engine === 'oracle'
    ? SQL_FUNCTIONS.filter((fn) => fn !== 'date_trunc')
    : SQL_FUNCTIONS
}

function isPostgresCompletionContext(context: EditorCompletionContext) { return context.connection?.engine === 'postgresql' }

function isCockroachCompletionContext(context: EditorCompletionContext) { return context.connection?.engine === 'cockroachdb' }

function isMySqlCompletionContext(context: EditorCompletionContext) {
  return ['mysql', 'mariadb'].includes(context.connection?.engine ?? '')
}

function buildEnvironmentVariableItems(
  context: EditorCompletionContext,
): CompletionSuggestion[] {
  if (
    !context.environment ||
    !isInsideVariableToken(context.queryText, context.cursorOffset)
  ) {
    return []
  }

  return variableDefinitionsForEnvironment(context.environment).map(
    (definition) =>
      suggestion(
        definition.key,
        `${definition.key}}}`,
        'variable',
        definition.kind === 'secret'
          ? 'secret environment variable'
          : 'environment variable',
        definition.kind === 'secret'
          ? 'Resolved only when used. The value is never shown in the editor.'
          : undefined,
      ),
  )
}

function buildSearchItems(
  context: EditorCompletionContext,
): CompletionSuggestion[] {
  const indexes = context.catalog.objects.filter((object) =>
    ['index', 'data-stream'].includes(object.kind),
  )

  return uniqueSuggestions([
    ...SEARCH_KEYS.map((key) => jsonPropertySuggestion(key)),
    ...indexes.map((index) =>
      suggestion(index.name, JSON.stringify(index.name), 'index', index.detail),
    ),
    ...context.catalog.fields.map((field) =>
      suggestion(
        field.path ?? field.name,
        `${JSON.stringify(field.path ?? field.name)}: `,
        'field',
        field.detail ?? field.dataType,
      ),
    ),
    suggestion('match all query', '"query": { "match_all": {} }', 'snippet'),
    suggestion(
      'terms aggregation',
      '"aggs": { "by_field": { "terms": { "field": "" } } }',
      'snippet',
    ),
  ])
}

function buildCassandraItems(
  context: EditorCompletionContext,
): CompletionSuggestion[] {
  const tables = context.catalog.objects.filter(
    (object) => object.kind === 'table',
  )

  return uniqueSuggestions([
    ...CQL_KEYWORDS.map((keyword) => suggestion(keyword, keyword, 'keyword')),
    ...context.catalog.schemas.map((schema) =>
      suggestion(schema.name, schema.name, 'schema', schema.detail),
    ),
    ...tables.map((table) =>
      suggestion(
        objectLabel(table),
        qualifiedCqlObject(table),
        'table',
        table.detail,
      ),
    ),
    ...context.catalog.fields.map((field) =>
      suggestion(
        field.path ?? field.name,
        field.name,
        'field',
        field.primary
          ? `${field.detail ?? field.dataType ?? 'Column'} / partition-key friendly`
          : (field.detail ?? field.dataType),
      ),
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

function isInsideVariableToken(
  queryText: string,
  cursorOffset = queryText.length,
) {
  const beforeCursor = queryText.slice(0, cursorOffset)
  const lastOpen = beforeCursor.lastIndexOf('{{')

  if (lastOpen < 0) {
    return false
  }

  const lastClose = beforeCursor.lastIndexOf('}}')

  return (
    lastClose < lastOpen &&
    /^[A-Z0-9_]*$/.test(beforeCursor.slice(lastOpen + 2))
  )
}

function jsonPropertySuggestion(
  key: string,
  kind: CompletionItemKind = 'keyword',
): CompletionSuggestion {
  return suggestion(key, `${JSON.stringify(key)}: `, kind)
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

function quoteSqlIdentifier(
  identifier: string,
  connection?: ConnectionProfile,
) {
  if (!connection) {
    return identifier
  }

  if (connection.engine === 'sqlserver') {
    return `[${identifier.replaceAll(']', ']]')}]`
  }

  if (['postgresql', 'cockroachdb', 'timescaledb'].includes(connection.engine)) {
    return quotePostgresIdentifier(identifier)
  }

  if (connection.engine === 'oracle') {
    return quoteOracleIdentifier(identifier)
  }

  return connection.engine === 'mysql' || connection.engine === 'mariadb'
    ? quoteMySqlIdentifier(identifier)
    : identifier
}

function qualifiedSqlObject(
  object: CompletionObject,
  connection?: ConnectionProfile,
) {
  const objectName = quoteSqlIdentifier(object.name, connection)

  if (!object.schema) {
    return objectName
  }

  return `${quoteSqlIdentifier(object.schema, connection)}.${objectName}`
}

function qualifiedCqlObject(object: CompletionObject) {
  return object.schema ? `${object.schema}.${object.name}` : object.name
}

function objectLabel(object: CompletionObject) {
  return object.schema ? `${object.schema}.${object.name}` : object.name
}

function objectsForSchemaPrefix(
  objects: CompletionObject[],
  prefix: string,
  connection?: ConnectionProfile,
) {
  const [schemaPrefix, objectPrefix] = prefix.split('.')

  if (!schemaPrefix || objectPrefix === undefined) {
    return []
  }

  return objects
    .filter(
      (object) => object.schema?.toLowerCase() === schemaPrefix.toLowerCase(),
    )
    .map((object) =>
      suggestion(
        object.name,
        quoteSqlIdentifier(object.name, connection),
        'table',
        object.detail,
      ),
    )
}

function currentTokenPrefix(
  queryText: string,
  cursorOffset = queryText.length,
) {
  const beforeCursor = queryText.slice(0, cursorOffset)
  const match = beforeCursor.match(/[`"[\]\w.]+$/)

  return (
    match?.[0]
      ?.replaceAll('[', '')
      .replaceAll(']', '')
      .replaceAll('"', '')
      .replaceAll('`', '') ??
    ''
  )
}

function aliasBeforeCursor(queryText: string, cursorOffset = queryText.length) {
  const beforeCursor = queryText.slice(0, cursorOffset)
  const match = beforeCursor.match(/([A-Za-z_][\w]*)\.$/)

  return match?.[1]
}

function parseSqlAliases(queryText: string, objects: CompletionObject[]) {
  const aliases = new Map<string, CompletionObject>()
  const objectByName = new Map<string, CompletionObject>()

  for (const object of objects) {
    objectByName.set(object.name.toLowerCase(), object)
    if (object.schema) {
      objectByName.set(`${object.schema}.${object.name}`.toLowerCase(), object)
    }
  }

  const aliasPattern =
    /\b(?:from|join)\s+((?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|\[(?:[^\]]|\]\])+\]|\w+)(?:\.(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|\[(?:[^\]]|\]\])+\]|\w+))?)\s+(?:as\s+)?(\w+)/gi
  let match: RegExpExecArray | null

  while ((match = aliasPattern.exec(queryText)) !== null) {
    const rawObject = match[1]
    const alias = match[2]

    if (!rawObject || !alias) {
      continue
    }

    const object = objectByName.get(cleanSqlIdentifier(rawObject).toLowerCase())

    if (object) {
      aliases.set(alias.toLowerCase(), object)
    }
  }

  return aliases
}

function cleanSqlIdentifier(identifier: string) {
  return identifier
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replaceAll('"', '')
    .replaceAll('`', '')
}

function fieldsForObject(fields: CompletionField[], object: CompletionObject) {
  return fields.filter((field) => {
    if (!field.objectName) {
      return true
    }

    const objectMatches =
      field.objectName.toLowerCase() === object.name.toLowerCase()
    const schemaMatches =
      !field.schema ||
      !object.schema ||
      field.schema.toLowerCase() === object.schema.toLowerCase()

    return objectMatches && schemaMatches
  })
}
