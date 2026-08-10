import type {
  QueryBuilderState,
  SearchDslBuilderState,
  SearchDslFilterOperator,
  SearchDslFilterRow,
  SearchDslQueryMode,
  SearchDslValueType,
} from '@datapadplusplus/shared-types'
import { aggregationEntry, parseAggregations } from './search-dsl-aggregations'
import { parseQueryBuilderValue } from './query-value-codec'

export function createDefaultSearchDslBuilderState(
  index = '',
  size = 20,
): SearchDslBuilderState {
  const state: SearchDslBuilderState = {
    kind: 'search-dsl',
    index,
    queryMode: 'match-all',
    field: '',
    value: '',
    valueType: 'string',
    filters: [],
    sourceFields: [],
    sort: [],
    aggregations: [],
    size,
  }

  return {
    ...state,
    lastAppliedQueryText: buildSearchDslQueryText(state),
  }
}

export function isSearchDslBuilderState(
  state: QueryBuilderState | undefined,
): state is SearchDslBuilderState {
  return state?.kind === 'search-dsl'
}

export function buildSearchDslQueryText(state: SearchDslBuilderState) {
  const body: Record<string, unknown> = {
    query: searchQuery(state),
  }
  const source = state.sourceFields.map((field) => field.field.trim()).filter(Boolean)
  const sort = state.sort
    .map((row) => row.field.trim() ? { [row.field.trim()]: { order: row.direction } } : undefined)
    .filter(Boolean)
  const aggEntries: Array<[string, unknown]> = []
  for (const row of state.aggregations) {
    const entry = aggregationEntry(row)
    if (entry) {
      aggEntries.push(entry)
    }
  }
  const aggs = Object.fromEntries(aggEntries)

  if (state.size && state.size > 0) {
    body.size = Math.floor(state.size)
  }
  if (source.length > 0) {
    body._source = source
  }
  if (sort.length > 0) {
    body.sort = sort
  }
  if (Object.keys(aggs).length > 0) {
    body.aggs = aggs
  }

  return JSON.stringify(
    {
      index: state.index.trim(),
      body,
    },
    null,
    2,
  )
}

export function buildSearchDslCountQueryText(state: SearchDslBuilderState) {
  return JSON.stringify({
    index: state.index.trim(),
    body: { query: searchQuery(state) },
  }, null, 2)
}

export function parseSearchDslQueryText(
  queryText: string,
): SearchDslBuilderState | undefined {
  try {
    const parsed = JSON.parse(queryText) as Record<string, unknown>
    const body = objectField(parsed, 'body') ?? parsed
    const query = objectField(body, 'query')
    const mainQuery = parseMainQuery(query)
    const filters = parseFilters(query)
    if (!mainQuery || !filters) {
      return undefined
    }
    const state: SearchDslBuilderState = {
      kind: 'search-dsl',
      index: stringField(parsed, 'index') ?? '',
      ...mainQuery,
      filters,
      sourceFields: parseSourceFields(body),
      sort: parseSort(body),
      aggregations: parseAggregations(body),
      size: numberField(body, 'size') ?? 20,
    }

    return {
      ...state,
      lastAppliedQueryText: buildSearchDslQueryText(state),
    }
  } catch {
    return undefined
  }
}

export function searchDslBuilderRowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function newSearchFilter(
  field = '',
  operator: SearchDslFilterOperator = 'term',
): SearchDslFilterRow {
  return {
    id: searchDslBuilderRowId('search-filter'),
    enabled: true,
    field,
    operator,
    value: '',
    valueType: 'string',
  }
}

function searchQuery(state: SearchDslBuilderState) {
  const main = mainQuery(state)
  const filters = state.filters
    .filter((row) => row.enabled ?? true)
    .map(filterQuery)
    .filter(Boolean)

  if (filters.length === 0) {
    return main
  }

  return {
    bool: {
      must: [main],
      filter: filters,
    },
  }
}

function mainQuery(state: SearchDslBuilderState): Record<string, unknown> {
  const field = state.field.trim()
  if (state.queryMode === 'match-all' || !field && state.queryMode !== 'query-string') {
    return { match_all: {} }
  }
  if (state.queryMode === 'query-string') {
    return { query_string: { query: state.value.trim() || '*' } }
  }
  if (state.queryMode === 'range') {
    return { range: { [field]: { gte: scalarValue(state.value, state.valueType) } } }
  }
  return {
    [state.queryMode]: {
      [field]: scalarValue(state.value, state.valueType),
    },
  }
}

