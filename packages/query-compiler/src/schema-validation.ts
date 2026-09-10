export interface Schema {
  type?: string
  const?: unknown
  anyOf?: Schema[]
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  additionalProperties?: Schema | boolean
}

export function validateShape(value: unknown, schema: Schema, path = 'definition'): string | undefined {
  if ('const' in schema && value !== schema.const) return `${path}: unsupported value.`
  if (schema.anyOf && !schema.anyOf.some((option) => !validateShape(value, option, path))) {
    return `${path}: does not match a supported definition shape.`
  }
  if (!schema.type) return undefined
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path}: expected an array.`
    if (value.length > 10_000) return `${path}: too many entries.`
    for (const [index, item] of value.entries()) {
      const error = validateShape(item, schema.items ?? {}, `${path}[${index}]`)
      if (error) return error
    }
  } else if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path}: expected an object.`
    const object = value as Record<string, unknown>
    for (const field of schema.required ?? []) {
      if (!(field in object)) return `${path}.${field}: required.`
    }
    for (const [field, item] of Object.entries(object)) {
      if (['__proto__', 'prototype', 'constructor'].includes(field)) return `${path}: unsafe property.`
      const child = schema.properties?.[field]
      if (!child && schema.additionalProperties === false) return `${path}.${field}: unsupported property.`
      // TypeScript omits absent options; Rust Option fields may arrive as JSON null.
      // Treat only declared optional properties as absent, never required values.
      if (child && item == null && !schema.required?.includes(field)) continue
      const extra = typeof schema.additionalProperties === 'object' ? schema.additionalProperties : {}
      const error = validateShape(item, child ?? extra, `${path}.${field}`)
      if (error) return error
    }
  } else if (schema.type === 'null' ? value !== null : typeof value !== schema.type) {
    return `${path}: expected ${schema.type}.`
  } else if (schema.type === 'number' && !Number.isFinite(value)) return `${path}: expected a finite number.`
  return undefined
}
