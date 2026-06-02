import type {
  QueryBuilderState,
  SearchDslBuilderState,
  SearchDslFilterOperator,
  SearchDslFilterRow,
  SearchDslQueryMode,
  SearchDslValueType,
} from '@datapadplusplus/shared-types'

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
    const entry = aggregationEntry(row.field, row.name, row.size)
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

export function parseSearchDslQueryText(
  queryText: string,
): SearchDslBuilderState | undefined {
  try {
    const parsed = JSON.parse(queryText) as Record<string, unknown>
    const body = objectField(parsed, 'body') ?? parsed
    const query = objectField(body, 'query')
    const state: SearchDslBuilderState = {
      kind: 'search-dsl',
      index: stringField(parsed, 'index') ?? '',
      ...parseMainQuery(query),
      filters: parseFilters(query),
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

function aggregationEntry(field: string, name: string | undefined, size = 10) {
  const trimmedField = field.trim()
  if (!trimmedField) {
    return undefined
  }

  return [
    name?.trim() || `${trimmedField.replaceAll('.', '_')}_terms`,
    { terms: { field: trimmedField, size: Math.max(1, Math.floor(size)) } },
  ] satisfies [string, unknown]
}

function scalarValue(value: string, type: SearchDslValueType) {
  if (type === 'boolean') {
    return ['true', '1', 'yes'].includes(value.trim().toLowerCase())
  }
  if (type === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return value
}

function parseMainQuery(query: Record<string, unknown> | undefined) {
  if (!query) {
    return mainQueryState('match-all')
  }
  const bool = objectField(query, 'bool')
  const must = Array.isArray(bool?.must) ? bool.must[0] : undefined
  const main = must && typeof must === 'object' ? must as Record<string, unknown> : query

  if (objectField(main, 'query_string')) {
    return mainQueryState('query-string', '', stringField(objectField(main, 'query_string'), 'query') ?? '*')
  }

  for (const mode of ['match', 'term', 'range'] as const) {
    const clause = objectField(main, mode)
    const field = clause ? Object.keys(clause)[0] : undefined
    if (clause && field) {
      const value = mode === 'range'
        ? objectField(clause, field)?.gte ?? ''
        : clause[field]
      return mainQueryState(mode, field, String(value ?? ''), inferValueType(value))
    }
  }

  return mainQueryState('match-all')
}

function mainQueryState(
  queryMode: SearchDslQueryMode,
  field = '',
  value = '',
  valueType: SearchDslValueType = 'string',
) {
  return { queryMode, field, value, valueType }
}

function parseFilters(query: Record<string, unknown> | undefined) {
  const bool = objectField(query, 'bool')
  const filters = Array.isArray(bool?.filter) ? bool.filter : []
  return filters
    .map((filter) => parseFilter(filter))
    .filter((row): row is SearchDslFilterRow => Boolean(row))
}

function parseFilter(value: unknown): SearchDslFilterRow | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const filter = value as Record<string, unknown>
  const exists = objectField(filter, 'exists')
  if (exists) {
    return { ...newSearchFilter(stringField(exists, 'field') ?? '', 'exists'), value: '' }
  }
  for (const operator of ['term', 'match'] as const) {
    const clause = objectField(filter, operator)
    const field = clause ? Object.keys(clause)[0] : undefined
    if (clause && field) {
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
  if (field && bounds) {
    const key = bounds.gte !== undefined ? 'gte' : 'lte'
    return {
      ...newSearchFilter(field, key === 'gte' ? 'range-gte' : 'range-lte'),
      value: String(bounds[key] ?? ''),
      valueType: inferValueType(bounds[key]),
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

function parseAggregations(body: Record<string, unknown>) {
  const aggs = objectField(body, 'aggs') ?? objectField(body, 'aggregations')
  return Object.entries(aggs ?? {}).flatMap(([name, value]) => {
    const terms = value && typeof value === 'object' && !Array.isArray(value)
      ? objectField(value as Record<string, unknown>, 'terms')
      : undefined
    const field = stringField(terms, 'field')
    return field
      ? [{ id: searchDslBuilderRowId('search-agg'), name, field, size: numberField(terms, 'size') ?? 10 }]
      : []
  })
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
