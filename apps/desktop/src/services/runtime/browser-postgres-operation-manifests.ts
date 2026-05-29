import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

type Operation = OperationManifestResponse['operations'][number]

export function buildPostgresOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'postgresql' || !capabilities.has('supports_admin_operations')) {
    return []
  }

  return [
    postgresOperation(connection, 'postgresql.table.analyze', 'Analyze Table', 'table', 'costly', 'Preview refreshing PostgreSQL planner statistics for a table or materialized view.'),
    postgresOperation(connection, 'postgresql.table.vacuum', 'Vacuum Table', 'table', 'costly', 'Preview PostgreSQL VACUUM maintenance for a table.'),
    postgresOperation(connection, 'postgresql.database.analyze', 'Analyze Database', 'database', 'costly', 'Preview database-wide PostgreSQL ANALYZE.'),
    postgresOperation(connection, 'postgresql.database.vacuum', 'Vacuum Database', 'database', 'costly', 'Preview database-wide PostgreSQL VACUUM maintenance.'),
    postgresOperation(connection, 'postgresql.index.reindex', 'Reindex', 'index', 'costly', 'Preview a guarded PostgreSQL REINDEX request.'),
  ]
}

function postgresOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: Operation['scope'],
  risk: Operation['risk'],
  description: string,
): Operation {
  return {
    id,
    engine: connection.engine,
    family: connection.family,
    label,
    scope,
    risk,
    requiredCapabilities: ['supports_admin_operations'],
    supportedRenderers: ['profile', 'metrics', 'raw'],
    description,
    requiresConfirmation: risk !== 'diagnostic',
    executionSupport: 'plan-only',
    disabledReason: 'PostgreSQL maintenance execution is guarded and adapter-specific.',
    previewOnly: true,
  }
}
