import type {
  CosmosSqlBuilderState,
  CosmosSqlBuilderValueType,
  CosmosSqlFilterOperator,
  CosmosSqlExecutionInput,
  CosmosSqlQueryEditorParameter,
  CosmosSqlQueryEditorState,
  QueryBuilderState,
} from '@datapadplusplus/shared-types'
import { parseQueryBuilderValue } from './query-value-codec'

interface CosmosSqlQueryBuildOptions {
  count?: boolean
}

export interface CosmosSqlRequest {
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

export function buildCosmosSqlStatementText(state: CosmosSqlBuilderState) {
  return buildCosmosSqlRequest(state).query
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

export function buildCosmosSqlStatement(
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

export function createCosmosSqlQueryEditorState(
  queryText: string,
  builderState: CosmosSqlBuilderState,
): CosmosSqlQueryEditorState {
  const persisted = builderState.editorState
  if (persisted?.kind === 'cosmos-sql') {
    return normalizeCosmosSqlQueryEditorState(persisted)
  }

  const legacy = parseCosmosSqlEnvelope(queryText)
  if (legacy) {
    return {
      kind: 'cosmos-sql',
      sql: legacy.query,
      parameters: legacy.parameters.map((parameter, index) =>
        editorParameterFromValue(parameter.name, parameter.value, `legacy-${index}`),
      ),
      partitionKeyEnabled: Object.prototype.hasOwnProperty.call(legacy, 'partitionKey'),
      partitionKeyValue: cosmosSqlDisplayValue(legacy.partitionKey).value,
      partitionKeyValueType: cosmosSqlDisplayValue(legacy.partitionKey).type,
      enableCrossPartitionQueries: legacy.enableCrossPartitionQueries,
      source: 'default',
    }
  }

  const trimmed = queryText.trim()
  return {
    kind: 'cosmos-sql',
    sql: trimmed && !trimmed.startsWith('{')
      ? trimmed
      : buildCosmosSqlStatementText(builderState),
    parameters: [],
    partitionKeyEnabled: false,
    partitionKeyValue: '',
    partitionKeyValueType: 'string',
    enableCrossPartitionQueries: true,
    source: 'default',
  }
}

export function cosmosSqlEditorStateFromBuilder(
  builderState: CosmosSqlBuilderState,
): CosmosSqlQueryEditorState {
  const request = buildCosmosSqlRequest(builderState)
  const parameterTypes = builderState.filters
    .filter((filter) =>
      (filter.enabled ?? true) &&
      Boolean(filter.field.trim()) &&
      !['is-null', 'is-not-null', 'has-items', 'has-no-items', 'has-length'].includes(filter.operator),
    )
    .map((filter) => filter.operator === 'in' || filter.operator === 'not-in' ? 'json' : filter.valueType)
  return {
    kind: 'cosmos-sql',
    sql: request.query,
    parameters: request.parameters.map((parameter, index) =>
      editorParameterFromValue(parameter.name, parameter.value, `builder-${index}`, parameterTypes[index]),
    ),
    partitionKeyEnabled: Object.prototype.hasOwnProperty.call(request, 'partitionKey'),
    partitionKeyValue: cosmosSqlDisplayValue(request.partitionKey).value,
    partitionKeyValueType: builderState.partitionKeyValueType ?? cosmosSqlDisplayValue(request.partitionKey).type,
    enableCrossPartitionQueries: request.enableCrossPartitionQueries,
    source: 'builder',
  }
}

export interface CosmosSqlEditorValidation {
  input?: CosmosSqlExecutionInput
  errors: string[]
  warnings: string[]
}

export function validateCosmosSqlEditorState(
  state: CosmosSqlQueryEditorState,
  context: { database?: string; container?: string },
  selectedSql?: string,
): CosmosSqlEditorValidation {
  const sql = (selectedSql?.trim() || state.sql.trim())
  const errors: string[] = []
  const warnings: string[] = []
  const container = context.container?.trim() ?? ''

  if (!sql) {
    errors.push('Enter a Cosmos DB query before running it.')
  } else if (!isSingleCosmosQueryStatement(sql)) {
    errors.push('Cosmos Query Editor accepts one read-only SELECT statement.')
  }
  if (!container) {
    errors.push('Select a Cosmos DB container before running the query.')
  }

  const names = new Set<string>()
  const parameters: Array<{
    name: string
    value: unknown
    valueType?: CosmosSqlBuilderValueType
  }> = []
  for (const parameter of state.parameters) {
    const name = parameter.name.trim()
    if (!/^@[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      errors.push(`Parameter "${name || '(empty)'}" must start with @ and contain only letters, numbers, or underscores.`)
      continue
    }
    const normalizedName = name.toLowerCase()
    if (names.has(normalizedName)) {
      errors.push(`Parameter ${name} is defined more than once.`)
      continue
    }
    names.add(normalizedName)
    const parsed = parseCosmosTypedValue(parameter.value, parameter.valueType)
    if (!parsed.ok) {
      errors.push(`${name}: ${parsed.error}`)
      continue
    }
    parameters.push({ name, value: parsed.value, valueType: parameter.valueType })
  }

  const referencedNames = cosmosSqlReferencedParameters(sql)
  for (const name of referencedNames) {
    if (!names.has(name.toLowerCase())) {
      errors.push(`Query parameter ${name} does not have a binding.`)
    }
  }
  for (const parameter of parameters) {
    if (!referencedNames.some((name) => name.toLowerCase() === parameter.name.toLowerCase())) {
      warnings.push(`Parameter ${parameter.name} is not referenced by the query.`)
    }
  }

  let partitionKey: unknown
  if (state.partitionKeyEnabled) {
    const parsed = parseCosmosTypedValue(
      state.partitionKeyValue ?? '',
      state.partitionKeyValueType ?? 'string',
    )
    if (!parsed.ok) {
      errors.push(`Partition key: ${parsed.error}`)
    } else {
      partitionKey = parsed.value
    }
  } else if (state.enableCrossPartitionQueries ?? true) {
    warnings.push('Cross-partition execution can fan out across physical partitions and consume more RUs.')
  }

  return {
    errors,
    warnings,
    input: errors.length > 0
      ? undefined
      : {
          kind: 'cosmos-sql',
          database: context.database?.trim() || undefined,
          container,
          sql,
          parameters,
          ...(state.partitionKeyEnabled ? { partitionKey } : {}),
          ...(state.partitionKeyEnabled
            ? { partitionKeyValueType: state.partitionKeyValueType ?? 'string' }
            : {}),
          enableCrossPartitionQueries: state.partitionKeyEnabled
            ? false
            : state.enableCrossPartitionQueries ?? true,
        },
  }
}

export function normalizeCosmosSqlQueryEditorState(
  state: CosmosSqlQueryEditorState,
): CosmosSqlQueryEditorState {
  return {
    kind: 'cosmos-sql',
    sql: typeof state.sql === 'string' ? state.sql : '',
    parameters: Array.isArray(state.parameters)
      ? state.parameters.map((parameter, index) => ({
          id: parameter.id || `parameter-${index}`,
          name: typeof parameter.name === 'string' ? parameter.name : '',
          valueType: isCosmosValueType(parameter.valueType) ? parameter.valueType : 'string',
          value: typeof parameter.value === 'string' ? parameter.value : '',
        }))
      : [],
    partitionKeyEnabled: Boolean(state.partitionKeyEnabled),
    partitionKeyValue: typeof state.partitionKeyValue === 'string' ? state.partitionKeyValue : '',
    partitionKeyValueType: isCosmosValueType(state.partitionKeyValueType)
      ? state.partitionKeyValueType
      : 'string',
    enableCrossPartitionQueries: state.enableCrossPartitionQueries ?? true,
    source: state.source === 'builder' || state.source === 'custom' ? state.source : 'default',
  }
}

function parseCosmosSqlEnvelope(queryText: string): CosmosSqlRequest | undefined {
  const trimmed = queryText.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const request = JSON.parse(trimmed) as Record<string, unknown>
    const operation = stringValue(request.operation)?.toLowerCase()
    const query = stringValue(request.query)
    const container =
      stringValue(request.container) ??
      stringValue(request.containerName) ??
      stringValue(request.collection)
    if ((operation && operation !== 'querydocuments' && operation !== 'query') || !query || !container) {
      return undefined
    }
    const rawParameters = Array.isArray(request.parameters) ? request.parameters : []
    return {
      operation: 'QueryDocuments',
      database: stringValue(request.database),
      container,
      query,
      parameters: rawParameters.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const value = item as Record<string, unknown>
        const name = stringValue(value.name)
        return name ? [{ name, value: value.value }] : []
      }),
      ...(Object.prototype.hasOwnProperty.call(request, 'partitionKey')
        ? { partitionKey: request.partitionKey }
        : {}),
      enableCrossPartitionQueries:
        typeof request.enableCrossPartitionQueries === 'boolean'
          ? request.enableCrossPartitionQueries
          : true,
    }
  } catch {
    return undefined
  }
}

function editorParameterFromValue(
  name: string,
  value: unknown,
  id: string,
  preferredType?: CosmosSqlBuilderValueType,
): CosmosSqlQueryEditorParameter {
  const display = cosmosSqlDisplayValue(value)
  return {
    id,
    name,
    value: display.value,
    valueType: preferredType ?? display.type,
  }
}

function parseCosmosTypedValue(
  value: string,
  type: CosmosSqlBuilderValueType,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return {
      ok: true,
      value: parseQueryBuilderValue(value, type, { allowEnvironmentToken: true }),
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Enter a valid value.' }
  }
}

function isSingleCosmosQueryStatement(sql: string) {
  const withoutComments = sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--.*$/gm, ' ')
    .trim()
  const withoutTrailingSemicolon = withoutComments.replace(/;\s*$/, '').trim()
  return /^select\b/i.test(withoutTrailingSemicolon) && !withoutTrailingSemicolon.includes(';')
}

function cosmosSqlReferencedParameters(sql: string) {
  return Array.from(new Set(sql.match(/@[A-Za-z_][A-Za-z0-9_]*/g) ?? []))
}

function isCosmosValueType(value: unknown): value is CosmosSqlBuilderValueType {
  return value === 'string' ||
    value === 'number' ||
    value === 'boolean' ||
    value === 'null' ||
    value === 'json' ||
    value === 'date' ||
    value === 'uuid'
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
  if (row.operator === 'has-items') {
    return `IS_ARRAY(${expression}) AND ARRAY_LENGTH(${expression}) > 0`
  }
  if (row.operator === 'has-no-items') {
    return `IS_ARRAY(${expression}) AND ARRAY_LENGTH(${expression}) = 0`
  }
  if (row.operator === 'has-length') {
    const length = parseQueryBuilderValue(row.value, 'number', { operator: row.operator })
    return `IS_ARRAY(${expression}) AND ARRAY_LENGTH(${expression}) = ${length}`
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
  return parseQueryBuilderValue(value, valueType, { operator: 'in' })
}

function cosmosSqlValue(value: string, valueType: CosmosSqlBuilderValueType): unknown {
  return parseQueryBuilderValue(value, valueType, { allowEnvironmentToken: true })
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
