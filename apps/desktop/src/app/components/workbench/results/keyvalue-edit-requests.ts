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
    confirmationText: editKind === 'delete-key'
      ? keyValueConfirmationText(connection!, editKind)
      : undefined,
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
      objectKind: 'key-member',
      path: field ? [field] : [],
      key,
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
    return withRedisConfirmation(connection, buildRedisMemberEditRequest({
      connection,
      editContext,
      editKind: 'hash-delete-field',
      key,
      field: member,
    }))
  }

  if (redisType === 'set') {
    return withRedisConfirmation(connection, buildRedisMemberEditRequest({
      connection,
      editContext,
      editKind: 'set-remove-member',
      key,
      value: parseKeyValueInput(rawValue ?? member),
    }))
  }

  if (redisType === 'zset') {
    return withRedisConfirmation(connection, buildRedisMemberEditRequest({
      connection,
      editContext,
      editKind: 'zset-remove-member',
      key,
      field: member,
    }))
  }

  return undefined
}

export function parseKeyValueInput(value: string) {
  return parseJsonValue(value)
}

export function keyValueConfirmationText(
  connection: ConnectionProfile,
  editKind: DataEditKind,
) {
  return `CONFIRM ${connection.engine.toUpperCase()} ${editKind.toUpperCase()}`
}

function withRedisConfirmation(
  connection: ConnectionProfile | undefined,
  request: DataEditExecutionRequest | undefined,
) {
  return connection && request
    ? {
        ...request,
        confirmationText: keyValueConfirmationText(connection, request.editKind),
      }
    : request
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
