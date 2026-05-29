export function formatResultCellValue(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  const temporalValue = formatTemporalCellValue(value)
  if (temporalValue) {
    return temporalValue
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function formatTemporalCellValue(value: unknown): string | undefined {
  if (value instanceof Date) {
    return formatIsoLikeTemporal(value.toISOString())
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  const extendedDate = record.$date

  if (extendedDate !== undefined) {
    return formatExtendedJsonDate(extendedDate)
  }

  const keys = Object.keys(record)
  if (keys.length === 1 && keys[0] === 'date') {
    return formatExtendedJsonDate(record.date)
  }

  return undefined
}

function formatExtendedJsonDate(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return formatIsoLikeTemporal(value)
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatIsoLikeTemporal(new Date(value).toISOString())
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const numberLong = (value as Record<string, unknown>).$numberLong
    if (typeof numberLong === 'string') {
      const millis = Number(numberLong)
      return Number.isFinite(millis)
        ? formatIsoLikeTemporal(new Date(millis).toISOString())
        : undefined
    }
  }

  return undefined
}

function formatIsoLikeTemporal(value: string): string | undefined {
  const trimmed = value.trim()
  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})(?:[T\s](\d{2}:\d{2}:\d{2}(?:\.\d+)?)(Z|[+-]\d{2}:?\d{2})?)?$/,
  )

  if (!match) {
    return undefined
  }

  const [, date, time, rawOffset] = match
  if (!time) {
    return date
  }

  const offset = normalizeOffset(rawOffset)
  return `${date} ${time}${offset ? ` ${offset}` : ''}`
}

function normalizeOffset(value: string | undefined): string {
  if (!value) {
    return ''
  }

  if (value === 'Z') {
    return '+00:00'
  }

  if (/^[+-]\d{4}$/.test(value)) {
    return `${value.slice(0, 3)}:${value.slice(3)}`
  }

  return value
}
