import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

type Operation = OperationManifestResponse['operations'][number]

export function buildSqlServerOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'sqlserver') {
    return []
  }

  const operations: OperationManifestResponse['operations'] = []

  if (capabilities.has('supports_admin_operations')) {
    operations.push(
      sqlServerOperation(connection, 'sqlserver.statistics.update', 'Update Statistics', 'table', 'costly', ['profile', 'metrics', 'raw'], 'Preview refreshing SQL Server optimizer statistics.'),
      sqlServerOperation(connection, 'sqlserver.query-store.top-queries', 'Query Store Top Queries', 'query', 'diagnostic', ['table', 'profile', 'metrics'], 'Preview Query Store workload review.'),
    )
  }

  if (capabilities.has('supports_index_management')) {
    operations.push(
      sqlServerOperation(connection, 'sqlserver.index.reorganize', 'Reorganize Index', 'index', 'costly', ['diff', 'profile', 'raw'], 'Preview online-friendly index reorganization.'),
      sqlServerOperation(connection, 'sqlserver.index.rebuild', 'Rebuild Index', 'index', 'costly', ['diff', 'profile', 'raw'], 'Preview guarded SQL Server index rebuild.'),
      sqlServerOperation(connection, 'sqlserver.index.disable', 'Disable Index', 'index', 'write', ['diff', 'raw'], 'Preview disabling an index.'),
      sqlServerOperation(connection, 'sqlserver.index.enable', 'Enable Index', 'index', 'costly', ['diff', 'profile', 'raw'], 'Preview rebuilding a disabled index.'),
    )
  }

  return operations
}

function sqlServerOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: Operation['scope'],
  risk: Operation['risk'],
  supportedRenderers: Operation['supportedRenderers'],
  description: string,
): Operation {
  return {
    id,
    engine: connection.engine,
    family: connection.family,
    label,
    scope,
    risk,
    requiredCapabilities: risk === 'diagnostic'
      ? ['supports_admin_operations']
      : id.includes('.index.')
        ? ['supports_index_management']
        : ['supports_admin_operations'],
    supportedRenderers,
    description,
    requiresConfirmation: risk !== 'diagnostic',
    executionSupport: 'plan-only',
    disabledReason: 'SQL Server maintenance execution is guarded and adapter-specific.',
    previewOnly: true,
  }
}
