import type { OperationPlanRequest } from '@datapadplusplus/shared-types'

export function memcachedOperationRequest(request: OperationPlanRequest) {
  const parameters = request.parameters ?? {}
  const classId = stringParameter(parameters, 'classId')
  const key = memcachedKeyParameter(parameters, 'key') ?? memcachedKeyFromObjectName(request.objectName)

  if (request.operationId.endsWith('diagnostics.metrics')) {
    return [
      'stats',
      'stats settings',
      'stats slabs',
      'stats items',
      'stats conns',
    ].join('\n')
  }

  if (request.operationId.endsWith('metadata.refresh')) {
    return stringParameter(parameters, 'command') || 'stats'
  }

  if (request.operationId.endsWith('stats.reset')) {
    return [
      'stats',
      'stats reset',
      '# Resets server counters only; cached values remain in place.',
    ].join('\n')
  }

  if (request.operationId.endsWith('cache.flush')) {
    const delaySeconds = numberParameter(parameters, 'delaySeconds') ?? 0
    return [
      'stats',
      delaySeconds > 0 ? `flush_all ${delaySeconds}` : 'flush_all',
      '# Destructive: expires every cached item on this Memcached server.',
    ].join('\n')
  }

  if (request.operationId.endsWith('data.import-export')) {
    return [
      'lru_crawler enable',
      classId ? `lru_crawler metadump ${classId}` : 'lru_crawler metadump all',
      '# Values are not exported unless keys are explicitly selected.',
    ].join('\n')
  }

  if (request.operationId.endsWith('key.get')) {
    return `get ${key}`
  }

  if (request.operationId.endsWith('key.gets')) {
    return `gets ${key}`
  }

  if (request.operationId.endsWith('key.set')) {
    const value = stringParameter(parameters, 'value') ?? '<value>'
    const flags = numberParameter(parameters, 'flags') ?? 0
    const ttlSeconds = numberParameter(parameters, 'ttlSeconds') ?? 300
    return [`set ${key} ${flags} ${ttlSeconds} ${byteLength(value)}`, value].join('\n')
  }

  if (request.operationId.endsWith('key.delete')) {
    return `delete ${key}`
  }

  if (request.operationId.endsWith('key.touch')) {
    return `touch ${key} ${numberParameter(parameters, 'ttlSeconds') ?? 300}`
  }

  if (request.operationId.endsWith('key.increment')) {
    return `incr ${key} ${numberParameter(parameters, 'delta') ?? 1}`
  }

  if (request.operationId.endsWith('key.decrement')) {
    return `decr ${key} ${numberParameter(parameters, 'delta') ?? 1}`
  }

  return `stats\n# ${request.operationId}`
}

function stringParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function numberParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return undefined
}

function memcachedKeyParameter(parameters: Record<string, unknown>, key: string) {
  return memcachedKeyFromObjectName(stringParameter(parameters, key))
}

function memcachedKeyFromObjectName(value: unknown) {
  if (typeof value !== 'string') {
    return '<key>'
  }

  const key = value.trim()
  return key && key.length <= 250 && !/[\s\p{Cc}]/u.test(key) ? key : '<key>'
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length
}
