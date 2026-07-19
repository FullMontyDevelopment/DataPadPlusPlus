import type {
  ConnectionProfile,
  QueryBuilderState,
  SqlBuilderValueType,
  SqlSelectBuilderState,
  SqlSelectFilterOperator,
} from '@datapadplusplus/shared-types'

const SQL_OPERATORS: Record<Exclude<SqlSelectFilterOperator, 'is-null' | 'is-not-null'>, string> = {
  eq: '=',
  ne: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  contains: 'like',
  'not-contains': 'not like',
  'starts-with': 'like',
  'not-starts-with': 'not like',
  'ends-with': 'like',
  'not-ends-with': 'not like',
  like: 'like',
  in: 'in',
  'not-in': 'not in',
}

export function createDefaultSqlSelectBuilderState(
  table: string,
  schema?: string,
  limit = 20,
): SqlSelectBuilderState {
  const state: SqlSelectBuilderState = {
    kind: 'sql-select',
    schema,
    table,
    projectionFields: [],
    filters: [],
    filterLogic: 'and',
    sort: [],
    limit,
  }

  return {
    ...state,
    lastAppliedQueryText: buildSqlSelectQueryText(state),
  }
}

export function isSqlSelectBuilderState(
  state: QueryBuilderState | undefined,
): state is SqlSelectBuilderState {
  return state?.kind === 'sql-select'
}

export function buildSqlSelectQueryText(
  state: SqlSelectBuilderState,
  engine: ConnectionProfile['engine'] = 'postgresql',
) {
  const fields = state.projectionFields
    .map((field) => field.field.trim())
    .filter(Boolean)
    .map((field) => quoteSqlPath(field, engine))
  const projection = fields.length > 0 ? fields.join(', ') : '*'
  const table = state.table.trim()

  if (!table) {
    return `select ${projection};`
  }

  const limit = state.limit && state.limit > 0 ? Math.floor(state.limit) : undefined
  const topClause = engine === 'sqlserver' && limit ? ` top ${limit}` : ''
  const clauses = [
    `select${topClause} ${projection}`,
    `from ${quoteSqlTablePath(state, engine)}`,
  ]
  const whereClause = buildSqlWhereClause(state, engine)
  const sortClause = buildSortClause(state, engine)

  if (whereClause) {
    clauses.push(whereClause)
  }

  if (sortClause) {
    clauses.push(sortClause)
  }

  if (engine === 'oracle' && limit) {
    clauses.push(`fetch first ${limit} rows only`)
  } else if (engine !== 'sqlserver' && limit) {
    clauses.push(`limit ${limit}`)
  }

  return `${clauses.join(' ')};`
}

export function parseSqlSelectQueryText(
  queryText: string,
  engine: ConnectionProfile['engine'] = 'postgresql',
): SqlSelectBuilderState | undefined {
  const normalized = stripSqlComments(queryText)
  const target = parseSqlTableReference(normalized)

  if (!target?.table) {
    return undefined
  }

  const projectionFields = projectionFromQuery(normalized).map((field) => ({
    id: sqlBuilderRowId('projection'),
    field,
  }))
  const state: SqlSelectBuilderState = {
    kind: 'sql-select',
    schema: target.schema,
    table: target.table,
    projectionFields,
    filters: [],
    filterLogic: 'and',
    sort: sortFromQuery(normalized),
    limit: limitFromQuery(normalized, engine) ?? 20,
  }

  return {
    ...state,
    lastAppliedQueryText: buildSqlSelectQueryText(state, engine),
  }
}

export function sqlBuilderRowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function buildSqlWhereClause(state: SqlSelectBuilderState, engine: ConnectionProfile['engine']) {
  const predicates = state.filters
    .filter((row) => row.enabled ?? true)
    .map((row) => sqlPredicate(row, engine))
    .filter(Boolean)

  return predicates.length > 0
    ? `where ${predicates.join(` ${state.filterLogic} `)}`
    : ''
}

