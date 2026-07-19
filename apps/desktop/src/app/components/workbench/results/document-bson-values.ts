import type { DocumentValueType } from './document-grid-model'

export interface DocumentBsonScalarInfo {
  type: DocumentValueType
  label: string
}

export function bsonScalarInfo(value: unknown): DocumentBsonScalarInfo | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  if (typeof value.$oid === 'string') {
    return { type: 'objectid', label: `ObjectId("${value.$oid}")` }
  }

  if (typeof value.$uuid === 'string') {
    return { type: 'uuid', label: `UUID("${value.$uuid}")` }
  }

  if (typeof value.$date === 'string') {
    return { type: 'date', label: `ISODate("${value.$date}")` }
  }

  if (isRecord(value.$date) && typeof value.$date.$numberLong === 'string') {
    return { type: 'date', label: dateLabelFromMilliseconds(value.$date.$numberLong) }
  }

  if (typeof value.$numberDecimal === 'string') {
    return { type: 'decimal', label: `Decimal128("${value.$numberDecimal}")` }
  }

  if (typeof value.$numberLong === 'string') {
    return { type: 'number', label: `NumberLong("${value.$numberLong}")` }
  }

  if (typeof value.$numberInt === 'string') {
    return { type: 'number', label: value.$numberInt }
  }

  if (typeof value.$numberDouble === 'string') {
    return { type: 'number', label: value.$numberDouble }
  }

  if (isRecord(value.$binary)) {
    const subType = typeof value.$binary.subType === 'string' ? value.$binary.subType : undefined
    return { type: 'binary', label: subType ? `Binary(${subType})` : 'Binary' }
  }

  if (isRecord(value.$regularExpression)) {
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

  if (isRecord(value.$timestamp)) {
    const timestamp = value.$timestamp
    const t = typeof timestamp.t === 'number' ? timestamp.t : timestamp.t
    const i = typeof timestamp.i === 'number' ? timestamp.i : timestamp.i
    return { type: 'timestamp', label: `Timestamp(${String(t)}, ${String(i)})` }
  }

  if (value.$minKey === 1) {
    return { type: 'object', label: 'MinKey' }
  }

  if (value.$maxKey === 1) {
    return { type: 'object', label: 'MaxKey' }
  }

  return undefined
}

export function isBsonDateValue(value: unknown) {
  return (
    isRecord(value) &&
    (typeof value.$date === 'string' ||
      (isRecord(value.$date) && typeof value.$date.$numberLong === 'string'))
  )
}

export function isBsonObjectIdValue(value: unknown) {
  return isRecord(value) && typeof value.$oid === 'string'
}

export function isBsonUuidValue(value: unknown) {
  return isRecord(value) && typeof value.$uuid === 'string'
}

export function isBsonNumberValue(value: unknown) {
  return (
    isRecord(value) &&
    (typeof value.$numberLong === 'string' ||
      typeof value.$numberInt === 'string' ||
      typeof value.$numberDouble === 'string')
  )
}

function dateLabelFromMilliseconds(value: string) {
  const milliseconds = Number(value)

  if (!Number.isFinite(milliseconds)) {
    return `Date(${value})`
  }

  return `ISODate("${new Date(milliseconds).toISOString()}")`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
