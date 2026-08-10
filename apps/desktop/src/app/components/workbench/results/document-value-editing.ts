import type { DocumentValueType } from './document-grid-model'

export type DocumentValueParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i
const UUID_PATTERN = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i
const INTEGER_PATTERN = /^-?\d+$/
const DECIMAL_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i
const BSON_NONFINITE_PATTERN = /^(?:NaN|-?Infinity)$/
const TIMEZONE_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i

export function editableValue(value: unknown) {
  if (value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (isRecord(value)) {
    for (const key of ['$oid', '$uuid', '$guid', '$numberDecimal', '$numberLong', '$numberInt', '$numberDouble']) {
      if (Object.keys(value).length === 1 && typeof value[key] === 'string') {
        return value[key]
      }
    }

    if (Object.keys(value).length === 1 && Object.hasOwn(value, '$date')) {
      if (typeof value.$date === 'string') {
        return value.$date
      }
      if (isRecord(value.$date) && typeof value.$date.$numberLong === 'string') {
        const date = new Date(Number(value.$date.$numberLong))
        return Number.isFinite(date.getTime()) ? date.toISOString() : value.$date.$numberLong
      }
    }
  }

  return JSON.stringify(value)
}

export function parseEditedValue(
  draft: string,
  type: DocumentValueType,
  originalValue?: unknown,
): DocumentValueParseResult {
  const value = draft.trim()

  if (type === 'objectid') {
    return OBJECT_ID_PATTERN.test(value)
      ? valid({ $oid: value.toLowerCase() })
      : invalid('ObjectId must contain exactly 24 hexadecimal characters.')
  }

  if (type === 'uuid' || type === 'guid') {
    if (!UUID_PATTERN.test(value)) {
      return invalid(`${type === 'guid' ? 'GUID' : 'UUID'} must use canonical 8-4-4-4-12 notation.`)
    }
    return valid(type === 'guid' ? { $guid: value.toLowerCase() } : { $uuid: value.toLowerCase() })
  }

  if (type === 'date') {
    if (!TIMEZONE_ISO_PATTERN.test(value)) {
      return invalid('Date must be an ISO-8601 value with Z or an explicit UTC offset.')
    }
    const date = new Date(value)
    return Number.isFinite(date.getTime())
      ? valid({ $date: date.toISOString() })
      : invalid('Date is outside the supported range.')
  }

  if (type === 'decimal') {
    return DECIMAL_PATTERN.test(value) || BSON_NONFINITE_PATTERN.test(value)
      ? valid({ $numberDecimal: value })
      : invalid('Decimal must be a valid base-10 number with an optional exponent.')
  }

  if (type === 'number') {
    return parseNumberValue(value, originalValue)
  }

  if (type === 'boolean') {
    if (value !== 'true' && value !== 'false') {
      return invalid('Boolean value must be true or false.')
    }
    return valid(value === 'true')
  }

  if (type === 'null') {
    return valid(null)
  }

  if (type === 'object' || type === 'array' || type === 'binary' || type === 'regex' || type === 'timestamp') {
    try {
      const parsed = JSON.parse(draft) as unknown
      if (type === 'array' && !Array.isArray(parsed)) {
        return invalid('Value must be a JSON array.')
      }
      if (type === 'object' && (!isRecord(parsed) || Array.isArray(parsed))) {
        return invalid('Value must be a JSON object.')
      }
      if (type === 'binary' && !isValidBinaryValue(parsed)) {
        return invalid('Binary value must use MongoDB or LiteDB canonical Extended JSON.')
      }
      if (type === 'regex' && !isValidRegexValue(parsed)) {
        return invalid('Regex value must contain $regularExpression with string pattern and options.')
      }
      if (type === 'timestamp' && !isValidTimestampValue(parsed)) {
        return invalid('Timestamp value must contain unsigned 32-bit integer t and i fields.')
      }
      return valid(parsed)
    } catch (error) {
      return invalid(error instanceof Error ? error.message : 'Value must be valid JSON.')
    }
  }

  return valid(draft)
}

export function coerceValue(value: unknown, type: DocumentValueType) {
  if (type === 'objectid') {
    return { $oid: typeof value === 'string' && OBJECT_ID_PATTERN.test(value) ? value : '000000000000000000000000' }
  }
  if (type === 'uuid') {
    return { $uuid: '00000000-0000-4000-8000-000000000000' }
  }
  if (type === 'guid') {
    return { $guid: '00000000-0000-4000-8000-000000000000' }
  }
  if (type === 'date') {
    return { $date: new Date().toISOString() }
  }
  if (type === 'decimal') {
    return { $numberDecimal: '0' }
  }
  if (type === 'string') {
    return value === null ? '' : String(value)
  }
  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
  }
  if (type === 'boolean') {
    return typeof value === 'boolean' ? value : false
  }
  if (type === 'null') {
    return null
  }
  if (type === 'array') {
    return Array.isArray(value) ? value : []
  }
  return isRecord(value) ? value : {}
}