function sqlPredicate(
  row: SqlSelectBuilderState['filters'][number],
  engine: ConnectionProfile['engine'],
) {
  const field = row.field.trim()

  if (!field) {
    return ''
  }

  const identifier = quoteSqlPath(field, engine)

  if (row.operator === 'is-null') {
    return `${identifier} is null`
  }

  if (row.operator === 'is-not-null') {
    return `${identifier} is not null`
  }

  if (row.operator === 'contains') {
    return `${identifier} like ${sqlStringLiteral(`%${escapeSqlLikeValue(row.value)}%`)} escape '\\'`
  }

  if (row.operator === 'not-contains') {
    return `${identifier} not like ${sqlStringLiteral(`%${escapeSqlLikeValue(row.value)}%`)} escape '\\'`
  }

  if (row.operator === 'starts-with' || row.operator === 'not-starts-with') {
    return `${identifier} ${SQL_OPERATORS[row.operator]} ${sqlStringLiteral(`${escapeSqlLikeValue(row.value)}%`)} escape '\\'`
  }

  if (row.operator === 'ends-with' || row.operator === 'not-ends-with') {
    return `${identifier} ${SQL_OPERATORS[row.operator]} ${sqlStringLiteral(`%${escapeSqlLikeValue(row.value)}`)} escape '\\'`
  }

  const value = sqlLiteral(row.value, row.valueType, row.operator, engine)
  return `${identifier} ${SQL_OPERATORS[row.operator]} ${value}`
}

function buildSortClause(state: SqlSelectBuilderState, engine: ConnectionProfile['engine']) {
  const sort = state.sort
    .map((row) => {
      const field = row.field.trim()
      return field ? `${quoteSqlPath(field, engine)} ${row.direction}` : ''
    })
    .filter(Boolean)

  return sort.length > 0 ? `order by ${sort.join(', ')}` : ''
}

export function quoteSqlTablePath(state: SqlSelectBuilderState, engine: ConnectionProfile['engine']) {
  const schema = state.schema?.trim() || (engine === 'sqlite' ? 'main' : undefined)

  return [schema, state.table]
    .filter((part): part is string => Boolean(part?.trim()))
    .map((part) => quoteSqlIdentifier(part, engine))
    .join('.')
}

function quoteSqlPath(path: string, engine: ConnectionProfile['engine']) {
  if (path === '*') {
    return '*'
  }

  return path
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => quoteSqlIdentifier(part, engine))
    .join('.')
}

function quoteSqlIdentifier(identifier: string, engine: ConnectionProfile['engine']) {
  if (
    identifier.startsWith('"') ||
    identifier.startsWith('`') ||
    identifier.startsWith('[')
  ) {
    return identifier
  }

  if (engine === 'sqlserver' || engine === 'sqlite') {
    return `[${identifier.replaceAll(']', ']]')}]`
  }

  if (engine === 'mysql' || engine === 'mariadb') {
    return `\`${identifier.replaceAll('`', '``')}\``
  }

  return `"${identifier.replaceAll('"', '""')}"`
}

function sqlLiteral(
  value: string,
  valueType: SqlBuilderValueType,
  operator: SqlSelectFilterOperator,
  engine: ConnectionProfile['engine'],
): string {
  if (operator === 'in' || operator === 'not-in') {
    const values: string[] = value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => sqlLiteral(part, valueType, 'eq', engine))

    return `(${values.join(', ') || 'null'})`
  }

  if (valueType === 'null') {
    return 'null'
  }

  if (valueType === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? String(parsed) : 'null'
  }

  if (valueType === 'boolean') {
    const truthy = ['true', '1', 'yes'].includes(value.trim().toLowerCase())

    if (engine === 'mysql' || engine === 'mariadb' || engine === 'oracle') {
      return truthy ? '1' : '0'
    }

    return truthy ? 'true' : 'false'
  }

  return `'${value.replaceAll("'", "''")}'`
}

function sqlStringLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function escapeSqlLikeValue(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('%', '\\%')
    .replaceAll('_', '\\_')
}

function stripSqlComments(queryText: string) {
  return queryText.replace(/--.*$/gm, ' ')
}

function parseSqlTableReference(queryText: string) {
  const fromMatch = /\bfrom\s+(.+?)(?:\s+where\b|\s+order\s+by\b|\s+limit\b|\s+offset\b|\s+fetch\b|;|$)/i.exec(
    queryText,
  )

  if (!fromMatch?.[1]) {
    return undefined
  }

  const reference = tableReferenceFromFromClause(fromMatch[1])
  const identifiers = reference?.match(identifierPattern)?.map(unquoteIdentifier).filter(Boolean)

  if (!identifiers?.length) {
    return undefined
  }

  return {
    schema: identifiers.length > 1 ? identifiers.at(-2) : undefined,
    table: identifiers.at(-1),
  }
}

const identifierPattern = /(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|\[(?:[^\]]|\]\])+\]|[A-Za-z_][\w$-]*)/g

function tableReferenceFromFromClause(fromClause: string) {
  const trimmed = fromClause.trim()

  if (!trimmed || trimmed.startsWith('(')) {
    return undefined
  }

  return /^(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|\[(?:[^\]]|\]\])+\]|[A-Za-z_][\w$-]*)(?:\s*\.\s*(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|\[(?:[^\]]|\]\])+\]|[A-Za-z_][\w$-]*))*/.exec(
    trimmed,
  )?.[0]
}

function projectionFromQuery(queryText: string) {
  const match = /^\s*select\s+(?:top\s+\d+\s+)?(.+?)\s+from\s+/is.exec(queryText)
  const selection = match?.[1]?.trim()

  if (!selection || selection === '*') {
    return []
  }

  return selection
    .split(',')
    .map((part) => unquotePath(part.trim()))
    .filter(Boolean)
}

function sortFromQuery(queryText: string): SqlSelectBuilderState['sort'] {
  const match = /\border\s+by\s+(.+?)(?:\s+limit\b|\s+offset\b|\s+fetch\b|;|$)/i.exec(queryText)

  if (!match?.[1]) {
    return []
  }

  return match[1]
    .split(',')
    .map((part) => {
      const [field = '', direction = 'asc'] = part.trim().split(/\s+/)
      return {
        id: sqlBuilderRowId('sort'),
        field: unquotePath(field),
        direction: direction.toLowerCase() === 'desc' ? 'desc' as const : 'asc' as const,
      }
    })
    .filter((row) => row.field)
}

function limitFromQuery(queryText: string, engine: ConnectionProfile['engine']) {
  const match = engine === 'sqlserver'
    ? /\btop\s+(\d+)/i.exec(queryText)
    : engine === 'oracle'
      ? /\bfetch\s+(?:first|next)\s+(\d+)\s+rows?\s+only/i.exec(queryText) ??
        /\brownum\s*<=\s*(\d+)/i.exec(queryText)
      : /\blimit\s+(\d+)/i.exec(queryText)
  const parsed = Number(match?.[1])
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined
}

function unquotePath(path: string) {
  return path
    .split('.')
    .map((part) => unquoteIdentifier(part.trim()))
    .join('.')
}

function unquoteIdentifier(identifier: string) {
  if (identifier.startsWith('"') && identifier.endsWith('"')) {
    return identifier.slice(1, -1).replace(/""/g, '"')
  }

  if (identifier.startsWith('`') && identifier.endsWith('`')) {
    return identifier.slice(1, -1).replace(/``/g, '`')
  }

  if (identifier.startsWith('[') && identifier.endsWith(']')) {
    return identifier.slice(1, -1).replace(/\]\]/g, ']')
  }

  return identifier
}
