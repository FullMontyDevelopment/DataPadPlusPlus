import type {
  CassandraConnectionOptions,
  ConnectionProfile,
  SecretRef,
} from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from '../common/request-validation-core'

const CONNECT_MODES = new Set(['contact-points', 'connection-string', 'secure-connect-bundle'])
const AUTH_PROVIDERS = new Set(['none', 'password', 'kerberos', 'secure-connect-bundle'])
const PROTOCOLS = new Set(['v3', 'v4', 'v5', 'dse-v1'])
const CONSISTENCY_LEVELS = new Set([
  'one',
  'two',
  'three',
  'quorum',
  'all',
  'local-quorum',
  'each-quorum',
  'local-one',
  'serial',
  'local-serial',
])
const LOAD_BALANCING_POLICIES = new Set([
  'token-aware',
  'dc-aware-round-robin',
  'round-robin',
])
const RETRY_POLICIES = new Set(['default', 'fallthrough', 'downgrading-consistency'])
const COMPRESSION_MODES = new Set(['none', 'lz4', 'snappy'])

export function validateCassandraConnectionOptions(
  options: ConnectionProfile['cassandraOptions'] | null | undefined,
): ConnectionProfile['cassandraOptions'] {
  if (options === undefined || options === null) {
    return undefined
  }
  if (typeof options !== 'object') {
    throw new Error('Cassandra connection options must be an object.')
  }

  return {
    connectMode: enumValue(options.connectMode, CONNECT_MODES, 'Cassandra connect mode'),
    contactPoints: textList(options.contactPoints, 'Cassandra contact point', 64),
    defaultKeyspace: text(options.defaultKeyspace, 'Cassandra default keyspace', MAX_OBJECT_NAME_LENGTH),
    localDatacenter: text(options.localDatacenter, 'Cassandra local datacenter', MAX_OBJECT_NAME_LENGTH),
    protocolVersion: enumValue(options.protocolVersion, PROTOCOLS, 'Cassandra protocol version'),
    authProvider: enumValue(options.authProvider, AUTH_PROVIDERS, 'Cassandra auth provider'),
    secureConnectBundlePath: text(
      options.secureConnectBundlePath,
      'Cassandra secure connect bundle path',
      MAX_SCOPE_LENGTH,
    ),
    useTls: bool(options.useTls, 'Cassandra TLS flag'),
    caCertificatePath: text(options.caCertificatePath, 'Cassandra CA certificate path', MAX_SCOPE_LENGTH),
    clientCertificatePath: text(
      options.clientCertificatePath,
      'Cassandra client certificate path',
      MAX_SCOPE_LENGTH,
    ),
    clientKeyPath: text(options.clientKeyPath, 'Cassandra client key path', MAX_SCOPE_LENGTH),
    certificatePasswordSecretRef: options.certificatePasswordSecretRef
      ? validateSecretRef(
          options.certificatePasswordSecretRef,
          'Cassandra certificate password',
        )
      : undefined,
    compression: enumValue(options.compression, COMPRESSION_MODES, 'Cassandra compression'),
    consistencyLevel: enumValue(
      options.consistencyLevel,
      CONSISTENCY_LEVELS,
      'Cassandra consistency level',
    ),
    serialConsistencyLevel: enumValue(
      options.serialConsistencyLevel,
      CONSISTENCY_LEVELS,
      'Cassandra serial consistency level',
    ),
    loadBalancingPolicy: enumValue(
      options.loadBalancingPolicy,
      LOAD_BALANCING_POLICIES,
      'Cassandra load balancing policy',
    ),
    retryPolicy: enumValue(options.retryPolicy, RETRY_POLICIES, 'Cassandra retry policy'),
    pageSize: integer(options.pageSize, 'Cassandra page size', 1, 10_000),
    connectTimeoutMs: integer(options.connectTimeoutMs, 'Cassandra connect timeout', 1, 900_000),
    requestTimeoutMs: integer(options.requestTimeoutMs, 'Cassandra request timeout', 1, 900_000),
    readTimeoutMs: integer(options.readTimeoutMs, 'Cassandra read timeout', 1, 900_000),
    heartbeatIntervalMs: integer(
      options.heartbeatIntervalMs,
      'Cassandra heartbeat interval',
      1,
      900_000,
    ),
    applicationName: text(options.applicationName, 'Cassandra application name', MAX_OBJECT_NAME_LENGTH),
    clientId: text(options.clientId, 'Cassandra client id', MAX_OBJECT_NAME_LENGTH),
    enableTracingDefault: bool(options.enableTracingDefault, 'Cassandra tracing flag'),
    allowBetaProtocol: bool(options.allowBetaProtocol, 'Cassandra beta protocol flag'),
  } as CassandraConnectionOptions
}

function enumValue<T extends string>(
  value: T | undefined,
  allowedValues: Set<string>,
  label: string,
) {
  const normalized = validateOptionalText(value, label, MAX_OBJECT_NAME_LENGTH)?.trim()
  if (normalized && !allowedValues.has(normalized)) {
    throw new Error(`Unsupported ${label}: ${normalized}.`)
  }
  return normalized || undefined
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

function text(value: string | undefined, label: string, maxLength: number) {
  return validateOptionalText(value, label, maxLength)?.trim() || undefined
}

function textList(values: string[] | undefined, label: string, maxItems: number) {
  if (values === undefined) {
    return undefined
  }
  if (!Array.isArray(values)) {
    throw new Error(`${label} list must be an array.`)
  }
  if (values.length > maxItems) {
    throw new Error(`${label} list may include at most ${maxItems} entries.`)
  }
  return values.map((value) => text(value, label, MAX_SCOPE_LENGTH)).filter(Boolean) as string[]
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
