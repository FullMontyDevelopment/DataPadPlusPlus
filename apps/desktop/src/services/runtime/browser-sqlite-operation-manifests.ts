import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

export function buildSqliteOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'sqlite' || !capabilities.has('supports_admin_operations')) {
    return []
  }

  return [
    sqliteOperation(connection, 'sqlite.database.integrity-check', 'Integrity Check', 'database', 'diagnostic', false, ['table', 'profile', 'raw'], 'Preview SQLite quick and full integrity checks.'),
    sqliteOperation(connection, 'sqlite.database.analyze', 'Analyze Database', 'database', 'costly', true, ['profile', 'metrics', 'raw'], 'Preview refreshing SQLite planner statistics for the database.'),
    sqliteOperation(connection, 'sqlite.database.optimize', 'Optimize Database', 'database', 'costly', true, ['profile', 'metrics', 'raw'], 'Preview running PRAGMA optimize for SQLite statistics maintenance.'),
    sqliteOperation(connection, 'sqlite.database.vacuum', 'Vacuum Database', 'database', 'write', true, ['diff', 'profile', 'raw'], 'Preview compacting or rewriting the SQLite database file.'),
    sqliteOperation(connection, 'sqlite.database.backup', 'Backup Database', 'database', 'costly', true, ['diff', 'metrics', 'raw'], 'Plan a guarded SQLite VACUUM INTO file backup workflow.'),
    sqliteOperation(connection, 'sqlite.table.analyze', 'Analyze Table', 'table', 'costly', true, ['profile', 'metrics', 'raw'], 'Preview refreshing SQLite planner statistics for a table or view.'),
    sqliteOperation(connection, 'sqlite.table.export', 'Export Table', 'table', 'costly', true, ['table', 'json', 'raw'], 'Plan a guarded SQLite table export file workflow.'),
    sqliteOperation(connection, 'sqlite.table.import', 'Import Rows', 'table', 'write', true, ['diff', 'table', 'raw'], 'Plan a guarded SQLite table import file workflow.'),
    sqliteOperation(connection, 'sqlite.index.reindex', 'Reindex', 'index', 'write', true, ['diff', 'profile', 'raw'], 'Preview rebuilding a SQLite index.'),
  ]
}

function sqliteOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: OperationManifestResponse['operations'][number]['scope'],
  risk: OperationManifestResponse['operations'][number]['risk'],
  requiresConfirmation: boolean,
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
    requiresConfirmation,
    executionSupport: risk === 'diagnostic' ? 'live' : 'plan-only',
    disabledReason: risk === 'diagnostic'
      ? undefined
      : 'SQLite maintenance execution is guarded and adapter-specific.',
    previewOnly: risk !== 'diagnostic',
  }
}
