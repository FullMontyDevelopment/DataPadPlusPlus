import type {
  CosmosSqlBuilderState,
  CosmosSqlBuilderValueType,
  CosmosSqlFilterOperator,
  QueryBuilderState,
} from '@datapadplusplus/shared-types'

interface CosmosSqlQueryBuildOptions {
  count?: boolean
}

interface CosmosSqlRequest {
  operation: 'QueryDocuments'
  database?: string
  container: string
  query: string
  parameters: Array<{ name: string; value: unknown }>
  partitionKey?: unknown
  enableCrossPartitionQueries: boolean
  populateQueryMetrics?: boolean
  populateIndexMetrics?: boolean
}

const BINARY_OPERATORS: Record<
  Extract<CosmosSqlFilterOperator, 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'>,
  string
> = {
  eq: '=',
  ne: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

export function createDefaultCosmosSqlBuilderState(
  container = '',
  database?: string,
  limit = 50,
): CosmosSqlBuilderState {
  const state: CosmosSqlBuilderState = {
    kind: 'cosmos-sql',
    database: database?.trim() || undefined,
    container,
    projectionFields: [],
    filters: [],
    filterLogic: 'and',
    sort: [],
    offset: 0,
    limit,
    partitionKeyEnabled: false,
    partitionKeyValue: '',
    partitionKeyValueType: 'string',
    enableCrossPartitionQueries: true,
  }

  return {
    ...state,
    lastAppliedQueryText: buildCosmosSqlQueryText(state),
  }
}

export function isCosmosSqlBuilderState(
  state: QueryBuilderState | undefined,
): state is CosmosSqlBuilderState {
  return state?.kind === 'cosmos-sql'
}

export function buildCosmosSqlQueryText(state: CosmosSqlBuilderState) {
  return JSON.stringify(buildCosmosSqlRequest(state), null, 2)
}

export function buildCosmosSqlCountQueryText(state: CosmosSqlBuilderState) {
  return JSON.stringify(buildCosmosSqlRequest(state, { count: true }), null, 2)
}

export function buildCosmosSqlRequest(
  state: CosmosSqlBuilderState,
  options: CosmosSqlQueryBuildOptions = {},
): CosmosSqlRequest {
  const parameters: CosmosSqlRequest['parameters'] = []
  const query = buildCosmosSqlStatement(state, parameters, options)
  const database = state.database?.trim()
  const request: CosmosSqlRequest = {
    operation: 'QueryDocuments',
    ...(database ? { database } : {}),
    container: state.container.trim(),
    query,
    parameters,
    enableCrossPartitionQueries: state.partitionKeyEnabled
      ? false
      : state.enableCrossPartitionQueries ?? true,
  }

  if (state.partitionKeyEnabled) {
    request.partitionKey = cosmosSqlValue(
      state.partitionKeyValue ?? '',
      state.partitionKeyValueType ?? 'string',
    )
  }

  if (options.count) {
    request.populateQueryMetrics = true
    request.populateIndexMetrics = true
  }

  return request
}

export function parseCosmosSqlQueryText(
  queryText: string,
  context: { database?: string; container?: string } = {},
): CosmosSqlBuilderState | undefined {
  const trimmed = queryText.trim()
  if (!trimmed) {
    return createDefaultCosmosSqlBuilderState(context.container, context.database)
  }

  let request: Record<string, unknown> = {}
  let sql = trimmed
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return undefined
      }
      request = parsed as Record<string, unknown>
      const operation = stringValue(request.operation)?.toLowerCase()
      if (operation && operation !== 'querydocuments' && operation !== 'query') {
        return undefined
      }
      sql = stringValue(request.query) ?? ''
    } catch {
      return undefined
    }
  }

  const shape = simpleCosmosSqlShape(sql)
  if (!shape) {
    return undefined
  }

  const database = stringValue(request.database) ?? context.database
  const container =
    stringValue(request.container) ??
    stringValue(request.containerName) ??
    stringValue(request.collection) ??
    context.container ??
    ''
  const partitionKey = request.partitionKey ?? request.partition_key
  const partitionValue = cosmosSqlDisplayValue(partitionKey)
  const state: CosmosSqlBuilderState = {
    kind: 'cosmos-sql',
    database: database?.trim() || undefined,
    container: container.trim(),
    projectionFields: [],
    filters: [],
    filterLogic: 'and',
    sort: [],
    offset: shape.offset,
    limit: shape.limit,
    partitionKeyEnabled: partitionKey !== undefined,
    partitionKeyValue: partitionValue.value,
    partitionKeyValueType: partitionValue.type,
    enableCrossPartitionQueries:
      typeof request.enableCrossPartitionQueries === 'boolean'
        ? request.enableCrossPartitionQueries
        : true,
    lastAppliedQueryText: queryText,
  }

  return state
}

export function cosmosSqlBuilderRowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function buildCosmosSqlStatement(
  state: CosmosSqlBuilderState,
  parameters: CosmosSqlRequest['parameters'],
  options: CosmosSqlQueryBuildOptions,
) {
  const count = options.count ?? false
  const offset = boundedWholeNumber(state.offset, 0)
  const limit = boundedWholeNumber(state.limit, 50, 1)
  const projection = count
    ? 'VALUE COUNT(1)'
    : cosmosProjection(state)
  const top = !count && offset === 0 && limit > 0 ? ` TOP ${limit}` : ''
  const clauses = [`SELECT${top} ${projection} FROM c`]
  const predicates = state.filters
    .filter((filter) => filter.enabled ?? true)
    .map((filter) => cosmosPredicate(filter, parameters))
    .filter(Boolean)

  if (predicates.length > 0) {
    clauses.push(`WHERE ${predicates.join(state.filterLogic === 'or' ? ' OR ' : ' AND ')}`)
  }

  if (!count) {
    const sort = state.sort
      .map((item) => {
        const field = item.field.trim()
        return field
          ? `${cosmosFieldExpression(field)} ${item.direction === 'desc' ? 'DESC' : 'ASC'}`
          : ''
      })
      .filter(Boolean)
    if (sort.length > 0) {
      clauses.push(`ORDER BY ${sort.join(', ')}`)
    }

    if (offset > 0) {
      clauses.push(`OFFSET ${offset} LIMIT ${limit}`)
    }
  }

  return clauses.join(' ')
}

function cosmosProjection(state: CosmosSqlBuilderState) {
  const fields = state.projectionFields
    .map((item) => item.field.trim())
    .filter(Boolean)
    .map(cosmosFieldExpression)
  return fields.length > 0 ? fields.join(', ') : '*'
}

function cosmosPredicate(
  row: CosmosSqlBuilderState['filters'][number],
  parameters: CosmosSqlRequest['parameters'],
) {
  const field = row.field.trim()
  if (!field) {
    return ''
  }

  const expression = cosmosFieldExpression(field)
  if (row.operator === 'is-null') {
    return `IS_NULL(${expression})`
  }
  if (row.operator === 'is-not-null') {
    return `NOT IS_NULL(${expression})`
  }

  const name = `@p${parameters.length}`
  if (row.operator === 'in' || row.operator === 'not-in') {
    parameters.push({
      name,
      value: cosmosSqlListValue(row.value, row.valueType),
    })
    const predicate = `ARRAY_CONTAINS(${name}, ${expression})`
    return row.operator === 'not-in' ? `NOT ${predicate}` : predicate
  }

  parameters.push({
    name,
    value: cosmosSqlValue(row.value, row.valueType),
  })

  if (row.operator in BINARY_OPERATORS) {
    return `${expression} ${BINARY_OPERATORS[row.operator as keyof typeof BINARY_OPERATORS]} ${name}`
  }
  if (row.operator === 'array-contains') {
    return `ARRAY_CONTAINS(${expression}, ${name})`
  }

  const functions: Record<
    Extract<
      CosmosSqlFilterOperator,
      'contains' | 'not-contains' | 'starts-with' | 'not-starts-with' | 'ends-with' | 'not-ends-with'
    >,
    string
  > = {
    contains: 'CONTAINS',
    'not-contains': 'CONTAINS',
    'starts-with': 'STARTSWITH',
    'not-starts-with': 'STARTSWITH',
    'ends-with': 'ENDSWITH',
    'not-ends-with': 'ENDSWITH',
  }
  const predicate = `${functions[row.operator as keyof typeof functions]}(${expression}, ${name})`
  return row.operator.startsWith('not-') ? `NOT ${predicate}` : predicate
}

