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
    return JSON.stringify({
      operation: 'LiteDB.Checkpoint',
      databaseFile,
      preflight: ['verify-file-lock', 'flush-dirty-pages'],
      effect: 'persist pending pages without changing collection data',
    }, null, 2)
  }

  if (request.operationId.endsWith('storage.compact')) {
    return JSON.stringify({
      operation: 'LiteDB.Compact',
      databaseFile,
      outputFile: stringParameter(parameters, 'outputFile') || '<selected-folder>/compacted.db',
      preflight: ['checkpoint', 'verify-exclusive-or-online-copy-support', 'preserve-encryption-settings'],
      validation: ['open-compacted-copy', 'compare-collection-counts', 'compare-index-counts'],
    }, null, 2)
  }

  if (request.operationId.endsWith('index.create')) {
    return `db.GetCollection("${escapeQuoted(collection)}").EnsureIndex("${escapeQuoted(indexName)}", "${escapeQuoted(field)}", ${Boolean(parameters.unique)});`
  }

  if (request.operationId.endsWith('index.drop')) {
    return `db.GetCollection("${escapeQuoted(collection)}").DropIndex("${escapeQuoted(indexName)}");`
  }

  if (request.operationId.endsWith('data.import-export')) {
    const mode = stringParameter(parameters, 'mode') || 'export'
    const format = stringParameter(parameters, 'format') || 'json'
    return JSON.stringify({
      operation: mode === 'import' ? 'LiteDB.ImportCollection' : 'LiteDB.ExportCollection',
      databaseFile,
      collection,
      format,
      file: `<selected-file>.${format === 'ndjson' ? 'ndjson' : 'json'}`,
      validation: mode === 'import' ? 'parse-bson-and-validate-indexes' : 'stream-with-bounded-memory',
    }, null, 2)
  }

  if (request.operationId.endsWith('data.backup-restore')) {
    return JSON.stringify({
      operation: 'LiteDB.Backup',
      databaseFile,
      outputFile: '<selected-folder>/backup.db',
      preflight: ['checkpoint', 'verify-file-lock', 'preserve-encryption-settings'],
    }, null, 2)
  }

  if (request.operationId.endsWith('object.drop')) {
    return `-- Review before running.\ndb.DropCollection("${escapeQuoted(collection)}");`
  }

  return JSON.stringify({ operation: request.operationId, databaseFile, collection, parameters }, null, 2)
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