export function dateTimeLocalToUtc(value: string): DocumentValueParseResult {
  if (!value) {
    return invalid('Choose a local date and time.')
  }
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? valid({ $date: date.toISOString() })
    : invalid('Choose a valid local date and time.')
}

function parseNumberValue(value: string, originalValue: unknown): DocumentValueParseResult {
  const wrapper = numericWrapper(originalValue)
  if (wrapper === '$numberLong' || wrapper === '$numberInt') {
    if (!INTEGER_PATTERN.test(value)) {
      return invalid('Integer value must contain digits only, with an optional leading minus sign.')
    }
    if (wrapper === '$numberInt') {
      const integer = BigInt(value)
      if (integer < -2147483648n || integer > 2147483647n) {
        return invalid('Int32 value must be between -2147483648 and 2147483647.')
      }
    }
    return valid({ [wrapper]: value })
  }

  if (wrapper === '$numberDouble') {
    if (BSON_NONFINITE_PATTERN.test(value)) {
      return valid({ $numberDouble: value })
    }
    if (!DECIMAL_PATTERN.test(value)) {
      return invalid('Double value must be a finite base-10 number.')
    }
    const parsed = Number(value)
    return Number.isFinite(parsed)
      ? valid({ $numberDouble: value })
      : invalid('Double value must be finite.')
  }

  if (!DECIMAL_PATTERN.test(value)) {
    return invalid('Number value must be finite.')
  }
  const parsed = Number(value)
  return Number.isFinite(parsed)
    ? valid(parsed)
    : invalid('Number value must be finite.')
}

function isValidBinaryValue(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length !== 1 || !Object.hasOwn(value, '$binary')) {
    return false
  }
  if (typeof value.$binary === 'string') {
    return isBase64(value.$binary)
  }
  return isRecord(value.$binary) &&
    typeof value.$binary.base64 === 'string' &&
    isBase64(value.$binary.base64) &&
    typeof value.$binary.subType === 'string' &&
    /^[a-f\d]{2}$/i.test(value.$binary.subType)
}

function isValidRegexValue(value: unknown) {
  return isRecord(value) &&
    Object.keys(value).length === 1 &&
    isRecord(value.$regularExpression) &&
    typeof value.$regularExpression.pattern === 'string' &&
    typeof value.$regularExpression.options === 'string'
}

function isValidTimestampValue(value: unknown) {
  return isRecord(value) &&
    Object.keys(value).length === 1 &&
    isRecord(value.$timestamp) &&
    isUint32(value.$timestamp.t) &&
    isUint32(value.$timestamp.i)
}

function isUint32(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 4_294_967_295
}

function isBase64(value: string) {
  return value.length % 4 === 0 && /^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(value)
}

function numericWrapper(value: unknown) {
  if (!isRecord(value) || Object.keys(value).length !== 1) {
    return undefined
  }
  return ['$numberLong', '$numberInt', '$numberDouble'].find(
    (key) => typeof value[key] === 'string',
  ) as '$numberLong' | '$numberInt' | '$numberDouble' | undefined
}

function valid(value: unknown): DocumentValueParseResult {
  return { ok: true, value }
}

function invalid(error: string): DocumentValueParseResult {
  return { ok: false, error }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
