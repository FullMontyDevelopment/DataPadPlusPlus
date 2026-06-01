import type { DocumentValueType } from './document-grid-model'

export function editableValue(value: unknown) {
  if (value === null) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value)
}

export function parseEditedValue(value: string, type: DocumentValueType) {
  if (type === 'objectid') {
    return { $oid: value.trim() }
  }

  if (type === 'date') {
    return { $date: value.trim() }
  }

  if (type === 'decimal') {
    return { $numberDecimal: value.trim() }
  }

  if (type === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (type === 'boolean') {
    return value.toLowerCase() === 'true'
  }

  if (type === 'null') {
    return null
  }

  if (type === 'object' || type === 'array') {
    try {
      return JSON.parse(value)
    } catch {
      return type === 'array' ? [] : {}
    }
  }

  return value
}

export function coerceValue(value: unknown, type: DocumentValueType) {
  if (type === 'objectid') {
    return { $oid: typeof value === 'string' ? value : '' }
  }

  if (type === 'date') {
    return { $date: typeof value === 'string' ? value : new Date().toISOString() }
  }

  if (type === 'decimal') {
    return { $numberDecimal: typeof value === 'number' ? String(value) : '0' }
  }

  if (type === 'string') {
    return value === null ? '' : String(value)
  }

  if (type === 'number') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }

  if (type === 'boolean') {
    return Boolean(value)
  }

  if (type === 'null') {
    return null
  }

  if (type === 'array') {
    return Array.isArray(value) ? value : []
  }

  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : {}
}
