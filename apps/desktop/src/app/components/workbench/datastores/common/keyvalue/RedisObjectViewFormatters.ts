import type { JsonRecord } from './RedisObjectViewTypes'

export function listSummary(value: unknown) {
  const items = Array.isArray(value) ? value : []
  if (items.length === 0) {
    return 'None'
  }

  return items
    .slice(0, 5)
    .map((item) => typeof item === 'string' ? item : displayValueSummary(item))
    .join(', ')
}

export function displayValueSummary(value: unknown): string {
  if (Array.isArray(value)) {
    return listSummary(value)
  }

  if (value && typeof value === 'object') {
    const record = value as JsonRecord
    const named = stringValue(record.name ?? record.key ?? record.channel ?? record.id)
    if (named) {
      return named
    }

    const keys = Object.keys(record)
    return keys.length ? `${keys.length} field(s): ${keys.slice(0, 4).map(humanize).join(', ')}` : 'Object'
  }

  return stringValue(value)
}

export function detailSummary(value: unknown) {
  if (!value || typeof value !== 'object') {
    return stringValue(value)
  }

  const record = value as JsonRecord
  return Object.entries(record)
    .slice(0, 4)
    .map(([key, item]) => `${humanize(key)}: ${displayValueSummary(item)}`)
    .join(', ')
}

export function arrayOfRecords(value: unknown) {
  return (Array.isArray(value) ? value : []).map(asRecord).filter(Boolean) as JsonRecord[]
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function stringValue(value: unknown): string {
  if (value === undefined || value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return compactJson(value)
}

export function compactJson(value: unknown): string {
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

export function redisDatabaseIndex(value: unknown): number | undefined {
  const text = stringValue(value)
  const match = /(?:DB\s*|db:)?(\d+)/i.exec(text)
  if (!match) {
    return undefined
  }

  return Number.parseInt(match[1] ?? '', 10)
}

export function redisDatabaseLabel(value: unknown) {
  const index = redisDatabaseIndex(value)
  if (index !== undefined && Number.isFinite(index)) {
    return `DB ${index}`
  }

  return stringValue(value)
}

export function redisTypeLabel(value: string) {
  switch (value) {
    case 'zset':
      return 'sorted set'
    case 'json':
      return 'JSON'
    case 'timeseries':
      return 'time series'
    case 'vectorset':
      return 'vector'
    case 'search-index':
      return 'search index'
    default:
      return value
  }
}

export function ttlText(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return ''
  }

  if (typeof value === 'number') {
    if (value < 0) {
      return value === -1 ? 'No limit' : 'Missing/expired'
    }

    return `${value}s`
  }

  return stringValue(value)
}

export function durationText(value: unknown) {
  if (typeof value !== 'number') {
    return stringValue(value)
  }

  if (value < 1000) {
    return `${value} us`
  }

  return `${(value / 1000).toFixed(1)} ms`
}

export function bytesText(value: unknown) {
  if (typeof value !== 'number') {
    return stringValue(value)
  }

  if (value < 1024) {
    return `${value} B`
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function booleanState(value: unknown) {
  if (typeof value === 'boolean') {
    return value ? 'Enabled' : 'Disabled'
  }

  return stringValue(value)
}

export function humanize(value: string) {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (match) => match.toUpperCase())
}
