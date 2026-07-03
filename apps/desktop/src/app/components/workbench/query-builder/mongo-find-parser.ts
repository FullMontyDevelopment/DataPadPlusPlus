import type {
  MongoBuilderValueType,
  MongoFindBuilderState,
  MongoFilterOperator,
} from '@datapadplusplus/shared-types'
import {
  DEFAULT_FILTER_GROUP_ID,
  mongoBuilderRowId,
} from './mongo-find-defaults'

export function parseMongoFindQueryText(queryText: string): MongoFindBuilderState | undefined {
  let parsed: unknown

  try {
    parsed = JSON.parse(queryText)
  } catch {
    return undefined
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined
  }

  const query = parsed as Record<string, unknown>
  const database =
    typeof query.database === 'string'
      ? query.database
      : typeof query.db === 'string'
        ? query.db
        : undefined
  const collection = typeof query.collection === 'string' ? query.collection : ''
  const filters = filterRowsFromQuery(query.filter)
  const projection = projectionFromQuery(query.projection)

  return {
    kind: 'mongo-find',
    ...(database?.trim() ? { database: database.trim() } : {}),
    collection,
    filters: filters.map((filter) => ({
      ...filter,
      enabled: filter.enabled ?? true,
      groupId: filter.groupId ?? DEFAULT_FILTER_GROUP_ID,
    })),
    filterGroups: [],
    projectionMode: projection.mode,
    projectionFields: projection.fields,
    sort: sortRowsFromQuery(query.sort),
    skip: numberOrUndefined(query.skip) ?? 0,
    limit: numberOrUndefined(query.limit) ?? 20,
    lastAppliedQueryText: queryText,
  }
}

function filterRowsFromQuery(filter: unknown): MongoFindBuilderState['filters'] {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
    return []
  }

  return Object.entries(filter as Record<string, unknown>).flatMap(([field, value]) => {
    if (isPlainObject(value) && !isMongoNativeScalar(value)) {
      const operators = Object.entries(value)
        .map(([operator, operatorValue]) => filterRowForOperator(field, operator, operatorValue))
        .filter(Boolean)
      return operators as MongoFindBuilderState['filters']
    }

    return [
      {
        id: mongoBuilderRowId('filter'),
        enabled: true,
        field,
        groupId: DEFAULT_FILTER_GROUP_ID,
        operator: value === null ? 'is-null' : 'eq',
        value: valueToBuilderInput(value),
        valueType: valueTypeForBuilder(value),
      },
    ]
  })
}

function filterRowForOperator(field: string, operator: string, value: unknown) {
  const operatorMap: Record<string, MongoFilterOperator> = {
    $ne: 'ne',
    $gt: 'gt',
    $gte: 'gte',
    $lt: 'lt',
    $lte: 'lte',
    $regex: 'regex',
    $exists: 'exists',
    $in: 'in',
    $nin: 'not-in',
    $type: 'type',
  }
  const builderOperator = operator === '$not'
    ? negatedOperator(value)
    : positiveOperator(operator, value, operatorMap)

  if (!builderOperator) {
    return undefined
  }

  const operatorValue = operatorValueForBuilder(operator, value)
  const normalizedOperator = builderOperator === 'exists' && value === false
    ? 'does-not-exist'
    : builderOperator === 'ne' && value === null
      ? 'is-not-null'
      : builderOperator

  return {
    id: mongoBuilderRowId('filter'),
    enabled: true,
    field,
    groupId: DEFAULT_FILTER_GROUP_ID,
    operator: normalizedOperator,
    value: (normalizedOperator === 'in' || normalizedOperator === 'not-in') && Array.isArray(operatorValue)
      ? (operatorValue as unknown[]).map(valueToBuilderInput).join(', ')
      : noValueOperator(normalizedOperator)
        ? ''
        : operatorValueToBuilderInput(normalizedOperator, operatorValue),
    valueType: valueTypeForBuilder(operatorValue),
  }
}

function positiveOperator(
  operator: string,
  value: unknown,
  operatorMap: Record<string, MongoFilterOperator>,
) {
  if (operator === '$regex' && typeof value === 'string') {
    return positiveRegexOperator(value)
  }

  return operatorMap[operator]
}

function negatedOperator(value: unknown): MongoFilterOperator | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }

  if (Object.prototype.hasOwnProperty.call(value, '$type')) {
    return 'not-type'
  }

  if (typeof value.$regex === 'string') {
    const operator = positiveRegexOperator(value.$regex)

    if (operator === 'starts-with') {
      return 'not-starts-with'
    }

    if (operator === 'ends-with') {
      return 'not-ends-with'
    }

    return 'not-contains'
  }

  return undefined
}

function positiveRegexOperator(value: string): MongoFilterOperator {
  if (isContainsRegexPattern(value)) {
    return 'contains'
  }

  if (value.startsWith('^')) {
    return 'starts-with'
  }

  if (value.endsWith('$')) {
    return 'ends-with'
  }

  return 'regex'
}

