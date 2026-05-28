import type { OperationPlanRequest } from '@datapadplusplus/shared-types'

export function redisOperationRequest(request: OperationPlanRequest) {
  const parameters = request.parameters ?? {}
  const key = String(parameters.key ?? request.objectName ?? '<key>')

  if (request.operationId.endsWith('key.export')) {
    return JSON.stringify({
      operation: 'key.export',
      key,
      type: parameters.redisType ?? 'unknown',
      format: parameters.format ?? 'json',
      includeType: parameters.includeType ?? true,
      includeTtl: parameters.includeTtl ?? true,
      includeMetadata: parameters.includeMetadata ?? true,
      memberRead: parameters.memberRead ?? 'bounded',
    }, null, 2)
  }

  if (request.operationId.endsWith('key.import')) {
    return JSON.stringify({
      operation: 'key.import',
      key,
      type: parameters.redisType ?? 'string',
      format: parameters.format ?? 'json',
      mode: parameters.mode ?? 'create-or-replace',
      ttl: parameters.ttl ?? 'preserve',
      validation: parameters.validation ?? 'validate-before-write',
    }, null, 2)
  }

  return JSON.stringify({
    operation: request.operationId,
    key,
    parameters,
  }, null, 2)
}
