import type {
  ConnectionProfile,
  ConnectionTestResult,
} from '@datapadplusplus/shared-types'
import { toUserMessage } from './app-state-selectors'
import { redactSensitiveText } from './security-redaction'

interface FixtureEndpointHint {
  label: string
  port: number
  database?: string
  username?: string
  requiresSecret?: boolean
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
}

export function buildConnectionTestFailure(
  profile: ConnectionProfile,
  error: unknown,
  secret?: string,
): ConnectionTestResult {
  const message = redactConnectionTestText(
    toUserMessage(error, `Connection test failed for ${profile.name}.`),
    secret,
  )

  return {
    ok: false,
    engine: profile.engine,
    message: `Connection test failed for ${profile.name}: ${message}`,
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

  if (!endpoint || !isLocalHost(profile.host)) {
    return []
  }

  const warnings: string[] = []

  if (profile.port !== endpoint.port) {
    warnings.push(
      `DataPad++ Docker fixtures expose ${endpoint.label} on localhost:${endpoint.port}.`,
    )
  }

  if (endpoint.database && profile.database !== endpoint.database) {
    warnings.push(`Fixture database is "${endpoint.database}".`)
  }

  if (endpoint.username && profile.auth.username !== endpoint.username) {
    warnings.push(`Fixture user is "${endpoint.username}".`)
  }

  const trimmedSecret = typeof secret === 'string' ? secret.trim() : undefined
  if (endpoint.requiresSecret && !profile.auth.secretRef && !trimmedSecret) {
    warnings.push('This fixture connection needs a password before it can be tested.')
  }

  return warnings
}

function isLocalHost(host: string | null | undefined) {
  if (typeof host !== 'string') {
    return false
  }

  const normalized = host.trim().toLowerCase()
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1'
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
