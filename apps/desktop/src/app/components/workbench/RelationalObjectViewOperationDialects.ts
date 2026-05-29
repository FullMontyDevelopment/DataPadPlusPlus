import type { ConnectionProfile } from '@datapadplusplus/shared-types'
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

  if (['cluster', 'diagnostics', 'jobs'].includes(kind)) {
    actions.push(dialectAction(connection, 'cockroach.jobs', 'Jobs', 'Review schema-change, backup, import, restore, and changefeed jobs', 'job', objectName, baseParameters))
  }

  if (['cluster', 'ranges', 'table', 'index', 'indexes'].includes(kind)) {
    actions.push(dialectAction(connection, 'cockroach.ranges', 'Ranges', 'Review range distribution and leaseholder placement', 'job', objectName, baseParameters))
  }

  if (['cluster', 'regions', 'localities', 'zone-configurations', 'database', 'schema', 'table'].includes(kind)) {
    actions.push(dialectAction(connection, 'cockroach.regions', 'Regions', 'Review regions, localities, and placement constraints', 'job', objectName, baseParameters))
  }

  if (['diagnostics', 'sessions'].includes(kind)) {
    actions.push(dialectAction(connection, 'cockroach.sessions', 'Sessions', 'Review active SQL sessions and transaction state', 'job', objectName, baseParameters))
  }

  if (['diagnostics', 'contention', 'locks', 'statements', 'transactions'].includes(kind)) {
    actions.push(dialectAction(connection, 'cockroach.contention', 'Contention', 'Review transaction contention and lock pressure', 'job', objectName, baseParameters))
  }

  if (['security', 'roles', 'permissions', 'grants'].includes(kind)) {
    actions.push(dialectAction(connection, 'cockroach.roles-grants', 'Grants', 'Review roles, memberships, grants, and default privileges', 'security', objectName, baseParameters))
  }

  if (['database', 'cluster'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'cockroach.backup', 'Backup', 'Preview a guarded CockroachDB backup workflow', 'security', objectName, baseParameters),
      dialectAction(connection, 'cockroach.restore', 'Restore', 'Preview a guarded CockroachDB restore workflow', 'security', objectName, baseParameters),
    )
  }

  if (['database', 'table'].includes(kind)) {
    actions.push(dialectAction(connection, 'cockroach.import', 'Import', 'Preview a guarded CockroachDB import workflow', 'table', objectName, baseParameters))
  }

  if (['zone-configurations', 'regions', 'localities'].includes(kind)) {
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

  if (kind === 'event') {
    actions.push(
      dialectAction(connection, 'event.enable', 'Enable', 'Preview enabling this event', 'job', objectName, baseParameters),
      dialectAction(connection, 'event.disable', 'Disable', 'Preview disabling this event', 'job', objectName, baseParameters),
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

  if (['database', 'diagnostics', 'statistics'].includes(kind)) {
    actions.push(
      dialectAction(connection, 'database.analyze', 'Analyze', 'Refresh database-level planner statistics', 'job', objectName, baseParameters),
      dialectAction(connection, 'database.vacuum', 'Vacuum', 'Preview database-level vacuum/analyze maintenance', 'job', objectName, baseParameters),
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
    actions.push(dialectAction(connection, 'table.analyze', 'Analyze', 'Refresh SQLite planner statistics for this object', 'job', objectName, baseParameters))
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

function safeIdentifier(value: string) {
  return value
    .replace(/[`"[\]]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase() || 'object'
}
