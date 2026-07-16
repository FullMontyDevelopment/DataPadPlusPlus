import type { ConnectionProfile, CosmosDbConnectionOptions } from '@datapadplusplus/shared-types'

export const COSMOS_MICROSOFT_EMULATOR_ENDPOINT = 'http://localhost:8081'
export const COSMOS_FIXTURE_EMULATOR_ENDPOINT = 'http://localhost:8082'
export const COSMOS_FIXTURE_DATABASE = 'datapadplusplus'
export const COSMOS_FIXTURE_DEFAULT_CONTAINER = 'orders'

export function normalizeCosmosDbEmulatorProfile(profile: ConnectionProfile): ConnectionProfile {
  if (profile.engine !== 'cosmosdb') {
    return profile
  }

  const options = profile.cosmosDbOptions
  const connectMode =
    options?.connectMode ?? (profile.connectionMode === 'cloud-sdk' ? 'emulator' : undefined)
  const authMode = options?.authMode ?? (connectMode === 'emulator' ? 'emulator' : undefined)
  if (connectMode !== 'emulator' && authMode !== 'emulator') {
    return profile
  }

  const endpoint = normalizeCosmosDbEmulatorEndpoint(options?.accountEndpoint ?? profile.host)
  const database = options?.databaseName ?? profile.database

  return {
    ...profile,
    host: endpoint,
    port: portFromCosmosEndpoint(endpoint) ?? profile.port ?? 8081,
    database,
    cosmosDbOptions: {
      ...(options ?? {}),
      connectMode: 'emulator',
      api: options?.api ?? 'nosql',
      accountEndpoint: endpoint,
      databaseName: database || undefined,
      authMode: options?.authMode ?? 'emulator',
      allowSelfSignedEmulatorCertificate:
        options?.allowSelfSignedEmulatorCertificate ?? true,
    },
  }
}

export function endpointValueForCosmosMode(
  connectMode: CosmosDbConnectionOptions['connectMode'],
  endpoint: string | null | undefined,
) {
  const trimmed = endpoint?.trim() ?? ''
  if (connectMode !== 'emulator') {
    return trimmed
  }
  if (!trimmed) {
    return COSMOS_MICROSOFT_EMULATOR_ENDPOINT
  }
  if (isBareLocalCosmosEndpoint(trimmed)) {
    return explicitLocalCosmosEndpoint(trimmed)
  }
  return trimmed
}

export function portFromCosmosEndpoint(endpoint: string | undefined) {
  if (!endpoint) {
    return undefined
  }

  const trimmed = endpoint.trim()
  if (!trimmed) {
    return undefined
  }

  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`)
    return url.port ? Number(url.port) : undefined
  } catch {
    const colonIndex = trimmed.lastIndexOf(':')
    const port = colonIndex >= 0 ? trimmed.slice(colonIndex + 1) : ''
    const parsed = Number(port)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

function normalizeCosmosDbEmulatorEndpoint(endpoint: string | null | undefined) {
  const trimmed = endpoint?.trim() ?? ''
  if (!trimmed) {
    return COSMOS_MICROSOFT_EMULATOR_ENDPOINT
  }
  if (isBareLocalCosmosEndpoint(trimmed)) {
    return explicitLocalCosmosEndpoint(trimmed)
  }

  if (trimmed.includes('://')) {
    return trimmed
  }

  return `http://${trimmed}`
}

function isBareLocalCosmosEndpoint(value: string) {
  const normalized = value.trim().toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function explicitLocalCosmosEndpoint(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized === '::1') {
    return 'http://[::1]:8081'
  }
  return `http://${normalized}:8081`
}
