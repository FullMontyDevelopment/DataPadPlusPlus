import { mongoPipelineStageRows } from './MongoPipelineView.helpers'

type JsonRecord = Record<string, unknown>

export function extractIndexes(payload: JsonRecord) {
  const indexes = payload.indexes
  const result = asRecord(payload.result)
  const cursor = asRecord(result.cursor)
  const firstBatch = cursor.firstBatch

  if (Array.isArray(indexes)) {
    return indexes.map(asRecord).filter((index) => Object.keys(index).length > 0)
  }

  return Array.isArray(firstBatch) ? firstBatch.map(asRecord) : []
}

export function normalizeIndexList(value: unknown) {
  if (!Array.isArray(value)) {
    return extractIndexes({ indexes: value })
  }

  return value.map((item) => {
    if (typeof item === 'string') {
      return { name: item }
    }

    return asRecord(item)
  }).filter((item) => Object.keys(item).length > 0)
}

export function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function metadataSummary(record: JsonRecord, omittedKeys: string[]) {
  const entries = Object.entries(withoutKeys(record, omittedKeys))
    .filter(([, value]) => value !== undefined && value !== null && value !== '')

  if (entries.length === 0) {
    return 'Default options'
  }

  return entries
    .slice(0, 4)
    .map(([key, value]) => `${humanizeMetric(key)}: ${shortValueSummary(value)}`)
    .join(', ')
}

export function pipelineSummary(value: unknown) {
  const pipeline = Array.isArray(value) ? value : []
  const firstStage = mongoPipelineStageRows(pipeline)[0]
  return firstStage ? `${firstStage.operator} - ${firstStage.summary}` : 'No pipeline stages'
}

export function documentFieldSummary(document: JsonRecord) {
  const fields = Object.keys(document).filter((field) => field !== '_id')
  if (fields.length === 0) {
    return 'Only _id'
  }

  const visible = fields.slice(0, 5)
  const remaining = fields.length - visible.length
  return remaining > 0
    ? `${visible.join(', ')} +${remaining} more`
    : visible.join(', ')
}

export function indexKeyPatternText(value: unknown) {
  const key = asRecord(value)
  const entries = Object.entries(key)
  if (entries.length === 0) {
    return stringValue(value) || 'No key pattern'
  }

  return entries
    .map(([field, direction]) => `${field} ${indexDirectionText(direction)}`)
    .join(', ')
}

export function indexOptionsSummary(index: JsonRecord, omittedKeys: string[]) {
  const entries = Object.entries(withoutKeys(index, omittedKeys))
    .filter(([, value]) => value !== undefined && value !== null && value !== '' && value !== false)

  if (entries.length === 0) {
    return 'Default options'
  }

  return entries
    .slice(0, 5)
    .map(([key, value]) => indexOptionText(key, value))
    .join(', ')
}

export function numericValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  const record = asRecord(value)
  const extendedNumber = record.$numberLong ?? record.$numberInt ?? record.$numberDouble
  return typeof extendedNumber === 'string' ? numericValue(extendedNumber) : 0
}

export function formatBytes(value: number) {
  if (!value) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let current = value
  let unitIndex = 0
  while (current >= 1024 && unitIndex < units.length - 1) {
    current /= 1024
    unitIndex += 1
  }

  return `${current >= 10 || unitIndex === 0 ? current.toFixed(0) : current.toFixed(1)} ${units[unitIndex]}`
}

export function stringValue(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  return compactJson(value)
}

function withoutKeys(record: JsonRecord, keys: string[]) {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)))
}

function indexDirectionText(value: unknown) {
  if (value === 1 || value === '1') {
    return 'ascending'
  }

  if (value === -1 || value === '-1') {
    return 'descending'
  }

  return stringValue(value)
}

function indexOptionText(key: string, value: unknown) {
  if (typeof value === 'boolean') {
    return value ? humanizeMetric(key) : ''
  }

  if (key === 'partialFilterExpression') {
    return `Partial filter: ${Object.keys(asRecord(value)).join(', ') || 'configured'}`
  }

  if (key === 'collation') {
    const collation = asRecord(value)
    return `Collation: ${stringValue(collation.locale) || 'configured'}`
  }

  if (key === 'expireAfterSeconds') {
    return `TTL: ${stringValue(value)}s`
  }

  return `${humanizeMetric(key)}: ${shortValueSummary(value)}`
}

function shortValueSummary(value: unknown) {
  if (Array.isArray(value)) {
    return `${value.length} item(s)`
  }

  if (typeof value === 'object' && value !== null) {
    return `${Object.keys(value).length} field(s)`
  }

  if (typeof value === 'boolean') {
    return booleanText(value)
  }

  return stringValue(value)
}

function booleanText(value: unknown) {
  return value === undefined ? '' : value ? 'Yes' : 'No'
}

function compactJson(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function humanizeMetric(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}
