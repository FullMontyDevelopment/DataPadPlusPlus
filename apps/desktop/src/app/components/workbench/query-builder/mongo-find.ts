import type {
  MongoBuilderValueType,
  MongoFindFilterGroup,
  MongoFilterOperator,
  MongoFindBuilderState,
  MongoFindFilterRow,
  QueryBuilderState,
} from '@datapadplusplus/shared-types'
import {
  normalizeObjectId,
  normalizeUuid,
  parseQueryBuilderValue,
  QueryBuilderValueError,
} from './query-value-codec'
export { defaultFilterGroup, normalizeFilterGroups } from './mongo-find-defaults'
export { parseMongoFindQueryText } from './mongo-find-parser'

interface MongoQueryTextContext {
  database?: string
}

const COMPARISON_OPERATOR_MAP: Partial<Record<MongoFilterOperator, string>> = {
  ne: '$ne',
  gt: '$gt',
  gte: '$gte',
  lt: '$lt',
  lte: '$lte',
  regex: '$regex',
  in: '$in',
  'not-in': '$nin',
}

export function createDefaultMongoFindBuilderState(
  collection: string,
  limit = 20,
  database?: string,
): MongoFindBuilderState {
  const normalizedDatabase = database?.trim() || undefined
  const state: MongoFindBuilderState = {
    kind: 'mongo-find',
    ...(normalizedDatabase ? { database: normalizedDatabase } : {}),
    collection,
    filters: [],
    filterGroups: [],
    projectionMode: 'all',
    projectionFields: [],
    sort: [],
    skip: 0,
    limit,
  }
  const queryText = buildMongoFindQueryText(state)

  return {
    ...state,
    lastAppliedQueryText: queryText,
  }
}

export function isMongoFindBuilderState(
  state: QueryBuilderState | undefined,
): state is MongoFindBuilderState {
  return state?.kind === 'mongo-find'
}

export function buildMongoFindQueryText(
  state: MongoFindBuilderState,
  context: MongoQueryTextContext = {},
): string {
  const database = context.database?.trim() || state.database?.trim()
  const query: Record<string, unknown> = {
    ...(database ? { database } : {}),
    collection: state.collection.trim(),
    filter: buildMongoFilter(state),
  }

  const projection = buildMongoProjection(state)
  const sort = buildMongoSort(state)

  if (projection) {
    query.projection = projection
  }

  if (sort) {
    query.sort = sort
  }

  if (state.skip && state.skip > 0) {
    query.skip = Math.floor(state.skip)
  }

  if (state.limit && state.limit > 0) {
    query.limit = Math.floor(state.limit)
  }

  return JSON.stringify(query, null, 2)
}

export function buildMongoFindCountQueryText(
  state: MongoFindBuilderState,
  context: MongoQueryTextContext = {},
) {
  const query = JSON.parse(buildMongoFindQueryText({
    ...state,
    projectionMode: 'all',
    projectionFields: [],
    sort: [],
    skip: undefined,
    limit: undefined,
  }, context)) as Record<string, unknown>

  return JSON.stringify({
    ...(query.database ? { database: query.database } : {}),
    collection: query.collection,
    operation: 'countDocuments',
    filter: query.filter ?? {},
  }, null, 2)
}

export function buildMongoFilter(state: Pick<MongoFindBuilderState, 'filters' | 'filterGroups'>): Record<string, unknown> {
  const groups = state.filterGroups ?? []
  const standaloneExpression = combineFilterExpressions(
    state.filters
      .filter((row) => (row.enabled ?? true) && !row.groupId)
      .map(buildMongoFilterExpression)
      .filter((expression) => Object.keys(expression).length > 0),
    'and',
  )
  const groupExpressions = groups
    .filter((group) => group.enabled ?? true)
    .map((group) => {
      const rowExpressions = state.filters
        .filter((row) => (row.enabled ?? true) && row.groupId === group.id)
        .map(buildMongoFilterExpression)
        .filter((expression) => Object.keys(expression).length > 0)

      return combineFilterExpressions(rowExpressions, group.logic)
    })
    .filter((expression) => Object.keys(expression).length > 0)
  const expressions = [
    ...(Object.keys(standaloneExpression).length > 0 ? [standaloneExpression] : []),
    ...groupExpressions,
  ]

  if (expressions.length === 0) {
    return {}
  }

  if (expressions.length === 1) {
    return expressions[0] ?? {}
  }

  return { $and: expressions }
}

