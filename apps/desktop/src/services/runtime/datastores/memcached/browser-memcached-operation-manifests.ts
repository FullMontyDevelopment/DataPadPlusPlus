import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

type Operation = OperationManifestResponse['operations'][number]

export function buildMemcachedOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'memcached' || !capabilities.has('supports_admin_operations')) {
    return []
  }

  return [
    memcachedAdminOperation(
      connection,
      'memcached.stats.reset',
      'Reset Stats',
      'cluster',
      'write',
      ['supports_admin_operations', 'supports_metrics_collection'],
      ['metrics', 'raw'],
      'Preview resetting Memcached stats counters while leaving cached values intact.',
    ),
    memcachedAdminOperation(
      connection,
      'memcached.cache.flush',
      'Flush Cache',
      'cluster',
      'destructive',
      ['supports_admin_operations'],
      ['diff', 'raw'],
      'Preview a destructive Memcached flush_all request with optional delay.',
    ),
    memcachedKeyOperation(connection, 'memcached.key.get', 'Get Key', 'read', false),
    memcachedKeyOperation(connection, 'memcached.key.gets', 'Get Key With CAS', 'read', false),
    memcachedKeyOperation(connection, 'memcached.key.set', 'Set Key', 'write', true),
    memcachedKeyOperation(connection, 'memcached.key.touch', 'Touch Key', 'write', true),
    memcachedKeyOperation(connection, 'memcached.key.increment', 'Increment Key', 'write', true),
    memcachedKeyOperation(connection, 'memcached.key.decrement', 'Decrement Key', 'write', true),
    memcachedKeyOperation(connection, 'memcached.key.delete', 'Delete Key', 'destructive', true),
  ]
}

function memcachedAdminOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  scope: Operation['scope'],
  risk: Operation['risk'],
  requiredCapabilities: Operation['requiredCapabilities'],
  supportedRenderers: Operation['supportedRenderers'],
  description: string,
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
    disabledReason: 'Memcached admin operations are guarded previews until a live executor promotes them.',
    previewOnly: true,
  }
}

function memcachedKeyOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  risk: Operation['risk'],
  requiresConfirmation: boolean,
): Operation {
  return {
    id,
    engine: connection.engine,
    family: connection.family,
    label,
    scope: 'key',
    risk,
    requiredCapabilities: risk === 'read' ? ['supports_result_snapshots'] : ['supports_admin_operations'],
    supportedRenderers: risk === 'read' ? ['keyvalue', 'raw'] : ['diff', 'raw'],
    description: `${label} for an application-known Memcached key.`,
    requiresConfirmation,
    executionSupport: 'plan-only',
    disabledReason: 'Memcached key operations are guarded previews until a live executor promotes them.',
    previewOnly: true,
  }
}
