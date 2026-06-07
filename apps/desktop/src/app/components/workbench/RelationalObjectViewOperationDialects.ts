import type { ConnectionProfile } from '@datapadplusplus/shared-types'
import { cockroachCapability } from '../../../services/runtime/cockroach-capabilities'
import type { RelationalSectionIcon } from './RelationalObjectViewSections'
import type { RelationalOperationAction } from './RelationalObjectViewOperations.helpers'

export function duckDbOperationActions(
  connection: ConnectionProfile,
  kind: string,
  objectName: string,
  baseParameters: Record<string, unknown>,
): RelationalOperationAction[] {
  const actions: RelationalOperationAction[] = []

  if (['table', 'view'].includes(kind)) {
    actions.push(dialectAction(connection, 'table.analyze', 'Analyze', 'Refresh DuckDB planner statistics for this object', 'job', objectName, baseParameters))
  }

  if (['database', 'statistics', 'diagnostics', 'pragmas', 'maintenance'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'database.analyze', 'Analyze', 'Refresh DuckDB planner statistics', 'job', objectName, baseParameters),
      dialectAction(connection, 'database.checkpoint', 'Checkpoint', 'Prepare a local checkpoint workflow', 'security', objectName, baseParameters),
    )
  }

  if (['extensions', 'extension'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'extension.install', 'Install', 'Prepare a guarded DuckDB extension install', 'index', objectName, {
        ...baseParameters,
        extensionName: extensionNameFromObject(objectName),
      }),
      dialectAction(connection, 'extension.load', 'Load', 'Prepare a guarded DuckDB extension load', 'index', objectName, {
        ...baseParameters,
        extensionName: extensionNameFromObject(objectName),
      }),
    )
  }

  if (kind === 'files') {
    actions.push(dialectAction(connection, 'file.import', 'Import File', 'Prepare a CSV/Parquet import workflow', 'table', objectName, {
      ...baseParameters,
      sourceFormat: 'parquet',
      tableName: 'imported_data',
    }))
  }

  return actions
}

export function timescaleOperationActions(
  connection: ConnectionProfile,
  kind: string,
  objectName: string,
  baseParameters: Record<string, unknown>,
): RelationalOperationAction[] {
  const actions: RelationalOperationAction[] = []

  if (['table', 'hypertable'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'timescale.compression-policy', 'Compression', 'Preview a guarded compression policy', 'job', objectName, {
        ...baseParameters,
        compressAfter: '7 days',
      }),
      dialectAction(connection, 'timescale.retention-policy', 'Retention', 'Preview a guarded retention policy', 'job', objectName, {
        ...baseParameters,
        dropAfter: '90 days',
      }),
    )
  }

  if (['continuous-aggregate', 'continuous-aggregates'].includes(kind)) {
    actions.push(dialectAction(connection, 'timescale.refresh-continuous-aggregate', 'Refresh', 'Preview a continuous aggregate refresh', 'job', objectName, {
      ...baseParameters,
      startOffset: '7 days',
      endOffset: '0 minutes',
    }))
  }

  return actions
}

