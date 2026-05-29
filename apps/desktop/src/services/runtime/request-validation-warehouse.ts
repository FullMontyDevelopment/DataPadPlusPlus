import type {
  ConnectionProfile,
  SecretRef,
  WarehouseAuthMode,
  WarehouseConnectionMode,
  WarehouseQueryLanguage,
} from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from './request-validation-core'

const CONNECT_MODES = new Set<WarehouseConnectionMode>([
  'snowflake-sql-api',
  'bigquery-rest',
  'clickhouse-http',
  'clickhouse-native',
  'duckdb-file',
  'duckdb-memory',
  'connection-string',
])

const AUTH_MODES = new Set<WarehouseAuthMode>([
  'none',
  'basic',
  'bearer-token',
  'oauth',
  'service-account',
  'cloud-default',
])

const QUERY_LANGUAGES = new Set<WarehouseQueryLanguage>([
  'snowflake-sql',
  'googlesql',
  'clickhouse-sql',
  'duckdb-sql',
])

export function validateWarehouseConnectionOptions(
  options: ConnectionProfile['warehouseOptions'] | null | undefined,
): ConnectionProfile['warehouseOptions'] {
  if (options === undefined || options === null) {
    return undefined
  }
  if (typeof options !== 'object') {
    throw new Error('Warehouse connection options must be an object.')
  }

  return {
    connectMode: enumValue(options.connectMode, CONNECT_MODES, 'Warehouse connection mode'),
    endpointUrl: text(options.endpointUrl, 'Warehouse endpoint URL', MAX_SCOPE_LENGTH),
    pathPrefix: pathPrefix(options.pathPrefix),
    accountName: text(options.accountName, 'Warehouse account', MAX_OBJECT_NAME_LENGTH),
    projectId: text(options.projectId, 'Warehouse project id', MAX_OBJECT_NAME_LENGTH),
    datasetId: text(options.datasetId, 'Warehouse dataset id', MAX_OBJECT_NAME_LENGTH),
    databaseName: text(options.databaseName, 'Warehouse database', MAX_OBJECT_NAME_LENGTH),
    schemaName: text(options.schemaName, 'Warehouse schema', MAX_OBJECT_NAME_LENGTH),
    warehouseName: text(options.warehouseName, 'Warehouse compute name', MAX_OBJECT_NAME_LENGTH),
    roleName: text(options.roleName, 'Warehouse role', MAX_OBJECT_NAME_LENGTH),
    catalogName: text(options.catalogName, 'Warehouse catalog', MAX_OBJECT_NAME_LENGTH),
    region: text(options.region, 'Warehouse region', MAX_OBJECT_NAME_LENGTH),
    location: text(options.location, 'Warehouse location', MAX_OBJECT_NAME_LENGTH),
    filePath: text(options.filePath, 'Warehouse file path', MAX_SCOPE_LENGTH),
    tempDirectory: text(options.tempDirectory, 'Warehouse temp directory', MAX_SCOPE_LENGTH),
    memoryLimit: text(options.memoryLimit, 'Warehouse memory limit', MAX_OBJECT_NAME_LENGTH),
    extensions: list(options.extensions, 'Warehouse extension', MAX_OBJECT_NAME_LENGTH, 64),
    defaultQueryLanguage: enumValue(
      options.defaultQueryLanguage,
      QUERY_LANGUAGES,
      'Warehouse query language',
    ),
    authMode: enumValue(options.authMode, AUTH_MODES, 'Warehouse auth mode'),
    username: text(options.username, 'Warehouse username', MAX_OBJECT_NAME_LENGTH),
    tokenSecretRef: options.tokenSecretRef
      ? validateSecretRef(options.tokenSecretRef, 'Warehouse token')
      : undefined,
    serviceAccountKeySecretRef: options.serviceAccountKeySecretRef
      ? validateSecretRef(options.serviceAccountKeySecretRef, 'Warehouse service account key')
      : undefined,
    clientId: text(options.clientId, 'Warehouse client id', MAX_OBJECT_NAME_LENGTH),
    clientSecretRef: options.clientSecretRef
      ? validateSecretRef(options.clientSecretRef, 'Warehouse client secret')
      : undefined,
    profileName: text(options.profileName, 'Warehouse profile', MAX_OBJECT_NAME_LENGTH),
    useTls: bool(options.useTls, 'Warehouse TLS flag'),
    verifyCertificates: bool(options.verifyCertificates, 'Warehouse certificate verification flag'),
    caCertificatePath: text(
      options.caCertificatePath,
      'Warehouse CA certificate path',
      MAX_SCOPE_LENGTH,
    ),
    clientCertificatePath: text(
      options.clientCertificatePath,
      'Warehouse client certificate path',
      MAX_SCOPE_LENGTH,
    ),
    clientKeyPath: text(options.clientKeyPath, 'Warehouse client key path', MAX_SCOPE_LENGTH),
    connectionTimeoutMs: integer(
      options.connectionTimeoutMs,
      'Warehouse connection timeout',
      1,
      900_000,
    ),
    queryTimeoutMs: integer(options.queryTimeoutMs, 'Warehouse query timeout', 1, 3_600_000),
    maxRows: integer(options.maxRows, 'Warehouse max rows', 1, 1_000_000),
    threads: integer(options.threads, 'Warehouse threads', 1, 256),
    dryRunByDefault: bool(options.dryRunByDefault, 'Warehouse dry-run flag'),
    explainByDefault: bool(options.explainByDefault, 'Warehouse explain-by-default flag'),
    costLimitUsd: decimal(options.costLimitUsd, 'Warehouse cost limit', 0, 1_000_000),
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
  const normalized = text(value, 'Warehouse path prefix', MAX_OBJECT_NAME_LENGTH)
  if (!normalized) {
    return undefined
  }
  return `/${normalized.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

function list(
  value: string[] | undefined,
  label: string,
  maxItemLength: number,
  maxItems: number,
) {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new Error(`${label}s must be a list.`)
  }
  if (value.length > maxItems) {
    throw new Error(`${label}s may include at most ${maxItems} items.`)
  }
  return value
    .map((item) => text(item, label, maxItemLength))
    .filter((item): item is string => Boolean(item))
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

function decimal(value: number | undefined, label: string, min: number, max: number) {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label} must be a number between ${min} and ${max}.`)
  }
  return value
}
