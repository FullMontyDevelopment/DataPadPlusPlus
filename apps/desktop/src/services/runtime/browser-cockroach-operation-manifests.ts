import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

type Operation = OperationManifestResponse['operations'][number]

export function buildCockroachOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'cockroachdb') {
    return []
  }

  const operations: OperationManifestResponse['operations'] = []

  if (capabilities.has('supports_metrics_collection')) {
    operations.push(
      cockroachOperation(connection, 'cockroachdb.cockroach.jobs', 'Browse Jobs', 'cluster', 'diagnostic', ['supports_metrics_collection'], 'Review CockroachDB jobs for schema changes, backups, imports, restores, and changefeeds.'),
      cockroachOperation(connection, 'cockroachdb.cockroach.ranges', 'Review Ranges', 'cluster', 'diagnostic', ['supports_metrics_collection'], 'Review range distribution, leaseholders, replicas, and hot ranges where crdb_internal metadata is available.'),
      cockroachOperation(connection, 'cockroachdb.cockroach.regions', 'Review Regions', 'cluster', 'diagnostic', ['supports_metrics_collection'], 'Review regions, localities, survival goals, and placement constraints.'),
      cockroachOperation(connection, 'cockroachdb.cockroach.sessions', 'Review Sessions', 'cluster', 'diagnostic', ['supports_metrics_collection'], 'Review active SQL sessions and transaction state.'),
    )
  }

  if (capabilities.has('supports_metrics_collection') && capabilities.has('supports_query_profile')) {
    operations.push(
      cockroachOperation(connection, 'cockroachdb.cockroach.contention', 'Analyze Contention', 'cluster', 'diagnostic', ['supports_metrics_collection', 'supports_query_profile'], 'Inspect contention, locks, retries, and hot SQL/KV paths.'),
    )
  }

  if (capabilities.has('supports_user_role_browser') && capabilities.has('supports_permission_inspection')) {
    operations.push(
      cockroachOperation(connection, 'cockroachdb.cockroach.roles-grants', 'Inspect Roles And Grants', 'role', 'read', ['supports_user_role_browser', 'supports_permission_inspection'], 'Review roles, memberships, grants, and default privileges.'),
    )
  }

  if (capabilities.has('supports_backup_restore')) {
    operations.push(
      cockroachOperation(connection, 'cockroachdb.cockroach.backup', 'Backup Database', 'database', 'costly', ['supports_backup_restore'], 'Preview a guarded CockroachDB BACKUP workflow.'),
      cockroachOperation(connection, 'cockroachdb.cockroach.restore', 'Restore Database', 'database', 'destructive', ['supports_backup_restore'], 'Preview a guarded CockroachDB RESTORE workflow.'),
    )
  }

  if (capabilities.has('supports_import_export')) {
    operations.push(
      cockroachOperation(connection, 'cockroachdb.cockroach.import', 'Import Data', 'table', 'write', ['supports_import_export'], 'Preview a guarded CockroachDB IMPORT workflow.'),
    )
  }

  if (capabilities.has('supports_admin_operations')) {
    operations.push(
      cockroachOperation(connection, 'cockroachdb.cockroach.zone-configs', 'Review Zone Configs', 'cluster', 'write', ['supports_admin_operations'], 'Preview CockroachDB zone configuration and placement rule changes.'),
    )
  }

  return operations
}

function cockroachOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: Operation['scope'],
  risk: Operation['risk'],
  requiredCapabilities: Operation['requiredCapabilities'],
  description: string,
): Operation {
  const readOnly = risk === 'read' || risk === 'diagnostic'

  return {
    id,
    engine: connection.engine,
    family: connection.family,
    label,
    scope,
    risk,
    requiredCapabilities,
    supportedRenderers: readOnly ? ['table', 'metrics', 'json'] : ['diff', 'profile', 'raw'],
    description,
    requiresConfirmation: !readOnly,
    executionSupport: readOnly ? 'live' : 'plan-only',
    disabledReason: readOnly ? undefined : 'CockroachDB admin execution is guarded and adapter-specific.',
    previewOnly: !readOnly,
  }
}
