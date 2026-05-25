import type { BootstrapPayload, ConnectionProfile, ConnectionTestRequest, ConnectionTestResult, EnvironmentProfile, SecretRef } from '@datapadplusplus/shared-types'
import { resolveEnvironment } from '../../app/state/helpers'
import {
  interpolateEnvironmentVariables,
  referencedSensitiveEnvironmentVariableKeys,
} from '../../app/state/environment-variables'
import {
  deleteConnection,
  deleteEnvironment,
  setActiveConnection,
  upsertConnection,
  upsertEnvironment,
} from './browser-connections'
import { buildBrowserPayload, loadBrowserSnapshot, saveBrowserSnapshot } from './browser-store'
import { isTauriRuntime, invokeDesktop } from './desktop-bridge'
import { redactConnectionTestForEnvironment } from './browser-response-redaction'
import {
  validateConnectionProfile,
  validateConnectionTestRequest,
  validateEnvironmentProfile,
} from './request-validation'
import { validateRequiredId } from './request-validation-core'

export const clientConnections = {
  async setActiveConnection(connectionId: string): Promise<BootstrapPayload> {
    validateRequiredId(connectionId, 'Connection id')
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
    profile = validateConnectionProfile(profile)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('upsert_connection_profile', { profile })
    }

    const snapshot = upsertConnection(loadBrowserSnapshot(), profile)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async deleteConnection(connectionId: string): Promise<BootstrapPayload> {
    validateRequiredId(connectionId, 'Connection id')
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
    validateRequiredId(secretRef.id, 'Secret id')
    if (isTauriRuntime()) {
      return invokeDesktop<boolean>('store_secret', { secretRef, secret })
    }

    return Boolean(secretRef.id && secret)
  },

  async upsertEnvironment(profile: EnvironmentProfile): Promise<BootstrapPayload> {
    profile = validateEnvironmentProfile(profile)
    if (isTauriRuntime()) {
      return invokeDesktop<BootstrapPayload>('upsert_environment_profile', { profile })
    }

    const snapshot = upsertEnvironment(loadBrowserSnapshot(), profile)
    saveBrowserSnapshot(snapshot)
    return buildBrowserPayload(snapshot)
  },

  async deleteEnvironment(environmentId: string): Promise<BootstrapPayload> {
    validateRequiredId(environmentId, 'Environment id')
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
    request = validateConnectionTestRequest(request)
    if (isTauriRuntime()) {
      return invokeDesktop<ConnectionTestResult>('test_connection', { request })
    }

    const snapshot = loadBrowserSnapshot()
    const resolvedEnvironment = resolveEnvironment(
      snapshot.environments,
      request.environmentId,
    )

    const resolvedHost = interpolateEnvironmentVariables(
      request.profile.host,
      resolvedEnvironment.variables,
    )
    const resolvedDatabase = interpolateEnvironmentVariables(
      request.profile.database ?? '',
      resolvedEnvironment.variables,
    )
    const referencedSecrets = [
      request.profile.host,
      request.profile.database ?? '',
      request.profile.connectionString ?? '',
      request.profile.auth.username ?? '',
    ].flatMap((value) =>
      referencedSensitiveEnvironmentVariableKeys(value, resolvedEnvironment.sensitiveKeys),
    )
    const uniqueReferencedSecrets = [...new Set(referencedSecrets)]

    const warnings =
      uniqueReferencedSecrets.length > 0
        ? [
            `Secret variable ${uniqueReferencedSecrets[0]} is resolved only by the desktop secret store.`,
          ]
        : resolvedEnvironment.unresolvedKeys.length > 0
        ? ['Some environment variables are still unresolved in preview mode.']
        : []

    return redactConnectionTestForEnvironment({
      ok:
        uniqueReferencedSecrets.length === 0 &&
        resolvedEnvironment.unresolvedKeys.length === 0 &&
        resolvedHost.length > 0,
      engine: request.profile.engine,
      message:
        uniqueReferencedSecrets.length > 0
          ? 'Preview connection test cannot resolve secret environment variables.'
          : resolvedEnvironment.unresolvedKeys.length === 0
          ? `Preview connection test succeeded for ${request.profile.name}.`
          : 'Preview connection test detected unresolved variables.',
      warnings,
      resolvedHost,
      resolvedDatabase: resolvedDatabase || undefined,
      durationMs: 42,
    }, resolvedEnvironment, request.secret ? [request.secret] : [])
  },
}
