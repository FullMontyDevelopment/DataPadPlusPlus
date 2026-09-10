import type {
  MongoBuilderValueType,
  MongoFindBuilderState,
  MongoFindFilterGroup,
  MongoFindFilterRow,
  MongoFilterOperator,
} from '@datapadplusplus/shared-types'
import {
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
  const supportedKeys = new Set([
    'operation', 'database', 'db', 'collection', 'filter', 'projection', 'sort', 'skip', 'limit',
  ])
  if (Object.keys(query).some((key) => !supportedKeys.has(key))) {
    return undefined
  }
  if (
    (query.operation !== undefined && typeof query.operation !== 'string') ||
    (query.database !== undefined && typeof query.database !== 'string') ||
    (query.db !== undefined && typeof query.db !== 'string') ||
    (query.collection !== undefined && typeof query.collection !== 'string')
  ) {
    return undefined
  }
  const operation = typeof query.operation === 'string' ? query.operation.toLowerCase() : undefined
  if (operation && operation !== 'find') {
    return undefined
  }
  const database =
    typeof query.database === 'string'
      ? query.database
      : typeof query.db === 'string'
        ? query.db
        : undefined
  const collection = typeof query.collection === 'string' ? query.collection : ''
  const parsedFilter = parseMongoFilter(query.filter)
  if (!parsedFilter) {
    return undefined
  }
  const projection = projectionFromQuery(query.projection)
  const sort = sortRowsFromQuery(query.sort)
  const skip = numberOrUndefined(query.skip)
  const limit = numberOrUndefined(query.limit)
  if (
    !projection ||
    !sort ||
    (query.skip !== undefined && skip === undefined) ||
    (query.limit !== undefined && limit === undefined)
  ) {
    return undefined
  }

  return {
    kind: 'mongo-find',
    ...(database?.trim() ? { database: database.trim() } : {}),
    collection,
    filters: parsedFilter.filters,
    filterGroups: parsedFilter.filterGroups,
    projectionMode: projection.mode,
    projectionFields: projection.fields,
    sort,
    skip: skip ?? 0,
    limit: limit ?? 20,
    lastAppliedQueryText: queryText,
  }
}

interface ParsedMongoFilter {
  filters: MongoFindFilterRow[]
  filterGroups: MongoFindFilterGroup[]
}

function parseMongoFilter(filter: unknown): ParsedMongoFilter | undefined {
  if (filter === undefined || filter === null) {
    return { filters: [], filterGroups: [] }
  }

  if (!isPlainObject(filter)) {
    return undefined
  }

  if (Object.keys(filter).length === 0) {
    return { filters: [], filterGroups: [] }
  }

  const conjunction = exactLogicalTerms(filter, '$and')
  if (conjunction) {
    return parseTopLevelConjunction(conjunction)
  }

  const disjunction = exactLogicalTerms(filter, '$or')
  if (disjunction) {
    const group = parseLogicalGroup(disjunction, 'or', 1)
    return group
      ? { filters: group.filters, filterGroups: [group.group] }
      : undefined
  }

  if (Object.keys(filter).some((field) => field === '$and' || field === '$or')) {
    return undefined
  }

  const filters = filterRowsFromLeaf(filter)
  return filters ? { filters, filterGroups: [] } : undefined
}

function parseTopLevelConjunction(terms: unknown[]): ParsedMongoFilter | undefined {
  const filters: MongoFindFilterRow[] = []
  const filterGroups: MongoFindFilterGroup[] = []

  for (const term of terms) {
    if (!isPlainObject(term)) {
      return undefined
    }

    const disjunction = exactLogicalTerms(term, '$or')
    const nestedConjunction = exactLogicalTerms(term, '$and')
    const logic = disjunction ? 'or' : 'and'
    const groupTerms = disjunction ?? nestedConjunction ?? [term]
    const parsedGroup = parseLogicalGroup(groupTerms, logic, filterGroups.length + 1)

    if (!parsedGroup) {
      return undefined
    }

    filters.push(...parsedGroup.filters)
    filterGroups.push(parsedGroup.group)
  }

  return { filters, filterGroups }
}

