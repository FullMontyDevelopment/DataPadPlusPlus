import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

type Operation = OperationManifestResponse['operations'][number]

export function buildSearchOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.family !== 'search') {
    return []
  }

  const operations: OperationManifestResponse['operations'] = []

  if (capabilities.has('supports_index_management')) {
    operations.push(
      searchOperation(connection, 'index.force-merge', 'Force Merge', 'index', 'costly', ['supports_index_management'], ['profile', 'metrics', 'raw'], 'Preview a guarded Lucene segment force-merge request.'),
      searchOperation(connection, 'index.clear-cache', 'Clear Cache', 'index', 'diagnostic', ['supports_index_management'], ['metrics', 'raw'], 'Preview clearing index-level query/request caches.'),
      searchOperation(connection, 'index.reindex', 'Reindex', 'index', 'write', ['supports_index_management'], ['diff', 'profile', 'raw'], 'Preview copying documents into a destination index.'),
      searchOperation(connection, 'index.close', 'Close Index', 'index', 'write', ['supports_index_management'], ['diff', 'raw'], 'Preview closing an index.'),
      searchOperation(connection, 'index.open', 'Open Index', 'index', 'write', ['supports_index_management'], ['diff', 'raw'], 'Preview opening a closed index.'),
      searchOperation(connection, 'template.delete', 'Delete Template', 'index', 'destructive', ['supports_index_management'], ['diff', 'raw'], 'Preview deleting an index or component template.'),
      searchOperation(connection, 'pipeline.put', 'Update Pipeline', 'schema', 'write', ['supports_index_management'], ['schema', 'diff', 'raw'], 'Preview creating or updating an ingest pipeline.'),
      searchOperation(connection, 'lifecycle.put', connection.engine === 'opensearch' ? 'Update ISM Policy' : 'Update ILM Policy', 'schema', 'write', ['supports_index_management'], ['schema', 'diff', 'raw'], 'Preview updating index lifecycle or state-management policy.'),
    )
  }

  if (capabilities.has('supports_query_profile')) {
    operations.push(searchOperation(connection, 'task.cancel', 'Cancel Task', 'query', 'write', ['supports_query_profile'], ['diff', 'raw'], 'Preview canceling a running search cluster task.'))
  }

  if (capabilities.has('supports_backup_restore')) {
    operations.push(searchOperation(connection, 'snapshot.restore', 'Restore Snapshot', 'connection', 'destructive', ['supports_backup_restore'], ['diff', 'raw'], 'Preview restoring a snapshot into the cluster.'))
  }

  return operations
}

function searchOperation(
  connection: ConnectionProfile,
  suffix: string,
  label: string,
  scope: Operation['scope'],
  risk: Operation['risk'],
  requiredCapabilities: Operation['requiredCapabilities'],
  supportedRenderers: Operation['supportedRenderers'],
  description: string,
): Operation {
  return {
    id: `${connection.engine}.${suffix}`,
    engine: connection.engine,
    family: connection.family,
    label,
    scope,
    risk,
    requiredCapabilities,
    supportedRenderers,
    description,
    requiresConfirmation: risk !== 'diagnostic',
    executionSupport: 'plan-only',
    disabledReason: `${label} is guarded and adapter-specific.`,
    previewOnly: true,
  }
}