function operatorValueForBuilder(operator: string, value: unknown) {
  if (operator === '$not' && isPlainObject(value)) {
    if (Object.prototype.hasOwnProperty.call(value, '$regex')) {
      return value.$regex
    }

    if (Object.prototype.hasOwnProperty.call(value, '$type')) {
      return value.$type
    }

    return Object.values(value)[0]
  }

  return value
}

function noValueOperator(operator: MongoFilterOperator) {
  return ['exists', 'does-not-exist', 'is-null', 'is-not-null'].includes(operator)
}

function operatorValueToBuilderInput(operator: MongoFilterOperator, value: unknown) {
  const input = valueToBuilderInput(value)

  if (operator === 'contains' || operator === 'not-contains') {
    return unescapeMongoRegexLiteral(stripContainsRegexPattern(input))
  }

  if (operator === 'starts-with' || operator === 'not-starts-with') {
    return unescapeMongoRegexLiteral(input.replace(/^\^/, ''))
  }

  if (operator === 'ends-with' || operator === 'not-ends-with') {
    return unescapeMongoRegexLiteral(input.replace(/\$$/, ''))
  }

  return input
}

function isContainsRegexPattern(value: string) {
  return value.startsWith('.*') && value.endsWith('.*') && value.length >= 4
}

function stripContainsRegexPattern(value: string) {
  return isContainsRegexPattern(value) ? value.slice(2, -2) : value
}

function unescapeMongoRegexLiteral(value: string) {
  return value.replace(/\\([.*+?^${}()|[\]\\])/g, '$1')
}

function projectionFromQuery(projection: unknown): {
  mode: MongoFindBuilderState['projectionMode']
  fields: MongoFindBuilderState['projectionFields']
} {
  if (!projection || typeof projection !== 'object' || Array.isArray(projection)) {
    return { mode: 'all', fields: [] }
  }

  const entries = Object.entries(projection as Record<string, unknown>).filter(([field]) =>
    Boolean(field.trim()),
  )

  if (entries.length === 0) {
    return { mode: 'all', fields: [] }
  }

  const includeCount = entries.filter(([, value]) => Number(value) === 1).length
  const mode = includeCount >= entries.length / 2 ? 'include' : 'exclude'

  return {
    mode,
    fields: entries.map(([field]) => ({ id: mongoBuilderRowId('projection'), field })),
  }
}

function sortRowsFromQuery(sort: unknown): MongoFindBuilderState['sort'] {
  if (!sort || typeof sort !== 'object' || Array.isArray(sort)) {
    return []
  }

  return Object.entries(sort as Record<string, unknown>)
    .filter(([field]) => Boolean(field.trim()))
    .map(([field, direction]) => ({
      id: mongoBuilderRowId('sort'),
      field,
      direction: Number(direction) === -1 ? 'desc' : 'asc',
    }))
}

function valueTypeForBuilder(value: unknown): MongoBuilderValueType {
  if (isPlainObject(value)) {
    if (isMongoDateValue(value)) {
      return 'date'
    }

    if (typeof value.$oid === 'string') {
      return 'objectId'
    }

    if (
      typeof value.$numberLong === 'string' ||
      typeof value.$numberInt === 'string' ||
      typeof value.$numberDouble === 'string'
    ) {
      return 'number'
    }
  }

  if (value === null) {
    return 'null'
  }

  if (typeof value === 'number') {
    return 'number'
  }

  if (typeof value === 'boolean') {
    return 'boolean'
  }

  if (typeof value === 'object') {
    return 'json'
  }

  return 'string'
}

function valueToBuilderInput(value: unknown) {
  if (value === null) {
    return ''
  }

  if (isPlainObject(value)) {
    const dateInput = mongoDateInput(value)
    if (dateInput !== undefined) {
      return dateInput
    }

    if (typeof value.$oid === 'string') {
      return value.$oid
    }

    for (const key of ['$numberLong', '$numberInt', '$numberDouble']) {
      if (typeof value[key] === 'string') {
        return value[key]
      }
    }
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value)
}

function numberOrUndefined(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMongoNativeScalar(value: Record<string, unknown>) {
  return (
    isMongoDateValue(value) ||
    typeof value.$oid === 'string' ||
    typeof value.$numberLong === 'string' ||
    typeof value.$numberInt === 'string' ||
    typeof value.$numberDouble === 'string' ||
    typeof value.$numberDecimal === 'string'
  )
}

function isMongoDateValue(value: Record<string, unknown>) {
  return typeof value.$date === 'string' || isMongoDateNumberLong(value.$date)
}

function mongoDateInput(value: Record<string, unknown>) {
  if (typeof value.$date === 'string') {
    return value.$date
  }

  if (isMongoDateNumberLong(value.$date)) {
    const milliseconds = Number(value.$date.$numberLong)
    return Number.isFinite(milliseconds)
      ? new Date(milliseconds).toISOString()
      : value.$date.$numberLong
  }

  return undefined
}

function isMongoDateNumberLong(value: unknown): value is { $numberLong: string } {
  return isPlainObject(value) && typeof value.$numberLong === 'string'
}
