type JsonRecord = Record<string, unknown>

export function mongoSchemaSampleSize(payload: JsonRecord, fields: JsonRecord[]) {
  return numericValue(payload.sampleSize) || maxFieldPresence(fields)
}

export function requiredFieldsForValidator(payload: JsonRecord) {
  const validator = asRecord(payload.validator ?? asRecord(payload.options).validator)
  const schema = asRecord(validator.$jsonSchema)
  const required = schema.required
  return Array.isArray(required)
    ? required.map(String).filter(Boolean)
    : []
}

export function fieldTypeNames(field: JsonRecord) {
  const distribution = asRecord(field.typeDistribution)
  const distributionTypes = Object.keys(distribution)
  if (distributionTypes.length > 0) {
    return distributionTypes
  }

  const types = field.types
  if (Array.isArray(types)) {
    return types.map(String).filter(Boolean)
  }

  const single = stringValue(field.type)
  return single ? [single] : []
}

export function fieldTypesText(field: JsonRecord) {
  const distribution = asRecord(field.typeDistribution)
  const entries = Object.entries(distribution)
  if (entries.length > 0) {
    return entries
      .map(([type, count]) => `${type} (${numericValue(count)})`)
      .join(', ')
  }

  const names = fieldTypeNames(field)
  return names.length ? names.join(', ') : 'unknown'
}

export function fieldPresenceText(field: JsonRecord, sampleSize: number) {
  const presence = fieldPresenceCount(field)
  if (!presence) {
    return ''
  }

  if (!sampleSize) {
    return String(presence)
  }

  const percent = Math.round((presence / sampleSize) * 100)
  return `${presence}/${sampleSize} (${percent}%)`
}

export function fieldWarningsText(field: JsonRecord, sampleSize: number) {
  const warnings = [
    ...(fieldTypeNames(field).length > 1 ? ['Mixed BSON types'] : []),
    ...(sampleSize && fieldPresenceCount(field) < sampleSize ? ['Missing from some documents'] : []),
    ...arrayOfStrings(field.warnings),
  ]
  return warnings.length ? warnings.join(', ') : ''
}

export function generateValidatorFromFields(fields: JsonRecord[], sampleSize: number): JsonRecord {
  const properties: JsonRecord = {}
  const required: string[] = []

  for (const field of fields) {
    const path = stringValue(field.path)
    if (!path || path === '_id') {
      continue
    }
    const segments = path.split('.').filter(Boolean)
    if (segments.length === 0) {
      continue
    }
    addSchemaProperty(properties, segments, fieldTypeNames(field))
    if (!path.includes('.') && sampleSize > 0 && fieldPresenceCount(field) >= sampleSize) {
      required.push(path)
    }
  }

  const schema: JsonRecord = {
    bsonType: 'object',
    properties,
  }
  if (required.length > 0) {
    schema.required = required
  }

  return { $jsonSchema: schema }
}

function maxFieldPresence(fields: JsonRecord[]) {
  return fields.reduce((max, field) => Math.max(max, fieldPresenceCount(field)), 0)
}

function fieldPresenceCount(field: JsonRecord) {
  return numericValue(field.presenceCount ?? field.count)
}

function addSchemaProperty(target: JsonRecord, segments: string[], types: string[]) {
  const [head, ...rest] = segments
  if (!head) {
    return
  }

  if (rest.length === 0) {
    target[head] = {
      bsonType: types.length === 1 ? types[0] : types,
    }
    return
  }

  const child = asRecord(target[head])
  const childProperties = asRecord(child.properties)
  target[head] = {
    bsonType: child.bsonType ?? 'object',
    ...child,
    properties: childProperties,
  }
  addSchemaProperty(childProperties, rest, types)
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function numericValue(value: unknown): number {
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

function stringValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}
