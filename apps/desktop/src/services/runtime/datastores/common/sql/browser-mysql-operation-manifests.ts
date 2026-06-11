import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

export function buildMysqlOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if ((connection.engine !== 'mysql' && connection.engine !== 'mariadb') || !capabilities.has('supports_admin_operations')) {
    return []
  }

  return [
    mysqlOperation(connection, `${connection.engine}.table.check`, 'Check Table', 'table', 'diagnostic', ['table', 'json', 'raw'], 'Plan a MySQL-compatible CHECK TABLE workflow with engine, lock, and privilege guardrails.', 'CHECK TABLE needs live engine and privilege validation before direct execution.'),
    mysqlOperation(connection, `${connection.engine}.table.analyze`, 'Analyze Table', 'table', 'costly', ['profile', 'metrics', 'json', 'raw'], 'Plan an optimizer statistics refresh with privilege, lock, and replication guardrails.', 'ANALYZE TABLE remains preview-first until live table privilege and lock-impact checks are adapter-backed.'),
    mysqlOperation(connection, `${connection.engine}.table.optimize`, 'Optimize Table', 'table', 'costly', ['profile', 'diff', 'json', 'raw'], 'Plan a guarded table optimization workflow with storage-engine checks.', 'OPTIMIZE TABLE remains preview-first until live engine, size, and lock-impact checks are adapter-backed.'),
    mysqlOperation(connection, `${connection.engine}.table.repair`, 'Repair Table', 'table', 'destructive', ['diff', 'json', 'raw'], 'Plan a guarded MySQL-compatible table repair workflow with backup and engine checks.', 'REPAIR TABLE remains preview-first until live backup, engine, and rollback boundaries are adapter-backed.'),
    mysqlOperation(connection, `${connection.engine}.routine.execute`, 'Run Routine', 'query', 'write', ['table', 'json', 'raw'], 'Plan a parameter-aware MySQL routine call with EXECUTE privilege and SQL SECURITY guardrails.', 'Routine execution remains preview-first until parameter binding, OUT/INOUT capture, and EXECUTE privilege checks are live-validated.'),
    mysqlOperation(connection, `${connection.engine}.event.enable`, 'Enable Event', 'database', 'write', ['diff', 'json', 'raw'], 'Plan enabling a scheduled event with scheduler, definer, and EVENT privilege guardrails.', 'Event state changes remain preview-first until EVENT privilege, event scheduler, and definer metadata are live-validated.'),
    mysqlOperation(connection, `${connection.engine}.event.disable`, 'Disable Event', 'database', 'write', ['diff', 'json', 'raw'], 'Plan disabling a scheduled event with scheduler, definer, and EVENT privilege guardrails.', 'Event state changes remain preview-first until EVENT privilege, event scheduler, and definer metadata are live-validated.'),
    mysqlOperation(connection, `${connection.engine}.user.lock`, 'Lock User', 'user', 'write', ['diff', 'json', 'raw'], 'Plan locking a MySQL user@host account with account-management guardrails.', 'Account lock execution remains preview-first until CREATE USER/SYSTEM_USER-compatible privileges and active-session impact are live-validated.'),
    mysqlOperation(connection, `${connection.engine}.user.unlock`, 'Unlock User', 'user', 'write', ['diff', 'json', 'raw'], 'Plan unlocking a MySQL user@host account with account-management guardrails.', 'Account unlock execution remains preview-first until CREATE USER/SYSTEM_USER-compatible privileges and active-session impact are live-validated.'),
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
  disabledReason: string,
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
    disabledReason,
    previewOnly: true,
  }
}
