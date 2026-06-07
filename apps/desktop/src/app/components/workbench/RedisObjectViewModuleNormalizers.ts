import {
  arrayOfRecords,
  asRecord,
  detailSummary,
  listSummary,
  redisDatabaseLabel,
  redisTypeLabel,
  stringValue,
} from './RedisObjectViewFormatters'
import type { JsonRecord } from './RedisObjectViewTypes'

export const REDIS_MODULE_VIEW_KINDS = [
  'json',
  'timeseries',
  'bloom',
  'search-index',
  'vectorset',
] as const

export function isRedisModuleViewKind(kind: string | undefined) {
  return REDIS_MODULE_VIEW_KINDS.includes(kind as typeof REDIS_MODULE_VIEW_KINDS[number])
}

export function redisModuleKeys(payload: JsonRecord): JsonRecord[] {
  return arrayOfRecords(payload.keys)
}

export function redisModuleIndexes(payload: JsonRecord): JsonRecord[] {
  return arrayOfRecords(payload.indexes)
}

export function redisModuleCommands(payload: JsonRecord): JsonRecord[] {
  return arrayOfRecords(payload.moduleCommands)
}

export function redisModuleDisabledRows(payload: JsonRecord): string[][] {
  return Object.entries(asRecord(payload.disabledActions)).map(([action, reason]) => [
    action,
    stringValue(reason),
  ])
}

export function redisModuleCards(kind: string, payload: JsonRecord) {
  const keys = redisModuleKeys(payload)
  const indexes = redisModuleIndexes(payload)
  const commands = redisModuleCommands(payload)
  const disabledRows = redisModuleDisabledRows(payload)

  return [
    ['Module', redisTypeLabel(kind)],
    ['Keys', stringValue(keys.length || payload.scannedKeys)],
    ['Indexes', stringValue(indexes.length)],
    ['Read probes', stringValue(commands.length)],
    ['Guarded gaps', stringValue(disabledRows.length)],
  ].filter(([, value]) => value && value !== '0')
}

export function redisModuleFacts(kind: string, payload: JsonRecord) {
  return [
    ['Database', redisDatabaseLabel(payload.database ?? payload.databaseIndex)],
    ['Module surface', redisTypeLabel(kind)],
    ['Pattern', stringValue(payload.pattern ?? '*')],
    ['Installed modules', listSummary(payload.installedModules)],
    ['Evidence', moduleEvidence(payload)],
  ].filter(([, value]) => value)
}

export function redisModuleDetailSummary(value: unknown) {
  const details = asRecord(value)
  const rows = Object.entries(details)
    .filter(([, item]) => item !== undefined && item !== null)
    .slice(0, 6)
    .map(([key, item]) => `${key}: ${stringValue(item)}`)

  return rows.length ? rows.join(', ') : detailSummary(value)
}

export function redisModuleKeyRows(keys: JsonRecord[]) {
  return keys.map((key) => [
    stringValue(key.key ?? key.name),
    redisTypeLabel(stringValue(key.type ?? key.redisType ?? key.moduleKind)),
    stringValue(key.ttlSeconds ?? key.ttl),
    stringValue(key.memoryUsageBytes ?? key.memory),
    redisModuleDetailSummary(key.moduleDetails),
  ])
}

export function redisModuleIndexRows(indexes: JsonRecord[]) {
  return indexes.map((index) => {
    const details = asRecord(index.moduleDetails)
    return [
      stringValue(index.name ?? details.indexName),
      stringValue(details.numDocs ?? details.numberOfDocuments),
      redisSearchAttributesSummary(details.attributes),
      redisSearchPrefixesSummary(details.indexDefinition),
      redisModuleDetailSummary(details),
    ]
  })
}

export function redisModuleCommandRows(commands: JsonRecord[]) {
  return commands.map((command) => [
    stringValue(command.command),
    stringValue(command.purpose),
    stringValue(command.evidence),
  ])
}

function redisSearchAttributesSummary(value: unknown) {
  const attributes = Array.isArray(value) ? value : []
  if (!attributes.length) {
    return ''
  }

  return attributes
    .slice(0, 4)
    .map((attribute) => {
      const record = Array.isArray(attribute)
        ? pairsToRecord(attribute)
        : asRecord(attribute)
      return stringValue(record.attribute ?? record.identifier ?? record.name ?? attribute)
    })
    .filter(Boolean)
    .join(', ')
}

function redisSearchPrefixesSummary(value: unknown) {
  const definition = asRecord(value)
  return listSummary(definition.prefixes ?? definition.prefix ?? definition.keyPrefixes)
}

function pairsToRecord(value: unknown[]): JsonRecord {
  const record: JsonRecord = {}
  for (let index = 0; index < value.length; index += 2) {
    const key = value[index]
    if (typeof key === 'string') {
      record[key] = value[index + 1]
    }
  }
  return record
}

function moduleEvidence(payload: JsonRecord) {
  const commands = redisModuleCommands(payload)
  if (commands.length) {
    return 'live read-only probes'
  }

  return stringValue(payload.moduleEvidence ?? payload.evidence)
}
