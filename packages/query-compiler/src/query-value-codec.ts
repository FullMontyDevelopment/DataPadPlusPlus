export type QueryBuilderValueType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'json'
  | 'date'
  | 'uuid'
  | 'objectId'

export type QueryBuilderOperatorArity = 'none' | 'single' | 'list' | 'length'

export interface QueryBuilderValueParseOptions {
  allowEnvironmentToken?: boolean
  operator?: string
}

export interface QueryBuilderValueValidation {
  ok: boolean
  error?: string
  value?: unknown
}

export class QueryBuilderValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'QueryBuilderValueError'
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i

export function queryBuilderOperatorArity(operator: string): QueryBuilderOperatorArity {
  if (
    operator === 'exists' ||
    operator === 'does-not-exist' ||
    operator === 'is-null' ||
    operator === 'is-not-null' ||
    operator === 'has-items' ||
    operator === 'has-no-items'
  ) {
    return 'none'
  }
  if (operator === 'has-length') return 'length'
  if (operator === 'in' || operator === 'not-in') return 'list'
  return 'single'
}

export function queryBuilderOperatorHasNoValue(operator: string) {
  return queryBuilderOperatorArity(operator) === 'none'
}

export function parseQueryBuilderValue(
  rawValue: string,
  valueType: QueryBuilderValueType,
  options: QueryBuilderValueParseOptions = {},
): unknown {
  const arity = queryBuilderOperatorArity(options.operator ?? '')
  if (arity === 'none') return null
  if (arity === 'length') return parseArrayLength(rawValue)
  if (arity === 'list') return parseListValue(rawValue, valueType, options)
  if (valueType === 'null') return null
  return parseScalarValue(rawValue, valueType, options)
}

export function validateQueryBuilderValue(
  rawValue: string,
  valueType: QueryBuilderValueType,
  options: QueryBuilderValueParseOptions = {},
): QueryBuilderValueValidation {
  try {
    return { ok: true, value: parseQueryBuilderValue(rawValue, valueType, options) }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Enter a valid value.',
    }
  }
}

export function queryBuilderValueTypeLabel(valueType: QueryBuilderValueType) {
  if (valueType === 'uuid') return 'GUID / UUID'
  if (valueType === 'objectId') return 'ObjectId'
  if (valueType === 'date') return 'Date / time'
  if (valueType === 'json') return 'JSON'
  return valueType
}

export function dateTimeLocalToUtcIso(value: string) {
  const parsed = new Date(value)
  if (!value || !Number.isFinite(parsed.getTime())) {
    throw new QueryBuilderValueError('Choose a valid local date and time.')
  }
  return parsed.toISOString()
}

export function utcIsoToDateTimeLocal(value: string) {
  const normalized = normalizeIsoDate(value)
  const date = new Date(normalized)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

export function normalizeIsoDate(value: string) {
  const trimmed = unwrapConstructor(value, 'ISODate')
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00.000Z`
  }
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(trimmed)) {
    throw new QueryBuilderValueError('Enter an ISO-8601 date with a timezone, or YYYY-MM-DD.')
  }
  const parsed = new Date(trimmed)
  if (!Number.isFinite(parsed.getTime())) {
    throw new QueryBuilderValueError('Enter a valid ISO-8601 date.')
  }
  return parsed.toISOString()
}

export function normalizeUuid(value: string) {
  const trimmed = unwrapConstructor(value, 'UUID')
  if (!UUID_PATTERN.test(trimmed)) {
    throw new QueryBuilderValueError('Enter a canonical GUID/UUID (8-4-4-4-12).')
  }
  return trimmed.toLowerCase()
}

export function normalizeObjectId(value: string) {
  const trimmed = unwrapConstructor(value, 'ObjectId')
  if (!OBJECT_ID_PATTERN.test(trimmed)) {
    throw new QueryBuilderValueError('Enter a 24-character hexadecimal ObjectId.')
  }
  return trimmed.toLowerCase()
}

function parseArrayLength(value: string) {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    throw new QueryBuilderValueError('Enter a non-negative whole-number array length.')
  }
  const parsed = Number(trimmed)
  if (!Number.isSafeInteger(parsed)) {
    throw new QueryBuilderValueError('Array length must be a safe non-negative integer.')
  }
  return parsed
}

function parseListValue(
  rawValue: string,
  valueType: QueryBuilderValueType,
  options: QueryBuilderValueParseOptions,
) {
  if (valueType === 'json') {
    const parsed = parseJson(rawValue)
    if (!Array.isArray(parsed)) {
      throw new QueryBuilderValueError('Enter a JSON array for this operator.')
    }
    return parsed
  }
  const values = rawValue.split(',').map((part) => part.trim()).filter(Boolean)
  if (values.length === 0) {
    throw new QueryBuilderValueError('Enter at least one comma-separated value.')
  }
  return values.map((value) => parseScalarValue(value, valueType, options))
}

function parseScalarValue(
  rawValue: string,
  valueType: QueryBuilderValueType,
  options: QueryBuilderValueParseOptions,
) {
  if (valueType === 'null') return null
  if (options.allowEnvironmentToken && isEnvironmentToken(rawValue)) return rawValue.trim()
  if (valueType === 'string') return rawValue
  if (valueType === 'number') {
    const trimmed = rawValue.trim()
    const parsed = Number(trimmed)
    if (!trimmed || !Number.isFinite(parsed)) {
      throw new QueryBuilderValueError('Enter a finite number.')
    }
    return parsed
  }
  if (valueType === 'boolean') {
    const normalized = rawValue.trim().toLowerCase()
    if (normalized !== 'true' && normalized !== 'false') {
      throw new QueryBuilderValueError('Choose true or false.')
    }
    return normalized === 'true'
  }
  if (valueType === 'date') return normalizeIsoDate(rawValue)
  if (valueType === 'uuid') return normalizeUuid(rawValue)
  if (valueType === 'objectId') return normalizeObjectId(rawValue)
  if (valueType === 'json') return parseJson(rawValue)
  return null
}

function parseJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Invalid JSON.'
    throw new QueryBuilderValueError(`Enter valid JSON. ${detail}`)
  }
}

function unwrapConstructor(value: string, constructorName: string) {
  const trimmed = value.trim()
  const match = new RegExp(`^${constructorName}\\(["']([^"']+)["']\\)$`, 'i').exec(trimmed)
  return match?.[1] ?? trimmed
}

function isEnvironmentToken(value: string) {
  return /^\s*\{\{[A-Za-z_][A-Za-z0-9_]*\}\}\s*$/.test(value)
}
