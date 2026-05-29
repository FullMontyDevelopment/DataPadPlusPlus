import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

export function buildMysqlOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if ((connection.engine !== 'mysql' && connection.engine !== 'mariadb') || !capabilities.has('supports_admin_operations')) {
    return []
  }

  return [
    mysqlOperation(connection, `${connection.engine}.table.check`, 'Check Table', 'table', 'diagnostic', ['table', 'raw'], 'Preview a MySQL-compatible table integrity check.'),
    mysqlOperation(connection, `${connection.engine}.table.analyze`, 'Analyze Table', 'table', 'costly', ['profile', 'metrics', 'raw'], 'Preview refreshing optimizer statistics for a table.'),
    mysqlOperation(connection, `${connection.engine}.table.optimize`, 'Optimize Table', 'table', 'costly', ['profile', 'diff', 'raw'], 'Preview a guarded table optimization request.'),
    mysqlOperation(connection, `${connection.engine}.table.repair`, 'Repair Table', 'table', 'destructive', ['diff', 'raw'], 'Preview a guarded MySQL-compatible table repair request.'),
    mysqlOperation(connection, `${connection.engine}.event.enable`, 'Enable Event', 'database', 'write', ['diff', 'raw'], 'Preview enabling a scheduled event.'),
    mysqlOperation(connection, `${connection.engine}.event.disable`, 'Disable Event', 'database', 'write', ['diff', 'raw'], 'Preview disabling a scheduled event.'),
  ]
}

function mysqlOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: OperationManifestResponse['operations'][number]['scope'],
  risk: OperationManifestResponse['operations'][number]['risk'],
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
    requiredCapabilities: ['supports_admin_operations'],
    supportedRenderers,
    description,
    requiresConfirmation: risk !== 'diagnostic',
    executionSupport: 'plan-only',
    disabledReason: `${label} is guarded and adapter-specific.`,
    previewOnly: true,
  }
}
