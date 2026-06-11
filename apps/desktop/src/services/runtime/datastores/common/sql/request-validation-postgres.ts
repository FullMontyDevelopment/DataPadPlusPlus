import type {
  CockroachConnectionCapabilities,
  CockroachDeploymentMode,
  ConnectionProfile,
  PostgresConnectMode,
  PostgresTargetSessionAttrs,
  SecretRef,
  TimescaleConnectionCapabilities,
  TimescaleDeploymentMode,
  TimescaleLicenseMode,
} from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from '../request-validation-core'

const CONNECT_MODES = new Set<PostgresConnectMode>([
  'tcp',
  'unix-socket',
  'cloud-sql-proxy',
  'managed-postgres',
  'connection-string',
])

const TARGET_SESSION_ATTRS = new Set<PostgresTargetSessionAttrs>([
  'any',
  'read-write',
  'read-only',
  'primary',
  'standby',
  'prefer-standby',
])

const COCKROACH_DEPLOYMENT_MODES = new Set<CockroachDeploymentMode>([
  'local-single-node',
  'self-hosted',
  'cockroach-cloud-dedicated',
  'cockroach-cloud-serverless',
])

const TIMESCALE_DEPLOYMENT_MODES = new Set<TimescaleDeploymentMode>([
  'local-dev',
  'self-hosted',
  'managed-postgres',
  'timescale-cloud',
  'postgres-wire',
])

const TIMESCALE_LICENSE_MODES = new Set<TimescaleLicenseMode>([
  'apache',
  'community',
  'timescale',
  'enterprise',
  'unknown',
])

