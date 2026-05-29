import type {
  ConnectionProfile,
  SearchAuthMode,
  SearchConnectionMode,
  SecretRef,
} from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from './request-validation-core'

const CONNECT_MODES = new Set<SearchConnectionMode>([
  'http',
  'elastic-cloud',
  'opensearch-managed',
  'aws-sigv4',
  'connection-string',
])
const AUTH_MODES = new Set<SearchAuthMode>([
  'none',
  'basic',
  'api-key',
  'bearer-token',
  'service-token',
  'aws-sigv4',
])
const AWS_SERVICES = new Set<'es' | 'aoss'>(['es', 'aoss'])

export function validateSearchConnectionOptions(
  options: ConnectionProfile['searchOptions'] | null | undefined,
): ConnectionProfile['searchOptions'] {
  if (options === undefined || options === null) {
    return undefined
  }
  if (typeof options !== 'object') {
    throw new Error('Search connection options must be an object.')
  }

  return {
    connectMode: enumValue(options.connectMode, CONNECT_MODES, 'Search connection mode'),
    endpointUrl: text(options.endpointUrl, 'Search endpoint URL', MAX_SCOPE_LENGTH),
    cloudId: text(options.cloudId, 'Search cloud id', MAX_SCOPE_LENGTH),
    defaultIndex: text(options.defaultIndex, 'Search default index', MAX_OBJECT_NAME_LENGTH),
    pathPrefix: pathPrefix(options.pathPrefix),
    authMode: enumValue(options.authMode, AUTH_MODES, 'Search auth mode'),
    username: text(options.username, 'Search username', MAX_OBJECT_NAME_LENGTH),
    apiKeyId: text(options.apiKeyId, 'Search API key id', MAX_OBJECT_NAME_LENGTH),
    apiKeySecretRef: options.apiKeySecretRef
      ? validateSecretRef(options.apiKeySecretRef, 'Search API key')
      : undefined,
    bearerTokenSecretRef: options.bearerTokenSecretRef
      ? validateSecretRef(options.bearerTokenSecretRef, 'Search bearer token')
      : undefined,
    serviceTokenSecretRef: options.serviceTokenSecretRef
      ? validateSecretRef(options.serviceTokenSecretRef, 'Search service token')
      : undefined,
    awsRegion: text(options.awsRegion, 'Search AWS region', MAX_OBJECT_NAME_LENGTH),
    awsService: enumValue(options.awsService, AWS_SERVICES, 'Search AWS service'),
    awsProfileName: text(options.awsProfileName, 'Search AWS profile', MAX_OBJECT_NAME_LENGTH),
    awsRoleArn: text(options.awsRoleArn, 'Search AWS role ARN', MAX_SCOPE_LENGTH),
    verifyCertificates: bool(options.verifyCertificates, 'Search certificate verification flag'),
    useTls: bool(options.useTls, 'Search TLS flag'),
    caCertificatePath: text(options.caCertificatePath, 'Search CA certificate path', MAX_SCOPE_LENGTH),
    clientCertificatePath: text(
      options.clientCertificatePath,
      'Search client certificate path',
      MAX_SCOPE_LENGTH,
    ),
    clientKeyPath: text(options.clientKeyPath, 'Search client key path', MAX_SCOPE_LENGTH),
    compression: bool(options.compression, 'Search compression flag'),
    requestTimeoutMs: integer(options.requestTimeoutMs, 'Search request timeout', 1, 900_000),
    connectionTimeoutMs: integer(
      options.connectionTimeoutMs,
      'Search connection timeout',
      1,
      900_000,
    ),
    maxRetries: integer(options.maxRetries, 'Search max retries', 0, 20),
    sniffOnStart: bool(options.sniffOnStart, 'Search sniff-on-start flag'),
    opaqueId: text(options.opaqueId, 'Search opaque id', MAX_OBJECT_NAME_LENGTH),
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
  const normalized = text(value, 'Search path prefix', MAX_OBJECT_NAME_LENGTH)
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
