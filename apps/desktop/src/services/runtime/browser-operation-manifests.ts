import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'
import { datastoreBacklogByEngine } from '@datapadplusplus/shared-types'

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

  if (connection.engine === 'mongodb' && capabilities.has('supports_admin_operations')) {
    optional.push({
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
    optional.push(
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

  if ((connection.engine === 'redis' || connection.engine === 'valkey') && capabilities.has('supports_import_export')) {
    optional.push(
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
    )
  }

  if (connection.engine === 'mongodb' && capabilities.has('supports_user_role_browser')) {
    optional.push(
      {
        id: 'mongodb.user.create',
        engine: connection.engine,
        family: connection.family,
        label: 'Create User',
        scope: 'user',
        risk: 'write',
        requiredCapabilities: ['supports_user_role_browser'],
        supportedRenderers: ['diff', 'raw'],
        description: 'Preview creating a MongoDB database user with assigned roles.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'MongoDB user management is guarded and preview-only in this milestone.',
        previewOnly: true,
      },
      {
        id: 'mongodb.user.drop',
        engine: connection.engine,
        family: connection.family,
        label: 'Drop User',
        scope: 'user',
        risk: 'destructive',
        requiredCapabilities: ['supports_user_role_browser'],
        supportedRenderers: ['diff', 'raw'],
        description: 'Preview dropping a MongoDB database user.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'MongoDB user management is guarded and preview-only in this milestone.',
        previewOnly: true,
      },
      {
        id: 'mongodb.role.create',
        engine: connection.engine,
        family: connection.family,
        label: 'Create Role',
        scope: 'role',
        risk: 'write',
        requiredCapabilities: ['supports_user_role_browser'],
        supportedRenderers: ['diff', 'raw'],
        description: 'Preview creating a MongoDB role with privileges and inherited roles.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'MongoDB role management is guarded and preview-only in this milestone.',
        previewOnly: true,
      },
      {
        id: 'mongodb.role.drop',
        engine: connection.engine,
        family: connection.family,
        label: 'Drop Role',
        scope: 'role',
        risk: 'destructive',
        requiredCapabilities: ['supports_user_role_browser'],
        supportedRenderers: ['diff', 'raw'],
        description: 'Preview dropping a MongoDB database role.',
        requiresConfirmation: true,
        executionSupport: 'plan-only',
        disabledReason: 'MongoDB role management is guarded and preview-only in this milestone.',
        previewOnly: true,
      },
    )
  }

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

  return [...base, ...optional]
}