export function validatePostgresConnectionOptions(
  options: ConnectionProfile['postgresOptions'] | null | undefined,
): ConnectionProfile['postgresOptions'] {
  if (options === undefined || options === null) {
    return undefined
  }
  if (typeof options !== 'object') {
    throw new Error('PostgreSQL connection options must be an object.')
  }

  return {
    connectMode: enumValue(options.connectMode, CONNECT_MODES, 'PostgreSQL connection mode'),
    applicationName: text(options.applicationName, 'PostgreSQL application name', MAX_OBJECT_NAME_LENGTH),
    searchPath: text(options.searchPath, 'PostgreSQL search path', MAX_SCOPE_LENGTH),
    targetSessionAttrs: enumValue(
      options.targetSessionAttrs,
      TARGET_SESSION_ATTRS,
      'PostgreSQL target session attributes',
    ),
    connectTimeoutMs: integer(options.connectTimeoutMs, 'PostgreSQL connection timeout', 1, 900_000),
    statementTimeoutMs: integer(options.statementTimeoutMs, 'PostgreSQL statement timeout', 1, 3_600_000),
    lockTimeoutMs: integer(options.lockTimeoutMs, 'PostgreSQL lock timeout', 1, 3_600_000),
    idleInTransactionSessionTimeoutMs: integer(
      options.idleInTransactionSessionTimeoutMs,
      'PostgreSQL idle transaction timeout',
      1,
      3_600_000,
    ),
    useTls: bool(options.useTls, 'PostgreSQL TLS flag'),
    verifyServerCertificate: bool(
      options.verifyServerCertificate,
      'PostgreSQL certificate verification flag',
    ),
    caCertificatePath: text(options.caCertificatePath, 'PostgreSQL CA certificate path', MAX_SCOPE_LENGTH),
    clientCertificatePath: text(
      options.clientCertificatePath,
      'PostgreSQL client certificate path',
      MAX_SCOPE_LENGTH,
    ),
    clientKeyPath: text(options.clientKeyPath, 'PostgreSQL client key path', MAX_SCOPE_LENGTH),
    certificatePasswordSecretRef: options.certificatePasswordSecretRef
      ? validateSecretRef(options.certificatePasswordSecretRef, 'PostgreSQL certificate password')
      : undefined,
    unixSocketPath: text(options.unixSocketPath, 'PostgreSQL Unix socket path', MAX_SCOPE_LENGTH),
    cloudSqlInstance: text(
      options.cloudSqlInstance,
      'PostgreSQL Cloud SQL instance',
      MAX_OBJECT_NAME_LENGTH,
    ),
    cockroachDeploymentMode: enumValue(
      options.cockroachDeploymentMode,
      COCKROACH_DEPLOYMENT_MODES,
      'CockroachDB deployment mode',
    ),
    cockroachOrganization: text(
      options.cockroachOrganization,
      'CockroachDB organization',
      MAX_OBJECT_NAME_LENGTH,
    ),
    cockroachClusterName: text(
      options.cockroachClusterName,
      'CockroachDB cluster name',
      MAX_OBJECT_NAME_LENGTH,
    ),
    cockroachClusterId: text(
      options.cockroachClusterId,
      'CockroachDB cluster id',
      MAX_OBJECT_NAME_LENGTH,
    ),
    cockroachCloudRegion: text(
      options.cockroachCloudRegion,
      'CockroachDB cloud region',
      MAX_OBJECT_NAME_LENGTH,
    ),
    cockroachDefaultRegion: text(
      options.cockroachDefaultRegion,
      'CockroachDB default region',
      MAX_OBJECT_NAME_LENGTH,
    ),
    cockroachLocality: text(options.cockroachLocality, 'CockroachDB locality', MAX_SCOPE_LENGTH),
    cockroachServerVersion: text(
      options.cockroachServerVersion,
      'CockroachDB server version',
      MAX_OBJECT_NAME_LENGTH,
    ),
    cockroachBuildTag: text(
      options.cockroachBuildTag,
      'CockroachDB build tag',
      MAX_OBJECT_NAME_LENGTH,
    ),
    cockroachAuthDisabledReason: text(
      options.cockroachAuthDisabledReason,
      'CockroachDB auth disabled reason',
      MAX_SCOPE_LENGTH,
    ),
    cockroachTlsDisabledReason: text(
      options.cockroachTlsDisabledReason,
      'CockroachDB TLS disabled reason',
      MAX_SCOPE_LENGTH,
    ),
    cockroachCapabilities: validateCockroachCapabilities(options.cockroachCapabilities),
    timescaleDeploymentMode: enumValue(
      options.timescaleDeploymentMode,
      TIMESCALE_DEPLOYMENT_MODES,
      'TimescaleDB deployment mode',
    ),
    timescaleProject: text(
      options.timescaleProject,
      'TimescaleDB project',
      MAX_OBJECT_NAME_LENGTH,
    ),
    timescaleServiceId: text(
      options.timescaleServiceId,
      'TimescaleDB service id',
      MAX_OBJECT_NAME_LENGTH,
    ),
    timescaleRegion: text(
      options.timescaleRegion,
      'TimescaleDB region',
      MAX_OBJECT_NAME_LENGTH,
    ),
    timescaleExtensionSchema: text(
      options.timescaleExtensionSchema,
      'TimescaleDB extension schema',
      MAX_OBJECT_NAME_LENGTH,
    ),
    timescaleExtensionVersion: text(
      options.timescaleExtensionVersion,
      'TimescaleDB extension version',
      MAX_OBJECT_NAME_LENGTH,
    ),
    timescaleServerVersion: text(
      options.timescaleServerVersion,
      'TimescaleDB server version',
      MAX_OBJECT_NAME_LENGTH,
    ),
    timescaleLicense: enumValue(
      options.timescaleLicense,
      TIMESCALE_LICENSE_MODES,
      'TimescaleDB license',
    ),
    timescalePolicyExecutionDisabledReason: text(
      options.timescalePolicyExecutionDisabledReason,
      'TimescaleDB policy execution disabled reason',
      MAX_SCOPE_LENGTH,
    ),
    timescaleCompressionDisabledReason: text(
      options.timescaleCompressionDisabledReason,
      'TimescaleDB compression disabled reason',
      MAX_SCOPE_LENGTH,
    ),
    timescaleRetentionDisabledReason: text(
      options.timescaleRetentionDisabledReason,
      'TimescaleDB retention disabled reason',
      MAX_SCOPE_LENGTH,
    ),
    timescaleContinuousAggregateDisabledReason: text(
      options.timescaleContinuousAggregateDisabledReason,
      'TimescaleDB continuous aggregate disabled reason',
      MAX_SCOPE_LENGTH,
    ),
    timescaleCapabilities: validateTimescaleCapabilities(options.timescaleCapabilities),
  }
}

