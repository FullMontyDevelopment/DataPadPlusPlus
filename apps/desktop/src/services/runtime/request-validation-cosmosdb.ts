import type {
  ConnectionProfile,
  CosmosDbApiKind,
  CosmosDbAuthMode,
  CosmosDbConnectMode,
  CosmosDbConsistencyLevel,
  SecretRef,
} from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from './request-validation-core'

const APIS = new Set<CosmosDbApiKind>(['nosql', 'mongodb', 'cassandra', 'gremlin', 'table'])
const CONNECT_MODES = new Set<CosmosDbConnectMode>([
  'emulator',
  'account-endpoint',
  'connection-string',
  'entra-id',
  'managed-identity',
  'resource-token',
])
const AUTH_MODES = new Set<CosmosDbAuthMode>([
  'emulator',
  'account-key',
  'resource-token',
  'entra-id',
  'managed-identity',
  'connection-string',
])
const CONSISTENCY_LEVELS = new Set<CosmosDbConsistencyLevel>([
  'strong',
  'bounded-staleness',
  'session',
  'consistent-prefix',
  'eventual',
])
const GATEWAY_MODES = new Set<'gateway' | 'direct'>(['gateway', 'direct'])
const RETRY_MODES = new Set<'fixed' | 'exponential'>(['fixed', 'exponential'])

export function validateCosmosDbConnectionOptions(
  options: ConnectionProfile['cosmosDbOptions'] | null | undefined,
): ConnectionProfile['cosmosDbOptions'] {
  if (options === undefined || options === null) {
    return undefined
  }
  if (typeof options !== 'object') {
    throw new Error('Cosmos DB connection options must be an object.')
  }

  return {
    connectMode: enumValue(options.connectMode, CONNECT_MODES, 'Cosmos DB connection mode'),
    api: enumValue(options.api, APIS, 'Cosmos DB API'),
    accountEndpoint: text(options.accountEndpoint, 'Cosmos DB account endpoint', MAX_SCOPE_LENGTH),
    accountName: text(options.accountName, 'Cosmos DB account name', MAX_OBJECT_NAME_LENGTH),
    databaseName: text(options.databaseName, 'Cosmos DB database name', MAX_OBJECT_NAME_LENGTH),
    containerPrefix: text(options.containerPrefix, 'Cosmos DB container prefix', MAX_OBJECT_NAME_LENGTH),
    authMode: enumValue(options.authMode, AUTH_MODES, 'Cosmos DB auth mode'),
    accountKeySecretRef: options.accountKeySecretRef
      ? validateSecretRef(options.accountKeySecretRef, 'Cosmos DB account key')
      : undefined,
    resourceTokenSecretRef: options.resourceTokenSecretRef
      ? validateSecretRef(options.resourceTokenSecretRef, 'Cosmos DB resource token')
      : undefined,
    tenantId: text(options.tenantId, 'Cosmos DB tenant id', MAX_OBJECT_NAME_LENGTH),
    clientId: text(options.clientId, 'Cosmos DB client id', MAX_OBJECT_NAME_LENGTH),
    managedIdentityClientId: text(
      options.managedIdentityClientId,
      'Cosmos DB managed identity client id',
      MAX_OBJECT_NAME_LENGTH,
    ),
    subscriptionId: text(options.subscriptionId, 'Cosmos DB subscription id', MAX_OBJECT_NAME_LENGTH),
    resourceGroup: text(options.resourceGroup, 'Cosmos DB resource group', MAX_OBJECT_NAME_LENGTH),
    preferredRegions: textList(options.preferredRegions, 'Cosmos DB preferred region', 16),
    writeRegion: text(options.writeRegion, 'Cosmos DB write region', MAX_OBJECT_NAME_LENGTH),
    consistencyLevel: enumValue(
      options.consistencyLevel,
      CONSISTENCY_LEVELS,
      'Cosmos DB consistency level',
    ),
    enableCrossPartitionQueries: bool(
      options.enableCrossPartitionQueries,
      'Cosmos DB cross-partition flag',
    ),
    maxItemCount: integer(options.maxItemCount, 'Cosmos DB max item count', 1, 10_000),
    returnRequestCharge: bool(options.returnRequestCharge, 'Cosmos DB request-charge flag'),
    gatewayMode: enumValue(options.gatewayMode, GATEWAY_MODES, 'Cosmos DB gateway mode'),
    useTls: bool(options.useTls, 'Cosmos DB TLS flag'),
    allowSelfSignedEmulatorCertificate: bool(
      options.allowSelfSignedEmulatorCertificate,
      'Cosmos DB emulator certificate flag',
    ),
    retryMode: enumValue(options.retryMode, RETRY_MODES, 'Cosmos DB retry mode'),
    maxRetryAttempts: integer(options.maxRetryAttempts, 'Cosmos DB max retry attempts', 0, 20),
    requestTimeoutMs: integer(options.requestTimeoutMs, 'Cosmos DB request timeout', 1, 900_000),
    connectionTimeoutMs: integer(
      options.connectionTimeoutMs,
      'Cosmos DB connection timeout',
      1,
      900_000,
    ),
    applicationName: text(options.applicationName, 'Cosmos DB application name', MAX_OBJECT_NAME_LENGTH),
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
  return values.map((value) => text(value, label, MAX_OBJECT_NAME_LENGTH)).filter(Boolean) as string[]
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
