import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

type Operation = OperationManifestResponse['operations'][number]

export function buildPostgresOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'postgresql') {
    return []
  }

  const operations: OperationManifestResponse['operations'] = []

  if (capabilities.has('supports_result_snapshots')) {
    operations.push(postgresOperation(
      connection,
      'postgresql.routine.execute',
      'Run Routine',
      'query',
      'write',
      'Prepare a parameterized PostgreSQL function/procedure call with signature-aware bindings and confirmation guardrails.',
      {
        disabledReason:
          'PostgreSQL routine execution is parameterized and guarded until adapter-specific live execution confirms permissions.',
        requiredCapabilities: ['supports_result_snapshots'],
        supportedRenderers: ['table', 'json', 'raw'],
      },
    ))
  }

  if (capabilities.has('supports_query_cancellation')) {
    operations.push(
      postgresOperation(
        connection,
        'postgresql.session.cancel',
        'Cancel Query',
        'query',
        'write',
        'Prepare a guarded pg_cancel_backend request for a selected PostgreSQL backend PID.',
        {
          disabledReason:
            'PostgreSQL backend cancellation stays preview-first until live permission and current-backend guards execute in the adapter.',
          requiredCapabilities: ['supports_query_cancellation'],
          supportedRenderers: ['metrics', 'raw'],
        },
      ),
      postgresOperation(
        connection,
        'postgresql.session.terminate',
        'Terminate Backend',
        'query',
        'destructive',
        'Prepare a guarded pg_terminate_backend request for a selected PostgreSQL backend PID.',
        {
          disabledReason:
            'PostgreSQL backend termination stays preview-first until live permission, transaction-impact, and current-backend guards execute in the adapter.',
          requiredCapabilities: ['supports_query_cancellation'],
          supportedRenderers: ['diff', 'metrics', 'raw'],
        },
      ),
    )
  }

  if (capabilities.has('supports_admin_operations')) {
    operations.push(
      postgresOperation(connection, 'postgresql.table.analyze', 'Analyze Table', 'table', 'costly', 'Preview refreshing PostgreSQL planner statistics for a table or materialized view.'),
      postgresOperation(connection, 'postgresql.table.vacuum', 'Vacuum Table', 'table', 'costly', 'Preview PostgreSQL VACUUM maintenance for a table.'),
      postgresOperation(connection, 'postgresql.database.analyze', 'Analyze Database', 'database', 'costly', 'Preview database-wide PostgreSQL ANALYZE.'),
      postgresOperation(connection, 'postgresql.database.vacuum', 'Vacuum Database', 'database', 'costly', 'Preview database-wide PostgreSQL VACUUM maintenance.'),
      postgresOperation(connection, 'postgresql.index.reindex', 'Reindex', 'index', 'costly', 'Preview a guarded PostgreSQL REINDEX request.'),
      postgresOperation(connection, 'postgresql.role.grant', 'Grant Role', 'role', 'write', 'Preview granting one PostgreSQL role to another role.'),
      postgresOperation(connection, 'postgresql.role.revoke', 'Revoke Role', 'role', 'write', 'Preview revoking a PostgreSQL role membership.'),
      postgresOperation(connection, 'postgresql.extension.update', 'Update Extension', 'extension', 'write', 'Preview ALTER EXTENSION UPDATE after version and dependency review.'),
      postgresOperation(connection, 'postgresql.extension.drop', 'Drop Extension', 'extension', 'destructive', 'Preview dropping an installed PostgreSQL extension and dependent objects.'),
    )
  }

  return operations
}

function postgresOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: Operation['scope'],
  risk: Operation['risk'],
  description: string,
  options: {
    disabledReason?: string
    requiredCapabilities?: Operation['requiredCapabilities']
    supportedRenderers?: Operation['supportedRenderers']
  } = {},
): Operation {
  return {
    id,
    engine: connection.engine,
    family: connection.family,
    label,
    scope,
    risk,
    requiredCapabilities: options.requiredCapabilities ?? ['supports_admin_operations'],
    supportedRenderers:
      options.supportedRenderers ??
      (risk === 'write' || risk === 'destructive' ? ['diff', 'raw'] : ['profile', 'metrics', 'raw']),
    description,
    requiresConfirmation: risk !== 'diagnostic',
    executionSupport: 'plan-only',
    disabledReason: options.disabledReason ?? 'PostgreSQL admin execution is guarded and adapter-specific.',
    previewOnly: true,
  }
}
