import type { DataEditPlanRequest } from '@datapadplusplus/shared-types'
import {
  redisJsonPath,
  secretAwareRedisJsonCommandValue,
} from './browser-redis-json-path'
import { redisStreamEditRequest } from './browser-redis-stream-edit'
import { redisTimeSeriesEditRequest } from './browser-redis-timeseries-edit'
import { redisVectorEditRequest } from './browser-redis-vector-edit'

const SECRET_REPLACEMENT = '********'

export function keyValueEditRequest(request: DataEditPlanRequest) {
  const key = request.target.key ?? '<key>'
  const firstChange = request.changes[0]

  if (request.editKind === 'set-ttl') {
    return `EXPIRE ${key} ${valueToCommandArg(firstChange?.value ?? '<seconds>')}`
  }

  if (request.editKind === 'delete-key') {
    return `DEL ${key}`
  }

  if (request.editKind === 'rename-key') {
    return `RENAME ${key} ${firstChange?.newName ?? '<new-key>'}`
  }

  if (request.editKind === 'persist-ttl') {
    return `PERSIST ${key}`
  }

  if (request.editKind === 'hash-set-field') {
    const field = firstChange?.field ?? '<field>'
    return `HSET ${key} ${field} ${secretAwareCommandValue(field, firstChange?.value ?? '<value>')}`
  }

  if (request.editKind === 'hash-delete-field') {
    return `HDEL ${key} ${firstChange?.field ?? '<field>'}`
  }

  if (request.editKind === 'json-set-path') {
    const path = redisJsonPath(firstChange)
    return `JSON.SET ${key} ${path} ${secretAwareRedisJsonCommandValue(path, firstChange?.value ?? '<json>')}`
  }

  if (request.editKind === 'json-delete-path') {
    return `JSON.DEL ${key} ${redisJsonPath(firstChange)}`
  }

  const streamRequest = redisStreamEditRequest(request)
  if (streamRequest) {
    return streamRequest
  }

  const timeSeriesRequest = redisTimeSeriesEditRequest(request)
  if (timeSeriesRequest) {
    return timeSeriesRequest
  }

  const vectorRequest = redisVectorEditRequest(request)
  if (vectorRequest) {
    return vectorRequest
  }

  if (request.editKind === 'list-set-index') {
    return `LSET ${key} ${firstChange?.field ?? '<index>'} ${valueToCommandArg(firstChange?.value ?? '<value>')}`
  }

  if (request.editKind === 'set-add-member') {
    return `SADD ${key} ${valueToCommandArg(firstChange?.value ?? '<member>')}`
  }

  if (request.editKind === 'set-remove-member') {
    return `SREM ${key} ${valueToCommandArg(firstChange?.value ?? '<member>')}`
  }

  if (request.editKind === 'zset-add-member') {
    return `ZADD ${key} <score> ${firstChange?.field ?? '<member>'}`
  }

  if (request.editKind === 'zset-remove-member') {
    return `ZREM ${key} ${firstChange?.field ?? '<member>'}`
  }

  return `SET ${key} ${secretAwareCommandValue(key, firstChange?.value ?? '<value>')}`
}

function valueToCommandArg(value: unknown) {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function secretAwareCommandValue(name: string, value: unknown) {
  return isSecretLikeName(name) ? SECRET_REPLACEMENT : valueToCommandArg(value)
}

function isSecretLikeName(value: string) {
  const normalized = value.toLowerCase().replaceAll(/[^a-z0-9]+/g, '_')
  return /(^|_)(password|pwd|pass|token|secret|secretkey|apikey|api_key|authtoken|auth_token|accesstoken|access_token)($|_)/.test(normalized)
}
