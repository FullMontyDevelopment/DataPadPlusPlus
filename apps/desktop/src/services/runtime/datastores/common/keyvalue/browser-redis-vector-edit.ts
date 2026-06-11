import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'

export function redisVectorEditRequest(request: DataEditPlanRequest) {
  const key = request.target.key ?? '<key>'

  if (request.editKind === 'vector-add-member') {
    const values = vectorValues(request)
    const vector = values?.map((value) => String(value)).join(' ') ?? '<vector>'
    const dimension = values?.length ?? '<dim>'
    const attributes = vectorAddAttributes(request)
    return `VADD ${key} VALUES ${dimension} ${vector} ${vectorMemberName(request) ?? '<element>'}${attributes ? ` SETATTR ${attributes}` : ''}`
  }

  if (request.editKind === 'vector-remove-member') {
    return `VREM ${key} ${vectorMemberName(request) ?? '<element>'}`
  }

  if (request.editKind === 'vector-set-attributes') {
    return `VSETATTR ${key} ${vectorMemberName(request) ?? '<element>'} ${vectorAttributes(request) ?? '""'}`
  }

  return undefined
}

function vectorMemberName(request: DataEditPlanRequest) {
  return nonEmptyCommandArg(
    request.target.documentId ??
      request.changes[0]?.field ??
      request.changes[0]?.path?.[0] ??
      request.changes[0]?.newName ??
      vectorMemberFromValue(request.changes[0]?.value),
  )
}

function vectorMemberFromValue(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  return record.element ?? record.member ?? record.id
}

function vectorValues(request: DataEditPlanRequest) {
  const value = request.changes[0]?.value
  const structuredValues = vectorValuesFromValue(value)
  if (structuredValues) {
    return structuredValues
  }

  const values = request.changes
    .map((change) => vectorNumber(change.value))
    .filter((value): value is number => value !== undefined)
  return values.length ? values : undefined
}

function vectorValuesFromValue(value: unknown) {
  if (Array.isArray(value)) {
    return vectorNumbersFromArray(value)
  }

  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  for (const key of ['vector', 'values', 'embedding']) {
    const values = record[key]
    if (Array.isArray(values)) {
      return vectorNumbersFromArray(values)
    }
  }

  return undefined
}

function vectorNumbersFromArray(values: unknown[]) {
  const numbers = values.map(vectorNumber)
  if (!numbers.length || numbers.some((value) => value === undefined)) {
    return undefined
  }

  return numbers as number[]
}

function vectorNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Object.is(value, -0) ? 0 : value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function vectorAddAttributes(request: DataEditPlanRequest) {
  const value = request.changes[0]?.value
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  const record = value as Record<string, unknown>
  const attributes = record.attributes ?? record.attrs ?? record.metadata
  return attributes === undefined ? undefined : vectorAttributesFromValue(attributes)
}

function vectorAttributes(request: DataEditPlanRequest) {
  return vectorAttributesFromValue(request.changes[0]?.value)
}

function vectorAttributesFromValue(value: unknown) {
  if (value === null || value === '') {
    return '""'
  }

  if (typeof value === 'string') {
    return value
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const nested = record.attributes ?? record.attrs ?? record.metadata
    if (nested !== undefined) {
      return vectorAttributesFromValue(nested)
    }
  }

  return value === undefined ? undefined : JSON.stringify(value)
}

function nonEmptyCommandArg(value: unknown) {
  const arg = commandArg(value)
  return arg?.trim() ? arg : undefined
}

function commandArg(value: unknown) {
  if (value === undefined) {
    return undefined
  }

  return typeof value === 'string' ? value : JSON.stringify(value)
}
