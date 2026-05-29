import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'
import { buildCockroachOperationManifests } from './browser-cockroach-operation-manifests'
import { buildMysqlOperationManifests } from './browser-mysql-operation-manifests'
import { buildPostgresOperationManifests } from './browser-postgres-operation-manifests'
import { buildSearchOperationManifests } from './browser-search-operation-manifests'
import { buildSqlServerOperationManifests } from './browser-sqlserver-operation-manifests'
import { buildSqliteOperationManifests } from './browser-sqlite-operation-manifests'
import { buildTimescaleOperationManifests } from './browser-timescale-operation-manifests'

export function buildAdapterSpecificOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  return [
    ...buildMongoOperationManifests(connection, capabilities),
    ...buildRedisOperationManifests(connection, capabilities),
    ...buildTimescaleOperationManifests(connection, capabilities),
    ...buildCockroachOperationManifests(connection, capabilities),
    ...buildMysqlOperationManifests(connection, capabilities),
    ...buildPostgresOperationManifests(connection, capabilities),
    ...buildSearchOperationManifests(connection, capabilities),
    ...buildSqlServerOperationManifests(connection, capabilities),
    ...buildSqliteOperationManifests(connection, capabilities),
    ...buildCloudWarehouseOperationManifests(connection, capabilities),
    ...buildClickHouseOperationManifests(connection, capabilities),
    ...buildDuckDbOperationManifests(connection, capabilities),
  ]
}

function buildMongoOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  const operations: OperationManifestResponse['operations'] = []

  if (connection.engine === 'mongodb' && capabilities.has('supports_admin_operations')) {
    operations.push({
      id: 'mongodb.validation.update',
      engine: connection.engine,
      family: connection.family,
      label: 'Update Validation Rules',
      scope: 'schema',
      risk: 'write',
      requiredCapabilities: ['supports_admin_operations'],
      supportedRenderers: ['schema', 'diff', 'raw'],
      description: 'Preview a guarded MongoDB collection validator update.',
      requiresConfirmation: true,
      executionSupport: 'plan-only',
      disabledReason: 'MongoDB validator updates are guarded operation previews.',
      previewOnly: true,
    })
  }

  if (connection.engine === 'mongodb' && capabilities.has('supports_import_export')) {
    operations.push(
      {
        id: 'mongodb.collection.export',
        engine: connection.engine,
        family: connection.family,
        label: 'Export Collection',
        scope: 'collection',
        risk: 'costly',
        requiredCapabilities: ['supports_import_export'],
        supportedRenderers: ['document', 'json', 'raw'],
        description: 'Preview exporting a MongoDB collection with bounded filters and format options.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'Collection export needs an adapter-specific file workflow before live execution.',
        previewOnly: true,
      },
      {
        id: 'mongodb.collection.import',
        engine: connection.engine,
        family: connection.family,
        label: 'Import Documents',
        scope: 'collection',
        risk: 'write',
        requiredCapabilities: ['supports_import_export'],
        supportedRenderers: ['diff', 'schema', 'raw'],
        description: 'Preview importing JSON, Extended JSON, NDJSON, or CSV documents into a collection.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'Collection import is guarded and adapter-specific.',
        previewOnly: true,
      },
      {
        id: 'mongodb.gridfs.export',
        engine: connection.engine,
        family: connection.family,
        label: 'Export GridFS Files',
        scope: 'collection',
        risk: 'costly',
        requiredCapabilities: ['supports_import_export'],
        supportedRenderers: ['document', 'json', 'raw'],
        description: 'Preview exporting GridFS files from a bucket with chunk consistency checks.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'GridFS export needs an adapter-specific file workflow before live execution.',
        previewOnly: true,
      },
      {
        id: 'mongodb.gridfs.upload',
        engine: connection.engine,
        family: connection.family,
        label: 'Upload GridFS File',
        scope: 'collection',
        risk: 'write',
        requiredCapabilities: ['supports_import_export'],
        supportedRenderers: ['diff', 'schema', 'raw'],
        description: 'Preview uploading a file into GridFS after metadata and chunk validation.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'GridFS uploads are guarded and adapter-specific.',
        previewOnly: true,
      },
      {
        id: 'mongodb.gridfs.validate',
        engine: connection.engine,
        family: connection.family,
        label: 'Validate GridFS Chunks',
        scope: 'collection',
        risk: 'costly',
        requiredCapabilities: ['supports_import_export'],
        supportedRenderers: ['table', 'json', 'raw'],
        description: 'Preview GridFS consistency checks for missing, orphaned, or out-of-order chunks.',
        requiresConfirmation: false,
        executionSupport: 'plan-only',
        disabledReason: 'GridFS validation is a metadata-only preview in browser mode.',
        previewOnly: true,
      },
    )
  }

  if (connection.engine === 'mongodb' && capabilities.has('supports_user_role_browser')) {
    operations.push(
      mongoUserRoleOperation(connection, 'mongodb.user.create', 'Create User', 'user', 'write'),
      mongoUserRoleOperation(connection, 'mongodb.user.drop', 'Drop User', 'user', 'destructive'),
      mongoUserRoleOperation(connection, 'mongodb.role.create', 'Create Role', 'role', 'write'),
      mongoUserRoleOperation(connection, 'mongodb.role.drop', 'Drop Role', 'role', 'destructive'),
    )
  }

  return operations
}

function mongoUserRoleOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: 'user' | 'role',
  risk: 'write' | 'destructive',
): OperationManifestResponse['operations'][number] {
  return {
    id,
    engine: connection.engine,
    family: connection.family,
    label,
    scope,
    risk,
    requiredCapabilities: ['supports_user_role_browser'],
    supportedRenderers: ['diff', 'raw'],
    description: `Preview ${label.toLowerCase()} for MongoDB database security.`,
    requiresConfirmation: true,
    executionSupport: 'plan-only',
    disabledReason: 'MongoDB user and role management is guarded and preview-only in this milestone.',
    previewOnly: true,
  }
}

function buildRedisOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if ((connection.engine !== 'redis' && connection.engine !== 'valkey') || !capabilities.has('supports_import_export')) {
    return []
  }

  return [
    {
      id: `${connection.engine}.key.export`,
      engine: connection.engine,
      family: connection.family,
      label: 'Export Key',
      scope: 'key',
      risk: 'costly',
      requiredCapabilities: ['supports_import_export'],
      supportedRenderers: ['keyvalue', 'json', 'raw'],
      description: 'Preview exporting a Redis-compatible key with its type, TTL, metadata, and bounded members.',
      requiresConfirmation: false,
      executionSupport: 'plan-only',
      disabledReason: 'Redis key export needs an adapter-specific file workflow before live execution.',
      previewOnly: true,
    },
    {
      id: `${connection.engine}.key.import`,
      engine: connection.engine,
      family: connection.family,
      label: 'Import Key',
      scope: 'key',
      risk: 'write',
      requiredCapabilities: ['supports_import_export'],
      supportedRenderers: ['diff', 'keyvalue', 'raw'],
      description: 'Preview importing or restoring a Redis-compatible key with validation and TTL handling.',
      requiresConfirmation: true,
      executionSupport: 'plan-only',
      disabledReason: 'Redis key import is guarded and adapter-specific.',
      previewOnly: true,
    },
  ]
}

function buildDuckDbOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'duckdb') return []

  const operations: OperationManifestResponse['operations'] = []

  if (capabilities.has('supports_admin_operations')) {
    operations.push(
      duckDbOperation(connection, 'duckdb.table.analyze', 'Analyze Table', 'table', 'costly', ['profile', 'metrics', 'raw'], 'Preview refreshing DuckDB statistics for a table or view.'),
      duckDbOperation(connection, 'duckdb.database.analyze', 'Analyze Database', 'database', 'costly', ['profile', 'metrics', 'raw'], 'Preview refreshing DuckDB planner statistics for the local database.'),
      duckDbOperation(connection, 'duckdb.database.checkpoint', 'Checkpoint', 'database', 'write', ['diff', 'raw'], 'Preview checkpointing the local DuckDB database file.'),
      duckDbOperation(connection, 'duckdb.extension.install', 'Install Extension', 'extension', 'write', ['diff', 'raw'], 'Preview installing a DuckDB extension.'),
      duckDbOperation(connection, 'duckdb.extension.load', 'Load Extension', 'extension', 'write', ['diff', 'raw'], 'Preview loading a DuckDB extension into the current session.'),
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

function buildClickHouseOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'clickhouse' || !capabilities.has('supports_admin_operations')) {
    return []
  }

  return [
    clickHouseTableOperation(connection, 'clickhouse.table.optimize', 'Optimize Table', 'costly', 'Preview a guarded OPTIMIZE TABLE FINAL request.'),
    clickHouseTableOperation(connection, 'clickhouse.table.materialize-ttl', 'Materialize TTL', 'costly', 'Preview a guarded ALTER TABLE MATERIALIZE TTL request.'),
    clickHouseTableOperation(connection, 'clickhouse.table.freeze', 'Freeze Table', 'write', 'Preview a guarded table freeze snapshot request.'),
  ]
}

function buildCloudWarehouseOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (!capabilities.has('supports_admin_operations')) {
    return []
  }

  if (connection.engine === 'snowflake') {
    return [
      cloudWarehouseOperation(connection, 'snowflake.table.clone', 'Clone Table', 'table', 'write', 'Preview a guarded Snowflake zero-copy table clone request.'),
      cloudWarehouseOperation(connection, 'snowflake.warehouse.suspend', 'Suspend Warehouse', 'cluster', 'write', 'Preview a guarded Snowflake warehouse suspend request.'),
      cloudWarehouseOperation(connection, 'snowflake.warehouse.resume', 'Resume Warehouse', 'cluster', 'write', 'Preview a guarded Snowflake warehouse resume request.'),
    ]
  }

  if (connection.engine === 'bigquery') {
    return [
      cloudWarehouseOperation(connection, 'bigquery.table.copy', 'Copy Table', 'table', 'write', 'Preview a guarded BigQuery table copy job.'),
    ]
  }

  return []
}

function cloudWarehouseOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: OperationManifestResponse['operations'][number]['scope'],
  risk: OperationManifestResponse['operations'][number]['risk'],
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
    supportedRenderers: ['diff', 'profile', 'raw'],
    description,
    requiresConfirmation: true,
    executionSupport: 'plan-only',
    disabledReason: 'Cloud warehouse admin execution is guarded and adapter-specific.',
    previewOnly: true,
  }
}

function clickHouseTableOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  risk: 'write' | 'costly',
  description: string,
): OperationManifestResponse['operations'][number] {
  return {
    id,
    engine: connection.engine,
    family: connection.family,
    label,
    scope: 'table',
    risk,
    requiredCapabilities: ['supports_admin_operations'],
    supportedRenderers: ['diff', 'profile', 'raw'],
    description,
    requiresConfirmation: true,
    executionSupport: 'plan-only',
    disabledReason: 'ClickHouse table maintenance execution is guarded and adapter-specific.',
    previewOnly: true,
  }
}

function duckDbOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: OperationManifestResponse['operations'][number]['scope'],
  risk: OperationManifestResponse['operations'][number]['risk'],
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
    requiresConfirmation: true,
    executionSupport: 'plan-only',
    disabledReason: `${label} is guarded and adapter-specific.`,
    previewOnly: true,
  }
}
