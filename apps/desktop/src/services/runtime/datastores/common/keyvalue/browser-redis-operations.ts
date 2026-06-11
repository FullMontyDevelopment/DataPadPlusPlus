import type { OperationPlanRequest } from '@datapadplusplus/shared-types'

export function redisOperationRequest(request: OperationPlanRequest) {
  const parameters = request.parameters ?? {}
  const key = String(parameters.key ?? request.objectName ?? '<key>')
  const supportedTypes = redisSupportedFileTypes(request.operationId)
  const moduleTypes = redisModuleFileTypeSupport(request.operationId)

  if (request.operationId.endsWith('key.export')) {
    return JSON.stringify({
      operation: `${request.operationId}`,
      workflow: 'redis.key-file-workflow',
      key,
      type: parameters.redisType ?? 'unknown',
      format: parameters.format ?? 'json',
      target: {
        kind: 'file',
        path: parameters.targetPath ?? parameters.outputPath ?? '<selected-file>.json',
        overwrite: parameters.overwrite ?? false,
      },
      includeType: parameters.includeType ?? true,
      includeTtl: parameters.includeTtl ?? true,
      includeMetadata: parameters.includeMetadata ?? true,
      memberRead: parameters.memberRead ?? 'bounded',
      serializer: {
        supportedFormats: ['json', 'ndjson'],
        supportedTypes,
        moduleTypes,
      },
      executionGate: {
        defaultSupport: 'desktop-live',
        browserSupport: 'plan-only',
        requiredEvidence: [
          'concrete absolute file path',
          'explicit confirmation',
          'Redis-compatible core key serializer, Redis Stack serializer, or Redis DUMP snapshot fixture',
          'before metadata summary',
        ],
      },
    }, null, 2)
  }

  if (request.operationId.endsWith('key.import')) {
    return JSON.stringify({
      operation: `${request.operationId}`,
      workflow: 'redis.key-file-workflow',
      key,
      type: parameters.redisType ?? 'string',
      format: parameters.format ?? 'json',
      source: {
        kind: 'file',
        path: parameters.sourcePath ?? parameters.inputPath ?? '<selected-file>.json',
      },
      mode: parameters.mode ?? 'create-or-replace',
      ttl: parameters.ttl ?? 'preserve',
      validation: parameters.validation ?? 'validate-before-write',
      serializer: {
        acceptedFormats: ['json', 'ndjson'],
        acceptedTypes: supportedTypes,
        moduleTypes,
      },
      executionGate: {
        defaultSupport: 'desktop-live',
        browserSupport: 'plan-only',
        requiredEvidence: [
          'readable import file',
          'explicit confirmation',
          'read-only profile check',
          'Redis-compatible core key parser, Redis Stack parser, or Redis RESTORE snapshot fixture',
          'before/after metadata summary',
        ],
      },
    }, null, 2)
  }

  return JSON.stringify({
    operation: request.operationId,
    key,
    parameters,
  }, null, 2)
}

function redisSupportedFileTypes(operationId: string) {
  const supportedTypes = ['string', 'hash', 'list', 'set', 'zset', 'stream']
  const redisStackTypes = ['json', 'timeseries', 'vectorset', 'bloom', 'cuckoo', 'cms', 'topk', 'tdigest']

  return operationId.startsWith('redis.') ? [...supportedTypes, ...redisStackTypes] : supportedTypes
}

function redisModuleFileTypeSupport(operationId: string) {
  const live = ['json', 'timeseries', 'vectorset', 'bloom', 'cuckoo', 'cms', 'topk', 'tdigest']
  const humanReadable = ['json', 'timeseries', 'vectorset']
  const snapshot = ['bloom', 'cuckoo', 'cms', 'topk', 'tdigest']

  return operationId.startsWith('redis.')
    ? { live, humanReadable, snapshot, planOnly: [] }
    : { live: [], humanReadable: [], snapshot: [], planOnly: live }
}
