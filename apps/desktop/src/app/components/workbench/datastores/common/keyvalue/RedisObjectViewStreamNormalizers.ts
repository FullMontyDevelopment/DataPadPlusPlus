import {
  arrayOfRecords,
  asRecord,
  listSummary,
  stringValue,
} from './RedisObjectViewFormatters'
import { redisNameValueArrayToRecord } from './RedisObjectViewNormalizers'
import type { JsonRecord } from './RedisObjectViewTypes'

export function normalizeStreamInfo(payload: JsonRecord): JsonRecord {
  const explicit = asRecord(payload.info)
  if (Object.keys(explicit).length) {
    return explicit
  }

  return redisNameValueArrayToRecord(payload.value)
}

export function normalizeStreamGroups(payload: JsonRecord): JsonRecord[] {
  const groups = arrayOfRecords(payload.groups)
  if (groups.length) {
    return groups
  }

  return recordsFromNameValueArray(payload.value)
}

export function normalizeStreamConsumers(payload: JsonRecord): JsonRecord[] {
  const consumers = arrayOfRecords(payload.consumers)
  if (consumers.length) {
    return consumers
  }

  return recordsFromNameValueArray(payload.value)
}

export function normalizeStreamEntries(payload: JsonRecord): JsonRecord[] {
  const entries = Array.isArray(payload.entries) ? payload.entries : payload.value
  if (!Array.isArray(entries)) {
    return []
  }

  return entries
    .map((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        return entry as JsonRecord
      }

      if (!Array.isArray(entry)) {
        return {}
      }

      const [id, fields] = entry
      const record = redisNameValueArrayToRecord(fields)
      return {
        id,
        fields: record,
        detail: streamEntryDetail(record),
      }
    })
    .filter((entry) => Object.keys(entry).length > 0)
}

export function normalizePendingSummary(payload: JsonRecord): JsonRecord {
  const summary = payload.pendingSummary
  if (summary && typeof summary === 'object' && !Array.isArray(summary)) {
    return summary as JsonRecord
  }

  if (!Array.isArray(summary)) {
    return {}
  }

  const [pending, smallestId, largestId, consumers] = summary
  return {
    pending,
    smallestId,
    largestId,
    consumers: pendingConsumerSummary(consumers),
  }
}

export function normalizePendingEntries(payload: JsonRecord): JsonRecord[] {
  const entries = Array.isArray(payload.pendingEntries) ? payload.pendingEntries : payload.value
  if (!Array.isArray(entries)) {
    return []
  }

  return entries
    .map((entry) => {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        return entry as JsonRecord
      }

      if (!Array.isArray(entry)) {
        return {}
      }

      const [id, consumer, idleMs, deliveries] = entry
      return { id, consumer, idleMs, deliveries }
    })
    .filter((entry) => Object.keys(entry).length > 0)
}

export function streamUnit(kind: string, payload: JsonRecord) {
  if (kind === 'stream-groups') {
    return `${normalizeStreamGroups(payload).length} group(s)`
  }

  if (kind === 'stream-consumers') {
    return `${normalizeStreamConsumers(payload).length} consumer(s)`
  }

  if (kind === 'stream-pending') {
    return `${normalizePendingEntries(payload).length} pending`
  }

  if (kind === 'stream-entries') {
    return `${normalizeStreamEntries(payload).length} entr${normalizeStreamEntries(payload).length === 1 ? 'y' : 'ies'}`
  }

  return stringValue(payload.key) || 'stream'
}

function recordsFromNameValueArray(value: unknown): JsonRecord[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(redisNameValueArrayToRecord)
    .filter((record) => Object.keys(record).length > 0)
}

function streamEntryDetail(record: JsonRecord) {
  const fields = Object.entries(record).map(([key, value]) => `${key}: ${stringValue(value)}`)
  return listSummary(fields)
}

function pendingConsumerSummary(value: unknown) {
  if (!Array.isArray(value)) {
    return stringValue(value)
  }

  return value
    .map((consumer) => {
      const record = redisNameValueArrayToRecord(consumer)
      const name = stringValue(record.name ?? record.consumer)
      const pending = stringValue(record.pending)
      return [name, pending ? `${pending} pending` : ''].filter(Boolean).join(' ')
    })
    .filter(Boolean)
    .join(', ')
}
