import {
  arrayOfRecords,
  asRecord,
  listSummary,
  redisDatabaseLabel,
  stringValue,
} from './RedisObjectViewFormatters'
import type { JsonRecord } from './RedisObjectViewTypes'

export function databaseUnit(payload: JsonRecord, databases: JsonRecord[]) {
  if (databases.length) {
    return `${databases.length} DB(s)`
  }

  const database = redisDatabaseLabel(payload.database)
  return database || undefined
}

export function clusterCards(
  payload: JsonRecord,
  infoRows: string[][],
  nodes: JsonRecord[],
  slots: JsonRecord[],
) {
  const info = new Map(infoRows.map(([label, value]) => [label, value]))
  return [
    ['State', stringValue(payload.state ?? info.get('Cluster State'))],
    ['Known nodes', stringValue(payload.knownNodes ?? info.get('Cluster Known Nodes') ?? nodes.length)],
    ['Slots assigned', stringValue(payload.slotsAssigned ?? info.get('Cluster Slots Assigned') ?? slots.length)],
    ['Size', stringValue(payload.size ?? info.get('Cluster Size'))],
  ].filter(([, value]) => value && value !== '0')
}

export function redisClusterUnit(
  kind: string,
  infoRows: string[][],
  nodes: JsonRecord[],
  slots: JsonRecord[],
) {
  if (kind === 'cluster-node') {
    return `${nodes.length} node(s)`
  }

  if (kind === 'cluster-slots') {
    return `${slots.length} slot range(s)`
  }

  if (infoRows.length) {
    return `${infoRows.length} signal(s)`
  }

  return 'cluster'
}

export function normalizeClusterNodes(payload: JsonRecord): JsonRecord[] {
  const records = arrayOfRecords(payload.nodes)
  if (records.length && Object.keys(records[0] ?? {}).length) {
    return records
  }

  if (typeof payload.value === 'string') {
    return payload.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [id, address, flags, master, pingSent, pingRecv, epoch, linkState, ...slots] = line.split(/\s+/)
        return {
          id,
          address,
          flags,
          role: flags?.includes('master') ? 'master' : flags?.includes('slave') || flags?.includes('replica') ? 'replica' : flags,
          master: master === '-' ? '' : master,
          pingSent,
          pingRecv,
          epoch,
          linkState,
          slots,
        }
      })
  }

  return []
}

export function normalizeClusterSlots(payload: JsonRecord): JsonRecord[] {
  const records = arrayOfRecords(payload.slots)
  if (records.length && Object.keys(records[0] ?? {}).length) {
    return records
  }

  const values = Array.isArray(payload.value) ? payload.value : []
  return values
    .filter((slot): slot is unknown[] => Array.isArray(slot) && slot.length >= 3)
    .map((slot) => {
      const [start, end, master, ...replicas] = slot
      return {
        range: `${stringValue(start)}-${stringValue(end)}`,
        master: endpointSummary(redisEndpointArrayToRecord(master)),
        replicas: replicas.map((replica) => endpointSummary(redisEndpointArrayToRecord(replica))).filter(Boolean),
        detail: `${replicas.length} replica(s)`,
      }
    })
}

export function normalizeSentinelRecords(source: unknown, commandValue: unknown): JsonRecord[] {
  const records = arrayOfRecords(source)
  if (records.length && Object.keys(records[0] ?? {}).length) {
    return records
  }

  const values = Array.isArray(commandValue) ? commandValue : []
  return values
    .map(redisNameValueArrayToRecord)
    .filter((record) => Object.keys(record).length > 0)
}

export function normalizeFunctionLibraries(payload: JsonRecord): JsonRecord[] {
  const records = arrayOfRecords(payload.libraries)
  if (records.length && Object.keys(records[0] ?? {}).length) {
    return records
  }

  const values = Array.isArray(payload.value) ? payload.value : []
  return values
    .map(redisNameValueArrayToRecord)
    .filter((record) => Object.keys(record).length > 0)
}

export function normalizeAclUsers(payload: JsonRecord): JsonRecord[] {
  const users = arrayOfRecords(payload.users)
  if (users.length && Object.keys(users[0] ?? {}).length) {
    return users
  }

  const values = Array.isArray(payload.value) ? payload.value : []
  return values
    .filter((item): item is string => typeof item === 'string' && item.startsWith('user '))
    .map(parseAclUserLine)
}

