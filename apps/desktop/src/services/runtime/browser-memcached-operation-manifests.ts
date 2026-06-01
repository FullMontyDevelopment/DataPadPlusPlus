import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

export function buildMemcachedOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
): OperationManifestResponse['operations'] {
  if (connection.engine !== 'memcached' || !capabilities.has('supports_admin_operations')) {
    return []
  }

  return [
    memcachedKeyOperation(connection, 'memcached.key.get', 'Get Key', 'read', false),
    memcachedKeyOperation(connection, 'memcached.key.set', 'Set Key', 'write', true),
    memcachedKeyOperation(connection, 'memcached.key.touch', 'Touch Key', 'write', true),
    memcachedKeyOperation(connection, 'memcached.key.delete', 'Delete Key', 'destructive', true),
  ]
}

function memcachedKeyOperation(
  connection: ConnectionProfile,
  id: string,
  label: string,
  risk: OperationManifestResponse['operations'][number]['risk'],
  requiresConfirmation: boolean,
): OperationManifestResponse['operations'][number] {
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
