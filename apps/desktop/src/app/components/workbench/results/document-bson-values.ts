import type { DocumentValueType } from './document-grid-model'

export interface DocumentBsonScalarInfo {
  type: DocumentValueType
  label: string
}

export function bsonScalarInfo(value: unknown): DocumentBsonScalarInfo | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  if (hasOnlyKey(value, '$oid') && typeof value.$oid === 'string') {
    return { type: 'objectid', label: `ObjectId("${value.$oid}")` }
  }

  if (hasOnlyKey(value, '$uuid') && typeof value.$uuid === 'string') {
    return { type: 'uuid', label: `UUID("${value.$uuid}")` }
  }

  if (hasOnlyKey(value, '$guid') && typeof value.$guid === 'string') {
    return { type: 'guid', label: `GUID("${value.$guid}")` }
  }

  if (hasOnlyKey(value, '$date') && typeof value.$date === 'string') {
    return { type: 'date', label: `ISODate("${value.$date}")` }
  }

  if (
    hasOnlyKey(value, '$date') &&
    isRecord(value.$date) &&
    hasOnlyKey(value.$date, '$numberLong') &&
    typeof value.$date.$numberLong === 'string'
  ) {
    return { type: 'date', label: dateLabelFromMilliseconds(value.$date.$numberLong) }
  }

  if (hasOnlyKey(value, '$numberDecimal') && typeof value.$numberDecimal === 'string') {
    return { type: 'decimal', label: `Decimal128("${value.$numberDecimal}")` }
  }

  if (hasOnlyKey(value, '$numberLong') && typeof value.$numberLong === 'string') {
    return { type: 'number', label: `NumberLong("${value.$numberLong}")` }
  }

  if (hasOnlyKey(value, '$numberInt') && typeof value.$numberInt === 'string') {
    return { type: 'number', label: value.$numberInt }
  }

  if (hasOnlyKey(value, '$numberDouble') && typeof value.$numberDouble === 'string') {
    return { type: 'number', label: value.$numberDouble }
  }

  if (hasOnlyKey(value, '$binary') && typeof value.$binary === 'string') {
    return { type: 'binary', label: `Binary(${base64ByteLength(value.$binary)} bytes)` }
  }

  if (hasOnlyKey(value, '$binary') && isRecord(value.$binary)) {
    const subType = typeof value.$binary.subType === 'string' ? value.$binary.subType : undefined
    return { type: 'binary', label: subType ? `Binary(${subType})` : 'Binary' }
  }

  if (hasOnlyKey(value, '$regularExpression') && isRecord(value.$regularExpression)) {
    const pattern =
      typeof value.$regularExpression.pattern === 'string'
        ? value.$regularExpression.pattern
        : ''
    const options =
      typeof value.$regularExpression.options === 'string'
        ? value.$regularExpression.options
        : ''
    return { type: 'regex', label: `/${pattern}/${options}` }
  }

  if (hasOnlyKey(value, '$timestamp') && isRecord(value.$timestamp)) {
    const timestamp = value.$timestamp
    const t = typeof timestamp.t === 'number' ? timestamp.t : timestamp.t
    const i = typeof timestamp.i === 'number' ? timestamp.i : timestamp.i
    return { type: 'timestamp', label: `Timestamp(${String(t)}, ${String(i)})` }
  }

  if (hasOnlyKey(value, '$minKey') && value.$minKey === 1) {
    return { type: 'object', label: 'MinKey' }
  }

  if (hasOnlyKey(value, '$maxKey') && value.$maxKey === 1) {
    return { type: 'object', label: 'MaxKey' }
  }

  return undefined
}

export function isBsonDateValue(value: unknown) {
  return (
    isRecord(value) &&
    hasOnlyKey(value, '$date') &&
    (typeof value.$date === 'string' ||
      (isRecord(value.$date) && typeof value.$date.$numberLong === 'string'))
  )
}

export function isBsonObjectIdValue(value: unknown) {
  return isRecord(value) && hasOnlyKey(value, '$oid') && typeof value.$oid === 'string'
}

export function isBsonUuidValue(value: unknown) {
  return isRecord(value) && hasOnlyKey(value, '$uuid') && typeof value.$uuid === 'string'
}

export function isLiteDbGuidValue(value: unknown) {
  return isRecord(value) && hasOnlyKey(value, '$guid') && typeof value.$guid === 'string'
}

export function isBsonNumberValue(value: unknown) {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    ((hasOnlyKey(value, '$numberLong') && typeof value.$numberLong === 'string') ||
      (hasOnlyKey(value, '$numberInt') && typeof value.$numberInt === 'string') ||
      (hasOnlyKey(value, '$numberDouble') && typeof value.$numberDouble === 'string'))
  )
}

function dateLabelFromMilliseconds(value: string) {
  const milliseconds = Number(value)

  if (!Number.isFinite(milliseconds)) {
    return `Date(${value})`
  }

  const date = new Date(milliseconds)
  return Number.isFinite(date.getTime())
    ? `ISODate("${date.toISOString()}")`
    : `Date(${value})`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOnlyKey(value: Record<string, unknown>, key: string) {
  const keys = Object.keys(value)
  return keys.length === 1 && keys[0] === key
}

function base64ByteLength(value: string) {
  const normalized = value.replace(/=+$/, '')
  return Math.max(0, Math.floor((normalized.length * 3) / 4))
}