function buildMongoFilterExpression(row: MongoFindFilterRow): Record<string, unknown> {
  const field = row.field.trim()

  if (!field) {
    return {}
  }

  switch (row.operator) {
    case 'eq':
      return { [field]: coerceMongoValue(row.value, row.valueType, row.operator) }
    case 'contains':
      return { [field]: mongoFriendlyRegex(`.*${escapeMongoRegex(row.value)}.*`) }
    case 'not-contains':
      return { [field]: { $not: mongoFriendlyRegex(`.*${escapeMongoRegex(row.value)}.*`) } }
    case 'starts-with':
      return { [field]: mongoFriendlyRegex(`^${escapeMongoRegex(row.value)}`) }
    case 'not-starts-with':
      return { [field]: { $not: mongoFriendlyRegex(`^${escapeMongoRegex(row.value)}`) } }
    case 'ends-with':
      return { [field]: mongoFriendlyRegex(`${escapeMongoRegex(row.value)}$`) }
    case 'not-ends-with':
      return { [field]: { $not: mongoFriendlyRegex(`${escapeMongoRegex(row.value)}$`) } }
    case 'exists':
      return { [field]: { $exists: true } }
    case 'does-not-exist':
      return { [field]: { $exists: false } }
    case 'is-null':
      return { [field]: null }
    case 'is-not-null':
      return { [field]: { $ne: null } }
    case 'type':
      return { [field]: { $type: mongoTypeValue(row.value) } }
    case 'not-type':
      return { [field]: { $not: { $type: mongoTypeValue(row.value) } } }
    case 'has-items':
      return { [field]: { $type: 'array', $not: { $size: 0 } } }
    case 'has-no-items':
      return { [field]: { $size: 0 } }
    case 'has-length':
      return {
        [field]: {
          $size: parseQueryBuilderValue(row.value, 'number', { operator: 'has-length' }),
        },
      }
    default: {
      const operator = COMPARISON_OPERATOR_MAP[row.operator]
      const value = coerceMongoValue(row.value, row.valueType, row.operator)
      return operator ? { [field]: { [operator]: value } } : {}
    }
  }
}

function combineFilterExpressions(
  expressions: Array<Record<string, unknown>>,
  logic: MongoFindFilterGroup['logic'],
) {
  if (expressions.length === 0) {
    return {}
  }

  if (logic === 'or') {
    return expressions.length === 1 ? expressions[0] ?? {} : { $or: expressions }
  }

  const merged: Record<string, unknown> = {}

  for (const expression of expressions) {
    for (const [field, value] of Object.entries(expression)) {
      const existing = merged[field]

      if (existing === undefined) {
        merged[field] = value
      } else if (
        isMergeableMongoOperatorObject(existing) &&
        isMergeableMongoOperatorObject(value) &&
        Object.keys(value).every((operator) => !Object.hasOwn(existing, operator))
      ) {
        merged[field] = { ...existing, ...value }
      } else {
        return { $and: expressions }
      }
    }
  }

  return merged
}

const MERGEABLE_MONGO_OPERATORS = new Set([
  '$ne', '$gt', '$gte', '$lt', '$lte', '$regex', '$options', '$exists',
  '$in', '$nin', '$type', '$not', '$size',
])

function isMergeableMongoOperatorObject(value: unknown): value is Record<string, unknown> {
  return isPlainObject(value) &&
    Object.keys(value).length > 0 &&
    Object.keys(value).every((key) => MERGEABLE_MONGO_OPERATORS.has(key))
}

function buildMongoProjection(
  state: MongoFindBuilderState,
): Record<string, 0 | 1> | undefined {
  if (state.projectionMode === 'all') {
    return undefined
  }

  const fields = state.projectionFields
    .map((field) => field.field.trim())
    .filter(Boolean)

  if (fields.length === 0) {
    return undefined
  }

  const value = state.projectionMode === 'include' ? 1 : 0
  return Object.fromEntries(fields.map((field) => [field, value]))
}

function buildMongoSort(state: MongoFindBuilderState): Record<string, 1 | -1> | undefined {
  const rows = state.sort
    .map((row) => [row.field.trim(), row.direction === 'asc' ? 1 : -1] as const)
    .filter(([field]) => Boolean(field))

  return rows.length > 0 ? Object.fromEntries(rows) : undefined
}

function coerceMongoValue(
  value: string,
  valueType: MongoBuilderValueType,
  operator: MongoFilterOperator,
): unknown {
  const parsed = parseQueryBuilderValue(value, valueType, { operator })
  if (Array.isArray(parsed)) {
    return parsed.map((item) => mongoNativeValue(item, valueType))
  }
  return mongoNativeValue(parsed, valueType)
}

function mongoNativeValue(value: unknown, valueType: MongoBuilderValueType) {
  if (valueType === 'date') return { $date: String(value) }
  if (valueType === 'uuid') return { $uuid: normalizeUuid(String(value)) }
  if (valueType === 'objectId') return { $oid: normalizeObjectId(String(value)) }
  return value
}

function escapeMongoRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function mongoFriendlyRegex(pattern: string) {
  return { $regex: pattern, $options: 'i' }
}

function mongoTypeValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new QueryBuilderValueError('Enter a BSON type name or numeric BSON type code.')
  }
  const numeric = Number(trimmed)
  return trimmed && Number.isInteger(numeric) ? numeric : trimmed
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
