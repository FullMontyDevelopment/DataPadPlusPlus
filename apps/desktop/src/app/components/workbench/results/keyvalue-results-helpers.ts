import type {
  ConnectionProfile,
  DataEditKind,
  KeyValuePayload,
  OperationPlanRequest,
} from '@datapadplusplus/shared-types'
import type { DocumentEditContext } from './document-edit-context'
import { parseKeyValueInput } from './keyvalue-edit-requests'

export interface KeyValueResultRow {
  keyName: string
  parsedValue: unknown
  rawValue: string
}

export type KeyValueEntryPatches = Record<string, string | undefined>

const entryVersionIds = new WeakMap<Record<string, string>, number>()
let nextEntryVersionId = 1

export function keyValueEntriesVersion(
  entries: Record<string, string>,
  payload?: Pick<KeyValuePayload, 'key' | 'redisType'>,
) {
  let id = entryVersionIds.get(entries)
  if (!id) {
    id = nextEntryVersionId
    nextEntryVersionId += 1
    entryVersionIds.set(entries, id)
  }

  return `${payload?.key ?? ''}\u0000${payload?.redisType ?? ''}\u0000${id}`
}

export function applyKeyValueEntryPatches(
  entries: Record<string, string>,
  patches: KeyValueEntryPatches,
): Record<string, string> {
  const next = { ...entries }
  for (const [keyName, value] of Object.entries(patches)) {
    if (value === undefined) {
      delete next[keyName]
    } else {
      next[keyName] = value
    }
  }

  return next
}

export function diffKeyValueEntries(
  baseEntries: Record<string, string>,
  nextEntries: Record<string, string>,
): KeyValueEntryPatches {
  const patches: KeyValueEntryPatches = {}
  for (const [keyName, value] of Object.entries(nextEntries)) {
    if (baseEntries[keyName] !== value) {
      patches[keyName] = value
    }
  }

  for (const keyName of Object.keys(baseEntries)) {
    if (!(keyName in nextEntries)) {
      patches[keyName] = undefined
    }
  }

  return patches
}

export function keyValueRowsFromEntries(entries: Record<string, string>): KeyValueResultRow[] {
  return Object.entries(entries).map(([keyName, rawValue]) => ({
    keyName,
    rawValue,
    parsedValue: parseKeyValueInput(rawValue),
  }))
}

export function keyValuePrimaryColumnLabel(redisType: string | undefined) {
  if (redisType === 'hash') {
    return 'Field'
  }

  if (redisType === 'list') {
    return 'Index'
  }

  if (redisType === 'zset') {
    return 'Member'
  }

  return 'Key'
}

export function canDeleteRedisContextTarget(selectedKey: string | undefined, redisType: string | undefined) {
  if (!selectedKey || redisType === 'string') {
    return true
  }

  return redisType === 'hash' || redisType === 'set' || redisType === 'zset'
}

export function redisContextTargetKind(selectedKey: string | undefined, redisType: string | undefined): 'key' | 'member' {
  return selectedKey && redisType !== 'string' ? 'member' : 'key'
}

export function redisMemberLabel(redisType: string | undefined) {
  if (redisType === 'hash') {
    return 'Field'
  }

  if (redisType === 'zset' || redisType === 'set') {
    return 'Member'
  }

  return 'Item'
}

export function serializedKeyValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function redisEditKindForValue(
  redisType: string,
): Extract<
  DataEditKind,
  'hash-set-field' | 'list-set-index' | 'set-add-member' | 'zset-add-member'
> {
  switch (redisType) {
    case 'hash':
      return 'hash-set-field'
    case 'list':
      return 'list-set-index'
    case 'set':
      return 'set-add-member'
    case 'zset':
      return 'zset-add-member'
    default:
      return 'hash-set-field'
  }
}

export function redisKeyOperationPlanRequest({
  connection,
  editContext,
  payload,
  operation,
}: {
  connection?: ConnectionProfile
  editContext?: DocumentEditContext
  payload?: Pick<KeyValuePayload, 'key' | 'redisType'>
  operation: 'export' | 'import'
}): OperationPlanRequest | undefined {
  if (!connection || !editContext || !payload?.key) {
    return undefined
  }

  const redisType = payload.redisType ?? 'string'

  return {
    connectionId: connection.id,
    environmentId: editContext.environmentId,
    operationId: `${connection.engine}.key.${operation}`,
    objectName: payload.key,
    parameters: operation === 'export'
      ? {
          key: payload.key,
          redisType: payload.redisType ?? 'unknown',
          format: 'json',
          includeTtl: true,
          includeType: true,
          includeMetadata: true,
        }
      : {
          key: payload.key,
          redisType,
          format: 'json',
          mode: 'create-or-replace',
          ttl: 'preserve',
          validation: 'validate-before-write',
        },
  }
}
