import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

export function buildDuckDbOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'duckdb') return []

  const operations: OperationManifestResponse['operations'] = []

  if (capabilities.has('supports_admin_operations')) {
    operations.push(
      duckDbOperation(
        connection,
        'duckdb.table.analyze',
        'Analyze Table',
        'table',
        'costly',
        ['profile', 'metrics', 'raw'],
        'Preview DuckDB table statistics refresh with target, write/open, and workload-impact gates.',
        'DuckDB table ANALYZE remains plan-only until admin execution has target, lock, and rollback boundaries.',
      ),
      duckDbOperation(
        connection,
        'duckdb.database.analyze',
        'Analyze Database',
        'database',
        'costly',
        ['profile', 'metrics', 'raw'],
        'Preview DuckDB database statistics refresh with file, lock, and workload-impact gates.',
        'DuckDB database ANALYZE remains plan-only until admin execution has file, lock, and rollback boundaries.',
      ),
      duckDbOperation(
        connection,
        'duckdb.database.checkpoint',
        'Checkpoint',
        'database',
        'write',
        ['diff', 'raw'],
        'Preview DuckDB checkpointing with file write/open, lock, and rollback-boundary gates.',
        'DuckDB checkpoint execution remains plan-only until cross-process lock and rollback boundaries are live.',
      ),
      duckDbOperation(
        connection,
        'duckdb.extension.install',
        'Install Extension',
        'extension',
        'write',
        ['diff', 'raw'],
        'Preview DuckDB extension installation with catalog, source, network, and extension-directory gates.',
        'DuckDB extension installation remains plan-only until controlled offline repository/source and native-code execution gates are live.',
      ),
      duckDbOperation(
        connection,
        'duckdb.extension.load',
        'Load Extension',
        'extension',
        'write',
        ['diff', 'raw'],
        'Preview DuckDB extension loading with installed-state, catalog, and native-code execution gates.',
        'DuckDB extension loading remains plan-only until installed-state and native-code execution gates are live.',
      ),
    )
  }

  if (capabilities.has('supports_import_export')) {
    operations.push({
      id: 'duckdb.file.import',
      engine: connection.engine,
      family: connection.family,
      label: 'Import File',
      scope: 'table',
      risk: 'write',
      requiredCapabilities: ['supports_import_export'],
      supportedRenderers: ['diff', 'table', 'raw'],
      description: 'Preview creating a DuckDB table from a selected CSV, JSON, or Parquet file.',
      requiresConfirmation: true,
      executionSupport: 'plan-only',
      disabledReason: 'DuckDB import execution is guarded and adapter-specific.',
      previewOnly: true,
    })
  }

  return operations
}

function duckDbOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: OperationManifestResponse['operations'][number]['scope'],
  risk: OperationManifestResponse['operations'][number]['risk'],
  supportedRenderers: OperationManifestResponse['operations'][number]['supportedRenderers'],
  description: string,
  disabledReason?: string,
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
    requiresConfirmation: true,
    executionSupport: 'plan-only',
    disabledReason: disabledReason ?? `${label} is guarded and adapter-specific.`,
    previewOnly: true,
  }
}
