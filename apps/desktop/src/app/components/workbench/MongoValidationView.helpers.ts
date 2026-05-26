type JsonRecord = Record<string, unknown>

export function mongoValidationViewKey(payload: JsonRecord) {
  const validator = payload.validator ?? asRecord(payload.options).validator ?? {}
  return [
    stringValue(payload.database),
    stringValue(payload.collection),
    compactJson(validator),
  ].join(':')
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

function compactJson(value: unknown) {
  return JSON.stringify(value)
}
