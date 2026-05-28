import type { ConnectionProfile, OperationManifestResponse } from '@datapadplusplus/shared-types'

export function buildGenericOptionalOperationManifests(
  connection: ConnectionProfile,
  capabilities: ReadonlySet<string>,
  maturity?: string,
): OperationManifestResponse['operations'] {
  const operations: OperationManifestResponse['operations'] = []
  const beta = maturity === 'beta'

  if (capabilities.has('supports_permission_inspection')) {
    operations.push({
      id: `${connection.engine}.security.inspect`,
      engine: connection.engine,
      family: connection.family,
      label: 'Inspect Permissions',
      scope: 'schema',
      risk: 'diagnostic',
      requiredCapabilities: ['supports_permission_inspection'],
      supportedRenderers: ['table', 'json'],
      description: 'Inspect users, roles, grants, and effective privileges where the engine exposes them.',
      requiresConfirmation: false,
      executionSupport: beta ? 'plan-only' : 'live',
      disabledReason: beta
        ? 'Beta adapters expose generated plans before live inspection.'
        : undefined,
      previewOnly: beta,
    })
  }

  if (capabilities.has('supports_import_export')) {
    operations.push({
      id: `${connection.engine}.data.import-export`,
      engine: connection.engine,
      family: connection.family,
      label: 'Import / Export',
      scope: 'table',
      risk: 'costly',
      requiredCapabilities: ['supports_import_export'],
      supportedRenderers: ['diff', 'table', 'raw'],
      description: 'Preview an engine-native import or export workflow.',
      requiresConfirmation: true,
      executionSupport: 'plan-only',
      disabledReason: 'Import and export need an adapter-specific file workflow before live execution.',
      previewOnly: true,
    })
  }

  if (capabilities.has('supports_backup_restore')) {
    operations.push({
      id: `${connection.engine}.data.backup-restore`,
      engine: connection.engine,
      family: connection.family,
      label: 'Backup / Restore',
      scope: 'database',
      risk: 'destructive',
      requiredCapabilities: ['supports_backup_restore'],
      supportedRenderers: ['diff', 'raw'],
      description: 'Preview an engine-native backup or restore workflow.',
      requiresConfirmation: true,
      executionSupport: 'plan-only',
      disabledReason: 'Backup and restore execution is guarded and adapter-specific.',
      previewOnly: true,
    })
  }

  return operations
}