function filterQuery(row: SearchDslFilterRow) {
  const field = row.field.trim()
  if (!field) {
    return undefined
  }
  if (row.operator === 'exists') {
    return { exists: { field } }
  }
  if (row.operator === 'does-not-exist') {
    return { bool: { must_not: [{ exists: { field } }] } }
  }
  if (row.operator === 'starts-with' || row.operator === 'not-starts-with') {
    const query = { prefix: { [field]: scalarValue(row.value, row.valueType) } }
    return row.operator === 'not-starts-with' ? { bool: { must_not: [query] } } : query
  }
  if (row.operator === 'ends-with' || row.operator === 'not-ends-with') {
    const query = { wildcard: { [field]: `*${String(scalarValue(row.value, row.valueType))}` } }
    return row.operator === 'not-ends-with' ? { bool: { must_not: [query] } } : query
  }
  if (row.operator === 'not-contains') {
    return {
      bool: {
        must_not: [{
          wildcard: { [field]: `*${String(scalarValue(row.value, row.valueType))}*` },
        }],
      },
    }
  }
  if (row.operator === 'not-in') {
    return {
      bool: {
        must_not: [{
          terms: { [field]: csvSearchValues(row.value, row.valueType) },
        }],
      },
    }
  }
  if (row.operator === 'range-gte' || row.operator === 'range-lte') {
    return {
      range: {
        [field]: {
          [row.operator === 'range-gte' ? 'gte' : 'lte']: scalarValue(row.value, row.valueType),
        },
      },
    }
  }
  return { [row.operator]: { [field]: scalarValue(row.value, row.valueType) } }
}

function csvSearchValues(value: string, type: SearchDslValueType) {
  return parseQueryBuilderValue(value, type, { operator: 'in' }) as unknown[]
}

function scalarValue(value: string, type: SearchDslValueType) {
  return parseQueryBuilderValue(value, type)
}

function parseMainQuery(query: Record<string, unknown> | undefined) {
  if (!query) {
    return mainQueryState('match-all')
  }
  const bool = objectField(query, 'bool')
  if (bool && Object.keys(bool).some((key) => key !== 'must' && key !== 'filter')) {
    return undefined
  }
  const mustEntries = Array.isArray(bool?.must) ? bool.must : undefined
  if (bool && (!mustEntries || mustEntries.length !== 1)) {
    return undefined
  }
  const must = mustEntries?.[0]
  const main = must && typeof must === 'object' && !Array.isArray(must)
    ? must as Record<string, unknown>
    : bool
      ? undefined
      : query
  if (!main || Object.keys(main).length !== 1) {
    return undefined
  }

  if (objectField(main, 'match_all')) {
    return mainQueryState('match-all')
  }

  if (objectField(main, 'query_string')) {
    return mainQueryState('query-string', '', stringField(objectField(main, 'query_string'), 'query') ?? '*')
  }

  for (const mode of ['match', 'term', 'range'] as const) {
    const clause = objectField(main, mode)
    const field = clause ? Object.keys(clause)[0] : undefined
    if (clause && field && Object.keys(clause).length === 1) {
      const bounds = mode === 'range' ? objectField(clause, field) : undefined
      if (mode === 'range' && (!bounds || Object.keys(bounds).length !== 1 || bounds.gte === undefined)) {
        return undefined
      }
      const value = mode === 'range' ? bounds?.gte : clause[field]
      return mainQueryState(mode, field, String(value ?? ''), inferValueType(value))
    }
  }

  return undefined
}

function mainQueryState(
  queryMode: SearchDslQueryMode,
  field = '',
  value = '',
  valueType: SearchDslValueType = 'string',
) {
  return { queryMode, field, value, valueType }
}

function parseFilters(query: Record<string, unknown> | undefined): SearchDslFilterRow[] | undefined {
  const bool = objectField(query, 'bool')
  if (!bool || bool.filter === undefined) {
    return []
  }
  if (!Array.isArray(bool.filter)) {
    return undefined
  }

  const rows: SearchDslFilterRow[] = []
  for (const filter of bool.filter) {
    const row = parseFilter(filter)
    if (!row) {
      return undefined
    }
    rows.push(row)
  }
  return rows
}

