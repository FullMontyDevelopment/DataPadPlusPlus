import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

type Operation = OperationManifestResponse['operations'][number]

export function buildDocumentOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  return [
    ...buildCosmosDbOperationManifests(connection, capabilities),
    ...buildLiteDbOperationManifests(connection, capabilities),
  ]
}

function buildCosmosDbOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'cosmosdb' || !capabilities.has('supports_admin_operations')) {
    return []
  }

  return [
    documentOperation(
      connection,
      'cosmosdb.throughput.update',
      'Update Throughput',
      'database',
      'write',
      ['supports_admin_operations', 'supports_cost_estimation'],
      ['diff', 'metrics', 'costEstimate', 'raw'],
      'Preview a guarded Cosmos DB database or container throughput update.',
      'Cosmos DB throughput changes are guarded and adapter-specific.',
    ),
    documentOperation(
      connection,
      'cosmosdb.consistency.update',
      'Update Consistency',
      'cluster',
      'write',
      ['supports_admin_operations'],
      ['diff', 'raw'],
      'Preview an account-level Cosmos DB consistency policy change.',
      'Cosmos DB consistency changes are guarded and adapter-specific.',
    ),
    documentOperation(
      connection,
      'cosmosdb.regions.failover',
      'Failover Regions',
      'cluster',
      'write',
      ['supports_admin_operations'],
      ['diff', 'metrics', 'raw'],
      'Preview Cosmos DB regional failover priority changes with application-impact checks.',
      'Cosmos DB regional failover is guarded and adapter-specific.',
    ),
  ]
}

function buildLiteDbOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'litedb' || !capabilities.has('supports_admin_operations')) {
    return []
  }

  return [
    documentOperation(
      connection,
      'litedb.storage.checkpoint',
      'Checkpoint',
      'database',
      'write',
      ['supports_admin_operations'],
      ['diff', 'raw'],
      'Preview persisting pending LiteDB pages before local-file maintenance.',
      'LiteDB checkpoint execution is guarded and adapter-specific.',
    ),
    documentOperation(
      connection,
      'litedb.storage.compact',
      'Compact File',
      'database',
      'costly',
      ['supports_admin_operations'],
      ['diff', 'metrics', 'raw'],
      'Preview a guarded LiteDB compaction workflow that validates the compacted copy.',
      'LiteDB compaction execution is guarded and adapter-specific.',
    ),
    documentOperation(
      connection,
      'litedb.storage.rebuild-indexes',
      'Rebuild Indexes',
      'collection',
      'costly',
      ['supports_admin_operations', 'supports_index_management'],
      ['diff', 'metrics', 'raw'],
      'Preview rebuilding LiteDB collection indexes after file and lock checks.',
      'LiteDB index rebuild execution is guarded and adapter-specific.',
    ),
  ]
}

function documentOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: Operation['scope'],
  risk: Operation['risk'],
  requiredCapabilities: Operation['requiredCapabilities'],
  supportedRenderers: Operation['supportedRenderers'],
  description: string,
  disabledReason: string,
): Operation {
  return {
    id,
    engine: connection.engine,
    family: connection.family,
    label,
    scope,
    risk,
    requiredCapabilities,
    supportedRenderers,
    description,
    requiresConfirmation: true,
    executionSupport: 'plan-only',
    disabledReason,
    previewOnly: true,
  }
}
