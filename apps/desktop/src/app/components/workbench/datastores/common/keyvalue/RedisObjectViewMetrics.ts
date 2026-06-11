import {
  arrayOfRecords,
  detailSummary,
  displayValueSummary,
  durationText,
  humanize,
  redisDatabaseLabel,
  stringValue,
} from './RedisObjectViewFormatters'
import type { JsonRecord } from './RedisObjectViewTypes'

export function redisInfoRows(payload: JsonRecord) {
  const text = stringValue(payload.text)
  return infoRowsFromText(text)
}

export function infoRowsFromText(text: string) {
  if (!text) {
    return []
  }

  let section = ''
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      if (line.startsWith('#')) {
        section = line.replace(/^#\s*/, '')
        return []
      }

      const [name, ...rest] = line.split(':')
      if (!name || rest.length === 0) {
        return []
      }

      return [[humanize(name), rest.join(':'), section]]
    })
}

export function redisInfoRowsFromPayloadValue(payload: JsonRecord) {
  const direct = redisInfoRows(payload)
  if (direct.length) {
    return direct
  }

  return infoRowsFromText(typeof payload.value === 'string' ? payload.value : '')
}

export function metricsRowsFromPayload(payload: JsonRecord) {
  const metrics = arrayOfRecords(payload.metrics)
  if (metrics.length) {
    return metrics.map((metric) => [
      stringValue(metric.label ?? metric.name ?? metric.metric),
      stringValue(metric.value),
      stringValue(metric.section ?? metric.unit ?? metric.source),
    ])
  }

  return Object.entries(payload)
    .filter(([key, value]) =>
      !['value', 'text', 'command', 'keys', 'databases', 'typeCounts'].includes(key) &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
    .map(([key, value]) => [humanize(key), String(value), ''])
}

export function redisDiagnosticDetailRows(kind: string, payload: JsonRecord): string[][] {
  const slowlog = arrayOfRecords(payload.entries)
  if (slowlog.length) {
    return slowlog.map((entry) => [
      `#${stringValue(entry.id) || 'entry'}`,
      durationText(entry.durationMicros),
      [
        stringValue(entry.commandName),
        stringValue(entry.key),
        stringValue(entry.recordedAt),
      ].filter(Boolean).join(' / '),
    ])
  }

  if (kind === 'slowlog') {
    const rows = slowlogRowsFromValue(payload.value)
    if (rows.length) {
      return rows
    }
  }

  const samples = arrayOfRecords(payload.samples)
  if (samples.length) {
    return samples.map((sample) => [
      stringValue(sample.event ?? sample.name),
      `${stringValue(sample.latestMs)} ms`,
      `Max ${stringValue(sample.maxMs)} ms`,
    ])
  }

  if (kind === 'latency') {
    const rows = latencyRowsFromValue(payload.value)
    if (rows.length) {
      return rows
    }
  }

  const clients = arrayOfRecords(payload.clients)
  if (clients.length) {
    return clients.map((client) => [
      stringValue(client.name ?? client.id),
      stringValue(client.address ?? client.addr),
      [
        client.ageSeconds !== undefined ? `age ${client.ageSeconds}s` : '',
        client.idleSeconds !== undefined ? `idle ${client.idleSeconds}s` : '',
      ].filter(Boolean).join(', '),
    ])
  }

  if (kind === 'clients') {
    const rows = clientRowsFromValue(payload.value)
    if (rows.length) {
      return rows
    }
  }

  if (kind === 'memory') {
    const rows = redisPairsToRows(payload.value)
    if (rows.length) {
      return rows
    }
  }

  const keyspace = arrayOfRecords(payload.keyspace)
  if (keyspace.length) {
    return keyspace.map((database) => [
      redisDatabaseLabel(database.database ?? database.id),
      `${stringValue(database.keys)} key(s)`,
      `${stringValue(database.expires)} expiring / ${stringValue(database.avgTtlMs ?? database.avgTtl)} avg TTL`,
    ])
  }

  const replicas = arrayOfRecords(payload.replicas)
  if (replicas.length) {
    return replicas.map((replica) => [
      stringValue(replica.name ?? replica.id ?? replica.host),
      stringValue(replica.state ?? replica.status ?? replica.role),
      detailSummary(replica),
    ])
  }

  if (kind === 'diagnostics') {
    return metadataRowsFromPayload(payload)
  }

  return []
}

function slowlogRowsFromValue(value: unknown): string[][] {
  return arrayOfArrays(value).map((entry) => {
    const [id, timestamp, durationMicros, command, clientAddress, clientName] = entry
    return [
      `#${stringValue(id) || 'entry'}`,
      durationText(durationMicros),
      [
        redisCommandSummary(command),
        stringValue(clientAddress),
        stringValue(clientName),
        stringValue(timestamp),
      ].filter(Boolean).join(' / '),
    ]
  })
}

function latencyRowsFromValue(value: unknown): string[][] {
  return arrayOfArrays(value).map((sample) => {
    const [event, timestamp, latestMs, maxMs] = sample
    return [
      stringValue(event),
      `${stringValue(latestMs)} ms`,
      [
        stringValue(maxMs) ? `Max ${stringValue(maxMs)} ms` : '',
        stringValue(timestamp),
      ].filter(Boolean).join(' / '),
    ]
  })
}

function clientRowsFromValue(value: unknown): string[][] {
  const text = stringValue(value)
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const record = redisKeyValueLineToRecord(line)
      return [
        stringValue(record.name) || `Client ${stringValue(record.id) || 'connection'}`,
        stringValue(record.addr ?? record.laddr ?? record.fd),
        [
          record.db !== undefined ? `db ${stringValue(record.db)}` : '',
          stringValue(record.cmd) ? `cmd ${stringValue(record.cmd)}` : '',
          record.age !== undefined ? `age ${stringValue(record.age)}s` : '',
          record.idle !== undefined ? `idle ${stringValue(record.idle)}s` : '',
        ].filter(Boolean).join(', '),
      ]
    })
}

