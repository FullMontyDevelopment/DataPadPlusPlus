import type { ConnectionProfile, QueryTabState } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import type { ObjectViewOperationAction } from '../../ObjectViewOperationStrip'

type JsonRecord = Record<string, unknown>

export function liteDbOperationActions(
  connection: ConnectionProfile,
  tab: QueryTabState,
  kind: string,
  payload: JsonRecord,
): ObjectViewOperationAction[] {
  const supported = supportedLiteDbOperations(connection)
  const scope = liteDbScope(connection, tab, payload)
  const actions: ObjectViewOperationAction[] = []

  const collectionLike = ['collection', 'documents', 'schema', 'statistics', 'indexes', 'index'].includes(kind)
  const storageLike = ['database', 'storage', 'pragmas', 'maintenance', 'settings', 'diagnostics', 'file-storage', 'files', 'chunks'].includes(kind)
  const indexLike = ['collection', 'indexes', 'index'].includes(kind)

  if (storageLike && supported.has('metrics')) {
    actions.push(action(connection, 'diagnostics.metrics', 'Health', 'Preview local-file health and storage checks.', 'metrics', scope))
  }

  if (storageLike && supported.has('admin')) {
    actions.push(action(connection, 'storage.checkpoint', 'Checkpoint', 'Preview a LiteDB checkpoint before file maintenance.', 'storage', scope))
    actions.push(action(connection, 'storage.compact', 'Compact', 'Preview a guarded local file compaction workflow.', 'storage', scope, {
      outputFile: '<selected-folder>/compacted.db',
    }))
    actions.push(action(connection, 'storage.rebuild-indexes', 'Rebuild', 'Preview a guarded index rebuild workflow.', 'index', scope))
  }

  if (indexLike && supported.has('index')) {
    actions.push(action(connection, 'index.create', 'Create Index', 'Preview a LiteDB EnsureIndex workflow.', 'index', scope, {
      field: 'id',
      unique: false,
    }))
  }

  if (['indexes', 'index'].includes(kind) && supported.has('index')) {
    actions.push(action(connection, 'index.drop', 'Drop Index', 'Preview a guarded LiteDB index drop.', 'index', scope))
  }

  if ((collectionLike || storageLike) && supported.has('importExport')) {
    actions.push(action(connection, 'data.import-export', 'Export', 'Preview JSON/NDJSON export from the local file.', 'document', scope, {
      mode: 'export',
      format: collectionLike ? 'json' : 'file-storage',
    }))
  }

  if (storageLike && supported.has('backupRestore')) {
    actions.push(action(connection, 'data.backup-restore', 'Backup', 'Preview a compact local database backup.', 'storage', scope, {
      mode: 'backup',
    }))
  }

  if (collectionLike && supported.has('admin')) {
    actions.push(action(connection, 'object.drop', 'Drop', 'Preview a destructive collection deletion.', 'delete', scope))
  }

  return dedupe(actions).slice(0, 8)
}

function supportedLiteDbOperations(connection: ConnectionProfile) {
  const capabilities = new Set(datastoreBacklogByEngine(connection.engine)?.capabilities ?? [])
  const supported = new Set<string>()

  if (capabilities.has('supports_metrics_collection') || capabilities.has('supports_local_database_creation')) supported.add('metrics')
  if (capabilities.has('supports_index_management')) supported.add('index')
  if (capabilities.has('supports_import_export')) supported.add('importExport')
  if (capabilities.has('supports_backup_restore')) supported.add('backupRestore')
  if (capabilities.has('supports_admin_operations')) supported.add('admin')

  return supported
}

function action(
  connection: ConnectionProfile,
  suffix: string,
  label: string,
  title: string,
  icon: ObjectViewOperationAction['icon'],
  scope: LiteDbOperationScope,
  extraParameters: Record<string, unknown> = {},
): ObjectViewOperationAction {
  return {
    label,
    title,
    icon,
    operationId: `${connection.engine}.${suffix}`,
    objectName: scope.objectName,
    parameters: {
      databaseFile: scope.databaseFile,
      collection: scope.collection,
      indexName: scope.indexName,
      objectKind: scope.kind,
      ...extraParameters,
    },
  }
}

type LiteDbOperationScope = {
  databaseFile: string
  collection?: string
  indexName?: string
  kind: string
  objectName: string
}

function liteDbScope(
  connection: ConnectionProfile,
  tab: QueryTabState,
  payload: JsonRecord,
): LiteDbOperationScope {
  const nodeId = tab.objectViewState?.nodeId ?? ''
  const parts = nodeId.split(':')
  const collectionFromNode = parts[1] === 'collection' || parts[1] === 'documents' || parts[1] === 'schema' || parts[1] === 'collection-statistics'
    ? parts.at(-1)
    : parts[1] === 'index'
      ? parts.at(-2)
      : undefined
  const indexName = parts[1] === 'index' ? parts.at(-1) : stringValue(payload.indexName)
  const collection = stringValue(payload.collection) || collectionFromNode
  const databaseFile = stringValue(payload.database) || fileName(connection.database || connection.host || connection.name)
  const kind = normalizeKind(tab.objectViewState?.kind ?? stringValue(payload.objectView) ?? 'database')
  const objectName = collection || databaseFile

  return { databaseFile, collection, indexName, kind, objectName }
}

function fileName(value: string) {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function normalizeKind(value: string) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, '-')
}

function dedupe(actions: ObjectViewOperationAction[]) {
  const seen = new Set<string>()
  return actions.filter((candidate) => {
    const key = `${candidate.operationId}:${candidate.objectName}:${candidate.label}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}
