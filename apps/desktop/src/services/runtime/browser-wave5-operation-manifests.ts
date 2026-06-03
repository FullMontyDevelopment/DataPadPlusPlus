import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

type Operation = OperationManifestResponse['operations'][number]

export function buildWaveFiveOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  return [
    ...buildTimeSeriesOperationManifests(connection, capabilities),
    ...buildGraphOperationManifests(connection, capabilities),
  ]
}

function buildTimeSeriesOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  const operations: OperationManifestResponse['operations'] = []

  if (connection.engine === 'prometheus' && capabilities.has('supports_metrics_collection')) {
    operations.push(operation(
      connection,
      'prometheus.cardinality.analyze',
      'Analyze Cardinality',
      'query',
      'costly',
      ['supports_metrics_collection'],
      ['metrics', 'series', 'table', 'json'],
      'Preview a bounded Prometheus series-cardinality analysis request.',
      'Prometheus cardinality analysis is guarded and adapter-specific.',
      true,
    ))
  }

  if (connection.engine === 'influxdb' && capabilities.has('supports_admin_operations')) {
    operations.push(operation(
      connection,
      'influxdb.retention.update',
      'Update Retention',
      'database',
      'write',
      ['supports_admin_operations'],
      ['diff', 'metrics', 'raw'],
      'Preview a guarded InfluxDB bucket retention-policy update.',
      'InfluxDB retention updates are guarded and adapter-specific.',
      true,
    ))
  }

  if (connection.engine === 'opentsdb' && capabilities.has('supports_admin_operations')) {
    operations.push(operation(
      connection,
      'opentsdb.uid.repair',
      'Repair UID Metadata',
      'schema',
      'write',
      ['supports_admin_operations'],
      ['diff', 'metrics', 'raw'],
      'Preview a guarded OpenTSDB UID metadata repair workflow.',
      'OpenTSDB UID repair is guarded and adapter-specific.',
      true,
    ))
  }

  return operations
}

function buildGraphOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (
    connection.engine !== 'neptune' ||
    !capabilities.has('supports_cloud_iam') ||
    capabilities.has('supports_permission_inspection')
  ) {
    return []
  }

  return [
    operation(
      connection,
      'neptune.security.inspect',
      'Inspect Permissions',
      'role',
      'read',
      ['supports_cloud_iam'],
      ['table', 'json'],
      'Preview IAM and Neptune database action checks for this graph profile.',
      'Neptune IAM inspection requires a signed cloud runtime before live execution.',
      false,
    ),
  ]
}

function operation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: Operation['scope'],
  risk: Operation['risk'],
  requiredCapabilities: Operation['requiredCapabilities'],
  supportedRenderers: Operation['supportedRenderers'],
  description: string,
  disabledReason: string,
  requiresConfirmation: boolean,
): Operation {
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
    requiresConfirmation,
    executionSupport: 'plan-only',
    disabledReason,
    previewOnly: true,
  }
}
