import type {
  DynamoDbBuilderValueType,
  DynamoDbConditionOperator,
  DynamoDbConditionRow,
  DynamoDbKeyConditionBuilderState,
  QueryBuilderState,
} from '@datapadplusplus/shared-types'

const COMPARISON_OPERATORS: Record<
  Extract<DynamoDbConditionOperator, 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte'>,
  string
> = {
  eq: '=',
  ne: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
}

export function createDefaultDynamoDbKeyConditionBuilderState(
  table = '',
  limit = 20,
): DynamoDbKeyConditionBuilderState {
  const state: DynamoDbKeyConditionBuilderState = {
    kind: 'dynamodb-key-condition',
    table,
    partitionKey: newDynamoDbCondition('pk', 'eq'),
    filters: [],
    projectionFields: [],
    consistentRead: false,
    limit,
  }

  return {
    ...state,
    lastAppliedQueryText: buildDynamoDbKeyConditionQueryText(state),
  }
}

export function isDynamoDbKeyConditionBuilderState(
  state: QueryBuilderState | undefined,
): state is DynamoDbKeyConditionBuilderState {
  return state?.kind === 'dynamodb-key-condition'
}

export function buildDynamoDbKeyConditionQueryText(
  state: DynamoDbKeyConditionBuilderState,
) {
  const expression = new DynamoExpressionBuilder()
  const body: Record<string, unknown> = {
    operation: hasPartitionKey(state) ? 'Query' : 'Scan',
    tableName: state.table.trim(),
  }

  if (state.indexName?.trim()) {
    body.indexName = state.indexName.trim()
  }

  const keyCondition = buildKeyConditionExpression(state, expression)
  if (keyCondition) {
    body.keyConditionExpression = keyCondition
  }

  const filterExpression = buildFilterExpression(state, expression)
  if (filterExpression) {
    body.filterExpression = filterExpression
  }

  const projectionExpression = buildProjectionExpression(state, expression)
  if (projectionExpression) {
    body.projectionExpression = projectionExpression
  }

  if (state.consistentRead) {
    body.consistentRead = true
  }

  if (state.limit && state.limit > 0) {
    body.limit = Math.floor(state.limit)
  }

  const names = expression.names()
  const values = expression.values()
  if (Object.keys(names).length > 0) {
    body.expressionAttributeNames = names
  }
  if (Object.keys(values).length > 0) {
    body.expressionAttributeValues = values
  }

  return JSON.stringify(body, null, 2)
}

export function parseDynamoDbKeyConditionQueryText(
  queryText: string,
): DynamoDbKeyConditionBuilderState | undefined {
  try {
    const parsed = JSON.parse(queryText) as Record<string, unknown>
    const table = stringField(parsed, 'tableName') ?? stringField(parsed, 'TableName') ?? ''
    const state: DynamoDbKeyConditionBuilderState = {
      kind: 'dynamodb-key-condition',
      table,
      indexName: stringField(parsed, 'indexName') ?? stringField(parsed, 'IndexName'),
      partitionKey: parsePartitionKey(parsed),
      sortKey: undefined,
      filters: [],
      projectionFields: projectionFields(parsed),
      consistentRead: Boolean(parsed.consistentRead ?? parsed.ConsistentRead),
      limit: numberField(parsed, 'limit') ?? numberField(parsed, 'Limit') ?? 20,
    }

    return {
      ...state,
      lastAppliedQueryText: buildDynamoDbKeyConditionQueryText(state),
    }
  } catch {
    return undefined
  }
}

export function dynamoDbBuilderRowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function newDynamoDbCondition(
  field = '',
  operator: DynamoDbConditionOperator = 'eq',
): DynamoDbConditionRow {
  return {
    id: dynamoDbBuilderRowId('ddb-condition'),
    enabled: true,
    field,
    operator,
    value: '',
    valueType: 'string',
  }
}

function buildKeyConditionExpression(
  state: DynamoDbKeyConditionBuilderState,
  expression: DynamoExpressionBuilder,
) {
  if (!hasPartitionKey(state)) {
    return ''
  }

  const predicates = [
    expression.condition({ ...state.partitionKey, operator: 'eq' }),
    state.sortKey ? expression.condition(state.sortKey) : '',
  ].filter(Boolean)

  return predicates.join(' and ')
}

function buildFilterExpression(
  state: DynamoDbKeyConditionBuilderState,
  expression: DynamoExpressionBuilder,
) {
  return state.filters
    .filter((row) => row.enabled ?? true)
    .map((row) => expression.condition(row))
    .filter(Boolean)
    .join(' and ')
}

function buildProjectionExpression(
  state: DynamoDbKeyConditionBuilderState,
  expression: DynamoExpressionBuilder,
) {
  return state.projectionFields
    .map((row) => row.field.trim())
    .filter(Boolean)
    .map((field) => expression.name(field))
    .join(', ')
}

function hasPartitionKey(state: DynamoDbKeyConditionBuilderState) {
  return Boolean(state.partitionKey.field.trim() && state.partitionKey.value.trim())
}

