import type {
  ConnectionProfile,
  SecretRef,
  SqlServerApplicationIntent,
  SqlServerAuthenticationMode,
  SqlServerConnectionOptions,
  SqlServerConnectMode,
} from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from './request-validation-core'

const CONNECT_MODES = new Set<SqlServerConnectMode>([
  'tcp',
  'named-instance',
  'azure-sql',
  'localdb',
  'shared-memory',
  'named-pipes',
])
const AUTHENTICATION_MODES = new Set<SqlServerAuthenticationMode>([
  'sql-server',
  'windows',
  'azure-ad-password',
  'azure-ad-integrated',
  'azure-ad-interactive',
  'azure-ad-managed-identity',
  'azure-ad-service-principal',
  'certificate',
])
const APPLICATION_INTENTS = new Set<SqlServerApplicationIntent>([
  'default',
  'readwrite',
  'readonly',
])
const CERTIFICATE_VALIDATION_MODES = new Set<
  NonNullable<SqlServerConnectionOptions['certificateValidation']>
>([
  'default',
  'trust-server-certificate',
  'ca-file',
])

export function validateSqlServerConnectionOptions(
  options: ConnectionProfile['sqlServerOptions'] | null | undefined,
): ConnectionProfile['sqlServerOptions'] {
  if (options === undefined || options === null) {
    return undefined
  }
  if (typeof options !== 'object') {
    throw new Error('SQL Server connection options must be an object.')
  }

  return {
    connectMode: enumValue(options.connectMode, CONNECT_MODES, 'SQL Server connection mode'),
    instanceName: text(options.instanceName, 'SQL Server instance name', MAX_OBJECT_NAME_LENGTH),
    localDbInstance: text(
      options.localDbInstance,
      'SQL Server LocalDB instance',
      MAX_OBJECT_NAME_LENGTH,
    ),
    namedPipePath: text(options.namedPipePath, 'SQL Server named pipe path', MAX_SCOPE_LENGTH),
    sharedMemoryServer: text(
      options.sharedMemoryServer,
      'SQL Server shared memory server',
      MAX_OBJECT_NAME_LENGTH,
    ),
    authenticationMode: enumValue(
      options.authenticationMode,
      AUTHENTICATION_MODES,
      'SQL Server authentication mode',
    ),
    azureTenantId: text(options.azureTenantId, 'SQL Server Azure tenant id', MAX_OBJECT_NAME_LENGTH),
    azureClientId: text(options.azureClientId, 'SQL Server Azure client id', MAX_OBJECT_NAME_LENGTH),
    azureManagedIdentityClientId: text(
      options.azureManagedIdentityClientId,
      'SQL Server managed identity client id',
      MAX_OBJECT_NAME_LENGTH,
    ),
    servicePrincipalSecretRef: options.servicePrincipalSecretRef
      ? validateSecretRef(options.servicePrincipalSecretRef, 'SQL Server service principal secret')
      : undefined,
    aadAccessTokenSecretRef: options.aadAccessTokenSecretRef
      ? validateSecretRef(options.aadAccessTokenSecretRef, 'SQL Server Entra access token')
      : undefined,
    clientCertificatePath: text(
      options.clientCertificatePath,
      'SQL Server client certificate path',
      MAX_SCOPE_LENGTH,
    ),
    certificateStore: text(
      options.certificateStore,
      'SQL Server certificate store',
      MAX_OBJECT_NAME_LENGTH,
    ),
    certificateThumbprint: text(
      options.certificateThumbprint,
      'SQL Server certificate thumbprint',
      MAX_OBJECT_NAME_LENGTH,
    ),
    certificatePasswordSecretRef: options.certificatePasswordSecretRef
      ? validateSecretRef(options.certificatePasswordSecretRef, 'SQL Server certificate password')
      : undefined,
    encryptConnection: bool(options.encryptConnection, 'SQL Server encryption flag'),
    trustServerCertificate: bool(
      options.trustServerCertificate,
      'SQL Server trust-certificate flag',
    ),
    trustServerCertificateCaPath: text(
      options.trustServerCertificateCaPath,
      'SQL Server CA certificate path',
      MAX_SCOPE_LENGTH,
    ),
    hostNameInCertificate: text(
      options.hostNameInCertificate,
      'SQL Server host name in certificate',
      MAX_OBJECT_NAME_LENGTH,
    ),
    tlsVersion: text(options.tlsVersion, 'SQL Server TLS version', MAX_OBJECT_NAME_LENGTH),
    certificateValidation: enumValue(
      options.certificateValidation,
      CERTIFICATE_VALIDATION_MODES,
      'SQL Server certificate validation',
    ),
    connectionTimeoutMs: integer(
      options.connectionTimeoutMs,
      'SQL Server connection timeout',
      1,
      900_000,
    ),
    commandTimeoutMs: integer(
      options.commandTimeoutMs,
      'SQL Server command timeout',
      1,
      900_000,
    ),
    applicationName: text(
      options.applicationName,
      'SQL Server application name',
      MAX_OBJECT_NAME_LENGTH,
    ),
    multipleActiveResultSets: bool(
      options.multipleActiveResultSets,
      'SQL Server MARS flag',
    ),
    pooling: bool(options.pooling, 'SQL Server pooling flag'),
    minPoolSize: integer(options.minPoolSize, 'SQL Server minimum pool size', 0, 10_000),
    maxPoolSize: integer(options.maxPoolSize, 'SQL Server maximum pool size', 1, 10_000),
    packetSize: integer(options.packetSize, 'SQL Server packet size', 512, 32_767),
    persistSecurityInfo: bool(
      options.persistSecurityInfo,
      'SQL Server persist-security-info flag',
    ),
    failoverPartner: text(
      options.failoverPartner,
      'SQL Server failover partner',
      MAX_OBJECT_NAME_LENGTH,
    ),
    multiSubnetFailover: bool(
      options.multiSubnetFailover,
      'SQL Server multi-subnet failover flag',
    ),
    readOnlyIntent: bool(options.readOnlyIntent, 'SQL Server read-only intent flag'),
    applicationIntent: enumValue(
      options.applicationIntent,
      APPLICATION_INTENTS,
      'SQL Server application intent',
    ),
    workstationId: text(options.workstationId, 'SQL Server workstation id', MAX_OBJECT_NAME_LENGTH),
    language: text(options.language, 'SQL Server language', MAX_OBJECT_NAME_LENGTH),
    networkLibrary: text(options.networkLibrary, 'SQL Server network library', MAX_OBJECT_NAME_LENGTH),
    transparentNetworkIpResolution: bool(
      options.transparentNetworkIpResolution,
      'SQL Server transparent network IP resolution flag',
    ),
    connectRetryCount: integer(options.connectRetryCount, 'SQL Server retry count', 0, 255),
    connectRetryIntervalSeconds: integer(
      options.connectRetryIntervalSeconds,
      'SQL Server retry interval',
      0,
      86_400,
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
  value: T | null | undefined,
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
