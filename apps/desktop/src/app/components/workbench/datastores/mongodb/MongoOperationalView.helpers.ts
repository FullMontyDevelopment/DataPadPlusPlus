export type JsonRecord = Record<string, unknown>

export function asMongoRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function mongoRecordArray(value: unknown) {
  return (Array.isArray(value) ? value : [])
    .map(asMongoRecord)
    .filter((record) => Object.keys(record).length > 0)
}

export function mongoString(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }
  return typeof value === 'string' ? value : String(value)
}

export function mongoNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const number = Number(value)
    return Number.isFinite(number) ? number : 0
  }
  const record = asMongoRecord(value)
  return mongoNumber(record.$numberLong ?? record.$numberInt ?? record.$numberDouble)
}

export function formatMongoBytes(value: number) {
  if (!value) {
    return '0 B'
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unitIndex = 0
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024
    unitIndex += 1
  }
  return `${amount.toFixed(amount >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

export function humanizeMongoMetric(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
