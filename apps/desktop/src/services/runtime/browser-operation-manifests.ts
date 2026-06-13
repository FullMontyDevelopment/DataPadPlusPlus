import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'
import { buildGenericOptionalOperationManifests } from './browser-operation-manifest-generic'
import { buildAdapterSpecificOperationManifests } from './browser-operation-manifest-specialized'

export function buildOperationManifestsForConnection(
  connection: ConnectionProfile,
): OperationManifestResponse['operations'] {
  const backlog = datastoreBacklogByEngine(connection.engine)
  const capabilities = new Set(backlog?.capabilities ?? [])
  const base = [
    {
      id: `${connection.engine}.metadata.refresh`,
      engine: connection.engine,
      family: connection.family,
      label: 'Refresh Metadata',
      scope: 'connection',
      risk: 'read',
      requiredCapabilities: ['supports_schema_browser'],
      supportedRenderers: ['schema', 'table', 'json'],
      description: 'Load engine-native metadata for the explorer.',
      requiresConfirmation: false,
      executionSupport: backlog?.maturity === 'beta' ? 'plan-only' : 'live',
      disabledReason:
        backlog?.maturity === 'beta'
          ? 'Beta adapters expose generated plans before live execution.'
          : undefined,
      previewOnly: backlog?.maturity === 'beta',
    },
    {
      id: `${connection.engine}.query.execute`,
      engine: connection.engine,
      family: connection.family,
      label: 'Execute Query',
      scope: 'query',
      risk: 'read',
      requiredCapabilities: ['supports_result_snapshots'],
      supportedRenderers: backlog?.resultRenderers ?? ['raw'],
      description: 'Run a native query and normalize results.',
      requiresConfirmation: false,
      executionSupport: backlog?.maturity === 'beta' ? 'plan-only' : 'live',
      disabledReason:
        backlog?.maturity === 'beta'
          ? 'Beta adapters expose generated plans before live execution.'
          : undefined,
      previewOnly: backlog?.maturity === 'beta',
    },
  ] satisfies OperationManifestResponse['operations']

  const optional: OperationManifestResponse['operations'] = []

  if (capabilities.has('supports_explain_plan')) {
    optional.push({
      id: `${connection.engine}.query.explain`,
      engine: connection.engine,
      family: connection.family,
      label: 'View Execution Plan',
      scope: 'query',
      risk: 'diagnostic',
      requiredCapabilities: ['supports_explain_plan'],
      supportedRenderers: ['plan', 'table', 'json', 'raw'],
      description: 'Generate an execution plan preview.',
      requiresConfirmation: false,
      executionSupport: backlog?.maturity === 'beta' ? 'plan-only' : 'live',
      disabledReason:
        backlog?.maturity === 'beta'
          ? 'Beta adapters expose generated plans before live execution.'
          : undefined,
      previewOnly: backlog?.maturity === 'beta',
    })
  }

  if (capabilities.has('supports_query_profile')) {
    optional.push({
      id: `${connection.engine}.query.profile`,
      engine: connection.engine,
      family: connection.family,
      label: 'Profile Query',
      scope: 'query',
      risk: 'costly',
      requiredCapabilities: ['supports_query_profile'],
      supportedRenderers: ['profile', 'plan', 'metrics'],
      description: 'Profile a query with execution warnings.',
      requiresConfirmation: true,
      executionSupport: 'plan-only',
      disabledReason:
        'Profiling can execute workload and needs an adapter-specific live executor.',
      previewOnly: backlog?.maturity === 'beta',
    })
  }

  if (capabilities.has('supports_admin_operations')) {
    optional.push({
      id: `${connection.engine}.object.drop`,
      engine: connection.engine,
      family: connection.family,
      label: 'Drop Object',
      scope: 'schema',
      risk: 'destructive',
      requiredCapabilities: ['supports_admin_operations'],
      supportedRenderers: ['diff', 'raw'],
      description: 'Preview a destructive object operation.',
      requiresConfirmation: true,
      executionSupport: 'plan-only',
      disabledReason:
        'Destructive operation execution needs an adapter-specific live executor.',
      previewOnly: true,
    })
  }

  optional.push(...buildGenericOptionalOperationManifests(connection, capabilities, backlog?.maturity))

  if (capabilities.has('supports_index_management')) {
    optional.push(
      {
        id: `${connection.engine}.index.create`,
        engine: connection.engine,
        family: connection.family,
        label: 'Create Index',
        scope: 'index',
        risk: 'write',
        requiredCapabilities: ['supports_index_management'],
        supportedRenderers: ['schema', 'diff', 'raw'],
        description: 'Preview an engine-native index or secondary access path creation.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'Index management execution is guarded and adapter-specific.',
        previewOnly: true,
      },
      {
        id: `${connection.engine}.index.drop`,
        engine: connection.engine,
        family: connection.family,
        label: 'Drop Index',
        scope: 'index',
        risk: 'destructive',
        requiredCapabilities: ['supports_index_management'],
        supportedRenderers: ['diff', 'raw'],
        description: 'Preview a destructive index drop operation.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'Index management execution is guarded and adapter-specific.',
        previewOnly: true,
      },
      {
        id: `${connection.engine}.index.hide`,
        engine: connection.engine,
        family: connection.family,
        label: 'Hide Index',
        scope: 'index',
        risk: 'write',
        requiredCapabilities: ['supports_index_management'],
        supportedRenderers: ['diff', 'raw'],
        description: 'Preview hiding an index from the query planner without dropping it.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'Index visibility execution is guarded and adapter-specific.',
        previewOnly: true,
      },
      {
        id: `${connection.engine}.index.unhide`,
        engine: connection.engine,
        family: connection.family,
        label: 'Unhide Index',
        scope: 'index',
        risk: 'write',
        requiredCapabilities: ['supports_index_management'],
        supportedRenderers: ['diff', 'raw'],
        description: 'Preview making a hidden index visible to the query planner.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'Index visibility execution is guarded and adapter-specific.',
        previewOnly: true,
      },
    )
  }

  optional.push(...buildAdapterSpecificOperationManifests(connection, capabilities))

  if (capabilities.has('supports_metrics_collection')) {
    optional.push({
      id: `${connection.engine}.diagnostics.metrics`,
      engine: connection.engine,
      family: connection.family,
      label: 'Collect Metrics',
      scope: 'cluster',
      risk: 'diagnostic',
      requiredCapabilities: ['supports_metrics_collection'],
      supportedRenderers: ['metrics', 'series', 'chart', 'json'],
      description: 'Collect normalized metrics for dashboards.',
      requiresConfirmation: false,
      executionSupport: backlog?.maturity === 'beta' ? 'plan-only' : 'live',
      disabledReason:
        backlog?.maturity === 'beta'
          ? 'Beta adapters expose generated plans before live execution.'
          : undefined,
      previewOnly: backlog?.maturity === 'beta',
    })
  }

  return promoteScopedLiveWorkflows(connection, [...base, ...optional])
}