class DynamoExpressionBuilder {
  private nameByField = new Map<string, string>()
  private nameValues: Record<string, string> = {}
  private valueValues: Record<string, unknown> = {}
  private nextName = 0
  private nextValue = 0

  name(field: string) {
    const key = field.trim()
    const existing = this.nameByField.get(key)
    if (existing) {
      return existing
    }

    const token = `#n${this.nextName}`
    this.nextName += 1
    this.nameByField.set(key, token)
    this.nameValues[token] = key
    return token
  }

  value(value: string, type: DynamoDbBuilderValueType) {
    const token = `:v${this.nextValue}`
    this.nextValue += 1
    this.valueValues[token] = toAttributeValue(value, type)
    return token
  }

  condition(row: DynamoDbConditionRow) {
    const field = row.field.trim()
    if (!field || row.enabled === false) {
      return ''
    }

    const name = this.name(field)
    if (row.operator === 'exists') {
      return `attribute_exists(${name})`
    }
    if (row.operator === 'does-not-exist') {
      return `attribute_not_exists(${name})`
    }

    const value = this.value(row.value, row.valueType)
    if (row.operator === 'begins-with') {
      return `begins_with(${name}, ${value})`
    }
    if (row.operator === 'contains') {
      return `contains(${name}, ${value})`
    }
    if (row.operator === 'not-contains') {
      return `not contains(${name}, ${value})`
    }
    if (row.operator === 'between') {
      const second = this.value(row.secondValue ?? '', row.valueType)
      return `${name} between ${value} and ${second}`
    }

    return `${name} ${COMPARISON_OPERATORS[row.operator]} ${value}`
  }

  names() {
    return this.nameValues
  }

  values() {
    return this.valueValues
  }
}

function toAttributeValue(value: string, type: DynamoDbBuilderValueType): unknown {
  if (type === 'null') {
    return { NULL: true }
  }
  if (type === 'boolean') {
    return { BOOL: ['true', '1', 'yes'].includes(value.trim().toLowerCase()) }
  }
  if (type === 'number') {
    return { N: Number.isFinite(Number(value)) ? String(Number(value)) : '0' }
  }
  if (type === 'json') {
    return jsonToAttributeValue(parseJson(value))
  }
  return { S: value }
}

function jsonToAttributeValue(value: unknown): unknown {
  if (value === null) {
    return { NULL: true }
  }
  if (Array.isArray(value)) {
    return { L: value.map(jsonToAttributeValue) }
  }
  if (typeof value === 'object') {
    return {
      M: Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          jsonToAttributeValue(item),
        ]),
      ),
    }
  }
  if (typeof value === 'number') {
    return { N: String(value) }
  }
  if (typeof value === 'boolean') {
    return { BOOL: value }
  }
  return { S: String(value) }
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function parsePartitionKey(parsed: Record<string, unknown>) {
  const names = objectField(parsed, 'expressionAttributeNames') ?? objectField(parsed, 'ExpressionAttributeNames')
  const values = objectField(parsed, 'expressionAttributeValues') ?? objectField(parsed, 'ExpressionAttributeValues')
  const expression = String(parsed.keyConditionExpression ?? parsed.KeyConditionExpression ?? '')
  const match = /(#[\w]+|[\w.]+)\s*=\s*(:[\w]+)/.exec(expression)
  const fieldToken = match?.[1]
  const valueToken = match?.[2]
  const field = fieldToken && names?.[fieldToken] ? String(names[fieldToken]) : fieldToken ?? 'pk'
  const rawValue = valueToken && values?.[valueToken] ? attributeValueToString(values[valueToken]) : ''

  return {
    ...newDynamoDbCondition(field, 'eq'),
    value: rawValue,
  }
}

function projectionFields(parsed: Record<string, unknown>) {
  const expression = String(parsed.projectionExpression ?? parsed.ProjectionExpression ?? '')
  const names = objectField(parsed, 'expressionAttributeNames') ?? objectField(parsed, 'ExpressionAttributeNames')
  return expression
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((field) => ({
      id: dynamoDbBuilderRowId('ddb-projection'),
      field: names?.[field] ? String(names[field]) : field,
    }))
}

function attributeValueToString(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const object = value as Record<string, unknown>
    if (typeof object.S === 'string') {
      return object.S
    }
    if (typeof object.N === 'string') {
      return object.N
    }
    if (typeof object.BOOL === 'boolean') {
      return String(object.BOOL)
    }
  }
  return String(value ?? '')
}

function stringField(parsed: Record<string, unknown>, key: string) {
  return typeof parsed[key] === 'string' ? parsed[key] as string : undefined
}

function numberField(parsed: Record<string, unknown>, key: string) {
  return typeof parsed[key] === 'number' && Number.isFinite(parsed[key])
    ? Math.floor(parsed[key])
    : undefined
}

function objectField(parsed: Record<string, unknown>, key: string) {
  return parsed[key] && typeof parsed[key] === 'object' && !Array.isArray(parsed[key])
    ? parsed[key] as Record<string, unknown>
    : undefined
}
