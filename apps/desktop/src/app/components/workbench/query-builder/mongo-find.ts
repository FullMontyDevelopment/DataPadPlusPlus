import type {
  MongoBuilderValueType,
  MongoFindFilterGroup,
  MongoFilterOperator,
  MongoFindBuilderState,
  MongoFindFilterRow,
  QueryBuilderState,
} from '@datapadplusplus/shared-types'
import { normalizeFilterGroups } from './mongo-find-defaults'
export { defaultFilterGroup, normalizeFilterGroups } from './mongo-find-defaults'
export { parseMongoFindQueryText } from './mongo-find-parser'

const OPERATOR_MAP: Record<Exclude<MongoFilterOperator, 'eq' | 'contains'>, string> = {
  ne: '$ne',
  gt: '$gt',
  gte: '$gte',
  lt: '$lt',
  lte: '$lte',
  regex: '$regex',
  exists: '$exists',
  in: '$in',
}

export function createDefaultMongoFindBuilderState(
  collection: string,
  limit = 20,
): MongoFindBuilderState {
  const queryText = buildMongoFindQueryText({
    kind: 'mongo-find',
    collection,
    filters: [],
    filterGroups: [],
    projectionMode: 'all',
    projectionFields: [],
    sort: [],
    skip: 0,
    limit,
  })

  return {
    kind: 'mongo-find',
    collection,
    filters: [],
    filterGroups: [],
    projectionMode: 'all',
    projectionFields: [],
    sort: [],
    skip: 0,
    limit,
    lastAppliedQueryText: queryText,
  }
}

export function isMongoFindBuilderState(
  state: QueryBuilderState | undefined,
): state is MongoFindBuilderState {
  return state?.kind === 'mongo-find'
}

export function buildMongoFindQueryText(state: MongoFindBuilderState): string {
  const query: Record<string, unknown> = {
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

export function buildMongoFilter(state: Pick<MongoFindBuilderState, 'filters' | 'filterGroups'>): Record<string, unknown> {
  const groups = normalizeFilterGroups(state.filterGroups)
  const groupExpressions = groups
    .map((group) => {
      const rowExpressions = state.filters
        .filter((row) => (row.enabled ?? true) && (row.groupId ?? groups[0]?.id) === group.id)
        .map(buildMongoFilterExpression)
        .filter((expression) => Object.keys(expression).length > 0)

      return combineFilterExpressions(rowExpressions, group.logic)
    })
    .filter((expression) => Object.keys(expression).length > 0)

  if (groupExpressions.length === 0) {
    return {}
  }

  if (groupExpressions.length === 1) {
    return groupExpressions[0] ?? {}
  }

  return { $and: groupExpressions }
}

function buildMongoFilterExpression(row: MongoFindFilterRow): Record<string, unknown> {
  const field = row.field.trim()

  if (!field) {
    return {}
  }

  if (row.operator === 'contains') {
    return { [field]: { $regex: escapeMongoRegex(row.value) } }
  }

  const value = coerceMongoValue(row.value, row.valueType, row.operator)

  if (row.operator === 'eq') {
    return { [field]: value }
  }

  return { [field]: { [OPERATOR_MAP[row.operator]]: value } }
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

  return expressions.reduce<Record<string, unknown>>((merged, expression) => {
    for (const [field, value] of Object.entries(expression)) {
      const existing = merged[field]

      if (isPlainObject(existing) && isPlainObject(value)) {
        merged[field] = { ...existing, ...value }
      } else {
        merged[field] = value
      }
    }

    return merged
  }, {})
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
  if (operator === 'exists') {
    return parseBoolean(value, true)
  }

  if (operator === 'in') {
    return parseInValue(value, valueType)
  }

  if (valueType === 'null') {
    return null
  }

  if (valueType === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : value
  }

  if (valueType === 'boolean') {
    return parseBoolean(value, false)
  }

  if (valueType === 'json') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  if (valueType === 'date') {
    return { $date: normalizeMongoDateInput(value) }
  }

  if (valueType === 'objectId') {
    return { $oid: normalizeMongoObjectIdInput(value) }
  }

  return value
}

function parseInValue(value: string, valueType: MongoBuilderValueType): unknown[] {
  if (valueType === 'json') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return [value]
    }
  }

  return value
    .split(',')
    .map((part) => coerceMongoValue(part.trim(), valueType, 'eq'))
    .filter((part) => part !== '')
}

function parseBoolean(value: string, fallback: boolean) {
  const normalized = value.trim().toLowerCase()

  if (['true', '1', 'yes'].includes(normalized)) {
    return true
  }

  if (['false', '0', 'no'].includes(normalized)) {
    return false
  }

  return fallback
}

function normalizeMongoDateInput(value: string) {
  const trimmed = value.trim()
  const isoDate = trimmed.match(/^ISODate\("([^"]+)"\)$/)
  return isoDate?.[1] ?? trimmed
}

function normalizeMongoObjectIdInput(value: string) {
  const trimmed = value.trim()
  const objectId = trimmed.match(/^ObjectId\("([^"]+)"\)$/)
  return objectId?.[1] ?? trimmed
}

function escapeMongoRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
