import type { LiteDbFindBuilderState, LiteDbFilterOperator, QueryBuilderState } from '@datapadplusplus/shared-types'
import { parseQueryBuilderValue, queryBuilderOperatorArity } from './query-value-codec'
import type { QueryBuilderValidationError } from './query-builder-validation'

export const LITEDB_FILTER_OPERATORS: Array<{ value: LiteDbFilterOperator; label: string }> = [
  { value: 'eq', label: '=' }, { value: 'ne', label: '!=' },
  { value: 'gt', label: '>' }, { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' }, { value: 'lte', label: '<=' },
  { value: 'contains', label: 'Contains' }, { value: 'starts-with', label: 'Starts with' },
  { value: 'in', label: 'In' }, { value: 'not-in', label: 'Not in' },
  { value: 'is-null', label: 'Is null' }, { value: 'is-not-null', label: 'Is not null' },
  { value: 'has-items', label: 'Has Items' }, { value: 'has-no-items', label: 'Has No Items' },
  { value: 'has-length', label: 'Has Length' },
]

export function isLiteDbFindBuilderState(state?: QueryBuilderState): state is LiteDbFindBuilderState {
  return state?.kind === 'litedb-find'
}

export function createDefaultLiteDbFindBuilderState(collection = '', limit = 20): LiteDbFindBuilderState {
  return { kind: 'litedb-find', collection, filterLogic: 'and', filters: [], filterGroups: [], sort: [], skip: 0, limit }
}

// Every field segment is quoted as a LiteDB member path, never executable expression text.
export function liteDbFieldPath(field: string) {
  const parts = field.trim().replace(/^\$\./, '').split('.')
  if (parts.some(part => !part || [...part].some(character => character.charCodeAt(0) < 32))) throw new Error('Enter a field name or dot-separated field path.')
  return '$' + parts.map(part => `.[${JSON.stringify(part)}]`).join('')
}

export function validateLiteDbFindBuilder(state: LiteDbFindBuilderState): QueryBuilderValidationError[] {
  const errors: QueryBuilderValidationError[] = []
  if (!state.collection.trim()) errors.push({ field: 'Collection', message: 'Choose a LiteDB collection.' })
  if (!['and', 'or'].includes(state.filterLogic)) errors.push({ message: 'Choose AND or OR for filters.' })
  const groups = new Map(state.filterGroups.map(group => [group.id, group]))
  if (groups.size !== state.filterGroups.length || state.filterGroups.some(group => !['and', 'or'].includes(group.logic))) {
    errors.push({ message: 'Filter groups need unique IDs and AND or OR logic.' })
  }
  for (const row of state.filters) {
    if (row.groupId && !groups.has(row.groupId)) errors.push({ rowId: row.id, message: 'This filter group no longer exists.' })
    if (row.enabled === false || row.groupId && groups.get(row.groupId)?.enabled === false) continue
    try {
      liteDbFieldPath(row.field)
      if (!LITEDB_FILTER_OPERATORS.some(item => item.value === row.operator)) throw new Error('Choose a supported LiteDB operator.')
      if (['contains', 'starts-with'].includes(row.operator) && row.valueType !== 'string') throw new Error('Text matching requires a string value.')
      parseQueryBuilderValue(row.value, row.valueType, { operator: row.operator })
    } catch (error) {
      errors.push({ rowId: row.id, field: row.field, message: error instanceof Error ? error.message : 'Invalid value.' })
    }
  }
  if (state.sort.length > 1) errors.push({ message: 'LiteDB supports one native sort field.' })
  for (const sort of state.sort) {
    try {
      liteDbFieldPath(sort.field)
      if (!['asc', 'desc'].includes(sort.direction)) throw new Error('Choose a sort direction.')
    } catch (error) { errors.push({ rowId: sort.id, message: String(error instanceof Error ? error.message : error) }) }
  }
  for (const key of ['skip', 'limit'] as const) {
    const value = state[key]
    if (value !== undefined && (!Number.isSafeInteger(value) || value < (key === 'limit' ? 1 : 0) || value > 2_147_483_647)) {
      errors.push({ field: key, message: `Enter a ${key === 'limit' ? 'positive' : 'non-negative'} whole number up to 2147483647.` })
    }
  }
  return errors
}

export function buildLiteDbFindQueryText(state: LiteDbFindBuilderState, count = false) {
  const errors = validateLiteDbFindBuilder(state)
  if (errors.length) throw new Error(errors[0]?.message)
  const parameters: Record<string, unknown> = {}
  const condition = (row: LiteDbFindBuilderState['filters'][number]) => {
    const path = liteDbFieldPath(row.field)
    if (row.operator === 'is-null') return `${path} = null`
    if (row.operator === 'is-not-null') return `${path} != null`
    if (row.operator === 'has-items') return `(IS_ARRAY(${path}) = true AND COUNT(${path}) > 0)`
    if (row.operator === 'has-no-items') return `(IS_ARRAY(${path}) = true AND COUNT(${path}) = 0)`
    const key = `p${Object.keys(parameters).length}`
    const parsed = parseQueryBuilderValue(row.value, row.valueType, { operator: row.operator })
    const wrap = (value: unknown) => row.valueType === 'date' ? { $date: value }
      : row.valueType === 'uuid' ? { $guid: value } : row.valueType === 'objectId' ? { $oid: value } : value
    parameters[key] = queryBuilderOperatorArity(row.operator) === 'list'
      ? (parsed as unknown[]).map(wrap) : row.operator === 'has-length' ? parsed : wrap(parsed)
    const param = `@${key}`
    switch (row.operator) {
      case 'contains': return `INDEXOF(${path}, ${param}) >= 0`
      case 'starts-with': return `INDEXOF(${path}, ${param}) = 0`
      case 'in': return `${path} IN ${param}`
      case 'not-in': return `(${path} IN ${param}) = false`
      case 'has-length': return `(IS_ARRAY(${path}) = true AND COUNT(${path}) = ${param})`
      default: return `${path} ${{ eq: '=', ne: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }[row.operator]} ${param}`
    }
  }
  const join = (rows: LiteDbFindBuilderState['filters'], logic: 'and' | 'or') =>
    rows.filter(row => row.enabled !== false).map(row => `(${condition(row)})`).join(` ${logic.toUpperCase()} `)
  const conditions = state.filters.filter(row => !row.groupId && row.enabled !== false).map(row => `(${condition(row)})`)
  for (const group of state.filterGroups) {
    if (group.enabled === false) continue
    const text = join(state.filters.filter(row => row.groupId === group.id), group.logic)
    if (text) conditions.push(`(${text})`)
  }
  const sort = state.sort[0]
  return JSON.stringify({
    operation: count ? 'Count' : 'Find', collection: state.collection.trim(),
    filter: conditions.length ? conditions.join(` ${state.filterLogic.toUpperCase()} `) : {},
    ...(Object.keys(parameters).length ? { parameters } : {}),
    ...(!count ? {
      ...(sort ? { orderBy: { expression: liteDbFieldPath(sort.field), direction: sort.direction } } : {}),
      skip: state.skip ?? 0, limit: state.limit ?? 20,
    } : {}),
  }, null, 2)
}

// Only adopt requests we can represent exactly. Never discard an unknown raw predicate.
export function parseLiteDbFindQueryText(text: string, collection = ''): LiteDbFindBuilderState | undefined {
  if (!text.trim()) return createDefaultLiteDbFindBuilderState(collection)
  try {
    const request = JSON.parse(text) as Record<string, unknown>
    if (!request || Array.isArray(request) || typeof request !== 'object') return undefined
    if (Object.keys(request).some(key => !['operation', 'collection', 'filter', 'limit', 'skip'].includes(key))) return undefined
    if (String(request.operation ?? 'Find').toLowerCase() !== 'find' || typeof request.collection !== 'string') return undefined
    if (request.filter !== undefined && (request.filter === null || typeof request.filter !== 'object' || Array.isArray(request.filter) || Object.keys(request.filter).length)) return undefined
    const state = { ...createDefaultLiteDbFindBuilderState(request.collection),
      skip: request.skip === undefined ? 0 : request.skip as number,
      limit: request.limit === undefined ? 20 : request.limit as number,
    }
    // A new unscoped tab has an empty collection. Keep it editable, but compilation still blocks Run.
    return validateLiteDbFindBuilder(state).some(error => error.field !== 'Collection') ? undefined : { ...state, lastAppliedQueryText: text }
  } catch { return undefined }
}
