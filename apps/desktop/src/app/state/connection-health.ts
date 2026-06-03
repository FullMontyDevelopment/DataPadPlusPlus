import type { ConnectionTestResult, DatastoreEngine } from '@datapadplusplus/shared-types'
import { redactSensitiveText } from './security-redaction'

export type ConnectionHealthStatus =
  | 'unknown'
  | 'checking'
  | 'connected'
  | 'issue'
  | 'degraded'

export type ConnectionHealthSource =
  | 'startup'
  | 'manual-test'
  | 'metadata'
  | 'structure'
  | 'query'
  | 'redis-browser'
  | 'metrics'
  | 'object-view'

export interface ConnectionHealth {
  connectionId: string
  environmentId: string
  status: ConnectionHealthStatus
  source: ConnectionHealthSource
  checkId?: string
  lastCheckedAt?: string
  durationMs?: number
  message?: string
  warnings?: string[]
  resolvedHost?: string
  resolvedDatabase?: string
  previous?: ConnectionHealth
}

const CONNECTION_ISSUE_PATTERN =
  /\b(connect|connection|network|socket|timeout|timed out|refused|unreachable|host|dns|auth|authentication|password|credential|secret|tls|ssl|certificate|login|server closed|closed the connection|econn|etimedout|enotfound|os error|no route|variables?|unresolved)\b/i

export function connectionHealthKey(connectionId: string, environmentId: string) {
  return `${connectionId}::${environmentId || '__default__'}`
}

export function connectionHealthChecking(
  connectionId: string,
  environmentId: string,
  source: ConnectionHealthSource,
  message = 'Checking connection',
  checkId?: string,
): ConnectionHealth {
  return sanitizeConnectionHealth({
    connectionId,
    environmentId,
    status: 'checking',
    source,
    checkId,
    message,
  })
}

export function connectionHealthFromTestResult(
  connectionId: string,
  environmentId: string,
  result: ConnectionTestResult,
  source: ConnectionHealthSource,
): ConnectionHealth {
  return sanitizeConnectionHealth({
    connectionId,
    environmentId,
    status: result.ok ? (result.warnings.length > 0 ? 'degraded' : 'connected') : 'issue',
    source,
    lastCheckedAt: new Date().toISOString(),
    durationMs: result.durationMs,
    message: result.message,
    warnings: result.warnings,
    resolvedHost: result.resolvedHost,
    resolvedDatabase: result.resolvedDatabase,
  })
}

export function connectionHealthConnected(
  connectionId: string,
  environmentId: string,
  source: ConnectionHealthSource,
  message = 'Connection reachable',
  durationMs?: number,
): ConnectionHealth {
  return sanitizeConnectionHealth({
    connectionId,
    environmentId,
    status: 'connected',
    source,
    lastCheckedAt: new Date().toISOString(),
    durationMs,
    message,
  })
}

export function connectionHealthIssue(
  connectionId: string,
  environmentId: string,
  source: ConnectionHealthSource,
  message: string,
  warnings: string[] = [],
): ConnectionHealth {
  return sanitizeConnectionHealth({
    connectionId,
    environmentId,
    status: 'issue',
    source,
    lastCheckedAt: new Date().toISOString(),
    message,
    warnings,
  })
}

export function connectionHealthToConnectionTest(
  health: ConnectionHealth | undefined,
  engine: DatastoreEngine,
): ConnectionTestResult | undefined {
  if (!health || health.status === 'unknown' || health.status === 'checking') {
    return undefined
  }

  return {
    ok: health.status === 'connected' || health.status === 'degraded',
    engine,
    message: health.message ?? healthLabel(health),
    warnings: health.warnings ?? [],
    resolvedHost: health.resolvedHost ?? '',
    resolvedDatabase: health.resolvedDatabase,
    durationMs: health.durationMs,
  }
}

export function healthLabel(health: ConnectionHealth) {
  switch (health.status) {
    case 'checking':
      return 'Checking connection'
    case 'connected':
      return 'Connected'
    case 'degraded':
      return 'Connected with warnings'
    case 'issue':
      return 'Connection issue'
    case 'unknown':
    default:
      return 'Not checked this session'
  }
}

export function shouldRecordConnectionIssue(message: string) {
  return CONNECTION_ISSUE_PATTERN.test(message)
}

export function shouldShowEnvironmentHealthAction(health: ConnectionHealth | undefined) {
  return Boolean(
    health?.message && /\b(environment|variable|secret|unresolved)\b/i.test(health.message),
  )
}

function sanitizeConnectionHealth(health: ConnectionHealth): ConnectionHealth {
  return {
    ...health,
    message: health.message ? redactSensitiveText(health.message) : health.message,
    warnings: health.warnings?.map((warning) => redactSensitiveText(warning)),
    resolvedHost: health.resolvedHost ? redactSensitiveText(health.resolvedHost) : health.resolvedHost,
    resolvedDatabase: health.resolvedDatabase
      ? redactSensitiveText(health.resolvedDatabase)
      : health.resolvedDatabase,
  }
}
