import type { OperationPlanRequest } from '@datapadplusplus/shared-types'

export function liteDbOperationRequest(request: OperationPlanRequest) {
  const parameters = request.parameters ?? {}
  const databaseFile = stringParameter(parameters, 'databaseFile') || '<selected-file>.db'
  const collection = stringParameter(parameters, 'collection') || request.objectName || '<collection>'
  const indexName = stringParameter(parameters, 'indexName') || `idx_${safeIdentifier(collection)}_id`
  const field = stringParameter(parameters, 'field') || 'id'

  if (request.operationId.endsWith('diagnostics.metrics')) {
    return [
      `open "${databaseFile}"`,
      'db.Engine.UserVersion',
      'db.Checkpoint()',
      'inspect pages, freelist, collections, indexes',
    ].join('\n')
  }

  if (request.operationId.endsWith('storage.checkpoint')) {
    return stringifyLiteDbPlan(
      {
        operation: 'LiteDB.Checkpoint',
        databaseFile,
        preflight: ['verify-file-lock', 'flush-dirty-pages'],
        effect: 'persist pending pages without changing collection data',
      },
      databaseFile,
      'storage-checkpoint',
      true,
    )
  }

  if (request.operationId.endsWith('storage.compact')) {
    return stringifyLiteDbPlan(
      {
        operation: 'LiteDB.Compact',
        databaseFile,
        outputFile: stringParameter(parameters, 'outputFile') || '<selected-folder>/compacted.db',
        preflight: ['checkpoint', 'verify-exclusive-or-online-copy-support', 'preserve-encryption-settings'],
        validation: ['open-compacted-copy', 'compare-collection-counts', 'compare-index-counts'],
      },
      databaseFile,
      'storage-compact',
      true,
    )
  }

  if (request.operationId.endsWith('storage.rebuild-indexes')) {
    return stringifyLiteDbPlan(
      {
        operation: 'LiteDB.RebuildIndexes',
        databaseFile,
        collection,
        preflight: ['checkpoint', 'verify-file-lock', 'list-indexes'],
        validation: ['compare-index-counts', 'sample-indexed-queries'],
      },
      databaseFile,
      'storage-rebuild-indexes',
      true,
    )
  }

  if (request.operationId.endsWith('index.create')) {
    return stringifyLiteDbPlan(
      {
        operation: 'LiteDB.EnsureIndex',
        databaseFile,
        collection,
        indexName,
        field,
        unique: Boolean(parameters.unique),
        statement: `db.GetCollection("${escapeQuoted(collection)}").EnsureIndex("${escapeQuoted(indexName)}", "${escapeQuoted(field)}", ${Boolean(parameters.unique)});`,
      },
      databaseFile,
      'index-create',
      true,
    )
  }

  if (request.operationId.endsWith('index.drop')) {
    return stringifyLiteDbPlan(
      {
        operation: 'LiteDB.DropIndex',
        databaseFile,
        collection,
        indexName,
        statement: `db.GetCollection("${escapeQuoted(collection)}").DropIndex("${escapeQuoted(indexName)}");`,
      },
      databaseFile,
      'index-drop',
      true,
    )
  }

  if (request.operationId.endsWith('data.import-export')) {
    const mode = stringParameter(parameters, 'mode') || 'export'
    const format = stringParameter(parameters, 'format') || 'json'
    return stringifyLiteDbPlan(
      {
        operation: mode === 'import' ? 'LiteDB.ImportCollection' : 'LiteDB.ExportCollection',
        databaseFile,
        collection,
        format,
        file: `<selected-file>.${format === 'ndjson' ? 'ndjson' : 'json'}`,
        validation: mode === 'import' ? 'parse-bson-and-validate-indexes' : 'stream-with-bounded-memory',
      },
      databaseFile,
      `data-${mode}`,
      mode === 'import',
    )
  }

  if (request.operationId.endsWith('data.backup-restore')) {
    return stringifyLiteDbPlan(
      {
        operation: 'LiteDB.Backup',
        databaseFile,
        outputFile: '<selected-folder>/backup.db',
        preflight: ['checkpoint', 'verify-file-lock', 'preserve-encryption-settings'],
      },
      databaseFile,
      'data-backup',
      false,
    )
  }

  if (request.operationId.endsWith('object.drop')) {
    return stringifyLiteDbPlan(
      {
        operation: 'LiteDB.DropCollection',
        databaseFile,
        collection,
        statement: `db.DropCollection("${escapeQuoted(collection)}");`,
      },
      databaseFile,
      'object-drop',
      true,
    )
  }

  return stringifyLiteDbPlan(
    { operation: request.operationId, databaseFile, collection, parameters },
    databaseFile,
    'operation-preview',
    false,
  )
}

function stringifyLiteDbPlan(
  plan: Record<string, unknown>,
  databaseFile: string,
  intent: string,
  writeIntent: boolean,
) {
  const localFilePreflight = liteDbLocalFilePreflight(databaseFile, intent, writeIntent)
  return JSON.stringify(
    {
      ...plan,
      localFilePreflight,
      sidecarExecutionBoundary: localFilePreflight.sidecarExecutionBoundary,
    },
    null,
    2,
  )
}

function liteDbLocalFilePreflight(databaseFile: string, intent: string, writeIntent: boolean) {
  return {
    databaseFile,
    intent,
    pathResolution: {
      source: 'operation-parameters',
      normalizedPath: databaseFile,
      requiresConcreteLocalPathBeforeExecution: true,
    },
    probes: ['filesystem-read-open', 'filesystem-write-open-if-writable'],
    encryptionBoundary: {
      passwordSource: 'connection-profile-secret',
      status: 'sidecar-required',
      requiredForEncryptedFiles: [
        'redacted password resolution',
        'sidecar LiteDB open probe',
        'request validation against the encrypted file',
      ],
    },
    lockBoundary: {
      scope: 'local-file-preflight',
      writeIntent,
      crossProcessContentionValidated: false,
      exclusiveWriterLockValidated: false,
      sidecarLockProbe: 'required-before-live-execution',
      residualRisks: [
        'Plain filesystem probes do not prove LiteDB engine shared/exclusive lock behavior.',
        'External-process contention and dirty-page checkpoint state require the .NET sidecar.',
      ],
    },
    sidecarExecutionBoundary: liteDbSidecarExecutionBoundary(intent, writeIntent),
  }
}

function liteDbSidecarExecutionBoundary(intent: string, writeIntent: boolean) {
  return {
    runtime: 'dotnet-litedb-sidecar',
    status: 'plan-only-until-sidecar',
    intent,
    writeIntent,
    requestShapeValidated: true,
    liveExecutionValidated: false,
    blockedReasons: [
      'sidecar-dispatch-not-implemented',
      writeIntent ? 'exclusive-writer-lock-not-validated' : 'litedb-engine-open-probe-not-validated',
      'encrypted-file-open-not-validated',
    ],
    promotionRequirements: [
      'bundled or configured LiteDB sidecar executable',
      'sidecar read/open probe with bounded response',
      'exclusive writer-lock evidence for mutations and maintenance',
      'encrypted-file open failure/success evidence without leaking secrets',
      'before/after validation for document edits and file workflows',
    ],
  }
}

function stringParameter(parameters: Record<string, unknown>, key: string) {
  const value = parameters[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function safeIdentifier(value: string) {
  return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'collection'
}

function escapeQuoted(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
