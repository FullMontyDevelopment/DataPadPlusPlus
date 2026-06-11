import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'
import { timescalePolicyDisabledReason } from '../../timescale-capabilities'

export function buildTimescaleOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'timescaledb' || !capabilities.has('supports_admin_operations')) {
    return []
  }

  return [
    timescaleOperation(connection, 'timescaledb.timescale.compression-policy', 'Compression Policy', 'table', 'write', 'Preview adding or updating a TimescaleDB compression policy.', 'compression'),
    timescaleOperation(connection, 'timescaledb.timescale.retention-policy', 'Retention Policy', 'table', 'destructive', 'Preview adding or updating a TimescaleDB retention policy.', 'retention'),
    timescaleOperation(connection, 'timescaledb.timescale.refresh-continuous-aggregate', 'Refresh Aggregate', 'query', 'costly', 'Preview refreshing a TimescaleDB continuous aggregate.', 'aggregate'),
    timescaleOperation(connection, 'timescaledb.timescale.job-control', 'Job Control', 'cluster', 'write', 'Preview pausing, resuming, or manually running a TimescaleDB background job.', 'job'),
  ]
}

function timescaleOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: OperationManifestResponse['operations'][number]['scope'],
  risk: OperationManifestResponse['operations'][number]['risk'],
  description: string,
  disabledKind: 'compression' | 'retention' | 'aggregate' | 'job',
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
    disabledReason: timescalePolicyDisabledReason(connection, disabledKind),
    previewOnly: true,
  }
}