function parseFilter(value: unknown): SearchDslFilterRow | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const filter = value as Record<string, unknown>
  const bool = objectField(filter, 'bool')
  if (bool && (Object.keys(bool).length !== 1 || !Array.isArray(bool.must_not) || bool.must_not.length !== 1)) {
    return undefined
  }
  const mustNot = Array.isArray(bool?.must_not) ? bool.must_not[0] : undefined
  const negated = parseNegatedFilter(mustNot)

  if (negated) {
    return negated
  }
  if (bool) {
    return undefined
  }

  const exists = objectField(filter, 'exists')
  if (exists) {
    return { ...newSearchFilter(stringField(exists, 'field') ?? '', 'exists'), value: '' }
  }
  const prefix = objectField(filter, 'prefix')
  const prefixField = prefix ? Object.keys(prefix)[0] : undefined
  if (prefix && prefixField) {
    const raw = prefix[prefixField]
    return {
      ...newSearchFilter(prefixField, 'starts-with'),
      value: String(raw ?? ''),
      valueType: inferValueType(raw),
    }
  }
  const wildcard = objectField(filter, 'wildcard')
  const wildcardField = wildcard ? Object.keys(wildcard)[0] : undefined
  if (wildcard && wildcardField && Object.keys(wildcard).length === 1) {
    const raw = wildcard[wildcardField]
    const rawValue = String(raw ?? '')
    if (!rawValue.startsWith('*') || rawValue.endsWith('*')) {
      return undefined
    }
    return {
      ...newSearchFilter(wildcardField, 'ends-with'),
      value: rawValue.slice(1),
      valueType: inferValueType(raw),
    }
  }
  for (const operator of ['term', 'match'] as const) {
    const clause = objectField(filter, operator)
    const field = clause ? Object.keys(clause)[0] : undefined
    if (clause && field && Object.keys(clause).length === 1) {
      const raw = clause[field]
      return {
        ...newSearchFilter(field, operator),
        value: String(raw ?? ''),
        valueType: inferValueType(raw),
      }
    }
  }
  const range = objectField(filter, 'range')
  const field = range ? Object.keys(range)[0] : undefined
  const bounds = field ? objectField(range, field) : undefined
  if (field && bounds && Object.keys(range ?? {}).length === 1 && Object.keys(bounds).length === 1) {
    if (bounds.gte === undefined && bounds.lte === undefined) {
      return undefined
    }
    const key = bounds.gte !== undefined ? 'gte' : 'lte'
    return {
      ...newSearchFilter(field, key === 'gte' ? 'range-gte' : 'range-lte'),
      value: String(bounds[key] ?? ''),
      valueType: inferValueType(bounds[key]),
    }
  }
  return undefined
}

function parseNegatedFilter(value: unknown): SearchDslFilterRow | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const filter = value as Record<string, unknown>
  const exists = objectField(filter, 'exists')
  if (exists) {
    return { ...newSearchFilter(stringField(exists, 'field') ?? '', 'does-not-exist'), value: '' }
  }

  const prefix = objectField(filter, 'prefix')
  const prefixField = prefix ? Object.keys(prefix)[0] : undefined
  if (prefix && prefixField) {
    const raw = prefix[prefixField]
    return {
      ...newSearchFilter(prefixField, 'not-starts-with'),
      value: String(raw ?? ''),
      valueType: inferValueType(raw),
    }
  }

  const wildcard = objectField(filter, 'wildcard')
  const wildcardField = wildcard ? Object.keys(wildcard)[0] : undefined
  if (wildcard && wildcardField) {
    const raw = wildcard[wildcardField]
    const rawValue = String(raw ?? '')
    const containsValue = rawValue.match(/^\*(.+)\*$/s)?.[1]

    if (containsValue !== undefined) {
      return {
        ...newSearchFilter(wildcardField, 'not-contains'),
        value: containsValue,
        valueType: inferValueType(raw),
      }
    }

    return {
      ...newSearchFilter(wildcardField, 'not-ends-with'),
      value: rawValue.replace(/^\*/, ''),
      valueType: inferValueType(raw),
    }
  }

  const terms = objectField(filter, 'terms')
  const termsField = terms ? Object.keys(terms)[0] : undefined
  const rawTerms = termsField ? terms?.[termsField] : undefined
  if (termsField && Array.isArray(rawTerms)) {
    return {
      ...newSearchFilter(termsField, 'not-in'),
      value: rawTerms.map((item) => String(item)).join(', '),
      valueType: inferValueType(rawTerms[0]),
    }
  }

  return undefined
}

function parseSourceFields(body: Record<string, unknown>) {
  const source = body._source
  return Array.isArray(source)
    ? source
        .filter((field): field is string => typeof field === 'string')
        .map((field) => ({ id: searchDslBuilderRowId('search-source'), field }))
    : []
}

function parseSort(body: Record<string, unknown>) {
  return Array.isArray(body.sort)
    ? body.sort.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          return []
        }
        const field = Object.keys(item)[0]
        const order = field ? objectField(item as Record<string, unknown>, field)?.order : undefined
        return field ? [{ id: searchDslBuilderRowId('search-sort'), field, direction: order === 'desc' ? 'desc' as const : 'asc' as const }] : []
      })
    : []
}

function inferValueType(value: unknown): SearchDslValueType {
  if (typeof value === 'number') {
    return 'number'
  }
  if (typeof value === 'boolean') {
    return 'boolean'
  }
  return 'string'
}

function stringField(object: Record<string, unknown> | undefined, key: string) {
  return typeof object?.[key] === 'string' ? object[key] : undefined
}

function numberField(object: Record<string, unknown> | undefined, key: string) {
  return typeof object?.[key] === 'number' && Number.isFinite(object[key])
    ? Math.floor(object[key])
    : undefined
}

function objectField(object: Record<string, unknown> | undefined, key: string) {
  return object?.[key] && typeof object[key] === 'object' && !Array.isArray(object[key])
    ? object[key] as Record<string, unknown>
    : undefined
}
