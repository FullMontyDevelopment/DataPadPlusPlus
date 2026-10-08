import type { LiteDbFindBuilderState } from '@datapadplusplus/shared-types'
import type { FieldDragPayload } from '../../results/field-drag'
import { bsonScalarInfo } from '../../results/document-bson-values'
import { editableValue } from '../../results/document-value-editing'

export function liteDbFilterFromDrop(payload: FieldDragPayload, groupId?: string): LiteDbFindBuilderState['filters'][number] {
  const value = payload.value
  const nativeType = bsonScalarInfo(value)?.type
  const valueType = nativeType === 'date' ? 'date'
    : nativeType === 'guid' ? 'uuid'
      : nativeType === 'objectid' ? 'objectId'
        : value === null ? 'null'
          : typeof value === 'object' ? 'json'
            : typeof value === 'number' ? 'number'
              : typeof value === 'boolean' ? 'boolean' : 'string'
  return {
    id: crypto.randomUUID(), enabled: true, groupId, field: payload.fieldPath,
    operator: valueType === 'date' ? 'gte' : 'eq', valueType,
    // Numeric wrappers remain JSON: converting int64/decimal to a JS number loses precision.
    value: valueType === 'json' ? JSON.stringify(value) : value === undefined ? '' : editableValue(value),
  }
}
