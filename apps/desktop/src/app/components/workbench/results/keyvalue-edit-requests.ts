import type {
  ConnectionProfile,
  DataEditExecutionRequest,
  DataEditKind,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from './document-edit-context'
import { parseJsonValue } from './json-utils'

export function keyValueCanEdit(
  connection?: ConnectionProfile,
  editContext?: DocumentEditContext,
) {
  return Boolean(
    connection &&
      editContext &&
      (connection.engine === 'redis' || connection.engine === 'valkey') &&
      !connection.readOnly,
  )
}

export function buildKeyValueEditRequest({
  connection,
  editContext,
  editKind,
  key,
  newName,
  value,
}: {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  editKind: Extract<DataEditKind, 'set-key-value' | 'set-ttl' | 'delete-key' | 'rename-key' | 'persist-ttl'>
  key: string
  newName?: string
  value?: unknown
}): DataEditExecutionRequest | undefined {
  if (!keyValueCanEdit(connection, editContext) || !editContext) {
    return undefined
  }

  return {
    connectionId: editContext.connectionId,
    environmentId: editContext.environmentId,
    editKind,
    confirmationText: undefined,
    target: {
      objectKind: 'key',
      path: [],
      key,
    },
    changes:
      editKind === 'delete-key' || editKind === 'persist-ttl'
        ? []
        : editKind === 'rename-key'
          ? [
              {
                field: key,
                newName,
              },
            ]
        : [
            {
              value,
              valueType: valueTypeName(value),
            },
          ],
  }
}

export function buildRedisMemberEditRequest({
  connection,
  editContext,
  editKind,
  key,
  field,
  value,
}: {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  editKind: Extract<
    DataEditKind,
    | 'hash-set-field'
    | 'hash-delete-field'
    | 'list-set-index'
    | 'set-add-member'
    | 'set-remove-member'
    | 'zset-add-member'
    | 'zset-remove-member'
    | 'stream-add-entry'
    | 'stream-delete-entry'
    | 'timeseries-add-sample'
    | 'timeseries-delete-sample'
    | 'vector-add-member'
    | 'vector-remove-member'
    | 'vector-set-attributes'
  >
  key: string
  field?: string
  value?: unknown
}): DataEditExecutionRequest | undefined {
  if (!keyValueCanEdit(connection, editContext) || !editContext) {
    return undefined
  }

  return {
    connectionId: editContext.connectionId,
    environmentId: editContext.environmentId,
    editKind,
    target: {
      objectKind: redisMemberEditObjectKind(editKind),
      path: field ? [field] : [],
      key,
      ...(redisMemberEditUsesDocumentId(editKind) && field ? { documentId: field } : {}),
    },
    changes: [
      {
        field,
        value,
        valueType: valueTypeName(value),
      },
    ],
  }
}

export function buildRedisJsonPathEditRequest({
  connection,
  editContext,
  editKind,
  key,
  path,
  value,
}: {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  editKind: Extract<DataEditKind, 'json-set-path' | 'json-delete-path'>
  key: string
  path: string
  value?: unknown
}): DataEditExecutionRequest | undefined {
  if (
    !keyValueCanEdit(connection, editContext) ||
    !editContext ||
    connection?.engine !== 'redis' ||
    !path
  ) {
    return undefined
  }

  return {
    connectionId: editContext.connectionId,
    environmentId: editContext.environmentId,
    editKind,
    target: {
      objectKind: 'json-path',
      path: [path],
      key,
    },
    changes: [
      {
        field: path,
        path: [path],
        value,
        valueType: valueTypeName(value),
      },
    ],
  }
}

export function buildRedisMemberDeleteRequest({
  connection,
  editContext,
  key,
  member,
  rawValue,
  redisType,
}: {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  key: string
  member: string
  rawValue?: string
  redisType?: string
}): DataEditExecutionRequest | undefined {
  if (!keyValueCanEdit(connection, editContext) || !editContext) {
    return undefined
  }

  if (redisType === 'hash') {
    return buildRedisMemberEditRequest({
      connection,
      editContext,
      editKind: 'hash-delete-field',
      key,
      field: member,
    })
  }

  if (redisType === 'set') {
    return buildRedisMemberEditRequest({
      connection,
      editContext,
      editKind: 'set-remove-member',
      key,
      value: parseKeyValueInput(rawValue ?? member),
    })
  }

  if (redisType === 'zset') {
    return buildRedisMemberEditRequest({
      connection,
      editContext,
      editKind: 'zset-remove-member',
      key,
      field: member,
    })
  }

  if (redisType === 'stream') {
    return buildRedisMemberEditRequest({
      connection,
      editContext,
      editKind: 'stream-delete-entry',
      key,
      field: member,
    })
  }

  if (redisType === 'timeseries') {
    return buildRedisMemberEditRequest({
      connection,
      editContext,
      editKind: 'timeseries-delete-sample',
      key,
      field: member,
    })
  }

  if (redisType === 'vectorset') {
    return buildRedisMemberEditRequest({
      connection,
      editContext,
      editKind: 'vector-remove-member',
      key,
      field: member,
    })
  }

  return undefined
}

function redisMemberEditObjectKind(editKind: DataEditKind) {
  if (editKind.startsWith('stream-')) {
    return 'stream-entry'
  }

  if (editKind.startsWith('timeseries-')) {
    return 'timeseries-sample'
  }

  if (editKind.startsWith('vector-')) {
    return 'vector-member'
  }

  return 'key-member'
}

function redisMemberEditUsesDocumentId(editKind: DataEditKind) {
  return editKind.startsWith('stream-') ||
    editKind.startsWith('timeseries-') ||
    editKind.startsWith('vector-')
}

export function parseKeyValueInput(value: string) {
  return parseJsonValue(value)
}

export function valueTypeName(value: unknown) {
  if (value === null) {
    return 'null'
  }

  if (Array.isArray(value)) {
    return 'array'
  }

  return typeof value
}
