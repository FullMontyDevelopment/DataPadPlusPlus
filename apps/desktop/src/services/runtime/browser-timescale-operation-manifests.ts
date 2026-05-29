import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

export function buildTimescaleOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'timescaledb' || !capabilities.has('supports_admin_operations')) {
    return []
  }

  return [
    timescaleOperation(connection, 'timescaledb.timescale.compression-policy', 'Compression Policy', 'table', 'write', 'Preview adding or updating a TimescaleDB compression policy.'),
    timescaleOperation(connection, 'timescaledb.timescale.retention-policy', 'Retention Policy', 'table', 'destructive', 'Preview adding or updating a TimescaleDB retention policy.'),
    timescaleOperation(connection, 'timescaledb.timescale.refresh-continuous-aggregate', 'Refresh Aggregate', 'query', 'costly', 'Preview refreshing a TimescaleDB continuous aggregate.'),
  ]
}

function timescaleOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: OperationManifestResponse['operations'][number]['scope'],
  risk: OperationManifestResponse['operations'][number]['risk'],
  description: string,
): OperationManifestResponse['operations'][number] {
  return {
    id,
    engine: connection.engine,
    family: connection.family,
    label,
    scope,
    risk,
    requiredCapabilities: ['supports_admin_operations'],
    supportedRenderers: ['diff', 'profile', 'raw'],
    description,
    requiresConfirmation: true,
    executionSupport: 'plan-only',
    disabledReason: 'TimescaleDB policy and refresh execution is guarded and adapter-specific.',
    previewOnly: true,
  }
}
