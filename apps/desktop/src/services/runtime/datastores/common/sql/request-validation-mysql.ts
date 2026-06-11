import type {
  ConnectionProfile,
  MySqlAuthMode,
  MySqlConnectMode,
  MySqlNativeSslMode,
  MySqlServerFlavor,
  SecretRef,
} from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from '../request-validation-core'

const CONNECT_MODES = new Set<MySqlConnectMode>([
  'tcp',
  'unix-socket',
  'cloud-sql-proxy',
  'managed-mysql',
  'managed-mariadb',
  'connection-string',
])
const AUTH_MODES = new Set<MySqlAuthMode>(['password', 'cleartext-plugin', 'iam-token'])
const SSL_MODES = new Set<MySqlNativeSslMode>([
  'disabled',
  'preferred',
  'required',
  'verify-ca',
  'verify-identity',
])
const SERVER_FLAVORS = new Set<MySqlServerFlavor>([
  'mysql',
  'mariadb',
  'percona',
  'aurora-mysql',
])

export function validateMySqlConnectionOptions(
  options: ConnectionProfile['mysqlOptions'] | null | undefined,
): ConnectionProfile['mysqlOptions'] {
  if (options === undefined || options === null) {
    return undefined
  }
  if (typeof options !== 'object') {
    throw new Error('MySQL connection options must be an object.')
  }

  return {
    connectMode: enumValue(options.connectMode, CONNECT_MODES, 'MySQL connection mode'),
    authMode: enumValue(options.authMode, AUTH_MODES, 'MySQL authentication mode'),
    sslMode: enumValue(options.sslMode, SSL_MODES, 'MySQL SSL mode'),
    serverFlavor: enumValue(options.serverFlavor, SERVER_FLAVORS, 'MySQL server flavor'),
    applicationName: text(options.applicationName, 'MySQL application name', MAX_OBJECT_NAME_LENGTH),
    charset: text(options.charset, 'MySQL charset', MAX_OBJECT_NAME_LENGTH),
    collation: text(options.collation, 'MySQL collation', MAX_OBJECT_NAME_LENGTH),
    timeZone: text(options.timeZone, 'MySQL time zone', MAX_OBJECT_NAME_LENGTH),
    sqlMode: text(options.sqlMode, 'MySQL SQL mode', MAX_SCOPE_LENGTH),
    defaultStorageEngine: text(
      options.defaultStorageEngine,
      'MySQL default storage engine',
      MAX_OBJECT_NAME_LENGTH,
    ),
    allowLocalInfile: booleanValue(options.allowLocalInfile, 'MySQL local infile flag'),
    statementCacheCapacity: integer(
      options.statementCacheCapacity,
      'MySQL statement cache capacity',
      0,
      10_000,
    ),
    connectTimeoutMs: integer(options.connectTimeoutMs, 'MySQL connection timeout', 1, 900_000),
    commandTimeoutMs: integer(options.commandTimeoutMs, 'MySQL command timeout', 1, 900_000),
    caCertificatePath: text(options.caCertificatePath, 'MySQL CA certificate path', MAX_SCOPE_LENGTH),
    clientCertificatePath: text(
      options.clientCertificatePath,
      'MySQL client certificate path',
      MAX_SCOPE_LENGTH,
    ),
    clientKeyPath: text(options.clientKeyPath, 'MySQL client key path', MAX_SCOPE_LENGTH),
    certificatePasswordSecretRef: options.certificatePasswordSecretRef
      ? validateSecretRef(options.certificatePasswordSecretRef, 'MySQL certificate password')
      : undefined,
    unixSocketPath: text(options.unixSocketPath, 'MySQL Unix socket path', MAX_SCOPE_LENGTH),
    cloudSqlInstance: text(
      options.cloudSqlInstance,
      'MySQL Cloud SQL instance',
      MAX_OBJECT_NAME_LENGTH,
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

function booleanValue(value: boolean | undefined, label: string) {
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`)
  }
  return value
}
