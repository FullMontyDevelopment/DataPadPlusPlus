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

  return [...base, ...optional]
}