export function cockroachOperationActions(
  connection: ConnectionProfile,
  kind: string,
  objectName: string,
  baseParameters: Record<string, unknown>,
): RelationalOperationAction[] {
  const actions: RelationalOperationAction[] = []

  if (['cluster', 'diagnostics', 'jobs'].includes(kind) && cockroachCapability(connection, 'inspectJobs')) {
    actions.push(dialectAction(connection, 'cockroach.jobs', 'Jobs', 'Review schema-change, backup, import, restore, and changefeed jobs', 'job', objectName, baseParameters))
  }

  if (['cluster', 'ranges', 'table', 'index', 'indexes'].includes(kind) && cockroachCapability(connection, 'inspectRanges')) {
    actions.push(dialectAction(connection, 'cockroach.ranges', 'Ranges', 'Review range distribution and leaseholder placement', 'job', objectName, baseParameters))
  }

  if (['cluster', 'regions', 'localities', 'zone-configurations', 'database', 'schema', 'table'].includes(kind) && cockroachCapability(connection, 'inspectRegions')) {
    actions.push(dialectAction(connection, 'cockroach.regions', 'Regions', 'Review regions, localities, and placement constraints', 'job', objectName, baseParameters))
  }

  if (['diagnostics', 'sessions'].includes(kind) && cockroachCapability(connection, 'inspectSessions')) {
    actions.push(dialectAction(connection, 'cockroach.sessions', 'Sessions', 'Review active SQL sessions and transaction state', 'job', objectName, baseParameters))
  }

  if (['diagnostics', 'contention', 'locks', 'statements', 'transactions'].includes(kind) && cockroachCapability(connection, 'inspectContention')) {
    actions.push(dialectAction(connection, 'cockroach.contention', 'Contention', 'Review transaction contention and lock pressure', 'job', objectName, baseParameters))
  }

  if (['security', 'roles', 'permissions', 'grants'].includes(kind) && cockroachCapability(connection, 'inspectRolesAndGrants')) {
    actions.push(dialectAction(connection, 'cockroach.roles-grants', 'Grants', 'Review roles, memberships, grants, and default privileges', 'security', objectName, baseParameters))
  }

  if (['database', 'cluster'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'cockroach.backup', 'Backup', 'Preview a guarded CockroachDB backup workflow', 'security', objectName, baseParameters),
      dialectAction(connection, 'cockroach.restore', 'Restore', 'Preview a guarded CockroachDB restore workflow', 'security', objectName, baseParameters),
    )
  }

  if (['database', 'table'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'cockroach.import', 'Import', 'Preview a guarded CockroachDB import workflow', 'table', objectName, baseParameters),
      dialectAction(connection, 'cockroach.export', 'Export', 'Preview a guarded CockroachDB export workflow', 'table', objectName, baseParameters),
    )
  }

  if (['zone-configurations', 'regions', 'localities'].includes(kind) && cockroachCapability(connection, 'inspectZoneConfigurations')) {
    actions.push(dialectAction(connection, 'cockroach.zone-configs', 'Zones', 'Review zone configuration and placement rules', 'index', objectName, baseParameters))
  }

  return actions
}

export function mysqlOperationActions(
  connection: ConnectionProfile,
  kind: string,
  objectName: string,
  baseParameters: Record<string, unknown>,
): RelationalOperationAction[] {
  const actions: RelationalOperationAction[] = []

  if (['table', 'storage', 'statistics'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'table.check', 'Check', 'Preview table integrity checks', 'job', objectName, baseParameters),
      dialectAction(connection, 'table.analyze', 'Analyze', 'Preview optimizer statistics refresh', 'job', objectName, baseParameters),
      dialectAction(connection, 'table.optimize', 'Optimize', 'Preview storage optimization', 'job', objectName, baseParameters),
    )
  }

  if (kind === 'table') {
    actions.push(dialectAction(connection, 'table.repair', 'Repair', 'Preview guarded table repair', 'security', objectName, baseParameters))
  }

  if (['function', 'procedure', 'routine'].includes(kind)) {
    actions.push(dialectAction(connection, 'routine.execute', 'Run', 'Prepare a guarded MySQL routine call', 'job', objectName, {
      ...baseParameters,
      routineKind: stringParameter(baseParameters.routineKind) || (kind === 'function' ? 'function' : 'procedure'),
      routineName: stringParameter(baseParameters.routineName) || stringParameter(baseParameters.objectName) || objectName,
    }))
  }

  if (kind === 'event') {
    actions.push(
      dialectAction(connection, 'event.enable', 'Enable', 'Preview enabling this event with scheduler guardrails', 'job', objectName, {
        ...baseParameters,
        eventName: stringParameter(baseParameters.eventName) || stringParameter(baseParameters.objectName) || objectName,
      }),
      dialectAction(connection, 'event.disable', 'Disable', 'Preview disabling this event with scheduler guardrails', 'job', objectName, {
        ...baseParameters,
        eventName: stringParameter(baseParameters.eventName) || stringParameter(baseParameters.objectName) || objectName,
      }),
    )
  }

  if (['security', 'users', 'user'].includes(kind) && stringParameter(baseParameters.userName)) {
    actions.push(
      dialectAction(connection, 'user.lock', 'Lock User', 'Preview locking this user@host account', 'security', objectName, baseParameters),
      dialectAction(connection, 'user.unlock', 'Unlock User', 'Preview unlocking this user@host account', 'security', objectName, baseParameters),
    )
  }

  return actions
}

