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

  if (redisType === 'stream') {
    return 'Entry ID'
  }

  if (redisType === 'timeseries') {
    return 'Timestamp'
  }

  if (redisType === 'vectorset') {
    return 'Element'
  }

  return 'Key'
}

export function canDeleteRedisContextTarget(selectedKey: string | undefined, redisType: string | undefined) {
  if (!selectedKey || redisType === 'string') {
    return true
  }

  return redisType === 'hash' ||
    redisType === 'set' ||
    redisType === 'zset' ||
    redisType === 'stream' ||
    redisType === 'timeseries' ||
    redisType === 'vectorset'
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

  if (redisType === 'stream') {
    return 'Entry'
  }

  if (redisType === 'timeseries') {
    return 'Sample'
  }

  if (redisType === 'vectorset') {
    return 'Element'
  }

  return 'Item'
}

export function serializedKeyValue(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function setRedisJsonPathValue(root: unknown, path: string, value: unknown) {
  if (path === '$') {
    return value
  }

  const segments = redisJsonPathSegments(path)
  if (segments.length === 0) {
    return value
  }

  const nextRoot = cloneJsonValue(root)
  const parent = parentForJsonPath(nextRoot, segments)
  const last = segments.at(-1)
  if (parent === undefined || last === undefined) {
    return nextRoot
  }

  if (Array.isArray(parent) && typeof last === 'number') {
    parent[last] = value
  } else if (isJsonRecord(parent) && typeof last === 'string') {
    parent[last] = value
  }

  return nextRoot
}

export function deleteRedisJsonPathValue(root: unknown, path: string) {
  if (path === '$') {
    return undefined
  }

  const segments = redisJsonPathSegments(path)
  const nextRoot = cloneJsonValue(root)
  const parent = parentForJsonPath(nextRoot, segments)
  const last = segments.at(-1)
  if (parent === undefined || last === undefined) {
    return nextRoot
  }

  if (Array.isArray(parent) && typeof last === 'number') {
    parent.splice(last, 1)
  } else if (isJsonRecord(parent) && typeof last === 'string') {
    delete parent[last]
  }

  return nextRoot
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

function redisJsonPathSegments(path: string): Array<string | number> {
  if (path === '$') {
    return []
  }

  const segments: Array<string | number> = []
  let index = path.startsWith('$') ? 1 : 0

  while (index < path.length) {
    const character = path[index]
    if (character === '.') {
      const start = index + 1
      let end = start
      while (end < path.length && path[end] !== '.' && path[end] !== '[') {
        end += 1
      }
      const segment = path.slice(start, end)
      if (segment) {
        segments.push(segment)
      }
      index = end
      continue
    }

    if (character === '[') {
      const end = path.indexOf(']', index + 1)
      if (end === -1) {
        break
      }
      const token = path.slice(index + 1, end)
      if (/^\d+$/.test(token)) {
        segments.push(Number(token))
      } else {
        try {
          const parsed = JSON.parse(token) as unknown
          if (typeof parsed === 'string') {
            segments.push(parsed)
          }
        } catch {
          break
        }
      }
      index = end + 1
      continue
    }

    index += 1
  }

  return segments
}

function parentForJsonPath(root: unknown, segments: Array<string | number>) {
  let current = root
  for (const segment of segments.slice(0, -1)) {
    if (Array.isArray(current) && typeof segment === 'number') {
      current = current[segment]
    } else if (isJsonRecord(current) && typeof segment === 'string') {
      current = current[segment]
    } else {
      return undefined
    }
  }

  return current
}

function cloneJsonValue(value: unknown) {
  if (value === undefined) {
    return undefined
  }

  try {
    return JSON.parse(JSON.stringify(value)) as unknown
  } catch {
    return value
  }
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
