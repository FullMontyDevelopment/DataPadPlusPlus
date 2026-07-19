import type { OperationPlanRequest } from '@datapadplusplus/shared-types'

export function mongoOperationRequest(request: OperationPlanRequest) {
  const parameters = request.parameters ?? {}
  const collection = String(parameters.collection ?? request.objectName ?? '<collection>')
  const indexName = String(parameters.indexName ?? '<index>')
  const database = String(parameters.database ?? '<database>')
  const name = String(parameters.name ?? request.objectName ?? '<name>')
  const format = String(parameters.format ?? 'extended-json')

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

  if (request.operationId.endsWith('database.create') || request.operationId.endsWith('collection.create')) {
    return JSON.stringify({
      database: request.operationId.endsWith('database.create') ? String(parameters.database ?? request.objectName ?? '<database>') : database,
      create: request.operationId.endsWith('database.create') ? String(parameters.collection ?? '<first_collection>') : collection,
      ...asRecord(parameters.options),
    }, null, 2)
  }

  if (request.operationId.endsWith('database.drop')) {
    return JSON.stringify({
      database,
      dropDatabase: 1,
    }, null, 2)
  }

  if (request.operationId.endsWith('collection.drop')) {
    return JSON.stringify({
      database,
      drop: collection,
    }, null, 2)
  }

  if (request.operationId.endsWith('collection.rename')) {
    const newCollection = String(parameters.newCollection ?? parameters.newName ?? parameters.to ?? '<new_collection>')
    const targetDatabase = String(parameters.targetDatabase ?? database)
    return JSON.stringify({
      database: 'admin',
      renameCollection: `${database}.${collection}`,
      to: `${targetDatabase}.${newCollection}`,
      dropTarget: parameters.dropTarget ?? false,
    }, null, 2)
  }

  if (request.operationId.endsWith('collection.modify')) {
    return JSON.stringify({
      database,
      collMod: collection,
      ...asRecord(parameters.modification),
      ...asRecord(parameters.options),
      ...pickDefined(parameters, [
        'validator',
        'validationLevel',
        'validationAction',
        'index',
        'changeStreamPreAndPostImages',
        'expireAfterSeconds',
      ]),
    }, null, 2)
  }

  if (request.operationId.endsWith('collection.convert-to-capped')) {
    return JSON.stringify({
      database,
      convertToCapped: collection,
      size: parameters.size ?? '<bytes>',
    }, null, 2)
  }

  if (request.operationId.endsWith('collection.clone-as-capped')) {
    return JSON.stringify({
      database,
      cloneCollectionAsCapped: collection,
      toCollection: parameters.targetCollection ?? parameters.toCollection ?? '<target_collection>',
      size: parameters.size ?? '<bytes>',
    }, null, 2)
  }

  if (request.operationId.endsWith('collection.compact')) {
    return JSON.stringify({
      database,
      compact: collection,
      ...(parameters.force === undefined ? {} : { force: parameters.force }),
      ...asRecord(parameters.options),
    }, null, 2)
  }

  if (request.operationId.endsWith('collection.validate')) {
    return JSON.stringify({
      database,
      validate: collection,
      ...(parameters.full === undefined ? {} : { full: parameters.full }),
      ...asRecord(parameters.options),
    }, null, 2)
  }

  if (request.operationId.endsWith('collection.export')) {
    return JSON.stringify({
      database,
      collection,
      operation: 'export',
      workflow: 'mongodb.collection.export',
      format,
      target: {
        kind: 'file',
        path: parameters.targetPath ?? parameters.outputPath ?? `<selected-file>.${mongoExportExtension(format)}`,
      },
      filter: parameters.filter ?? {},
      projection: parameters.projection ?? {},
      sort: parameters.sort ?? {},
      limit: parameters.limit ?? null,
      batchSize: parameters.batchSize ?? 1000,
      serializer: {
        supportedFormats: ['json', 'extended-json', 'ndjson', 'csv', 'bson'],
        extendedJsonMode: parameters.extendedJsonMode ?? 'relaxed',
        includeMetadata: parameters.includeMetadata ?? true,
      },
      validation: {
        dryRunFirst: true,
        explainFilter: true,
        requireReadableTarget: true,
      },
      executionGate: mongoFileWorkflowGate('read collection data and write the selected export file'),
    }, null, 2)
  }

  if (request.operationId.endsWith('collection.import')) {
    return JSON.stringify({
      database,
      collection,
      operation: 'import',
      workflow: 'mongodb.collection.import',
      format,
      source: {
        kind: 'file',
        path: parameters.sourcePath ?? parameters.inputPath ?? `<selected-file>.${mongoImportExtension(format)}`,
      },
      mode: parameters.mode ?? 'insertMany',
      validation: parameters.validation ?? 'validate-before-write',
      ordered: parameters.ordered ?? false,
      batchSize: parameters.batchSize ?? 1000,
      createCollection: parameters.createCollection ?? false,
      duplicateKeyPolicy: parameters.duplicateKeyPolicy ?? 'stop',
      mapping: parameters.mapping ?? {},
      parser: {
        supportedFormats: ['json', 'extended-json', 'ndjson', 'csv', 'bson'],
        extendedJsonMode: parameters.extendedJsonMode ?? 'relaxed',
        csvHeader: parameters.csvHeader ?? true,
      },
      checks: [
        'file-readable',
        'format-detected',
        'document-shape',
        'validator-compatible',
        'duplicate-key-policy',
      ],
      executionGate: mongoFileWorkflowGate('read the selected import file and write documents only after validation'),
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

export function mongoManagementRefreshScopes(request: OperationPlanRequest) {
  if (!isMongoManagementOperation(request.operationId)) {
    return []
  }

  const parameters = request.parameters ?? {}
  const database = stringParameter(parameters.database)
  const targetDatabase = stringParameter(parameters.targetDatabase)
  const scopes = new Set(['databases', 'system-databases'])

  for (const name of [database, targetDatabase].filter(Boolean)) {
    scopes.add(`database:${name}`)
    scopes.add(`collections:${name}`)
    scopes.add(`time-series-collections:${name}`)
    scopes.add(`capped-collections:${name}`)
    scopes.add(`views:${name}`)
  }

  return [...scopes]
}

function isMongoManagementOperation(operationId: string) {
  return operationId === 'mongodb.database.create' ||
    operationId === 'mongodb.database.drop' ||
    operationId === 'mongodb.collection.create' ||
    operationId === 'mongodb.collection.drop' ||
    operationId === 'mongodb.collection.rename' ||
    operationId === 'mongodb.collection.modify' ||
    operationId === 'mongodb.collection.convert-to-capped' ||
    operationId === 'mongodb.collection.clone-as-capped' ||
    operationId === 'mongodb.collection.compact' ||
    operationId === 'mongodb.collection.validate'
}

function stringParameter(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function pickDefined(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys
    .filter((key) => source[key] !== undefined)
    .map((key) => [key, source[key]]))
}

function mongoExportExtension(format: string) {
  if (format === 'ndjson') return 'ndjson'
  if (format === 'csv') return 'csv'
  if (format === 'bson') return 'bson'
  return 'json'
}

function mongoImportExtension(format: string) {
  return mongoExportExtension(format)
}

function mongoFileWorkflowGate(permission: string) {
  return {
    owner: 'mongodb-adapter',
    defaultSupport: 'plan-only',
    requiredPermission: permission,
    evidenceRequiredForLive: [
      'confirmed file picker path',
      'serializer/parser fixture coverage for the selected format',
      'read-only profile check',
      'environment confirmation for write or costly work',
      'before/after summary for writes',
    ],
  }
}