export function postgresOperationActions(
  connection: ConnectionProfile,
  kind: string,
  objectName: string,
  baseParameters: Record<string, unknown>,
): RelationalOperationAction[] {
  const actions: RelationalOperationAction[] = []

  if (['table', 'materialized-view', 'statistics'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'table.analyze', 'Analyze', 'Refresh PostgreSQL planner statistics', 'job', objectName, baseParameters),
      dialectAction(connection, 'table.vacuum', 'Vacuum', 'Preview PostgreSQL vacuum/analyze maintenance', 'job', objectName, baseParameters),
    )
  }

  if (['index', 'indexes', 'index-health'].includes(kind)) {
    actions.push(dialectAction(connection, 'index.reindex', 'Reindex', 'Preview a guarded PostgreSQL REINDEX', 'index', objectName, baseParameters))
  }

  if (['function', 'procedure', 'routine'].includes(kind)) {
    actions.push(dialectAction(connection, 'routine.execute', 'Run', 'Prepare a parameterized PostgreSQL routine call', 'job', objectName, {
      ...baseParameters,
      routineKind: stringParameter(baseParameters.routineKind) || (kind === 'procedure' ? 'procedure' : 'function'),
      routineName: stringParameter(baseParameters.routineName) || stringParameter(baseParameters.objectName) || objectName,
    }))
  }

  if (['diagnostics', 'sessions', 'locks', 'waits'].includes(kind) && stringParameter(baseParameters.sessionPid)) {
    actions.push(
      dialectAction(connection, 'session.cancel', 'Cancel', 'Prepare a guarded pg_cancel_backend request', 'job', objectName, baseParameters),
      dialectAction(connection, 'session.terminate', 'Terminate', 'Prepare a guarded pg_terminate_backend request', 'security', objectName, baseParameters),
    )
  }

  if (['database', 'diagnostics', 'statistics'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'database.analyze', 'Analyze', 'Refresh database-level planner statistics', 'job', objectName, baseParameters),
      dialectAction(connection, 'database.vacuum', 'Vacuum', 'Preview database-level vacuum/analyze maintenance', 'job', objectName, baseParameters),
    )
  }

  if (['security', 'roles', 'role-memberships', 'permissions', 'default-privileges'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'role.grant', 'Grant Role', 'Preview granting one PostgreSQL role to another role', 'security', objectName, {
        ...baseParameters,
        roleName: stringParameter(baseParameters.roleName) || '<role>',
        memberOf: stringParameter(baseParameters.memberOf) || '<member_role>',
      }),
      dialectAction(connection, 'role.revoke', 'Revoke Role', 'Preview revoking one PostgreSQL role membership', 'security', objectName, {
        ...baseParameters,
        roleName: stringParameter(baseParameters.roleName) || '<role>',
        memberOf: stringParameter(baseParameters.memberOf) || '<member_role>',
      }),
    )
  }

  if (['extensions', 'extension'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'extension.update', 'Update Ext', 'Preview ALTER EXTENSION UPDATE with version review', 'job', objectName, {
        ...baseParameters,
        extensionName: postgresExtensionName(baseParameters.extensionName ?? objectName),
      }),
    )
  }

  if (kind === 'extension') {
    actions.push(
      dialectAction(connection, 'extension.drop', 'Drop Ext', 'Preview dropping an installed PostgreSQL extension', 'security', objectName, {
        ...baseParameters,
        extensionName: postgresExtensionName(baseParameters.extensionName ?? objectName),
      }),
    )
  }

  return actions
}