function cosmosFieldExpression(path: string) {
  const segments = cosmosFieldSegments(path)
  return segments.reduce((expression, segment) => `${expression}[${JSON.stringify(segment)}]`, 'c')
}

function cosmosFieldSegments(path: string) {
  const source = path.trim().replace(/^c(?=\.|\[)/i, '')
  const segments: string[] = []
  const matcher = /(?:^|\.)([^.[\]]+)|\[("(?:\\.|[^"])*"|'(?:\\.|[^'])*')\]/g
  let match: RegExpExecArray | null

  while ((match = matcher.exec(source))) {
    if (match[1]) {
      segments.push(match[1].trim())
      continue
    }
    const quoted = match[2]
    if (!quoted) continue
    try {
      segments.push(
        quoted.startsWith('"')
          ? JSON.parse(quoted) as string
          : quoted.slice(1, -1).replaceAll("\\'", "'").replaceAll('\\\\', '\\'),
      )
    } catch {
      segments.push(quoted.slice(1, -1))
    }
  }

  return segments.filter(Boolean).length > 0 ? segments.filter(Boolean) : [path.trim()]
}

function cosmosSqlListValue(value: string, valueType: CosmosSqlBuilderValueType) {
  if (valueType === 'json') {
    const parsed = parseJson(value)
    return Array.isArray(parsed) ? parsed : [parsed]
  }
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => cosmosSqlValue(item, valueType))
}

function cosmosSqlValue(value: string, valueType: CosmosSqlBuilderValueType): unknown {
  if (valueType === 'null') return null
  if (valueType === 'boolean') {
    return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())
  }
  if (valueType === 'number') {
    const number = Number(value)
    return Number.isFinite(number) ? number : null
  }
  if (valueType === 'json') return parseJson(value)
  return value
}

function parseJson(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function simpleCosmosSqlShape(sql: string) {
  if (/\bwhere\b|\border\s+by\b/i.test(sql)) {
    return undefined
  }
  const top = /^\s*select\s+top\s+(\d+)\s+\*\s+from\s+c\s*;?\s*$/i.exec(sql)
  if (top?.[1]) {
    return { offset: 0, limit: Number(top[1]) }
  }
  const paged = /^\s*select\s+\*\s+from\s+c(?:\s+offset\s+(\d+)\s+limit\s+(\d+))?\s*;?\s*$/i.exec(sql)
  if (!paged) return undefined
  return {
    offset: Number(paged[1] ?? 0),
    limit: Number(paged[2] ?? 50),
  }
}

function cosmosSqlDisplayValue(value: unknown): {
  value: string
  type: CosmosSqlBuilderValueType
} {
  if (value === undefined) return { value: '', type: 'string' }
  if (value === null) return { value: '', type: 'null' }
  if (typeof value === 'string') return { value, type: 'string' }
  if (typeof value === 'number') return { value: String(value), type: 'number' }
  if (typeof value === 'boolean') return { value: String(value), type: 'boolean' }
  return { value: JSON.stringify(value), type: 'json' }
}

function boundedWholeNumber(value: number | undefined, fallback: number, minimum = 0) {
  return Number.isFinite(value) ? Math.max(minimum, Math.floor(value as number)) : fallback
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
