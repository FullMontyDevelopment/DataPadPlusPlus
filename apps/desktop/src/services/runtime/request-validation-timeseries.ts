import type {
  ConnectionProfile,
  SecretRef,
  TimeSeriesAuthMode,
  TimeSeriesConnectionMode,
  TimeSeriesQueryLanguage,
} from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from './request-validation-core'

const CONNECT_MODES = new Set<TimeSeriesConnectionMode>([
  'http',
  'cloud',
  'influx-v1',
  'influx-v2',
  'influx-v3',
  'opentsdb-http',
])
const AUTH_MODES = new Set<TimeSeriesAuthMode>([
  'none',
  'basic',
  'bearer-token',
  'api-token',
  'custom-header',
])
const QUERY_LANGUAGES = new Set<TimeSeriesQueryLanguage>([
  'promql',
  'flux',
  'influxql',
  'sql',
  'opentsdb',
])

export function validateTimeSeriesConnectionOptions(
  options: ConnectionProfile['timeSeriesOptions'] | null | undefined,
): ConnectionProfile['timeSeriesOptions'] {
  if (options === undefined || options === null) {
    return undefined
  }
  if (typeof options !== 'object') {
    throw new Error('Time-series connection options must be an object.')
  }

  return {
    connectMode: enumValue(options.connectMode, CONNECT_MODES, 'time-series connection mode'),
    endpointUrl: text(options.endpointUrl, 'time-series endpoint URL', MAX_SCOPE_LENGTH),
    pathPrefix: pathPrefix(options.pathPrefix),
    organization: text(options.organization, 'time-series organization', MAX_OBJECT_NAME_LENGTH),
    bucket: text(options.bucket, 'time-series bucket', MAX_OBJECT_NAME_LENGTH),
    databaseName: text(options.databaseName, 'time-series database', MAX_OBJECT_NAME_LENGTH),
    retentionPolicy: text(
      options.retentionPolicy,
      'time-series retention policy',
      MAX_OBJECT_NAME_LENGTH,
    ),
    defaultMetric: text(options.defaultMetric, 'time-series default metric', MAX_OBJECT_NAME_LENGTH),
    defaultRange: text(options.defaultRange, 'time-series default range', 40),
    defaultStep: text(options.defaultStep, 'time-series default step', 40),
    defaultQueryLanguage: enumValue(
      options.defaultQueryLanguage,
      QUERY_LANGUAGES,
      'time-series query language',
    ),
    authMode: enumValue(options.authMode, AUTH_MODES, 'time-series auth mode'),
    username: text(options.username, 'time-series username', MAX_OBJECT_NAME_LENGTH),
    tokenSecretRef: options.tokenSecretRef
      ? validateSecretRef(options.tokenSecretRef, 'time-series token')
      : undefined,
    customHeaderName: text(
      options.customHeaderName,
      'time-series custom header',
      MAX_OBJECT_NAME_LENGTH,
    ),
    customHeaderSecretRef: options.customHeaderSecretRef
      ? validateSecretRef(options.customHeaderSecretRef, 'time-series custom header credential')
      : undefined,
    tenantHeaderName: text(
      options.tenantHeaderName,
      'time-series tenant header',
      MAX_OBJECT_NAME_LENGTH,
    ),
    tenantId: text(options.tenantId, 'time-series tenant id', MAX_OBJECT_NAME_LENGTH),
    verifyCertificates: bool(options.verifyCertificates, 'time-series certificate verification flag'),
    useTls: bool(options.useTls, 'time-series TLS flag'),
    caCertificatePath: text(
      options.caCertificatePath,
      'time-series CA certificate path',
      MAX_SCOPE_LENGTH,
    ),
    clientCertificatePath: text(
      options.clientCertificatePath,
      'time-series client certificate path',
      MAX_SCOPE_LENGTH,
    ),
    clientKeyPath: text(options.clientKeyPath, 'time-series client key path', MAX_SCOPE_LENGTH),
    connectionTimeoutMs: integer(
      options.connectionTimeoutMs,
      'time-series connection timeout',
      1,
      900_000,
    ),
    queryTimeoutMs: integer(options.queryTimeoutMs, 'time-series query timeout', 1, 3_600_000),
    maxSeries: integer(options.maxSeries, 'time-series max series', 1, 1_000_000),
    maxDataPoints: integer(options.maxDataPoints, 'time-series max data points', 1, 5_000_000),
  }
}

function validateSecretRef(secretRef: SecretRef, label: string): SecretRef {
  if (!secretRef || typeof secretRef !== 'object') {
    throw new Error(`${label} must be a stored credential reference.`)
  }
  validateRequiredId(secretRef.id, `${label} id`)
  validateRequiredText(secretRef.provider, `${label} provider`, 80)
  validateRequiredText(secretRef.service, `${label} service`, MAX_OBJECT_NAME_LENGTH)
  validateRequiredText(secretRef.account, `${label} account`, MAX_OBJECT_NAME_LENGTH)
  validateRequiredText(secretRef.label, `${label} label`, MAX_OBJECT_NAME_LENGTH)
  return secretRef
}

function enumValue<T extends string>(value: T | undefined, allowed: Set<T>, label: string) {
  const normalized = validateOptionalText(value, label, MAX_OBJECT_NAME_LENGTH)?.trim()
  if (normalized && !allowed.has(normalized as T)) {
    throw new Error(`Unsupported ${label}: ${normalized}.`)
  }
  return (normalized as T) || undefined
}

function text(value: string | undefined, label: string, maxLength: number) {
  return validateOptionalText(value, label, maxLength)?.trim() || undefined
}

function pathPrefix(value: string | undefined) {
  const normalized = text(value, 'time-series path prefix', MAX_OBJECT_NAME_LENGTH)
  if (!normalized) {
    return undefined
  }
  return `/${normalized.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

function bool(value: boolean | undefined, label: string) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be true or false.`)
  }
  return value
}

function integer(value: number | undefined, label: string, min: number, max: number) {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}.`)
  }
  return value
}
