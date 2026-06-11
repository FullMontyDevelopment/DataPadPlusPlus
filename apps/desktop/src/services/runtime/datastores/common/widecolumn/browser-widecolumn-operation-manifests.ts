import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

export function buildWideColumnOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'dynamodb' || !capabilities.has('supports_admin_operations')) {
    return []
  }

  const operations: OperationManifestResponse['operations'] = [
    dynamoOperation(connection, 'dynamodb.capacity.update', 'Update Capacity', 'table', 'write', ['supports_admin_operations', 'supports_cost_estimation'], ['costEstimate', 'metrics', 'raw'], 'Preview a guarded billing-mode or throughput update with cost checks.'),
    dynamoOperation(connection, 'dynamodb.ttl.update', 'Update TTL', 'table', 'write', ['supports_admin_operations'], ['diff', 'raw'], 'Preview enabling or changing table TTL settings.'),
    dynamoOperation(connection, 'dynamodb.streams.update', 'Update Streams', 'table', 'write', ['supports_admin_operations'], ['diff', 'raw'], 'Preview enabling or changing DynamoDB Streams settings.'),
  ]

  if (capabilities.has('supports_backup_restore')) {
    operations.push(
      dynamoOperation(connection, 'dynamodb.backup.create', 'Create Backup', 'table', 'costly', ['supports_backup_restore'], ['metrics', 'raw'], 'Preview creating an on-demand table backup.'),
      dynamoOperation(connection, 'dynamodb.backup.restore', 'Restore Backup', 'table', 'destructive', ['supports_backup_restore'], ['diff', 'raw'], 'Preview restoring a table from a selected backup.'),
    )
  }

  return operations
}

function dynamoOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: OperationManifestResponse['operations'][number]['scope'],
  risk: OperationManifestResponse['operations'][number]['risk'],
  requiredCapabilities: OperationManifestResponse['operations'][number]['requiredCapabilities'],
  supportedRenderers: OperationManifestResponse['operations'][number]['supportedRenderers'],
  description: string,
): OperationManifestResponse['operations'][number] {
  return {
    id,
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
