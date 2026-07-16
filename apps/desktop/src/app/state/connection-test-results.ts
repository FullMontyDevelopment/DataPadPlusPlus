import type {
  ConnectionProfile,
  ConnectionTestResult,
} from '@datapadplusplus/shared-types'
import { toUserError } from './app-state-selectors'
import { redactSensitiveText } from './security-redaction'

interface FixtureEndpointHint {
  label: string
  port: number
  database?: string
  username?: string
  requiresSecret?: boolean
  setupHint?: string
}

const FIXTURE_ENDPOINTS: Partial<Record<ConnectionProfile['engine'], FixtureEndpointHint>> = {
  postgresql: {
    label: 'PostgreSQL',
    port: 54329,
    database: 'datapadplusplus',
    username: 'datapadplusplus',
    requiresSecret: true,
  },
  mysql: {
    label: 'MySQL',
    port: 33060,
    database: 'commerce',
    username: 'datapadplusplus',
    requiresSecret: true,
  },
  sqlserver: {
    label: 'SQL Server',
    port: 14333,
    database: 'datapadplusplus',
    username: 'sa',
    requiresSecret: true,
  },
  mongodb: {
    label: 'MongoDB',
    port: 27018,
    database: 'catalog',
    username: 'datapadplusplus',
    requiresSecret: true,
  },
  redis: {
    label: 'Redis',
    port: 6380,
    database: '0',
  },
  cosmosdb: {
    label: 'Cosmos DB emulator',
    port: 8082,
    database: 'datapadplusplus',
    setupHint:
      'For Microsoft Cosmos DB emulator use http://localhost:8081. For DataPad++ fixtures run npm run fixtures:up:profile -- cosmosdb and use http://localhost:8082.',
  },
}

export function buildConnectionTestFailure(
  profile: ConnectionProfile,
  error: unknown,
  secret?: string,
): ConnectionTestResult {
  const userError = toUserError(error, `Connection test failed for ${profile.name}.`)
  const message = redactConnectionTestText(
    userError.message,
    secret,
  )

  return {
    ok: false,
    engine: profile.engine,
    message: `Connection test failed for ${profile.name}: ${message}`,
    errorCode: userError.code,
    warnings: fixtureWarningsForConnection(profile, secret),
    resolvedHost: redactConnectionTestText(profile.host, secret),
    resolvedDatabase: profile.database
      ? redactConnectionTestText(profile.database, secret)
      : profile.database,
    durationMs: 0,
  }
}

export function fixtureWarningsForConnection(
  profile: ConnectionProfile,
  secret?: string,
): string[] {
  const endpoint = FIXTURE_ENDPOINTS[profile.engine]

  if (!endpoint || !isLocalHost(profileEndpointValue(profile))) {
    return []
  }

  const warnings: string[] = []
  const port = profilePort(profile)

  if (port !== endpoint.port) {
    warnings.push(
      `DataPad++ Docker fixtures expose ${endpoint.label} on localhost:${endpoint.port}.`,
    )
  }

  if (endpoint.database && profileDatabase(profile) !== endpoint.database) {
    warnings.push(`Fixture database is "${endpoint.database}".`)
  }

  if (endpoint.username && profile.auth.username !== endpoint.username) {
    warnings.push(`Fixture user is "${endpoint.username}".`)
  }

  const trimmedSecret = typeof secret === 'string' ? secret.trim() : undefined
  if (endpoint.requiresSecret && !profile.auth.secretRef && !trimmedSecret) {
    warnings.push('This fixture connection needs a password before it can be tested.')
  }

  if (endpoint.setupHint) {
    warnings.push(endpoint.setupHint)
  }

  return warnings
}

function isLocalHost(host: string | null | undefined) {
  if (typeof host !== 'string') {
    return false
  }

  const normalized = hostNameFromEndpoint(host).replace(/^\[|\]$/g, '').toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
}

function profileEndpointValue(profile: ConnectionProfile) {
  if (profile.engine === 'cosmosdb') {
    return (
      profile.cosmosDbOptions?.accountEndpoint ||
      profile.connectionString ||
      profile.host
    )
  }
  return profile.host
}

function profileDatabase(profile: ConnectionProfile) {
  if (profile.engine === 'cosmosdb') {
    return profile.cosmosDbOptions?.databaseName ?? profile.database
  }
  return profile.database
}

function profilePort(profile: ConnectionProfile) {
  return portFromEndpoint(profileEndpointValue(profile)) ?? profile.port
}

function hostNameFromEndpoint(endpoint: string) {
  const trimmed = endpoint.trim()
  if (trimmed === '::1') {
    return '::1'
  }
  try {
    return new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`).hostname
  } catch {
    const authority = trimmed.split('/')[0] ?? ''
    if (authority.startsWith('[')) {
      const closing = authority.indexOf(']')
      return closing >= 0 ? authority.slice(1, closing) : authority
    }
    return authority.split(':')[0] ?? ''
  }
}

function portFromEndpoint(endpoint: string | null | undefined) {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return undefined
  }
  const trimmed = endpoint.trim()
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`)
    return url.port ? Number(url.port) : undefined
  } catch {
    const authority = trimmed.split('/')[0] ?? ''
    const colonIndex = authority.lastIndexOf(':')
    const port = colonIndex >= 0 ? authority.slice(colonIndex + 1) : ''
    const parsed = Number(port)
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
  }
}

function redactConnectionTestText(value: string | null | undefined, secret?: string) {
  if (typeof value !== 'string') {
    return ''
  }

  const redacted = redactSensitiveText(value)
  const trimmedSecret = typeof secret === 'string' ? secret.trim() : undefined

  if (!trimmedSecret || trimmedSecret.length < 3) {
    return redacted
  }

  return redacted.replaceAll(trimmedSecret, '********')
}