function promoteScopedLiveWorkflows(
  connection: ConnectionProfile,
  operations: OperationManifestResponse['operations'],
) {
  return operations.map((operation) => {
    if (connection.engine === 'postgresql' && operation.id === 'postgresql.query.profile') {
      return {
        ...operation,
        description:
          'Run guarded PostgreSQL EXPLAIN ANALYZE JSON profiles and render normalized operator stages.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'postgresql' && operation.id === 'postgresql.data.import-export') {
      return {
        ...operation,
        description:
          'Run guarded PostgreSQL table import/export file workflows in the desktop adapter.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'postgresql' && operation.id === 'postgresql.data.backup-restore') {
      return {
        ...operation,
        description:
          'Create guarded bounded PostgreSQL logical backup packages; restore remains preview-first.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'sqlserver' && operation.id === 'sqlserver.data.import-export') {
      return {
        ...operation,
        description:
          'Run guarded SQL Server table import/export file workflows with concrete paths, row limits, and target-column validation.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'sqlserver' && operation.id === 'sqlserver.data.backup-restore') {
      return {
        ...operation,
        description:
          'Create guarded bounded SQL Server logical backup packages and validate restore packages; native .bak restore remains preview-first.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'mysql' && operation.id === 'mysql.data.import-export') {
      return {
        ...operation,
        description:
          'Run guarded MySQL table import/export file workflows with concrete paths, row limits, and target-column validation.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'mysql' && operation.id === 'mysql.data.backup-restore') {
      return {
        ...operation,
        description:
          'Create guarded bounded MySQL logical backup packages and validate restore packages; full mysqldump/mysql restore remains preview-first.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'mariadb' && operation.id === 'mariadb.data.import-export') {
      return {
        ...operation,
        description:
          'Run guarded MariaDB table import/export file workflows with concrete paths, row limits, and target-column validation.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'mariadb' && operation.id === 'mariadb.data.backup-restore') {
      return {
        ...operation,
        description:
          'Create guarded bounded MariaDB logical backup packages and validate restore packages; full mariadb-dump/mysql restore remains preview-first.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'duckdb' && operation.id === 'duckdb.data.import-export') {
      return {
        ...operation,
        description:
          'Run guarded DuckDB CSV, JSON, or Parquet table import/export file workflows.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'duckdb' && operation.id === 'duckdb.data.backup-restore') {
      return {
        ...operation,
        description:
          'Create guarded DuckDB EXPORT DATABASE backup folders; restore remains preview-first.',
        risk: 'costly' as const,
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'litedb' && operation.id === 'litedb.data.import-export') {
      return {
        ...operation,
        description:
          'Run guarded LiteDB JSON/NDJSON collection export or insert-only import through the configured sidecar file workflow.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (
      connection.engine === 'litedb' &&
      ['litedb.index.create', 'litedb.index.drop', 'litedb.object.drop'].includes(operation.id)
    ) {
      return {
        ...operation,
        description:
          'Run guarded LiteDB index or collection management through the configured sidecar with before/after evidence.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (
      connection.engine === 'litedb' &&
      [
        'litedb.file-storage.import',
        'litedb.file-storage.export',
        'litedb.file-storage.delete',
      ].includes(operation.id)
    ) {
      return {
        ...operation,
        description:
          'Run guarded LiteDB file-storage import, export, or delete through the configured sidecar with before/after evidence.',
        executionSupport: 'live' as const,
        disabledReason: undefined,
        previewOnly: false,
      }
    }
    if (connection.engine === 'timescaledb' && operation.id === 'timescaledb.data.import-export') {
      return {
        ...operation,
        description:
          'Preview TimescaleDB hypertable import/export workflows with bounded time windows, chunk checks, compression checks, and policy refresh guidance.',
        disabledReason:
          'TimescaleDB import/export execution remains preview-first until adapter-owned file workflows validate columns, chunks, policies, and continuous aggregate impact.',
        previewOnly: true,
      }
    }
    if (connection.engine === 'timescaledb' && operation.id === 'timescaledb.data.backup-restore') {
      return {
        ...operation,
        description:
          'Preview TimescaleDB backup/restore workflows with extension-version, hypertable, chunk, policy, job, and continuous-aggregate preflights.',
        disabledReason:
          'TimescaleDB backup/restore execution remains preview-first until extension compatibility, policy replay, and restore boundaries are adapter-backed.',
        previewOnly: true,
      }
    }
    return operation
  })
}
