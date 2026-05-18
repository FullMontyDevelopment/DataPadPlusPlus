import type { BootstrapPayload, ConnectionProfile, ConnectionTestRequest, ConnectionTestResult, EnvironmentProfile, SecretRef } from '@datapadplusplus/shared-types'
import { resolveEnvironment } from '../../app/state/helpers'
import {
  deleteConnection,
  deleteEnvironment,
  setActiveConnection,
  upsertConnection,
  upsertEnvironment,
} from './browser-connections'
import { buildBrowserPayload, loadBrowserSnapshot, saveBrowserSnapshot } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'

export const clientConnections = {
  async setActiveConnection(connectionId: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('set_active_connection', {
        connectionId,
      })
    }

    const snapshot = setActiveConnection(loadBrowserSnapshot(), connectionId)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async upsertConnection(profile: ConnectionProfile): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('upsert_connection_profile', { profile })
    }

    const snapshot = upsertConnection(loadBrowserSnapshot(), profile)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async deleteConnection(connectionId: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('delete_connection_profile', {
        connectionId,
      })
    }

    const snapshot = deleteConnection(loadBrowserSnapshot(), connectionId)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async storeSecret(secretRef: SecretRef, secret: string): Promise<boolean> {
    if (isTauriRuntime()) {
      return invokeDesktop<boolean>('store_secret', { secretRef, secret })
    }

    return Boolean(secretRef.id && secret)
  },

  async upsertEnvironment(profile: EnvironmentProfile): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('upsert_environment_profile', { profile })
    }

    const snapshot = upsertEnvironment(loadBrowserSnapshot(), profile)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async deleteEnvironment(environmentId: string): Promise<BootstrapPayload> {
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('delete_environment_profile', { environmentId })
    }

    const snapshot = deleteEnvironment(loadBrowserSnapshot(), environmentId)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async testConnection(
    request: ConnectionTestRequest,
  ): Promise<ConnectionTestResult> {
    if (isTauriRuntime()) {
      return invokeDesktop<ConnectionTestResult>('test_connection', { request })
    }

    const snapshot = loadBrowserSnapshot()
    const resolvedEnvironment = resolveEnvironment(
      snapshot.environments,
      request.environmentId,
    )

    const host = request.profile.host.replaceAll(
      '${DB_HOST}',
      resolvedEnvironment.variables.DB_HOST ?? request.profile.host,
    )
    const resolvedHost = Object.entries(resolvedEnvironment.variables).reduce(
      (current, [key, value]) => current.replaceAll(`\${${key}}`, value),
      host,
    )
    const resolvedDatabase = Object.entries(resolvedEnvironment.variables).reduce(
      (current, [key, value]) => current.replaceAll(`\${${key}}`, value),
      request.profile.database ?? '',
    )

    const warnings =
      resolvedEnvironment.unresolvedKeys.length > 0
        ? ['Some environment variables are still unresolved in preview mode.']
        : []

    return {
      ok: resolvedEnvironment.unresolvedKeys.length === 0 && resolvedHost.length > 0,
      engine: request.profile.engine,
      message:
        resolvedEnvironment.unresolvedKeys.length === 0
          ? `Preview connection test succeeded for ${request.profile.name}.`
          : 'Preview connection test detected unresolved variables.',
      warnings,
      resolvedHost,
      resolvedDatabase: resolvedDatabase || undefined,
      durationMs: 42,
    }
  },
}
