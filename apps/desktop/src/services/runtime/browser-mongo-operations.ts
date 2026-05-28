import type { OperationPlanRequest } from '@datapadplusplus/shared-types'

export function mongoOperationRequest(request: OperationPlanRequest) {
  const parameters = request.parameters ?? {}
  const collection = String(parameters.collection ?? request.objectName ?? '<collection>')
  const indexName = String(parameters.indexName ?? '<index>')
  const database = String(parameters.database ?? '<database>')
  const name = String(parameters.name ?? request.objectName ?? '<name>')

  if (request.operationId.endsWith('index.create')) {
    return JSON.stringify({
      database,
      createIndexes: collection,
      indexes: [{
        key: parameters.key ?? { field: 1 },
        name: indexName,
        ...(asRecord(parameters.options)),
      }],
    }, null, 2)
  }

  if (request.operationId.endsWith('index.drop')) {
    return JSON.stringify({
      database,
      dropIndexes: collection,
      index: indexName,
    }, null, 2)
  }

  if (request.operationId.endsWith('index.hide') || request.operationId.endsWith('index.unhide')) {
    return JSON.stringify({
      database,
      collMod: collection,
      index: {
        name: indexName,
        hidden: request.operationId.endsWith('index.hide'),
      },
    }, null, 2)
  }

  if (request.operationId.endsWith('validation.update')) {
    return JSON.stringify({
      database,
      collMod: collection,
      validator: parameters.validator ?? {},
    }, null, 2)
  }

  if (request.operationId.endsWith('collection.export')) {
    return JSON.stringify({
      database,
      collection,
      operation: 'export',
      format: parameters.format ?? 'extended-json',
      filter: parameters.filter ?? {},
      projection: parameters.projection ?? {},
      sort: parameters.sort ?? {},
      batchSize: parameters.batchSize ?? 1000,
    }, null, 2)
  }

  if (request.operationId.endsWith('collection.import')) {
    return JSON.stringify({
      database,
      collection,
      operation: 'import',
      format: parameters.format ?? 'json',
      mode: parameters.mode ?? 'insertMany',
      validation: parameters.validation ?? 'validate-before-write',
      mapping: parameters.mapping ?? {},
    }, null, 2)
  }

  if (request.operationId.endsWith('gridfs.export')) {
    const bucket = String(parameters.bucket ?? 'fs')
    return JSON.stringify({
      database,
      bucket,
      operation: 'gridfs.export',
      filename: parameters.filename ?? '*',
      filesCollection: parameters.filesCollection ?? `${bucket}.files`,
      chunksCollection: parameters.chunksCollection ?? `${bucket}.chunks`,
      format: parameters.format ?? 'binary',
      checks: ['file-metadata', 'chunk-sequence', 'missing-chunks'],
    }, null, 2)
  }

  if (request.operationId.endsWith('gridfs.upload')) {
    const bucket = String(parameters.bucket ?? 'fs')
    return JSON.stringify({
      database,
      bucket,
      operation: 'gridfs.upload',
      source: parameters.source ?? '<selected-file>',
      filename: parameters.filename ?? '<filename>',
      filesCollection: parameters.filesCollection ?? `${bucket}.files`,
      chunksCollection: parameters.chunksCollection ?? `${bucket}.chunks`,
      metadata: parameters.metadata ?? {},
      validation: parameters.validation ?? 'validate-before-write',
    }, null, 2)
  }

  if (request.operationId.endsWith('gridfs.validate')) {
    const bucket = String(parameters.bucket ?? 'fs')
    return JSON.stringify({
      database,
      bucket,
      operation: 'gridfs.validate',
      filesCollection: parameters.filesCollection ?? `${bucket}.files`,
      chunksCollection: parameters.chunksCollection ?? `${bucket}.chunks`,
      checks: ['missing-chunks', 'orphaned-chunks', 'chunk-order'],
    }, null, 2)
  }

  if (request.operationId.endsWith('user.create')) {
    return JSON.stringify({
      database,
      createUser: name,
      pwd: parameters.password ?? '<secret>',
      roles: parameters.roles ?? [],
    }, null, 2)
  }

  if (request.operationId.endsWith('user.drop')) {
    return JSON.stringify({
      database,
      dropUser: name,
    }, null, 2)
  }

  if (request.operationId.endsWith('role.create')) {
    return JSON.stringify({
      database,
      createRole: name,
      privileges: parameters.privileges ?? [],
      roles: parameters.roles ?? [],
    }, null, 2)
  }

  if (request.operationId.endsWith('role.drop')) {
    return JSON.stringify({
      database,
      dropRole: name,
    }, null, 2)
  }

  return JSON.stringify({
    operation: request.operationId,
    database,
    parameters,
  }, null, 2)
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