export function normalizeAclCategories(payload: JsonRecord, kind: string): JsonRecord[] {
  const categories = arrayOfRecords(payload.categories)
  if (categories.length && Object.keys(categories[0] ?? {}).length) {
    return categories
  }

  const values = kind === 'permissions' && Array.isArray(payload.value) ? payload.value : []
  return values
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .map((name) => ({ name, description: 'Redis command category', commands: [] }))
}

export function currentRedisUser(payload: JsonRecord) {
  const explicit = stringValue(payload.currentUser ?? payload.user)
  if (explicit) {
    return explicit
  }

  return typeof payload.value === 'string' ? payload.value : ''
}

export function redisSecurityUnit(
  kind: string,
  userCount: number,
  categoryCount: number,
  currentUser: string,
) {
  if (kind === 'permissions') {
    return `${categoryCount} category(ies)`
  }

  if (kind === 'user') {
    return currentUser || 'current user'
  }

  return `${userCount} user(s)`
}

export function functionListSummary(value: unknown) {
  const functions = Array.isArray(value) ? value : []
  if (!functions.length) {
    return 'None'
  }

  return functions
    .slice(0, 5)
    .map((item) => {
      const record = Array.isArray(item) ? redisNameValueArrayToRecord(item) : asRecord(item)
      return stringValue(record.name ?? record.function ?? record.functionName ?? item)
    })
    .filter(Boolean)
    .join(', ')
}

export function normalizePubSubChannels(source: unknown, commandValues: unknown[]): JsonRecord[] {
  const records = arrayOfRecords(source)
  if (records.length) {
    return records
  }

  return commandValues
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((channel) => ({ name: channel, subscribers: '', pattern: '' }))
}

export function normalizePubSubPatterns(source: unknown, commandValues: unknown[]): JsonRecord[] {
  const records = arrayOfRecords(source)
  if (records.length) {
    return records
  }

  if (!commandValues.length) {
    return []
  }

  const count = commandValues.find((item) => typeof item === 'number' || typeof item === 'string')
  return count === undefined ? [] : [{ pattern: 'Active pattern subscriptions', subscribers: count, detail: '' }]
}

export function normalizePubSubSubscribers(source: unknown, commandValues: unknown[]): JsonRecord[] {
  const records = arrayOfRecords(source)
  if (records.length) {
    return records
  }

  const rows: JsonRecord[] = []
  for (let index = 0; index < commandValues.length; index += 2) {
    const channel = commandValues[index]
    const subscribers = commandValues[index + 1]
    if (channel !== undefined) {
      rows.push({ channel, subscribers, detail: '' })
    }
  }
  return rows
}

export function endpointSummary(value: unknown) {
  const record = asRecord(value)
  const host = stringValue(record.host ?? record.ip ?? record.address)
  const port = stringValue(record.port)
  if (host && port) {
    return `${host}:${port}`
  }

  return host || stringValue(record.addr ?? record.endpoint ?? value)
}

function parseAclUserLine(line: string): JsonRecord {
  const tokens = line.split(/\s+/).filter(Boolean)
  const [, name = ''] = tokens
  return {
    name,
    enabled: tokens.includes('on') ? true : tokens.includes('off') ? false : undefined,
    commands: tokens.filter((token) => token.startsWith('+') || token.startsWith('-')),
    keyPatterns: tokens.filter((token) => token.startsWith('~')),
    channelPatterns: tokens.filter((token) => token.startsWith('&')),
    authentication: tokens.find((token) => ['nopass', 'resetpass'].includes(token)) ?? '',
  }
}

function redisNameValueArrayToRecord(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord
  }

  if (!Array.isArray(value)) {
    return {}
  }

  const record: JsonRecord = {}
  for (let index = 0; index < value.length; index += 2) {
    const key = value[index]
    if (typeof key !== 'string') {
      continue
    }
    record[camelCaseRedisKey(key)] = value[index + 1]
  }
  return record
}

function redisEndpointArrayToRecord(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonRecord
  }

  if (!Array.isArray(value)) {
    return {}
  }

  return {
    host: value[0],
    port: value[1],
    id: value[2],
  }
}

function camelCaseRedisKey(value: string) {
  return value.replace(/[-_](\w)/g, (_, letter: string) => letter.toUpperCase())
}

export { listSummary }