export function sqlServerOperationActions(
  connection: ConnectionProfile,
  kind: string,
  objectName: string,
  baseParameters: Record<string, unknown>,
): RelationalOperationAction[] {
  const actions: RelationalOperationAction[] = []

  if (['table', 'view', 'statistics'].includes(kind)) {
    actions.push(dialectAction(connection, 'statistics.update', 'Update Stats', 'Refresh SQL Server optimizer statistics', 'job', objectName, baseParameters))
  }

  if (['index', 'indexes', 'missing-indexes'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'index.reorganize', 'Reorganize', 'Preview low-impact index defragmentation', 'job', objectName, baseParameters),
      dialectAction(connection, 'index.rebuild', 'Rebuild', 'Preview guarded index rebuild', 'index', objectName, baseParameters),
      dialectAction(connection, 'index.disable', 'Disable', 'Preview disabling this index', 'security', objectName, baseParameters),
      dialectAction(connection, 'index.enable', 'Enable', 'Preview rebuilding a disabled index', 'index', objectName, baseParameters),
    )
  }

  if (['query-store', 'query-store-view', 'diagnostics', 'performance'].includes(kind)) {
    actions.push(dialectAction(connection, 'query-store.top-queries', 'Top Queries', 'Review Query Store top workload', 'job', objectName, baseParameters))
  }

  return actions
}

export function sqliteOperationActions(
  connection: ConnectionProfile,
  kind: string,
  objectName: string,
  baseParameters: Record<string, unknown>,
): RelationalOperationAction[] {
  const actions: RelationalOperationAction[] = []

  if (['table', 'view'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'table.analyze', 'Analyze', 'Refresh SQLite planner statistics for this object', 'job', objectName, baseParameters),
      dialectAction(connection, 'table.export', 'Export', 'Plan a guarded SQLite table export file workflow', 'table', objectName, baseParameters),
      dialectAction(connection, 'table.import', 'Import', 'Plan a guarded SQLite table import file workflow', 'security', objectName, baseParameters),
    )
  }

  if (['index', 'indexes'].includes(kind)) {
    actions.push(dialectAction(connection, 'index.reindex', 'Reindex', 'Rebuild this SQLite index', 'index', objectName, baseParameters))
  }

  if (['database', 'maintenance', 'statistics', 'pragmas', 'pragma'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'database.integrity-check', 'Check', 'Run SQLite quick and full integrity checks', 'job', objectName, baseParameters),
      dialectAction(connection, 'database.analyze', 'Analyze', 'Refresh SQLite planner statistics', 'job', objectName, baseParameters),
      dialectAction(connection, 'database.optimize', 'Optimize', 'Run SQLite PRAGMA optimize', 'job', objectName, baseParameters),
      dialectAction(connection, 'database.vacuum', 'Vacuum', 'Prepare a guarded SQLite compaction workflow', 'security', objectName, baseParameters),
      dialectAction(connection, 'database.backup', 'Backup', 'Plan a guarded SQLite VACUUM INTO backup workflow', 'table', objectName, baseParameters),
    )
  }

  return actions
}

function dialectAction(
  connection: ConnectionProfile,
  suffix: string,
  label: string,
  title: string,
  icon: RelationalSectionIcon,
  objectName: string,
  parameters: Record<string, unknown>,
): RelationalOperationAction {
  return {
    label,
    title,
    icon,
    operationId: `${connection.engine}.${suffix}`,
    objectName,
    parameters,
  }
}

function extensionNameFromObject(objectName: string) {
  return safeIdentifier(objectName) || 'parquet'
}

function postgresExtensionName(value: unknown) {
  const parts = String(value ?? '')
    .split('.')
    .map((part) => part.trim().replace(/^["`[]|["`\]]$/g, ''))
    .filter(Boolean)
  const candidate = (parts.at(-1) ?? String(value ?? '')).trim()
  const cleaned = candidate.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || '<extension>'
}

function stringParameter(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function safeIdentifier(value: string) {
  return value
    .replace(/[`"[\]]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'object'
}