function parseLogicalGroup(
  terms: unknown[],
  logic: MongoFindFilterGroup['logic'],
  position: number,
) {
  if (terms.length === 0) {
    return undefined
  }

  const id = mongoBuilderRowId('filter-group')
  const filters: MongoFindFilterRow[] = []

  for (const term of terms) {
    if (!isPlainObject(term) || exactLogicalTerms(term, '$and') || exactLogicalTerms(term, '$or')) {
      return undefined
    }

    const rows = filterRowsFromLeaf(term)
    if (!rows || rows.length === 0 || logic === 'or' && rows.length !== 1) {
      return undefined
    }

    filters.push(...rows.map((row) => ({ ...row, groupId: id })))
  }

  return {
    filters,
    group: {
      id,
      enabled: true,
      label: `Group ${position}`,
      logic,
    } satisfies MongoFindFilterGroup,
  }
}

function exactLogicalTerms(
  value: Record<string, unknown>,
  operator: '$and' | '$or',
) {
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === operator && Array.isArray(value[operator])
    ? value[operator]
    : undefined
}

function filterRowsFromLeaf(filter: Record<string, unknown>): MongoFindFilterRow[] | undefined {
  const filters: MongoFindFilterRow[] = []

  for (const [field, value] of Object.entries(filter)) {
    if (!field || field === '$and' || field === '$or') {
      return undefined
    }

    const rows = filterRowsForField(field, value)
    if (!rows) {
      return undefined
    }
    filters.push(...rows)
  }

  return filters
}

function filterRowsForField(field: string, value: unknown): MongoFindFilterRow[] | undefined {
  if (!isPlainObject(value) || isMongoNativeScalar(value)) {
    return [equalityFilterRow(field, value)]
  }

  const keys = Object.keys(value)
  if (keys.every((key) => !key.startsWith('$'))) {
    return [equalityFilterRow(field, value)]
  }

  if (keys.some((key) => !key.startsWith('$'))) {
    return undefined
  }

  const arrayRow = arrayFilterRow(field, value)
  if (arrayRow) {
    return [arrayRow]
  }

  const supportedOperators = new Set([
    '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$regex', '$options', '$exists',
    '$in', '$nin', '$type', '$size', '$not',
  ])
  if (keys.some((key) => !supportedOperators.has(key))) {
    return undefined
  }
  if (keys.includes('$options') && !keys.includes('$regex')) {
    return undefined
  }

  const rows: MongoFindFilterRow[] = []
  for (const [operator, operatorValue] of Object.entries(value)) {
    if (operator === '$options') {
      continue
    }
    const row = operator === '$regex'
      ? regexFilterRow(field, operatorValue, value.$options)
      : filterRowForOperator(field, operator, operatorValue)
    if (!row) {
      return undefined
    }
    rows.push(row)
  }

  return rows
}

function equalityFilterRow(field: string, value: unknown): MongoFindFilterRow {
  return {
    id: mongoBuilderRowId('filter'),
    enabled: true,
    field,
    operator: value === null ? 'is-null' : 'eq',
    value: valueToBuilderInput(value),
    valueType: valueTypeForBuilder(value),
  }
}

