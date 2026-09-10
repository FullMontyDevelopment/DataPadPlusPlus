import type {
  SearchDslAggregationRow,
  SearchDslAggregationType,
} from '@datapadplusplus/shared-types'

export function aggregationEntry(row: SearchDslAggregationRow) {
  const trimmedField = row.field.trim()
  if (!trimmedField) {
    return undefined
  }

  const type = row.type ?? 'terms'
  const name = row.name?.trim() || defaultAggregationName(trimmedField, type)
  if (type === 'date-histogram') {
    return [
      name,
      {
        date_histogram: {
          field: trimmedField,
          calendar_interval: row.interval?.trim() || '1d',
        },
      },
    ] satisfies [string, unknown]
  }
  if (type === 'histogram') {
    return [
      name,
      {
        histogram: {
          field: trimmedField,
          interval: positiveNumber(row.interval, row.size ?? 10),
        },
      },
    ] satisfies [string, unknown]
  }
  if (['avg', 'sum', 'min', 'max', 'cardinality'].includes(type)) {
    return [
      name,
      { [type]: { field: trimmedField } },
    ] satisfies [string, unknown]
  }

  return [
    name,
    { terms: { field: trimmedField, size: Math.max(1, Math.floor(row.size ?? 10)) } },
  ] satisfies [string, unknown]
}

export function parseAggregations(body: Record<string, unknown>) {
  const aggs = objectField(body, 'aggs') ?? objectField(body, 'aggregations')
  return Object.entries(aggs ?? {}).flatMap(([name, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return []
    }
    const aggregation = value as Record<string, unknown>
    for (const type of [
      'terms',
      'date_histogram',
      'histogram',
      'avg',
      'sum',
      'min',
      'max',
      'cardinality',
    ] as const) {
      const body = objectField(aggregation, type)
      const field = stringField(body, 'field')
      if (!field) {
        continue
      }
      const normalizedType = type === 'date_histogram' ? 'date-histogram' : type
      return [
        {
          id: rowId('search-agg'),
          name,
          field,
          type: normalizedType as SearchDslAggregationType,
          size: numberField(body, 'size') ?? (type === 'terms' ? 10 : undefined),
          interval:
            stringField(body, 'calendar_interval') ??
            stringField(body, 'fixed_interval') ??
            stringField(body, 'interval') ??
            numericStringField(body, 'interval'),
        },
      ]
    }
    return []
  })
}

function defaultAggregationName(field: string, type: SearchDslAggregationType) {
  return `${field.replaceAll('.', '_')}_${type.replaceAll('-', '_')}`
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Math.max(1, Math.floor(fallback))
}

function rowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function stringField(object: Record<string, unknown> | undefined, key: string) {
  return typeof object?.[key] === 'string' ? object[key] : undefined
}

function numberField(object: Record<string, unknown> | undefined, key: string) {
  return typeof object?.[key] === 'number' && Number.isFinite(object[key])
    ? Math.floor(object[key])
    : undefined
}

function numericStringField(object: Record<string, unknown> | undefined, key: string) {
  return typeof object?.[key] === 'number' && Number.isFinite(object[key])
    ? String(object[key])
    : undefined
}

function objectField(object: Record<string, unknown> | undefined, key: string) {
  return object?.[key] && typeof object[key] === 'object' && !Array.isArray(object[key])
    ? object[key] as Record<string, unknown>
    : undefined
}
