import type {
  ConnectionProfile,
  GraphAuthMode,
  GraphConnectionMode,
  GraphQueryLanguage,
  SecretRef,
} from '@datapadplusplus/shared-types'
import {
  MAX_OBJECT_NAME_LENGTH,
  MAX_SCOPE_LENGTH,
  validateOptionalText,
  validateRequiredId,
  validateRequiredText,
} from '../request-validation-core'

const CONNECT_MODES = new Set<GraphConnectionMode>([
  'neo4j-http',
  'neo4j-bolt',
  'arango-http',
  'gremlin-http',
  'neptune-http',
  'neptune-iam',
  'connection-string',
])
const AUTH_MODES = new Set<GraphAuthMode>(['none', 'basic', 'bearer-token', 'aws-sigv4'])
const QUERY_LANGUAGES = new Set<GraphQueryLanguage>([
  'cypher',
  'aql',
  'gremlin',
  'opencypher',
  'sparql',
])

export function validateGraphConnectionOptions(
  options: ConnectionProfile['graphOptions'] | null | undefined,
): ConnectionProfile['graphOptions'] {
  if (options === undefined || options === null) {
    return undefined
  }
  if (typeof options !== 'object') {
    throw new Error('Graph connection options must be an object.')
  }

  return {
    connectMode: enumValue(options.connectMode, CONNECT_MODES, 'Graph connection mode'),
    endpointUrl: text(options.endpointUrl, 'Graph endpoint URL', MAX_SCOPE_LENGTH),
    pathPrefix: pathPrefix(options.pathPrefix),
    databaseName: text(options.databaseName, 'Graph database', MAX_OBJECT_NAME_LENGTH),
    traversalSource: text(options.traversalSource, 'Graph traversal source', MAX_OBJECT_NAME_LENGTH),
    graphName: text(options.graphName, 'Graph name', MAX_OBJECT_NAME_LENGTH),
    defaultQueryLanguage: enumValue(
      options.defaultQueryLanguage,
      QUERY_LANGUAGES,
      'Graph query language',
    ),
    authMode: enumValue(options.authMode, AUTH_MODES, 'Graph auth mode'),
    username: text(options.username, 'Graph username', MAX_OBJECT_NAME_LENGTH),
    tokenSecretRef: options.tokenSecretRef
      ? validateSecretRef(options.tokenSecretRef, 'Graph token')
      : undefined,
    awsRegion: text(options.awsRegion, 'Graph AWS region', MAX_OBJECT_NAME_LENGTH),
    awsProfileName: text(options.awsProfileName, 'Graph AWS profile', MAX_OBJECT_NAME_LENGTH),
    awsRoleArn: text(options.awsRoleArn, 'Graph AWS role ARN', MAX_SCOPE_LENGTH),
    useIamAuth: bool(options.useIamAuth, 'Graph IAM auth flag'),
    verifyCertificates: bool(options.verifyCertificates, 'Graph certificate verification flag'),
    useTls: bool(options.useTls, 'Graph TLS flag'),
    caCertificatePath: text(options.caCertificatePath, 'Graph CA certificate path', MAX_SCOPE_LENGTH),
    clientCertificatePath: text(
      options.clientCertificatePath,
      'Graph client certificate path',
      MAX_SCOPE_LENGTH,
    ),
    clientKeyPath: text(options.clientKeyPath, 'Graph client key path', MAX_SCOPE_LENGTH),
    connectionTimeoutMs: integer(options.connectionTimeoutMs, 'Graph connection timeout', 1, 900_000),
    queryTimeoutMs: integer(options.queryTimeoutMs, 'Graph query timeout', 1, 3_600_000),
    fetchSize: integer(options.fetchSize, 'Graph fetch size', 1, 100_000),
    explainByDefault: bool(options.explainByDefault, 'Graph explain-by-default flag'),
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
  const normalized = text(value, 'Graph path prefix', MAX_OBJECT_NAME_LENGTH)
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
