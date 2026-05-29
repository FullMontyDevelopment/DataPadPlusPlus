import type { MongoBuilderValueType } from '@datapadplusplus/shared-types'
import type { FieldDragPayload } from '../results/field-drag'
import { rowId } from './MongoBuilderSection.types'

export function mongoFilterRow(groupId: string | undefined, field = '') {
  return {
    id: rowId('filter'),
    enabled: true,
    field,
    groupId,
    operator: 'eq' as const,
    value: '',
    valueType: 'string' as const,
  }
}

export function mongoFilterRowFromDroppedField(
  groupId: string | undefined,
  field: string,
  payload: FieldDragPayload,
) {
  const valueType = mongoBuilderValueType(payload.value, payload.valueType)

  return {
    ...mongoFilterRow(groupId, field),
    operator: valueType === 'date' ? 'gte' as const : 'eq' as const,
    value: mongoBuilderValue(payload.value, valueType),
    valueType,
  }
}

function mongoBuilderValueType(
  value: unknown,
  dragValueType: string | undefined,
): MongoBuilderValueType {
  if (dragValueType === 'date') {
    return 'date'
  }

  if (dragValueType === 'objectid' || dragValueType === 'objectId') {
    return 'objectId'
  }

  if (dragValueType === 'number' || typeof value === 'number') {
    return 'number'
  }

  if (dragValueType === 'boolean' || typeof value === 'boolean') {
    return 'boolean'
  }

  if (dragValueType === 'null' || value === null) {
    return 'null'
  }

  if (
    dragValueType === 'object' ||
    dragValueType === 'array' ||
    (typeof value === 'object' && value !== null)
  ) {
    return 'json'
  }

  return 'string'
}

function mongoBuilderValue(value: unknown, valueType: MongoBuilderValueType) {
  if (valueType === 'null') {
    return ''
  }

  if (valueType === 'date') {
    return mongoDateInput(value)
  }

  if (valueType === 'objectId') {
    return mongoObjectIdInput(value)
  }

  if (valueType === 'number') {
    return mongoNumberInput(value)
  }

  if (valueType === 'json') {
    return JSON.stringify(value ?? null)
  }

  return value === undefined || value === null ? '' : String(value)
}

function mongoDateInput(value: unknown) {
  if (isRecord(value)) {
    if (typeof value.$date === 'string') {
      return value.$date
    }

    if (isRecord(value.$date) && typeof value.$date.$numberLong === 'string') {
      const milliseconds = Number(value.$date.$numberLong)
      return Number.isFinite(milliseconds)
        ? new Date(milliseconds).toISOString()
        : value.$date.$numberLong
    }
  }

  const label = value === undefined || value === null ? '' : String(value)
  const isoDate = label.match(/ISODate\("([^"]+)"\)/)
  return isoDate?.[1] ?? label
}

function mongoObjectIdInput(value: unknown) {
  if (isRecord(value) && typeof value.$oid === 'string') {
    return value.$oid
  }

  const label = value === undefined || value === null ? '' : String(value)
  const objectId = label.match(/ObjectId\("([^"]+)"\)/)
  return objectId?.[1] ?? label
}

function mongoNumberInput(value: unknown) {
  if (isRecord(value)) {
    for (const key of ['$numberLong', '$numberInt', '$numberDouble']) {
      if (typeof value[key] === 'string') {
        return value[key]
      }
    }
  }

  return value === undefined || value === null ? '' : String(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