function redisPairsToRows(value: unknown): string[][] {
  if (!Array.isArray(value)) {
    return []
  }

  const rows: string[][] = []
  for (let index = 0; index < value.length; index += 2) {
    const key = value[index]
    if (typeof key !== 'string') {
      continue
    }
    const item = value[index + 1]
    rows.push([humanize(key), displayValueSummary(item), detailSummary(item)])
  }
  return rows
}

function redisCommandSummary(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(stringValue).filter(Boolean).join(' ')
  }

  return stringValue(value)
}

function arrayOfArrays(value: unknown): unknown[][] {
  return (Array.isArray(value) ? value : []).filter((item): item is unknown[] => Array.isArray(item))
}

function redisKeyValueLineToRecord(line: string): JsonRecord {
  const record: JsonRecord = {}
  for (const token of line.split(/\s+/)) {
    const [key, ...rest] = token.split('=')
    if (!key || rest.length === 0) {
      continue
    }
    record[key] = rest.join('=')
  }
  return record
}

export function cardRowsFromPayload(payload: JsonRecord, keys: string[]) {
  return keys
    .map((key) => [humanize(key), stringValue(payload[key])])
    .filter(([, value]) => value)
}

export function metadataRowsFromPayload(payload: JsonRecord): string[][] {
  const facts = arrayOfRecords(payload.facts)
  if (facts.length) {
    return facts.map((fact) => [
      stringValue(fact.label ?? fact.name),
      stringValue(fact.value),
      stringValue(fact.detail ?? fact.section),
    ])
  }

  const commandResultRows = nativeCommandResultRows(payload)
  if (commandResultRows.length) {
    return commandResultRows
  }

  for (const key of ['masters', 'replicas', 'sentinels', 'nodes', 'slots', 'libraries', 'scripts', 'history']) {
    const records = arrayOfRecords(payload[key])
    if (records.length) {
      return records.map((record, index) => [
        stringValue(record.name ?? record.id ?? `#${index + 1}`),
        displayValueSummary(record.status ?? record.state ?? record.value ?? record.type ?? record),
        detailSummary(record),
      ])
    }
  }

  const server = payload.server && typeof payload.server === 'object' && !Array.isArray(payload.server)
    ? payload.server as JsonRecord
    : {}
  const serverRows = Object.entries(server).map(([key, value]) => [
    humanize(key),
    stringValue(value),
    'Server',
  ])

  const hiddenKeys = new Set([
    'command',
    'value',
    'kind',
    'warning',
    'message',
    'metrics',
    'server',
    'keyspace',
    'channels',
    'patterns',
    'subscribers',
    'users',
    'categories',
    'entries',
    'samples',
    'clients',
    'masters',
    'replicas',
    'sentinels',
    'nodes',
    'slots',
    'libraries',
    'scripts',
    'history',
  ])
  const scalarRows = Object.entries(payload)
    .filter(([key, value]) =>
      !hiddenKeys.has(key) &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'))
    .map(([key, value]) => [humanize(key), stringValue(value), ''])

  return [...serverRows, ...scalarRows]
}

function nativeCommandResultRows(payload: JsonRecord): string[][] {
  if (!('value' in payload)) {
    return []
  }

  const value = payload.value
  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item, index) => [
      `#${index + 1}`,
      displayValueSummary(item),
      detailSummary(item),
    ])
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as JsonRecord).slice(0, 25).map(([key, item]) => [
      humanize(key),
      displayValueSummary(item),
      detailSummary(item),
    ])
  }

  const scalar = stringValue(value)
  return scalar ? [['Result', scalar, '']] : []
}