function validateCockroachCapabilities(
  capabilities: CockroachConnectionCapabilities | null | undefined,
): CockroachConnectionCapabilities | undefined {
  if (capabilities === undefined || capabilities === null) {
    return undefined
  }
  if (typeof capabilities !== 'object') {
    throw new Error('CockroachDB capabilities must be an object.')
  }

  return {
    inspectJobs: bool(capabilities.inspectJobs, 'CockroachDB job-inspection capability'),
    inspectRanges: bool(capabilities.inspectRanges, 'CockroachDB range-inspection capability'),
    inspectRegions: bool(capabilities.inspectRegions, 'CockroachDB region-inspection capability'),
    inspectClusterStatus: bool(
      capabilities.inspectClusterStatus,
      'CockroachDB cluster-status capability',
    ),
    inspectClusterSettings: bool(
      capabilities.inspectClusterSettings,
      'CockroachDB cluster-settings capability',
    ),
    inspectSessions: bool(
      capabilities.inspectSessions,
      'CockroachDB session-inspection capability',
    ),
    inspectContention: bool(
      capabilities.inspectContention,
      'CockroachDB contention-inspection capability',
    ),
    inspectRolesAndGrants: bool(
      capabilities.inspectRolesAndGrants,
      'CockroachDB role/grant-inspection capability',
    ),
    inspectCertificates: bool(
      capabilities.inspectCertificates,
      'CockroachDB certificate-inspection capability',
    ),
    inspectZoneConfigurations: bool(
      capabilities.inspectZoneConfigurations,
      'CockroachDB zone-configuration capability',
    ),
    explainAnalyze: bool(
      capabilities.explainAnalyze,
      'CockroachDB EXPLAIN ANALYZE capability',
    ),
  }
}

function validateTimescaleCapabilities(
  capabilities: TimescaleConnectionCapabilities | null | undefined,
): TimescaleConnectionCapabilities | undefined {
  if (capabilities === undefined || capabilities === null) {
    return undefined
  }
  if (typeof capabilities !== 'object') {
    throw new Error('TimescaleDB capabilities must be an object.')
  }

  return {
    inspectHypertables: bool(
      capabilities.inspectHypertables,
      'TimescaleDB hypertable-inspection capability',
    ),
    inspectChunks: bool(capabilities.inspectChunks, 'TimescaleDB chunk-inspection capability'),
    inspectCompression: bool(
      capabilities.inspectCompression,
      'TimescaleDB compression-inspection capability',
    ),
    inspectRetention: bool(
      capabilities.inspectRetention,
      'TimescaleDB retention-inspection capability',
    ),
    inspectContinuousAggregates: bool(
      capabilities.inspectContinuousAggregates,
      'TimescaleDB continuous-aggregate-inspection capability',
    ),
    inspectJobs: bool(capabilities.inspectJobs, 'TimescaleDB job-inspection capability'),
    inspectToolkit: bool(capabilities.inspectToolkit, 'TimescaleDB Toolkit capability'),
    explainAnalyze: bool(capabilities.explainAnalyze, 'TimescaleDB EXPLAIN ANALYZE capability'),
    livePolicyExecution: bool(
      capabilities.livePolicyExecution,
      'TimescaleDB live policy execution capability',
    ),
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

function enumValue<T extends string>(
  value: T | undefined,
  allowed: ReadonlySet<T>,
  label: string,
): T | undefined {
  const normalized = validateOptionalText(value, label, MAX_OBJECT_NAME_LENGTH)?.trim()
  if (normalized && !allowed.has(normalized as T)) {
    throw new Error(`Unsupported ${label}: ${normalized}.`)
  }
  return (normalized as T) || undefined
}

function text(value: string | undefined, label: string, maxLength: number) {
  return validateOptionalText(value, label, maxLength)?.trim() || undefined
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

function bool(value: boolean | undefined, label: string) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`)
  }
  return value
}