function filterRowForOperator(
  field: string,
  operator: string,
  value: unknown,
): MongoFindFilterRow | undefined {
  if (operator === '$exists' && typeof value !== 'boolean') {
    return undefined
  }
  if ((operator === '$in' || operator === '$nin') && !Array.isArray(value)) {
    return undefined
  }
  if (operator === '$size' && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
    return undefined
  }
  const operatorMap: Record<string, MongoFilterOperator> = {
    $eq: 'eq',
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
    $size: 'has-length',
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

  if (normalizedOperator === 'has-length' && value === 0) {
    return {
      id: mongoBuilderRowId('filter'),
      enabled: true,
      field,
      operator: 'has-no-items' as const,
      value: '',
      valueType: 'number' as const,
    }
  }

  return {
    id: mongoBuilderRowId('filter'),
    enabled: true,
    field,
    operator: normalizedOperator,
    value: (normalizedOperator === 'in' || normalizedOperator === 'not-in') && Array.isArray(operatorValue)
      ? (operatorValue as unknown[]).map(valueToBuilderInput).join(', ')
      : noValueOperator(normalizedOperator)
        ? ''
        : operatorValueToBuilderInput(normalizedOperator, operatorValue),
    valueType: valueTypeForBuilder(operatorValue),
  }
}

function regexFilterRow(
  field: string,
  value: unknown,
  options: unknown,
): MongoFindFilterRow | undefined {
  if (typeof value !== 'string' || options !== undefined && options !== 'i') {
    return undefined
  }

  const operator = options === 'i' ? positiveRegexOperator(value) : 'regex'
  if (options === 'i' && operator === 'regex') {
    return undefined
  }

  return {
    id: mongoBuilderRowId('filter'),
    enabled: true,
    field,
    operator,
    value: operatorValueToBuilderInput(operator, value),
    valueType: 'string',
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

  const keys = Object.keys(value)
  if (keys.length === 1 && Object.prototype.hasOwnProperty.call(value, '$type')) {
    return 'not-type'
  }

  if (
    keys.length === 2 &&
    typeof value.$regex === 'string' &&
    value.$options === 'i'
  ) {
    const operator = positiveRegexOperator(value.$regex)

    if (operator === 'starts-with') {
      return 'not-starts-with'
    }

    if (operator === 'ends-with') {
      return 'not-ends-with'
    }

    return operator === 'contains' ? 'not-contains' : undefined
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
  return ['exists', 'does-not-exist', 'is-null', 'is-not-null', 'has-items', 'has-no-items'].includes(operator)
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
} | undefined {
  if (projection === undefined || projection === null) {
    return { mode: 'all', fields: [] }
  }
  if (typeof projection !== 'object' || Array.isArray(projection)) {
    return undefined
  }

  const entries = Object.entries(projection as Record<string, unknown>).filter(([field]) =>
    Boolean(field.trim()),
  )

  if (entries.length === 0) {
    return { mode: 'all', fields: [] }
  }

  if (entries.some(([, value]) => value !== 0 && value !== 1)) {
    return undefined
  }
  const modes = new Set(entries.map(([, value]) => value))
  if (modes.size !== 1) {
    return undefined
  }
  const mode = entries[0]?.[1] === 1 ? 'include' : 'exclude'

  return {
    mode,
    fields: entries.map(([field]) => ({ id: mongoBuilderRowId('projection'), field })),
  }
}

function sortRowsFromQuery(sort: unknown): MongoFindBuilderState['sort'] | undefined {
  if (sort === undefined || sort === null) {
    return []
  }
  if (typeof sort !== 'object' || Array.isArray(sort)) {
    return undefined
  }

  const entries = Object.entries(sort as Record<string, unknown>)
  if (entries.some(([field, direction]) => !field.trim() || direction !== 1 && direction !== -1)) {
    return undefined
  }

  return entries
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

    if (typeof value.$uuid === 'string') {
      return 'uuid'
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

    if (typeof value.$uuid === 'string') {
      return value.$uuid
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
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMongoNativeScalar(value: Record<string, unknown>) {
  return (
    isMongoDateValue(value) ||
    typeof value.$oid === 'string' ||
    typeof value.$uuid === 'string'
  )
}

function arrayFilterRow(field: string, value: Record<string, unknown>) {
  if (
    Object.keys(value).length === 2 &&
    value.$type === 'array' &&
    isPlainObject(value.$not) &&
    Object.keys(value.$not).length === 1 &&
    value.$not.$size === 0
  ) {
    return {
      id: mongoBuilderRowId('filter'),
      enabled: true,
      field,
      operator: 'has-items' as const,
      value: '',
      valueType: 'number' as const,
    }
  }
  return undefined
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
